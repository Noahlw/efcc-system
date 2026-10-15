import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";

import { assertNativeSource } from "../tests/support/native-source.ts";

const root = path.resolve(import.meta.dirname, "..");
assertNativeSource(root);
const directory = path.join(root, "dist/server");
const emitted = JSON.parse(
  await readFile(path.join(directory, "wrangler.json"), "utf-8")
);
if (emitted.main !== "index.js" || !emitted.no_bundle) {
  throw new Error(
    "Causal composition requires the actual unbundled vinext index.js artifact"
  );
}
const source = await readFile(
  path.join(root, "tests/worker/clock-matrix.ts"),
  "utf-8"
);
await writeFile(
  path.join(directory, "clock-matrix.js"),
  stripTypeScriptTypes(source)
);
// Preserve all emitted assets, module rules, original migrations and binding identity.
await writeFile(
  path.join(directory, "causal.json"),
  JSON.stringify({ ...emitted, main: "clock-matrix.js" })
);
