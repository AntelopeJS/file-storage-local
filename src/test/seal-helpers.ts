import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  CreateReadUrl,
  CreateUploadUrl,
  FileSealError,
  type FileSealErrorCode,
  GetFileSnapshot,
  type PresignedUploadResponse,
  SEALED_PREFIX,
  type SealFileRequest,
} from "@antelopejs/interface-file-storage";

import { setModuleState } from "../module-config";
import { getConfig, getTokenManager } from "../index";
import { TokenManager } from "../storage/token-manager";

export const Original = "original immutable bytes";
export const Replacement = "replacement changed data";
export const Mime = "text/plain";
const TokenLifetimeMs = 60_000;

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function sealError(
  code: FileSealErrorCode,
): (error: unknown) => boolean {
  return (error) => error instanceof FileSealError && error.code === code;
}

export async function restart(): Promise<void> {
  const config = getConfig();
  const manager = new TokenManager(config.storagePath);
  await manager.initialize();
  setModuleState(config, manager);
}

export async function reset(): Promise<void> {
  await fs.rm(getConfig().storagePath, { recursive: true, force: true });
  await restart();
}

export async function put(
  upload: PresignedUploadResponse,
  body = Original,
): Promise<Response> {
  return fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body,
  });
}

export async function upload(): Promise<PresignedUploadResponse> {
  const request = await CreateUploadUrl({
    filename: "seal.txt",
    size: Original.length,
    mimetype: Mime,
    staging: true,
  });
  assert.equal((await put(request)).status, 200);
  return request;
}

export async function replace(
  resourceKey: string,
  body = Replacement,
): Promise<void> {
  const token = await getTokenManager().createUploadToken(
    resourceKey,
    Mime,
    body.length,
    Date.now() + TokenLifetimeMs,
  );
  const response = await fetch(
    `${getConfig().baseUrl}/file-storage/upload/${token.token}`,
    {
      method: "PUT",
      headers: { "Content-Type": Mime },
      body,
    },
  );
  assert.equal(response.status, 200);
}

export async function admission(resourceKey: string): Promise<SealFileRequest> {
  return {
    source: (await GetFileSnapshot(resourceKey)).identity,
    admissionId: randomUUID(),
    destinationKey: `${SEALED_PREFIX}${randomUUID()}`,
  };
}

export async function download(resourceKey: string): Promise<string> {
  const read = await CreateReadUrl(resourceKey);
  const response = await fetch(read.url);
  assert.equal(response.status, 200);
  return response.text();
}
