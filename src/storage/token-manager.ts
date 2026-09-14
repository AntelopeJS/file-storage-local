import { randomUUID } from "node:crypto";
import { type Dirent, promises as fs } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import {
  FileConflictError,
  FileNotFoundError,
  isStagedKey,
  STAGING_PREFIX,
  toStagedKey,
  UploadValidationError,
  type Visibility,
} from "@antelopejs/interface-file-storage";

import { promoteFile } from "./promotion";
import {
  ensureDirectory,
  hasCode,
  pathExists,
  prepareFile,
  publishFile,
  publishJson,
  removeFile,
} from "./publication";

const FilesDirectory = "files";
const MetadataDirectory = "metadata";
const TokensDirectory = "tokens";
const UploadTokensDirectory = "upload";
const ReadTokensDirectory = "read";
const ConsumedTokensDirectory = "consumed";
const JsonFileSuffix = ".json";
const PathTrimRegex = /^\/|\/$/g;
const DotCharacter = ".";
const TokenIdentifierPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface UploadToken {
  token: string;
  resourceKey: string;
  path?: string;
  mimetype: string;
  size: number;
  expiresAt: number;
  metadata?: Record<string, string>;
  visibility?: Visibility;
}

export interface ReadToken {
  token: string;
  resourceKey: string;
  expiresAt: number;
}

export interface StoredFileMetadata {
  resourceKey: string;
  path?: string;
  mimetype: string;
  size: number;
  lastModified: number;
  metadata?: Record<string, string>;
  visibility?: Visibility;
  promotionSource?: string;
}

export interface TokenCleanupResult {
  uploadTokens: number;
  readTokens: number;
}

