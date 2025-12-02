import { UploadRequest, UploadConstraints, PresignedUploadResponse, PresignedReadResponse, FileMetadata } from '@ajs.local/file-storage/beta';
export declare namespace internal {
    const createUploadUrl: (request: UploadRequest, constraints?: UploadConstraints, _storage?: string) => Promise<PresignedUploadResponse>;
    const createReadUrl: (resourceKey: string, expiresIn?: number, _storage?: string) => Promise<PresignedReadResponse>;
    const deleteFile: (resourceKey: string, _storage?: string) => Promise<void>;
    const fileExists: (resourceKey: string, _storage?: string) => Promise<boolean>;
    const getFileMetadata: (resourceKey: string, _storage?: string) => Promise<FileMetadata>;
}
