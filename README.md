# @antelopejs/file-storage-local

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/file-storage-local"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/file-storage-local?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/file-storage-local?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://github.com/AntelopeJS/interface-file-storage/tree/main/docs"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

The AntelopeJS file storage module for a single machine: it stores the file-storage interface's files on the local filesystem and serves signed upload and read URLs through the API module.

Use it for development and single-instance deployments: files are not shared between replicas. Use [`@antelopejs/file-storage-s3`](https://github.com/AntelopeJS/file-storage-s3) for clustered deployments.

In production, run exactly one instance, with `storagePath` on a persistent disk: a container's temporary directory loses every file when the instance sleeps, restarts or is replaced, and a second instance never sees the first one's files (an upload lands on one, its confirmation on the other). On AntelopeJS Cloud, attach a volume to the service and point `storagePath` at its mount path; attaching it keeps the service at one replica. The module logs this as a warning on every production start, since it cannot tell a persistent disk from a temporary one.

## Interfaces

| Interface                                                                                    | Documentation                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@antelopejs/interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage) | [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs) |

Uploads, reads, visibility, metadata, staging and promotion are documented on the interface pages. The module serves its routes through [`@antelopejs/interface-api`](https://interfaces.antelopejs.com/docs/api/introduction), implemented by [`@antelopejs/api`](https://github.com/AntelopeJS/api).

## Install

```bash
ajs project modules add @antelopejs/file-storage-local
ajs project modules install
```

`ajs project modules install` adds `@antelopejs/api` when the project has no API module yet. The module ships no default configuration: add a `config` block with at least `storagePath` and `baseUrl`.

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

| Key                     | Default     | Description                                                                                                   |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `storagePath`           | required    | Folder that holds the files.                                                                                  |
| `baseUrl`               | required    | Public origin of the API module. Upload and read URLs are `<baseUrl>/file-storage/...`.                       |
| `defaultVisibility`     | `"private"` | Visibility of files uploaded without an explicit one: `"public"` or `"private"`.                              |
| `uploadTokenExpiration` | `3600`      | Lifetime of an upload URL, in seconds.                                                                        |
| `readTokenExpiration`   | `60`        | Lifetime of a private read URL, in seconds.                                                                   |
| `cleanupInterval`       | `300`       | Interval of the expired-token cleanup, in seconds.                                                            |
| `stagingExpiration`     | none        | When set, the cleanup also deletes staged files older than this many seconds. Without it, staged files stay.  |
| `storages`              | none        | Named storages, each with the keys above. Address one with the `storage` argument of the interface functions. |

`${@api.API_PUBLIC_BASE_URL}` is a [config variable](https://framework.antelopejs.com/docs/concepts/configuration#module-config-variables) published by `@antelopejs/api` under the module key `api`. Storage folders must not overlap, and the storage name `default` is reserved.

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

- Resource keys and upload paths are `/`-separated and must stay inside their storage: `.` and `..` segments are rejected.
- Generated keys keep the uploaded file's extension only when it has at most 16 letters, digits, `_` or `-`.
- On Windows, storage folders must be on a filesystem with hard links, such as NTFS. Keys that differ only by letter case address the same file, and segments Windows cannot store (reserved characters, trailing dots or spaces, device names such as `CON` or `NUL`) are rejected.

## Documentation

- [File storage](https://github.com/AntelopeJS/interface-file-storage/tree/main/docs): the `@antelopejs/interface-file-storage` contract this module implements
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration): module sources, `config` blocks and config variables in `antelope.config.ts`

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                              | Supported         | Tested with |
| ------------------------------------ | ----------------- | ----------- |
| `@antelopejs/interface-api`          | `>=0.0.16 <1.0.0` | `0.0.16`    |
| `@antelopejs/interface-core`         | `>=0.2.4 <1.0.0`  | `0.2.4`     |
| `@antelopejs/interface-file-storage` | `>=0.1.6 <0.2.0`  | `0.1.6`     |

<!-- antelopejs-docs-compat:end -->

The module is developed and tested on Node.js 24, on Linux and Windows.

## Contributing

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm knip
pnpm test           # build, then ajs module test
```

The tests also run the shared conformance suite of `@antelopejs/interface-file-storage`. Read the [contribution guidelines](CONTRIBUTING.md) before opening a pull request.

## License

[Apache-2.0](LICENSE)
