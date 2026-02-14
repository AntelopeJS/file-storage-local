import { ImplementInterface } from '@ajs/core/beta';
import { TokenManager } from './storage/token-manager';
import { Visibility } from '@ajs.local/file-storage/beta';
import './routes';
export interface Config {
  storagePath: string;
  baseUrl: string;
  defaultVisibility: Visibility;
  uploadTokenExpiration: number;
  readTokenExpiration: number;
  cleanupInterval: number;
}

type BaseConfig = Pick<Config, 'storagePath' | 'baseUrl'>;
type ConstructConfig = Partial<Config> & BaseConfig;

const DefaultVisibility: Visibility = 'private';
const DefaultUploadTokenExpiration = 3600;
const DefaultReadTokenExpiration = 60;
const DefaultCleanupInterval = 300;
const MillisecondsPerSecond = 1000;
const TokenCleanupErrorPrefix = '[file-storage-local] Token cleanup error:';

let moduleConfig: Config | null = null;
let tokenManager: TokenManager | null = null;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

function ensureModuleConfig(): Config {
  if (!moduleConfig) {
    throw new Error('Module config is not initialized');
  }
  return moduleConfig;
}

function ensureTokenManager(): TokenManager {
  if (!tokenManager) {
    throw new Error('Token manager is not initialized');
  }
  return tokenManager;
}

function applyDefaults(config: ConstructConfig): Config {
  return {
    storagePath: config.storagePath,
    baseUrl: config.baseUrl,
    defaultVisibility: config.defaultVisibility ?? DefaultVisibility,
    uploadTokenExpiration: config.uploadTokenExpiration ?? DefaultUploadTokenExpiration,
    readTokenExpiration: config.readTokenExpiration ?? DefaultReadTokenExpiration,
    cleanupInterval: config.cleanupInterval ?? DefaultCleanupInterval,
  };
}

function startTokenCleanupInterval(config: Config, manager: TokenManager): void {
  cleanupIntervalId = setInterval(() => {
    void manager.cleanupExpiredTokens().catch((error: unknown) => {
      console.error(TokenCleanupErrorPrefix, error);
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
    import('@ajs.local/file-storage/beta'),
    import('./implementations/file-storage/beta'),
  ]);
  ImplementInterface(fileStorageInterface, fileStorageImplementation);
}

export function start(): void {
  const config = ensureModuleConfig();
  if (config.cleanupInterval <= 0) {
    return;
  }
  startTokenCleanupInterval(config, ensureTokenManager());
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
