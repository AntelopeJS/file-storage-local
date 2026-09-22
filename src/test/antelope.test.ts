import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";

const ANY_FREE_PORT = 0;
const UNUSED_PUBLIC_BASE_URL = "https://api.test.example.com";
const API_LOCAL_BASE_URL = "${@api.API_LOCAL_BASE_URL}";

export default defineConfig({
  name: "file-storage-local-test",
  cacheFolder: ".antelope/cache",
  modules: {
    local: {
      source: { type: "local", path: "." },
      config: {
        storagePath: ".antelope/cache/storage",
        baseUrl: API_LOCAL_BASE_URL,
        defaultVisibility: "private",
        uploadTokenExpiration: 3600,
        readTokenExpiration: 300,
        cleanupInterval: 300,
        storages: {
          media: {
            storagePath: ".antelope/cache/storage-media",
            baseUrl: API_LOCAL_BASE_URL,
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
        version: "^1.3.0",
      },
      config: {
        publicBaseUrl: UNUSED_PUBLIC_BASE_URL,
        servers: [{ protocol: "http", host: "127.0.0.1", port: ANY_FREE_PORT }],
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
