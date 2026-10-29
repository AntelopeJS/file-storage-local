import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

export const WindowsPlatform = "win32";
export const PosixPlatform = "linux";
const PlatformProperty = "platform";
const ReadOnlyOpenMode = "r";

export interface SyncableHandle {
  sync: () => Promise<void>;
}

export async function asPlatform(
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

export function permissionError(syscall: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(
    `EPERM: operation not permitted, ${syscall}`,
  );
  error.code = "EPERM";
  return error;
}

function isSyncableHandle(value: unknown): value is SyncableHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "sync" in value &&
    typeof value.sync === "function"
  );
}

export async function fileHandlePrototype(): Promise<SyncableHandle> {
  const probe = await fs.open(__filename, ReadOnlyOpenMode);
  const prototype: unknown = Object.getPrototypeOf(probe);
  await probe.close();
  if (!isSyncableHandle(prototype))
    throw new Error("File handles have no sync method to replace");
  return prototype;
}

export async function withWindowsFileFlushRules(
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
  const prototype = await fileHandlePrototype();
  const originalSync = prototype.sync;
  prototype.sync = async function (this: FileHandle): Promise<void> {
    if (readOnlyHandles.has(this) && (await this.stat()).isFile())
      throw permissionError("fsync");
    return originalSync.call(this);
  };
  fs.open = trackReadOnly;
  try {
    await run();
  } finally {
    fs.open = originalOpen;
    prototype.sync = originalSync;
  }
}
