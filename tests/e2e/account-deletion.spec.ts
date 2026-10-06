import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";
import {
  createApprovedMember,
  createStaffActor,
  status,
  syntheticPerson,
  userIdOf,
} from "./staff-fixture";
import type { SyntheticPerson } from "./staff-fixture";

const person = () => syntheticPerson("deletion");
const deletionTest = test.extend<{
  holder: SyntheticPerson;
  member: APIRequestContext;
  staff: APIRequestContext;
  memberUserId: string;
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
  staff: async ({ playwright }, use) => {
    const actor = await createStaffActor(playwright);
    await use(actor.context);
    await actor.context.dispose();
  },
});
const command = (targetUserId: string) => ({
  operationKey: randomUUID(),
  targetUserId,
});
deletionTest(
  "eligible deletion removes native credentials and sessions but retains approval, security and all Username claims",
  async ({ member, staff, memberUserId, holder }) => {
    await status(
      member.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: holder.password },
      }),
      201
    );
    const suffix = randomBytes(5).toString("hex");
    const alias = `Alias.${suffix}`;
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: {
          email: holder.email,
          fullName: holder.fullName,
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          phone: holder.phone,
          sharedPhone: false,
          targetUserId: memberUserId,
          username: alias,
        },
      }),
      201
    );
    const before = queryLocalSql(
      `SELECT action FROM audit_event WHERE target_user_id='${memberUserId}' ORDER BY id`
    );
    const input = command(memberUserId);
    const deleted = await status(
      staff.post("/api/v2/staff/accounts/delete", { data: input }),
      201
    );
    const body = await deleted.json();
    expect(body.data.receipt.action).toBe("account_deleted");
    const replay = await status(
      staff.post("/api/v2/staff/accounts/delete", { data: input }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(body.data.receipt);
    expect(
      queryLocalSql(`SELECT id FROM user WHERE id='${memberUserId}'`)
    ).toHaveLength(0);
    expect(
      queryLocalSql(`SELECT id FROM account WHERE user_id='${memberUserId}'`)
    ).toHaveLength(0);
    expect(
      queryLocalSql(`SELECT id FROM session WHERE user_id='${memberUserId}'`)
    ).toHaveLength(0);
    expect(
      queryLocalSql(
        `SELECT user_id FROM person_profile WHERE user_id='${memberUserId}'`
      )
    ).toHaveLength(0);
    expect(
      queryLocalSql(
        `SELECT outcome FROM application_decision WHERE target_user_id='${memberUserId}'`
      )
    ).toEqual([{ outcome: "approved" }]);
    expect(
      queryLocalSql(
        `SELECT action FROM account_security_operation WHERE user_id='${memberUserId}'`
      )
    ).toEqual([{ action: "password_confirmed" }]);
    expect(
      queryLocalSql(
        `SELECT action FROM audit_event WHERE target_user_id='${memberUserId}' AND action<>'account_deleted' ORDER BY id`
      )
    ).toEqual(before);
    expect(
      queryLocalSql(
        `SELECT username_key FROM username_reservation WHERE user_id='${memberUserId}' ORDER BY username_key`
      )
    ).toEqual([
      { username_key: alias.toLowerCase() },
      { username_key: holder.username },
    ]);
    await status(member.get("/api/v2/me"), 401);
    await status(
      member.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: alias },
      }),
      401
    );
    const fresh = person();
    await status(
      staff.post("/api/v2/applications", {
        data: { ...fresh, username: holder.username },
      }),
      409
    );
    await status(
      staff.post("/api/v2/applications", {
        data: { ...fresh, username: alias },
      }),
      409
    );
    await status(
      staff.post("/api/v2/applications", {
        data: {
          ...fresh,
          email: holder.email,
          fullName: holder.fullName,
          phone: holder.phone,
        },
      }),
      201
    );
    const audit = await status(staff.get("/api/v2/staff/account-audit"), 200);
    expect(await audit.text()).toContain(memberUserId);
    expect(await audit.text()).toContain("account_deleted");
  }
);

