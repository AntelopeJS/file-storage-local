import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { STAGING_PREFIX } from "@antelopejs/interface-file-storage";

import { TokenManager } from "../storage/token-manager";
import { InvalidResourceKeyError } from "../storage/resource-key";
import { asPlatform, PosixPlatform, WindowsPlatform } from "./platform";

const Body = "key-body";
const Mime = "text/plain";
const Lifetime = 60_000;
const UuidKeyPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const UnsafeExtensionFilenames = [
  "report v1.2: final",
  "file.what?",
  "file.txt ",
  "archive.b\\c",
  "notes./../../etc",
  `long.${"x".repeat(64)}`,
];
const PreservedExtensions = {
  "photo.JPG": ".JPG",
  "archive.tar.gz": ".gz",
  "scan.tiff": ".tiff",
  "carte.géo": ".géo",
};
const EscapingKeys = [
  "",
  "/",
  "..",
  "../secret",
  "nested/../../secret",
  `${STAGING_PREFIX}../metadata/secret`,
];
const WindowsUnstorableKeys = [
  "..\\secret",
  "C:\\Windows\\win.ini",
  "\\\\server\\share\\secret",
  "media/2026-10-13T10:00/file.txt",
  "media/file.txt:stream",
  "media/what?/file.txt",
  "media/tab\tname/file.txt",
  "media/CON/file.txt",
  "media/nul.txt",
  "media/trailing./file.txt",
  "media/trailing /file.txt",
];
const PosixOnlyKeys = ["media/2026-10-13T10:00/file.txt", "media/CON/file.txt"];
const WindowsMaxPath = 260;
const DeepFolderCount = 10;
const DeepFolderNameLength = 30;
let root: string;
let manager: TokenManager;

async function upload(resourceKey: string, path?: string): Promise<void> {
  const token = await manager.createUploadToken({
    resourceKey,
    mimetype: Mime,
    size: Body.length,
    expiresAt: Date.now() + Lifetime,
    path,
  });
  await manager.saveUpload(token.token, Buffer.from(Body));
}

async function assertUnstorable(resourceKey: string): Promise<void> {
  assert.throws(
    () => manager.getFilePath(resourceKey),
    InvalidResourceKeyError,
  );
  assert.equal(await manager.getFileMetadata(resourceKey), null);
  assert.equal(await manager.fileExists(resourceKey), false);
  await assert.rejects(upload(resourceKey), InvalidResourceKeyError);
}

describe("resource keys on the local filesystem", () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "local-resource-key-"));
    manager = new TokenManager(root);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("drops filename extensions that are not portable path characters", async () => {
    for (const filename of UnsafeExtensionFilenames) {
      const key = manager.generateResourceKey(filename);
      assert.match(key, UuidKeyPattern, filename);
      await upload(key);
      assert.equal(await fs.readFile(manager.getFilePath(key), "utf8"), Body);
    }
  });

  it("keeps ordinary filename extensions", () => {
    for (const [filename, extension] of Object.entries(PreservedExtensions))
      assert.ok(manager.generateResourceKey(filename).endsWith(extension));
  });

  it("refuses keys that leave their storage area", async () => {
    await fs.writeFile(join(root, "secret.json"), "{}");
    await fs.writeFile(join(root, "secret"), Body);
    for (const key of EscapingKeys) await assertUnstorable(key);
    await assert.rejects(
      upload("file.txt", "../outside"),
      InvalidResourceKeyError,
    );
  });

  it("refuses keys Windows cannot store before any byte is written", async () => {
    await asPlatform(WindowsPlatform, async () => {
      for (const key of WindowsUnstorableKeys) await assertUnstorable(key);
      await assert.rejects(
        upload("file.txt", "media/2026-10-13T10:00"),
        InvalidResourceKeyError,
      );
    });
    assert.deepEqual(await fs.readdir(join(root, "files")), []);
  });

  it("keeps keys that only Windows forbids on posix platforms", async () => {
    await asPlatform(PosixPlatform, async () => {
      for (const key of PosixOnlyKeys)
        assert.equal(
          manager.getFilePath(key),
          join(root, "files", ...key.split("/")),
        );
    });
  });

  it("stores and promotes keys whose path exceeds the Windows MAX_PATH limit", async () => {
    const folder = Array.from({ length: DeepFolderCount }, (_, index) =>
      `${index}`.padStart(DeepFolderNameLength, "f"),
    ).join("/");
    const staged = manager.toStagedResourceKey(
      manager.generateResourceKey("deep.txt"),
      folder,
    );
    await upload(staged);
    assert.ok(manager.getFilePath(staged).length > WindowsMaxPath);
    const promoted = await manager.promoteFile(staged);
    assert.ok(manager.getFilePath(promoted).length > WindowsMaxPath);
    assert.equal(
      await fs.readFile(manager.getFilePath(promoted), "utf8"),
      Body,
    );
  });
});
