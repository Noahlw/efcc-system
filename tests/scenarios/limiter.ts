import { execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Reads the database-backed limiter state directly from local D1 so tests can
 * pace real HTTP attempts against the shared-IP sign-in buckets.
 */
const projectRoot = path.resolve(import.meta.dirname, "../..");

export const SIGN_IN_WINDOW_MS = 10_000;

export type SignInPath = "/sign-in/name" | "/sign-in/username";

interface RateLimitRow {
  key: string;
  count: number;
  last_request: number;
}

export const readRateLimitRows = (): RateLimitRow[] => {
  const wrangler = path.join(projectRoot, "node_modules/.bin/wrangler");
  const output = execFileSync(
    wrangler,
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--json",
      "--command",
      "select key, count, last_request from rate_limit",
    ],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "ignore"],
    }
  );
  const parsed = JSON.parse(output.slice(output.indexOf("["))) as {
    results: RateLimitRow[];
  }[];
  return parsed.flatMap((entry) => entry.results);
};

/** Waits until the shared-IP bucket for a sign-in entry has a free slot. */
export const waitForSignInWindow = async (
  signInPath: SignInPath = "/sign-in/username"
): Promise<void> => {
  const newest = Math.max(
    0,
    ...readRateLimitRows()
      .filter((row) => row.key.endsWith(`|${signInPath}`))
      .map((row) => row.last_request)
  );
  const waitMs = newest + SIGN_IN_WINDOW_MS + 350 - Date.now();
  if (waitMs > 0) {
    await delay(waitMs);
  }
};
