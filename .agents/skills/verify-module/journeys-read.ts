import type { Journey } from "@antelopejs/tooling-configs/verify";

import { isString } from "./json.ts";
import { answered, bodyJson, call, headerOf, pick, request, same, startStack, store } from "./session.ts";

const REPORT = { filename: "report 2026.txt", size: 6, mimetype: "text/plain" };
const OTHER = { filename: "other.txt", size: 5, mimetype: "text/plain" };

const SLEEP_AFTER_EXPIRY_MS = 2500;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const readPrivate: Journey = {
  title: "a private file is served only to a read URL's token, for its own file and only until the token expires",
  entryPoint: "`CreateReadUrl` through core, then GETs of the URL with and without its token",
  async run(context) {
    const stack = await startStack(context);
    const key = await store(stack, "the report", REPORT, "report");
    const otherKey = await store(stack, "the other file", OTHER, "other");
    if (key === undefined || otherKey === undefined) return;
    const read = await call(stack, "CreateReadUrl", "CreateReadUrl", [key]);
    const url = pick(read.value, "url");
    context.expect(read.folder, [
      answered(read),
      same("the URL is on the configured public base with a token", isString(url) && url.startsWith(`${stack.base}/file-storage/files/`) && url.includes("?token="), true),
      same("a private URL expires in the future", Number(pick(read.value, "expiresAt")) > Date.now(), true),
    ], { critical: true });
    if (!isString(url)) return;
    const served = await request(context, "GET the read URL", "GET", url);
    context.expect(served.folder, [same("the URL serves the bytes", [served.status, served.body], ["200", "report"])]);
    const bare = await request(context, "GET without the token", "GET", url.split("?")[0] ?? url);
    context.expect(bare.folder, [
      same("no token is refused", bare.status, "403"),
      same("the reason asks for a token", pick(bodyJson(bare), "error"), "Access denied. Token required for private files."),
    ]);
    const forged = await request(context, "GET with an unknown token", "GET", `${url.split("?")[0]}?token=00000000-0000-4000-8000-000000000000`);
    context.expect(forged.folder, [
      same("an unknown token is refused", forged.status, "403"),
      same("the reason is an invalid token", pick(bodyJson(forged), "error"), "Invalid or expired token"),
    ]);
    const otherRead = await call(stack, "CreateReadUrl for the other file", "CreateReadUrl", [otherKey]);
    const otherUrl = pick(otherRead.value, "url");
    const token = isString(otherUrl) ? (otherUrl.split("?token=")[1] ?? "") : "";
    const crossed = await request(context, "GET the report with the other file's token", "GET", `${url.split("?")[0]}?token=${token}`);
    context.expect(crossed.folder, [
      same("a token for another file is refused", crossed.status, "403"),
      same("the reason is the mismatch", pick(bodyJson(crossed), "error"), "Token does not match requested resource"),
    ]);
    const short = await call(stack, "CreateReadUrl for one second", "CreateReadUrl", [key, 1]);
    const shortUrl = pick(short.value, "url");
    await pause(SLEEP_AFTER_EXPIRY_MS);
    if (!isString(shortUrl)) return;
    const late = await request(context, "GET after the token expired", "GET", shortUrl);
    context.expect(late.folder, [
      same("an expired token is refused", late.status, "403"),
      same("the reason is the expiry", pick(bodyJson(late), "error"), "Token expired"),
    ]);
  },
};

const readPublic: Journey = {
  title: "a public file is served without a token, with the headers that keep a browser from sniffing it, and a HEAD returns the headers only",
  entryPoint: "`CreateReadUrl` on the public `media` storage, then GET and HEAD of the URL",
  async run(context) {
    const stack = await startStack(context);
    const key = await store(stack, "the report", REPORT, "report", "media");
    if (key === undefined) return;
    const read = await call(stack, "CreateReadUrl", "CreateReadUrl", [key, null, "media"]);
    const url = pick(read.value, "url");
    context.expect(read.folder, [
      answered(read),
      same("a public URL names the storage and carries no token", isString(url) && url.endsWith("?storage=media"), true),
      same("a public URL does not expire", pick(read.value, "expiresAt") ?? null, null),
    ], { critical: true });
    if (!isString(url)) return;
    const served = await request(context, "GET the public URL", "GET", url);
    context.expect(served.folder, [
      same("the URL serves the bytes without a token", [served.status, served.body], ["200", "report"]),
      same("the type is the stored one", headerOf(served, "content-type"), "text/plain"),
      same("the size is the stored one", headerOf(served, "content-length"), "6"),
      same("a browser is told not to sniff the type", headerOf(served, "x-content-type-options"), "nosniff"),
      same("the stored filename is offered, quoted and percent-encoded", headerOf(served, "content-disposition"), `inline; filename="report 2026.txt"; filename*=UTF-8''report%202026.txt`),
      same("a public file may be cached for a year", headerOf(served, "cache-control"), "public, max-age=31536000"),
    ]);
    const head = await request(context, "HEAD the public URL", "HEAD", url);
    context.expect(head.folder, [
      same("a HEAD answers 200 with the size and no body", [head.status, headerOf(head, "content-length"), head.body], ["200", "6", ""]),
    ]);
    const missing = await request(context, "GET an unknown key", "GET", `${stack.base}/file-storage/files/nothing.txt?storage=media`);
    context.expect(missing.folder, [same("an unknown key is a 404", missing.status, "404")]);
  },
};

const visibilityOverride: Journey = {
  title: "an upload's own visibility wins over its storage's default in both directions",
  entryPoint: "`CreateUploadUrl` with `visibility` on the private default storage and on the public `media` storage, then `CreateReadUrl`",
  async run(context) {
    const stack = await startStack(context);
    const exposed = await store(stack, "a public file in the private storage", { ...REPORT, visibility: "public" }, "report");
    const guarded = await store(stack, "a private file in the public storage", { ...OTHER, visibility: "private" }, "other", "media");
    if (exposed === undefined || guarded === undefined) return;
    const exposedRead = await call(stack, "CreateReadUrl of the public file", "CreateReadUrl", [exposed]);
    const exposedUrl = pick(exposedRead.value, "url");
    context.expect(exposedRead.folder, [same("its URL carries no token", isString(exposedUrl) && !exposedUrl.includes("token="), true)], { critical: true });
    if (!isString(exposedUrl)) return;
    const open = await request(context, "GET the public file without a token", "GET", exposedUrl);
    context.expect(open.folder, [same("it is served", [open.status, open.body], ["200", "report"])]);
    const guardedRead = await call(stack, "CreateReadUrl of the private file", "CreateReadUrl", [guarded, null, "media"]);
    const guardedUrl = pick(guardedRead.value, "url");
    context.expect(guardedRead.folder, [same("its URL carries a token", isString(guardedUrl) && guardedUrl.includes("token="), true)], { critical: true });
    if (!isString(guardedUrl)) return;
    const bare = await request(context, "GET the private file without a token", "GET", `${stack.base}/file-storage/files/${encodeURIComponent(guarded)}?storage=media`);
    context.expect(bare.folder, [same("it is refused", bare.status, "403")]);
    const opened = await request(context, "GET the private file with its token", "GET", guardedUrl);
    context.expect(opened.folder, [same("it is served with its token", [opened.status, opened.body], ["200", "other"])]);
  },
};

export const readJourneys = { "read-private": readPrivate, "read-public": readPublic, "visibility-override": visibilityOverride };
