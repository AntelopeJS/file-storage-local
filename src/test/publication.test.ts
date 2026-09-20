import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import {
  FileConflictError,
  STAGING_PREFIX,
} from "@antelopejs/interface-file-storage";

import { ensureDirectory, syncDirectory } from "../storage/publication";
import type { WorkerMessage, WorkerRequest } from "./publication-worker";
import { TokenManager, type UploadToken } from "../storage/token-manager";

const First = "first-body";
const Other = "other-body";
const Mime = "text/plain";
const Lifetime = 60_000;
const FinalKey = "owned.txt";
const StageKey = `${STAGING_PREFIX}${FinalKey}`;
const WindowsPlatform = "win32";
const PosixPlatform = "linux";
const PlatformProperty = "platform";
const UnsupportedSyncCodes = ["EPERM", "EACCES", "EINVAL", "ENOTSUP", "EISDIR"];
const FatalSyncCodes = ["ENOSPC", "EIO", "EROFS"];
let root: string;
let manager: TokenManager;
const children = new Set<ChildProcess>();

interface RunningWorker {
  child: ChildProcess;
  ready: Promise<void>;
  result: Promise<WorkerMessage>;
}

function worker(overrides: Partial<WorkerRequest>): RunningWorker {
  const request: WorkerRequest = {
    root,
    operation: "upload",
    token: "",
    key: StageKey,
    body: First,
    barrier: FinalKey,
    ...overrides,
  };
  const child = fork(
    join(__dirname, "publication-worker.js"),
    ["publication-worker", JSON.stringify(request)],
    { stdio: ["ignore", "inherit", "inherit", "ipc"] },
  );
  children.add(child);
  const ready = new Promise<void>((resolve) =>
    child.on("message", (message: WorkerMessage) => {
      if (message.status === "ready") resolve();
    }),
  );
  const result = new Promise<WorkerMessage>((resolve) =>
    child.on("message", (message: WorkerMessage) => {
      if (message.status !== "ready") resolve(message);
    }),
  );
  return { child, ready, result };
}

async function crash(child: ChildProcess): Promise<void> {
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  children.delete(child);
}

async function upload(key = StageKey): Promise<UploadToken> {
  return manager.createUploadToken(
    key,
    Mime,
    First.length,
    Date.now() + Lifetime,
    { filename: "owned.txt" },
    undefined,
    "private",
  );
}

async function seed(): Promise<UploadToken> {
  const token = await upload();
  await manager.saveUpload(token.token, Buffer.from(First));
  return token;
}

interface SyncableHandle {
  sync: () => Promise<void>;
}

async function asPlatform(
  platform: string,
  run: () => Promise<void>,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    process,
    PlatformProperty,
  ) ?? { value: process.platform, configurable: true };
  Object.defineProperty(process, PlatformProperty, {
    value: platform,
    configurable: true,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(process, PlatformProperty, descriptor);
  }
}

async function withFailingDirectorySync(
  code: string,
  run: () => Promise<void>,
): Promise<void> {
  const probe = await fs.open(root, "r");
  const prototype = Object.getPrototypeOf(probe) as SyncableHandle;
  await probe.close();
  const original = prototype.sync;
  prototype.sync = () => {
    const error: NodeJS.ErrnoException = new Error(
      `${code}: operation not permitted, fsync`,
    );
    error.code = code;
    return Promise.reject(error);
  };
  try {
    await run();
  } finally {
    prototype.sync = original;
  }
}

function setup(): void {
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "local-publication-"));
    manager = new TokenManager(root);
    await manager.initialize();
  });

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null)
        await crash(child);
    }
    children.clear();
    await fs.rm(root, { recursive: true, force: true });
  });
}

describe("durable upload publication", () => {
  setup();
  it("arbitrates different bytes across independent processes at token consumption", async () => {
    const token = await upload();
    const barrier = `consumed/${token.token}.json`;
    const first = worker({ token: token.token, barrier });
    const other = worker({ token: token.token, barrier, body: Other });
    await Promise.all([first.ready, other.ready]);
    first.child.send("continue");
    other.child.send("continue");
    const results = await Promise.all([first.result, other.result]);
    assert.deepEqual(results.map((result) => result.status).sort(), [
      "done",
      "error",
    ]);
    assert.equal(
      results.find((result) => result.status === "error")?.code,
      "FILE_CONFLICT",
    );
    const expected = results[0]?.status === "done" ? First : Other;
    assert.equal(
      await fs.readFile(manager.getFilePath(StageKey), "utf8"),
      expected,
    );
  });

  it("keeps metadata-only interrupted uploads invisible and permanently consumes that URL", async () => {
    const token = await upload();
    const pending = worker({ token: token.token, barrier: StageKey });
    await pending.ready;
    assert.equal(await manager.getFileMetadata(StageKey), null);
    assert.equal(await manager.fileExists(StageKey), false);
    await crash(pending.child);
    const restarted = new TokenManager(root);
    await restarted.initialize();
    await assert.rejects(
      restarted.saveUpload(token.token, Buffer.from(Other)),
      FileConflictError,
    );
    assert.equal(await restarted.getFileMetadata(StageKey), null);
  });

  it("rejects a PUT paused before consumption after another process promotes and deletes the source", async () => {
    const token = await upload();
    const pending = worker({
      token: token.token,
      barrier: `consumed/${token.token}.json`,
      body: Other,
    });
    await pending.ready;
    await manager.saveUpload(token.token, Buffer.from(First));
    await manager.promoteFile(StageKey);
    pending.child.send("continue");
    assert.equal((await pending.result).code, "FILE_CONFLICT");
    assert.equal(await manager.fileExists(StageKey), false);
    assert.equal(
      await fs.readFile(manager.getFilePath(FinalKey), "utf8"),
      First,
    );
  });

  it("retains consumed evidence until URL expiry and then cleans it with the token", async () => {
    const token = await seed();
    const consumed = join(
      root,
      "tokens",
      "upload",
      "consumed",
      `${token.token}.json`,
    );
    await manager.deleteFile(StageKey);
    await manager.deleteFileMetadata(StageKey);
    await manager.cleanupExpiredTokens();
    await fs.access(consumed);
    const now = Date.now;
    Date.now = () => token.expiresAt + 1;
    try {
      await manager.cleanupExpiredTokens();
      assert.equal(await manager.getUploadToken(token.token), null);
      await assert.rejects(fs.access(consumed));
    } finally {
      Date.now = now;
    }
  });

  it("preserves published bytes when the upload acknowledgement is lost", async () => {
    const token = await upload();
    const pending = worker({
      token: token.token,
      barrier: StageKey,
      afterLink: true,
    });
    await pending.ready;
    await crash(pending.child);
    manager = new TokenManager(root);
    assert.equal(
      (await manager.getFileMetadata(StageKey))?.visibility,
      "private",
    );
    await assert.rejects(
      manager.saveUpload(token.token, Buffer.from(Other)),
      FileConflictError,
    );
    assert.equal(
      await fs.readFile(manager.getFilePath(StageKey), "utf8"),
      First,
    );
  });
});

