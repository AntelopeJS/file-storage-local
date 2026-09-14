import { join } from "node:path";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import {
  CreateReadUrl,
  DeleteFile,
  FileExists,
  GetFileSeal,
  GetFileSnapshot,
  MoveFile,
  RemoveSealedFile,
  SealFile,
} from "@antelopejs/interface-file-storage";

import { getConfig, getTokenManager } from "../index";
import {
  admission,
  download,
  Mime,
  Original,
  replace,
  Replacement,
  reset,
  restart,
  sealError,
  upload,
} from "./seal-helpers";

describe("file seal HTTP isolation and legacy compatibility", () => {
  beforeEach(reset);
  after(reset);

  it("keeps previous upload readable if private bytes are written but metadata publication fails", async () => {
    const source = await upload();
    const snapshot = await GetFileSnapshot(source.resourceKey);
    const rename = fs.rename;
    fs.rename = async () => {
      throw new Error("injected upload metadata interruption");
    };
    try {
      await assert.rejects(() => replace(source.resourceKey));
    } finally {
      fs.rename = rename;
    }
    await restart();
    assert.deepEqual(await GetFileSnapshot(source.resourceKey), snapshot);
    assert.equal(await download(source.resourceKey), Original);
  });

  it("rejects unowned destination bytes rather than acknowledging them as a replay", async () => {
    const request = await admission((await upload()).resourceKey);
    const manager = getTokenManager();
    await manager.ensureFileDirectory(request.destinationKey);
    const path = manager.getFilePath(request.destinationKey);
    await fs.writeFile(path, Replacement);
    for (const operation of [GetFileSeal, SealFile, RemoveSealedFile]) {
      await assert.rejects(
        () => operation(request),
        sealError("DESTINATION_CONFLICT"),
      );
    }
    assert.equal(await fs.readFile(path, "utf8"), Replacement);
  });

  it("never exposes retained private payloads through public or raw HTTP paths", async () => {
    const config = getConfig();
    const visibility = config.defaultVisibility;
    config.defaultVisibility = "public";
    try {
      const request = await admission((await upload()).resourceKey);
      await SealFile(request);
      const read = await CreateReadUrl(request.destinationKey);
      assert.equal((await fetch(read.url)).status, 200);
      await RemoveSealedFile(request);
      await DeleteFile(request.source.resourceKey);
      assert.equal((await fetch(read.url)).status, 404);
      const rawKey = `.immutable/objects/${request.source.generation}`;
      await fs.access(join(config.storagePath, rawKey));
      const raw = await fetch(
        `${config.baseUrl}/file-storage/files/${encodeURIComponent(rawKey)}`,
      );
      assert.equal(raw.status, 404);
      assert.equal((await fetch(`${config.baseUrl}/${rawKey}`)).status, 404);
    } finally {
      config.defaultVisibility = visibility;
    }
  });

  it("preserves ordinary legacy moves over managed uploads", async () => {
    const destination = await upload();
    const manager = getTokenManager();
    const sourceKey = "legacy-source.txt";
    await manager.ensureFileDirectory(sourceKey);
    await fs.writeFile(manager.getFilePath(sourceKey), Replacement);
    await manager.saveFileMetadata({
      resourceKey: sourceKey,
      mimetype: Mime,
      size: Replacement.length,
      lastModified: Date.now(),
    });
    await assert.rejects(
      () => GetFileSnapshot(sourceKey),
      sealError("UNSUPPORTED"),
    );
    await MoveFile(sourceKey, destination.resourceKey);
    assert.equal(await download(destination.resourceKey), Replacement);
    assert.equal(await FileExists(sourceKey), false);
  });
});
