<a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration src="./.github/readme/strip.svg" width="100%" alt="PROVIDER · FILE STORAGE LOCAL: part of AntelopeJS, hexagonal architecture beyond your own code. A glowing button reads Star AntelopeJS."></a>

<div align="center">

# `@antelopejs/file-storage-local`

<a href="https://www.npmjs.com/package/@antelopejs/file-storage-local"><img data-illustration alt="npm" src="https://img.shields.io/npm/v/@antelopejs/file-storage-local?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="./LICENSE"><img data-illustration alt="License" src="https://img.shields.io/npm/l/@antelopejs/file-storage-local?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="https://discord.gg/g4pFt6eXqu"><img data-illustration alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a> <a href="https://github.com/AntelopeJS/interface-file-storage/tree/main/docs"><img data-illustration alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a> <a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration alt="Star AntelopeJS" src="https://img.shields.io/github/stars/AntelopeJS/antelopejs?label=Star%20AntelopeJS&style=for-the-badge&labelColor=000000&color=000000&logo=github"></a>

**The AntelopeJS file storage module for a single machine. It stores files on the local filesystem and serves signed upload and read URLs.**

[Documentation](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) · [Interfaces](#interfaces) · [All interfaces and providers](https://github.com/AntelopeJS/antelopejs#ecosystem)

</div>

The AntelopeJS file storage module for a single machine. It keeps the files of the file storage interface on the local filesystem and serves signed upload and read URLs through the API module.

Use it for development and for a deployment with one instance, because instances do not share files. For several instances, use [`@antelopejs/file-storage-s3`](https://github.com/AntelopeJS/file-storage-s3).

In production, run exactly one instance and put `storagePath` on a persistent disk. A container's temporary directory loses every file when the instance sleeps, restarts, or is replaced. A second instance never sees the files of the first, so an upload can land on one instance and its confirmation on the other. On AntelopeJS Cloud, attach a volume to the service and point `storagePath` at its mount path. Attaching a volume keeps the service at one replica. The module cannot tell a persistent disk from a temporary one, so it logs a warning on every start outside dev mode.

## Interfaces

| Interface                                                                                    | Documentation                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@antelopejs/interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage) | [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) |

The interface pages document uploads, reads, visibility, metadata, staging, and promotion. The module serves its routes through [`@antelopejs/interface-api`](https://interfaces.antelopejs.com/docs/api/introduction), implemented by [`@antelopejs/api`](https://github.com/AntelopeJS/api).

## Install

```bash
ajs project modules add @antelopejs/file-storage-local
ajs project modules install
```

`ajs project modules install` adds a module for each interface that the project imports and no module implements. For `@antelopejs/interface-api`, that module is `@antelopejs/api`. This module ships no default configuration, so add a `config` block with at least `storagePath` and `baseUrl`.

## Configuration

```typescript [antelope.config.ts]
import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "my-project",
  modules: {
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "^0.1.8",
      },
      config: {
        storagePath: ".antelope/storage",
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
        uploadTokenExpiration: 3600,
        readTokenExpiration: 60,
        cleanupInterval: 300,
        stagingExpiration: 86400,
        storages: {
          media: {
            storagePath: ".antelope/media",
            baseUrl: "${@api.API_PUBLIC_BASE_URL}",
            defaultVisibility: "public",
          },
        },
      },
    },
  },
});
```

| Key                     | Default     | Description                                                                                                                     |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `storagePath`           | required    | Folder that holds the files.                                                                                                    |
| `baseUrl`               | required    | Public origin of the API module. Upload and read URLs start with `<baseUrl>/file-storage/`.                                     |
| `defaultVisibility`     | `"private"` | Visibility of a file uploaded without one, `"public"` or `"private"`.                                                           |
| `uploadTokenExpiration` | `3600`      | Lifetime of an upload URL, in seconds.                                                                                          |
| `readTokenExpiration`   | `60`        | Lifetime of a private read URL when `CreateReadUrl` gets no `expiresIn`, in seconds.                                            |
| `cleanupInterval`       | `300`       | Interval of the expired-token cleanup, in seconds. `0` or less turns the cleanup off.                                           |
| `stagingExpiration`     | none        | When set, the cleanup also deletes staged files older than this many seconds. Without it, staged files stay.                    |
| `storages`              | none        | Named storages, each with the keys above except `storages`. Address one with the `storage` argument of the interface functions. |

A named storage gets the same defaults for the keys it leaves out. The cleanup and the staging sweep run on each storage with its own `cleanupInterval` and `stagingExpiration`.

`${@api.API_PUBLIC_BASE_URL}` is a [config variable](https://framework.antelopejs.com/docs/concepts/configuration#module-config-variables) that `@antelopejs/api` publishes under the module key `api`. Storage folders must not overlap, and the storage name `default` is reserved. The module refuses to start otherwise.

## Quick start

In the module that handles uploads, add the interface:

```bash
pnpm add @antelopejs/interface-file-storage
```

```typescript
import {
  CreateReadUrl,
  CreateUploadUrl,
} from "@antelopejs/interface-file-storage";

const upload = await CreateUploadUrl(
  { filename: "avatar.png", size: 52_000, mimetype: "image/png" },
  { maxSize: 1_000_000, allowedMimetypes: ["image/png", "image/jpeg"] },
);

const read = await CreateReadUrl(upload.resourceKey);
```

The client sends the file with `PUT upload.uploadUrl` and the returned `upload.headers`, then fetches it from `read.url`.

## Platform notes

- Resource keys and upload paths use `/` as the separator and stay inside their storage. The module rejects `.` and `..` segments.
- A generated key keeps the extension of the uploaded file only when the extension has 1 to 16 letters, digits, `_`, or `-`.
- The module publishes files with hard links, so storage folders must be on a filesystem that supports them. On Windows, use NTFS.
- On Windows, keys that differ only by letter case address the same file. The module rejects segments that Windows cannot store: reserved characters, control characters, a trailing dot or space, and device names such as `CON` or `NUL`.

## Documentation

- [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) documents the `@antelopejs/interface-file-storage` contract that this module implements.
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration) covers module sources, `config` blocks, and config variables in `antelope.config.ts`.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                              | Supported         | Tested with |
| ------------------------------------ | ----------------- | ----------- |
| `@antelopejs/interface-api`          | `>=0.0.16 <1.0.0` | `0.0.16`    |
| `@antelopejs/interface-core`         | `>=0.4.0 <1.0.0`  | `0.4.0`     |
| `@antelopejs/interface-file-storage` | `>=0.1.6 <0.2.0`  | `0.1.6`     |

<!-- antelopejs-docs-compat:end -->

CI runs the tests on Linux and Windows, with the Node.js release that `.nvmrc` names.

## Contributing

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm knip
pnpm test           # build, then ajs module test
```

The tests also run the shared conformance suite of `@antelopejs/interface-file-storage`. Read the [contribution guidelines](CONTRIBUTING.md) before opening a pull request.

## Part of AntelopeJS

This package belongs to [AntelopeJS](https://github.com/AntelopeJS/antelopejs), the TypeScript framework where modules depend on contracts and the application chooses the provider. The open-source back office [AntelopeJS DMS](https://github.com/AntelopeJS/dms) is built on it.

<!-- antelopejs-framework-modules:start -->

| Area         | Contracts                                                                                                                                                                                                                                                                                                                                                                                                                  | Providers                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | [`interface-api`](https://github.com/AntelopeJS/interface-api) · [`interface-api-util`](https://github.com/AntelopeJS/interface-api-util) · [`interface-data-api`](https://github.com/AntelopeJS/interface-data-api)                                                                                                                                                                                                       | [`api`](https://github.com/AntelopeJS/api)                                                                                                                                                                                                          |
| Auth         | [`interface-auth`](https://github.com/AntelopeJS/interface-auth)                                                                                                                                                                                                                                                                                                                                                           | [`auth-jwt`](https://github.com/AntelopeJS/auth-jwt)                                                                                                                                                                                                |
| Database     | [`interface-database`](https://github.com/AntelopeJS/interface-database) · [`interface-database-decorators`](https://github.com/AntelopeJS/interface-database-decorators) · [`interface-database-catalog`](https://github.com/AntelopeJS/interface-database-catalog) · [`interface-mongodb`](https://github.com/AntelopeJS/interface-mongodb) · [`interface-rethinkdb`](https://github.com/AntelopeJS/interface-rethinkdb) | [`postgres`](https://github.com/AntelopeJS/postgres) · [`mysql`](https://github.com/AntelopeJS/mysql) · [`mongodb`](https://github.com/AntelopeJS/mongodb) · [`rethinkdb`](https://github.com/AntelopeJS/rethinkdb)                                 |
| Redis        | [`interface-redis`](https://github.com/AntelopeJS/interface-redis) · [`interface-redis-scheduler`](https://github.com/AntelopeJS/interface-redis-scheduler)                                                                                                                                                                                                                                                                | [`redis`](https://github.com/AntelopeJS/redis)                                                                                                                                                                                                      |
| Email        | [`interface-email`](https://github.com/AntelopeJS/interface-email)                                                                                                                                                                                                                                                                                                                                                         | [`nodemailer`](https://github.com/AntelopeJS/nodemailer) · [`brevo`](https://github.com/AntelopeJS/brevo)                                                                                                                                           |
| File storage | [`interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage)                                                                                                                                                                                                                                                                                                                                           | **`file-storage-local`** · [`file-storage-s3`](https://github.com/AntelopeJS/file-storage-s3)                                                                                                                                                       |
| Payments     | [`interface-payment`](https://github.com/AntelopeJS/interface-payment) · [`interface-subscriptions`](https://github.com/AntelopeJS/interface-subscriptions) · [`interface-stripe`](https://github.com/AntelopeJS/interface-stripe)                                                                                                                                                                                         | [`stripe`](https://github.com/AntelopeJS/stripe) · [`mollie`](https://github.com/AntelopeJS/mollie) · [`checkout-com`](https://github.com/AntelopeJS/checkout-com) · [`payment-subscriptions`](https://github.com/AntelopeJS/payment-subscriptions) |

<!-- antelopejs-framework-modules:end -->

## License

[Apache-2.0](LICENSE)
