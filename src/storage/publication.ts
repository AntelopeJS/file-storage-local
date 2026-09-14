import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function readRecord<T>(path: string): Promise<T | undefined> {
  try {
    const record: unknown = JSON.parse(await fs.readFile(path, "utf8"));
    if (!record || typeof record !== "object" || Array.isArray(record))
      throw new Error("Invalid durable record");
    return record as T;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeDurable(
  path: string,
  value: string | Uint8Array,
): Promise<void> {
  const handle = await fs.open(path, "wx");
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishRecord(
  path: string,
  value: unknown,
  replace = false,
): Promise<void> {
  const directory = dirname(path);
  const temporary = join(directory, `${randomUUID()}.tmp`);
  await writeDurable(temporary, JSON.stringify(value));
  try {
    if (replace) await fs.rename(temporary, path);
    else await fs.link(temporary, path);
    await syncDirectory(directory);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function createRecord<T>(path: string, value: T): Promise<T> {
  try {
    await publishRecord(path, value);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  }
  await syncDirectory(dirname(path));
  const stored = await readRecord<T>(path);
  if (!stored) throw new Error("Published record disappeared");
  return stored;
}
