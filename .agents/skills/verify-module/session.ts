import { readFileSync, readdirSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { join } from "node:path";

import {
  equal,
  type App,
  type CallResult,
  type Check,
  type CommandResult,
  type JourneyContext,
} from "@antelopejs/tooling-configs/verify";

import { canonical, isString, parseJson, pick, recordOf, tuple, type Json } from "./json.ts";

export { pick, tuple, type Json } from "./json.ts";
export type ModuleConfig = NonNullable<NonNullable<Parameters<JourneyContext["fixture"]>[0]>["moduleConfig"]>;

const API_PACKAGE = "@antelopejs/api";
const API_VERSION = "1.3.0";

function isAddress(value: ReturnType<Server["address"]>): value is AddressInfo {
  return typeof value === "object" && value !== null;
}

/** A free loopback port, taken from the kernel. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = isAddress(address) ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface Stack {
  context: JourneyContext;
  app: App;
  /** The public origin of the API module the module's URLs point at. */
  base: string;
  /** The folder the default storage keeps its files in. */
  root: string;
  /** The folder the `media` storage keeps its files in. */
  mediaRoot: string;
}

/** The module config for a stack: the default storage, a named `media` storage, and `overrides` replacing keys of the default one. */
export function storageConfig(base: string, root: string, mediaRoot: string, overrides: ModuleConfig = {}): ModuleConfig {
  const storage = { baseUrl: base, defaultVisibility: "private", uploadTokenExpiration: 3600, readTokenExpiration: 300, cleanupInterval: 300 };
  return { ...storage, storagePath: root, storages: { media: { ...storage, storagePath: mediaRoot, defaultVisibility: "public" } }, ...overrides };
}

function withApiModule(context: JourneyContext, project: string, port: number, base: string): void {
  const file = join(project, "antelope.config.ts");
  const prefix = "export default ";
  const parsed = recordOf(parseJson(readFileSync(file, "utf8").trim().slice(prefix.length).replace(/;$/, "")));
  const api = {
    source: { type: "package", package: API_PACKAGE, version: API_VERSION },
    config: { publicBaseUrl: base, servers: [{ protocol: "http", host: "127.0.0.1", port }] },
  };
  context.edit("add the API module the way the README says", file, `${prefix}${JSON.stringify({ ...parsed, modules: { ...recordOf(parsed.modules), api } }, null, 2)};\n`);
}

/** Writes the fixture project with the module and the API module it serves its routes through, and starts `ajs project dev`. */
export async function startStack(context: JourneyContext, overrides: ModuleConfig = {}): Promise<Stack> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const root = join(context.work, "storage");
  const mediaRoot = join(context.work, "storage-media");
  const project = context.fixture({ moduleConfig: storageConfig(base, root, mediaRoot, overrides) });
  withApiModule(context, project, port, base);
  const app = await context.dev("ajs-project-dev", project);
  return { context, app, base, root, mediaRoot };
}

export function call(stack: Stack, name: string, path: string, args: Json[]): Promise<CallResult> {
  return stack.context.call(name, stack.app, { path: [path], args });
}

/** The name and message of the error a call threw, or `null` when it returned. */
export function thrown(result: CallResult): Json {
  return [pick(result.json, "error", "name") ?? null, pick(result.json, "error", "message") ?? null];
}

export function answered(result: CallResult): Check {
  return { name: "the call through core answered", pass: result.ok, detail: result.ok ? "ok" : `${result.body}` };
}

/** `equal` that ignores key order; an absent value, also inside an array, reads as `null`. */
export function same(name: string, actual: Json | undefined | (Json | undefined)[], expected: Json): Check {
  return equal(name, canonical(Array.isArray(actual) ? tuple(...actual) : actual), canonical(expected));
}

/** The headers a client must send with the PUT, by name. */
export interface UploadHeaders {
  [name: string]: string;
}

export interface Slot {
  uploadUrl: string;
  resourceKey: string;
  headers: UploadHeaders;
}

