import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import { assertNativeSource } from "../tests/support/native-source.ts";

const root = path.resolve(import.meta.dirname, "..");
assertNativeSource(root);
const scratch = path.join(root, ".scratch");
const privateRoot = process.env.EFCC_NATIVE_DEV_ROOT;
if (
  !privateRoot ||
  path.dirname(path.resolve(privateRoot)) !== scratch ||
  !/^native-dev-[0-9a-f-]{36}$/u.test(path.basename(privateRoot))
) {
  throw new Error("Native dev migrations require an owned scratch root.");
}
await mkdir(scratch, { recursive: true });
const scratchInfo = await lstat(scratch);
if (scratchInfo.isSymbolicLink()) {
  throw new Error("Native dev scratch must not be a symbolic link.");
}
// Atomic acquisition rejects stale roots before Wrangler can open any D1 store.
await mkdir(privateRoot);
