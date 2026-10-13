import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

import { createBuilder, loadConfigFromFile, mergeConfig } from "vite";

import { assertNativeSource } from "../tests/support/native-source.ts";

const root = path.resolve(import.meta.dirname, "..");
assertNativeSource(root);
const loaded = await loadConfigFromFile(
  { command: "build", mode: "native-test" },
  path.join(root, "vite.config.ts")
);
if (!loaded) {
  throw new Error("Missing production Vite configuration");
}
const construction = path.join(
  root,
  "src/server/auth/password-verification.ts"
);
const builder = await createBuilder(
  mergeConfig(loaded.config, {
    configFile: false,
    mode: "native-test",
    plugins: [
      {
        enforce: "pre",
        load(id: string) {
          if (id !== construction) {
            return;
          }
          return `import { verifyPassword } from "better-auth/crypto";
export const passwordVerification = { verify: async (input) => {
  const valid = await verifyPassword(input);
  if (valid) await globalThis[Symbol.for("efcc.test.verified-password")]();
  return valid;
}};`;
        },
        name: "trusted-native-password-verifier",
      },
    ],
  })
);
await builder.buildApp();
const directory = path.join(root, "dist/server");
const emitted = JSON.parse(
  await readFile(path.join(directory, "wrangler.json"), "utf-8")
);
if (emitted.main !== "index.js" || !emitted.no_bundle) {
  throw new Error(
    "Credential composition requires actual unbundled vinext index.js"
  );
}
await writeFile(
  path.join(directory, "credential-race.js"),
  stripTypeScriptTypes(
    await readFile(path.join(root, "tests/worker/credential-race.ts"), "utf-8")
  )
);
await writeFile(
  path.join(directory, "credential-race.json"),
  JSON.stringify({ ...emitted, main: "credential-race.js" })
);
