# file-storage-local

The local-disk provider of `@antelopejs/interface-file-storage`, published as `@antelopejs/file-storage-local`. It suits development and a single instance with a persistent disk.

## Layout

- `src/implementations/file-storage` holds the interface implementation; `ImplementInterface` in `src/index.ts` reads its `internal` export. `src/routes` registers the upload and download routes through the `FileStorageController` class decorators when `src/index.ts` imports it. No code uses `internal` or `FileStorageController` by name, so `knip.config.ts` lists these files as entries; do not delete those exports as dead code.
- `src/storage` holds the disk logic: storage roots, upload tokens, staging promotion and publication.
- The suites live in `src/test` and compile with the package; `ajs module test` runs them from `dist/test`.

## Versioning

This module implements `@antelopejs/interface-file-storage`, and `ImplementInterface` refuses a provider that lacks a declared function. Its range is therefore capped below the next minor (`<0.2.0`). Moving to a new minor means implementing what it adds and raising both bounds in the same release. `pnpm lint` runs `antelopejs-check-interface-ranges`, which checks these ranges.

## Tests

- `pnpm test` builds `dist`, then runs `ajs module test .` with `src/test/antelope.test.ts`. That config loads this module and `@antelopejs/api` 1.3.0 (fetched into `.antelope/cache`), serves on `127.0.0.1:3000`, and runs the suites in `dist/test` plus the shared conformance suite of `@antelopejs/interface-file-storage`. Port 3000 must be free.
- The module supports Windows. Tests simulate Windows behaviour on Linux through `src/test/platform.ts`, but `pnpm run checks` runs on Linux only. CI's `windows-tests` job runs `pnpm format:check` and `pnpm test` on `windows-latest`; locally, on a Windows machine, run `pnpm install --frozen-lockfile --ignore-scripts` (the managed `prepare` script is POSIX shell and fails in cmd.exe), then `pnpm test`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
