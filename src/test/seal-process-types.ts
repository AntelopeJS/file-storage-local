import type {
  SealedFile,
  SealFileRequest,
} from "@antelopejs/interface-file-storage";

export interface SealProcessOptions {
  storagePath: string;
  request: SealFileRequest;
  pauseAt?: "bindings" | "admissions" | "entries";
  crashAt?: "before-publication" | "after-publication";
}

export interface SealProcessMessage {
  status: "paused" | "fulfilled" | "rejected" | "crashed";
  file?: SealedFile;
  code?: string;
  exitCode?: number;
}

export interface SealProcess {
  paused: Promise<void>;
  done: Promise<SealProcessMessage>;
  resume: () => void;
}

export const CrashExitCode = 91;
