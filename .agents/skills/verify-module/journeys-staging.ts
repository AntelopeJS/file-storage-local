import type { Journey } from "@antelopejs/tooling-configs/verify";

import { answered, call, diskText, filesUnder, pick, same, startStack, store, thrown } from "./session.ts";

const STAGED = { filename: "draft.txt", size: 5, mimetype: "text/plain", path: "docs", staging: true, metadata: { Owner: "ada" } };
const PERMANENT = { filename: "kept.txt", size: 4, mimetype: "text/plain" };
const STAGING_PREFIX = "__staging__/";

const SLEEP_FOR_SWEEP_MS = 3500;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const promoteStaged: Journey = {
  title: "a staged upload sits in the reserved staging area until it is promoted, and promoting twice answers the same key",
  entryPoint: "`CreateUploadUrl` with `staging`, a PUT, then `PromoteFile` through core",
  async run(context) {
    const stack = await startStack(context);
    const staged = await store(stack, "the staged draft", STAGED, "draft");
    if (staged === undefined) return;
    const promotedKey = staged.slice(STAGING_PREFIX.length);
    context.expect(stack.app.folder, [
      same("the staged key sits under the staging prefix and the path", staged.startsWith(`${STAGING_PREFIX}docs/`), true),
      same("the bytes are in the staging area, not among the permanent files", [filesUnder(`${stack.root}/files`), filesUnder(`${stack.root}/${STAGING_PREFIX}`)], [[], [staged.slice(STAGING_PREFIX.length)]]),
    ]);
    const promoted = await call(stack, "PromoteFile", "PromoteFile", [staged]);
    context.expect(promoted.folder, [answered(promoted), same("the final key is the staged key without the prefix", pick(promoted.value, "resourceKey"), promotedKey)], { critical: true });
    context.expect(promoted.folder, [
      same("the bytes moved from the staging area to the permanent files", [filesUnder(`${stack.root}/files`), filesUnder(`${stack.root}/${STAGING_PREFIX}`), diskText(`${stack.root}/files/${promotedKey}`)], [[promotedKey], [], "draft"]),
    ]);
    const described = await call(stack, "GetFileMetadata of the promoted file", "GetFileMetadata", [promotedKey]);
    context.expect(described.folder, [
      answered(described),
      same("the promoted file keeps its name, size and metadata", [pick(described.value, "filename"), pick(described.value, "size"), pick(described.value, "metadata", "Owner")], ["draft.txt", 5, "ada"]),
    ]);
    const again = await call(stack, "PromoteFile again", "PromoteFile", [staged]);
    context.expect(again.folder, [answered(again), same("promoting the same staged key twice answers the same final key", pick(again.value, "resourceKey"), promotedKey)]);
    const permanent = await call(stack, "PromoteFile of a permanent key", "PromoteFile", [promotedKey]);
    context.expect(permanent.folder, [answered(permanent), same("a key outside staging comes back unchanged", pick(permanent.value, "resourceKey"), promotedKey)]);
  },
};

const promoteConflict: Journey = {
  title: "promoting onto an occupied key is refused as a conflict, a missing staged file is not found, and the staged bytes stay",
  entryPoint: "`MoveFile` onto the future final key, then `PromoteFile` through core",
  async run(context) {
    const stack = await startStack(context);
    const staged = await store(stack, "the staged draft", STAGED, "draft");
    const other = await store(stack, "an unrelated file", PERMANENT, "kept");
    if (staged === undefined || other === undefined) return;
    const target = staged.slice(STAGING_PREFIX.length);
    const occupy = await call(stack, "MoveFile onto the final key", "MoveFile", [other, target]);
    context.expect(occupy.folder, [answered(occupy), same("the unrelated file now holds the final key", diskText(`${stack.root}/files/${target}`), "kept")], { critical: true });
    const refused = await call(stack, "PromoteFile onto the occupied key", "PromoteFile", [staged]);
    context.expect(refused.folder, [same("the promotion is refused as a FileConflictError", pick(thrown(refused), 0), "FileConflictError")]);
    context.expect(refused.folder, [
      same("the occupant was not overwritten", diskText(`${stack.root}/files/${target}`), "kept"),
      same("the staged bytes are still in the staging area", diskText(`${stack.root}/${STAGING_PREFIX}${target}`), "draft"),
    ]);
    const missing = await call(stack, "PromoteFile of an unknown staged key", "PromoteFile", [`${STAGING_PREFIX}docs/none.txt`]);
    context.expect(missing.folder, [same("a staged file that does not exist is a FileNotFoundError", pick(thrown(missing), 0), "FileNotFoundError")]);
  },
};

const stagingExpiry: Journey = {
  title: "with `stagingExpiration` set the module's cleanup deletes abandoned staged files and keeps permanent ones",
  entryPoint: "a project configured with `stagingExpiration` and `cleanupInterval` of one second",
  async run(context) {
    const stack = await startStack(context, { stagingExpiration: 1, cleanupInterval: 1 });
    const staged = await store(stack, "the abandoned draft", STAGED, "draft");
    const kept = await store(stack, "the permanent file", PERMANENT, "kept");
    if (staged === undefined || kept === undefined) return;
    await pause(SLEEP_FOR_SWEEP_MS);
    const swept = await call(stack, "FileExists of the staged file", "FileExists", [staged]);
    context.expect(swept.folder, [
      same("the abandoned staged file is gone", swept.value, false),
      same("its bytes and its description are gone from disk", [filesUnder(`${stack.root}/${STAGING_PREFIX}`), filesUnder(`${stack.root}/metadata/${STAGING_PREFIX}`)], [[], []]),
    ]);
    const survivor = await call(stack, "FileExists of the permanent file", "FileExists", [kept]);
    context.expect(survivor.folder, [same("the permanent file is untouched", [survivor.value, diskText(`${stack.root}/files/${kept}`)], [true, "kept"])]);
  },
};

export const stagingJourneys = { "promote-staged": promoteStaged, "promote-conflict": promoteConflict, "staging-expiry": stagingExpiry };