export class TokenManager {
  private readonly storagePath: string;
  private readonly filesPath: string;
  private readonly metadataPath: string;
  private readonly stagingFilesPath: string;
  private readonly uploadTokensPath: string;
  private readonly readTokensPath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.filesPath = join(storagePath, FilesDirectory);
    this.metadataPath = join(storagePath, MetadataDirectory);
    this.stagingFilesPath = join(storagePath, STAGING_PREFIX);
    this.uploadTokensPath = join(
      storagePath,
      TokensDirectory,
      UploadTokensDirectory,
    );
    this.readTokensPath = join(
      storagePath,
      TokensDirectory,
      ReadTokensDirectory,
    );
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDirectory(this.filesPath),
      ensureDirectory(this.metadataPath),
      ensureDirectory(this.uploadTokensPath),
      ensureDirectory(this.readTokensPath),
    ]);
  }

  generateToken(): string {
    return randomUUID();
  }

  generateResourceKey(filename: string): string {
    return `${randomUUID()}${extractFileExtension(filename)}`;
  }

  toStagedResourceKey(baseKey: string, path?: string): string {
    const normalizedPath = normalizePath(path);
    const inner = normalizedPath ? `${normalizedPath}/${baseKey}` : baseKey;
    return toStagedKey(inner);
  }

  async createUploadToken(
    resourceKey: string,
    mimetype: string,
    size: number,
    expiresAt: number,
    metadata?: Record<string, string>,
    path?: string,
    visibility?: Visibility,
  ): Promise<UploadToken> {
    const data: UploadToken = {
      token: this.generateToken(),
      resourceKey,
      mimetype,
      size,
      expiresAt,
    };
    if (metadata) {
      data.metadata = metadata;
    }
    if (path) {
      data.path = path;
    }
    if (visibility) {
      data.visibility = visibility;
    }
    await this.writeJsonFile(this.getUploadTokenPath(data.token), data);
    return data;
  }

  async getUploadToken(token: string): Promise<UploadToken | null> {
    return this.readToken<UploadToken>(token, this.getUploadTokenPath(token));
  }

  async deleteUploadToken(token: string): Promise<void> {
    if (!TokenIdentifierPattern.test(token)) return;
    await this.unlinkIfExists(this.getUploadTokenPath(token));
  }

  async saveUpload(token: string, body: Buffer): Promise<void> {
    const upload = await this.getUploadToken(token);
    if (!upload || upload.expiresAt < Date.now())
      throw new FileNotFoundError(token);
    if (await pathExists(this.consumedTokenPath(token)))
      throw new FileConflictError(upload.resourceKey);
    if (body.length !== upload.size) {
      throw new UploadValidationError("Body size mismatch", "SIZE_EXCEEDED");
    }
    const destination = this.getFilePath(upload.resourceKey, upload.path);
    const temporary = await prepareFile(destination, body);
    try {
      await this.consumeUpload(upload);
      if (await pathExists(destination))
        throw new FileConflictError(upload.resourceKey);
      await publishJson(
        this.getMetadataPath(upload.resourceKey),
        this.uploadMetadata(upload),
      );
      await publishFile(temporary, destination);
    } catch (error: unknown) {
      if (hasCode(error, "EEXIST"))
        throw new FileConflictError(upload.resourceKey);
      throw error;
    } finally {
      await removeFile(temporary);
    }
  }

  private async consumeUpload(upload: UploadToken): Promise<void> {
    if (upload.expiresAt < Date.now())
      throw new FileNotFoundError(upload.resourceKey);
    await publishJson(this.consumedTokenPath(upload.token), upload);
    if (upload.expiresAt < Date.now())
      throw new FileNotFoundError(upload.resourceKey);
  }

  private consumedTokenPath(token: string): string {
    return join(
      this.uploadTokensPath,
      ConsumedTokensDirectory,
      `${token}${JsonFileSuffix}`,
    );
  }

  private uploadMetadata(upload: UploadToken): StoredFileMetadata {
    const { token: _token, expiresAt: _expiresAt, ...metadata } = upload;
    return { ...metadata, lastModified: Date.now() };
  }

  async createReadToken(
    resourceKey: string,
    expiresAt: number,
  ): Promise<ReadToken> {
    const data: ReadToken = {
      token: this.generateToken(),
      resourceKey,
      expiresAt,
    };
    await this.writeJsonFile(this.getReadTokenPath(data.token), data);
    return data;
  }

  async getReadToken(token: string): Promise<ReadToken | null> {
    return this.readToken<ReadToken>(token, this.getReadTokenPath(token));
  }

  async deleteReadToken(token: string): Promise<void> {
    if (!TokenIdentifierPattern.test(token)) return;
    await this.unlinkIfExists(this.getReadTokenPath(token));
  }

  async saveFileMetadata(metadata: StoredFileMetadata): Promise<void> {
    const metadataFilePath = this.getMetadataPath(metadata.resourceKey);
    await fs.mkdir(dirname(metadataFilePath), { recursive: true });
    await this.writeJsonFile(metadataFilePath, metadata);
  }

  async getFileMetadata(
    resourceKey: string,
  ): Promise<StoredFileMetadata | null> {
    const metadata = await this.readJsonFile<StoredFileMetadata>(
      this.getMetadataPath(resourceKey),
    );
    if (!metadata || !(await this.fileExists(resourceKey, metadata.path)))
      return null;
    return metadata;
  }

  async deleteFileMetadata(resourceKey: string): Promise<void> {
    await this.unlinkIfExists(this.getMetadataPath(resourceKey));
  }

  getFilePath(resourceKey: string, path?: string): string {
    if (isStagedKey(resourceKey)) {
      return join(this.storagePath, resourceKey);
    }
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
      return join(this.filesPath, resourceKey);
    }
    return join(this.filesPath, normalizedPath, resourceKey);
  }

  async fileExists(resourceKey: string, path?: string): Promise<boolean> {
    try {
      await fs.access(this.getFilePath(resourceKey, path));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(resourceKey: string, path?: string): Promise<void> {
    await this.unlinkIfExists(this.getFilePath(resourceKey, path));
  }

  async ensureFileDirectory(resourceKey: string, path?: string): Promise<void> {
    const filePath = this.getFilePath(resourceKey, path);
    await fs.mkdir(dirname(filePath), { recursive: true });
  }

  async promoteFile(sourceKey: string): Promise<string> {
    return promoteFile(this, this.metadataPath, sourceKey);
  }

  async moveFile(sourceKey: string, destKey: string): Promise<void> {
    if (sourceKey === destKey) {
      return;
    }
    const sourceMetadata = await this.getFileMetadata(sourceKey);
    if (!(await this.fileExists(sourceKey, sourceMetadata?.path))) {
      return;
    }
    const sourceFilePath = this.getFilePath(sourceKey, sourceMetadata?.path);
    const destFilePath = this.getFilePath(destKey);
    await fs.mkdir(dirname(destFilePath), { recursive: true });
    await fs.rename(sourceFilePath, destFilePath);
    await this.relocateMetadata(sourceKey, destKey, sourceMetadata);
  }

  private async relocateMetadata(
    sourceKey: string,
    destKey: string,
    sourceMetadata: StoredFileMetadata | null,
  ): Promise<void> {
    if (!sourceMetadata) {
      return;
    }
    const destMetadata: StoredFileMetadata = {
      resourceKey: destKey,
      mimetype: sourceMetadata.mimetype,
      size: sourceMetadata.size,
      lastModified: sourceMetadata.lastModified,
    };
    if (sourceMetadata.metadata) {
      destMetadata.metadata = sourceMetadata.metadata;
    }
    if (sourceMetadata.visibility) {
      destMetadata.visibility = sourceMetadata.visibility;
    }
    await this.saveFileMetadata(destMetadata);
    await this.deleteFileMetadata(sourceKey);
  }

  async cleanupExpiredTokens(): Promise<TokenCleanupResult> {
    const now = Date.now();
    const uploadTokens = await this.cleanupExpiredTokenDirectory(
      this.uploadTokensPath,
      now,
    );
    const readTokens = await this.cleanupExpiredTokenDirectory(
      this.readTokensPath,
      now,
    );
    await this.cleanupExpiredTokenDirectory(
      join(this.uploadTokensPath, ConsumedTokensDirectory),
      now,
    );
    return { uploadTokens, readTokens };
  }

  async cleanupExpiredStagingFiles(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    return this.removeExpiredStagedEntries(this.stagingFilesPath, cutoff);
  }

  private async removeExpiredStagedEntries(
    directory: string,
    cutoff: number,
  ): Promise<number> {
    const entries = await this.readDirEntries(directory);
    let removed = 0;
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        removed += await this.removeExpiredStagedEntries(entryPath, cutoff);
        continue;
      }
      if (await this.isOlderThan(entryPath, cutoff)) {
        await this.unlinkIfExists(entryPath);
        await this.deleteFileMetadata(this.resourceKeyFromFilePath(entryPath));
        removed++;
      }
    }
    return removed;
  }

  private resourceKeyFromFilePath(filePath: string): string {
    return relative(this.storagePath, filePath).split(sep).join("/");
  }

  private async readDirEntries(directory: string): Promise<Dirent[]> {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async isOlderThan(path: string, cutoff: number): Promise<boolean> {
    try {
      const stats = await fs.stat(path);
      return stats.mtimeMs < cutoff;
    } catch {
      return false;
    }
  }

  private getUploadTokenPath(token: string): string {
    return join(this.uploadTokensPath, `${token}${JsonFileSuffix}`);
  }

  private getReadTokenPath(token: string): string {
    return join(this.readTokensPath, `${token}${JsonFileSuffix}`);
  }

  private getMetadataPath(resourceKey: string): string {
    return join(this.metadataPath, `${resourceKey}${JsonFileSuffix}`);
  }

  private async readToken<T extends ReadToken>(
    token: string,
    path: string,
  ): Promise<T | null> {
    if (!TokenIdentifierPattern.test(token)) return null;
    const data = await this.readJsonFile<T>(path);
    if (
      data?.token !== token ||
      typeof data.resourceKey !== "string" ||
      !Number.isFinite(data.expiresAt)
    )
      return null;
    return data;
  }

  private async cleanupExpiredTokenDirectory(
    path: string,
    now: number,
  ): Promise<number> {
    let removedTokens = 0;
    const tokenFiles = await this.readDirectory(path);
    for (const file of tokenFiles) {
      if (!file.endsWith(JsonFileSuffix)) {
        continue;
      }
      const tokenPath = join(path, file);
      const tokenData = await this.readJsonFile<{ expiresAt: number }>(
        tokenPath,
      );
      if (!tokenData || tokenData.expiresAt >= now) {
        continue;
      }
      await this.unlinkIfExists(tokenPath);
      removedTokens++;
    }
    return removedTokens;
  }

  private async readDirectory(path: string): Promise<string[]> {
    try {
      return await fs.readdir(path);
    } catch {
      return [];
    }
  }

  private async readJsonFile<T>(path: string): Promise<T | null> {
    try {
      const content = await fs.readFile(path, "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  private async writeJsonFile(path: string, data: unknown): Promise<void> {
    await fs.writeFile(path, JSON.stringify(data, null, 2));
  }

  private async unlinkIfExists(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch {
      return;
    }
  }
}

function extractFileExtension(filename: string): string {
  if (!filename.includes(DotCharacter)) {
    return "";
  }
  const extension = filename.split(DotCharacter).pop();
  if (!extension) {
    return "";
  }
  return `${DotCharacter}${extension}`;
}

function normalizePath(path?: string): string {
  if (!path) {
    return "";
  }
  return path.replace(PathTrimRegex, "");
}
