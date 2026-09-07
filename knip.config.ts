import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  entry: [
    // The AntelopeJS runtime reads these by convention rather than by import:
    // ImplementInterface picks up the `internal` namespace of the implementation
    // module, and the @Controller/@Get/@Put decorators register the route class
    // as a side effect of `import "./routes"`.
    "src/implementations/**/*.ts",
    "src/routes/**/*.ts",
  ],
  // `ajs` comes from @antelopejs/core, which CI installs globally rather than
  // pulling the whole CLI into every module's dependency tree.
  ignoreBinaries: ["ajs"],
  ignoreDependencies: [
    // Mocha's globals, supplied to the suites `ajs module test` runs.
    "@types/mocha",
  ],
});
