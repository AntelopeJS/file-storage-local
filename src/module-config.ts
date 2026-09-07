import type { Visibility } from "@antelopejs/interface-file-storage";

import type { TokenManager } from "./storage/token-manager";

export interface Config {
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

let moduleConfig: Config | null = null;
let tokenManager: TokenManager | null = null;

export function setModuleState(config: Config, manager: TokenManager): void {
  moduleConfig = config;
  tokenManager = manager;
}

export function clearModuleState(): void {
  moduleConfig = null;
  tokenManager = null;
}

export function getConfig(): Config {
  if (!moduleConfig) {
    throw new Error("Module config is not initialized");
  }
  return moduleConfig;
}

export function getTokenManager(): TokenManager {
  if (!tokenManager) {
    throw new Error("Token manager is not initialized");
  }
  return tokenManager;
}
