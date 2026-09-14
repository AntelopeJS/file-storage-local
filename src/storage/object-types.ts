import type {
  FileSnapshot,
  SealFileRequest,
} from "@antelopejs/interface-file-storage";

import type { StoredFileMetadata } from "./token-manager";

export interface StoredObject {
  snapshot: FileSnapshot;
  metadata: StoredFileMetadata;
  objectId: string;
  request?: SealFileRequest;
}

export interface AdmissionRecord {
  request: SealFileRequest;
  object: StoredObject;
}

export interface RemovalRecord {
  request: SealFileRequest;
}

export interface StoreIdentity {
  storageId: string;
}

export interface LegacyStorage {
  getMetadataPath(resourceKey: string): string;
  getFilePath(resourceKey: string, path?: string): string;
}
