import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type {
  FileMetadata,
  UploadRequest,
} from "@antelopejs/interface-file-storage";

const MetadataSuffix = ".json";
const KeyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface AttachmentUploadToken {
  token: string;
  resourceKey: string;
  request: UploadRequest;
  expiresAt: number;
}

export interface AttachmentReadToken {
  resourceKey: string;
  expiresAt: number;
}

export class AttachmentManager {
  private readonly root: string;
  private readonly temporary: string;
  private readonly privateFiles: string;
  private readonly publicFiles: string;
  private readonly metadata: string;
  private readonly tokens = new Map<string, AttachmentUploadToken>();
  private readonly readTokens = new Map<string, AttachmentReadToken>();
  private readonly preparations = new Map<string, Promise<void>>();

  constructor(storagePath: string) {
    this.root = resolve(storagePath, "attachments");
    this.temporary = join(this.root, "temporary");
    this.privateFiles = join(this.root, "private");
    this.publicFiles = join(this.root, "public");
    this.metadata = join(this.root, "metadata");
  }

  async initialize(genericPath: string): Promise<void> {
    await Promise.all(
      [this.temporary, this.privateFiles, this.publicFiles, this.metadata].map(
        (path) => fs.mkdir(path, { recursive: true }),
      ),
    );
    await this.assertIsolated(genericPath);
  }

  createUpload(
    request: UploadRequest,
    expiresAt: number,
  ): AttachmentUploadToken {
    const resourceKey = `${randomUUID()}${this.extension(request.filename)}`;
    const token = randomUUID();
    const upload = { token, resourceKey, request, expiresAt };
    this.tokens.set(token, upload);
    return upload;
  }

  consumeUpload(token: string): AttachmentUploadToken | undefined {
    const upload = this.tokens.get(token);
    if (upload) this.tokens.delete(token);
    return upload;
  }

  createReadToken(resourceKey: string, expiresAt: number): string {
    this.validateKey(resourceKey);
    const token = randomUUID();
    this.readTokens.set(token, { resourceKey, expiresAt });
    return token;
  }

  getReadToken(token: string): AttachmentReadToken | undefined {
    return this.readTokens.get(token);
  }

  async storeTemporary(
    upload: AttachmentUploadToken,
    body: Buffer,
  ): Promise<void> {
    await fs.writeFile(this.path(this.temporary, upload.resourceKey), body, {
      flag: "wx",
    });
    await this.writeMetadata(upload.resourceKey, upload.request);
  }

  prepare(sourceKey: string, destinationKey: string): Promise<void> {
    this.validateKey(sourceKey);
    this.validateKey(destinationKey);
    const existing = this.preparations.get(destinationKey);
    if (existing) return existing;
    const preparation = this.copyImmutable(sourceKey, destinationKey).finally(
      () => this.preparations.delete(destinationKey),
    );
    this.preparations.set(destinationKey, preparation);
    return preparation;
  }

  async publish(resourceKey: string): Promise<void> {
    this.validateKey(resourceKey);
    await this.copyFileImmutable(
      this.path(this.privateFiles, resourceKey),
      this.path(this.publicFiles, resourceKey),
    );
  }

  async metadataFor(resourceKey: string): Promise<FileMetadata> {
    this.validateKey(resourceKey);
    const content = await fs.readFile(this.metadataPath(resourceKey), "utf8");
    return JSON.parse(content) as FileMetadata;
  }

  private async copyImmutable(
    sourceKey: string,
    destinationKey: string,
  ): Promise<void> {
    const destination = this.path(this.privateFiles, destinationKey);
    try {
      await fs.access(destination);
      return;
    } catch {}
    await this.copyFileImmutable(
      this.path(this.temporary, sourceKey),
      destination,
    );
    const sourceMetadata = await this.metadataFor(sourceKey);
    await this.writeMetadataFile(destinationKey, {
      ...sourceMetadata,
      resourceKey: destinationKey,
    });
  }

  private async copyFileImmutable(
    source: string,
    destination: string,
  ): Promise<void> {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.copyFile(source, temporary);
    try {
      await fs.link(temporary, destination);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  async readPath(resourceKey: string): Promise<string> {
    this.validateKey(resourceKey);
    const path = this.path(this.privateFiles, resourceKey);
    await fs.access(path);
    return path;
  }

  publicPath(resourceKey: string): string {
    this.validateKey(resourceKey);
    return this.path(this.publicFiles, resourceKey);
  }

  async delete(resourceKey: string): Promise<void> {
    this.validateKey(resourceKey);
    await Promise.all(
      [this.temporary, this.privateFiles, this.publicFiles].map((root) =>
        fs.unlink(this.path(root, resourceKey)).catch(() => undefined),
      ),
    );
    await fs.unlink(this.metadataPath(resourceKey)).catch(() => undefined);
  }

  private async writeMetadata(
    resourceKey: string,
    request: UploadRequest,
  ): Promise<void> {
    const metadata: FileMetadata = {
      resourceKey,
      filename: request.filename,
      size: request.size,
      mimetype: request.mimetype,
      lastModified: Date.now(),
    };
    if (request.metadata) metadata.metadata = request.metadata;
    await this.writeMetadataFile(resourceKey, metadata);
  }

  private async writeMetadataFile(
    resourceKey: string,
    metadata: FileMetadata,
  ): Promise<void> {
    await fs
      .writeFile(this.metadataPath(resourceKey), JSON.stringify(metadata), {
        flag: "wx",
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
  }

  private metadataPath(key: string): string {
    return this.path(this.metadata, `${key}${MetadataSuffix}`);
  }
  private path(root: string, key: string): string {
    this.validateKey(key.replace(MetadataSuffix, ""));
    return join(root, key);
  }
  private validateKey(key: string): void {
    if (!KeyPattern.test(key) || basename(key) !== key)
      throw new Error("Invalid attachment resource key");
  }
  private extension(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot < 0 ? "" : filename.slice(dot);
  }

  private async assertIsolated(genericPath: string): Promise<void> {
    const [generic, attachment] = await Promise.all([
      fs.realpath(genericPath),
      fs.realpath(this.root),
    ]);
    const relation = relative(generic, attachment);
    if (!relation || (!relation.startsWith(`..${sep}`) && relation !== ".."))
      throw new Error(
        "Attachment storage must not be inside generic storage roots",
      );
  }
}
