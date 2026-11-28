# file-storage-local

The local-disk provider of `@antelopejs/interface-file-storage`, published as `@antelopejs/file-storage-local`. It suits development and a single instance with a persistent disk.

## Layout

- `src/implementations/file-storage` holds the interface implementation; `ImplementInterface` in `src/index.ts` reads its `internal` export. `src/routes` registers the upload and download routes through the `FileStorageController` class decorators when `src/index.ts` imports it. No code uses `internal` or `FileStorageController` by name, so `knip.config.ts` lists these files as entries; do not delete those exports as dead code.
- `src/storage` holds the disk logic: storage roots, upload tokens, staging promotion and publication.
- The suites live in `src/test` and compile with the package; `ajs module test` runs them from `dist/test`.

## Versioning

This module implements `@antelopejs/interface-file-storage`, and `ImplementInterface` refuses a provider that lacks a declared function. Its range is therefore capped below the next minor (`<0.2.0`). Moving to a new minor means implementing what it adds and raising both bounds in the same release. The `dependency:ranges` step of `pnpm run checks` caps every `@antelopejs/*` range below the next minor.

## Tests

- `pnpm test` builds `dist`, then runs `ajs module test .` with `src/test/antelope.test.ts`. That config loads this module and `@antelopejs/api` 1.7.4 (fetched into `.antelope/cache`), serves on `127.0.0.1:3000`, and runs the suites in `dist/test` plus the shared conformance suite of `@antelopejs/interface-file-storage`. Port 3000 must be free.
- The module supports Windows. Tests simulate Windows behaviour on Linux through `src/test/platform.ts`. CI calls the shared `ci-node.yml` with `windows: true`, which runs `pnpm run checks` and `pnpm test` on `windows-latest` beside Linux; locally, on a Windows machine, run `pnpm install --frozen-lockfile --ignore-scripts` (the managed `prepare` script is POSIX shell and fails in cmd.exe), then `pnpm test`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, check only what you touched, one test file and not the suite, as the [`verify-changes`](.agents/skills/verify-changes/SKILL.md) skill says.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
