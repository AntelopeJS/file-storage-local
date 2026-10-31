import type { VerifyConfig } from "@antelopejs/tooling-configs/verify";

import { objectJourneys } from "./journeys-objects.ts";
import { readJourneys } from "./journeys-read.ts";
import { smokeJourneys } from "./journeys-smoke.ts";
import { stagingJourneys } from "./journeys-staging.ts";
import { storageJourneys } from "./journeys-storages.ts";
import { uploadJourneys } from "./journeys-upload.ts";

const config: VerifyConfig = {
  doors: {
    data: {
      globs: ["src/implementations/file-storage/**", "src/storage/**"],
      funnels: ["src/storage/token-manager.ts"],
      containments: ["objects/objects-lifecycle"],
      why: "every file an application stores is written, moved and deleted on the instance's disk by these modules: the key layout, the delete and the move decide which files exist and which are lost",
    },
    format: {
      globs: ["src/storage/token-manager.ts", "src/storage/promotion.ts", "src/storage/publication.ts"],
      funnels: ["src/storage/token-manager.ts"],
      containments: ["objects/stored-format"],
      why: "the files/ and metadata/ layout and the description record outlive a release: files stored by this version are read by the next one from the same folder",
    },
    contract: {
      globs: ["package.json", "src/module-config.ts"],
      funnels: [],
      containments: [],
      why: "the config keys (`storagePath`, `baseUrl`, the token lifetimes, `storages`), `antelopeJs.implements` and the interface range",
    },
    outbound: null,
    exposure: {
      globs: ["src/routes/**"],
      funnels: ["src/routes/index.ts"],
      containments: [],
      why: "these routes are the HTTP surface of the stored files: the token and visibility checks decide who can write a file and who can read a private one",
    },
    publish: {
      globs: ["package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      containments: [],
      why: "the package name and release workflow claim @antelopejs/file-storage-local on npm",
    },
  },
  journeys: { ...uploadJourneys, ...readJourneys, ...objectJourneys, ...stagingJourneys, ...storageJourneys, ...smokeJourneys },
};

export default config;
