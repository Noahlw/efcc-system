import { readdirSync } from "node:fs";
import path from "node:path";

/** Refuse local variable files before Vite or Wrangler can read their contents. */
export const assertNativeSource = (root: string): void => {
  for (const directory of [
    root,
    path.join(root, "tests/worker"),
    path.join(root, "dist/server"),
  ]) {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (
      entries.some(
        (name) =>
          /^(?:\.dev\.vars|\.env)(?:\..+)?$/u.test(name) &&
          !name.endsWith(".example")
      )
    ) {
      throw new Error(
        "Native tests require a tracked-only workspace without local variable files; preserve developer files and use an owned clean worktree."
      );
    }
  }
};
