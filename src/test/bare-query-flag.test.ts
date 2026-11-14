import assert from "node:assert/strict";
import {
  CreateReadUrl,
  CreateUploadUrl,
  DeleteFile,
  type PresignedUploadResponse,
  type Visibility,
} from "@antelopejs/interface-file-storage";

const Body = "bare-flag-body";
const BareStorageMessage =
  'The "storage" query parameter needs a storage name.';

function withBareFlag(url: string, name: string): string {
  const target = new URL(url);
  target.searchParams.delete(name);
  return `${target.toString()}${target.search ? "&" : "?"}${name}`;
}

async function createUpload(
  visibility: Visibility,
): Promise<PresignedUploadResponse> {
  return CreateUploadUrl({
    filename: "bare-flag.txt",
    mimetype: "text/plain",
    size: Body.length,
    visibility,
  });
}

async function put(url: string, upload: PresignedUploadResponse) {
  return fetch(url, { method: "PUT", headers: upload.headers, body: Body });
}

interface ErrorBody {
  error: string;
}

function assertErrorBody(value: unknown): asserts value is ErrorBody {
  assert.ok(
    typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string",
  );
}

async function errorOf(response: Response): Promise<string> {
  const body: unknown = await response.json();
  assertErrorBody(body);
  return body.error;
}

async function storedFile(visibility: Visibility): Promise<string> {
  const upload = await createUpload(visibility);
  assert.equal((await put(upload.uploadUrl, upload)).status, 200);
  return upload.resourceKey;
}

describe("a query flag given without a value", () => {
  it("refuses an upload whose storage flag names no storage", async () => {
    const upload = await createUpload("public");
    const response = await put(
      withBareFlag(upload.uploadUrl, "storage"),
      upload,
    );
    assert.equal(response.status, 400);
    assert.equal(await errorOf(response), BareStorageMessage);
    assert.equal((await put(upload.uploadUrl, upload)).status, 200);
    await DeleteFile(upload.resourceKey);
  });

  it("refuses a download whose storage flag names no storage", async () => {
    const resourceKey = await storedFile("public");
    const read = await CreateReadUrl(resourceKey);
    const response = await fetch(withBareFlag(read.url, "storage"));
    assert.equal(response.status, 400);
    assert.equal(await errorOf(response), BareStorageMessage);
    assert.equal(await (await fetch(read.url)).text(), Body);
    await DeleteFile(resourceKey);
  });

  it("answers a private download whose token flag has no value like a missing token", async () => {
    const resourceKey = await storedFile("private");
    const read = await CreateReadUrl(resourceKey);
    const response = await fetch(withBareFlag(read.url, "token"));
    assert.equal(response.status, 403);
    assert.equal(
      await errorOf(response),
      "Access denied. Token required for private files.",
    );
    await DeleteFile(resourceKey);
  });
});