for (const table of [
  "enrolment",
  "invitation",
  "department_membership",
  "department_manager_assignment",
]) {
  deletionTest(
    `stored ${table} history blocks deletion before cascades and retains deactivation`,
    async ({ staff, memberUserId }) => {
      const departmentId = randomUUID();
      const programId = randomUUID();
      const id = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      runLocalSql(
        `INSERT INTO department(id,name,created_at) VALUES('${departmentId}','Synthetic department',${now}); INSERT INTO program(id,department_id,name,created_at) VALUES('${programId}','${departmentId}','Synthetic program',${now})`
      );
      const inserts = {
        department_manager_assignment: `INSERT INTO department_manager_assignment(id,user_id,department_id,created_at) VALUES('${id}','${memberUserId}','${departmentId}',${now})`,
        department_membership: `INSERT INTO department_membership(id,user_id,department_id,created_at) VALUES('${id}','${memberUserId}','${departmentId}',${now})`,
        enrolment: `INSERT INTO enrolment(id,user_id,program_id,status,created_at,updated_at) VALUES('${id}','${memberUserId}','${programId}','withdrawn',${now},${now})`,
        invitation: `INSERT INTO invitation(id,user_id,program_id,state,expires_at,created_at) VALUES('${id}','${memberUserId}','${programId}','revoked',${now - 10},${now})`,
      };
      runLocalSql(inserts[table as keyof typeof inserts]);
      const response = await status(
        staff.post("/api/v2/staff/accounts/delete", {
          data: command(memberUserId),
        }),
        409
      );
      const body = await response.json();
      expect(body.error.code).toBe("church_history_retained");
      expect(() =>
        runLocalSql(`DELETE FROM user WHERE id='${memberUserId}'`)
      ).toThrow();
      expect(
        queryLocalSql(`SELECT id FROM ${table} WHERE user_id='${memberUserId}'`)
      ).toHaveLength(1);
      expect(
        queryLocalSql(
          `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_deleted'`
        )
      ).toHaveLength(0);
      await status(
        staff.post("/api/v2/staff/accounts/restrictions", {
          data: {
            action: "membership_deactivated",
            operationKey: randomUUID(),
            targetUserId: memberUserId,
          },
        }),
        201
      );
    }
  );
}
for (const table of [
  "user",
  "account",
  "session",
  "person_profile",
  "audit_event",
  "account_change_operation",
]) {
  for (const fault of ["ABORT", "IGNORE"]) {
    deletionTest(
      `deletion ${table} ${fault} leaves no half-deleted required state`,
      async ({ staff, memberUserId, member }) => {
        const input = command(memberUserId);
        const trigger = `fault_deletion_${table}_${fault}`;
        const event =
          table === "audit_event" || table === "account_change_operation"
            ? "INSERT"
            : "DELETE";
        const prefix = event === "DELETE" ? "OLD" : "NEW";
        let column = event === "INSERT" ? "target_user_id" : "user_id";
        if (table === "user") {
          column = "id";
        }
        const condition = `${prefix}.${column}='${memberUserId}'${event === "INSERT" ? ` AND NEW.action='account_deleted'` : ""}`;
        runLocalSql(
          `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic deletion fault'" : ""}); END`
        );
        try {
          await status(
            staff.post("/api/v2/staff/accounts/delete", { data: input }),
            500
          );
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
        }
        expect(
          queryLocalSql(`SELECT id FROM user WHERE id='${memberUserId}'`)
        ).toHaveLength(1);
        expect(
          queryLocalSql(
            `SELECT id FROM account WHERE user_id='${memberUserId}'`
          )
        ).toHaveLength(1);
        expect(
          queryLocalSql(
            `SELECT id FROM session WHERE user_id='${memberUserId}'`
          )
        ).toHaveLength(1);
        expect(
          queryLocalSql(
            `SELECT user_id FROM person_profile WHERE user_id='${memberUserId}'`
          )
        ).toHaveLength(1);
        await status(member.get("/api/v2/me"), 200);
        expect(
          queryLocalSql(
            `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_deleted'`
          )
        ).toHaveLength(0);
        await status(
          staff.post("/api/v2/staff/accounts/delete", { data: input }),
          201
        );
      }
    );
  }
}

