import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import type { Visibility } from "@antelopejs/interface-file-storage";
import { TokenManager } from "./storage/token-manager";
import "./routes";
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

type BaseConfig = Pick<Config, "storagePath" | "baseUrl">;
type ConstructConfig = Partial<Config> & BaseConfig;

const DefaultVisibility: Visibility = "private";
const DefaultUploadTokenExpiration = 3600;
const DefaultReadTokenExpiration = 60;
const DefaultCleanupInterval = 300;
const MillisecondsPerSecond = 1000;
const CleanupErrorPrefix = "[file-storage-local] Cleanup error:";

let moduleConfig: Config | null = null;
let tokenManager: TokenManager | null = null;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

function ensureModuleConfig(): Config {
  if (!moduleConfig) {
    throw new Error("Module config is not initialized");
  }
  return moduleConfig;
}

function ensureTokenManager(): TokenManager {
  if (!tokenManager) {
    throw new Error("Token manager is not initialized");
  }
  return tokenManager;
}

function applyDefaults(config: ConstructConfig): Config {
  const resolved: Config = {
    storagePath: config.storagePath,
    baseUrl: config.baseUrl,
    defaultVisibility: config.defaultVisibility ?? DefaultVisibility,
    uploadTokenExpiration:
      config.uploadTokenExpiration ?? DefaultUploadTokenExpiration,
    readTokenExpiration:
      config.readTokenExpiration ?? DefaultReadTokenExpiration,
    cleanupInterval: config.cleanupInterval ?? DefaultCleanupInterval,
  };
  if (config.stagingExpiration !== undefined) {
    resolved.stagingExpiration = config.stagingExpiration;
  }
  return resolved;
}

async function runCleanup(
  config: Config,
  manager: TokenManager,
): Promise<void> {
  await manager.cleanupExpiredTokens();
  const stagingExpiration = config.stagingExpiration;
  if (stagingExpiration !== undefined && stagingExpiration > 0) {
    await manager.cleanupExpiredStagingFiles(
      stagingExpiration * MillisecondsPerSecond,
    );
  }
}

function startCleanupInterval(config: Config, manager: TokenManager): void {
  cleanupIntervalId = setInterval(() => {
    void runCleanup(config, manager).catch((error: unknown) => {
      Logging.Error(CleanupErrorPrefix, error);
    });
  }, config.cleanupInterval * MillisecondsPerSecond);
}

export function getConfig(): Config {
  return ensureModuleConfig();
}

export function getTokenManager(): TokenManager {
  return ensureTokenManager();
}

export async function construct(config: ConstructConfig): Promise<void> {
  moduleConfig = applyDefaults(config);
  tokenManager = new TokenManager(moduleConfig.storagePath);
  await tokenManager.initialize();
  const [fileStorageInterface, fileStorageImplementation] = await Promise.all([
    import("@antelopejs/interface-file-storage"),
    import("./implementations/file-storage"),
  ]);
  void ImplementInterface(fileStorageInterface, fileStorageImplementation);
}

export function start(): void {
  const config = ensureModuleConfig();
  if (config.cleanupInterval <= 0) {
    return;
  }
  startCleanupInterval(config, ensureTokenManager());
}

export function stop(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

export function destroy(): void {
  stop();
  tokenManager = null;
  moduleConfig = null;
}
