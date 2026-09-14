import { promises as fs } from "node:fs";
import { relative, sep } from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { ImplementInterface } from "@antelopejs/interface-core";

import { TokenManager } from "./storage/token-manager";
import { AttachmentManager } from "./storage/attachment-manager";
import {
  clearModuleState,
  type Config,
  getConfig,
  getTokenManager,
  registerStorageManagers,
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
let attachmentManagers: AttachmentManager[] = [];

function applyDefaults(config: ConstructConfig): Config {
  const resolved: Config = {
    ...config,
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
  await Promise.all(
    attachmentManagers.map((attachmentManager) =>
      attachmentManager.cleanupExpiredTemporary(),
    ),
  );
  const stagingExpiration = config.stagingExpiration;
  if (stagingExpiration !== undefined && stagingExpiration > 0) {
    await manager.cleanupExpiredStagingFiles(
      stagingExpiration * MillisecondsPerSecond,
    );
  }
}

interface StorageEntry {
  storage?: string;
  config: Config;
}

function storageEntries(config: Config): StorageEntry[] {
  const named = Object.entries(config.storages ?? {}).map(
    ([storage, value]) => ({ storage, config: applyDefaults(value) }),
  );
  return [{ config }, ...named];
}

async function initializeStorage(entry: StorageEntry): Promise<void> {
  const manager = new TokenManager(entry.config.storagePath);
  const attachmentPath =
    entry.config.attachmentStoragePath ??
    `${entry.config.storagePath}-attachments`;
  const attachmentManager = new AttachmentManager(attachmentPath);
  await Promise.all([
    manager.initialize(),
    attachmentManager.initialize(entry.config.storagePath),
  ]);
  registerStorageManagers(entry.storage, manager, attachmentManager);
  attachmentManagers.push(attachmentManager);
}

async function assertDistinctRoots(entries: StorageEntry[]): Promise<void> {
  const roots = entries.flatMap((entry) => {
    const attachmentPath =
      entry.config.attachmentStoragePath ??
      `${entry.config.storagePath}-attachments`;
    return [entry.config.storagePath, `${attachmentPath}/attachments`];
  });
  const canonical = await Promise.all(roots.map((root) => fs.realpath(root)));
  canonical.forEach((root, index) => {
    canonical.slice(index + 1).forEach((candidate) => {
      const relation = relative(root, candidate);
      const reverse = relative(candidate, root);
      const overlaps = (value: string) =>
        !value || (!value.startsWith(`..${sep}`) && value !== "..");
      if (overlaps(relation) || overlaps(reverse))
        throw new Error("Configured storage roots must not overlap");
    });
  });
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
  if (resolved.storages?.default)
    throw new Error("Named storage 'default' is reserved");
  const manager = new TokenManager(resolved.storagePath);
  setModuleState(resolved, manager);
  attachmentManagers = [];
  const entries = storageEntries(resolved);
  await Promise.all(entries.map(initializeStorage));
  await assertDistinctRoots(entries);
  const [
    fileStorageInterface,
    fileStorageImplementation,
    attachmentInterface,
    attachmentImplementation,
  ] = await Promise.all([
    import("@antelopejs/interface-file-storage"),
    import("./implementations/file-storage"),
    import("@antelopejs/interface-file-storage/attachments"),
    import("./implementations/attachments"),
  ]);
  void ImplementInterface(fileStorageInterface, fileStorageImplementation);
  void ImplementInterface(attachmentInterface, attachmentImplementation);
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
  attachmentManagers = [];
}
