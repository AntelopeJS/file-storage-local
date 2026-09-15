# @antelopejs/file-storage-local

[![npm](https://img.shields.io/npm/v/@antelopejs/file-storage-local)](https://www.npmjs.com/package/@antelopejs/file-storage-local)
[![CI](https://github.com/AntelopeJS/file-storage-local/actions/workflows/ci.yml/badge.svg)](https://github.com/AntelopeJS/file-storage-local/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

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
