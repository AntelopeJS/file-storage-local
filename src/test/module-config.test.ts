import assert from "node:assert/strict";

import {
  clearModuleState,
  getStorageConfig,
  setModuleState,
  type Config,
  type StorageConfig,
} from "../module-config";
import { TokenManager } from "../storage/token-manager";

const Seconds = 60;

function configWith(storages: ReadonlyMap<string, StorageConfig>): Config {
  return {
    storagePath: "unused",
    baseUrl: "http://127.0.0.1:3000",
    defaultVisibility: "private",
    uploadTokenExpiration: Seconds,
    readTokenExpiration: Seconds,
    cleanupInterval: 0,
    storages,
  };
}

describe("getStorageConfig", () => {
  afterEach(() => clearModuleState());

  it("answers not found for an inherited object key such as 'constructor'", () => {
    setModuleState(configWith(new Map()), new TokenManager("unused"));
    assert.throws(
      () => getStorageConfig("constructor"),
      /Storage 'constructor' not found/,
    );
  });
});
