import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

export async function ensureDirectory(path: string): Promise<void> {
  const created = await fs.mkdir(path, { recursive: true });
  if (!created) return;
  const parent = dirname(resolve(created));
  let current = resolve(path);
  while (current !== parent) {
    await syncDirectory(current);
    current = dirname(current);
  }
  await syncDirectory(parent);
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await fs.open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
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

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
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
