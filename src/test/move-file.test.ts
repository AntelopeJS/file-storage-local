import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { STAGING_PREFIX } from "@antelopejs/interface-file-storage";

import { pathExists } from "../storage/publication";
import { TokenManager } from "../storage/token-manager";
import {
  asPlatform,
  permissionError,
  PosixPlatform,
  WindowsPlatform,
} from "./platform";

const Moved = "moved-body";
const Replaced = "replaced-body";
const Mime = "text/plain";
const Lifetime = 60_000;
const ReadOnlyOpenMode = "r";
const FinalKey = "moved.txt";
const StageKey = `${STAGING_PREFIX}${FinalKey}`;
let root: string;
let manager: TokenManager;

async function seedDestination(): Promise<string> {
  const token = await manager.createUploadToken({
    resourceKey: StageKey,
    mimetype: Mime,
    size: Moved.length,
    expiresAt: Date.now() + Lifetime,
  });
  await manager.saveUpload(token.token, Buffer.from(Moved));
  const destination = manager.getFilePath(FinalKey);
  await fs.writeFile(destination, Replaced);
  return destination;
}

async function withRenameBlockedByDestination(
  run: () => Promise<void>,
): Promise<void> {
  const originalRename = fs.rename;
  const blockOccupiedDestination = async (
    ...args: Parameters<typeof fs.rename>
  ): Promise<void> => {
    if (await pathExists(String(args[1]))) throw permissionError("rename");
    return originalRename(...args);
  };
  fs.rename = blockOccupiedDestination;
  try {
    await run();
  } finally {
    fs.rename = originalRename;
  }
}

describe("moving files over an existing destination", () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "local-move-"));
    manager = new TokenManager(root);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("replaces a destination that a download still holds open", async () => {
    const destination = await seedDestination();
    const download = await fs.open(destination, ReadOnlyOpenMode);
    try {
      await manager.moveFile(StageKey, FinalKey);
    } finally {
      await download.close();
    }
    assert.equal(await fs.readFile(destination, "utf8"), Moved);
    assert.equal(await manager.fileExists(StageKey), false);
  });

  it("replaces a destination Windows refuses to rename over", async () => {
    const destination = await seedDestination();
    await asPlatform(WindowsPlatform, () =>
      withRenameBlockedByDestination(() =>
        manager.moveFile(StageKey, FinalKey),
      ),
    );
    assert.equal(await fs.readFile(destination, "utf8"), Moved);
  });

  it("keeps rename failures fatal on posix platforms", async () => {
    const destination = await seedDestination();
    await asPlatform(PosixPlatform, () =>
      withRenameBlockedByDestination(() =>
        assert.rejects(manager.moveFile(StageKey, FinalKey), {
          code: "EPERM",
        }),
      ),
    );
    assert.equal(await fs.readFile(destination, "utf8"), Replaced);
  });
});
