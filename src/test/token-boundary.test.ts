import { join } from "node:path";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import {
  CreateReadUrl,
  CreateUploadUrl,
  DeleteFile,
  FileExists,
} from "@antelopejs/interface-file-storage";

import { getConfig, getTokenManager } from "../index";

const CONTENT = "private file bytes";
const MIME = "text/plain";
const READ_SECONDS = 60;
const MILLISECONDS_PER_SECOND = 1000;
const created: string[] = [];

describe("storage token boundaries", () => {
  afterEach(async () => {
    await Promise.all(created.splice(0).map((key) => DeleteFile(key)));
  });

  it("does not authorize a read with a path to the file metadata", async () => {
    const upload = await CreateUploadUrl({
      filename: "private.txt",
      mimetype: MIME,
      size: CONTENT.length,
    });
    created.push(upload.resourceKey);
    const stored = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: CONTENT,
    });
    assert.equal(stored.status, 200);
    const signed = await CreateReadUrl(upload.resourceKey, READ_SECONDS);
    const forged = new URL(signed.url);
    forged.searchParams.set("token", `../../metadata/${upload.resourceKey}`);
    const response = await fetch(forged);
    assert.notEqual(
      await response.text(),
      CONTENT,
      "forged token disclosed private bytes",
    );
    assert.equal(response.status, 403);
    const allowed = await fetch(signed.url);
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), CONTENT);
  });

  it("never reads or deletes metadata through upload or read token identifiers", async () => {
    const manager = getTokenManager();
    const key = manager.generateResourceKey("preserved.txt");
    created.push(key);
    await manager.ensureFileDirectory(key);
    await writeFile(manager.getFilePath(key), CONTENT);
    await manager.saveFileMetadata({
      resourceKey: key,
      mimetype: MIME,
      size: CONTENT.length,
      lastModified: Date.now(),
    });
    const forged = `../../metadata/${key}`;
    assert.equal(await manager.getUploadToken(forged), null);
    assert.equal(await manager.getReadToken(forged), null);
    await manager.deleteUploadToken(forged);
    await manager.deleteReadToken(forged);
    assert.equal(await FileExists(key), true);
  });

  it("rejects token records with missing expiration or a mismatched identifier", async () => {
    const manager = getTokenManager();
    const token = await manager.createReadToken(
      "fixture",
      Date.now() + READ_SECONDS * MILLISECONDS_PER_SECOND,
    );
    const path = join(
      getConfig().storagePath,
      "tokens",
      "read",
      `${token.token}.json`,
    );
    await writeFile(
      path,
      JSON.stringify({ token: token.token, resourceKey: token.resourceKey }),
    );
    assert.equal(await manager.getReadToken(token.token), null);
    await writeFile(
      path,
      JSON.stringify({ ...token, token: manager.generateToken() }),
    );
    assert.equal(await manager.getReadToken(token.token), null);
    await manager.deleteReadToken(token.token);
  });
});
