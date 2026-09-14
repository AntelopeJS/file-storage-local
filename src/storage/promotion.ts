import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import {
  FileConflictError,
  FileNotFoundError,
  isStagedKey,
  stripStagingPrefix,
} from "@antelopejs/interface-file-storage";

import type { StoredFileMetadata, TokenManager } from "./token-manager";
import {
  ensureDirectory,
  hasCode,
  pathExists,
  publishFile,
  publishJson,
  removeFile,
  syncDirectory,
} from "./publication";

const MetadataSuffix = ".json";

function destinationKey(sourceKey: string): string {
  const destination = stripStagingPrefix(sourceKey);
  if (
    !destination ||
    isStagedKey(destination) ||
    destination
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    destination.includes("\\")
  ) {
    throw new FileConflictError(sourceKey);
  }
  return destination;
}

async function readMetadata(
  path: string,
  resourceKey: string,
): Promise<StoredFileMetadata | null> {
  try {
    const metadata = JSON.parse(
      await fs.readFile(path, "utf8"),
    ) as StoredFileMetadata;
    if (
      !metadata ||
      metadata.resourceKey !== resourceKey ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0 ||
      typeof metadata.mimetype !== "string" ||
      !Number.isFinite(metadata.lastModified)
    )
      throw new FileConflictError(resourceKey);
    return metadata;
  } catch (error: unknown) {
    if (hasCode(error, "ENOENT")) return null;
    if (error instanceof SyntaxError) throw new FileConflictError(resourceKey);
    throw error;
  }
}

async function isComplete(
  manager: TokenManager,
  metadataPath: string,
  sourceKey: string,
  destination: string,
): Promise<boolean> {
  const destinationPath = manager.getFilePath(destination);
  const dataExists = await pathExists(destinationPath);
  const metadata = await readMetadata(metadataPath, destination);
  if (!metadata) {
    if (dataExists) throw new FileConflictError(destination);
    return false;
  }
  if (!dataExists || metadata.promotionSource !== sourceKey)
    throw new FileConflictError(destination);
  const stat = await fs.stat(destinationPath);
  if (!stat.isFile() || stat.size !== metadata.size)
    throw new FileConflictError(destination);
  await syncDirectory(dirname(metadataPath));
  await syncDirectory(dirname(destinationPath));
  return true;
}

async function publishData(
  manager: TokenManager,
  sourceKey: string,
  destination: string,
  source: StoredFileMetadata,
): Promise<void> {
  const sourcePath = manager.getFilePath(sourceKey, source.path);
  const destinationPath = manager.getFilePath(destination);
  await ensureDirectory(dirname(destinationPath));
  const handle = await fs.open(sourcePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== source.size)
      throw new FileConflictError(sourceKey);
    await handle.sync();
    await publishFile(sourcePath, destinationPath);
  } catch (error: unknown) {
    if (hasCode(error, "EEXIST")) throw new FileConflictError(destination);
    throw error;
  } finally {
    await handle.close();
  }
  await removeFile(sourcePath);
  await syncDirectory(dirname(sourcePath));
  await manager.deleteFileMetadata(sourceKey);
}

export async function promoteFile(
  manager: TokenManager,
  metadataRoot: string,
  sourceKey: string,
): Promise<string> {
  if (!isStagedKey(sourceKey)) return sourceKey;
  const destination = destinationKey(sourceKey);
  const metadataPath = join(metadataRoot, `${destination}${MetadataSuffix}`);
  if (await isComplete(manager, metadataPath, sourceKey, destination))
    return destination;
  const source = await readMetadata(
    join(metadataRoot, `${sourceKey}${MetadataSuffix}`),
    sourceKey,
  );
  if (
    !source ||
    !(await pathExists(manager.getFilePath(sourceKey, source.path)))
  )
    throw new FileNotFoundError(sourceKey);
  const metadata = {
    ...source,
    resourceKey: destination,
    promotionSource: sourceKey,
  };
  delete metadata.path;
  try {
    await publishJson(metadataPath, metadata);
  } catch (error: unknown) {
    if (!hasCode(error, "EEXIST")) throw error;
    if (await isComplete(manager, metadataPath, sourceKey, destination))
      return destination;
    throw new FileConflictError(destination);
  }
  await publishData(manager, sourceKey, destination, source);
  return destination;
}
