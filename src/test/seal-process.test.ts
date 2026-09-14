import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CreateReadUrl,
  FileExists,
  FileNotFoundError,
  GetFileSeal,
  GetFileSnapshot,
  RemoveSealedFile,
  SealFile,
} from "@antelopejs/interface-file-storage";

import { getConfig } from "../index";
import { CrashExitCode } from "./seal-process-types";
import { startSealProcess } from "./seal-process-helpers";
import {
  admission,
  download,
  Original,
  replace,
  Replacement,
  reset,
  restart,
  sealError,
  upload,
} from "./seal-helpers";

const ProcessTimeoutMs = 10_000;

describe("independent-process seal publication", function () {
  this.timeout(ProcessTimeoutMs);
  beforeEach(reset);
  after(reset);

  it("fences publication paused in another process without waiting for that process", async () => {
    const request = await admission((await upload()).resourceKey);
    const worker = startSealProcess({
      storagePath: getConfig().storagePath,
      request,
      pauseAt: "entries",
    });
    await worker.paused;
    try {
      assert.deepEqual(await RemoveSealedFile(request), { status: "removed" });
      assert.equal(await FileExists(request.destinationKey), false);
    } finally {
      worker.resume();
    }
    const outcome = await worker.done;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.code, "ADMISSION_REMOVED");
    await restart();
    assert.deepEqual(await GetFileSeal(request), { status: "removed" });
    await assert.rejects(
      () => GetFileSnapshot(request.destinationKey),
      FileNotFoundError,
    );
    await assert.rejects(
      () => CreateReadUrl(request.destinationKey),
      FileNotFoundError,
    );
    assert.equal(await FileExists(request.destinationKey), false);
    const replay = startSealProcess({
      storagePath: getConfig().storagePath,
      request,
    });
    assert.equal((await replay.done).code, "ADMISSION_REMOVED");
  });

  it("converges independent same-admission candidate races on one durable identity", async () => {
    const request = await admission((await upload()).resourceKey);
    const options = {
      storagePath: getConfig().storagePath,
      request,
      pauseAt: "admissions" as const,
    };
    const first = startSealProcess(options);
    const second = startSealProcess(options);
    await Promise.all([first.paused, second.paused]);
    first.resume();
    second.resume();
    const outcomes = await Promise.all([first.done, second.done]);
    assert.equal(outcomes[0].status, "fulfilled");
    assert.equal(outcomes[1].status, "fulfilled");
    assert.deepEqual(outcomes[0].file, outcomes[1].file);
    assert.deepEqual(await SealFile(request), outcomes[0].file);
    assert.equal(await download(request.destinationKey), Original);
  });

  it("keeps one owner and its exact bytes under independent different-admission races", async () => {
    const firstRequest = await admission((await upload()).resourceKey);
    const source = await upload();
    await replace(source.resourceKey);
    const secondRequest = {
      ...(await admission(source.resourceKey)),
      destinationKey: firstRequest.destinationKey,
    };
    const first = startSealProcess({
      storagePath: getConfig().storagePath,
      request: firstRequest,
      pauseAt: "entries",
    });
    const second = startSealProcess({
      storagePath: getConfig().storagePath,
      request: secondRequest,
      pauseAt: "entries",
    });
    await Promise.all([first.paused, second.paused]);
    first.resume();
    second.resume();
    const outcomes = await Promise.all([first.done, second.done]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    const firstWon = outcomes[0].status === "fulfilled";
    const loser = firstWon ? secondRequest : firstRequest;
    assert.equal(outcomes[firstWon ? 1 : 0].code, "DESTINATION_CONFLICT");
    await assert.rejects(
      () => RemoveSealedFile(loser),
      sealError("DESTINATION_CONFLICT"),
    );
    assert.equal(
      await download(firstRequest.destinationKey),
      firstWon ? Original : Replacement,
    );
  });
});

describe("independent-process admission binding and recovery", function () {
  this.timeout(ProcessTimeoutMs);
  beforeEach(reset);
  after(reset);

  it("binds changed concurrent tuples atomically across processes", async () => {
    const firstRequest = await admission((await upload()).resourceKey);
    const secondRequest = {
      ...firstRequest,
      destinationKey: `${firstRequest.destinationKey}-${randomUUID()}`,
    };
    const first = startSealProcess({
      storagePath: getConfig().storagePath,
      request: firstRequest,
      pauseAt: "bindings",
    });
    const second = startSealProcess({
      storagePath: getConfig().storagePath,
      request: secondRequest,
      pauseAt: "bindings",
    });
    await Promise.all([first.paused, second.paused]);
    first.resume();
    second.resume();
    const outcomes = await Promise.all([first.done, second.done]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(
      outcomes.find((outcome) => outcome.status === "rejected")?.code,
      "DESTINATION_CONFLICT",
    );
    const existence = await Promise.all([
      FileExists(firstRequest.destinationKey),
      FileExists(secondRequest.destinationKey),
    ]);
    assert.equal(existence.filter(Boolean).length, 1);
  });

  for (const crashAt of ["before-publication", "after-publication"] as const) {
    it(`recovers process death ${crashAt} without changing the admitted bytes`, async () => {
      const request = await admission((await upload()).resourceKey);
      const worker = startSealProcess({
        storagePath: getConfig().storagePath,
        request,
        crashAt,
      });
      assert.deepEqual(await worker.done, {
        status: "crashed",
        exitCode: CrashExitCode,
      });
      await restart();
      const recovered = await SealFile(request);
      assert.equal(await download(request.destinationKey), Original);
      assert.deepEqual(await SealFile(request), recovered);
      assert.equal((await GetFileSeal(request)).status, "sealed");
    });
  }
});
