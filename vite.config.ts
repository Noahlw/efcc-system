import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

import { assertNativeSource } from "./tests/support/native-source.ts";

export default defineConfig(({ mode }) => {
  if (mode === "native-test") {
    assertNativeSource(import.meta.dirname);
  }
  return {
    envDir: mode === "native-test" ? false : undefined,
    optimizeDeps: {
      // Keep a single React instance for the client runtime and UI libraries.
      include: ["@base-ui/react", "@tanstack/react-form", "react", "react-dom"],
    },
    plugins: [
      vinext(),
      tailwindcss(),
      cloudflare({
        // The vinext worker entry runs in the RSC environment, with SSR as a child.
        viteEnvironment: {
          childEnvironments: ["ssr"],
          name: "rsc",
        },
      }),
    ],
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  };
});
