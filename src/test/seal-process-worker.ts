import { promises as fs } from "node:fs";
import { FileSealError } from "@antelopejs/interface-file-storage";

import { TokenManager } from "../storage/token-manager";
import {
  CrashExitCode,
  type SealProcessMessage,
  type SealProcessOptions,
} from "./seal-process-types";

function send(message: SealProcessMessage): void {
  process.send?.(message);
}

function installBoundary(options: SealProcessOptions): void {
  const link = fs.link;
  let didPause = false;
  fs.link = async (source, destination) => {
    const path = String(destination);
    if (options.pauseAt && path.includes(`/${options.pauseAt}/`) && !didPause) {
      didPause = true;
      await new Promise<void>((resolve) => {
        process.once("message", () => resolve());
        send({ status: "paused" });
      });
    }
    if (path.includes("/entries/") && options.crashAt === "before-publication")
      process.exit(CrashExitCode);
    await link(source, destination);
    if (path.includes("/entries/") && options.crashAt === "after-publication")
      process.exit(CrashExitCode);
  };
}

async function run(): Promise<void> {
  const options = JSON.parse(process.argv[2] ?? "") as SealProcessOptions;
  const manager = new TokenManager(options.storagePath);
  await manager.initialize();
  installBoundary(options);
  const file = await manager.objects.seal(options.request);
  send({ status: "fulfilled", file });
}

void run()
  .catch((error: unknown) => {
    send({
      status: "rejected",
      code: error instanceof FileSealError ? error.code : String(error),
    });
  })
  .finally(() => process.disconnect?.());
