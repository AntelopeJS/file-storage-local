import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  CreateReadUrl,
  CreateUploadUrl,
  DeleteFile,
  FileExists,
  GetFileSeal,
  GetFileSnapshot,
  MoveFile,
  RemoveSealedFile,
  SEALED_PREFIX,
  SealFile,
} from "@antelopejs/interface-file-storage";

import { getConfig, getTokenManager } from "../index";
import { TokenManager } from "../storage/token-manager";
import { digest, readRecord } from "../storage/publication";
import type { AdmissionRecord, StoredObject } from "../storage/object-types";
import {
  admission,
  deferred,
  download,
  Mime,
  Original,
  put,
  replace,
  Replacement,
  reset,
  restart,
  sealError,
  upload,
} from "./seal-helpers";

describe("generation-bound file seals", () => {
  beforeEach(reset);
  after(reset);

  it("binds source metadata and generation, preserving immutable HTTP bytes", async () => {
    const source = await upload();
    const request = await admission(source.resourceKey);
    const sealed = await SealFile(request, "named-storage");
    assert.deepEqual(sealed.provenance, {
      admissionId: request.admissionId,
      source: request.source,
    });
    assert.equal(sealed.metadata.size, Original.length);
    assert.equal(sealed.metadata.filename, "seal.txt");
    assert.equal(sealed.metadata.mimetype, Mime);
    assert.notEqual(sealed.identity.generation, request.source.generation);
    assert.equal(sealed.identity.storageId, request.source.storageId);
    await replace(source.resourceKey);
    assert.equal(await download(source.resourceKey), Replacement);
    assert.equal(await download(request.destinationKey), Original);
    await DeleteFile(source.resourceKey);
    await restart();
    assert.deepEqual(await SealFile(request), sealed);
    assert.deepEqual(await GetFileSeal(request), {
      status: "sealed",
      file: sealed,
    });
  });

  it("rejects changed source and identical-byte reuploads as different generations", async () => {
    const source = await upload();
    const request = await admission(source.resourceKey);
    await replace(source.resourceKey, Original);
    const replayed = await GetFileSnapshot(source.resourceKey);
    assert.notEqual(replayed.identity.generation, request.source.generation);
    await assert.rejects(
      () => SealFile(request),
      sealError("GENERATION_MISMATCH"),
    );
    const changed = await admission(source.resourceKey);
    await replace(source.resourceKey);
    await assert.rejects(
      () => SealFile(changed),
      sealError("GENERATION_MISMATCH"),
    );
    assert.equal(await FileExists(request.destinationKey), false);
  });

  it("rejects a consumed upload URL replay without changing generation", async () => {
    const source = await upload();
    const snapshot = await GetFileSnapshot(source.resourceKey);
    assert.equal((await put(source, Replacement)).status, 404);
    assert.deepEqual(await GetFileSnapshot(source.resourceKey), snapshot);
  });

  it("keeps a sealed generation stable when an already validated PUT publishes later", async () => {
    const manager = getTokenManager();
    const source = await CreateUploadUrl({
      filename: "race.txt",
      size: Original.length,
      mimetype: Mime,
      staging: true,
    });
    const entered = deferred();
    const resume = deferred();
    const save = manager.saveUpload.bind(manager);
    manager.saveUpload = async (metadata, body) => {
      if (body.toString() === Replacement) {
        entered.resolve();
        await resume.promise;
      }
      await save(metadata, body);
    };
    const late = put(source, Replacement);
    try {
      await entered.promise;
      assert.equal((await put(source)).status, 200);
      const request = await admission(source.resourceKey);
      const sealed = await SealFile(request);
      resume.resolve();
      assert.equal((await late).status, 200);
      assert.equal(await download(request.destinationKey), Original);
      assert.equal(await download(source.resourceKey), Replacement);
      assert.deepEqual(await SealFile(request), sealed);
    } finally {
      resume.resolve();
      manager.saveUpload = save;
      await late;
    }
  });
});

