import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, lstatSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { defineConfig } from "@playwright/test";

import features from "./playwright.features.config";

const root = import.meta.dirname;
const createDevOrigin = async () => {
  // Config reloads in workers must retain the server's exact origin.
  if (process.env.TEST_WORKER_INDEX !== undefined) {
    const inherited = process.env.EFCC_NATIVE_DEV_AUTH_ORIGIN;
    const port = inherited?.match(
      /^http:\/\/127\.0\.0\.1:(?<port>[1-9]\d{0,4})$/u
    )?.groups?.port;
    if (!inherited || !port || Number(port) > 65_535) {
      throw new Error(
        "Native dev workers require their owned loopback origin."
      );
    }
    return inherited;
  }
  const reservation = createServer();
  const ready = once(reservation, "listening");
  reservation.listen(0, "127.0.0.1");
  await ready;
  try {
    const address = reservation.address();
    if (!address || typeof address === "string") {
      throw new Error("Native dev did not acquire a loopback port.");
    }
    return `http://127.0.0.1:${address.port}`;
  } finally {
    await promisify(reservation.close.bind(reservation))();
  }
};
// Vite still fails closed if another process wins the port handoff; no retry or reuse.
const origin = await createDevOrigin();
process.env.EFCC_NATIVE_DEV_AUTH_ORIGIN = origin;
const rawEvidenceRoot = process.env.EFCC_EVIDENCE_ROOT;
if (rawEvidenceRoot === "") {
  throw new Error("Native test evidence root must be non-empty.");
}
const evidence = path.join(
  path.resolve(rawEvidenceRoot ?? path.join(root, "test-results")),
  "native-dev"
);
// Workers inherit this value; reloading the config must not create another registry.
const privateRoot = path.resolve(
  process.env.EFCC_NATIVE_DEV_ROOT ??
    path.join(root, ".scratch", `native-dev-${randomUUID()}`)
);
const scratchRoot = path.join(root, ".scratch");
if (
  path.dirname(privateRoot) !== scratchRoot ||
  !/^native-dev-[0-9a-f-]{36}$/u.test(path.basename(privateRoot)) ||
  (existsSync(scratchRoot) && lstatSync(scratchRoot).isSymbolicLink()) ||
  (existsSync(privateRoot) &&
    (lstatSync(privateRoot).isSymbolicLink() ||
      process.env.TEST_WORKER_INDEX === undefined))
) {
  throw new Error("Native dev migrations require a fresh owned scratch root.");
}
const statePath = path.join(privateRoot, "state");
const registryPath = path.join(privateRoot, "registry");
process.env.EFCC_NATIVE_DEV_ROOT = privateRoot;
process.env.MINIFLARE_REGISTRY_PATH = registryPath;
process.env.WRANGLER_REGISTRY_PATH = registryPath;

const migrate = `pnpm exec wrangler d1 migrations apply DB --local --persist-to ${JSON.stringify(statePath)} --config ${JSON.stringify(path.join(root, "wrangler.jsonc"))}`;
const serve = `pnpm exec vite dev --mode native-test --host 127.0.0.1 --port ${new URL(origin).port} --strictPort`;

export default defineConfig({
  ...features,
  fullyParallel: false,
  grepInvert: [],
  metadata: { ...features.metadata, nativeDevOrigin: origin },
  outputDir: path.join(evidence, "artifacts"),
  projects: [
    {
      grep: /(?=.*@native)(?=.*@browser)(?=.*@dev)/u,
      name: "dev-chromium",
      use: { browserName: "chromium", viewport: { height: 1024, width: 1440 } },
    },
  ],
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidence, "results.json") }],
  ],
  webServer: {
    command: `node scripts/assert-native-dev-root.ts && ${migrate} && ${serve}`,
    cwd: root,
    env: {
      CI: "true",
      EFCC_NATIVE_DEV_AUTH_ORIGIN: origin,
      EFCC_NATIVE_DEV_ROOT: privateRoot,
      EFCC_NATIVE_DEV_STATE_PATH: statePath,
      MINIFLARE_REGISTRY_PATH: registryPath,
      WRANGLER_REGISTRY_PATH: registryPath,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: origin,
  },
  workers: 1,
});
