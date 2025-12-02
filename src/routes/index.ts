import { Controller, Put, Get, Parameter, Context, RawBody, HTTPResult, RequestContext } from '@ajs/api/beta';
import { promises as fs } from 'fs';
import { getTokenManager } from '../index';

/**
 * File Storage HTTP Controller
 *
 * Handles file uploads and downloads via presigned-like URLs.
 *
 * WARNING: This module is NOT compatible with clustering/multi-instance deployments.
 * All data is stored on the local filesystem and is not shared between instances.
 * For production multi-instance deployments, use file-storage-s3 instead.
 */
export class FileStorageController extends Controller('file-storage') {
  /**
   * PUT /file-storage/upload/:token
   *
   * Handles file upload with token validation.
   * Validates Content-Type and Content-Length against the token's expected values.
   * Returns 403 if headers don't match (simulating S3 SigV4 behavior).
   */
  @Put('/upload/:token')
  async handleUpload(
    @Parameter('token', 'param') token: string,
    @Parameter('content-type', 'header') contentType: string | undefined,
    @Parameter('content-length', 'header') contentLength: string | undefined,
    @RawBody() body: Buffer,
    @Context() _context: RequestContext,
  ): Promise<HTTPResult> {
    const tokenManager = getTokenManager();

    // Get upload token
    const uploadToken = await tokenManager.getUploadToken(token);
    if (!uploadToken) {
      return new HTTPResult(404, { error: 'Token not found or expired' });
    }

    // Check expiration
    if (uploadToken.expiresAt < Date.now()) {
      await tokenManager.deleteUploadToken(token);
      return new HTTPResult(403, { error: 'Token expired' });
    }

    // Validate Content-Type (must match exactly)
    if (contentType !== uploadToken.mimetype) {
      return new HTTPResult(403, {
        error: 'Content-Type mismatch',
        expected: uploadToken.mimetype,
        received: contentType,
      });
    }

    // Validate Content-Length (must match exactly)
    const expectedSize = uploadToken.size;
    const receivedSize = contentLength ? parseInt(contentLength, 10) : body.length;

    if (receivedSize !== expectedSize) {
      return new HTTPResult(403, {
        error: 'Content-Length mismatch',
        expected: expectedSize,
        received: receivedSize,
      });
    }

    // Validate actual body size
    if (body.length !== expectedSize) {
      return new HTTPResult(403, {
        error: 'Body size mismatch',
        expected: expectedSize,
        received: body.length,
      });
    }

    try {
      // Ensure directory exists for nested paths
      await tokenManager.ensureFileDirectory(uploadToken.resourceKey);

      // Write file to storage
      const filePath = tokenManager.getFilePath(uploadToken.resourceKey);
      await fs.writeFile(filePath, body);

      // Save metadata
      await tokenManager.saveFileMetadata({
        resourceKey: uploadToken.resourceKey,
        mimetype: uploadToken.mimetype,
        size: uploadToken.size,
        lastModified: Date.now(),
        visibility: uploadToken.visibility,
        metadata: uploadToken.metadata,
      });

      // Delete used upload token
      await tokenManager.deleteUploadToken(token);

      return new HTTPResult(200, { success: true, resourceKey: uploadToken.resourceKey });
    } catch (error) {
      console.error('File upload error:', error);
      return new HTTPResult(500, { error: 'Failed to save file' });
    }
  }

  /**
   * GET /file-storage/files/:resourceKey
   *
   * Handles file download.
   * - For public files: serves directly
   * - For private files: requires valid read token via ?token= query param
   */
  @Get('/files/*')
  async handleDownload(
    @Parameter('token', 'query') token: string | undefined,
    @Context() context: RequestContext,
  ): Promise<HTTPResult> {
    const tokenManager = getTokenManager();

    // Extract resourceKey from URL (everything after /files/)
    const url = context.url.pathname;
    const filesPrefix = '/file-storage/files/';
    const resourceKey = url.startsWith(filesPrefix) ? url.slice(filesPrefix.length) : '';

    if (!resourceKey) {
      return new HTTPResult(400, { error: 'Resource key required' });
    }

    // Decode URL-encoded characters
    const decodedResourceKey = decodeURIComponent(resourceKey);

    // Check if file exists
    const exists = await tokenManager.fileExists(decodedResourceKey);
    if (!exists) {
      return new HTTPResult(404, { error: 'File not found' });
    }

    // Get file metadata
    const metadata = await tokenManager.getFileMetadata(decodedResourceKey);
    if (!metadata) {
      return new HTTPResult(404, { error: 'File metadata not found' });
    }

    // Check visibility
    if (metadata.visibility === 'private') {
      // Private file: requires valid read token
      if (!token) {
        return new HTTPResult(403, { error: 'Access denied. Token required for private files.' });
      }

      const readToken = await tokenManager.getReadToken(token);
      if (!readToken) {
        return new HTTPResult(403, { error: 'Invalid or expired token' });
      }

      // Check token expiration
      if (readToken.expiresAt < Date.now()) {
        return new HTTPResult(403, { error: 'Token expired' });
      }

      // Verify token matches requested resource
      if (readToken.resourceKey !== decodedResourceKey) {
        return new HTTPResult(403, { error: 'Token does not match requested resource' });
      }
    }

    // Serve the file
    try {
      const filePath = tokenManager.getFilePath(decodedResourceKey);
      const fileBuffer = await fs.readFile(filePath);

      const result = new HTTPResult(200, fileBuffer, metadata.mimetype);
      result.addHeader('Content-Length', metadata.size.toString());
      result.addHeader(
        'Content-Disposition',
        `inline; filename="${metadata.metadata?.['original-filename'] || decodedResourceKey}"`,
      );
      result.addHeader(
        'Cache-Control',
        metadata.visibility === 'public' ? 'public, max-age=31536000' : 'private, no-cache',
      );

      return result;
    } catch (error) {
      console.error('File download error:', error);
      return new HTTPResult(500, { error: 'Failed to read file' });
    }
  }
}
