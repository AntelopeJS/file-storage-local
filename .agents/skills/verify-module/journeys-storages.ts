import type { Journey } from "@antelopejs/tooling-configs/verify";

import { isString } from "./json.ts";
import { answered, bodyJson, call, diskText, filesUnder, pick, put, request, same, slotOf, startStack, store, thrown } from "./session.ts";

const NOTE = { filename: "note.txt", size: 4, mimetype: "text/plain" };

const namedStorage: Journey = {
  title: "a call with a storage id works on that storage's own folder, a call without one on the default, and an unknown id is refused naming it",
  entryPoint: "`CreateUploadUrl`, `FileExists`, `GetFileMetadata` and `CreateReadUrl` with a storage id, through core",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl on media", "CreateUploadUrl", [NOTE, null, "media"]);
    const slot = slotOf(created);
    context.expect(created.folder, [
      answered(created),
      same("the upload URL names the storage", slot?.uploadUrl.endsWith("?storage=media"), true),
    ], { critical: true });
    const key = await store(stack, "a note on media", NOTE, "note", "media");
    if (key === undefined) return;
    context.expect(stack.app.folder, [
      same("the bytes are in the media storage's folder only", [filesUnder(`${stack.mediaRoot}/files`), filesUnder(`${stack.root}/files`)], [[key], []]),
      same("they are the bytes sent", diskText(`${stack.mediaRoot}/files/${key}`), "note"),
    ]);
    const onMedia = await call(stack, "FileExists on media", "FileExists", [key, "media"]);
    const onDefault = await call(stack, "FileExists on the default storage", "FileExists", [key]);
    context.expect(onMedia.folder, [same("the key exists on media", onMedia.value, true)]);
    context.expect(onDefault.folder, [same("the same key does not exist on the default storage", onDefault.value, false)]);
    const wrong = await call(stack, "GetFileMetadata on the default storage", "GetFileMetadata", [key]);
    context.expect(wrong.folder, [same("describing it on the default storage is a FileNotFoundError", pick(thrown(wrong), 0), "FileNotFoundError")]);
    const unknown = await call(stack, "FileExists on an unknown storage", "FileExists", [key, "nope"]);
    context.expect(unknown.folder, [same("an unknown storage id is refused naming it", pick(thrown(unknown), 1), "Storage 'nope' not found in configuration")]);
    const served = await request(context, "GET the key on the default storage's route", "GET", `${stack.base}/file-storage/files/${encodeURIComponent(key)}`);
    context.expect(served.folder, [same("the default storage does not serve the media file", served.status, "404")]);
  },
};

const BARE_STORAGE_ERROR = 'The "storage" query parameter needs a storage name.';

const bareStorage: Journey = {
  title: "a request with a bare ?storage and no value is refused with 400 on the upload and the download route, and the same request without it still works",
  entryPoint: "`PUT /file-storage/upload/:token?storage` and `GET /file-storage/files/:resourceKey?storage`, sent with curl",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [NOTE]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created)], { critical: true });
    if (slot === undefined) return;
    const bareUpload = await request(context, "PUT with a bare ?storage", "PUT", `${slot.uploadUrl.split("?")[0]}?storage`, { headers: slot.headers, body: "note" });
    context.expect(bareUpload.folder, [
      same("a bare ?storage on the upload is refused", bareUpload.status, "400"),
      same("the reason asks for a storage name", pick(bodyJson(bareUpload), "error"), BARE_STORAGE_ERROR),
      same("nothing was stored", filesUnder(`${stack.root}/files`), []),
    ]);
    const stored = await put(context, "PUT the same slot without the flag", slot, "note");
    context.expect(stored.folder, [same("the refused slot still accepts the upload", stored.status, "200")]);
    const read = await call(stack, "CreateReadUrl", "CreateReadUrl", [slot.resourceKey]);
    const url = pick(read.value, "url");
    context.expect(read.folder, [answered(read)], { critical: true });
    if (!isString(url)) return;
    const bareRead = await request(context, "GET with a bare ?storage", "GET", `${url}&storage`);
    context.expect(bareRead.folder, [
      same("a bare ?storage on the download is refused", bareRead.status, "400"),
      same("the reason asks for a storage name", pick(bodyJson(bareRead), "error"), BARE_STORAGE_ERROR),
    ]);
    const served = await request(context, "GET without the flag", "GET", url);
    context.expect(served.folder, [same("the same URL without the flag serves the bytes", [served.status, served.body], ["200", "note"])]);
  },
};

export const storageJourneys = { "named-storage": namedStorage, "bare-storage": bareStorage };
