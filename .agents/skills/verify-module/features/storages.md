---
covers:
  - src/module-config.ts
  - src/storage/storage-roots.ts
docs:
  - README.md
journeys:
  - named-storage
---

# Storages

The config holds a default storage and optional named storages that a call selects by id.

## Sub-features

- `named-storage`: a call with a storage id signs its URL for that storage, keeps its files in that storage's folder only, and does not see the default storage's files; an unknown id is refused naming it.

## How to get to it (user POV)

- An operator who adds `storages: { media: { ... } }` to the module config and a module that passes the id.

## Driving it with antelopejs-verify

```bash
pnpm exec antelopejs-verify journey "$RUN" storages
```

## Gotchas

- A config that names a storage `default`, or whose storage folders overlap, stops the project at start; the journeys do not start such a project, so those two refusals are not covered by a journey.
