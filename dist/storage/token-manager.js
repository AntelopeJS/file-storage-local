"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenManager = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const crypto_1 = require("crypto");
class TokenManager {
    basePath;
    filesPath;
    metadataPath;
    uploadTokensPath;
    readTokensPath;
    constructor(storagePath) {
        this.basePath = storagePath;
        this.filesPath = (0, path_1.join)(storagePath, 'files');
        this.metadataPath = (0, path_1.join)(storagePath, 'metadata');
        this.uploadTokensPath = (0, path_1.join)(storagePath, 'tokens', 'upload');
        this.readTokensPath = (0, path_1.join)(storagePath, 'tokens', 'read');
    }
    async initialize() {
        await fs_1.promises.mkdir(this.filesPath, { recursive: true });
        await fs_1.promises.mkdir(this.metadataPath, { recursive: true });
        await fs_1.promises.mkdir(this.uploadTokensPath, { recursive: true });
        await fs_1.promises.mkdir(this.readTokensPath, { recursive: true });
    }
    generateToken() {
        return (0, crypto_1.randomUUID)();
    }
    generateResourceKey(filename, path) {
        const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
        const uuid = (0, crypto_1.randomUUID)();
        const prefix = path ? `${path.replace(/^\/|\/$/g, '')}/` : '';
        return `${prefix}${uuid}${ext}`;
    }
    async createUploadToken(resourceKey, mimetype, size, expiresAt, visibility, metadata) {
        const token = this.generateToken();
        const data = {
            token,
            resourceKey,
            mimetype,
            size,
            expiresAt,
            visibility,
            metadata,
        };
        const tokenPath = (0, path_1.join)(this.uploadTokensPath, `${token}.json`);
        await fs_1.promises.writeFile(tokenPath, JSON.stringify(data, null, 2));
        return data;
    }
    async getUploadToken(token) {
        try {
            const tokenPath = (0, path_1.join)(this.uploadTokensPath, `${token}.json`);
            const content = await fs_1.promises.readFile(tokenPath, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    async deleteUploadToken(token) {
        try {
            const tokenPath = (0, path_1.join)(this.uploadTokensPath, `${token}.json`);
            await fs_1.promises.unlink(tokenPath);
        }
        catch {
        }
    }
    async createReadToken(resourceKey, expiresAt) {
        const token = this.generateToken();
        const data = {
            token,
            resourceKey,
            expiresAt,
        };
        const tokenPath = (0, path_1.join)(this.readTokensPath, `${token}.json`);
        await fs_1.promises.writeFile(tokenPath, JSON.stringify(data, null, 2));
        return data;
    }
    async getReadToken(token) {
        try {
            const tokenPath = (0, path_1.join)(this.readTokensPath, `${token}.json`);
            const content = await fs_1.promises.readFile(tokenPath, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    async deleteReadToken(token) {
        try {
            const tokenPath = (0, path_1.join)(this.readTokensPath, `${token}.json`);
            await fs_1.promises.unlink(tokenPath);
        }
        catch {
        }
    }
    async saveFileMetadata(metadata) {
        const metadataFilePath = (0, path_1.join)(this.metadataPath, `${metadata.resourceKey}.json`);
        const dir = metadataFilePath.substring(0, metadataFilePath.lastIndexOf('/'));
        await fs_1.promises.mkdir(dir, { recursive: true });
        await fs_1.promises.writeFile(metadataFilePath, JSON.stringify(metadata, null, 2));
    }
    async getFileMetadata(resourceKey) {
        try {
            const metadataFilePath = (0, path_1.join)(this.metadataPath, `${resourceKey}.json`);
            const content = await fs_1.promises.readFile(metadataFilePath, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    async deleteFileMetadata(resourceKey) {
        try {
            const metadataFilePath = (0, path_1.join)(this.metadataPath, `${resourceKey}.json`);
            await fs_1.promises.unlink(metadataFilePath);
        }
        catch {
        }
    }
    getFilePath(resourceKey) {
        return (0, path_1.join)(this.filesPath, resourceKey);
    }
    async fileExists(resourceKey) {
        try {
            await fs_1.promises.access(this.getFilePath(resourceKey));
            return true;
        }
        catch {
            return false;
        }
    }
    async deleteFile(resourceKey) {
        try {
            await fs_1.promises.unlink(this.getFilePath(resourceKey));
        }
        catch {
        }
    }
    async ensureFileDirectory(resourceKey) {
        const filePath = this.getFilePath(resourceKey);
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        await fs_1.promises.mkdir(dir, { recursive: true });
    }
    async cleanupExpiredTokens() {
        const now = Date.now();
        let uploadTokens = 0;
        let readTokens = 0;
        try {
            const uploadFiles = await fs_1.promises.readdir(this.uploadTokensPath);
            for (const file of uploadFiles) {
                if (!file.endsWith('.json'))
                    continue;
                try {
                    const tokenPath = (0, path_1.join)(this.uploadTokensPath, file);
                    const content = await fs_1.promises.readFile(tokenPath, 'utf-8');
                    const token = JSON.parse(content);
                    if (token.expiresAt < now) {
                        await fs_1.promises.unlink(tokenPath);
                        uploadTokens++;
                    }
                }
                catch {
                }
            }
        }
        catch {
        }
        try {
            const readFiles = await fs_1.promises.readdir(this.readTokensPath);
            for (const file of readFiles) {
                if (!file.endsWith('.json'))
                    continue;
                try {
                    const tokenPath = (0, path_1.join)(this.readTokensPath, file);
                    const content = await fs_1.promises.readFile(tokenPath, 'utf-8');
                    const token = JSON.parse(content);
                    if (token.expiresAt < now) {
                        await fs_1.promises.unlink(tokenPath);
                        readTokens++;
                    }
                }
                catch {
                }
            }
        }
        catch {
        }
        return { uploadTokens, readTokens };
    }
}
exports.TokenManager = TokenManager;
//# sourceMappingURL=token-manager.js.map