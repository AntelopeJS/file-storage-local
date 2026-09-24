import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "file-storage-local-test",
  cacheFolder: ".antelope/cache",
  modules: {
    local: {
      source: { type: "local", path: "." },
      config: {
        storagePath: ".antelope/cache/storage",
        baseUrl: "http://127.0.0.1:3000",
        defaultVisibility: "private",
        uploadTokenExpiration: 3600,
        readTokenExpiration: 300,
        cleanupInterval: 300,
        storages: {
          media: {
            storagePath: ".antelope/cache/storage-media",
            baseUrl: "http://127.0.0.1:3000",
            defaultVisibility: "private",
            uploadTokenExpiration: 3600,
            readTokenExpiration: 300,
            cleanupInterval: 300,
          },
        },
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "1.3.0",
      },
      config: {
        publicBaseUrl: "http://127.0.0.1:3000",
        servers: [{ protocol: "http", host: "127.0.0.1", port: 3000 }],
        cors: { allowedOrigins: ["http://localhost:3000"] },
      },
    },
  },
  test: {
    folder: "dist/test",
    async setup() {
      const entry = require.resolve("@antelopejs/interface-file-storage");
      await access(join(dirname(entry), "tests", "file-storage.test.js"));
      return undefined;
    },
  },
});
