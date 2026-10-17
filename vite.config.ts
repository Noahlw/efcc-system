import { randomBytes } from "node:crypto";
import path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

import { assertRuntimeBoundaries } from "./scripts/runtime-boundaries.ts";
import { assertNativeSource } from "./tests/support/native-source.ts";

const getNativeDevStatePath = () => {
  const statePath = process.env.EFCC_NATIVE_DEV_STATE_PATH;
  if (!statePath) {
    throw new Error(
      "The native Vite status lane requires a private state path."
    );
  }
  return statePath;
};
const createNativeDevOptions = (root: string) => {
  const secret = randomBytes(32).toString("hex");
  const trustedOrigin = process.env.EFCC_NATIVE_DEV_AUTH_ORIGIN;
  if (!trustedOrigin) {
    throw new Error(
      "The native Vite status lane requires an ephemeral trusted origin binding."
    );
  }
  const config = () => ({
    vars: {
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_TRUSTED_ORIGINS: trustedOrigin,
    },
  });
  return {
    auxiliaryWorkers: [
      {
        config,
        configPath: path.join(root, "tests/worker/provision.jsonc"),
        devOnly: true,
      },
    ],
    config,
    persistState: { path: getNativeDevStatePath() },
  };
};
export default defineConfig(({ command, mode }) => {
  assertRuntimeBoundaries(import.meta.dirname);
  const nativeTest = mode === "native-test";
  const nativeDevStatusLane = nativeTest && command === "serve";
  const nativeDevRootPath = process.env.EFCC_NATIVE_DEV_ROOT;
  const nativeDevStatePath = process.env.EFCC_NATIVE_DEV_STATE_PATH;
  const nativeDevMiniflareRegistryPath = process.env.MINIFLARE_REGISTRY_PATH;
  const nativeDevWranglerRegistryPath = process.env.WRANGLER_REGISTRY_PATH;
  const scratchRoot = `${path.resolve(import.meta.dirname, ".scratch")}${path.sep}`;
  if (
    nativeDevStatusLane &&
    (!nativeDevRootPath ||
      !nativeDevStatePath ||
      !nativeDevMiniflareRegistryPath ||
      !nativeDevWranglerRegistryPath ||
      path.resolve(nativeDevMiniflareRegistryPath) !==
        path.resolve(nativeDevWranglerRegistryPath) ||
      path.dirname(path.resolve(nativeDevStatePath)) !==
        path.resolve(nativeDevRootPath) ||
      path.dirname(path.resolve(nativeDevMiniflareRegistryPath)) !==
        path.resolve(nativeDevRootPath) ||
      !path.resolve(nativeDevRootPath).startsWith(scratchRoot))
  ) {
    throw new Error(
      "The native Vite status lane requires private paths inside this worktree."
    );
  }
  if (nativeTest) {
    assertNativeSource(import.meta.dirname);
  }

  return {
    envDir: nativeTest ? false : undefined,
    optimizeDeps: {
      // Keep a single React instance for the client runtime and UI libraries.
      include: ["@base-ui/react", "@tanstack/react-form", "react", "react-dom"],
    },
    plugins: [
      vinext(),
      tailwindcss(),
      cloudflare({
        ...(nativeDevStatusLane
          ? createNativeDevOptions(import.meta.dirname)
          : {}),
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
