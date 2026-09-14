import { createReadStream } from "node:fs";
import type { PassThrough } from "node:stream";
import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Put,
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
    @Context() context: RequestContext,
  ): Promise<HTTPResult> {
    const manager = getAttachmentManager(
      storage === "default" ? undefined : storage,
    );
    const upload = manager.consumeUpload(token);
    if (!upload || upload.expiresAt < Date.now())
      return new HTTPResult(403, { error: "Invalid or expired token" });
    const body = await readBoundedBody(context, upload.request.size);
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
    await streamFile(
      manager.readPath(resourceKey),
      manager,
      resourceKey,
      stream,
      context,
    );
  }

  @Get("/public/:storage/:resourceKey")
  async publicRead(
    @Parameter("storage", "param") storage: string,
    @Parameter("resourceKey", "param") resourceKey: string,
    @WriteStream() stream: PassThrough,
    @Context() context: RequestContext,
  ): Promise<void> {
    const manager = getAttachmentManager(
      storage === "default" ? undefined : storage,
    );
    await streamFile(
      manager.readablePublicPath(resourceKey),
      manager,
      resourceKey,
      stream,
      context,
    );
  }
}

async function readBoundedBody(
  context: RequestContext,
  expectedSize: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of context.rawRequest) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > expectedSize) throw new Error("Upload exceeds signed size");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function streamFile(
  pathPromise: Promise<string>,
  manager: ReturnType<typeof getAttachmentManager>,
  resourceKey: string,
  stream: PassThrough,
  context: RequestContext,
): Promise<void> {
  try {
    const [path, metadata] = await Promise.all([
      pathPromise,
      manager.metadataFor(resourceKey),
    ]);
    context.response.addHeader("Content-Length", String(metadata.size));
    context.response.addHeader("Content-Type", metadata.mimetype);
    const source = createReadStream(path);
    source.once("error", () => context.rawResponse.destroy());
    source.pipe(stream);
  } catch {
    context.response.setStatus(404);
    stream.end();
  }
}
