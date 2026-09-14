import { createReadStream } from "node:fs";
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
} from "@antelopejs/interface-api";

import { getAttachmentManager } from "../module-config";

export class AttachmentStorageController extends Controller(
  "file-storage-attachments",
) {
  @Put("/upload/:storage/:token")
  async upload(
    @Parameter("storage", "param") storage: string,
    @Parameter("token", "param") token: string,
    @Parameter("content-type", "header") contentType: string | undefined,
    @RawBody() body: Buffer,
  ): Promise<HTTPResult> {
    const manager = getAttachmentManager(
      storage === "default" ? undefined : storage,
    );
    const upload = manager.consumeUpload(token);
    if (!upload || upload.expiresAt < Date.now())
      return new HTTPResult(403, { error: "Invalid or expired token" });
    if (
      contentType !== upload.request.mimetype ||
      body.length !== upload.request.size
    )
      return new HTTPResult(403, {
        error: "Upload does not match signed request",
      });
    await manager.storeTemporary(upload, body);
    return new HTTPResult(200, { resourceKey: upload.resourceKey });
  }

  @Get("/private/:storage/:resourceKey")
  async privateRead(
    @Parameter("storage", "param") storage: string,
    @Parameter("resourceKey", "param") resourceKey: string,
    @Parameter("token", "query") token: string | undefined,
    @WriteStream() stream: PassThrough,
    @Context() context: RequestContext,
  ): Promise<void> {
    const manager = getAttachmentManager(
      storage === "default" ? undefined : storage,
    );
    const read = token ? manager.getReadToken(token) : undefined;
    if (
      !read ||
      read.expiresAt < Date.now() ||
      read.resourceKey !== resourceKey
    ) {
      context.response.setStatus(403);
      stream.end();
      return;
    }
    createReadStream(await manager.readPath(resourceKey)).pipe(stream);
  }

  @Get("/public/:storage/:resourceKey")
  async publicRead(
    @Parameter("storage", "param") storage: string,
    @Parameter("resourceKey", "param") resourceKey: string,
    @WriteStream() stream: PassThrough,
  ): Promise<void> {
    const manager = getAttachmentManager(
      storage === "default" ? undefined : storage,
    );
    createReadStream(manager.publicPath(resourceKey)).pipe(stream);
  }
}
