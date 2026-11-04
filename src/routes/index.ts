import { promises as fs } from "node:fs";
import type { PassThrough } from "node:stream";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  FileConflictError,
  FileNotFoundError,
  UploadValidationError,
} from "@antelopejs/interface-file-storage";
import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Put,
  type RequestContext,
  StreamBody,
  WriteStream,
} from "@antelopejs/interface-api";

import { getStorageConfig, getTokenManager } from "../module-config";
import {
  buildContentDisposition,
  NoSniffHeaderValue,
  resolveContentType,
  resolveDownloadFilename,
} from "./download-headers";

/**
 * File Storage HTTP Controller
 *
 * Handles file uploads and downloads via presigned-like URLs.
 *
 * WARNING: This module is NOT compatible with clustering/multi-instance deployments.
 * All data is stored on the local filesystem and is not shared between instances.
 * For production multi-instance deployments, use file-storage-s3 instead.
 */
export class FileStorageController extends Controller("file-storage") {
  /**
   * PUT /file-storage/upload/:token
   *
   * Handles file upload with token validation.
   * Validates Content-Type and Content-Length against the token's expected values.
   * Returns 403 if headers don't match (simulating S3 SigV4 behavior).
   * The body is streamed to disk, so the token size bounds what is accepted,
   * whatever the API module's default request body limit is.
   */
  @Put("/upload/:token")
  async handleUpload(
    @Parameter("token", "param") token: string,
    @Parameter("content-type", "header") contentType: string | undefined,
    @Parameter("content-length", "header") contentLength: string | undefined,
    @Parameter("storage", "query") storage: string | undefined,
    @Context() context: RequestContext,
  ): Promise<HTTPResult> {
    const tokenManager = getTokenManager(storage);

    const uploadToken = await tokenManager.getUploadToken(token);
    if (!uploadToken) {
      return new HTTPResult(404, { error: "Token not found or expired" });
    }

    if (uploadToken.expiresAt < Date.now()) {
      await tokenManager.deleteUploadToken(token);
      return new HTTPResult(403, { error: "Token expired" });
    }

    if (contentType !== uploadToken.mimetype) {
      return new HTTPResult(403, {
        error: "Content-Type mismatch",
        expected: uploadToken.mimetype,
        received: contentType,
      });
    }

    const expectedSize = uploadToken.size;
    const receivedSize =
      contentLength === undefined ? expectedSize : parseInt(contentLength, 10);
    if (receivedSize !== expectedSize) {
      return new HTTPResult(403, {
        error: "Content-Length mismatch",
        expected: expectedSize,
        received: receivedSize,
      });
    }

    try {
      await tokenManager.saveUpload(token, StreamBody(context));

      return new HTTPResult(200, {
        success: true,
        resourceKey: uploadToken.resourceKey,
      });
    } catch (error: unknown) {
      if (error instanceof UploadValidationError)
        return new HTTPResult(403, {
          error: "Body size mismatch",
          expected: expectedSize,
        });
      if (error instanceof FileConflictError)
        return new HTTPResult(409, { error: error.message });
      if (error instanceof FileNotFoundError)
        return new HTTPResult(403, { error: "Token expired" });
      if (context.rawRequest.errored)
        return new HTTPResult(400, { error: "Upload aborted" });
      Logging.Error("File upload error:", error);
      return new HTTPResult(500, { error: "Failed to save file" });
    }
  }

  /**
   * GET /file-storage/files/:resourceKey
   *
   * Handles file download.
   * - For public files: serves directly
   * - For private files: requires valid read token via ?token= query param
   *
   * A HEAD request gets the headers only. The file is streamed rather than
   * buffered, so peak memory stays bounded whatever the file size or the number
   * of concurrent downloads. Once streaming starts the 200 status is committed,
   * so a read or write error aborts the connection instead of writing an error
   * body, and a client disconnect releases the file handle and the stream.
   */
  @Get("/files/:resourceKey")
  async handleDownload(
    @Parameter("token", "query") token: string | undefined,
    @Parameter("resourceKey", "param") resourceKey: string,
    @Parameter("storage", "query") storage: string | undefined,
    @WriteStream() stream: PassThrough,
    @Context() context: RequestContext,
  ): Promise<void> {
    const tokenManager = getTokenManager(storage);

    if (!resourceKey) {
      context.response.setStatus(400);
      stream.write(JSON.stringify({ error: "Resource key required" }));
      stream.end();
      return;
    }

    const decodedResourceKey = decodeURIComponent(resourceKey);

    const metadata = await tokenManager.getFileMetadata(decodedResourceKey);
    if (!metadata) {
      context.response.setStatus(404);
      stream.write(JSON.stringify({ error: "File metadata not found" }));
      stream.end();
      return;
    }

    const exists = await tokenManager.fileExists(
      decodedResourceKey,
      metadata.path,
    );
    if (!exists) {
      context.response.setStatus(404);
      stream.write(JSON.stringify({ error: "File not found" }));
      stream.end();
      return;
    }

    const config = getStorageConfig(storage);
    const visibility = metadata.visibility ?? config.defaultVisibility;
    if (visibility === "private") {
      if (!token) {
        context.response.setStatus(403);
        stream.write(
          JSON.stringify({
            error: "Access denied. Token required for private files.",
          }),
        );
        stream.end();
        return;
      }

      const readToken = await tokenManager.getReadToken(token);
      if (!readToken) {
        context.response.setStatus(403);
        stream.write(JSON.stringify({ error: "Invalid or expired token" }));
        stream.end();
        return;
      }

      if (readToken.expiresAt < Date.now()) {
        context.response.setStatus(403);
        stream.write(JSON.stringify({ error: "Token expired" }));
        stream.end();
        return;
      }

      if (readToken.resourceKey !== decodedResourceKey) {
        context.response.setStatus(403);
        stream.write(
          JSON.stringify({ error: "Token does not match requested resource" }),
        );
        stream.end();
        return;
      }
    }

    try {
      const filePath = tokenManager.getFilePath(
        decodedResourceKey,
        metadata.path,
      );
      context.response.getWriteStream(
        resolveContentType(metadata.mimetype),
        200,
      );
      context.response.addHeader("Content-Length", metadata.size.toString());
      context.response.addHeader("X-Content-Type-Options", NoSniffHeaderValue);
      context.response.addHeader(
        "Content-Disposition",
        buildContentDisposition(
          resolveDownloadFilename(metadata, decodedResourceKey),
        ),
      );
      context.response.addHeader(
        "Cache-Control",
        visibility === "public"
          ? "public, max-age=31536000"
          : "private, no-cache",
      );

      if (context.rawRequest.method?.toLowerCase() === "head") {
        stream.end();
        return;
      }

      const handle = await fs.open(filePath, "r");
      const fileStream = handle.createReadStream();
      const abortDownload = (error: Error) => {
        Logging.Error("File download error:", error);
        fileStream.destroy();
        stream.destroy();
        context.rawResponse.destroy();
      };
      fileStream.on("error", abortDownload);
      stream.on("error", abortDownload);
      context.rawResponse.once("close", () => {
        fileStream.destroy();
        stream.destroy();
      });
      fileStream.pipe(stream);
      return;
    } catch (error: unknown) {
      Logging.Error("File download error:", error);
      context.response.setStatus(500);
      stream.write(JSON.stringify({ error: "Failed to read file" }));
      stream.end();
      return;
    }
  }
}
