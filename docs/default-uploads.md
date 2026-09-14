# Write-once uploads and promotion

`CreateUploadUrl` allocates a new UUID key for each request. The local HTTP upload endpoint accepts one complete buffered PUT, not a multipart-upload or resumable-upload protocol. A multipart MIME body remains an ordinary opaque body with the declared size and content type.

## Upload completion and retries

The provider writes the complete body to an unservable temporary file and synchronizes it before claiming the upload token. A no-clobber filesystem publication records token consumption in that storage manager's token directory. The provider publishes complete metadata before linking the completed bytes into the final path; reads, metadata queries, and existence checks do not expose metadata-only objects.

- Validation failures and temporary-body failures before token consumption permit a retry with the same URL.
- After consumption, sequential or concurrent valid PUTs return HTTP 409, including identical bytes and attempts after promotion or deletion. They never take over an interrupted upload.
- An error or lost response after consumption can mean that publication completed or failed. Do not interpret HTTP 409 as proof of successful publication. Inspect the object or request a new upload URL and let application cleanup remove abandoned keys.
- Consumed-token evidence survives process restart and object deletion until the backend URL expires. The normal expired-token sweep removes it after expiry. Token expiry is rechecked during consumption.

The provider never writes published upload bytes in place. Concurrent PUTs for the same token publish at most one body, without a process lock, lease, timeout-based takeover, or permanent admission registry.

## Promotion uses trusted provenance

The unchanged public `PromoteFile(resourceKey, storage?)` API now delegates to the provider's dedicated promotion implementation. A non-staged key returns unchanged. A staged key maps to its canonical staging-prefix-stripped destination in the same selected storage; malformed or ambiguous paths conflict.

The provider publishes metadata containing a trusted, server-owned source key, then links the immutable source bytes without overwriting a destination. It synchronizes the destination before removing the staging bytes. A retry succeeds only when the destination contains complete metadata, matching trusted provenance, and the complete file, even if the source has disappeared. Caller-supplied custom metadata cannot establish this provenance.

A foreign destination, missing provenance, corrupt metadata, or metadata-only interrupted publication raises `FileConflictError` with code `FILE_CONFLICT`. An absent source with no destination raises `FileNotFoundError`. Other provider errors propagate; neither a bare existence check nor an error produces success. An incomplete promotion is not taken over automatically; the caller must clean up or abandon the affected keys. A concurrent replay can conflict while the winning publication is still incomplete and succeed after it completes.

## Visibility and caller boundaries

Explicit upload visibility comes from the server-authored upload token and survives promotion. Private files require signed reads even when the selected storage defaults to public. Omitting visibility preserves the existing storage default, including media behavior. Named-storage URLs retain their storage selector, and token consumption and promotion use that manager's backing directory.

Applications relying on write-once promotion must reserve a dedicated namespace and never reuse its upload or final keys. Privileged `MoveFile`, direct filesystem writes, and other writers must not target those keys. Generic `MoveFile` retains its existing overwrite semantics and is not the promotion primitive. Existing files remain readable, but a preexisting destination without trusted provenance is not a successful promotion replay.

Deletion is ordinary cleanup, not a cancellation fence. A delayed publication can leave private orphan bytes after application cancellation; the business layer must retain cleanup work and repeat deletion as needed. Do not expose the backing directory through a separate static server: temporary files and partial metadata are provider-private. Already-issued reads and open file descriptors can remain usable until completion or URL expiry.

## Validation and platform limits

The implementation uses POSIX local-filesystem hard links and file/directory synchronization on one filesystem. Tests cover normal HTTP requests, distinct concurrent bodies, independent Node processes, interrupted bodies, injected disk errors, process death before and after publication, replay without a source, and named/private storage behavior. These tests do not establish NFS, distributed storage, machine-power-loss, or hardware durability guarantees. The module remains a local-storage provider, not a clustered storage service.

The dedicated promotion hook and `FileConflictError` depend on the unpublished interface-file-storage PR #8 contract. Validation uses a locally unpacked interface artifact under ignored `node_modules`; package versions and lockfiles do not claim a released dependency. A clean registry-only installation is blocked until the coordinated interface release.

`pnpm test` uses Antelope's module runner. Because this provider declares
`@antelopejs/interface-file-storage` in `antelopeJs.implements`, the runner also
discovers that package's `dist/tests` conformance suite. The test setup requires
the suite to be present so an older interface cannot silently omit it. Shared
tests perform real HTTP uploads, reads, promotion/replay, conflict checks, and
cleanup; local tests retain filesystem faults, token consumption, named-storage
routing, legacy metadata, streaming, and staging-expiry coverage.
