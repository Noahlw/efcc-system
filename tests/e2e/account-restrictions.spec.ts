import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator } from "@playwright/test";

import { apiTransportHeaders, E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";
import {
  createApprovedMember,
  createStaffActor,
  status,
  syntheticPerson,
  userIdOf,
} from "./staff-fixture";
import type { SyntheticPerson } from "./staff-fixture";

const person = () => syntheticPerson("restriction");
const restrictionTest = test.extend<{
  holder: SyntheticPerson;
  member: APIRequestContext;
  staff: APIRequestContext;
  staffAccount: SyntheticPerson;
  memberUserId: string;
  staffUserId: string;
}>({
  holder: async ({ baseURL }, use) => {
    expect(baseURL).toBe(E2E_BASE_URL);
    await use(person());
  },
  member: async ({ playwright, holder, staff }, use) => {
    const context = await createApprovedMember(playwright, holder, staff);
    await use(context);
    await context.dispose();
  },
  memberUserId: async ({ member, holder }, use) => {
    await member.get("/api/v2/me");
    await use(userIdOf(holder.username));
  },
  staff: async ({ playwright, staffAccount }, use) => {
    const actor = await createStaffActor(playwright, { account: staffAccount });
    await use(actor.context);
    await actor.context.dispose();
  },
  staffAccount: async ({ baseURL }, use) => {
    expect(baseURL).toBe(E2E_BASE_URL);
    await use(syntheticPerson("staff"));
  },
  staffUserId: async ({ staff, staffAccount }, use) => {
    await status(staff.get("/api/v2/me"), 200);
    await use(userIdOf(staffAccount.username));
  },
});
const command = (targetUserId: string, action: string) => ({
  action,
  operationKey: randomUUID(),
  targetUserId,
});
const beginRestrictionReview = async (region: Locator, action: string) => {
  await region.getByRole("button", { exact: true, name: action }).click();
  await expect(
    region.getByRole("heading", { exact: true, name: "核對限制操作" })
  ).toBeVisible();
  return region.getByRole("button", {
    exact: true,
    name: `確認並${action}`,
  });
};

restrictionTest(
  "definitive competing Staff conflict recovers after reload and permits a new restriction",
  async ({ browser, staff, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { origin: E2E_BASE_URL },
      storageState: await staff.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=restrictions`
      );
      const region = page.getByRole("region", { name: "會籍與安全限制" });
      await expect(
        region.getByRole("button", { exact: true, name: "停用會籍" })
      ).toBeEnabled();
      const confirmDeactivation = await beginRestrictionReview(
        region,
        "停用會籍"
      );
      await status(
        staff.post("/api/v2/staff/accounts/restrictions", {
          data: command(memberUserId, "membership_deactivated"),
        }),
        201
      );
      const pending = page.waitForResponse((response) =>
        response.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      await confirmDeactivation.click();
      const response = await pending;
      expect(response.status()).toBe(409);
      await expect(region.getByRole("status")).toContainText("未完成");
      const metadata = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
        )
      );
      expect(
        queryLocalSql(
          `SELECT id FROM account_change_operation WHERE operation_key='${metadata.key}'`
        )
      ).toHaveLength(0);
      await page.reload();
      await expect(region.getByRole("status")).toContainText("未完成");
      await region
        .getByRole("button", {
          exact: true,
          name: "操作未完成，開始另一項操作",
        })
        .click();
      await expect(
        region.getByRole("button", { exact: true, name: "重新啟用會籍" })
      ).toBeEnabled();
      const confirmReactivation = await beginRestrictionReview(
        region,
        "重新啟用會籍"
      );
      await confirmReactivation.click();
      await expect(region.getByRole("status")).toContainText("伺服器已確認");
      expect(
        queryLocalSql(
          `SELECT membership_status FROM person_profile WHERE user_id='${memberUserId}'`
        )
      ).toEqual([{ membership_status: "active" }]);
      expect(
        queryLocalSql(
          `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='membership_reactivated'`
        )
      ).toHaveLength(1);
    } finally {
      await context.close();
    }
  }
);

restrictionTest(
  "unknown restriction preserves its key until retry obtains an authoritative conflict",
  async ({ browser, staff, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { origin: E2E_BASE_URL },
      storageState: await staff.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=restrictions`
      );
      const region = page.getByRole("region", { name: "會籍與安全限制" });
      await expect(
        region.getByRole("button", { exact: true, name: "停用會籍" })
      ).toBeEnabled();
      await page.route("**/api/v2/staff/accounts/restrictions", (route) =>
        route.abort("failed")
      );
      const initialDeactivation = await beginRestrictionReview(
        region,
        "停用會籍"
      );
      await initialDeactivation.click();
      await expect(region.getByRole("status")).toContainText(
        "尚未找到完成紀錄"
      );
      const metadata = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
        )
      );
      expect(metadata.rejected).toBeUndefined();
      await expect(
        region.getByRole("button", {
          exact: true,
          name: "操作未完成，開始另一項操作",
        })
      ).toHaveCount(0);
      await status(
        staff.post("/api/v2/staff/accounts/restrictions", {
          data: command(memberUserId, "membership_deactivated"),
        }),
        201
      );
      await page.unrouteAll();
      await page.reload();
      await expect(region.getByRole("status")).toContainText(
        "尚未找到完成紀錄"
      );
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
          )
        )
      ).toEqual(metadata);
      await expect(
        region.getByRole("button", { exact: true, name: "停用會籍" })
      ).toBeEnabled();
      const retryDeactivation = await beginRestrictionReview(
        region,
        "停用會籍"
      );
      await retryDeactivation.click();
      await expect(region.getByRole("status")).toContainText("操作未完成");
      await region
        .getByRole("button", {
          exact: true,
          name: "操作未完成，開始另一項操作",
        })
        .click();
      await expect(
        region.getByRole("button", { exact: true, name: "重新啟用會籍" })
      ).toBeEnabled();
      expect(
        queryLocalSql(
          `SELECT id FROM account_change_operation WHERE operation_key='${metadata.key}'`
        )
      ).toHaveLength(0);
    } finally {
      await context.close();
    }
  }
);
restrictionTest(
  "ban and membership deactivation remain independent on the next real request",
  async ({ member, staff, memberUserId, holder }) => {
    const ban = command(memberUserId, "account_banned");
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", { data: ban }),
      201
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", { data: ban }),
      200
    );
    await status(member.get("/api/v2/me"), 403);
    await status(
      member.post("/api/auth/sign-in/name", {
        data: { fullName: holder.fullName, password: holder.password },
      }),
      200
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "membership_deactivated"),
      }),
      201
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "account_unbanned"),
      }),
      201
    );
    await status(member.get("/api/v2/me"), 403);
    expect(
      queryLocalSql(
        `SELECT membership_status,banned_at FROM person_profile WHERE user_id='${memberUserId}'`
      )
    ).toEqual([{ banned_at: null, membership_status: "deactivated" }]);
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "account_banned"),
      }),
      201
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "membership_reactivated"),
      }),
      201
    );
    await status(member.get("/api/v2/me"), 403);
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "account_unbanned"),
      }),
      201
    );
    await status(member.get("/api/v2/me"), 200);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action IN ('account_banned','account_unbanned','membership_deactivated','membership_reactivated')`
      )
    ).toHaveLength(6);
  }
);

for (const table of [
  "person_profile",
  "audit_event",
  "account_change_operation",
]) {
  for (const fault of ["ABORT", "IGNORE"]) {
    restrictionTest(
      `restriction ${table} ${fault} rolls back domain and retained audit effects`,
      async ({ staff, memberUserId }) => {
        const input = command(memberUserId, "account_banned");
        const trigger = `fault_restriction_${table}_${fault}`;
        const event = table === "person_profile" ? "UPDATE" : "INSERT";
        const condition =
          table === "person_profile"
            ? `NEW.user_id='${memberUserId}'`
            : `NEW.target_user_id='${memberUserId}' AND NEW.action='account_banned'`;
        runLocalSql(
          `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic restriction fault'" : ""}); END`
        );
        try {
          await status(
            staff.post("/api/v2/staff/accounts/restrictions", { data: input }),
            500
          );
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
        }
        expect(
          queryLocalSql(
            `SELECT membership_status,banned_at FROM person_profile WHERE user_id='${memberUserId}'`
          )
        ).toEqual([
          {
            banned_at: null,
            membership_status: "active",
          },
        ]);
        expect(
          queryLocalSql(
            `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_banned'`
          )
        ).toHaveLength(0);
        await status(
          staff.post("/api/v2/staff/accounts/restrictions", { data: input }),
          201
        );
      }
    );
  }
}

