"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStorageController = void 0;
const beta_1 = require("@ajs/api/beta");
const fs_1 = require("fs");
const index_1 = require("../index");
class FileStorageController extends (0, beta_1.Controller)('file-storage') {
    async handleUpload(token, contentType, contentLength, body, context) {
        const tokenManager = (0, index_1.getTokenManager)();
        const uploadToken = await tokenManager.getUploadToken(token);
        if (!uploadToken) {
            return new beta_1.HTTPResult(404, { error: 'Token not found or expired' });
        }
        if (uploadToken.expiresAt < Date.now()) {
            await tokenManager.deleteUploadToken(token);
            return new beta_1.HTTPResult(403, { error: 'Token expired' });
        }
        if (contentType !== uploadToken.mimetype) {
            return new beta_1.HTTPResult(403, {
                error: 'Content-Type mismatch',
                expected: uploadToken.mimetype,
                received: contentType,
            });
        }
        const expectedSize = uploadToken.size;
        const receivedSize = contentLength ? parseInt(contentLength, 10) : body.length;
        if (receivedSize !== expectedSize) {
            return new beta_1.HTTPResult(403, {
                error: 'Content-Length mismatch',
                expected: expectedSize,
                received: receivedSize,
            });
        }
        if (body.length !== expectedSize) {
            return new beta_1.HTTPResult(403, {
                error: 'Body size mismatch',
                expected: expectedSize,
                received: body.length,
            });
        }
        try {
            await tokenManager.ensureFileDirectory(uploadToken.resourceKey);
            const filePath = tokenManager.getFilePath(uploadToken.resourceKey);
            await fs_1.promises.writeFile(filePath, body);
            await tokenManager.saveFileMetadata({
                resourceKey: uploadToken.resourceKey,
                mimetype: uploadToken.mimetype,
                size: uploadToken.size,
                lastModified: Date.now(),
                visibility: uploadToken.visibility,
                metadata: uploadToken.metadata,
            });
            await tokenManager.deleteUploadToken(token);
            return new beta_1.HTTPResult(200, { success: true, resourceKey: uploadToken.resourceKey });
        }
        catch (error) {
            console.error('File upload error:', error);
            return new beta_1.HTTPResult(500, { error: 'Failed to save file' });
        }
    }
    async handleDownload(token, context) {
        const tokenManager = (0, index_1.getTokenManager)();
        const url = context.url.pathname;
        const filesPrefix = '/file-storage/files/';
        const resourceKey = url.startsWith(filesPrefix) ? url.slice(filesPrefix.length) : '';
        if (!resourceKey) {
            return new beta_1.HTTPResult(400, { error: 'Resource key required' });
        }
        const decodedResourceKey = decodeURIComponent(resourceKey);
        const exists = await tokenManager.fileExists(decodedResourceKey);
        if (!exists) {
            return new beta_1.HTTPResult(404, { error: 'File not found' });
        }
        const metadata = await tokenManager.getFileMetadata(decodedResourceKey);
        if (!metadata) {
            return new beta_1.HTTPResult(404, { error: 'File metadata not found' });
        }
        if (metadata.visibility === 'private') {
            if (!token) {
                return new beta_1.HTTPResult(403, { error: 'Access denied. Token required for private files.' });
            }
            const readToken = await tokenManager.getReadToken(token);
            if (!readToken) {
                return new beta_1.HTTPResult(403, { error: 'Invalid or expired token' });
            }
            if (readToken.expiresAt < Date.now()) {
                return new beta_1.HTTPResult(403, { error: 'Token expired' });
            }
            if (readToken.resourceKey !== decodedResourceKey) {
                return new beta_1.HTTPResult(403, { error: 'Token does not match requested resource' });
            }
        }
        try {
            const filePath = tokenManager.getFilePath(decodedResourceKey);
            const fileBuffer = await fs_1.promises.readFile(filePath);
            const result = new beta_1.HTTPResult(200, fileBuffer, metadata.mimetype);
            result.addHeader('Content-Length', metadata.size.toString());
            result.addHeader('Content-Disposition', `inline; filename="${metadata.metadata?.['original-filename'] || decodedResourceKey}"`);
            result.addHeader('Cache-Control', metadata.visibility === 'public' ? 'public, max-age=31536000' : 'private, no-cache');
            return result;
        }
        catch (error) {
            console.error('File download error:', error);
            return new beta_1.HTTPResult(500, { error: 'Failed to read file' });
        }
    }
}
exports.FileStorageController = FileStorageController;
__decorate([
    (0, beta_1.Put)('/upload/:token'),
    __param(0, (0, beta_1.Parameter)('token', 'param')),
    __param(1, (0, beta_1.Parameter)('content-type', 'header')),
    __param(2, (0, beta_1.Parameter)('content-length', 'header')),
    __param(3, (0, beta_1.RawBody)()),
    __param(4, (0, beta_1.Context)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, Buffer, Object]),
    __metadata("design:returntype", Promise)
], FileStorageController.prototype, "handleUpload", null);
__decorate([
    (0, beta_1.Get)('/files/*'),
    __param(0, (0, beta_1.Parameter)('token', 'query')),
    __param(1, (0, beta_1.Context)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], FileStorageController.prototype, "handleDownload", null);
//# sourceMappingURL=index.js.map