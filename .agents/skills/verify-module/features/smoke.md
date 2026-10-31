---
covers:
docs:
  - README.md
journeys:
  - module-dev
  - upload-through-disk
---

# Smoke

The fixed journey every verdict runs: load the module as `local` next to the API module, get an upload URL, PUT the bytes and read them back through the read URL.

## Sub-features

- `module-dev` is the pack's journey: the project answers, the consumer loads the file storage interface, Ctrl+C exits 130.
- `upload-through-disk`: one upload through `CreateUploadUrl` ends in the storage folder and is served by the URL `CreateReadUrl` returns.

## How to get to it (user POV)

- A project with `@antelopejs/file-storage-local` and `@antelopejs/api`, and a module that imports `@antelopejs/interface-file-storage`.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" smoke
```

## Gotchas

- The smoke feature covers no glob, so it never marks a file as mapped.
- The API module is installed from the registry (`@antelopejs/api` 1.3.0), as the README tells a user to; the journeys need network access the first time.
