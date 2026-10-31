import type { Journey } from "@antelopejs/tooling-configs/verify";

import { answered, bodyJson, call, diskText, filesUnder, pick, put, request, same, slotOf, startStack, thrown } from "./session.ts";

const HELLO = { filename: "hello.txt", size: 5, mimetype: "text/plain", metadata: { TenantId: "t1" } };

const SLEEP_AFTER_EXPIRY_MS = 2500;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const uploadRoundtrip: Journey = {
  title: "an upload URL takes exactly the declared bytes with the returned headers, stores them under the returned key with their metadata, and refuses a replay",
  entryPoint: "`CreateUploadUrl` through core, then a browser-style PUT with the returned headers",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [HELLO]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    context.expect(created.folder, [
      same("the URL is on the configured public base", slot.uploadUrl.startsWith(`${stack.base}/file-storage/upload/`), true),
      same("the key keeps the file extension", slot.resourceKey.endsWith(".txt"), true),
      same("the type and size are headers to send", [slot.headers["Content-Type"], slot.headers["Content-Length"]], ["text/plain", "5"]),
      same("the expiry is in the future", Number(pick(created.value, "expiresAt")) > Date.now(), true),
    ]);
    const uploaded = await put(context, "PUT hello", slot, "hello");
    context.expect(uploaded.folder, [
      same("the API module answered 200", uploaded.status, "200"),
      same("the answer names the key the call returned", pick(bodyJson(uploaded), "resourceKey"), slot.resourceKey),
    ]);
    context.expect(uploaded.folder, [same("the bytes are on disk under the key", diskText(`${stack.root}/files/${slot.resourceKey}`), "hello")]);
    const described = await call(stack, "GetFileMetadata", "GetFileMetadata", [slot.resourceKey]);
    context.expect(described.folder, [
      answered(described),
      same("the filename, size and type are the declared ones", [pick(described.value, "filename"), pick(described.value, "size"), pick(described.value, "mimetype")], ["hello.txt", 5, "text/plain"]),
      same("the custom metadata comes back with its key as sent", pick(described.value, "metadata", "TenantId"), "t1"),
    ]);
    const replay = await put(context, "PUT hello again", slot, "HELLO");
    context.expect(replay.folder, [same("a second PUT of the same URL is refused", replay.status === "200", false)]);
    context.expect(replay.folder, [same("the first bytes are still stored", diskText(`${stack.root}/files/${slot.resourceKey}`), "hello")]);
  },
};

const uploadValidation: Journey = {
  title: "an upload over the size limit or outside the allowed types is refused with its message, a request on the limit is accepted, and nothing is stored",
  entryPoint: "`CreateUploadUrl` with constraints, through core",
  async run(context) {
    const stack = await startStack(context);
    const tooBig = await call(stack, "CreateUploadUrl over the limit", "CreateUploadUrl", [{ filename: "big.bin", size: 11, mimetype: "application/octet-stream" }, { maxSize: 10 }]);
    context.expect(tooBig.folder, [
      same("the call was refused as an UploadValidationError", pick(thrown(tooBig), 0), "UploadValidationError"),
      same("the message names the size and the limit", pick(thrown(tooBig), 1), "File size 11 exceeds maximum allowed size 10"),
    ]);
    const wrongType = await call(stack, "CreateUploadUrl with a type outside the list", "CreateUploadUrl", [{ filename: "a.gif", size: 3, mimetype: "image/gif" }, { allowedMimetypes: ["image/png", "image/jpeg"] }]);
    context.expect(wrongType.folder, [
      same("the call was refused as an UploadValidationError", pick(thrown(wrongType), 0), "UploadValidationError"),
      same("the message lists the allowed types", pick(thrown(wrongType), 1), "MIME type 'image/gif' is not allowed. Allowed types: image/png, image/jpeg"),
    ]);
    const onTheLimit = await call(stack, "CreateUploadUrl on the limit", "CreateUploadUrl", [{ filename: "a.png", size: 3, mimetype: "image/png" }, { allowedMimetypes: ["image/png"], maxSize: 3 }]);
    context.expect(onTheLimit.folder, [answered(onTheLimit), same("a request on the limit is accepted", slotOf(onTheLimit) !== undefined, true)]);
    context.expect(onTheLimit.folder, [same("no file was stored by the refused or the unused requests", filesUnder(`${stack.root}/files`), [])]);
  },
};

