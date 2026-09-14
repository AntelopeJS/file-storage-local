import { join } from "node:path";
import { fork } from "node:child_process";

import type {
  SealProcess,
  SealProcessMessage,
  SealProcessOptions,
} from "./seal-process-types";

export function startSealProcess(options: SealProcessOptions): SealProcess {
  const child = fork(
    join(__dirname, "seal-process-worker.js"),
    [JSON.stringify(options)],
    {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    },
  );
  let announcePause = () => {};
  const paused = new Promise<void>((resolve) => {
    announcePause = resolve;
  });
  const done = new Promise<SealProcessMessage>((resolve, reject) => {
    child.on("message", (message: SealProcessMessage) => {
      if (message.status === "paused") announcePause();
      else resolve(message);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      resolve({ status: "crashed", exitCode: code ?? -1 }),
    );
  });
  return { paused, done, resume: () => child.send("resume") };
}
