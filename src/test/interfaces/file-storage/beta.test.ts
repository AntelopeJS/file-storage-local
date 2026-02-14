import assert from 'assert/strict';
import { promises as fs } from 'fs';
import {
  CreateUploadUrl,
  CreateReadUrl,
  DeleteFile,
  FileExists,
  GetFileMetadata,
  UploadValidationError,
  FileNotFoundError,
} from '@ajs.local/file-storage/beta';
import { getConfig, getTokenManager } from '../../../index';
import type { StoredFileMetadata, TokenManager } from '../../../storage/token-manager';

const ExistingResourceKey = 'seed/existing.txt';
const MetadataOnlyResourceKey = 'seed/metadata-only.txt';
const MissingResourceKey = 'seed/missing.txt';
const SeedTimestamp = 1767225600000;
const ExistingFileContent = 'existing file content';

interface SeedFile {
  resourceKey: string;
  content: string;
  mimetype: string;
  metadata?: Record<string, string>;
}

const SeedFiles: SeedFile[] = [
  {
    resourceKey: ExistingResourceKey,
    content: ExistingFileContent,
    mimetype: 'text/plain',
    metadata: {
      filename: 'existing.txt',
      source: 'seed',
    },
  },
  {
    resourceKey: MetadataOnlyResourceKey,
    content: 'metadata only file content',
    mimetype: 'text/plain',
    metadata: {
      source: 'imported',
    },
  },
];

describe('file-storage interface', () => {
  beforeEach(async () => {
    await resetStorage();
    await seedStorage();
  });

  after(async () => {
    await resetStorage();
  });

  it('creates an upload URL with required headers', async () => {
    const response = await CreateUploadUrl(
      {
        filename: 'avatar.png',
        size: 128,
        mimetype: 'image/png',
        path: '/uploads/',
        metadata: { source: 'profile' },
      },
      {
        maxSize: 256,
        allowedMimetypes: ['image/png'],
      },
    );

    assert.ok(response.uploadUrl.includes('/file-storage/upload/'));
    assert.ok(response.resourceKey.endsWith('.png'));
    assert.equal(response.headers['Content-Type'], 'image/png');
    assert.equal(response.headers['Content-Length'], '128');
    assert.ok(response.expiresAt > Date.now());
  });

  it('validates upload max size constraints', async () => {
    await assert.rejects(
      () =>
        CreateUploadUrl(
          {
            filename: 'oversized.txt',
            size: 20,
            mimetype: 'text/plain',
          },
          { maxSize: 10 },
        ),
      (error: unknown) =>
        error instanceof UploadValidationError && error.code === 'SIZE_EXCEEDED' && error.message.includes('20'),
    );
  });

  it('validates upload mimetype constraints', async () => {
    await assert.rejects(
      () =>
        CreateUploadUrl(
          {
            filename: 'document.pdf',
            size: 10,
            mimetype: 'application/pdf',
          },
          { allowedMimetypes: ['image/png', 'image/jpeg'] },
        ),
      (error: unknown) =>
        error instanceof UploadValidationError &&
        error.code === 'MIMETYPE_NOT_ALLOWED' &&
        error.message.includes('pdf'),
    );
  });

  it('returns presigned read URL and expiration for private files', async () => {
    const response = await CreateReadUrl(ExistingResourceKey, 120);
    const expectedPrefix = `${getConfig().baseUrl}/file-storage/files/${encodeURIComponent(ExistingResourceKey)}?token=`;

    assert.ok(response.url.startsWith(expectedPrefix));
    assert.ok((response.expiresAt ?? 0) > Date.now());
  });

  it('returns public read URL when default visibility is public', async () => {
    const config = getConfig();
    const previousVisibility = config.defaultVisibility;
    config.defaultVisibility = 'public';

    try {
      const response = await CreateReadUrl(ExistingResourceKey);
      const expectedUrl = `${config.baseUrl}/file-storage/files/${encodeURIComponent(ExistingResourceKey)}`;

      assert.equal(response.url, expectedUrl);
      assert.equal(response.expiresAt, undefined);
    } finally {
      config.defaultVisibility = previousVisibility;
    }
  });

  it('returns true when file exists', async () => {
    const exists = await FileExists(ExistingResourceKey);
    assert.equal(exists, true);
  });

  it('returns false when file does not exist', async () => {
    const exists = await FileExists(MissingResourceKey);
    assert.equal(exists, false);
  });

  it('returns metadata for existing files', async () => {
    const metadata = await GetFileMetadata(ExistingResourceKey);

    assert.equal(metadata.resourceKey, ExistingResourceKey);
    assert.equal(metadata.filename, 'existing.txt');
    assert.equal(metadata.size, ExistingFileContent.length);
    assert.equal(metadata.mimetype, 'text/plain');
    assert.equal(metadata.lastModified, SeedTimestamp);
    assert.deepEqual(metadata.metadata, {
      filename: 'existing.txt',
      source: 'seed',
    });
  });

  it('throws FileNotFoundError when metadata is requested for missing files', async () => {
    await assert.rejects(() => GetFileMetadata(MissingResourceKey), (error: unknown) => error instanceof FileNotFoundError);
  });

  it('deletes files from storage', async () => {
    const existsBeforeDelete = await FileExists(ExistingResourceKey);
    assert.equal(existsBeforeDelete, true);

    await DeleteFile(ExistingResourceKey);

    const existsAfterDelete = await FileExists(ExistingResourceKey);
    assert.equal(existsAfterDelete, false);
  });

  it('defaults filename to empty string when metadata filename is not set', async () => {
    const metadata = await GetFileMetadata(MetadataOnlyResourceKey);
    assert.equal(metadata.filename, '');
    assert.deepEqual(metadata.metadata, { source: 'imported' });
  });
});

async function resetStorage(): Promise<void> {
  const storagePath = getConfig().storagePath;
  const tokenManager = getTokenManager();
  await fs.rm(storagePath, { recursive: true, force: true });
  await tokenManager.initialize();
}

async function seedStorage(): Promise<void> {
  const tokenManager = getTokenManager();
  for (const seedFile of SeedFiles) {
    await seedFileStorage(tokenManager, seedFile);
  }
}

async function seedFileStorage(tokenManager: TokenManager, seedFile: SeedFile): Promise<void> {
  await tokenManager.ensureFileDirectory(seedFile.resourceKey);
  const filePath = tokenManager.getFilePath(seedFile.resourceKey);
  await fs.writeFile(filePath, seedFile.content);
  await tokenManager.saveFileMetadata(buildStoredFileMetadata(seedFile));
}

function buildStoredFileMetadata(seedFile: SeedFile): StoredFileMetadata {
  const metadata: StoredFileMetadata = {
    resourceKey: seedFile.resourceKey,
    mimetype: seedFile.mimetype,
    size: seedFile.content.length,
    lastModified: SeedTimestamp,
  };
  if (seedFile.metadata) {
    metadata.metadata = seedFile.metadata;
  }
  return metadata;
}
