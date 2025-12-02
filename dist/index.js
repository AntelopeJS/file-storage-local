"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
exports.getTokenManager = getTokenManager;
exports.construct = construct;
exports.start = start;
exports.stop = stop;
exports.destroy = destroy;
const beta_1 = require("@ajs/core/beta");
const token_manager_1 = require("./storage/token-manager");
require("./routes");
let moduleConfig;
let tokenManager;
let cleanupIntervalId = null;
function getConfig() {
    return moduleConfig;
}
function getTokenManager() {
    return tokenManager;
}
function applyDefaults(config) {
    return {
        storagePath: config.storagePath,
        baseUrl: config.baseUrl,
        defaultVisibility: config.defaultVisibility ?? 'private',
        uploadTokenExpiration: config.uploadTokenExpiration ?? 3600,
        readTokenExpiration: config.readTokenExpiration ?? 60,
        cleanupInterval: config.cleanupInterval ?? 300,
    };
}
async function construct(config) {
    moduleConfig = applyDefaults(config);
    tokenManager = new token_manager_1.TokenManager(moduleConfig.storagePath);
    await tokenManager.initialize();
    await (0, beta_1.ImplementInterface)(Promise.resolve().then(() => __importStar(require('@ajs.local/file-storage/beta'))), Promise.resolve().then(() => __importStar(require('./implementations/file-storage/beta'))));
}
function start() {
    if (moduleConfig.cleanupInterval > 0) {
        cleanupIntervalId = setInterval(async () => {
            try {
                const result = await tokenManager.cleanupExpiredTokens();
                if (result.uploadTokens > 0 || result.readTokens > 0) {
                    console.log(`[file-storage-local] Cleaned up ${result.uploadTokens} upload tokens and ${result.readTokens} read tokens`);
                }
            }
            catch (error) {
                console.error('[file-storage-local] Token cleanup error:', error);
            }
        }, moduleConfig.cleanupInterval * 1000);
    }
}
function stop() {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
    }
}
function destroy() {
    stop();
}
//# sourceMappingURL=index.js.map