describe("file seal admission races and cancellation", () => {
  beforeEach(reset);
  after(reset);

  it("converges concurrent same-admission calls on one identity", async () => {
    const request = await admission((await upload()).resourceKey);
    const [first, second] = await Promise.all([
      SealFile(request),
      SealFile(request),
    ]);
    assert.deepEqual(first, second);
    assert.equal(await download(request.destinationKey), Original);
  });

  it("never lets a competing admission overwrite or delete the winner", async () => {
    const first = await admission((await upload()).resourceKey);
    const second = { ...first, admissionId: randomUUID() };
    const outcomes = await Promise.allSettled([
      SealFile(first),
      SealFile(second),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    const winner = outcomes[0]?.status === "fulfilled" ? first : second;
    const loser = winner === first ? second : first;
    await assert.rejects(
      () => SealFile(loser),
      sealError("DESTINATION_CONFLICT"),
    );
    await assert.rejects(
      () => GetFileSeal(loser),
      sealError("DESTINATION_CONFLICT"),
    );
    await assert.rejects(
      () => RemoveSealedFile(loser),
      sealError("DESTINATION_CONFLICT"),
    );
    assert.equal(await download(winner.destinationKey), Original);
    assert.equal((await GetFileSeal(winner)).status, "sealed");
  });

  it("rejects changed tuples for all admission operations", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    const changed = {
      ...request,
      source: { ...request.source, generation: randomUUID() },
    };
    for (const operation of [SealFile, GetFileSeal, RemoveSealedFile]) {
      await assert.rejects(
        () => operation(changed),
        sealError("DESTINATION_CONFLICT"),
      );
    }
    assert.equal(await download(request.destinationKey), Original);
  });

  it("fences a delayed first seal before publication and across restart", async () => {
    const request = await admission((await upload()).resourceKey);
    assert.deepEqual(await GetFileSeal(request), { status: "absent" });
    await RemoveSealedFile(request);
    await assert.rejects(
      () => SealFile(request),
      sealError("ADMISSION_REMOVED"),
    );
    await restart();
    assert.deepEqual(await GetFileSeal(request), { status: "removed" });
    await assert.rejects(
      () => SealFile(request),
      sealError("ADMISSION_REMOVED"),
    );
    assert.equal(await FileExists(request.destinationKey), false);
  });

  it("removes a seal racing before cancellation and denies previously issued HTTP URLs", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    const read = await CreateReadUrl(request.destinationKey);
    const outcomes = await Promise.allSettled([
      SealFile(request),
      RemoveSealedFile(request),
    ]);
    assert.equal(outcomes[1]?.status, "fulfilled");
    if (outcomes[0]?.status === "rejected")
      assert.ok(sealError("ADMISSION_REMOVED")(outcomes[0].reason));
    assert.equal((await fetch(read.url)).status, 404);
    assert.deepEqual(await GetFileSeal(request), { status: "removed" });
    await assert.rejects(
      () => SealFile(request),
      sealError("ADMISSION_REMOVED"),
    );
  });
});

describe("file seal ownership and publication recovery", () => {
  beforeEach(reset);
  after(reset);

  it("keeps replacement generations when old removal is retried", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    await RemoveSealedFile(request);
    const source = await upload();
    await replace(source.resourceKey);
    const replacement = {
      ...(await admission(source.resourceKey)),
      destinationKey: request.destinationKey,
    };
    await assert.rejects(
      () => SealFile(replacement),
      sealError("DESTINATION_CONFLICT"),
    );
    const root = join(getConfig().storagePath, ".immutable");
    const candidate = await readRecord<AdmissionRecord>(
      join(root, "admissions", `${digest(replacement.admissionId)}.json`),
    );
    assert.ok(candidate);
    await fs.writeFile(
      join(root, "entries", `${digest(request.destinationKey)}.json`),
      JSON.stringify(candidate.object),
    );
    await assert.rejects(
      () => RemoveSealedFile(request),
      sealError("DESTINATION_CONFLICT"),
    );
    assert.equal((await GetFileSeal(replacement)).status, "sealed");
    assert.equal(await download(request.destinationKey), Replacement);
  });

  it("repairs private-data-before-destination publication from durable admission after restart", async () => {
    const request = await admission((await upload()).resourceKey);
    const link = fs.link;
    fs.link = async (source, destination) => {
      if (String(destination).includes("/entries/"))
        throw new Error("injected publication interruption");
      await link(source, destination);
    };
    try {
      await assert.rejects(
        () => SealFile(request),
        sealError("OUTCOME_UNKNOWN"),
      );
    } finally {
      fs.link = link;
    }
    assert.equal(await FileExists(request.destinationKey), false);
    await DeleteFile(request.source.resourceKey);
    await restart();
    const state = await GetFileSeal(request);
    assert.equal(state.status, "sealed");
    assert.equal(await download(request.destinationKey), Original);
    if (state.status === "sealed")
      assert.deepEqual(await SealFile(request), state.file);
  });

  it("reconciles an acknowledged-unknown commit without inventing a new generation", async () => {
    const request = await admission((await upload()).resourceKey);
    const link = fs.link;
    fs.link = async (source, destination) => {
      await link(source, destination);
      if (String(destination).includes("/entries/"))
        throw new Error("injected lost acknowledgement");
    };
    try {
      await assert.rejects(
        () => SealFile(request),
        sealError("OUTCOME_UNKNOWN"),
      );
    } finally {
      fs.link = link;
    }
    const snapshot = await GetFileSnapshot(request.destinationKey);
    await restart();
    assert.deepEqual((await SealFile(request)).identity, snapshot.identity);
    assert.equal(await download(request.destinationKey), Original);
  });

  it("hides a removed generation after tombstone commit even if acknowledgement is lost", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    const read = await CreateReadUrl(request.destinationKey);
    const link = fs.link;
    fs.link = async (source, destination) => {
      await link(source, destination);
      if (String(destination).includes("/removed/"))
        throw new Error("injected removal acknowledgement interruption");
    };
    try {
      await assert.rejects(
        () => RemoveSealedFile(request),
        sealError("OUTCOME_UNKNOWN"),
      );
    } finally {
      fs.link = link;
    }
    await restart();
    assert.equal((await fetch(read.url)).status, 404);
    assert.deepEqual(await GetFileSeal(request), { status: "removed" });
    await assert.rejects(
      () => SealFile(request),
      sealError("ADMISSION_REMOVED"),
    );
    await RemoveSealedFile(request);
  });
});