restrictionTest(
  "last-effective-Admin guards count durable eligibility without active login sessions and survive competing bans",
  async ({ playwright }) => {
    const a = person();
    const b = person();
    await seedSyntheticAccounts([
      { ...a, membershipStatus: "active" },
      { ...b, membershipStatus: "active" },
    ]);
    const rows = queryLocalSql<{ id: string; username: string }>(
      `SELECT id,username FROM user WHERE username IN ('${a.username}','${b.username}')`
    );
    const first = rows.find((row) => row.username === a.username);
    const second = rows.find((row) => row.username === b.username);
    if (!first || !second) {
      throw new Error("Synthetic administrators missing");
    }
    runLocalSql(
      `UPDATE person_profile SET account_role='admin' WHERE user_id IN ('${first.id}','${second.id}')`
    );
    runLocalSql(
      `UPDATE person_profile SET account_role='member' WHERE account_role='admin' AND user_id NOT IN ('${first.id}','${second.id}')`
    );
    expect(
      queryLocalSql(`SELECT id FROM session WHERE user_id='${second.id}'`)
    ).toHaveLength(0);
    runLocalSql(
      `UPDATE person_profile SET membership_status='deactivated' WHERE user_id='${first.id}'`
    );
    expect(() =>
      runLocalSql(
        `UPDATE person_profile SET banned_at=CAST(strftime('%s','now') AS INTEGER) WHERE user_id='${second.id}'`
      )
    ).toThrow();
    expect(() =>
      runLocalSql(
        `UPDATE person_profile SET account_role='member' WHERE user_id='${second.id}'`
      )
    ).toThrow();
    expect(() =>
      runLocalSql(`DELETE FROM user WHERE id='${second.id}'`)
    ).toThrow();
    runLocalSql(
      `UPDATE person_profile SET membership_status='active' WHERE user_id='${first.id}'`
    );
    const one = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        ...apiTransportHeaders,
        "cf-connecting-ip": `198.28.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    const two = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        ...apiTransportHeaders,
        "cf-connecting-ip": `198.29.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(
      one.post("/api/auth/sign-in/username", {
        data: { password: a.password, username: a.username },
      }),
      200
    );
    await status(
      two.post("/api/auth/sign-in/username", {
        data: { password: b.password, username: b.username },
      }),
      200
    );
    await status(
      one.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: a.password },
      }),
      201
    );
    await status(
      two.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: b.password },
      }),
      201
    );
    const results = await Promise.all([
      one.post("/api/v2/staff/accounts/restrictions", {
        data: command(second.id, "account_banned"),
      }),
      two.post("/api/v2/staff/accounts/restrictions", {
        data: command(first.id, "account_banned"),
      }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      201, 403,
    ]);
    expect(
      queryLocalSql(
        `SELECT count(*) AS count FROM person_profile WHERE account_role='admin' AND membership_status='active' AND banned_at IS NULL`
      )
    ).toEqual([{ count: 1 }]);
    await one.dispose();
    await two.dispose();
  }
);

