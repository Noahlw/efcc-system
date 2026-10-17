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
import { normalizeBuildConfig } from "./portable-build.ts";

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
  const accountSecurity = path.join(
    root,
    "src/features/account/security/security.ts"
  );
  const accountSecurityBuild = path.join(
    buildRoot,
    "src/features/account/security/security.ts"
  );
  let accountSecurityProofGateInstalled = false;
  const builder = await createBuilder(
    mergeConfig(loaded.config, {
      configFile: false,
      envDir: false,
      mode: "native-test",
      plugins: [
        {
          enforce: "pre",
          load(id: string) {
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
          transform(code: string, id: string) {
            const source = path.resolve(id.split("?")[0] ?? id);
            if (source !== accountSecurity && source !== accountSecurityBuild) {
              return;
            }
            const operation =
              "export const createAccountSecurityOperation = async";
            const operationStart = code.indexOf(operation);
            const actorProof =
              "  const actor = await getCredentialActor(headers);";
            const actorProofStart = code.indexOf(actorProof, operationStart);
            if (operationStart === -1 || actorProofStart === -1) {
              throw new Error(
                "Account security actor-proof seam was not found"
              );
            }
            accountSecurityProofGateInstalled = true;
            return `${code.slice(0, actorProofStart)}${actorProof}
  await globalThis[Symbol.for("efcc.test.account-security-proof")]?.();${code.slice(
    actorProofStart + actorProof.length
  )}`;
          },
        },
      ],
      root: buildRoot,
    })
  );
  await builder.buildApp();
  if (!accountSecurityProofGateInstalled) {
    throw new Error("Account security actor-proof test seam was not installed");
  }
  // Move the complete native artifact graph, including identities and private manifests.
  await rm(output, { force: true, recursive: true });
  await rename(path.join(buildRoot, "dist"), output);
  const directory = path.join(output, "server");
  const configPath = path.join(directory, "wrangler.json");
  const emitted = JSON.parse(await readFile(configPath, "utf-8"));
  if (emitted.main !== "index.js" || !emitted.no_bundle) {
    throw new Error(
      "Credential composition requires actual unbundled vinext index.js"
    );
  }
  // Rebase only the original migrations directory; keep the D1 identity.
  for (const binding of emitted.d1_databases) {
    binding.migrations_dir = path.relative(
      directory,
      path.join(root, "migrations")
    );
  }
  await writeFile(configPath, JSON.stringify(emitted));
  await normalizeBuildConfig(configPath, root);
  const portable = JSON.parse(await readFile(configPath, "utf-8"));
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
    JSON.stringify({ ...portable, main: "credential-race.js" })
  );
} finally {
  await rm(buildRoot, { force: true, recursive: true });
}
