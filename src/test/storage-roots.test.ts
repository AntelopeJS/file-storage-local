import { join, resolve } from "node:path";
import assert from "node:assert/strict";

import { rootsOverlap } from "../storage/storage-roots";

const Base = resolve("storage-roots");
const OverlappingRoots: Array<[string, string]> = [
  [Base, Base],
  [Base, join(Base, "media")],
  [join(Base, "media"), Base],
  [Base, join(Base, "..media")],
];
const DistinctRoots: Array<[string, string]> = [
  [join(Base, "default"), join(Base, "media")],
  [join(Base, "media"), join(Base, "media-archive")],
  [Base, join(Base, "..", "..media")],
  ["C:\\storage", "D:\\storage"],
  ["\\\\server\\share\\storage", "C:\\storage"],
];

describe("storage root overlap", () => {
  it("detects roots that share a directory", () => {
    for (const [root, candidate] of OverlappingRoots)
      assert.equal(rootsOverlap(root, candidate), true, candidate);
  });

  it("accepts sibling roots and roots on other drives or shares", () => {
    for (const [root, candidate] of DistinctRoots)
      assert.equal(rootsOverlap(root, candidate), false, candidate);
  });
});
