import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { fork, type ChildProcess } from "node:child_process";
import {
  FileConflictError,
  STAGING_PREFIX,
} from "@antelopejs/interface-file-storage";

import {
  ensureDirectory,
  pathExists,
  syncDirectory,
} from "../storage/publication";
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
const ExtendedLengthPrefix = "\\\\?\\";
const EnsureDirectoryTimeout = 2_000;
const ReadOnlyOpenMode = "r";
const DriveLetterPattern = /^([a-z]):/i;
const StorageDirectories = [
  "files",
  "metadata",
  join("tokens", "upload"),
  join("tokens", "read"),
];
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

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  const expired = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms} ms`)),
      ms,
    );
    const stop = () => clearTimeout(timer);
    work.then(stop, stop);
  });
  return Promise.race([work, expired]);
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

function permissionError(syscall: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `EPERM: operation not permitted, ${syscall}`,
  );
  error.code = "EPERM";
  return error;
}

async function withWindowsFileFlushRules(
  run: () => Promise<void>,
): Promise<void> {
  const readOnlyHandles = new WeakSet<FileHandle>();
  const originalOpen = fs.open;
  const trackReadOnly = async (
    ...args: Parameters<typeof fs.open>
  ): Promise<FileHandle> => {
    const handle = await originalOpen(...args);
    if ((args[1] ?? ReadOnlyOpenMode) === ReadOnlyOpenMode)
      readOnlyHandles.add(handle);
    return handle;
  };
  const probe = await originalOpen(root, ReadOnlyOpenMode);
  const prototype = Object.getPrototypeOf(probe) as SyncableHandle;
  await probe.close();
  const originalSync = prototype.sync;
  prototype.sync = async function (this: FileHandle): Promise<void> {
    if (readOnlyHandles.has(this) && (await this.stat()).isFile())
      throw permissionError("fsync");
    return originalSync.call(this);
  };
  fs.open = trackReadOnly as typeof fs.open;
  try {
    await run();
  } finally {
    fs.open = originalOpen;
    prototype.sync = originalSync;
  }
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

function administrativeSharePath(path: string): string | null {
  const drive = DriveLetterPattern.exec(path);
  if (process.platform !== WindowsPlatform || !drive) return null;
  return `\\\\localhost\\${drive[1]}$${path.slice(drive[0].length)}`;
}

async function recordOpenedPaths(run: () => Promise<void>): Promise<string[]> {
  const opened: string[] = [];
  const originalOpen = fs.open;
  const recordOpen = (...args: Parameters<typeof fs.open>) => {
    opened.push(String(args[0]));
    return originalOpen(...args);
  };
  fs.open = recordOpen as typeof fs.open;
  try {
    await run();
  } finally {
    fs.open = originalOpen;
  }
  return opened;
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

  it("flushes staged bytes through a handle Windows accepts for fsync", async () => {
    await seed();
    await withWindowsFileFlushRules(async () => {
      assert.equal(await manager.promoteFile(StageKey), FinalKey);
    });
    assert.equal(
      await fs.readFile(manager.getFilePath(FinalKey), "utf8"),
      First,
    );
    assert.equal(await manager.fileExists(StageKey), false);
  });
});

describe("moving files over an existing destination", () => {
  setup();

  async function seedDestination(): Promise<string> {
    await seed();
    const destination = manager.getFilePath(FinalKey);
    await fs.writeFile(destination, Other);
    return destination;
  }

  it("replaces a destination that a download still holds open", async () => {
    const destination = await seedDestination();
    const download = await fs.open(destination, ReadOnlyOpenMode);
    try {
      await manager.moveFile(StageKey, FinalKey);
    } finally {
      await download.close();
    }
    assert.equal(await fs.readFile(destination, "utf8"), First);
    assert.equal(await manager.fileExists(StageKey), false);
  });

  it("replaces a destination Windows refuses to rename over", async () => {
    const destination = await seedDestination();
    await asPlatform(WindowsPlatform, () =>
      withRenameBlockedByDestination(() =>
        manager.moveFile(StageKey, FinalKey),
      ),
    );
    assert.equal(await fs.readFile(destination, "utf8"), First);
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
    assert.equal(await fs.readFile(destination, "utf8"), Other);
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

  it("stops at the created directory when mkdir reports an extended-length path", async () => {
    const target = join(root, "extended", "nested");
    const original = fs.mkdir;
    const reportExtendedPath = async (
      ...args: Parameters<typeof fs.mkdir>
    ): Promise<string | undefined> => {
      const created = await original(...args);
      return created && `${ExtendedLengthPrefix}${created}`;
    };
    fs.mkdir = reportExtendedPath as typeof fs.mkdir;
    try {
      await withTimeout(ensureDirectory(target), EnsureDirectoryTimeout);
    } finally {
      fs.mkdir = original;
    }
    assert.ok((await fs.stat(target)).isDirectory());
  });

  it("initializes an empty storage root with the real filesystem", async () => {
    const storage = join(root, "fresh", "storage");
    await withTimeout(
      new TokenManager(storage).initialize(),
      EnsureDirectoryTimeout,
    );
    for (const directory of StorageDirectories)
      assert.ok((await fs.stat(join(storage, directory))).isDirectory());
  });

  it("stops at the created directory on a UNC share", async function () {
    const share = administrativeSharePath(root);
    if (!share || !(await pathExists(share))) return this.skip();
    const target = join(share, "unc", "nested");
    const opened = await recordOpenedPaths(() =>
      withTimeout(ensureDirectory(target), EnsureDirectoryTimeout),
    );
    const prefix = share.toLowerCase();
    assert.deepEqual(
      opened.filter((path) => !path.toLowerCase().startsWith(prefix)),
      [],
    );
    assert.ok((await fs.stat(target)).isDirectory());
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
