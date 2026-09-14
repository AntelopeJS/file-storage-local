import type { Visibility } from "@antelopejs/interface-file-storage";

import type { TokenManager } from "./storage/token-manager";

export interface StorageConfig {
  storagePath: string;
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
const DefaultStorage = "default";

export function setModuleState(config: Config, manager: TokenManager): void {
  moduleConfig = config;
  tokenManager = manager;
}

export function registerStorageManager(
  storage: string | undefined,
  manager: TokenManager,
): void {
  const key = storage ?? DefaultStorage;
  tokenManagers.set(key, manager);
}

export function clearModuleState(): void {
  moduleConfig = null;
  tokenManager = null;
  tokenManagers.clear();
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
