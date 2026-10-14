# @antelopejs/file-storage-local

<div align="center">
<a href="https://www.npmjs.com/package/@antelopejs/file-storage-local"><img alt="NPM version" src="https://img.shields.io/npm/v/@antelopejs/file-storage-local.svg?style=for-the-badge&labelColor=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/file-storage-local.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

Local-filesystem implementation of the AntelopeJS file-storage interface. It
provides signed upload and read URLs, public and private visibility, named
storage roots, metadata, and staged-file promotion.

Use this module for local development and single-instance deployments. Files
are stored on one machine and are not shared between replicas. Use
[`@antelopejs/file-storage-s3`](https://github.com/AntelopeJS/file-storage-s3)
for clustered or horizontally scaled deployments.

## Installation

```bash
pnpm add @antelopejs/file-storage-local
```

The module implements
[`@antelopejs/interface-file-storage`](https://github.com/AntelopeJS/interface-file-storage).
Install an AntelopeJS API module as well to expose its upload and download
routes.

## Configuration

Add the module to `antelope.config.ts`:

```ts
import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "my-app",
  modules: {
    storage: {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
      },
      config: {
        storagePath: ".antelope/storage",
        baseUrl: "http://localhost:3000",
        defaultVisibility: "private",
        uploadTokenExpiration: 3600,
        readTokenExpiration: 300,
        cleanupInterval: 300,
      },
    },
  },
});
```

Expiration and cleanup values are expressed in seconds. Set
`stagingExpiration` to periodically remove staged files that were never
promoted.

Named storage roots can provide independent policies:

```ts
config: {
  storagePath: ".antelope/storage",
  baseUrl: "http://localhost:3000",
  defaultVisibility: "private",
  uploadTokenExpiration: 3600,
  readTokenExpiration: 300,
  cleanupInterval: 300,
  storages: {
    media: {
      storagePath: ".antelope/media",
      baseUrl: "http://localhost:3000",
      defaultVisibility: "public",
      uploadTokenExpiration: 3600,
      readTokenExpiration: 300,
      cleanupInterval: 300,
    },
  },
}
```

Storage roots must not overlap. The name `default` is reserved.

## Resource keys

Resource keys and upload `path` values are `/`-separated and must stay inside
their storage root: `.` and `..` segments are rejected on every platform. On
Windows, segments that contain `< > : " \ | ? *` or control characters, end
with a dot or a space, or use a reserved device name such as `CON`, `NUL` or
`COM1` are rejected as well, because Windows cannot store them. Generated keys
keep the uploaded filename extension only when it is made of letters, digits,
`_` or `-` (16 characters at most).

On Windows, storage roots must live on a filesystem that supports hard links,
such as NTFS (not FAT32 or exFAT), and keys that differ only by letter case
address the same file.

## Development

```bash
pnpm install
pnpm lint
pnpm format:check
pnpm test
```

See the organization-wide
[contribution guidelines](https://github.com/AntelopeJS/.github/blob/main/CONTRIBUTING.md)
and [security policy](SECURITY.md).

## License

Apache-2.0
