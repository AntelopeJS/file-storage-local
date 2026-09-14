import type { Visibility } from "@antelopejs/interface-file-storage";

import type { TokenManager } from "./storage/token-manager";
import type { AttachmentManager } from "./storage/attachment-manager";

export interface StorageConfig {
  storagePath: string;
  attachmentStoragePath?: string;
  baseUrl: string;
  defaultVisibility: Visibility;
  uploadTokenExpiration: number;
  readTokenExpiration: number;
  cleanupInterval: number;
  /**
   * When set (in seconds), the periodic cleanup also deletes staged files older
   * than this age, mirroring the S3 staging lifecycle rule. Omit to disable the
   * staging sweep (the local backend then keeps staged files indefinitely).
   */
  stagingExpiration?: number;
}

export interface Config extends StorageConfig {
  storages?: Record<string, StorageConfig>;
}

let moduleConfig: Config | null = null;
let tokenManager: TokenManager | null = null;
const tokenManagers = new Map<string, TokenManager>();
const attachmentManagers = new Map<string, AttachmentManager>();
const DefaultStorage = "default";

export function setModuleState(config: Config, manager: TokenManager): void {
  moduleConfig = config;
  tokenManager = manager;
}

export function registerStorageManagers(
  storage: string | undefined,
  manager: TokenManager,
  attachmentManager: AttachmentManager,
): void {
  const key = storage ?? DefaultStorage;
  tokenManagers.set(key, manager);
  attachmentManagers.set(key, attachmentManager);
}

export function clearModuleState(): void {
  moduleConfig = null;
  tokenManager = null;
  tokenManagers.clear();
  attachmentManagers.clear();
}

export function getConfig(): Config {
  if (!moduleConfig) {
    throw new Error("Module config is not initialized");
  }
  return moduleConfig;
}

export function getStorageConfig(storage?: string): StorageConfig {
  const config = getConfig();
  if (!storage) return config;
  const named = config.storages?.[storage];
  if (!named)
    throw new Error(`Storage '${storage}' not found in configuration`);
  return named;
}

export function getTokenManager(storage?: string): TokenManager {
  if (storage) {
    const manager = tokenManagers.get(storage);
    if (!manager)
      throw new Error(`Storage '${storage}' not found in configuration`);
    return manager;
  }
  if (!tokenManager) {
    throw new Error("Token manager is not initialized");
  }
  return tokenManager;
}

export function getAttachmentManager(storage?: string): AttachmentManager {
  const manager = attachmentManagers.get(storage ?? DefaultStorage);
  if (!manager)
    throw new Error(
      `Storage '${storage ?? DefaultStorage}' not found in configuration`,
    );
  return manager;
}