deletionTest(
  "fixed Staff targets and stale sensitive confirmation cannot be bypassed",
  async ({ staff, memberUserId }) => {
    const own = await status(staff.get("/api/v2/account/identity"), 200);
    const body = await own.json();
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: command(body.data.identity.actorUserId),
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
      staff.post("/api/v2/staff/accounts/delete", {
        data: command(row.id),
      }),
      403
    );
    runLocalSql(
      `UPDATE session SET password_confirmed_at=CAST(strftime('%s','now') AS INTEGER)-601 WHERE user_id='${body.data.identity.actorUserId}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: command(memberUserId),
      }),
      403
    );
  }
);

deletionTest(
  "matching simultaneous deletion retries reconcile one receipt after the target disappears",
  async ({ staff, memberUserId, playwright }) => {
    const input = command(memberUserId);
    const responses = await Promise.all([
      staff.post("/api/v2/staff/accounts/delete", { data: input }),
      staff.post("/api/v2/staff/accounts/delete", { data: input }),
    ]);
    expect(responses.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    const first = await responses[0].json();
    const second = await responses[1].json();
    expect(first.data.receipt).toEqual(second.data.receipt);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_deleted'`
      )
    ).toHaveLength(1);
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: { ...input, targetUserId: "unrelated-target" },
      }),
      409
    );
    const outsider = person();
    await seedSyntheticAccounts([{ ...outsider, membershipStatus: "active" }]);
    const context = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.31.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(
      context.post("/api/auth/sign-in/username", {
        data: { password: outsider.password, username: outsider.username },
      }),
      200
    );
    const response = await status(
      context.post("/api/v2/account/changes/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    const lookup = await response.json();
    expect(lookup.data.receipt).toBeNull();
    await context.dispose();
  }
);

deletionTest(
  "actual deletion UI retains lost-result recovery after the target leaves the roster",
  async ({ browser, staff, memberUserId, member }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.32.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      hasTouch: true,
      isMobile: true,
      storageState: await staff.storageState(),
      viewport: { height: 915, width: 412 },
    });
    const page = await context.newPage();
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=deletion`
    );
    const region = page.getByRole("region", { name: "永久刪除帳戶" });
    let deletionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/accounts/delete")
      ) {
        deletionPosts += 1;
      }
    });
    await expect(
      region.getByRole("button", { exact: true, name: "檢查刪除資料" })
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
    await region.getByRole("checkbox").check();
    await page.getByRole("link", { name: "← 返回帳戶詳情" }).click();
    const leaveDialog = page.getByRole("dialog");
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(region.getByRole("checkbox")).toBeChecked();
    await page.getByRole("link", { name: "← 返回帳戶詳情" }).click();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    await page.getByRole("link", { name: /永久刪除帳戶/u }).click();
    await expect(region.getByRole("checkbox")).not.toBeChecked();
    await region.getByRole("checkbox").check();
    await region.getByRole("button", { name: "檢查刪除資料" }).click();
    await expect(
      region.getByRole("heading", { exact: true, name: "檢查永久刪除" })
    ).toBeVisible();
    expect(deletionPosts).toBe(0);
    await page.setViewportSize({ height: 740, width: 320 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth, JSON.stringify(viewport)).toBeLessThanOrEqual(
      viewport.clientWidth
    );
    await expect(
      region.getByRole("button", { name: "確認並永久刪除" })
    ).toBeEnabled();
    let interceptedDeletes = 0;
    await page.route("**/api/v2/staff/accounts/delete", async (route) => {
      interceptedDeletes += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/account/changes/reconcile", (route) =>
      route.abort("failed")
    );
    const deletionRequest = page.waitForRequest(
      (requestEvent) =>
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/accounts/delete")
    );
    await region.getByRole("button", { name: "確認並永久刪除" }).click();
    await deletionRequest;
    await expect.poll(() => interceptedDeletes).toBe(1);
    await expect(region.getByRole("status")).toContainText("結果仍未確認");
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("efcc.deletion.operation.v1") ?? "null")
    );
    expect(Object.keys(saved).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
      "targetUserId",
    ]);
    expect(saved.targetUserId).toBe(memberUserId);
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    await expect(region.getByRole("status")).toContainText(memberUserId);
    await status(member.get("/api/v2/me"), 401);
    await page.goto(`${E2E_BASE_URL}/staff/account-audit`);
    const auditRow = page
      .getByRole("listitem")
      .filter({ hasText: memberUserId })
      .filter({ hasText: "永久刪除帳戶" });
    await expect(
      auditRow.getByRole("heading", { exact: true, name: "永久刪除帳戶" })
    ).toBeVisible();
    await auditRow.getByRole("link", { name: "查看詳情" }).click();
    const auditDetail = page.getByRole("region", { name: "帳戶紀錄詳情" });
    await expect(
      auditDetail.getByText(memberUserId, { exact: true })
    ).toBeVisible();
    await expect(auditDetail.locator("time")).toContainText("香港");
    await expect(
      page.getByRole("link", { name: "返回帳戶紀錄" })
    ).toBeVisible();
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_deleted'`
      )
    ).toHaveLength(1);
    await context.close();
  }
);