const uploadRefused: Journey = {
  title: "a PUT whose type or size differs from the declared one, or whose URL is unknown, is refused with its reason and stores nothing",
  entryPoint: "`CreateUploadUrl` through core, then PUTs that break the signed headers",
  async run(context) {
    const stack = await startStack(context);
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [HELLO]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    const wrongType = await request(context, "PUT with another content type", "PUT", slot.uploadUrl, { headers: { "Content-Type": "application/pdf" }, body: "hello" });
    context.expect(wrongType.folder, [
      same("the API module answered 403", wrongType.status, "403"),
      same("the reason is the type mismatch", [pick(bodyJson(wrongType), "error"), pick(bodyJson(wrongType), "expected")], ["Content-Type mismatch", "text/plain"]),
    ]);
    const wrongSize = await request(context, "PUT with six bytes for five", "PUT", slot.uploadUrl, { headers: { "Content-Type": "text/plain" }, body: "hello!" });
    context.expect(wrongSize.folder, [
      same("the API module answered 403", wrongSize.status, "403"),
      same("the reason is the size mismatch", [pick(bodyJson(wrongSize), "error"), pick(bodyJson(wrongSize), "expected")], ["Content-Length mismatch", 5]),
    ]);
    const unknown = await request(context, "PUT to an unknown token", "PUT", `${stack.base}/file-storage/upload/00000000-0000-4000-8000-000000000000`, { headers: slot.headers, body: "hello" });
    context.expect(unknown.folder, [
      same("the API module answered 404", unknown.status, "404"),
      same("the reason is an unknown or expired token", pick(bodyJson(unknown), "error"), "Token not found or expired"),
    ]);
    context.expect(unknown.folder, [same("nothing was stored", filesUnder(`${stack.root}/files`), [])]);
    const accepted = await put(context, "PUT with the right headers", slot, "hello");
    context.expect(accepted.folder, [same("the refused attempts did not spend the URL", accepted.status, "200")]);
  },
};

const uploadExpiry: Journey = {
  title: "an upload URL stops working once its lifetime has passed and the file is never stored",
  entryPoint: "`CreateUploadUrl` with `uploadTokenExpiration` of one second, then a late PUT",
  async run(context) {
    const stack = await startStack(context, { uploadTokenExpiration: 1 });
    const created = await call(stack, "CreateUploadUrl", "CreateUploadUrl", [HELLO]);
    const slot = slotOf(created);
    context.expect(created.folder, [answered(created), same("a slot came back", slot !== undefined, true)], { critical: true });
    if (slot === undefined) return;
    await pause(SLEEP_AFTER_EXPIRY_MS);
    const late = await put(context, "PUT after the lifetime", slot, "hello");
    context.expect(late.folder, [
      same("the API module answered 403", late.status, "403"),
      same("the reason is the expired token", pick(bodyJson(late), "error"), "Token expired"),
    ]);
    context.expect(late.folder, [same("nothing was stored", filesUnder(`${stack.root}/files`), [])]);
    const gone = await call(stack, "FileExists after the late PUT", "FileExists", [slot.resourceKey]);
    context.expect(gone.folder, [same("the file does not exist", gone.value, false)]);
  },
};

export const uploadJourneys = { "upload-roundtrip": uploadRoundtrip, "upload-validation": uploadValidation, "upload-refused": uploadRefused, "upload-expiry": uploadExpiry };
