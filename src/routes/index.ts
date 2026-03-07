import { promises as fs } from "node:fs";
import type { PassThrough } from "node:stream";
import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Put,
  RawBody,
  type RequestContext,
  WriteStream,
} from "@ajs/api/beta";
import { getConfig, getTokenManager } from "../index";
import type { StoredFileMetadata, UploadToken } from "../storage/token-manager";

function buildStoredFileMetadata(uploadToken: UploadToken): StoredFileMetadata {
  const metadata: StoredFileMetadata = {
    resourceKey: uploadToken.resourceKey,
    mimetype: uploadToken.mimetype,
    size: uploadToken.size,
    lastModified: Date.now(),
  };
  if (uploadToken.path) {
    metadata.path = uploadToken.path;
  }
  if (uploadToken.metadata) {
    metadata.metadata = uploadToken.metadata;
  }
  return metadata;
}

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
   */
  @Put("/upload/:token")
  async handleUpload(
    @Parameter("token", "param") token: string,
    @Parameter("content-type", "header") contentType: string | undefined,
    @Parameter("content-length", "header") contentLength: string | undefined,
    @RawBody() body: Buffer,
    @Context() _context: RequestContext,
  ): Promise<HTTPResult> {
    const tokenManager = getTokenManager();

    // Get upload token
    const uploadToken = await tokenManager.getUploadToken(token);
    if (!uploadToken) {
      return new HTTPResult(404, { error: "Token not found or expired" });
    }

    // Check expiration
    if (uploadToken.expiresAt < Date.now()) {
      await tokenManager.deleteUploadToken(token);
      return new HTTPResult(403, { error: "Token expired" });
    }

    // Validate Content-Type (must match exactly)
    if (contentType !== uploadToken.mimetype) {
      return new HTTPResult(403, {
        error: "Content-Type mismatch",
        expected: uploadToken.mimetype,
        received: contentType,
      });
    }

    // Validate Content-Length (must match exactly)
    const expectedSize = uploadToken.size;
    const receivedSize = contentLength
      ? parseInt(contentLength, 10)
      : body.length;

    if (receivedSize !== expectedSize) {
      return new HTTPResult(403, {
        error: "Content-Length mismatch",
        expected: expectedSize,
        received: receivedSize,
      });
    }

    // Validate actual body size
    if (body.length !== expectedSize) {
      return new HTTPResult(403, {
        error: "Body size mismatch",
        expected: expectedSize,
        received: body.length,
      });
    }

    try {
      await tokenManager.ensureFileDirectory(
        uploadToken.resourceKey,
        uploadToken.path,
      );

      const filePath = tokenManager.getFilePath(
        uploadToken.resourceKey,
        uploadToken.path,
      );
      await fs.writeFile(filePath, body);

      await tokenManager.saveFileMetadata(buildStoredFileMetadata(uploadToken));

      await tokenManager.deleteUploadToken(token);

      return new HTTPResult(200, {
        success: true,
        resourceKey: uploadToken.resourceKey,
      });
    } catch (error: unknown) {
      console.error("File upload error:", error);
      return new HTTPResult(500, { error: "Failed to save file" });
    }
  }

  /**
   * GET /file-storage/files/:resourceKey
   *
   * Handles file download.
   * - For public files: serves directly
   * - For private files: requires valid read token via ?token= query param
   */
  @Get("/files/:resourceKey")
  async handleDownload(
    @Parameter("token", "query") token: string | undefined,
    @Parameter("resourceKey", "param") resourceKey: string,
    @WriteStream() stream: PassThrough,
    @Context() context: RequestContext,
  ): Promise<void> {
    const tokenManager = getTokenManager();

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

    // Check visibility
    const config = getConfig();
    if (config.defaultVisibility === "private") {
      // Private file: requires valid read token
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

      // Check token expiration
      if (readToken.expiresAt < Date.now()) {
        context.response.setStatus(403);
        stream.write(JSON.stringify({ error: "Token expired" }));
        stream.end();
        return;
      }

      // Verify token matches requested resource
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
      const fileBuffer = await fs.readFile(filePath);

      context.response.setStatus(200);
      stream.write(fileBuffer);
      context.response.addHeader("Content-Length", metadata.size.toString());
      context.response.addHeader(
        "Content-Disposition",
        `inline; filename="${metadata.metadata?.["original-filename"] || decodedResourceKey}"`,
      );
      context.response.addHeader(
        "Cache-Control",
        config.defaultVisibility === "public"
          ? "public, max-age=31536000"
          : "private, no-cache",
      );
      stream.end();
      return;
    } catch (error: unknown) {
      console.error("File download error:", error);
      context.response.setStatus(500);
      stream.write(JSON.stringify({ error: "Failed to read file" }));
      stream.end();
      return;
    }
  }
}
