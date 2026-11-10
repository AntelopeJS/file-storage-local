# Changelog

## v0.2.1

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.2.0...v0.2.1)

### 🔥 Performance

- **storage:** Drop the second existence check on reads ([#79](https://github.com/AntelopeJS/file-storage-local/pull/79))

### 🩹 Fixes

- **verify:** Load the api release the tests load ([#69](https://github.com/AntelopeJS/file-storage-local/pull/69))
- **verify:** Cover the files each feature's journeys exercise ([#72](https://github.com/AntelopeJS/file-storage-local/pull/72))

### 📦 Build

- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#68](https://github.com/AntelopeJS/file-storage-local/pull/68))
- **test:** Commit the module lock of the test project ([#70](https://github.com/AntelopeJS/file-storage-local/pull/70))
- **deps:** Bump @antelopejs/tooling-configs to 0.3.4 ([#71](https://github.com/AntelopeJS/file-storage-local/pull/71))
- **deps:** Bump @antelopejs/tooling-configs to 0.4.0 ([#74](https://github.com/AntelopeJS/file-storage-local/pull/74))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.0 ([#76](https://github.com/AntelopeJS/file-storage-local/pull/76))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.1 ([#78](https://github.com/AntelopeJS/file-storage-local/pull/78))

### 🏡 Chore

- **verify:** Remove seeded runs from the verification skill ([#65](https://github.com/AntelopeJS/file-storage-local/pull/65))
- **ci:** Remove the weekly mutation caller ([#66](https://github.com/AntelopeJS/file-storage-local/pull/66))

### 🤖 CI

- Call ci-node.yml@v1 ([#67](https://github.com/AntelopeJS/file-storage-local/pull/67))
- **windows:** Set up pnpm with corepack instead of pnpm/action-setup ([#73](https://github.com/AntelopeJS/file-storage-local/pull/73))
- **modules-update:** Call the shared modules-update workflow ([#75](https://github.com/AntelopeJS/file-storage-local/pull/75))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.2.0

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.13...v0.2.0)

### 💅 Refactors

- Clean the repo with the guardrail pack ([#43](https://github.com/AntelopeJS/file-storage-local/pull/43))
- **storage:** Check promoted metadata with a type guard ([#44](https://github.com/AntelopeJS/file-storage-local/pull/44))

### 📖 Documentation

- **changelog:** Upgrade notes of file-storage-local 0.1.13 ([#40](https://github.com/AntelopeJS/file-storage-local/pull/40))
- **readme:** Use one Discord invite ([#52](https://github.com/AntelopeJS/file-storage-local/pull/52))
- **github:** Send questions and ideas to Discord ([#54](https://github.com/AntelopeJS/file-storage-local/pull/54))
- **readme:** Link the package to AntelopeJS and AntelopeJS DMS ([d38249d](https://github.com/AntelopeJS/file-storage-local/commit/d38249d))

### 📦 Build

- **deps:** Bump @antelopejs/tooling-configs to 0.2.17 ([#46](https://github.com/AntelopeJS/file-storage-local/pull/46))

### 🏡 Chore

- Adopt the guardrail pack from tooling-configs 0.2.0 ([#41](https://github.com/AntelopeJS/file-storage-local/pull/41))
- Configure Renovate with the shared preset ([#42](https://github.com/AntelopeJS/file-storage-local/pull/42))
- Land the cleanup campaign on main ([#64](https://github.com/AntelopeJS/file-storage-local/pull/64))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.1.13

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.12...v0.1.13)

### Upgrade notes

- Implements `ReadFile` from `@antelopejs/interface-file-storage` 0.1.6: streams the stored file from disk (staged or promoted, private or public) with its size and MIME type, without a read token or an HTTP request to `baseUrl` ([#38](https://github.com/AntelopeJS/file-storage-local/pull/38)).
- Implements `@antelopejs/interface-file-storage` `>=0.1.6 <0.2.0`. Upgrade it together with interface-file-storage 0.1.6: a provider without `readFile` (0.1.12 and older) fails to construct against it.

### 🚀 Enhancements

- Implement ReadFile from the storage directory ([#38](https://github.com/AntelopeJS/file-storage-local/pull/38))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.12

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.11...v0.1.12)

## v0.1.11

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.10...v0.1.11)

### 🚀 Enhancements

- Warn at production start that files need one instance on a persistent disk ([#36](https://github.com/AntelopeJS/file-storage-local/pull/36))

### 🏡 Chore

- **release:** V0.1.10 ([#37](https://github.com/AntelopeJS/file-storage-local/pull/37))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.10

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.9...v0.1.10)

### 🚀 Enhancements

- Implement WriteFile with the upload token path ([#35](https://github.com/AntelopeJS/file-storage-local/pull/35))

### 💅 Refactors

- **upload:** Take the upload body from @BodyStream() ([#34](https://github.com/AntelopeJS/file-storage-local/pull/34))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.9

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.8...v0.1.9)

### 📖 Documentation

- Rewrite the README ([#31](https://github.com/AntelopeJS/file-storage-local/pull/31))
- **agents:** Simplify repository guidance ([#32](https://github.com/AntelopeJS/file-storage-local/pull/32))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.8

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.7...v0.1.8)

### 🩹 Fixes

- Make the local storage work on Windows ([#30](https://github.com/AntelopeJS/file-storage-local/pull/30))

### ❤️ Contributors

- Maxime Westhoven ([@mwesto](http://github.com/mwesto))

## v0.1.7

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.6...v0.1.7)

### 🩹 Fixes

- **storage:** Stop directory sync at the created folder on Windows extended-length paths ([#28](https://github.com/AntelopeJS/file-storage-local/pull/28))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.6

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.5...v0.1.6)

### 🩹 Fixes

- **routes:** Serve downloads with their stored content type and original filename ([#26](https://github.com/AntelopeJS/file-storage-local/pull/26))

### 🏡 Chore

- Remove .git-blame-ignore-revs ([#22](https://github.com/AntelopeJS/file-storage-local/pull/22))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#23](https://github.com/AntelopeJS/file-storage-local/pull/23))
- **release:** Reference the shared release workflows through v1 ([#24](https://github.com/AntelopeJS/file-storage-local/pull/24))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.5

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- **storage:** Tolerate unsupported directory fsync on Windows ([#19](https://github.com/AntelopeJS/file-storage-local/pull/19))

### 📖 Documentation

- Add public package readme ([#16](https://github.com/AntelopeJS/file-storage-local/pull/16))

### 🏡 Chore

- Align community files with the organization defaults ([#18](https://github.com/AntelopeJS/file-storage-local/pull/18))

### 🤖 CI

- Use shared npm release workflow ([#17](https://github.com/AntelopeJS/file-storage-local/pull/17))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.4

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.3...v0.1.4)

### 🩹 Fixes

- **storage:** Prevent private-read token path traversal ([#13](https://github.com/AntelopeJS/file-storage-local/pull/13))
- **storage:** Harden uploads and promotion with per-file visibility ([#15](https://github.com/AntelopeJS/file-storage-local/pull/15))

### 🏡 Chore

- Replace Biome with oxlint, oxfmt and Knip ([#12](https://github.com/AntelopeJS/file-storage-local/pull/12))

### 🤖 CI

- Standardize npm releases ([#11](https://github.com/AntelopeJS/file-storage-local/pull/11))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Thomas ([@Thomasims](http://github.com/Thomasims))

## v0.1.3

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.2...v0.1.3)

### 🩹 Fixes

- **deps:** Support newer interface releases ([#10](https://github.com/AntelopeJS/file-storage-local/pull/10))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v0.1.2

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.1...v0.1.2)

### 🔥 Performance

- Stream file downloads instead of buffering entire files in memory ([#9](https://github.com/AntelopeJS/file-storage-local/pull/9))

### ❤️ Contributors

- Fabrice Cst <fabrice@altab.be>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.1.0...v0.1.1)

## v0.1.0

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.0.3...v0.1.0)

### 🚀 Enhancements

- Staging upload + file promotion ([#6](https://github.com/AntelopeJS/file-storage-local/pull/6))

### ❤️ Contributors

- Fabrice Cst <fabrice@altab.be>

## v0.0.3

[compare changes](https://github.com/AntelopeJS/file-storage-local/compare/v0.0.2...v0.0.3)

### 💅 Refactors

- Switch test modules from local to npm packages ([d29d61d](https://github.com/AntelopeJS/file-storage-local/commit/d29d61d))
- **logging:** Replace console calls with Logging interface ([fdf27ba](https://github.com/AntelopeJS/file-storage-local/commit/fdf27ba))

### 🏡 Chore

- Update dependencies ([bec1c0d](https://github.com/AntelopeJS/file-storage-local/commit/bec1c0d))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v0.0.2

### 🩹 Fixes

- Urls ([a7828ad](https://github.com/AntelopeJS/file-storage-local/commit/a7828ad))
- Read file route ([84d99ed](https://github.com/AntelopeJS/file-storage-local/commit/84d99ed))
- Read stream ([d82b0b9](https://github.com/AntelopeJS/file-storage-local/commit/d82b0b9))
- Stream end ([8ec581e](https://github.com/AntelopeJS/file-storage-local/commit/8ec581e))
- Path handling ([658a992](https://github.com/AntelopeJS/file-storage-local/commit/658a992))
- Visibility handling ([e1ceeed](https://github.com/AntelopeJS/file-storage-local/commit/e1ceeed))
- The original file name is now properly sent/retreived ([#1](https://github.com/AntelopeJS/file-storage-local/pull/1))

### 💅 Refactors

- Metadata.filename and filename were coexisting ([#2](https://github.com/AntelopeJS/file-storage-local/pull/2))

### 🏡 Chore

- Import ([2cd3d18](https://github.com/AntelopeJS/file-storage-local/commit/2cd3d18))
- Remove dist ([a0b0c31](https://github.com/AntelopeJS/file-storage-local/commit/a0b0c31))
- Lint ([aae6da9](https://github.com/AntelopeJS/file-storage-local/commit/aae6da9))
- Replicate ai agent config files (.agents/.claude) ([#3](https://github.com/AntelopeJS/file-storage-local/pull/3))
- Remove ci publish adopt guidelines strict ts interface tests ([#4](https://github.com/AntelopeJS/file-storage-local/pull/4))
- Simplify CI workflow triggers and update AGENTS.md ([b92d966](https://github.com/AntelopeJS/file-storage-local/commit/b92d966))
- Migrate from eslint and prettier to biome ([#5](https://github.com/AntelopeJS/file-storage-local/pull/5))
- Migrate from local beta interfaces to published @antelopejs packages ([0edcb65](https://github.com/AntelopeJS/file-storage-local/commit/0edcb65))

### 🤖 CI

- Remove test:coverage step from CI workflow ([32985c2](https://github.com/AntelopeJS/file-storage-local/commit/32985c2))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- Glastis ([@Glastis](http://github.com/Glastis))
