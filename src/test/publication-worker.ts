import { promises as fs } from "node:fs";

import { TokenManager } from "../storage/token-manager";

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

async function pause(): Promise<void> {
  process.send?.({ status: "ready" });
  await new Promise<void>((resolve) =>
    process.once("message", () => resolve()),
  );
}

async function run(request: WorkerRequest): Promise<void> {
  const link = fs.link;
  fs.link = async (source, destination) => {
    const matches = destination.toString().endsWith(request.barrier);
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
  void run(JSON.parse(process.argv[3]!) as WorkerRequest);
}
