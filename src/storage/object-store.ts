import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import {
  FileNotFoundError,
  FileSealError,
  isStagedKey,
  SEALED_PREFIX,
  type FileSealState,
  type FileSnapshot,
  type RemovedFileSeal,
  type SealedFile,
  type SealFileRequest,
} from "@antelopejs/interface-file-storage";

import type { StoredFileMetadata } from "./token-manager";
import type {
  AdmissionRecord,
  LegacyStorage,
  RemovalRecord,
  StoredObject,
  StoreIdentity,
} from "./object-types";
import {
  createRecord,
  digest,
  hasCode,
  publishRecord,
  readRecord,
  syncDirectory,
  writeDurable,
} from "./publication";

const DirectoryNames = [
  "objects",
  "entries",
  "bindings",
  "admissions",
  "removed",
];

export class ObjectStore {
  private storageId = "";
  private root: string;

  constructor(
    storagePath: string,
    private readonly legacy: LegacyStorage,
  ) {
    this.root = join(storagePath, ".immutable");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    this.root = await fs.realpath(this.root);
    await Promise.all(
      DirectoryNames.map((name) =>
        fs.mkdir(join(this.root, name), { recursive: true }),
      ),
    );
    const path = join(this.root, "identity.json");
    const identity = await createRecord<StoreIdentity>(path, {
      storageId: randomUUID(),
    });
    if (!identity?.storageId) throw new Error("Invalid local storage identity");
    this.storageId = identity.storageId;
    await syncDirectory(this.root);
    await syncDirectory(dirname(this.root));
  }

  private path(directory: string, key: string): string {
    return join(this.root, directory, `${digest(key)}.json`);
  }

  dataPath(objectId: string): string {
    return join(this.root, "objects", objectId);
  }

  async read(resourceKey: string): Promise<StoredObject | undefined> {
    const object = await readRecord<StoredObject>(
      this.path("entries", resourceKey),
    );
    if (!object) return undefined;
    if (object?.request && (await this.removal(object.request)))
      return undefined;
    this.assertObject(object);
    if (resourceKey.startsWith(SEALED_PREFIX)) {
      if (!object.request)
        throw new Error("Sealed destination lacks provenance");
      const record = await this.admission(object.request);
      if (!record)
        throw new Error("Sealed destination lacks durable admission");
      this.assertPublishedObject(object, record.object);
    }
    return object;
  }

  async upload(metadata: StoredFileMetadata, body: Buffer): Promise<void> {
    this.assertMutable(metadata.resourceKey);
    const object = this.createObject(metadata);
    await writeDurable(this.dataPath(object.objectId), body);
    await syncDirectory(join(this.root, "objects"));
    await publishRecord(
      this.path("entries", metadata.resourceKey),
      object,
      true,
    );
  }

  private createObject(metadata: StoredFileMetadata): StoredObject {
    const generation = randomUUID();
    return {
      objectId: generation,
      metadata,
      snapshot: {
        identity: {
          storageId: this.storageId,
          resourceKey: metadata.resourceKey,
          generation,
        },
        metadata: {
          resourceKey: metadata.resourceKey,
          filename: metadata.metadata?.filename ?? "",
          size: metadata.size,
          mimetype: metadata.mimetype,
          lastModified: metadata.lastModified,
          ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
        },
      },
    };
  }

  async snapshot(resourceKey: string): Promise<FileSnapshot> {
    return this.guarded(async () => {
      if (!this.validKey(resourceKey))
        throw new FileSealError("Malformed resource key", "INVALID_REQUEST");
      const object = await this.read(resourceKey);
      if (object) {
        await fs.access(this.dataPath(object.objectId));
        return object.snapshot;
      }
      if (
        await readRecord<StoredFileMetadata>(
          this.legacy.getMetadataPath(resourceKey),
        )
      ) {
        throw new FileSealError(
          "Legacy objects must be uploaded again before sealing",
          "UNSUPPORTED",
        );
      }
      throw new FileNotFoundError(resourceKey);
    });
  }

  async seal(request: SealFileRequest): Promise<SealedFile> {
    return this.guarded(async () => {
      await this.validate(request);
      await this.bind(request);
      if (await this.removal(request))
        throw new FileSealError("Admission was removed", "ADMISSION_REMOVED");
      const record =
        (await this.admission(request)) ?? (await this.prepare(request));
      if (!(await this.publish(record)))
        throw new FileSealError("Admission was removed", "ADMISSION_REMOVED");
      return this.sealed(record.object);
    });
  }

  async state(request: SealFileRequest): Promise<FileSealState> {
    return this.guarded(async () => {
      await this.validate(request);
      if (await this.removal(request)) return { status: "removed" };
      const record = await this.observedAdmission(request);
      if (!record) {
        await this.assertNoLegacyDestination(request.destinationKey);
        return { status: (await this.removal(request)) ? "removed" : "absent" };
      }
      if (!(await this.publish(record))) return { status: "removed" };
      return { status: "sealed", file: this.sealed(record.object) };
    });
  }