restrictionTest(
  "fixed Staff targets and stale sensitive confirmation cannot be bypassed",
  async ({ staff, memberUserId }) => {
    const own = await status(staff.get("/api/v2/account/identity"), 200);
    const body = await own.json();
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(body.data.identity.actorUserId, "account_banned"),
      }),
      403
    );
    const peer = person();
    await seedSyntheticAccounts([{ ...peer, membershipStatus: "active" }]);
    const [row] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${peer.username}'`
    );
    if (!row) {
      throw new Error("Synthetic peer missing");
    }
    runLocalSql(
      `UPDATE person_profile SET account_role='admin' WHERE user_id='${row.id}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(row.id, "account_banned"),
      }),
      403
    );
    runLocalSql(
      `UPDATE session SET password_confirmed_at=CAST(strftime('%s','now') AS INTEGER)-601 WHERE user_id='${body.data.identity.actorUserId}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "account_banned"),
      }),
      403
    );
  }
);

restrictionTest(
  "temporary password change never removes a current ban or deactivation",
  async ({ member, holder, staff, memberUserId }) => {
    const reset = await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: memberUserId,
        },
      }),
      201
    );
    const body = await reset.json();
    await status(member.get("/api/v2/me"), 401);
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "account_banned"),
      }),
      201
    );
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "membership_deactivated"),
      }),
      201
    );
    await status(
      member.post("/api/auth/sign-in/username", {
        data: {
          password: body.data.temporaryPassword,
          username: holder.username,
        },
      }),
      200
    );
    await status(member.get("/api/v2/me"), 403);
    await status(
      member.post("/api/v2/account/password", {
        data: {
          currentPassword: body.data.temporaryPassword,
          newPassword: "Synthetic-restriction-permanent!",
          operationKey: randomUUID(),
        },
      }),
      201
    );
    const current = await status(member.get("/api/v2/status"), 200);
    const currentBody = await current.json();
    expect(currentBody.data.reasons).toEqual([
      "membership_deactivated",
      "security_ban",
    ]);
    await status(member.get("/api/v2/me"), 403);
  }
);

