import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

const FilesDirectory = "files";
const MetadataDirectory = "metadata";
const TokensDirectory = "tokens";
const UploadTokensDirectory = "upload";
const ReadTokensDirectory = "read";
const JsonFileSuffix = ".json";
const PathTrimRegex = /^\/|\/$/g;
const DotCharacter = ".";

export interface UploadToken {
  token: string;
  resourceKey: string;
  path?: string;
  mimetype: string;
  size: number;
  expiresAt: number;
  metadata?: Record<string, string>;
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
}

export interface TokenCleanupResult {
  uploadTokens: number;
  readTokens: number;
}

export class TokenManager {
  private readonly filesPath: string;
  private readonly metadataPath: string;
  private readonly uploadTokensPath: string;
  private readonly readTokensPath: string;

  constructor(storagePath: string) {
    this.filesPath = join(storagePath, FilesDirectory);
    this.metadataPath = join(storagePath, MetadataDirectory);
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
      fs.mkdir(this.filesPath, { recursive: true }),
      fs.mkdir(this.metadataPath, { recursive: true }),
      fs.mkdir(this.uploadTokensPath, { recursive: true }),
      fs.mkdir(this.readTokensPath, { recursive: true }),
    ]);
  }

  generateToken(): string {
    return randomUUID();
  }

  generateResourceKey(filename: string): string {
    return `${randomUUID()}${extractFileExtension(filename)}`;
  }

  async createUploadToken(
    resourceKey: string,
    mimetype: string,
    size: number,
    expiresAt: number,
    metadata?: Record<string, string>,
    path?: string,
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
    await this.writeJsonFile(this.getUploadTokenPath(data.token), data);
    return data;
  }

  async getUploadToken(token: string): Promise<UploadToken | null> {
    return this.readJsonFile<UploadToken>(this.getUploadTokenPath(token));
  }

  async deleteUploadToken(token: string): Promise<void> {
    await this.unlinkIfExists(this.getUploadTokenPath(token));
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
    return this.readJsonFile<ReadToken>(this.getReadTokenPath(token));
  }

  async deleteReadToken(token: string): Promise<void> {
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
    return this.readJsonFile<StoredFileMetadata>(
      this.getMetadataPath(resourceKey),
    );
  }

  async deleteFileMetadata(resourceKey: string): Promise<void> {
    await this.unlinkIfExists(this.getMetadataPath(resourceKey));
  }

  getFilePath(resourceKey: string, path?: string): string {
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
    return { uploadTokens, readTokens };
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
