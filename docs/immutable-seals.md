# Immutable local file seals

This adapter implements the additive generation-bound API from [interface-file-storage PR 7](https://github.com/AntelopeJS/interface-file-storage/pull/7). That interface is unpublished. Keep this change in draft until the interface ships and the dependency range and lockfile can reference a real release. Do not publish the validation tarballs under their retained baseline versions.

## Use a persisted admission tuple

Upload through `CreateUploadUrl` and its HTTP PUT URL, then capture `GetFileSnapshot`. Persist the complete `SealFileRequest` before calling `SealFile`: the source identity, a unique admission ID within the backing store, and a destination under `SEALED_PREFIX` (`__sealed__/`). Use the same tuple for every retry and for `GetFileSeal` or `RemoveSealedFile` reconciliation.

Each accepted upload publishes a new random generation, including identical-byte uploads. A consumed upload token returns HTTP 404, but a concurrent PUT that already validated its token may still publish a newer generation. Sealing either captures the requested immutable bytes or rejects the changed source; it never substitutes the newer bytes. Matching replay returns the original destination identity even after source deletion or staging expiry.

The persisted backing-store UUID survives process restarts and aliases of the same storage directory. A separately initialized directory gets another UUID. Storage names continue to address this module's single configured store; they do not create separate buckets. Existing raw files remain readable through legacy APIs, but snapshots of those files return `UNSUPPORTED`; upload them again rather than inferring a generation from timestamps or hashes.

## Publication does not use a lock or lease

The adapter stores immutable private payloads and complete manifests under `storagePath/.immutable`. It synchronizes a temporary manifest before atomically linking it into its final name without replacement. Concurrent creators read the winning record after `EEXIST` and verify the complete admission tuple. Ordinary upload pointers use an atomic rename to a new immutable generation.

Admission bindings, candidate manifests, sealed destination slots, and cancellation markers only accumulate. Removal durably creates the tuple-bound cancellation marker and never unlinks a sealed slot or its bytes. Every logical read, metadata lookup, snapshot, existence check, and seal replay consults that marker. A publisher delayed before the final link can create a hidden slot after cancellation, but its final marker check returns `ADMISSION_REMOVED`; the slot never becomes readable.

Sealed destination keys are single-use. Once published, a slot remains consumed after removal, so another admission cannot reuse its key. Legacy upload, move, and delete operations reject reserved sealed and private namespaces. Removal reports a conflict for a foreign generation and never deletes that generation. Ordinary legacy `MoveFile` and `PromoteFile` retain their existing semantics; they are not substitutes for the new API.

## Recover the same request after an unknown outcome

If a process exits after preparing a candidate but before destination publication, `GetFileSeal` or `SealFile` can finish publishing the complete durable candidate without the source pointer. If publication succeeds but its acknowledgement is lost, reconciliation reads the same generation. Incomplete or unreadable manifests produce `OUTCOME_UNKNOWN`, not a fabricated successful replay or absence.

An acknowledged removal permanently fences the admission. A removal interrupted after marker publication may return `OUTCOME_UNKNOWN`, but reconciliation synchronizes and observes the marker before reporting removed. Logical reads deny the owned destination even when its private bytes and slot remain on disk. Existing HTTP streams or previously cached/downloaded responses cannot be revoked retroactively; consumers must respect the interface's issued-read-capability lifetime caveat.

## Deployment and retention limits

Use a private local filesystem that supports atomic hard-link creation, same-directory rename, and file/directory `fsync`. The tests exercise independent processes sharing the same local directory, without a process mutex, flock, TTL, or lease. They do not establish NFS, distributed-filesystem, separate-host, power-loss, or hardware-failure guarantees. This module remains unsuitable for clustering across independent storage directories.

Do not expose `storagePath` through a static web server or grant untrusted processes write access to it. HTTP routes serve logical keys only; private payloads have no raw public URL. All writers to a directory must use this implementation; an older binary or an external filesystem writer does not participate in its namespace protections.

Private payloads, replaced upload generations, admission records, and removal markers remain on disk. This change deliberately includes no garbage collector or physical-erasure guarantee. Monitor disk usage and keep terminal provenance permanently. Any later garbage collector must account for live and incomplete admissions before deleting immutable payloads; deleting a staging pointer alone does not prove its bytes are unreferenced.

## Validate against the unpublished interface

Unpack a reviewed interface PR artifact into an ignored directory and point only the local `node_modules/@antelopejs/interface-file-storage` symlink at that unpacked package. Leave `package.json` and `pnpm-lock.yaml` unchanged until a real interface release exists. This validation override must not appear in committed dependency metadata.

Run `pnpm build`, then `pnpm --package=@antelopejs/core dlx ajs module test .` when the CLI is not installed globally. With the CLI installed, `pnpm test` runs the same normal suite. The suite starts the configured API on loopback port 3000 and uses disposable `.antelope/cache/storage` data. It covers HTTP upload/read behavior, source-generation changes, concurrent same/different admissions, independent-process barriers, actual process exit before/after publication, lost acknowledgements, restart reconciliation, reserved namespaces, and foreign-generation preservation.