deletionTest(
  "actual deletion review requires in-task password confirmation before the explicit final submit",
  async ({ browser, staff, memberUserId }) => {
    const own = await status(staff.get("/api/v2/account/identity"), 200);
    const ownBody = await own.json();
    const staffUserId = ownBody.data.identity.actorUserId;
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
        `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=deletion`
      );
      const region = page.getByRole("region", { name: "永久刪除帳戶" });
      let deletionPosts = 0;
      page.on("request", (requestEvent) => {
        if (
          requestEvent.method() === "POST" &&
          requestEvent.url().endsWith("/api/v2/staff/accounts/delete")
        ) {
          deletionPosts += 1;
        }
      });
      await region.getByRole("checkbox").check();
      await region.getByRole("button", { name: "檢查刪除資料" }).click();
      await expect(
        region.getByRole("heading", { exact: true, name: "檢查永久刪除" })
      ).toBeVisible();
      expect(deletionPosts).toBe(0);
      await region.getByRole("button", { name: "確認並永久刪除" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("heading", { exact: true, name: "確認目前密碼" })
      ).toBeVisible();
      expect(deletionPosts).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.deletion.operation.v1")
        )
      ).toBeNull();
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
        region.getByRole("heading", { exact: true, name: "檢查永久刪除" })
      ).toBeVisible();
      expect(deletionPosts).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.deletion.operation.v1")
        )
      ).toBeNull();
      await region.getByRole("button", { name: "確認並永久刪除" }).click();
      await expect(region.getByRole("status")).toContainText("伺服器已確認");
      await expect(region.getByRole("status")).toContainText(memberUserId);
      expect(deletionPosts).toBe(1);
      expect(
        queryLocalSql(`SELECT id FROM user WHERE id='${memberUserId}'`)
      ).toHaveLength(0);
      expect(
        queryLocalSql(
          `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='account_deleted'`
        )
      ).toHaveLength(1);
    } finally {
      await context.close();
    }
  }
);

deletionTest(
  "deletion keeps deferred native routes closed for removed and replacement accounts",
  async ({ staff, memberUserId, member, playwright }) => {
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: command(memberUserId),
      }),
      201
    );
    const replacement = person();
    await seedSyntheticAccounts([
      { ...replacement, membershipStatus: "active" },
    ]);
    const context = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.33.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(
      context.post("/api/auth/sign-in/username", {
        data: {
          password: replacement.password,
          username: replacement.username,
        },
      }),
      200
    );
    await Promise.all(
      [member, context].flatMap((actor) =>
        [
          "delete-user",
          "sign-in/email",
          "request-password-reset",
          "reset-password",
          "send-verification-email",
          "verify-email",
        ].map((path) =>
          status(
            actor.post(`/api/auth/${path}`, {
              data: {
                email: replacement.email,
                password: replacement.password,
                token: "synthetic",
              },
            }),
            404
          )
        )
      )
    );
    await context.dispose();
  }
);