  async remove(request: SealFileRequest): Promise<RemovedFileSeal> {
    return this.guarded(async () => {
      await this.validate(request);
      await this.bind(request);
      await this.admission(request);
      const removed = await createRecord<RemovalRecord>(
        this.path("removed", request.admissionId),
        { request },
      );
      this.assertRequest(removed.request, request);
      await this.assertRemovalOwnership(request);
      return { status: "removed" };
    });
  }

  private async prepare(request: SealFileRequest): Promise<AdmissionRecord> {
    const source = await this.read(request.source.resourceKey);
    if (
      !source ||
      source.snapshot.identity.generation !== request.source.generation
    ) {
      const recorded = await this.admission(request);
      if (recorded) return recorded;
      if (!source) throw new FileNotFoundError(request.source.resourceKey);
      throw new FileSealError(
        "Source generation changed or disappeared",
        "GENERATION_MISMATCH",
      );
    }
    await fs.access(this.dataPath(source.objectId));
    const metadata = {
      ...source.metadata,
      resourceKey: request.destinationKey,
    };
    delete metadata.path;
    const object = this.createObject(metadata);
    object.objectId = source.objectId;
    object.request = request;
    const record = await createRecord<AdmissionRecord>(
      this.path("admissions", request.admissionId),
      { request, object },
    );
    this.assertRequest(record.request, request);
    return record;
  }

  private async publish(record: AdmissionRecord): Promise<boolean> {
    await syncDirectory(join(this.root, "admissions"));
    if (await this.removal(record.request)) return false;
    await this.assertNoLegacyDestination(record.request.destinationKey);
    await fs.access(this.dataPath(record.object.objectId));
    const current = await createRecord<StoredObject>(
      this.path("entries", record.request.destinationKey),
      record.object,
    );
    this.assertObject(current);
    if (
      current.snapshot.identity.generation !==
      record.object.snapshot.identity.generation
    ) {
      throw new FileSealError(
        "Destination is owned by another generation",
        "DESTINATION_CONFLICT",
      );
    }
    this.assertPublishedObject(current, record.object);
    return !(await this.removal(record.request));
  }

  private async observedAdmission(
    request: SealFileRequest,
  ): Promise<AdmissionRecord | undefined> {
    const record = await this.admission(request);
    if (record) return record;
    const current = await readRecord<StoredObject>(
      this.path("entries", request.destinationKey),
    );
    if (!current) return undefined;
    if (!current.request)
      throw new FileSealError(
        "Destination lacks admission provenance",
        "DESTINATION_CONFLICT",
      );
    this.assertRequest(current.request, request);
    const committed = await this.admission(request);
    if (!committed)
      throw new Error("Destination is missing its durable admission");
    return committed;
  }

