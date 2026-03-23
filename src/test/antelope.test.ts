import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "file-storage-local-test",
  cacheFolder: ".antelope/cache",
  modules: {
    local: {
      source: { type: "local", path: "." },
      config: {
        storagePath: ".antelope/cache/storage",
        baseUrl: "http://localhost:3000",
        defaultVisibility: "private",
        uploadTokenExpiration: 3600,
        readTokenExpiration: 300,
        cleanupInterval: 300,
      },
    },
    api: {
      source: {
        type: "local",
        path: "../api",
        installCommand: ["pnpm install", "npx tsc"],
      },
      config: {
        servers: [{ protocol: "http", host: "127.0.0.1", port: 3000 }],
        cors: { allowedOrigins: ["http://localhost:3000"] },
      },
    },
  },
  test: {
    folder: "dist/test",
  },
});