deletionTest(
  "last-effective-Admin guards count durable eligibility without active login sessions and survive competing deletion",
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
        "cf-connecting-ip": `198.28.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    const two = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
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
      one.post("/api/v2/staff/accounts/delete", {
        data: command(second.id),
      }),
      two.post("/api/v2/staff/accounts/delete", {
        data: command(first.id),
      }),
    ]);
    const outcomes = results.map((response) => response.status());
    expect(outcomes.filter((code) => code === 201)).toHaveLength(1);
    expect(outcomes.every((code) => [201, 401, 403, 409].includes(code))).toBe(
      true
    );
    expect(
      queryLocalSql(
        `SELECT count(*) AS count FROM person_profile WHERE account_role='admin' AND membership_status='active' AND banned_at IS NULL`
      )
    ).toEqual([{ count: 1 }]);
    await one.dispose();
    await two.dispose();
  }
);

deletionTest(
  "deletion origin and database limits preserve private current-state reads",
  async ({ staff, memberUserId }) => {
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: command(memberUserId),
        headers: { origin: "https://foreign.example" },
      }),
      403
    );
    for (let index = 0; index < 10; index += 1) {
      // Request order establishes the exact database limiter boundary.
      // eslint-disable-next-line no-await-in-loop
      await status(
        staff.post("/api/v2/staff/accounts/delete", {
          data: { operationKey: randomUUID() },
        }),
        400
      );
    }
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: { operationKey: randomUUID() },
      }),
      429
    );
    const read = await status(staff.get("/api/v2/staff/accounts"), 200);
    expect(read.headers()["cache-control"]).toContain("no-store");
  }
);

deletionTest(
  "deletion removes issued temporary credentials and reissue state without deleting recovery audit",
  async ({ staff, member, memberUserId, holder }) => {
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
    const resetBody = await reset.json();
    const password = resetBody.data.temporaryPassword;
    await status(
      staff.post("/api/v2/staff/accounts/delete", {
        data: command(memberUserId),
      }),
      201
    );
    await status(
      member.post("/api/auth/sign-in/username", {
        data: { password, username: holder.username },
      }),
      401
    );
    await status(
      staff.post("/api/v2/staff/accounts/password-reissue", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: memberUserId,
        },
      }),
      403
    );
    expect(
      queryLocalSql(
        `SELECT action FROM staff_account_operation WHERE target_user_id='${memberUserId}'`
      )
    ).toEqual([{ action: "staff_password_reset" }]);
    expect(
      queryLocalSql(`SELECT id FROM account WHERE user_id='${memberUserId}'`)
    ).toHaveLength(0);
  }
);

deletionTest(
  "history denial blocks deletion and links to the same account's deactivation task",
  async ({ browser, staff, memberUserId, member }) => {
    const departmentId = randomUUID();
    runLocalSql(
      `INSERT INTO department(id,name,created_at) VALUES('${departmentId}','Synthetic history',CAST(strftime('%s','now') AS INTEGER)); INSERT INTO department_membership(id,department_id,user_id,created_at) VALUES('${randomUUID()}','${departmentId}','${memberUserId}',CAST(strftime('%s','now') AS INTEGER))`
    );
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.34.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await staff.storageState(),
    });
    const page = await context.newPage();
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=deletion`
    );
    const region = page.getByRole("region", { name: "永久刪除帳戶" });
    await expect(
      region.getByRole("button", { name: "檢查刪除資料" })
    ).toBeEnabled();
    await region.getByRole("checkbox").check();
    await region.getByRole("button", { name: "檢查刪除資料" }).click();
    await expect(
      region.getByRole("heading", { exact: true, name: "檢查永久刪除" })
    ).toBeVisible();
    await region.getByRole("button", { name: "確認並永久刪除" }).click();
    await expect(region.getByRole("status")).toContainText(
      "有教會業務紀錄，不能永久刪除"
    );
    await expect(
      region.getByRole("button", { name: "確認並永久刪除" })
    ).toBeDisabled();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.deletion.operation.v1")
      )
    ).toBeNull();
    await status(member.get("/api/v2/me"), 200);
    await page.getByRole("link", { name: "改為停用會籍" }).click();
    const leaveDialog = page.getByRole("dialog");
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    await expect(page).toHaveURL(/task=restrictions/u);
    const restrictions = page.getByRole("region", { name: "會籍與安全限制" });
    await expect(restrictions).toBeVisible();
    await context.close();
  }
);
