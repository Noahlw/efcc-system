import { existsSync } from "node:fs";
import path from "node:path";

import { assertNativeSource } from "../tests/support/native-source.ts";

const root = path.resolve(import.meta.dirname, "..");
assertNativeSource(root);
if (existsSync(path.join(root, ".wrangler/state"))) {
  throw new Error(
    "The temporary legacy suite requires an owned clean worktree without local Worker state. Preserve developer data; do not reset or remove it to run tests."
  );
}
