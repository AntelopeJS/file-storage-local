import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import {
  CreateReadUrl,
  DeleteFile,
  FileExists,
  STAGING_PREFIX,
  WriteFile,
} from "@antelopejs/interface-file-storage";

import { getTokenManager } from "../module-config";
import type { StoredFileMetadata } from "../storage/token-manager";

const Bare = "bare";
const Swept = "swept";
const SweepAttempts = 30;
const SweepPollMs = 100;
const Body = new Uint8Array([104, 105]);
const MimeType = "text/plain";
const ReadSeconds = 60;
const DefaultReadSeconds = 60;
const SeedTimestamp = 1767225600000;
const MillisecondsPerSecond = 1000;
const created: string[] = [];

describe("a named storage that sets only its path and base URL", () => {
  afterEach(async () => {
    await Promise.all(created.splice(0).map((key) => DeleteFile(key, Bare)));
  });

  it("asks for a token to download a file stored without a visibility", async () => {
    const resourceKey = "seed/no-visibility.txt";
    await seedFile(resourceKey);
    const signed = new URL(
      (await CreateReadUrl(resourceKey, ReadSeconds, Bare)).url,
    );
    assert.equal((await fetch(signed)).status, 200);
    signed.searchParams.delete("token");
    assert.equal((await fetch(signed)).status, 403);
  });

  it("accepts a written file", async () => {
    const { resourceKey } = await WriteFile(
      { filename: "written.txt", mimetype: MimeType, size: Body.length },
      Body,
      undefined,
      Bare,
    );
    created.push(resourceKey);
    assert.equal(await FileExists(resourceKey, Bare), true);
  });

  it("gives a read URL the default expiry", async () => {
    const resourceKey = "seed/default-expiry.txt";
    await seedFile(resourceKey);
    const before = Date.now();
    const { expiresAt } = await CreateReadUrl(resourceKey, undefined, Bare);
    assert.ok(expiresAt !== undefined);
    assert.ok(expiresAt >= before + DefaultReadSeconds * MillisecondsPerSecond);
    assert.ok(
      expiresAt <= Date.now() + DefaultReadSeconds * MillisecondsPerSecond,
    );
  });
});

describe("a named storage with its own cleanup interval and staging expiration", () => {
  it("sweeps its expired staged files", async () => {
    const resourceKey = `${STAGING_PREFIX}old.txt`;
    const path = await seedFile(resourceKey, Swept);
    const past = new Date(SeedTimestamp);
    await fs.utimes(path, past, past);
    for (let attempt = 0; attempt < SweepAttempts; attempt++) {
      if (!(await FileExists(resourceKey, Swept))) return;
      await new Promise((resolve) => setTimeout(resolve, SweepPollMs));
    }
    assert.equal(await FileExists(resourceKey, Swept), false);
  });
});

async function seedFile(resourceKey: string, storage = Bare): Promise<string> {
  const tokenManager = getTokenManager(storage);
  await tokenManager.ensureFileDirectory(resourceKey);
  await fs.writeFile(tokenManager.getFilePath(resourceKey), Body);
  const metadata: StoredFileMetadata = {
    resourceKey,
    mimetype: MimeType,
    size: Body.length,
    lastModified: SeedTimestamp,
  };
  await tokenManager.saveFileMetadata(metadata);
  if (storage === Bare) created.push(resourceKey);
  return tokenManager.getFilePath(resourceKey);
}
