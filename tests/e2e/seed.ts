import { execFileSync } from "node:child_process";
import path from "node:path";

import type { SyntheticAccount } from "../scenarios/accounts";
import { allAccounts } from "../scenarios/accounts";
import type { ActivityFixtures } from "../scenarios/activities";
import { E2E_BASE_URL, ensureLocalEnv } from "../scenarios/local-env";
import type { NoticeFixtures } from "../scenarios/notices";

const projectRoot = path.resolve(import.meta.dirname, "../..");

export interface SeedPayload {
  accounts?: SyntheticAccount[];
  departments?: ActivityFixtures["departments"];
  programs?: ActivityFixtures["programs"];
  events?: ActivityFixtures["events"];
  enrolments?: ActivityFixtures["enrolments"];
  invitations?: ActivityFixtures["invitations"];
  notices?: NoticeFixtures["notices"];
  departmentMemberships?: NoticeFixtures["departmentMemberships"];
  departmentManagerAssignments?: NoticeFixtures["departmentManagerAssignments"];
  /** Clears harness-owned activity rows before inserting, for repeatable runs. */
  resetActivities?: boolean;
}

/**
 * Sends a fixture payload to the trusted local setup API. Idempotent: reruns
 * converge existing rows, so a modified payload is also how tests apply
 * fixture state transitions.
 */
export const postSeed = async (payload: SeedPayload): Promise<void> => {
  const { SEED_TOKEN } = ensureLocalEnv();
  const response = await fetch(`${E2E_BASE_URL}/api/internal/test-setup`, {
    body: JSON.stringify(payload),
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

export const seedSyntheticAccounts = (
  accounts: SyntheticAccount[] = allAccounts
): Promise<void> => postSeed({ accounts });

export const seedActivities = (
  fixtures: Partial<ActivityFixtures>
): Promise<void> => postSeed(fixtures);

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

/** Reads rows straight from local D1 for fixture assertions. */
export const queryLocalSql = <Row>(sql: string): Row[] => {
  const wrangler = path.join(projectRoot, "node_modules/.bin/wrangler");
  const output = execFileSync(
    wrangler,
    ["d1", "execute", "DB", "--local", "--json", "--command", sql],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "ignore"],
    }
  );
  const parsed = JSON.parse(output.slice(output.indexOf("["))) as {
    results: Row[];
  }[];
  return parsed.flatMap((entry) => entry.results);
};

/** Revokes every stored session for an account without touching credentials. */
export const revokeSessionsFor = (username: string): void => {
  runLocalSql(
    `delete from session where user_id in (select id from user where username = '${username.toLowerCase()}')`
  );
};
