import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "next/link": fileURLToPath(import.meta.resolve("vinext/shims/link")),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/worker/**/*.test.ts",
      "tests/ui/**/*.test.tsx",
      "tests/shared/**/*.test.ts",
    ],
  },
});