describe("durable promotion publication", () => {
  setup();

  it("rejects an incomplete promotion after process death without deleting the source", async () => {
    await seed();
    const pending = worker({
      operation: "promote",
      barrier: `/files/${FinalKey}`,
    });
    await pending.ready;
    await crash(pending.child);
    manager = new TokenManager(root);
    assert.equal(await manager.getFileMetadata(FinalKey), null);
    await assert.rejects(manager.promoteFile(StageKey), FileConflictError);
    assert.equal(
      await fs.readFile(manager.getFilePath(StageKey), "utf8"),
      First,
    );
  });

  it("reconciles lost promotion acknowledgement using complete trusted provenance with source gone", async () => {
    await seed();
    const pending = worker({
      operation: "promote",
      barrier: `/files/${FinalKey}`,
      afterLink: true,
    });
    await pending.ready;
    await crash(pending.child);
    await manager.deleteFile(StageKey);
    await manager.deleteFileMetadata(StageKey);
    manager = new TokenManager(root);
    assert.equal(await manager.promoteFile(StageKey), FinalKey);
    assert.equal(
      (await manager.getFileMetadata(FinalKey))?.visibility,
      "private",
    );
    assert.equal(
      await fs.readFile(manager.getFilePath(FinalKey), "utf8"),
      First,
    );
  });

  it("does not let an incomplete same-source competitor clean up the winner", async () => {
    const token = await seed();
    const pending = worker({
      operation: "promote",
      barrier: `/files/${FinalKey}`,
    });
    await pending.ready;
    await assert.rejects(manager.promoteFile(StageKey), FileConflictError);
    assert.equal(await manager.fileExists(StageKey), true);
    pending.child.send("continue");
    assert.equal((await pending.result).status, "done");
    assert.equal(await manager.promoteFile(StageKey), FinalKey);
    await assert.rejects(
      manager.saveUpload(token.token, Buffer.from(Other)),
      FileConflictError,
    );
    assert.equal(
      await fs.readFile(manager.getFilePath(FinalKey), "utf8"),
      First,
    );
    assert.equal(await manager.fileExists(StageKey), false);
  });

  it("rejects foreign bytes and missing, foreign or corrupt destination provenance", async () => {
    await seed();
    await fs.writeFile(manager.getFilePath(FinalKey), Other);
    await assert.rejects(manager.promoteFile(StageKey), FileConflictError);
    await manager.saveFileMetadata({
      resourceKey: FinalKey,
      size: Other.length,
      mimetype: Mime,
      lastModified: Date.now(),
      metadata: { promotionSource: StageKey },
    });
    await assert.rejects(manager.promoteFile(StageKey), FileConflictError);
    await fs.writeFile(join(root, "metadata", `${FinalKey}.json`), "{");
    await assert.rejects(manager.promoteFile(StageKey), FileConflictError);
    assert.equal(
      await fs.readFile(manager.getFilePath(FinalKey), "utf8"),
      Other,
    );
    assert.equal(
      await fs.readFile(manager.getFilePath(StageKey), "utf8"),
      First,
    );
  });
});

describe("directory durability across platforms", () => {
  setup();

  it("keeps storage initialization working where directory fsync is unsupported", async () => {
    for (const code of UnsupportedSyncCodes) {
      const storage = join(root, "unsupported", code);
      await asPlatform(WindowsPlatform, () =>
        withFailingDirectorySync(code, async () => {
          await new TokenManager(storage).initialize();
          await syncDirectory(storage);
        }),
      );
      assert.equal((await fs.stat(join(storage, "files"))).isDirectory(), true);
    }
  });

  it("still surfaces real storage failures during directory fsync", async () => {
    for (const code of FatalSyncCodes) {
      await asPlatform(WindowsPlatform, () =>
        withFailingDirectorySync(code, async () => {
          await assert.rejects(syncDirectory(root), { code });
        }),
      );
    }
  });

  it("keeps every directory fsync failure fatal on posix platforms", async () => {
    for (const code of [...UnsupportedSyncCodes, ...FatalSyncCodes]) {
      await asPlatform(PosixPlatform, () =>
        withFailingDirectorySync(code, async () => {
          await assert.rejects(ensureDirectory(join(root, "posix", code)), {
            code,
          });
        }),
      );
    }
  });
});
