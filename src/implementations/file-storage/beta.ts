import {
  UploadRequest,
  UploadConstraints,
  PresignedUploadResponse,
  PresignedReadResponse,
  FileMetadata,
  UploadValidationError,
  FileNotFoundError,
} from '@ajs.local/file-storage/beta';
import { getTokenManager, getConfig } from '../../index';

/**
 * Validates the upload request against constraints
 */
function validateUploadRequest(request: UploadRequest, constraints?: UploadConstraints): void {
  if (constraints?.maxSize && request.size > constraints.maxSize) {
    throw new UploadValidationError(
      `File size ${request.size} exceeds maximum allowed size ${constraints.maxSize}`,
      'SIZE_EXCEEDED',
    );
  }

  if (constraints?.allowedMimetypes && constraints.allowedMimetypes.length > 0) {
    if (!constraints.allowedMimetypes.includes(request.mimetype)) {
      throw new UploadValidationError(
        `MIME type '${request.mimetype}' is not allowed. Allowed types: ${constraints.allowedMimetypes.join(', ')}`,
        'MIMETYPE_NOT_ALLOWED',
      );
    }
  }
}

/**
 * Local filesystem implementation of the file-storage interface.
 *
 * WARNING: This module is NOT compatible with clustering/multi-instance deployments.
 * All data is stored on the local filesystem and is not shared between instances.
 * For production multi-instance deployments, use file-storage-s3 instead.
 */
export namespace internal {
  export const createUploadUrl = async (
    request: UploadRequest,
    constraints?: UploadConstraints,
    _storage?: string,
  ): Promise<PresignedUploadResponse> => {
    // Validate the request
    validateUploadRequest(request, constraints);

    const config = getConfig();
    const tokenManager = getTokenManager();

    const resourceKey = tokenManager.generateResourceKey(request.filename);
    const expiresIn = config.uploadTokenExpiration;
    const expiresAt = Date.now() + expiresIn * 1000;

    const metadata: Record<string, string> = {
      'original-filename': request.filename,
      ...(request.metadata || {}),
    };

    const uploadToken = await tokenManager.createUploadToken(
      resourceKey,
      request.mimetype,
      request.size,
      expiresAt,
      metadata,
      request.path,
    );

    // Build upload URL
    const uploadUrl = `${config.baseUrl.replace(/\/$/, '')}/file-storage/upload/${uploadToken.token}`;

    return {
      uploadUrl,
      resourceKey,
      expiresAt,
      headers: {
        'Content-Type': request.mimetype,
        'Content-Length': String(request.size),
      },
    };
  };

  export const createReadUrl = async (
    resourceKey: string,
    expiresIn?: number,
    _storage?: string,
  ): Promise<PresignedReadResponse> => {
    const config = getConfig();
    const tokenManager = getTokenManager();

    const metadata = await tokenManager.getFileMetadata(resourceKey);
    if (!metadata) {
      throw new FileNotFoundError(resourceKey);
    }

    const exists = await tokenManager.fileExists(resourceKey, metadata.path);
    if (!exists) {
      throw new FileNotFoundError(resourceKey);
    }

    const baseFilesUrl = `${config.baseUrl.replace(/\/$/, '')}/file-storage/files/${encodeURIComponent(resourceKey)}`;

    if (config.defaultVisibility === 'public') {
      return {
        url: baseFilesUrl,
      };
    }

    const effectiveExpiresIn = expiresIn ?? config.readTokenExpiration;
    const expiresAt = Date.now() + effectiveExpiresIn * 1000;

    const readToken = await tokenManager.createReadToken(resourceKey, expiresAt);

    return {
      url: `${baseFilesUrl}?token=${readToken.token}`,
      expiresAt,
    };
  };

  export const deleteFile = async (resourceKey: string, _storage?: string): Promise<void> => {
    const tokenManager = getTokenManager();

    const metadata = await tokenManager.getFileMetadata(resourceKey);
    await tokenManager.deleteFile(resourceKey, metadata?.path);
    await tokenManager.deleteFileMetadata(resourceKey);
  };

  export const fileExists = async (resourceKey: string, _storage?: string): Promise<boolean> => {
    const tokenManager = getTokenManager();

    const metadata = await tokenManager.getFileMetadata(resourceKey);
    if (!metadata) {
      return false;
    }

    return tokenManager.fileExists(resourceKey, metadata.path);
  };

  export const getFileMetadata = async (resourceKey: string, _storage?: string): Promise<FileMetadata> => {
    const tokenManager = getTokenManager();

    const metadata = await tokenManager.getFileMetadata(resourceKey);
    if (!metadata) {
      throw new FileNotFoundError(resourceKey);
    }
    return {
      resourceKey: metadata.resourceKey,
      filename: metadata.metadata?.['original-filename'] ?? '',
      size: metadata.size,
      mimetype: metadata.mimetype,
      lastModified: metadata.lastModified,
      metadata: metadata.metadata,
    };
  };
}
