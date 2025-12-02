import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Visibility } from '@ajs.local/file-storage/beta';

/**
 * Upload token data stored in filesystem
 */
export interface UploadToken {
  token: string;
  resourceKey: string;
  mimetype: string;
  size: number;
  expiresAt: number;
  visibility: Visibility;
  metadata?: Record<string, string>;
}

/**
 * Read token data stored in filesystem
 */
export interface ReadToken {
  token: string;
  resourceKey: string;
  expiresAt: number;
}

/**
 * File metadata stored in filesystem
 */
export interface StoredFileMetadata {
  resourceKey: string;
  mimetype: string;
  size: number;
  lastModified: number;
  visibility: Visibility;
  metadata?: Record<string, string>;
}

/**
 * Manages tokens and metadata via local filesystem.
 *
 * WARNING: This module is NOT compatible with clustering/multi-instance deployments.
 * All data is stored on the local filesystem and is not shared between instances.
 * For production multi-instance deployments, use file-storage-s3 instead.
 */
export class TokenManager {
  private readonly basePath: string;
  private readonly filesPath: string;
  private readonly metadataPath: string;
  private readonly uploadTokensPath: string;
  private readonly readTokensPath: string;

  constructor(storagePath: string) {
    this.basePath = storagePath;
    this.filesPath = join(storagePath, 'files');
    this.metadataPath = join(storagePath, 'metadata');
    this.uploadTokensPath = join(storagePath, 'tokens', 'upload');
    this.readTokensPath = join(storagePath, 'tokens', 'read');
  }

  /**
   * Initialize storage directories
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.filesPath, { recursive: true });
    await fs.mkdir(this.metadataPath, { recursive: true });
    await fs.mkdir(this.uploadTokensPath, { recursive: true });
    await fs.mkdir(this.readTokensPath, { recursive: true });
  }

  /**
   * Generate a unique token
   */
  generateToken(): string {
    return randomUUID();
  }

  /**
   * Generate a unique resource key with optional path prefix
   */
  generateResourceKey(filename: string, path?: string): string {
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
    const uuid = randomUUID();
    const prefix = path ? `${path.replace(/^\/|\/$/g, '')}/` : '';
    return `${prefix}${uuid}${ext}`;
  }

  // ============ Upload Tokens ============

  /**
   * Create and store an upload token
   */
  async createUploadToken(
    resourceKey: string,
    mimetype: string,
    size: number,
    expiresAt: number,
    visibility: Visibility,
    metadata?: Record<string, string>,
  ): Promise<UploadToken> {
    const token = this.generateToken();
    const data: UploadToken = {
      token,
      resourceKey,
      mimetype,
      size,
      expiresAt,
      visibility,
      metadata,
    };

    const tokenPath = join(this.uploadTokensPath, `${token}.json`);
    await fs.writeFile(tokenPath, JSON.stringify(data, null, 2));

    return data;
  }

  /**
   * Get an upload token by its ID
   */
  async getUploadToken(token: string): Promise<UploadToken | null> {
    try {
      const tokenPath = join(this.uploadTokensPath, `${token}.json`);
      const content = await fs.readFile(tokenPath, 'utf-8');
      return JSON.parse(content) as UploadToken;
    } catch {
      return null;
    }
  }

  /**
   * Delete an upload token
   */
  async deleteUploadToken(token: string): Promise<void> {
    try {
      const tokenPath = join(this.uploadTokensPath, `${token}.json`);
      await fs.unlink(tokenPath);
    } catch {
      // Ignore if token doesn't exist
    }
  }

  // ============ Read Tokens ============

  /**
   * Create and store a read token
   */
  async createReadToken(resourceKey: string, expiresAt: number): Promise<ReadToken> {
    const token = this.generateToken();
    const data: ReadToken = {
      token,
      resourceKey,
      expiresAt,
    };

    const tokenPath = join(this.readTokensPath, `${token}.json`);
    await fs.writeFile(tokenPath, JSON.stringify(data, null, 2));

    return data;
  }

