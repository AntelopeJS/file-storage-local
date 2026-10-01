import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import {
  CreateReadUrl,
  CreateUploadUrl,
  DeleteFile,
  STAGING_PREFIX,
  type Visibility,
} from "@antelopejs/interface-file-storage";

import { getTokenManager } from "../index";
import {
  buildContentDisposition,
  resolveDownloadFilename,
} from "../routes/download-headers";
import type { StoredFileMetadata } from "../storage/token-manager";

const PngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PngMimetype = "image/png";
const FallbackContentType = "application/octet-stream";
const ReadSeconds = 60;
const UnnamedResourceKey = `${STAGING_PREFIX}avatars/unnamed.bin`;
const UntypedResourceKey = "seed/untyped.bin";
const SeedTimestamp = 1767225600000;
const created: string[] = [];

interface SeedFile {
  resourceKey: string;
  mimetype: string;
  metadata?: Record<string, string>;
}

describe("download headers", () => {
  afterEach(async () => {
    await Promise.all(created.splice(0).map((key) => DeleteFile(key)));
  });

  it("serves a stored png with its content type and nosniff", async () => {
    const download = await uploadAndDownload("red.png", "private");

    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), PngMimetype);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      download.headers.get("content-disposition"),
      `inline; filename="red.png"; filename*=UTF-8''red.png`,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), PngBytes);
  });

  it("applies the same headers to public downloads", async () => {
    const download = await uploadAndDownload("public.png", "public");

    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), PngMimetype);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      download.headers.get("content-disposition"),
      `inline; filename="public.png"; filename*=UTF-8''public.png`,
    );
  });

  it("encodes filenames with spaces, accents and quotes", async () => {
    const download = await uploadAndDownload(
      'my "final" résumé (1).png',
      "private",
    );

    assert.equal(
      download.headers.get("content-disposition"),
      `inline; filename="my final resume (1).png"; filename*=UTF-8''my%20%22final%22%20r%C3%A9sum%C3%A9%20%281%29.png`,
    );
  });

  it("falls back to the resource key basename without filename metadata", async () => {
    await seedFile({ resourceKey: UnnamedResourceKey, mimetype: PngMimetype });
    const download = await downloadResource(UnnamedResourceKey);

    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-disposition"),
      `inline; filename="unnamed.bin"; filename*=UTF-8''unnamed.bin`,
    );
  });

  it("falls back to application/octet-stream without a stored content type", async () => {
    await seedFile({
      resourceKey: UntypedResourceKey,
      mimetype: "",
      metadata: { filename: "untyped.bin" },
    });
    const download = await downloadResource(UntypedResourceKey);

    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), FallbackContentType);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  });

  it("strips control characters and non-ASCII from the quoted filename", () => {
    assert.equal(
      buildContentDisposition('a\r\nb\\"c\u0007😀.txt'),
      `inline; filename="abc_.txt"; filename*=UTF-8''a%0D%0Ab%5C%22c%07%F0%9F%98%80.txt`,
    );
  });

  it("prefers the stored filename over the resource key", () => {
    assert.equal(
      resolveDownloadFilename(
        {
          resourceKey: "uploads/key.png",
          mimetype: PngMimetype,
          size: 0,
          lastModified: SeedTimestamp,
          metadata: { filename: "original.png" },
        },
        "uploads/key.png",
      ),
      "original.png",
    );
  });
});

async function uploadAndDownload(
  filename: string,
  visibility: Visibility,
): Promise<Response> {
  const upload = await CreateUploadUrl({
    filename,
    mimetype: PngMimetype,
    size: PngBytes.length,
    visibility,
  });
  created.push(upload.resourceKey);
  const stored = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: PngBytes,
  });
  assert.equal(stored.status, 200);
  return downloadResource(upload.resourceKey);
}

async function downloadResource(resourceKey: string): Promise<Response> {
  const signed = await CreateReadUrl(resourceKey, ReadSeconds);
  return fetch(signed.url);
}

async function seedFile(seed: SeedFile): Promise<void> {
  const tokenManager = getTokenManager();
  await tokenManager.ensureFileDirectory(seed.resourceKey);
  await fs.writeFile(tokenManager.getFilePath(seed.resourceKey), PngBytes);
  const metadata: StoredFileMetadata = {
    resourceKey: seed.resourceKey,
    mimetype: seed.mimetype,
    size: PngBytes.length,
    lastModified: SeedTimestamp,
  };
  if (seed.metadata) {
    metadata.metadata = seed.metadata;
  }
  await tokenManager.saveFileMetadata(metadata);
  created.push(seed.resourceKey);
}
