import { Logging } from "@antelopejs/interface-core/logging";
import { ImplementInterface } from "@antelopejs/interface-core";

import { TokenManager } from "./storage/token-manager";
import {
  clearModuleState,
  type Config,
  getConfig,
  getTokenManager,
  setModuleState,
} from "./module-config";
import "./routes";

export { type Config, getConfig, getTokenManager };

type BaseConfig = Pick<Config, "storagePath" | "baseUrl">;
type ConstructConfig = Partial<Config> & BaseConfig;

const DefaultVisibility: Config["defaultVisibility"] = "private";
const DefaultUploadTokenExpiration = 3600;
const DefaultReadTokenExpiration = 60;
const DefaultCleanupInterval = 300;
const MillisecondsPerSecond = 1000;
const CleanupErrorPrefix = "[file-storage-local] Cleanup error:";

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

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

export async function construct(config: ConstructConfig): Promise<void> {
  const resolved = applyDefaults(config);
  const manager = new TokenManager(resolved.storagePath);
  setModuleState(resolved, manager);
  await manager.initialize();
  const [fileStorageInterface, fileStorageImplementation] = await Promise.all([
    import("@antelopejs/interface-file-storage"),
    import("./implementations/file-storage"),
  ]);
  void ImplementInterface(fileStorageInterface, fileStorageImplementation);
}

export function start(): void {
  const config = getConfig();
  if (config.cleanupInterval <= 0) {
    return;
  }
  startCleanupInterval(config, getTokenManager());
}

export function stop(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

export function destroy(): void {
  stop();
  clearModuleState();
}