  /**
   * Get a read token by its ID
   */
  async getReadToken(token: string): Promise<ReadToken | null> {
    try {
      const tokenPath = join(this.readTokensPath, `${token}.json`);
      const content = await fs.readFile(tokenPath, 'utf-8');
      return JSON.parse(content) as ReadToken;
    } catch {
      return null;
    }
  }

  /**
   * Delete a read token
   */
  async deleteReadToken(token: string): Promise<void> {
    try {
      const tokenPath = join(this.readTokensPath, `${token}.json`);
      await fs.unlink(tokenPath);
    } catch {
      // Ignore if token doesn't exist
    }
  }

  // ============ File Metadata ============

  /**
   * Store file metadata
   */
  async saveFileMetadata(metadata: StoredFileMetadata): Promise<void> {
    // Handle nested paths by creating directories
    const metadataFilePath = join(this.metadataPath, `${metadata.resourceKey}.json`);
    const dir = metadataFilePath.substring(0, metadataFilePath.lastIndexOf('/'));
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(metadataFilePath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(resourceKey: string): Promise<StoredFileMetadata | null> {
    try {
      const metadataFilePath = join(this.metadataPath, `${resourceKey}.json`);
      const content = await fs.readFile(metadataFilePath, 'utf-8');
      return JSON.parse(content) as StoredFileMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Delete file metadata
   */
  async deleteFileMetadata(resourceKey: string): Promise<void> {
    try {
      const metadataFilePath = join(this.metadataPath, `${resourceKey}.json`);
      await fs.unlink(metadataFilePath);
    } catch {
      // Ignore if metadata doesn't exist
    }
  }

  // ============ Files ============

  /**
   * Get the full path to a file
   */
  getFilePath(resourceKey: string): string {
    return join(this.filesPath, resourceKey);
  }

  /**
   * Check if a file exists
   */
  async fileExists(resourceKey: string): Promise<boolean> {
    try {
      await fs.access(this.getFilePath(resourceKey));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(resourceKey: string): Promise<void> {
    try {
      await fs.unlink(this.getFilePath(resourceKey));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Ensure the directory for a file exists
   */
  async ensureFileDirectory(resourceKey: string): Promise<void> {
    const filePath = this.getFilePath(resourceKey);
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await fs.mkdir(dir, { recursive: true });
  }

  // ============ Cleanup ============

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<{ uploadTokens: number; readTokens: number }> {
    const now = Date.now();
    let uploadTokens = 0;
    let readTokens = 0;

    // Cleanup upload tokens
    try {
      const uploadFiles = await fs.readdir(this.uploadTokensPath);
      for (const file of uploadFiles) {
        if (!file.endsWith('.json')) continue;
        try {
          const tokenPath = join(this.uploadTokensPath, file);
          const content = await fs.readFile(tokenPath, 'utf-8');
          const token = JSON.parse(content) as UploadToken;
          if (token.expiresAt < now) {
            await fs.unlink(tokenPath);
            uploadTokens++;
          }
        } catch {
          // Ignore errors for individual files
        }
      }
    } catch {
      // Directory might not exist yet
    }

    // Cleanup read tokens
    try {
      const readFiles = await fs.readdir(this.readTokensPath);
      for (const file of readFiles) {
        if (!file.endsWith('.json')) continue;
        try {
          const tokenPath = join(this.readTokensPath, file);
          const content = await fs.readFile(tokenPath, 'utf-8');
          const token = JSON.parse(content) as ReadToken;
          if (token.expiresAt < now) {
            await fs.unlink(tokenPath);
            readTokens++;
          }
        } catch {
          // Ignore errors for individual files
        }
      }
    } catch {
      // Directory might not exist yet
    }

    return { uploadTokens, readTokens };
  }
}
