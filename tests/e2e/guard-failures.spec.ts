import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import type { SyntheticAccount } from "../scenarios/accounts";
import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { buildActivityFixtures } from "../scenarios/activities";
import { waitForSignInWindow } from "../scenarios/limiter";
import { buildNoticeFixtures } from "../scenarios/notices";
import {
  postSeed,
  queryLocalSql,
  runLocalSql,
  seedSyntheticAccounts,
} from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");

const projectRoot = path.resolve(import.meta.dirname, "../..");

/** Caller-supplied addresses that must never partition the limiter buckets. */
const spoofedAddresses = [
  "203.0.113.10",
  "203.0.113.20",
  "203.0.113.30",
  "203.0.113.40",
];

/**
 * Runs local D1 SQL that is expected to fail and returns its diagnostic
 * output, so the failure reason is asserted instead of only the crash.
 */
const attemptLocalSql = (sql: string): string => {
  const wrangler = path.join(projectRoot, "node_modules/.bin/wrangler");
  try {
    execFileSync(
      wrangler,
      ["d1", "execute", "DB", "--local", "--command", sql],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return "";
  } catch (error) {
    const failure = error as {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    return `${String(failure.stdout ?? "")}${String(failure.stderr ?? "")}`;
  }
};

const userIdFor = (username: string): string => {
  const [row] = queryLocalSql<{ id: string }>(
    `select id from user where username = '${username.toLowerCase()}'`
  );
  if (!row) {
    throw new Error(`Synthetic account ${username} is not seeded`);
  }
  return row.id;
};

const signInAs = async (
  request: APIRequestContext,
  account: SyntheticAccount
): Promise<void> => {
  await waitForSignInWindow();
  const response = await request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
};

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

test("Home domain writes reject invalid states and notice targets", async () => {
  await postSeed({
    resetActivities: true,
    ...buildActivityFixtures(),
    ...buildNoticeFixtures(),
  });
  const invalidWrites = [
    {
      check: "enrolment_status_check",
      sql: "update enrolment set status = 'unknown' where id = 'enr-sunday-wong'",
    },
    {
      check: "invitation_state_check",
      sql: "update invitation set state = 'unknown' where id = 'inv-care-chan'",
    },
    {
      check: "notice_scope_type_check",
      sql: "update notice set scope_type = 'unknown' where id = 'notice-church-welcome'",
    },
    {
      check: "notice_scope_target_check",
      sql: "update notice set scope_id = 'wrong-target' where id = 'notice-church-welcome'",
    },
    {
      check: "notice_scope_target_check",
      sql: "update notice set scope_id = NULL where id = 'notice-worship-department'",
    },
    {
      check: "notice_scope_target_check",
      sql: "update notice set scope_id = '' where id = 'notice-sunday-program'",
    },
  ];
  for (const invalid of invalidWrites) {
    expect(attemptLocalSql(invalid.sql)).toContain(invalid.check);
  }
});

test("normal D1 writes reject unsupported membership values", () => {
  const userId = userIdFor(wong.username);

  const rejection = attemptLocalSql(
    `update person_profile set membership_status = 'member' where user_id = '${userId}'`
  );
  expect(rejection).toMatch(
    /CHECK constraint failed: person_profile_membership_status_check/u
  );

  const [row] = queryLocalSql<{ membership_status: string }>(
    `select membership_status from person_profile where user_id = '${userId}'`
  );
  expect(row?.membership_status).toBe("active");
});

test("unsupported membership fails closed until corrected", async ({
  request,
}) => {
  const userId = userIdFor(wong.username);
  await signInAs(request, wong);

  // Disposable local fixture: bypass the CHECK on this connection to inject
  // unsupported persisted input, not to represent an existing production row.
  runLocalSql(
    `PRAGMA ignore_check_constraints = ON; update person_profile set membership_status = 'legacy_unknown' where user_id = '${userId}'`
  );
  try {
    // The first Home request after the unsupported value is stored is denied.
    const home = await request.get("/", { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers().location).toBe("/status");

    const business = await request.get("/api/v2/me");
    expect(business.status()).toBe(403);
    expect(await business.json()).toEqual({
      error: {
        code: "business_access_denied",
        message: "你的帳戶目前無法使用教會功能。",
      },
    });

    // The unknown status reads as an unconfirmed membership, never as full.
    const status = await request.get("/api/v2/status");
    expect(await status.json()).toEqual({
      data: {
        accessAllowed: false,
        displayName: wong.fullName,
        reasons: ["profile_missing"],
      },
    });

    // Combined unknown membership/ban follows the same shared display order.
    runLocalSql(
      `PRAGMA ignore_check_constraints = ON; update person_profile set banned_at = unixepoch() where user_id = '${userId}'`
    );
    const combinedStatus = await request.get("/api/v2/status");
    const combinedBody = await combinedStatus.json();
    expect(combinedBody.data.reasons).toEqual([
      "security_ban",
      "profile_missing",
    ]);
  } finally {
    runLocalSql(
      `update person_profile set membership_status = 'active', banned_at = NULL where user_id = '${userId}'`
    );
  }

  // The corrected value restores the authorized result on the next request.
  const recovered = await request.get("/api/v2/me");
  expect(recovered.status()).toBe(200);
  expect(await recovered.json()).toEqual({
    data: {
      displayName: wong.fullName,
      membershipStatus: "active",
      username: wong.username,
    },
  });
});

test("an access-guard D1 fault yields a typed API error and the retry page", async ({
  page,
}) => {
  await waitForSignInWindow();
  const signIn = await page.request.post("/api/auth/sign-in/username", {
    data: { password: wong.password, username: wong.username },
  });
  expect(signIn.status()).toBe(200);

  // Guard D1 fault: session reads fail while the table is renamed, restored
  // in finally so later runs keep the schema.
  runLocalSql("alter table session rename to session_guard_fault");
  try {
    const api = await page.request.get("/api/v2/status");
    expect(api.status()).toBe(500);
    expect(api.headers()["cache-control"]).toBe("private, no-store");
    expect(api.headers().location).toBeUndefined();
    expect(await api.json()).toEqual({
      error: {
        code: "internal_error",
        message: "系統暫時無法完成請求，請稍後再試。",
      },
    });

    const home = await page.request.get("/", { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers().location).toMatch(/\/unavailable\?returnTo=%2F$/u);
    expect(home.headers()["cache-control"]).toBe("private, no-store");

    const statusPage = await page.request.get("/status", { maxRedirects: 0 });
    expect(statusPage.status()).toBe(307);
    expect(statusPage.headers().location).toMatch(
      /\/unavailable\?returnTo=%2Fstatus$/u
    );

    // The browser sees the generic page, never a signed-out or error surface.
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/unavailable");
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/");
    await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
    await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toHaveCount(0);
    await expect(page.getByText(wong.username, { exact: true })).toHaveCount(0);
  } finally {
    runLocalSql("alter table session_guard_fault rename to session");
  }

  // Retry makes a fresh authoritative request and reaches the authorized Home.
  await page.setViewportSize({ height: 740, width: 320 });
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await expect(page.getByText(wong.fullName, { exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "主要導覽" });
  await expect(navigation.getByRole("link", { name: "主頁" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "帳戶" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "管理" })).toHaveCount(0);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const mobileWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );
  expect(mobileWidth).toBeLessThanOrEqual(320);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "100%";
  });
  await page.setViewportSize({ height: 900, width: 1440 });
  const desktopSidebar = await navigation.boundingBox();
  expect(desktopSidebar?.x).toBe(0);
  expect(desktopSidebar?.width).toBe(256);
  expect(desktopSidebar?.height).toBe(900);
});

/**
 * Floods one sign-in entry with a different caller-controlled
 * X-Forwarded-For on every attempt while keeping the same actual local
 * transport address. A fourth attempt must still hit the shared bucket, and
 * recovery after the window must stay possible.
 */
const expectRotatingForwardedForCannotEvade = async (
  request: APIRequestContext,
  signInPath: "/sign-in/name" | "/sign-in/username",
  password: string,
  attempt: (
    api: APIRequestContext,
    forwardedFor: string,
    attemptPassword: string
  ) => Promise<APIResponse>
): Promise<void> => {
  await waitForSignInWindow(signInPath);

  const attempts = await Promise.all(
    spoofedAddresses
      .slice(0, 3)
      .map((address) => attempt(request, address, "wrong-password"))
  );
  for (const response of attempts) {
    expect(response.status()).toBe(401);
  }
  const refused = await attempt(
    request,
    spoofedAddresses[3] ?? "",
    "wrong-password"
  );
  expect(refused.status()).toBe(429);
  expect(refused.headers()["x-retry-after"]).toBeDefined();

  await waitForSignInWindow(signInPath);
  const recovered = await attempt(request, spoofedAddresses[3] ?? "", password);
  expect(recovered.status()).toBe(200);
};

test("rotating x-forwarded-for cannot evade the username limiter", async ({
  request,
}) => {
  await expectRotatingForwardedForCannotEvade(
    request,
    "/sign-in/username",
    wong.password,
    (api, forwardedFor, attemptPassword) =>
      api.post("/api/auth/sign-in/username", {
        data: { password: attemptPassword, username: wong.username },
        headers: { "x-forwarded-for": forwardedFor },
      })
  );
});

test("rotating x-forwarded-for cannot evade the name limiter", async ({
  request,
}) => {
  await expectRotatingForwardedForCannotEvade(
    request,
    "/sign-in/name",
    chan.password,
    (api, forwardedFor, attemptPassword) =>
      api.post("/api/auth/sign-in/name", {
        data: { fullName: chan.fullName, password: attemptPassword },
        headers: { "x-forwarded-for": forwardedFor },
      })
  );
});