restrictionTest(
  "actual management and status pages recover a committed ban after reload",
  async ({ browser, staff, member, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.30.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      hasTouch: true,
      isMobile: true,
      storageState: await staff.storageState(),
      viewport: { height: 915, width: 412 },
    });
    const page = await context.newPage();
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=restrictions`
    );
    const region = page.getByRole("region", { name: "會籍與安全限制" });
    await page.route("**/api/v2/staff/accounts/restrictions", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/account/changes/reconcile", (route) =>
      route.abort("failed")
    );
    const confirmBan = await beginRestrictionReview(region, "封鎖帳戶");
    await confirmBan.click();
    await expect(region.getByRole("status")).toContainText("結果仍未確認");
    const metadata = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
      )
    );
    expect(Object.keys(metadata).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
      "targetUserId",
    ]);
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_banned'`
      )
    ).toHaveLength(1);
    const holderContext = await browser.newContext({
      storageState: await member.storageState(),
    });
    const holderPage = await holderContext.newPage();
    await holderPage.goto(`${E2E_BASE_URL}/status`);
    await expect(
      holderPage.getByRole("heading", { exact: true, name: "帳戶已暫停使用" })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
    await holderContext.close();
    await context.close();
  }
);

restrictionTest(
  "actual restriction review returns after password confirmation and preserves the opposite state",
  async ({ browser, memberUserId, staff, staffUserId }) => {
    runLocalSql(
      `UPDATE session SET password_confirmed_at=0 WHERE user_id='${staffUserId}'`
    );
    const context = await browser.newContext({
      extraHTTPHeaders: { origin: E2E_BASE_URL },
      storageState: await staff.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=restrictions`
      );
      const region = page.getByRole("region", { name: "會籍與安全限制" });
      let restrictionRequests = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().endsWith("/api/v2/staff/accounts/restrictions")
        ) {
          restrictionRequests += 1;
        }
      });
      await region
        .getByRole("button", { exact: true, name: "封鎖帳戶" })
        .click();
      await expect(
        region.getByRole("heading", { exact: true, name: "核對限制操作" })
      ).toBeVisible();
      expect(restrictionRequests).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.restriction.operation.v1")
        )
      ).toBeNull();
      await page.getByRole("link", { name: /返回帳戶詳情/u }).click();
      const leaveDialog = page.getByRole("dialog");
      await expect(leaveDialog).toBeVisible();
      await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
      await expect(
        region.getByRole("heading", { exact: true, name: "核對限制操作" })
      ).toBeVisible();
      await region
        .getByRole("button", {
          exact: true,
          name: "確認並封鎖帳戶",
        })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { exact: true, name: "確認目前密碼" })
      ).toBeVisible();
      await dialog
        .getByLabel("目前密碼", { exact: true })
        .fill("Synthetic-identity-password!");
      await dialog
        .getByRole("button", { exact: true, name: "確認並返回檢查" })
        .click();
      await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
      await dialog
        .getByRole("button", { exact: true, name: "確認並返回檢查" })
        .click();
      await expect(
        region.getByRole("heading", { exact: true, name: "核對限制操作" })
      ).toBeVisible();
      expect(restrictionRequests).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.account-security.operation.v1")
        )
      ).toBeNull();
      await region
        .getByRole("button", {
          exact: true,
          name: "確認並封鎖帳戶",
        })
        .click();
      await expect(region.getByRole("status")).toContainText("伺服器已確認");
      expect(restrictionRequests).toBe(1);
      expect(
        queryLocalSql<{ membership_status: string }>(
          `SELECT membership_status FROM person_profile WHERE user_id='${memberUserId}'`
        )
      ).toEqual([{ membership_status: "active" }]);
      expect(
        queryLocalSql(
          `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_banned'`
        )
      ).toHaveLength(1);
    } finally {
      await context.close();
    }
  }
);

