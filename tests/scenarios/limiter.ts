import { execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Reads the database-backed limiter state directly from local D1 so tests can
 * pace real HTTP attempts against the shared-IP sign-in bucket.
 */
const projectRoot = path.resolve(import.meta.dirname, "../..");

export const SIGN_IN_WINDOW_MS = 10_000;

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

/** Waits until the shared-IP sign-in bucket has a free slot again. */
export const waitForSignInWindow = async (): Promise<void> => {
  const newest = Math.max(
    0,
    ...readRateLimitRows()
      .filter((row) => row.key.endsWith("|/sign-in/username"))
      .map((row) => row.last_request)
  );
  const waitMs = newest + SIGN_IN_WINDOW_MS + 300 - Date.now();
  if (waitMs > 0) {
    await delay(waitMs);
  }
};