describe("file seal state and namespace validation", () => {
  beforeEach(reset);
  after(reset);

  it("fails closed on corrupt admission state rather than reporting absent", async () => {
    const request = await admission((await upload()).resourceKey);
    await fs.writeFile(
      join(
        getConfig().storagePath,
        ".immutable",
        "admissions",
        `${digest(request.admissionId)}.json`,
      ),
      "broken",
    );
    for (const operation of [GetFileSeal, SealFile, RemoveSealedFile]) {
      await assert.rejects(
        () => operation(request),
        sealError("OUTCOME_UNKNOWN"),
      );
    }
  });

  it("uses stable backing-store identity across restart and aliases, not configuration names", async () => {
    const source = await upload();
    const first = await GetFileSnapshot(source.resourceKey, "first-alias");
    await restart();
    assert.deepEqual(
      await GetFileSnapshot(source.resourceKey, "second-alias"),
      first,
    );
    const alias = new TokenManager(join(getConfig().storagePath, "."));
    await alias.initialize();
    assert.deepEqual(await alias.objects.snapshot(source.resourceKey), first);
    const request = await admission(source.resourceKey);
    await reset();
    await assert.rejects(
      () => SealFile(request),
      sealError("STORAGE_MISMATCH"),
    );
  });

  it("reserves sealed keys from legacy mutation APIs", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    for (const operation of [
      () => DeleteFile(request.destinationKey),
      () => MoveFile(request.source.resourceKey, request.destinationKey),
      () => MoveFile(request.destinationKey, "moved.txt"),
      () =>
        CreateUploadUrl({
          filename: "bad.txt",
          size: Original.length,
          mimetype: Mime,
          path: SEALED_PREFIX,
        }),
    ])
      await assert.rejects(operation, sealError("INVALID_REQUEST"));
    assert.equal(await download(request.destinationKey), Original);
  });

  it("rejects unreserved and malformed seal destinations without publication", async () => {
    const request = await admission((await upload()).resourceKey);
    for (const destinationKey of [
      "plain.txt",
      `${SEALED_PREFIX}../bad`,
      SEALED_PREFIX,
    ]) {
      await assert.rejects(
        () => SealFile({ ...request, destinationKey }),
        sealError("INVALID_REQUEST"),
      );
    }
    assert.deepEqual(await GetFileSeal(request), { status: "absent" });
  });

  it("expires managed staging entries without deleting admitted bytes", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    const removed = await getTokenManager().cleanupExpiredStagingFiles(-1);
    assert.equal(removed, 1);
    assert.equal(await FileExists(request.source.resourceKey), false);
    assert.equal(await download(request.destinationKey), Original);
    assert.equal(
      (await SealFile(request)).identity.resourceKey,
      request.destinationKey,
    );
  });

  it("fails closed on a published slot with missing metadata", async () => {
    const request = await admission((await upload()).resourceKey);
    await SealFile(request);
    const path = join(
      getConfig().storagePath,
      ".immutable",
      "entries",
      `${digest(request.destinationKey)}.json`,
    );
    const incomplete: Partial<StoredObject> = {
      ...(await readRecord<StoredObject>(path)),
    };
    delete incomplete.metadata;
    await fs.writeFile(path, JSON.stringify(incomplete));
    await restart();
    for (const operation of [SealFile, GetFileSeal]) {
      await assert.rejects(
        () => operation(request),
        sealError("OUTCOME_UNKNOWN"),
      );
    }
    await assert.rejects(
      () => GetFileSnapshot(request.destinationKey),
      sealError("OUTCOME_UNKNOWN"),
    );
    await assert.rejects(() => FileExists(request.destinationKey));
  });
});
