import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

import { createBuilder, loadConfigFromFile, mergeConfig } from "vite";

import { assertNativeSource } from "../tests/support/native-source.ts";

const root = path.resolve(import.meta.dirname, "..");
assertNativeSource(root);
const scratch = path.join(root, ".scratch");
await mkdir(scratch, { recursive: true });
const buildRoot = await mkdtemp(path.join(scratch, "credential-build-"));
const output = path.join(root, "dist/credential-app");
try {
  // vinext writes identity/manifests to root/dist even with custom outDirs.
  // Isolate its real project root; source/config/dependencies remain the actual inputs.
  await Promise.all(
    [
      "src",
      "public",
      "migrations",
      "node_modules",
      "package.json",
      "pnpm-lock.yaml",
      ".gitignore",
      "tsconfig.json",
      "wrangler.jsonc",
    ].map((input) =>
      symlink(path.join(root, input), path.join(buildRoot, input))
    )
  );
  assertNativeSource(buildRoot);
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
      envDir: false,
      mode: "native-test",
      plugins: [
        {
          enforce: "pre",
          async load(id: string) {
            const stylesheet = "src/app/globals.css";
            if (
              id === path.join(root, stylesheet) ||
              id === path.join(buildRoot, stylesheet)
            ) {
              // Keep Tailwind's actual source discovery root, not ephemeral linked dependencies.
              const css = await readFile(path.join(root, stylesheet), "utf-8");
              return css.replace(
                '@import "tailwindcss";',
                `@import "tailwindcss" source("${root}");`
              );
            }
            if (
              id !== construction &&
              id !==
                path.join(buildRoot, "src/server/auth/password-verification.ts")
            ) {
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
      root: buildRoot,
    })
  );
  await builder.buildApp();
  // Move the complete native artifact graph, including identities and private manifests.
  await rm(output, { force: true, recursive: true });
  await rename(path.join(buildRoot, "dist"), output);
  const directory = path.join(output, "server");
  const emitted = JSON.parse(
    await readFile(path.join(directory, "wrangler.json"), "utf-8")
  );
  if (emitted.main !== "index.js" || !emitted.no_bundle) {
    throw new Error(
      "Credential composition requires actual unbundled vinext index.js"
    );
  }
  // Relocate native source/migration pointers, never runtime code or binding identity.
  emitted.configPath = path.join(root, "wrangler.jsonc");
  emitted.userConfigPath = emitted.configPath;
  for (const binding of emitted.d1_databases) {
    binding.migrations_dir = path.relative(
      directory,
      path.join(root, "migrations")
    );
  }
  await writeFile(
    path.join(directory, "wrangler.json"),
    JSON.stringify(emitted)
  );
  await writeFile(
    path.join(directory, "credential-race.js"),
    stripTypeScriptTypes(
      await readFile(
        path.join(root, "tests/worker/credential-race.ts"),
        "utf-8"
      )
    )
  );
  await writeFile(
    path.join(directory, "credential-race.json"),
    JSON.stringify({ ...emitted, main: "credential-race.js" })
  );
} finally {
  await rm(buildRoot, { force: true, recursive: true });
}
