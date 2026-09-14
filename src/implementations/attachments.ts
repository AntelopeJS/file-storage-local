import {
  FileNotFoundError,
  type FileMetadata,
  type PresignedReadResponse,
  type PresignedUploadResponse,
  type UploadConstraints,
  type UploadRequest,
  UploadValidationError,
} from "@antelopejs/interface-file-storage";

import { getAttachmentManager, getStorageConfig } from "../module-config";

const MaximumUploadExpiration = 86400;
const MaximumReadExpiration = 60;
const MillisecondsPerSecond = 1000;

function validate(
  request: UploadRequest,
  constraints?: UploadConstraints,
): void {
  if (constraints?.maxSize !== undefined && request.size > constraints.maxSize)
    throw new UploadValidationError(
      "File size exceeds maximum allowed size",
      "SIZE_EXCEEDED",
    );
  if (
    constraints?.allowedMimetypes?.length &&
    !constraints.allowedMimetypes.includes(request.mimetype)
  )
    throw new UploadValidationError(
      "MIME type is not allowed",
      "MIMETYPE_NOT_ALLOWED",
    );
}

function baseUrl(storage?: string): string {
  return getStorageConfig(storage).baseUrl.replace(/\/$/, "");
}

function storagePath(storage?: string): string {
  return storage ?? "default";
}

export namespace internal {
  export async function createPrivateUploadUrl(
    request: UploadRequest,
    constraints?: UploadConstraints,
    storage?: string,
  ): Promise<PresignedUploadResponse> {
    validate(request, constraints);
    const config = getStorageConfig(storage);
    const expiresIn = Math.min(
      config.uploadTokenExpiration,
      MaximumUploadExpiration,
    );
    const expiresAt = Date.now() + expiresIn * MillisecondsPerSecond;
    const upload = getAttachmentManager(storage).createUpload(
      request,
      expiresAt,
    );
    return {
      uploadUrl: `${baseUrl(storage)}/file-storage-attachments/upload/${storagePath(storage)}/${upload.token}`,
      resourceKey: upload.resourceKey,
      expiresAt,
      headers: {
        "Content-Type": request.mimetype,
        "Content-Length": String(request.size),
      },
    };
  }

  export async function prepareAttachment(
    sourceKey: string,
    destinationKey: string,
    storage?: string,
  ): Promise<void> {
    await getAttachmentManager(storage).prepare(sourceKey, destinationKey);
  }

  export async function publishAttachment(
    resourceKey: string,
    storage?: string,
  ): Promise<PresignedReadResponse> {
    await getAttachmentManager(storage).publish(resourceKey);
    return {
      url: `${baseUrl(storage)}/file-storage-attachments/public/${storagePath(storage)}/${encodeURIComponent(resourceKey)}`,
    };
  }

  export async function getPrivateFileMetadata(
    resourceKey: string,
    storage?: string,
  ): Promise<FileMetadata> {
    try {
      await getAttachmentManager(storage).readPath(resourceKey);
      return await getAttachmentManager(storage).metadataFor(resourceKey);
    } catch {
      throw new FileNotFoundError(resourceKey);
    }
  }

  export async function createPrivateReadUrl(
    resourceKey: string,
    expiresIn: number,
    storage?: string,
  ): Promise<PresignedReadResponse> {
    if (!Number.isFinite(expiresIn) || expiresIn <= 0)
      throw new Error("Read URL expiration must be a positive finite number");
    await getAttachmentManager(storage)
      .readPath(resourceKey)
      .catch(() => {
        throw new FileNotFoundError(resourceKey);
      });
    const effectiveExpiration = Math.min(expiresIn, MaximumReadExpiration);
    const expiresAt = Date.now() + effectiveExpiration * MillisecondsPerSecond;
    const token = getAttachmentManager(storage).createReadToken(
      resourceKey,
      expiresAt,
    );
    return {
      url: `${baseUrl(storage)}/file-storage-attachments/private/${storagePath(storage)}/${encodeURIComponent(resourceKey)}?token=${token}`,
      expiresAt,
    };
  }

  export async function deleteAttachment(
    resourceKey: string,
    storage?: string,
  ): Promise<void> {
    await getAttachmentManager(storage).delete(resourceKey);
  }
}
