---
covers:
  - src/implementations/file-storage/beta.ts
  - src/storage/token-manager.ts
  - src/storage/publication.ts
docs:
  - README.md
journeys:
  - objects-lifecycle
  - stored-format
---

# Objects

An application module checks, describes, moves and deletes a stored file, and the files it leaves on disk are the ones a later release reads.

## Sub-features

- `objects-lifecycle`: `FileExists` and `GetFileMetadata` answer for an uploaded file and for an unknown key (`FileNotFoundError`); `MoveFile` leaves the bytes at the destination only, keeps the name, size and metadata under the new key, serves them through a read URL and is a no-op for a missing source; `DeleteFile` leaves no bytes and no description on disk and is a no-op the second time. This is the containment journey of the Data door.
- `stored-format`: after an upload the folder holds `files/<path>/<key>` and `metadata/<key>.json`, and the record names the key, path, type, size, filename, custom metadata and a modification time. This is the containment journey of the Format door.

## How to get to it (user POV)

- A module that calls `FileExists`, `GetFileMetadata`, `MoveFile` and `DeleteFile` of the file storage interface.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" objects
```

## Gotchas

- The second view is the storage folder on disk, which the journeys list and read after each call.
