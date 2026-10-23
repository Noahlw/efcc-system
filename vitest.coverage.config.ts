import { mergeConfig, defineConfig } from "vitest/config";

import vitestConfig from "./vitest.config.ts";

export default mergeConfig(
  vitestConfig,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        exclude: ["**/*.d.ts"],
        include: ["src/**/*.{ts,tsx}"],
        provider: "v8",
        reportOnFailure: true,
        reporter: ["text-summary", "json-summary", "json"],
        reportsDirectory: "coverage/production-source-unit",
      },
    },
  })
);
