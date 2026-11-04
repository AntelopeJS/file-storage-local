import type { Journey } from "@antelopejs/tooling-configs/verify";

import { isString, parseJson } from "./json.ts";
import { answered, call, diskText, filesUnder, pick, request, same, startStack, store, thrown } from "./session.ts";

const REPORT = { filename: "report.txt", size: 6, mimetype: "text/plain", path: "/reports/2026/", metadata: { Owner: "ada" } };

const objectsLifecycle: Journey = {
  title: "an uploaded file is found, described, readable, movable and deletable, and a missing file is reported as not found",
  entryPoint: "`FileExists`, `GetFileMetadata`, `CreateReadUrl`, `MoveFile` and `DeleteFile` through core",
  async run(context) {
    const stack = await startStack(context);
    const key = await store(stack, "the report", REPORT, "report");
    if (key === undefined) return;
    context.expect(stack.app.folder, [same("the file sits under its normalised path", filesUnder(`${stack.root}/files`), [`reports/2026/${key}`])]);

    const exists = await call(stack, "FileExists", "FileExists", [key]);
    const missing = await call(stack, "FileExists of an unknown key", "FileExists", ["reports/none.txt"]);
    context.expect(exists.folder, [same("the uploaded file exists", exists.value, true)]);
    context.expect(missing.folder, [same("an unknown key does not", missing.value, false)]);

    const described = await call(stack, "GetFileMetadata", "GetFileMetadata", [key]);
    context.expect(described.folder, [
      answered(described),
      same("the key, name, size and type are the stored ones", [pick(described.value, "resourceKey"), pick(described.value, "filename"), pick(described.value, "size"), pick(described.value, "mimetype")], [key, "report.txt", 6, "text/plain"]),
      same("the custom metadata comes back as sent", pick(described.value, "metadata", "Owner"), "ada"),
    ]);
    const absent = await call(stack, "GetFileMetadata of an unknown key", "GetFileMetadata", ["reports/none.txt"]);
    context.expect(absent.folder, [same("an unknown key is a FileNotFoundError", pick(thrown(absent), 0), "FileNotFoundError")]);

    const target = "archive/report.txt";
    const moved = await call(stack, "MoveFile", "MoveFile", [key, target]);
    context.expect(moved.folder, [answered(moved)]);
    context.expect(moved.folder, [
      same("the bytes are at the destination only", filesUnder(`${stack.root}/files`), [target]),
      same("the bytes are the ones uploaded", diskText(`${stack.root}/files/${target}`), "report"),
    ]);
    const relocated = await call(stack, "GetFileMetadata after the move", "GetFileMetadata", [target]);
    context.expect(relocated.folder, [
      same("the move kept the name, size and metadata under the new key", [pick(relocated.value, "resourceKey"), pick(relocated.value, "filename"), pick(relocated.value, "size"), pick(relocated.value, "metadata", "Owner")], [target, "report.txt", 6, "ada"]),
    ]);
    const old = await call(stack, "FileExists of the old key", "FileExists", [key]);
    context.expect(old.folder, [same("the old key no longer exists", old.value, false)]);
    const nothing = await call(stack, "MoveFile of an unknown key", "MoveFile", ["reports/none.txt", "archive/none.txt"]);
    context.expect(nothing.folder, [answered(nothing), same("moving a missing file stores nothing", filesUnder(`${stack.root}/files`), [target])]);

    const read = await call(stack, "CreateReadUrl of the moved file", "CreateReadUrl", [target]);
    const url = pick(read.value, "url");
    if (isString(url)) {
      const served = await request(context, "GET the moved file", "GET", url);
      context.expect(served.folder, [same("the read URL serves the moved bytes", [served.status, served.body], ["200", "report"])]);
    }

    const removed = await call(stack, "DeleteFile", "DeleteFile", [target]);
    context.expect(removed.folder, [answered(removed)]);
    context.expect(removed.folder, [
      same("no bytes are left on disk", filesUnder(`${stack.root}/files`), []),
      same("no stored description is left on disk", filesUnder(`${stack.root}/metadata`), []),
    ]);
    const gone = await call(stack, "FileExists after the delete", "FileExists", [target]);
    context.expect(gone.folder, [same("the file no longer exists", gone.value, false)]);
    const again = await call(stack, "DeleteFile of a deleted file", "DeleteFile", [target]);
    context.expect(again.folder, [answered(again)]);
  },
};

const storedFormat: Journey = {
  title: "an uploaded file leaves the files and metadata layout on disk that a later release reads, with the description record's fields",
  entryPoint: "an upload through core and a PUT, then the storage folder read from disk",
  async run(context) {
    const stack = await startStack(context);
    const key = await store(stack, "the report", REPORT, "report");
    if (key === undefined) return;
    const listing = filesUnder(stack.root).filter((file) => !file.startsWith("tokens/"));
    context.expect(stack.app.folder, [
      same("the bytes are under files/ by path and key, the description under metadata/ by key", listing, [`files/reports/2026/${key}`, `metadata/${key}.json`]),
    ]);
    const text = diskText(`${stack.root}/metadata/${key}.json`);
    const record = text === null ? null : parseJson(text);
    context.expect(stack.app.folder, [
      same("the record names the key, the path as it was given, the type and the size", [pick(record, "resourceKey"), pick(record, "path"), pick(record, "mimetype"), pick(record, "size")], [key, "/reports/2026/", "text/plain", 6]),
      same("the record keeps the filename and the custom metadata", [pick(record, "metadata", "filename"), pick(record, "metadata", "Owner")], ["report.txt", "ada"]),
      same("the record holds a modification time", Number(pick(record, "lastModified")) > 0, true),
    ]);
  },
};

export const objectJourneys = { "objects-lifecycle": objectsLifecycle, "stored-format": storedFormat };
