"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.internal = void 0;
const beta_1 = require("@ajs.local/file-storage/beta");
const index_1 = require("../../index");
function validateUploadRequest(request, constraints) {
    if (constraints?.maxSize && request.size > constraints.maxSize) {
        throw new beta_1.UploadValidationError(`File size ${request.size} exceeds maximum allowed size ${constraints.maxSize}`, 'SIZE_EXCEEDED');
    }
    if (constraints?.allowedMimetypes && constraints.allowedMimetypes.length > 0) {
        if (!constraints.allowedMimetypes.includes(request.mimetype)) {
            throw new beta_1.UploadValidationError(`MIME type '${request.mimetype}' is not allowed. Allowed types: ${constraints.allowedMimetypes.join(', ')}`, 'MIMETYPE_NOT_ALLOWED');
        }
    }
}
var internal;
(function (internal) {
    internal.createUploadUrl = async (request, constraints, _storage) => {
        validateUploadRequest(request, constraints);
        const config = (0, index_1.getConfig)();
        const tokenManager = (0, index_1.getTokenManager)();
        const resourceKey = tokenManager.generateResourceKey(request.filename, request.path);
        const visibility = request.visibility ?? config.defaultVisibility;
        const expiresIn = config.uploadTokenExpiration;
        const expiresAt = Date.now() + expiresIn * 1000;
        const metadata = {
            'original-filename': request.filename,
            ...(request.metadata || {}),
        };
        const uploadToken = await tokenManager.createUploadToken(resourceKey, request.mimetype, request.size, expiresAt, visibility, metadata);
        const uploadUrl = `${config.baseUrl.replace(/\/$/, '')}/upload/${uploadToken.token}`;
        return {
            uploadUrl,
            resourceKey,
            expiresAt,
            headers: {
                'Content-Type': request.mimetype,
                'Content-Length': String(request.size),
            },
        };
    };
    internal.createReadUrl = async (resourceKey, expiresIn, _storage) => {
        const config = (0, index_1.getConfig)();
        const tokenManager = (0, index_1.getTokenManager)();
        const exists = await tokenManager.fileExists(resourceKey);
        if (!exists) {
            throw new beta_1.FileNotFoundError(resourceKey);
        }
        const metadata = await tokenManager.getFileMetadata(resourceKey);
        if (!metadata) {
            throw new beta_1.FileNotFoundError(resourceKey);
        }
        const baseFilesUrl = `${config.baseUrl.replace(/\/$/, '')}/files/${encodeURIComponent(resourceKey)}`;
        if (metadata.visibility === 'public') {
            return {
                url: baseFilesUrl,
            };
        }
        const effectiveExpiresIn = expiresIn ?? config.readTokenExpiration;
        const expiresAt = Date.now() + effectiveExpiresIn * 1000;
        const readToken = await tokenManager.createReadToken(resourceKey, expiresAt);
        return {
            url: `${baseFilesUrl}?token=${readToken.token}`,
            expiresAt,
        };
    };
    internal.deleteFile = async (resourceKey, _storage) => {
        const tokenManager = (0, index_1.getTokenManager)();
        await tokenManager.deleteFile(resourceKey);
        await tokenManager.deleteFileMetadata(resourceKey);
    };
    internal.fileExists = async (resourceKey, _storage) => {
        const tokenManager = (0, index_1.getTokenManager)();
        return tokenManager.fileExists(resourceKey);
    };
    internal.getFileMetadata = async (resourceKey, _storage) => {
        const tokenManager = (0, index_1.getTokenManager)();
        const metadata = await tokenManager.getFileMetadata(resourceKey);
        if (!metadata) {
            throw new beta_1.FileNotFoundError(resourceKey);
        }
        return {
            resourceKey: metadata.resourceKey,
            size: metadata.size,
            mimetype: metadata.mimetype,
            lastModified: metadata.lastModified,
            metadata: metadata.metadata,
        };
    };
})(internal || (exports.internal = internal = {}));
//# sourceMappingURL=beta.js.map