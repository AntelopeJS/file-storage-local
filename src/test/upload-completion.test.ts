import { request } from "node:http";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import {
  CreateReadUrl,
  CreateUploadUrl,
  DeleteFile,
  FileExists,
  type PresignedUploadResponse,
  PromoteFile,
  type UploadRequest,
} from "@antelopejs/interface-file-storage";

import { getConfig, getTokenManager } from "../module-config";

const FirstBody = "first-body";
const OtherBody = "other-body";
const MimeType = "text/plain";

async function createUpload(
  request: Partial<UploadRequest> = {},
  storage?: string,
): Promise<PresignedUploadResponse> {
  return CreateUploadUrl(
    {
      filename: "completion.txt",
      mimetype: MimeType,
      size: FirstBody.length,
      ...request,
    },
    undefined,
    storage,
  );
}

async function put(
  upload: PresignedUploadResponse,
  body: string,
): Promise<Response> {
  return fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body,
  });
}

describe("write-once HTTP upload completion", () => {
  it("conflicts on replay even after the completed object is deleted", async () => {
    const upload = await createUpload();
    assert.equal((await put(upload, FirstBody)).status, 200);
    assert.equal((await put(upload, OtherBody)).status, 409);
    const read = await CreateReadUrl(upload.resourceKey);
    assert.equal(await (await fetch(read.url)).text(), FirstBody);
    await DeleteFile(upload.resourceKey);
    assert.equal((await put(upload, OtherBody)).status, 409);
    assert.equal(await FileExists(upload.resourceKey), false);
  });

  it("publishes exactly one of two distinct equal-length concurrent bodies", async () => {
    const upload = await createUpload();
    const bodies = [FirstBody, OtherBody];
    const results = await Promise.all(bodies.map((body) => put(upload, body)));
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const winner = results.findIndex((result) => result.status === 200);
    const read = await CreateReadUrl(upload.resourceKey);
    assert.equal(await (await fetch(read.url)).text(), bodies[winner]);
    await DeleteFile(upload.resourceKey);
  });

  it("allows retry after body validation fails before consumption", async () => {
    const upload = await createUpload();
    const rejected = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": MimeType },
      body: "short",
    });
    assert.equal(rejected.status, 403);
    assert.equal(await FileExists(upload.resourceKey), false);
    assert.equal((await put(upload, FirstBody)).status, 200);
    await DeleteFile(upload.resourceKey);
  });

  it("allows a full retry after the client disconnects during the request body", async () => {
    const upload = await createUpload();
    await new Promise<void>((resolve) => {
      const partial = request(upload.uploadUrl, {
        method: "PUT",
        headers: upload.headers,
      });
      partial.on("error", () => resolve());
      partial.write("short", () =>
        partial.destroy(new Error("Interrupted test upload")),
      );
    });
    assert.equal(await FileExists(upload.resourceKey), false);
    assert.equal((await put(upload, OtherBody)).status, 200);
    const read = await CreateReadUrl(upload.resourceKey);
    assert.equal(await (await fetch(read.url)).text(), OtherBody);
    await DeleteFile(upload.resourceKey);
  });

  it("allows retry after a disk write fails before consumption", async () => {
    const upload = await createUpload();
    const open = fs.open;
    fs.open = async (path, flags, mode) => {
      if (path.toString().includes(upload.resourceKey) && flags === "wx")
        throw new Error("Injected preclaim write failure");
      return open(path, flags, mode);
    };
    try {
      assert.equal((await put(upload, FirstBody)).status, 500);
    } finally {
      fs.open = open;
    }
    assert.equal((await put(upload, OtherBody)).status, 200);
    const read = await CreateReadUrl(upload.resourceKey);
    assert.equal(await (await fetch(read.url)).text(), OtherBody);
    await DeleteFile(upload.resourceKey);
  });

  it("returns an error after postclaim failure and never takes over that token", async () => {
    const upload = await createUpload();
    const link = fs.link;
    fs.link = async (source, destination) => {
      if (destination.toString().endsWith(upload.resourceKey))
        throw new Error("Injected postclaim link failure");
      return link(source, destination);
    };
    try {
      assert.equal((await put(upload, FirstBody)).status, 500);
    } finally {
      fs.link = link;
    }
    assert.equal(await FileExists(upload.resourceKey), false);
    assert.equal((await put(upload, OtherBody)).status, 409);
    await DeleteFile(upload.resourceKey);
  });
});

describe("write-once visibility and storage selection", () => {
  it("preserves private promotion and omitted visibility under a public default", async () => {
    const config = getConfig();
    const previous = config.defaultVisibility;
    config.defaultVisibility = "public";
    try {
      const upload = await createUpload({
        visibility: "private",
        staging: true,
      });
      assert.equal((await put(upload, FirstBody)).status, 200);
      const promoted = await PromoteFile(upload.resourceKey);
      const read = await CreateReadUrl(promoted.resourceKey);
      assert.ok(read.expiresAt);
      const unsigned = new URL(read.url);
      unsigned.searchParams.delete("token");
      assert.equal((await fetch(unsigned)).status, 403);
      assert.equal(await (await fetch(read.url)).text(), FirstBody);
      assert.equal(
        (await getTokenManager().getFileMetadata(promoted.resourceKey))
          ?.visibility,
        "private",
      );
      assert.equal((await put(upload, OtherBody)).status, 409);
      const omitted = await createUpload();
      assert.equal((await put(omitted, OtherBody)).status, 200);
      const publicRead = await CreateReadUrl(omitted.resourceKey);
      assert.equal(publicRead.expiresAt, undefined);
      assert.equal(await (await fetch(publicRead.url)).text(), OtherBody);
      await DeleteFile(promoted.resourceKey);
      await DeleteFile(omitted.resourceKey);
    } finally {
      config.defaultVisibility = previous;
    }
  });

  it("keeps consumption and promotion scoped to the selected named store", async () => {
    const upload = await createUpload(
      { visibility: "private", staging: true },
      "media",
    );
    const wrongStore = new URL(upload.uploadUrl);
    wrongStore.searchParams.delete("storage");
    assert.equal(
      (
        await fetch(wrongStore, {
          method: "PUT",
          headers: upload.headers,
          body: OtherBody,
        })
      ).status,
      404,
    );
    assert.equal((await put(upload, FirstBody)).status, 200);
    assert.equal((await put(upload, OtherBody)).status, 409);
    const promoted = await PromoteFile(upload.resourceKey, "media");
    assert.equal(await FileExists(promoted.resourceKey), false);
    const read = await CreateReadUrl(promoted.resourceKey, undefined, "media");
    assert.equal(await (await fetch(read.url)).text(), FirstBody);
    assert.deepEqual(await PromoteFile(upload.resourceKey, "media"), promoted);
    await DeleteFile(promoted.resourceKey, "media");
  });
});
