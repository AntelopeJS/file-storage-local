import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

import type { StoredFileMetadata, UploadToken } from "./token-manager";

const WindowsPlatform = "win32";
const NamespacePrefixes: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\\\\\?\\UNC\\/i, "\\\\"],
  [/^\\\\\?\\/, ""],
];
const UnsupportedDirectorySyncCodes = new Set([
  "EPERM",
  "EACCES",
  "EINVAL",
  "ENOTSUP",
  "EISDIR",
]);
const BlockedReplaceCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

/** A Node.js system error that carries the string `code` of its failure. */
type CodedError<Code extends string> = Error & { code: Code };

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

function stripNamespacePrefix(path: string): string {
  const match = NamespacePrefixes.find(([prefix]) => prefix.test(path));
  return match ? path.replace(match[0], match[1]) : path;
}

function comparablePath(path: string): string {
  const resolved = resolve(stripNamespacePrefix(path));
  return process.platform === WindowsPlatform
    ? resolved.toLowerCase()
    : resolved;
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await fs.open(path, "r");
  try {
    await directory.sync();
  } catch (error: unknown) {
    if (
      !isCodedError(error) ||
      !isWindowsErrorCode(error.code, UnsupportedDirectorySyncCodes)
    )
      throw error;
  } finally {
    await directory.close();
  }
}

function isWindowsErrorCode(code: string, codes: ReadonlySet<string>): boolean {
  return process.platform === WindowsPlatform && codes.has(code);
}

export async function replaceFile(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (error: unknown) {
    if (
      !isCodedError(error) ||
      !isWindowsErrorCode(error.code, BlockedReplaceCodes) ||
      !(await pathExists(destination))
    )
      throw error;
    await removeFile(destination);
    await fs.rename(source, destination);
  }
}

export async function prepareFile(
  path: string,
  data: string | Uint8Array | AsyncIterable<Uint8Array>,
): Promise<string> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx");
  try {
    await fs.writeFile(handle, data);
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

export async function publishJson(
  path: string,
  value: StoredFileMetadata | UploadToken,
): Promise<void> {
  const temporary = await prepareFile(path, JSON.stringify(value));
  try {
    await publishFile(temporary, path);
  } finally {
    await removeFile(temporary);
  }
}

function isCodedError(error: unknown): error is CodedError<string> {
  return (
    error instanceof Error && "code" in error && typeof error.code === "string"
  );
}

export function hasCode<Code extends string>(
  error: unknown,
  code: Code,
): error is CodedError<Code> {
  return isCodedError(error) && error.code === code;
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
