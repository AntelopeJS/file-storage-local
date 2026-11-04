# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, `journeys:` the journeys it runs, and `seeded-breaks/<feature>.patch` the break its journeys must catch. `pnpm exec antelopejs-verify map` checks that every user-facing file is covered.

The module serves its routes through `@antelopejs/api`, so every journey installs the API module from the registry next to the module under verification, as the README tells a user to. Journeys PUT and GET with `curl`, as a browser would, and read the storage folder from disk as the second view. `WriteFile` and `ReadFile` pass bytes and a stream that the JSON driver cannot carry, so only the module's own mocha suite covers them.

| Feature | What the user does | Journeys |
|---|---|---|
| [upload](upload.md) | Asks for an upload URL under size and type limits and uploads to it. | upload-roundtrip, upload-validation, upload-refused, upload-expiry |
| [read](read.md) | Reads a private file with a token and a public one without. | read-private, read-public, visibility-override |
| [objects](objects.md) | Checks, describes, moves and deletes a stored file; the files left on disk. | objects-lifecycle, stored-format |
| [staging](staging.md) | Uploads to staging, promotes the file, lets abandoned ones expire. | promote-staged, promote-conflict, staging-expiry |
| [storages](storages.md) | Selects a named storage. | named-storage |
| [smoke](smoke.md) | The fixed journey every verdict runs. | module-dev, upload-through-disk |