  private async assertNoLegacyDestination(key: string): Promise<void> {
    const metadata = await readRecord<StoredFileMetadata>(
      this.legacy.getMetadataPath(key),
    );
    let legacyExists = false;
    try {
      await fs.access(this.legacy.getFilePath(key, metadata?.path));
      legacyExists = true;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (metadata || legacyExists)
      throw new FileSealError("Destination exists", "DESTINATION_CONFLICT");
  }

  private async assertRemovalOwnership(
    request: SealFileRequest,
  ): Promise<void> {
    const path = this.path("entries", request.destinationKey);
    const current = await readRecord<StoredObject>(path);
    const record = await this.admission(request);
    if (!current) {
      await this.assertNoLegacyDestination(request.destinationKey);
      return;
    }
    if (
      !record ||
      current.snapshot.identity.generation !==
        record.object.snapshot.identity.generation
    ) {
      throw new FileSealError(
        "Destination is owned by another generation",
        "DESTINATION_CONFLICT",
      );
    }
  }

  private async admission(
    request: SealFileRequest,
  ): Promise<AdmissionRecord | undefined> {
    const record = await readRecord<AdmissionRecord>(
      this.path("admissions", request.admissionId),
    );
    if (record) {
      this.assertRequest(record.request, request);
      this.assertObject(record.object);
    }
    return record;
  }

  private async removal(
    request: SealFileRequest,
  ): Promise<RemovalRecord | undefined> {
    const record = await readRecord<RemovalRecord>(
      this.path("removed", request.admissionId),
    );
    if (record) {
      this.assertRequest(record.request, request);
      await syncDirectory(join(this.root, "removed"));
    }
    return record;
  }

  private async bind(request: SealFileRequest): Promise<void> {
    const path = this.path("bindings", request.admissionId);
    const binding = await createRecord<RemovalRecord>(path, { request });
    this.assertRequest(binding.request, request);
  }

  private assertRequest(
    actual: SealFileRequest,
    expected: SealFileRequest,
  ): void {
    if (
      actual.destinationKey !== expected.destinationKey ||
      actual.admissionId !== expected.admissionId ||
      actual.source.storageId !== expected.source.storageId ||
      actual.source.resourceKey !== expected.source.resourceKey ||
      actual.source.generation !== expected.source.generation
    ) {
      throw new FileSealError(
        "Admission is bound to another request",
        "DESTINATION_CONFLICT",
      );
    }
  }

  private async validate(request: SealFileRequest): Promise<void> {
    const values = [
      request?.admissionId,
      request?.destinationKey,
      request?.source?.storageId,
      request?.source?.resourceKey,
      request?.source?.generation,
    ];
    if (
      values.some((value) => typeof value !== "string" || !value.length) ||
      request.destinationKey === request.source.resourceKey ||
      !request.destinationKey.startsWith(SEALED_PREFIX) ||
      !this.validKey(request.destinationKey) ||
      !this.validKey(request.source.resourceKey)
    ) {
      throw new FileSealError("Malformed seal request", "INVALID_REQUEST");
    }
    if (request.source.storageId !== this.storageId)
      throw new FileSealError("Backing store changed", "STORAGE_MISMATCH");
    const binding = await readRecord<RemovalRecord>(
      this.path("bindings", request.admissionId),
    );
    if (binding) this.assertRequest(binding.request, request);
  }

  private validKey(key: string): boolean {
    return (
      typeof key === "string" &&
      !key.includes("\\") &&
      !key.includes("\0") &&
      key
        .split("/")
        .every((part) => part !== ".." && part !== "." && part !== "")
    );
  }

  private assertObject(object: StoredObject): void {
    const identity = object?.snapshot?.identity;
    const metadata = object?.snapshot?.metadata;
    const stored = object?.metadata;
    const identifiers = [
      object?.objectId,
      identity?.storageId,
      identity?.generation,
      identity?.resourceKey,
    ];
    if (
      identifiers.some((value) => typeof value !== "string" || !value.length) ||
      !metadata ||
      !stored ||
      metadata.resourceKey !== identity.resourceKey ||
      stored.resourceKey !== identity.resourceKey ||
      typeof metadata.filename !== "string" ||
      typeof metadata.mimetype !== "string" ||
      !Number.isFinite(metadata.size) ||
      !Number.isFinite(metadata.lastModified) ||
      stored.size !== metadata.size ||
      stored.mimetype !== metadata.mimetype ||
      stored.lastModified !== metadata.lastModified
    ) {
      throw new Error("Incomplete immutable object manifest");
    }
  }

  private assertPublishedObject(
    actual: StoredObject,
    expected: StoredObject,
  ): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error("Published manifest differs from durable admission");
  }

  private sealed(object: StoredObject): SealedFile {
    if (!object.request) throw new Error("Missing admission provenance");
    return {
      ...object.snapshot,
      provenance: {
        admissionId: object.request.admissionId,
        source: object.request.source,
      },
    };
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof FileSealError || error instanceof FileNotFoundError)
        throw error;
      throw new FileSealError(
        "Local publication outcome could not be established; reconcile the same request",
        "OUTCOME_UNKNOWN",
      );
    }
  }

  async delete(resourceKey: string): Promise<boolean> {
    this.assertMutable(resourceKey);
    const object = await readRecord<StoredObject>(
      this.path("entries", resourceKey),
    );
    if (!object) return false;
    await fs.rm(this.path("entries", resourceKey), { force: true });
    await syncDirectory(join(this.root, "entries"));
    return true;
  }

  async cleanupStaging(cutoff: number): Promise<number> {
    let removed = 0;
    for (const name of await fs.readdir(join(this.root, "entries"))) {
      if (!name.endsWith(".json")) continue;
      const object = await readRecord<StoredObject>(
        join(this.root, "entries", name),
      );
      if (
        !object ||
        object.request ||
        !isStagedKey(object.metadata.resourceKey) ||
        object.metadata.lastModified >= cutoff
      )
        continue;
      await this.delete(object.metadata.resourceKey);
      removed++;
    }
    return removed;
  }

  async move(sourceKey: string, destinationKey: string): Promise<boolean> {
    this.assertMutable(sourceKey);
    this.assertMutable(destinationKey);
    const source = await this.read(sourceKey);
    if (!source) return false;
    const metadata = { ...source.metadata, resourceKey: destinationKey };
    delete metadata.path;
    const moved = this.createObject(metadata);
    moved.objectId = source.objectId;
    await publishRecord(this.path("entries", destinationKey), moved, true);
    await this.delete(sourceKey);
    return true;
  }

  private assertMutable(key: string): void {
    if (key.startsWith(SEALED_PREFIX))
      throw new FileSealError("Reserved sealed namespace", "INVALID_REQUEST");
  }
}
