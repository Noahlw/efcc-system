import { defineConfig } from "vitest/config";

import vitestConfig from "./vitest.config.ts";

export default defineConfig({
  ...vitestConfig,
  test: {
    ...vitestConfig.test,
    include: ["tests/shared/account/application-contract.test.ts"],
  },
});
