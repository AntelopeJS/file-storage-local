import { ImplementInterface } from '@ajs/core/beta';
import { TokenManager } from './storage/token-manager';
import { Visibility } from '@ajs.local/file-storage/beta';

// Import routes to register them
import './routes';

/**
 * Module configuration
 *
 * WARNING: This module is NOT compatible with clustering/multi-instance deployments.
 * All data (files, tokens, metadata) is stored on the local filesystem and is not
 * shared between instances. If you run multiple instances of your application,
 * they will have separate storage and tokens will not work across instances.
 *
 * For production multi-instance deployments, use file-storage-s3 instead.
 */
export interface Config {
  /** Absolute path where files will be stored */
  storagePath: string;

  /**
   * Base URL for file access (e.g., http://localhost:3000/file-storage)
   * This should match your API server URL + the controller path
   */
  baseUrl: string;

  /** Default visibility for uploaded files (default: 'private') */
  defaultVisibility: Visibility;

  /** Expiration time for upload tokens in seconds (default: 3600 = 1 hour) */
  uploadTokenExpiration: number;

  /** Expiration time for read tokens in seconds (default: 60 = 1 minute) */
  readTokenExpiration: number;

  /** Interval for cleaning up expired tokens in seconds (default: 300 = 5 minutes) */
  cleanupInterval: number;
}

let moduleConfig: Config;
let tokenManager: TokenManager;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Get the current module configuration
 */
export function getConfig(): Config {
  return moduleConfig;
}

/**
 * Get the token manager instance
 */
export function getTokenManager(): TokenManager {
  return tokenManager;
}

/**
 * Apply default values to configuration
 */
function applyDefaults(config: Partial<Config> & Pick<Config, 'storagePath' | 'baseUrl'>): Config {
  return {
    storagePath: config.storagePath,
    baseUrl: config.baseUrl,
    defaultVisibility: config.defaultVisibility ?? 'private',
    uploadTokenExpiration: config.uploadTokenExpiration ?? 3600,
    readTokenExpiration: config.readTokenExpiration ?? 60,
    cleanupInterval: config.cleanupInterval ?? 300,
  };
}

/**
 * Module lifecycle: construct
 * Called when the module is loaded with its configuration
 *
 * WARNING: This module is NOT compatible with clustering/multi-instance deployments.
 */
export async function construct(config: Partial<Config> & Pick<Config, 'storagePath' | 'baseUrl'>): Promise<void> {
  moduleConfig = applyDefaults(config);

  // Initialize token manager
  tokenManager = new TokenManager(moduleConfig.storagePath);
  await tokenManager.initialize();

  // Register the interface implementation
  await ImplementInterface(
    import('@ajs.local/file-storage/beta'),
    import('./implementations/file-storage/beta'),
  );
}

/**
 * Module lifecycle: start
 * Called when the module should start
 */
export function start(): void {
  // Start cleanup interval for expired tokens
  if (moduleConfig.cleanupInterval > 0) {
    cleanupIntervalId = setInterval(async () => {
      try {
        const result = await tokenManager.cleanupExpiredTokens();
        if (result.uploadTokens > 0 || result.readTokens > 0) {
          console.log(
            `[file-storage-local] Cleaned up ${result.uploadTokens} upload tokens and ${result.readTokens} read tokens`,
          );
        }
      } catch (error) {
        console.error('[file-storage-local] Token cleanup error:', error);
      }
    }, moduleConfig.cleanupInterval * 1000);
  }
}

/**
 * Module lifecycle: stop
 * Called when the module should stop
 */
export function stop(): void {
  // Stop cleanup interval
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

/**
 * Module lifecycle: destroy
 * Called when the module is being unloaded
 */
export function destroy(): void {
  stop();
}
