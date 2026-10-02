import { execFileSync } from "node:child_process";
import path from "node:path";

import type { SyntheticAccount } from "../scenarios/accounts";
import { allAccounts } from "../scenarios/accounts";
import { E2E_BASE_URL, ensureLocalEnv } from "../scenarios/local-env";

const projectRoot = path.resolve(import.meta.dirname, "../..");

/**
 * Creates the disposable synthetic accounts through the trusted setup API.
 * Idempotent: reruns converge the existing rows, so passing a modified account
 * list is also how tests apply fixture state transitions.
 */
export const seedSyntheticAccounts = async (
  accounts: SyntheticAccount[] = allAccounts
): Promise<void> => {
  const { SEED_TOKEN } = ensureLocalEnv();
  const response = await fetch(`${E2E_BASE_URL}/api/internal/test-setup`, {
    body: JSON.stringify({ accounts }),
    headers: {
      "content-type": "application/json",
      "x-seed-token": SEED_TOKEN ?? "",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Synthetic setup failed: ${response.status} ${await response.text()}`
    );
  }
};

/** Direct local-D1 fixture edits for states the setup API does not own. */
export const runLocalSql = (sql: string): void => {
  const wrangler = path.join(projectRoot, "node_modules/.bin/wrangler");
  execFileSync(wrangler, ["d1", "execute", "DB", "--local", "--command", sql], {
    cwd: projectRoot,
    encoding: "utf-8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "ignore", "ignore"],
  });
};

/** Revokes every stored session for an account without touching credentials. */
export const revokeSessionsFor = (username: string): void => {
  runLocalSql(
    `delete from session where user_id in (select id from user where username = '${username.toLowerCase()}')`
  );
};
