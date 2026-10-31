import { interrupted, refused, type Journey } from "@antelopejs/tooling-configs/verify";

import { isString } from "./json.ts";
import { answered, call, filesUnder, pick, put, request, same, slotOf, startStack } from "./session.ts";

const uploadThroughDisk: Journey = {
  title: "a consumer asks for an upload URL, a client PUTs the bytes, the file lands on disk and its read URL serves it back",
  entryPoint: "`CreateUploadUrl` and `CreateReadUrl` through core against the API module",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [{ filename: "smoke.txt", size: 5, mimetype: "text/plain" }]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    const uploaded = await put(context, "PUT smoke", slot, "smoke");
    context.expect(uploaded.folder, [same("the API module accepted the upload", uploaded.status, "200")]);
    context.expect(uploaded.folder, [same("the file is in the storage folder", filesUnder(stack.root).filter((file) => file.startsWith("files/")), [`files/${slot.resourceKey}`])]);
    const read = await call(stack, "CreateReadUrl", "CreateReadUrl", [slot.resourceKey]);
    const url = pick(read.value, "url");
    context.expect(read.folder, [answered(read), same("a URL came back", isString(url), true)], { critical: true });
    if (!isString(url)) return;
    const fetched = await request(context, "GET the read URL", "GET", url);
    context.expect(fetched.folder, [same("the URL serves the bytes that were sent", [fetched.status, fetched.body], ["200", "smoke"])]);
  },
};

const moduleDev: Journey = {
  title: "the module loads from its local source next to the API module, answers through core and stops on Ctrl+C",
  entryPoint: "`ajs project dev` on a project that installs the module as `local` and the API module from the registry",
  async run(context) {
    const stack = await startStack(context);
    const exists = await call(stack, "FileExists of an unknown key", "FileExists", ["nothing.txt"]);
    context.expect(exists.folder, [answered(exists), same("the consumer reached the module's implementation of the interface", exists.value, false)]);
    const stopped = await context.stop("SIGINT", stack.app);
    context.expect(stopped.folder, [interrupted(stopped)]);
    const after = await context.http("port after stop", `${stack.base}/file-storage/files/x`);
    context.expect(after.folder, [refused(after)]);
  },
};

export const smokeJourneys = { "module-dev": moduleDev, "upload-through-disk": uploadThroughDisk };
