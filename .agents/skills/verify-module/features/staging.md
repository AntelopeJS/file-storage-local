---
covers:
  - src/storage/promotion.ts
  - src/implementations/file-storage/beta.ts
  - src/index.ts
docs:
  - README.md
journeys:
  - promote-staged
  - promote-conflict
  - staging-expiry
---

# Staging

An application uploads to the reserved staging area, promotes the files it confirms, and lets abandoned ones expire.

## Sub-features

- `promote-staged`: a staged upload sits under `__staging__/` until `PromoteFile` moves it to the final key without the prefix, keeping its name, size and metadata; promoting twice answers the same key; a key outside staging comes back unchanged.
- `promote-conflict`: promoting onto a key another file occupies is a `FileConflictError` that overwrites nothing and leaves the staged bytes; an unknown staged key is a `FileNotFoundError`.
- `staging-expiry`: with `stagingExpiration` and `cleanupInterval` of one second the cleanup deletes the abandoned staged file and its description and keeps a permanent file.

## How to get to it (user POV)

- A module that passes `staging: true` in the upload request and calls `PromoteFile(resourceKey)` when the user confirms.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" staging
```

## Gotchas

- `staging-expiry` waits for the cleanup interval to pass, so it takes a few seconds.