function headerRecord(value: Json | undefined): UploadHeaders {
  const headers: UploadHeaders = {};
  if (value === undefined || value === null || Array.isArray(value)) return headers;
  for (const name of Object.keys(value)) {
    const entry = pick(value, name);
    if (isString(entry)) headers[name] = entry;
  }
  return headers;
}

/** The upload slot a `CreateUploadUrl` answer holds, or `undefined` when the call threw. */
export function slotOf(result: CallResult): Slot | undefined {
  const uploadUrl = pick(result.value, "uploadUrl");
  const resourceKey = pick(result.value, "resourceKey");
  if (!isString(uploadUrl) || !isString(resourceKey)) return undefined;
  return { uploadUrl, resourceKey, headers: headerRecord(pick(result.value, "headers")) };
}

/** What curl got back: the status line code, the response headers and the body. */
export interface Reply {
  folder: string;
  status: string;
  headers: string;
  body: string;
}

function replyFrom(result: CommandResult, headerFile: string, bodyFile: string): Reply {
  const read = (file: string): string => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };
  return { folder: result.folder, status: result.stdout.trim(), headers: read(headerFile), body: read(bodyFile) };
}

/** One HTTP request through curl, as a browser or a client would send it; `headers` and `body` are sent as given. */
export async function request(
  context: JourneyContext,
  name: string,
  method: string,
  url: string,
  options: { headers?: UploadHeaders; body?: string } = {},
): Promise<Reply> {
  const slug = name.replace(/\W+/g, "-");
  const headerFile = join(context.work, `${slug}.headers`);
  const bodyFile = join(context.work, `${slug}.body`);
  const args = ["-sS", "-D", headerFile, "-o", method === "HEAD" ? "/dev/null" : bodyFile, "-w", "%{http_code}"];
  args.push(...(method === "HEAD" ? ["-I"] : ["-X", method]));
  for (const [key, value] of Object.entries(options.headers ?? {})) args.push("-H", `${key}: ${value}`);
  if (options.body !== undefined) {
    const upload = join(context.work, `${slug}.upload`);
    context.edit(`${name} body`, upload, options.body);
    args.push("--data-binary", `@${upload}`);
  }
  args.push(url);
  return replyFrom(await context.command(name, "curl", args), headerFile, bodyFile);
}

/** Sends `body` to the upload URL as a browser would: one PUT with exactly the headers the module returned. */
export function put(context: JourneyContext, name: string, slot: Slot, body: string): Promise<Reply> {
  return request(context, name, "PUT", slot.uploadUrl, { headers: slot.headers, body });
}

/** The value of a response header, case-insensitively, or `null`. */
export function headerOf(reply: Reply, name: string): string | null {
  const wanted = `${name.toLowerCase()}:`;
  const line = reply.headers.split(/\r?\n/).find((entry) => entry.toLowerCase().startsWith(wanted));
  return line === undefined ? null : line.slice(wanted.length).trim();
}

/** The JSON a reply body holds, or `null`. */
export function bodyJson(reply: Reply): Json {
  try {
    return parseJson(reply.body);
  } catch {
    return null;
  }
}

/** Every file under `root`, relative and sorted: the second view of what the module left on disk. */
export function filesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(folder, entry.name), `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  try {
    walk(root, "");
  } catch {
    return [];
  }
  return found.sort();
}

/** The text of a file the module wrote, or `null` when it does not exist. */
export function diskText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Uploads `body` the way an application and a browser would: `CreateUploadUrl`, then one PUT. Returns the key, or `undefined` after recording the failure. */
export async function store(stack: Stack, label: string, upload: Json, body: string, storage?: string): Promise<string | undefined> {
  const created = await call(stack, `CreateUploadUrl for ${label}`, "CreateUploadUrl", [upload, null, storage ?? null]);
  const slot = slotOf(created);
  stack.context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
  if (slot === undefined) return undefined;
  const uploaded = await put(stack.context, `PUT ${label}`, slot, body);
  stack.context.expect(uploaded.folder, [same("the API module accepted the upload", uploaded.status, "200")], { critical: true });
  return slot.resourceKey;
}
