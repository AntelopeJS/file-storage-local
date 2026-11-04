---
covers:
  - src/routes/index.ts
  - src/routes/download-headers.ts
docs:
  - README.md
journeys:
  - read-private
  - read-public
  - visibility-override
---

# Read

A client reads a stored file from the module's route: a private file with the token of a read URL, a public file without one.

## Sub-features

- `read-private`: the URL `CreateReadUrl` returns serves the bytes; the same path without a token, with an unknown token, with another file's token or after the token's lifetime is a 403 with its reason.
- `read-public`: a file of a public storage is served without a token, with its type, size, `nosniff`, a quoted and percent-encoded filename and a one-year public cache; a HEAD returns the headers and no body; an unknown key is a 404.
- `visibility-override`: an upload's own `visibility` wins over the storage default, public in a private storage and private in a public one.

## How to get to it (user POV)

- A module that calls `CreateReadUrl(resourceKey, expiresIn?, storage?)` and hands the URL to a browser.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" read
```

## Gotchas

- `ReadFile` returns a stream that the JSON driver cannot pass; it is covered by the module's own mocha suite.
- `read-private` waits for a one-second token to expire, so it takes a few seconds.
