import { defineConfig, mergeConfig } from "vitest/config";

import vitestConfig from "./vitest.config.ts";

// These suites exercise real bootstrap, Native discovery and process lifetimes.
// They remain in the default and coverage suites, not the commit feedback loop.
export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      exclude: [
        "tests/shared/tooling/native-selection.test.ts",
        "tests/shared/tooling/process-lifecycle.test.ts",
        "tests/shared/tooling/qualification.test.ts",
        "tests/shared/tooling/snapshot-gate.test.ts",
      ],
    },
  })
);