restrictionTest(
  "records local per-request freshness latency without claiming production capacity or missing D1 counters",
  async ({ member, staff }, testInfo) => {
    const routes = [
      { actor: member, path: "/api/v2/me" },
      { actor: member, path: "/api/v2/status" },
      { actor: staff, path: "/api/v2/staff/accounts" },
    ];
    const measurements = [];
    for (const route of routes) {
      const times = [];
      for (let index = 0; index < 20; index += 1) {
        const started = performance.now();
        // Sequential requests measure individual latency, not concurrent load.
        // eslint-disable-next-line no-await-in-loop
        const response = await route.actor.get(route.path);
        expect(response.status()).toBe(200);
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      measurements.push({
        p50Ms: times[9],
        p95Ms: times[18],
        path: route.path,
        samples: times.length,
      });
    }
    const evidence = {
      cookieOrPermissionCache: "No new cache",
      d1RowsReadWrite: "Unavailable at the HTTP harness; not claimed",
      environment:
        "localhost Worker / disposable local D1 / synthetic fixtures",
      measurements,
      production200DauCapacity: "Unverified",
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      testInfo.outputPath("freshness-latency.json"),
      JSON.stringify(evidence, null, 2)
    );
  }
);

restrictionTest(
  "concurrent matching restriction retries have one receipt and no cross-actor disclosure",
  async ({ staff, member, memberUserId }) => {
    const input = command(memberUserId, "account_banned");
    const results = await Promise.all([
      staff.post("/api/v2/staff/accounts/restrictions", { data: input }),
      staff.post("/api/v2/staff/accounts/restrictions", { data: input }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_banned'`
      )
    ).toHaveLength(1);
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: { ...input, action: "account_unbanned" },
      }),
      409
    );
    const lookup = await status(
      member.post("/api/v2/account/changes/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    const body = await lookup.json();
    expect(body.data.receipt).toBeNull();
  }
);

restrictionTest(
  "restriction origin and database limits preserve private current-state reads",
  async ({ staff, memberUserId }) => {
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: command(memberUserId, "account_banned"),
        headers: { origin: "https://foreign.example" },
      }),
      403
    );
    for (let index = 0; index < 10; index += 1) {
      // Request order establishes the exact database limiter boundary.
      // eslint-disable-next-line no-await-in-loop
      await status(
        staff.post("/api/v2/staff/accounts/restrictions", {
          data: { operationKey: randomUUID() },
        }),
        400
      );
    }
    await status(
      staff.post("/api/v2/staff/accounts/restrictions", {
        data: { operationKey: randomUUID() },
      }),
      429
    );
    const read = await status(staff.get("/api/v2/staff/accounts"), 200);
    expect(read.headers()["cache-control"]).toContain("no-store");
  }
);
