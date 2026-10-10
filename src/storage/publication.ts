import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

const WindowsPlatform = "win32";
const ExtendedLengthPrefix = /^\\\\\?\\/;
const UnsupportedDirectorySyncCodes = new Set([
  "EPERM",
  "EACCES",
  "EINVAL",
  "ENOTSUP",
  "EISDIR",
]);

export async function ensureDirectory(path: string): Promise<void> {
  const created = await fs.mkdir(path, { recursive: true });
  if (!created) return;
  const topmost = comparablePath(created);
  let current = resolve(path);
  while (true) {
    await syncDirectory(current);
    const parent = dirname(current);
    if (comparablePath(current) === topmost || parent === current) {
      await syncDirectory(parent);
      return;
    }
    current = parent;
  }
}

function comparablePath(path: string): string {
  const resolved = resolve(path.replace(ExtendedLengthPrefix, ""));
  return process.platform === WindowsPlatform
    ? resolved.toLowerCase()
    : resolved;
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await fs.open(path, "r");
  try {
    await directory.sync();
  } catch (error: unknown) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    await directory.close();
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  if (process.platform !== WindowsPlatform) return false;
  const code = errorCode(error);
  return code !== undefined && UnsupportedDirectorySyncCodes.has(code);
}

export async function prepareFile(
  path: string,
  data: Uint8Array | string,
): Promise<string> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
    return temporary;
  } catch (error: unknown) {
    await removeFile(temporary);
    throw error;
  } finally {
    await handle.close();
  }
}

export async function publishFile(
  temporary: string,
  destination: string,
): Promise<void> {
  await fs.link(temporary, destination);
  await syncDirectory(dirname(destination));
}

export async function publishJson(path: string, value: unknown): Promise<void> {
  const temporary = await prepareFile(path, JSON.stringify(value));
  try {
    await publishFile(temporary, path);
  } finally {
    await removeFile(temporary);
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function hasCode(error: unknown, code: string): boolean {
  return errorCode(error) === code;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch (error: unknown) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

export async function removeFile(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error: unknown) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}
