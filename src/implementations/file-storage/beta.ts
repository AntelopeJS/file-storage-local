import {
  type FileMetadata,
  FileNotFoundError,
  type PresignedReadResponse,
  type PresignedUploadResponse,
  type UploadConstraints,
  type UploadRequest,
  UploadValidationError,
} from "@ajs.local/file-storage/beta";
import { getConfig, getTokenManager } from "../../index";

const BaseUrlTrailingSlashRegex = /\/$/;
const FileUploadPath = "/file-storage/upload";
const FileReadPath = "/file-storage/files";
const MillisecondsPerSecond = 1000;
const FilenameMetadataKey = "filename";

interface StoredMetadataSnapshot {
  resourceKey: string;
  size: number;
  mimetype: string;
  lastModified: number;
  metadata?: Record<string, string>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(BaseUrlTrailingSlashRegex, "");
}

function buildUploadUrl(baseUrl: string, token: string): string {
  return `${normalizeBaseUrl(baseUrl)}${FileUploadPath}/${token}`;
}

function buildFilesUrl(baseUrl: string, resourceKey: string): string {
  return `${normalizeBaseUrl(baseUrl)}${FileReadPath}/${encodeURIComponent(resourceKey)}`;
}

function buildMetadata(request: UploadRequest): Record<string, string> {
  return {
    [FilenameMetadataKey]: request.filename,
    ...(request.metadata ?? {}),
  };
}

function validateUploadRequest(
  request: UploadRequest,
  constraints?: UploadConstraints,
): void {
  if (
    constraints?.maxSize !== undefined &&
    request.size > constraints.maxSize
  ) {
    throw new UploadValidationError(
      `File size ${request.size} exceeds maximum allowed size ${constraints.maxSize}`,
      "SIZE_EXCEEDED",
    );
  }

  const allowedMimetypes = constraints?.allowedMimetypes;
  if (!allowedMimetypes || allowedMimetypes.length === 0) {
    return;
  }
  if (allowedMimetypes.includes(request.mimetype)) {
    return;
  }
  throw new UploadValidationError(
    `MIME type '${request.mimetype}' is not allowed. Allowed types: ${allowedMimetypes.join(", ")}`,
    "MIMETYPE_NOT_ALLOWED",
  );
}

function toFileMetadata(metadata: StoredMetadataSnapshot): FileMetadata {
  const fileMetadata: FileMetadata = {
    resourceKey: metadata.resourceKey,
    filename: metadata.metadata?.[FilenameMetadataKey] ?? "",
    size: metadata.size,
    mimetype: metadata.mimetype,
    lastModified: metadata.lastModified,
  };
  if (metadata.metadata) {
    fileMetadata.metadata = metadata.metadata;
  }
  return fileMetadata;
}

export namespace internal {
  export const createUploadUrl = async (
    request: UploadRequest,
    constraints?: UploadConstraints,
    _storage?: string,
  ): Promise<PresignedUploadResponse> => {
    validateUploadRequest(request, constraints);
    const config = getConfig();
    const tokenManager = getTokenManager();
    const resourceKey = tokenManager.generateResourceKey(request.filename);
    const expiresIn = config.uploadTokenExpiration;
    const expiresAt = Date.now() + expiresIn * MillisecondsPerSecond;
    const metadata = buildMetadata(request);
    const uploadToken = await tokenManager.createUploadToken(
      resourceKey,
      request.mimetype,
      request.size,
      expiresAt,
      metadata,
      request.path,
    );
    const uploadUrl = buildUploadUrl(config.baseUrl, uploadToken.token);
    return {
      uploadUrl,
      resourceKey,
      expiresAt,
      headers: {
        "Content-Type": request.mimetype,
        "Content-Length": String(request.size),
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
    const filesUrl = buildFilesUrl(config.baseUrl, resourceKey);
    if (config.defaultVisibility === "public") {
      return {
        url: filesUrl,
      };
    }
    const effectiveExpiresIn = expiresIn ?? config.readTokenExpiration;
    const expiresAt = Date.now() + effectiveExpiresIn * MillisecondsPerSecond;
    const readToken = await tokenManager.createReadToken(
      resourceKey,
      expiresAt,
    );
    return {
      url: `${filesUrl}?token=${readToken.token}`,
      expiresAt,
    };
  };

  export const deleteFile = async (
    resourceKey: string,
    _storage?: string,
  ): Promise<void> => {
    const tokenManager = getTokenManager();
    const metadata = await tokenManager.getFileMetadata(resourceKey);
    await tokenManager.deleteFile(resourceKey, metadata?.path);
    await tokenManager.deleteFileMetadata(resourceKey);
  };

  export const fileExists = async (
    resourceKey: string,
    _storage?: string,
  ): Promise<boolean> => {
    const tokenManager = getTokenManager();
    const metadata = await tokenManager.getFileMetadata(resourceKey);
    if (!metadata) {
      return false;
    }
    return tokenManager.fileExists(resourceKey, metadata.path);
  };

  export const getFileMetadata = async (
    resourceKey: string,
    _storage?: string,
  ): Promise<FileMetadata> => {
    const tokenManager = getTokenManager();
    const metadata = await tokenManager.getFileMetadata(resourceKey);
    if (!metadata) {
      throw new FileNotFoundError(resourceKey);
    }
    return toFileMetadata(metadata);
  };
}
