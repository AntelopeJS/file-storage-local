import { promises as fs } from "node:fs";
import { sep } from "node:path";

import { TokenManager } from "../storage/token-manager";

const BarrierSeparator = "/";
const WorkerOperations = new Set(["upload", "promote"]);

export interface WorkerRequest {
  root: string;
  operation: "upload" | "promote";
  token: string;
  key: string;
  body: string;
  barrier: string;
  afterLink?: boolean;
}

export interface WorkerMessage {
  status: "ready" | "done" | "error";
  code?: string;
}

function isWorkerRequest(value: unknown): value is WorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "root" in value &&
    typeof value.root === "string" &&
    "operation" in value &&
    typeof value.operation === "string" &&
    WorkerOperations.has(value.operation) &&
    "token" in value &&
    typeof value.token === "string" &&
    "key" in value &&
    typeof value.key === "string" &&
    "body" in value &&
    typeof value.body === "string" &&
    "barrier" in value &&
    typeof value.barrier === "string" &&
    (!("afterLink" in value) || typeof value.afterLink === "boolean")
  );
}

function parseWorkerRequest(argument: string): WorkerRequest {
  const request: unknown = JSON.parse(argument);
  if (!isWorkerRequest(request))
    throw new Error("Invalid publication worker request");
  return request;
}

async function pause(): Promise<void> {
  process.send?.({ status: "ready" });
  await new Promise<void>((resolve) =>
    process.once("message", () => resolve()),
  );
}

function toBarrierPath(path: string): string {
  return path.split(sep).join(BarrierSeparator);
}

async function run(request: WorkerRequest): Promise<void> {
  const link = fs.link;
  fs.link = async (source, destination) => {
    const matches = toBarrierPath(destination.toString()).endsWith(
      request.barrier,
    );
    if (matches && !request.afterLink) await pause();
    await link(source, destination);
    if (matches && request.afterLink) await pause();
  };
  const manager = new TokenManager(request.root);
  try {
    if (request.operation === "upload")
      await manager.saveUpload(request.token, Buffer.from(request.body));
    else await manager.promoteFile(request.key);
    process.send?.({ status: "done" });
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : String(error);
    process.send?.({ status: "error", code });
  } finally {
    process.disconnect?.();
  }
}

if (process.argv[2] === "publication-worker") {
  void run(parseWorkerRequest(process.argv[3]!));
}
