---
covers:
  - src/implementations/file-storage/beta.ts
  - src/implementations/file-storage/index.ts
  - src/storage/upload-body.ts
  - src/storage/resource-key.ts
  - src/storage/publication.ts
docs:
  - README.md
journeys:
  - upload-roundtrip
  - upload-validation
  - upload-refused
  - upload-expiry
---

# Upload

An application module asks for an upload URL; a client PUTs the bytes to the module's route with the headers the module returned.

## Sub-features

- `upload-roundtrip`: `CreateUploadUrl` returns a URL on the configured base with the type and size as headers; a PUT with those headers answers 200 with the key, the bytes land on disk under the key, `GetFileMetadata` returns the declared name, size, type and metadata, and a second PUT of the same URL is refused and leaves the first bytes.
- `upload-validation`: a size over `maxSize` and a type outside `allowedMimetypes` are each refused with their message, a request on the limit is accepted, and nothing is stored.
- `upload-refused`: a PUT with another content type, or with a body of another size, is a 403 with its reason; an unknown token is a 404; the refused attempts neither store a file nor spend the URL.
- `upload-expiry`: with `uploadTokenExpiration` of one second a late PUT is a 403 `Token expired` and nothing is stored.

## How to get to it (user POV)

- A module that imports `@antelopejs/interface-file-storage` and calls `CreateUploadUrl(request, constraints?, storage?)`, then hands the URL and headers to a browser.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" upload
```

## Gotchas

- `WriteFile` carries a `Uint8Array` that the JSON driver cannot pass; it is covered by the module's own mocha suite, not by a journey.
- `upload-expiry` waits for the one-second lifetime to pass, so it takes a few seconds.
- The API module is installed from the registry (`@antelopejs/api` 1.3.0); the journeys need network access the first time.
