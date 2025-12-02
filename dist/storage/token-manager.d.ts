import { Visibility } from '@ajs.local/file-storage/beta';
export interface UploadToken {
    token: string;
    resourceKey: string;
    mimetype: string;
    size: number;
    expiresAt: number;
    visibility: Visibility;
    metadata?: Record<string, string>;
}
export interface ReadToken {
    token: string;
    resourceKey: string;
    expiresAt: number;
}
export interface StoredFileMetadata {
    resourceKey: string;
    mimetype: string;
    size: number;
    lastModified: number;
    visibility: Visibility;
    metadata?: Record<string, string>;
}
export declare class TokenManager {
    private readonly basePath;
    private readonly filesPath;
    private readonly metadataPath;
    private readonly uploadTokensPath;
    private readonly readTokensPath;
    constructor(storagePath: string);
    initialize(): Promise<void>;
    generateToken(): string;
    generateResourceKey(filename: string, path?: string): string;
    createUploadToken(resourceKey: string, mimetype: string, size: number, expiresAt: number, visibility: Visibility, metadata?: Record<string, string>): Promise<UploadToken>;
    getUploadToken(token: string): Promise<UploadToken | null>;
    deleteUploadToken(token: string): Promise<void>;
    createReadToken(resourceKey: string, expiresAt: number): Promise<ReadToken>;
    getReadToken(token: string): Promise<ReadToken | null>;
    deleteReadToken(token: string): Promise<void>;
    saveFileMetadata(metadata: StoredFileMetadata): Promise<void>;
    getFileMetadata(resourceKey: string): Promise<StoredFileMetadata | null>;
    deleteFileMetadata(resourceKey: string): Promise<void>;
    getFilePath(resourceKey: string): string;
    fileExists(resourceKey: string): Promise<boolean>;
    deleteFile(resourceKey: string): Promise<void>;
    ensureFileDirectory(resourceKey: string): Promise<void>;
    cleanupExpiredTokens(): Promise<{
        uploadTokens: number;
        readTokens: number;
    }>;
}
