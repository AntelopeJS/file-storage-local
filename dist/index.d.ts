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
export declare function getConfig(): Config;
export declare function getTokenManager(): TokenManager;
export declare function construct(config: Partial<Config> & Pick<Config, 'storagePath' | 'baseUrl'>): Promise<void>;
export declare function start(): void;
export declare function stop(): void;
export declare function destroy(): void;
