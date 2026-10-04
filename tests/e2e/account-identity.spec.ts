import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

const status = async (promise: Promise<APIResponse>, expected: number) => {
  const response = await promise;
  expect(response.status()).toBe(expected);
  return response;
};
const phone = () =>
  String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000));
const person = () => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `identity.${suffix}@example.com`,
    fullName: `陳資料${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-identity-password!",
    phone: phone(),
    username: `identity.${suffix}`,
  };
};
const identityTest = test.extend<{
  holder: ReturnType<typeof person>;
  member: APIRequestContext;
  staff: APIRequestContext;
  memberUserId: string;
}>({
  holder: async ({ baseURL }, use) => {
    expect(baseURL).toBe(E2E_BASE_URL);
    await use(person());
  },
  member: async ({ playwright, holder, staff }, use) => {
    const context = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.26.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(context.post("/api/v2/applications", { data: holder }), 201);
    await status(
      context.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
      }),
      200
    );
    const own = await status(context.get("/api/v2/applications/mine"), 200);
    const body = await own.json();
    await status(
      staff.post("/api/v2/staff/application-decisions", {
        data: {
          applicationId: body.data.application.id,
          operationKey: randomUUID(),
          outcome: "approved",
        },
      }),
      201
    );
    await use(context);
    await context.dispose();
  },
  memberUserId: async ({ member, holder }, use) => {
    await member.get("/api/v2/me");
    const [row] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${holder.username}'`
    );
    if (!row) {
      throw new Error("Synthetic identity holder missing");
    }
    await use(row.id);
  },
  staff: async ({ playwright }, use) => {
    const holder = person();
    await seedSyntheticAccounts([{ ...holder, membershipStatus: "active" }]);
    runLocalSql(
      `UPDATE person_profile SET account_role='staff' WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}')`
    );
    const context = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.25.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(
      context.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
      }),
      200
    );
    await status(
      context.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: holder.password },
      }),
      201
    );
    await use(context);
    await context.dispose();
  },
});
const identity = (targetUserId: string) => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `corrected.${suffix}@example.com`,
    fullName: `陳修正Ａ${suffix}`,
    identityCheck: "face_to_face",
    operationKey: randomUUID(),
    phone: phone(),
    sharedPhone: false,
    targetUserId,
    username: `Mixed.${suffix}`,
  };
};

identityTest(
  "approved holder changes only own unique phone and Staff corrects canonical identity with permanent aliases",
  async ({ member, holder, staff, memberUserId }) => {
    const ownInput = { operationKey: randomUUID(), phone: phone() };
    await status(member.post("/api/v2/account/phone", { data: ownInput }), 201);
    await status(member.post("/api/v2/account/phone", { data: ownInput }), 200);
    await status(
      member.post("/api/v2/account/phone", {
        data: { ...ownInput, fullName: "不允許自行改名" },
      }),
      400
    );
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${memberUserId}'`);
    const input = identity(memberUserId);
    const changed = await status(
      staff.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const changedBody = await changed.json();
    const replay = await status(
      staff.post("/api/v2/staff/accounts/identity", { data: input }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(changedBody.data.receipt);
    const [row] = queryLocalSql<{
      name: string;
      username: string;
      display_username: string;
      email_verified: number;
      phone: string;
      name_lookup_key: string;
      verified_recovery_phone: string | null;
    }>(
      `SELECT u.name,u.username,u.display_username,u.email_verified,p.phone,p.name_lookup_key,p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id=u.id WHERE u.id='${memberUserId}'`
    );
    expect(row).toMatchObject({
      display_username: input.username,
      email_verified: 0,
      name: input.fullName,
      phone: `+852${input.phone}`,
      username: input.username.toLowerCase(),
      verified_recovery_phone: null,
    });
    expect(row?.name_lookup_key).toContain("a");
    await status(
      member.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
      }),
      401
    );
    await status(
      member.post("/api/auth/sign-in/username", {
        data: {
          password: holder.password,
          username: input.username.toUpperCase(),
        },
      }),
      200
    );
    await status(
      member.post("/api/auth/sign-in/name", {
        data: {
          fullName: input.fullName.replace("Ａ", "a"),
          password: holder.password,
        },
      }),
      200
    );
    expect(
      queryLocalSql(
        `SELECT username_key FROM username_reservation WHERE user_id='${memberUserId}' ORDER BY username_key`
      )
    ).toEqual([
      { username_key: holder.username },
      { username_key: input.username.toLowerCase() },
    ]);
    const duplicate = person();
    await status(
      staff.post("/api/v2/applications", {
        data: { ...duplicate, username: holder.username },
      }),
      409
    );
    await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: memberUserId,
        },
      }),
      403
    );
    await status(
      member.post("/api/auth/update-user", { data: { name: "forged name" } }),
      404
    );
    await status(
      member.post("/api/auth/change-email", {
        data: { newEmail: "future@example.com" },
      }),
      404
    );
    expect(
      queryLocalSql(
        `SELECT count(*) AS audits FROM audit_event WHERE target_user_id='${memberUserId}' AND action IN ('own_phone_changed','staff_identity_corrected')`
      )
    ).toEqual([{ audits: 2 }]);
  }
);

identityTest(
  "shared-phone Staff exception is audited without turning an edited contact into recovery proof",
  async ({ member, staff, memberUserId }) => {
    const other = person();
    await seedSyntheticAccounts([{ ...other, membershipStatus: "active" }]);
    runLocalSql(
      `UPDATE person_profile SET phone='+852${other.phone}' WHERE user_id=(SELECT id FROM user WHERE username='${other.username}')`
    );
    await status(
      member.post("/api/v2/account/phone", {
        data: { operationKey: randomUUID(), phone: other.phone },
      }),
      409
    );
    const input = {
      ...identity(memberUserId),
      phone: other.phone,
      sharedPhone: true,
    };
    const response = await status(
      staff.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const body = await response.json();
    expect(body.data.receipt.action).toBe("staff_shared_phone_corrected");
    expect(
      queryLocalSql(
        `SELECT phone,phone_shared,verified_recovery_phone FROM person_profile WHERE user_id='${memberUserId}'`
      )
    ).toEqual([
      {
        phone: `+852${other.phone}`,
        phone_shared: 1,
        verified_recovery_phone: null,
      },
    ]);
    await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: memberUserId,
        },
      }),
      403
    );
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: {
          ...input,
          operationKey: randomUUID(),
          verifiedRecoveryPhone: other.phone,
        },
      }),
      400
    );
    await status(
      member.post("/api/v2/account/phone", {
        data: { operationKey: randomUUID(), phone: phone() },
      }),
      201
    );
    expect(
      queryLocalSql(
        `SELECT phone_shared,verified_recovery_phone FROM person_profile WHERE user_id='${memberUserId}'`
      )
    ).toEqual([{ phone_shared: 0, verified_recovery_phone: null }]);
  }
);

for (const table of [
  "user",
  "person_profile",
  "username_reservation",
  "audit_event",
  "account_change_operation",
]) {
  for (const fault of ["ABORT", "IGNORE"]) {
    identityTest(
      `Staff identity ${table} ${fault} rolls back every required identity and audit effect`,
      async ({ holder, staff, memberUserId }) => {
        const input = identity(memberUserId);
        const trigger = `fault_identity_${table}_${fault}`;
        const event =
          table === "user" || table === "person_profile" ? "UPDATE" : "INSERT";
        const condition = {
          account_change_operation: `NEW.target_user_id='${memberUserId}'`,
          audit_event: `NEW.target_user_id='${memberUserId}' AND NEW.action='staff_identity_corrected'`,
          person_profile: `NEW.user_id='${memberUserId}'`,
          user: `NEW.id='${memberUserId}'`,
          username_reservation: `NEW.user_id='${memberUserId}' AND NEW.username_key='${input.username.toLowerCase()}'`,
        }[
          table as
            | "user"
            | "person_profile"
            | "username_reservation"
            | "audit_event"
            | "account_change_operation"
        ];
        runLocalSql(
          `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic identity fault'" : ""}); END`
        );
        try {
          const response = await status(
            staff.post("/api/v2/staff/accounts/identity", { data: input }),
            500
          );
          expect(await response.text()).not.toContain(
            "Synthetic identity fault"
          );
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
        }
        expect(
          queryLocalSql(
            `SELECT name,email,username FROM user WHERE id='${memberUserId}'`
          )
        ).toEqual([
          {
            email: holder.email,
            name: holder.fullName,
            username: holder.username,
          },
        ]);
        expect(
          queryLocalSql(
            `SELECT phone FROM person_profile WHERE user_id='${memberUserId}'`
          )
        ).toEqual([{ phone: `+852${holder.phone}` }]);
        expect(
          queryLocalSql(
            `SELECT username_key FROM username_reservation WHERE username_key='${input.username.toLowerCase()}'`
          )
        ).toHaveLength(0);
        expect(
          queryLocalSql(
            `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='staff_identity_corrected'`
          )
        ).toHaveLength(0);
        const reconciliation = await status(
          staff.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const reconciledBody = await reconciliation.json();
        expect(reconciledBody.data.receipt).toBeNull();
        await status(
          staff.post("/api/v2/staff/accounts/identity", { data: input }),
          201
        );
      }
    );
  }
}

identityTest(
  "competing identity claims and same-operation retries retain exactly one authoritative effect",
  async ({ holder, member, staff, memberUserId }) => {
    const input = identity(memberUserId);
    const results = await Promise.all([
      staff.post("/api/v2/staff/accounts/identity", { data: input }),
      staff.post("/api/v2/staff/accounts/identity", { data: input }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='staff_identity_corrected'`
      )
    ).toHaveLength(1);
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: { ...input, phone: phone() },
      }),
      409
    );
    const ownKey = randomUUID();
    await status(
      member.post("/api/v2/account/phone", {
        data: { operationKey: ownKey, phone: phone() },
      }),
      201
    );
    const foreign = await status(
      staff.post("/api/v2/account/changes/reconcile", {
        data: { operationKey: ownKey },
      }),
      200
    );
    const foreignBody = await foreign.json();
    expect(foreignBody.data.receipt).toBeNull();
    // An old alias stays reserved even to the original account under the existing policy.
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: {
          ...input,
          operationKey: randomUUID(),
          username: holder.username,
        },
      }),
      409
    );
  }
);

identityTest(
  "fixed Staff targets, stale confirmation and pre-existing verified phone policy remain authoritative",
  async ({ staff, memberUserId }) => {
    const selfResponse = await status(
      staff.get("/api/v2/account/identity"),
      200
    );
    const selfBody = await selfResponse.json();
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: identity(selfBody.data.identity.actorUserId),
      }),
      403
    );
    const privileged = person();
    await seedSyntheticAccounts([
      { ...privileged, membershipStatus: "active" },
    ]);
    const [target] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${privileged.username}'`
    );
    if (!target) {
      throw new Error("Synthetic privileged target missing");
    }
    runLocalSql(
      `UPDATE person_profile SET account_role='staff' WHERE user_id='${target.id}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: identity(target.id),
      }),
      403
    );
    runLocalSql(
      `UPDATE person_profile SET account_role='admin' WHERE user_id='${target.id}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: identity(target.id),
      }),
      403
    );
    const input = identity(memberUserId);
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: { ...input, identityCheck: "verified_phone" },
      }),
      403
    );
    const verified = `+852${phone()}`;
    runLocalSql(
      `UPDATE person_profile SET verified_recovery_phone='${verified}' WHERE user_id='${memberUserId}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: { ...input, identityCheck: "verified_phone" },
      }),
      201
    );
    expect(
      queryLocalSql(
        `SELECT verified_recovery_phone FROM person_profile WHERE user_id='${memberUserId}'`
      )
    ).toEqual([{ verified_recovery_phone: verified }]);
    runLocalSql(
      `UPDATE session SET password_confirmed_at=CAST(strftime('%s','now') AS INTEGER)-601 WHERE user_id='${selfBody.data.identity.actorUserId}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: identity(memberUserId),
      }),
      403
    );
  }
);

identityTest(
  "competing unique phone changes cannot claim the same number for two accounts",
  async ({ member, staff, memberUserId }) => {
    const other = person();
    await seedSyntheticAccounts([{ ...other, membershipStatus: "active" }]);
    const [target] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${other.username}'`
    );
    if (!target) {
      throw new Error("Synthetic second holder missing");
    }
    const shared = phone();
    const results = await Promise.all([
      member.post("/api/v2/account/phone", {
        data: { operationKey: randomUUID(), phone: shared },
      }),
      staff.post("/api/v2/staff/accounts/identity", {
        data: { ...identity(target.id), phone: shared },
      }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      201, 409,
    ]);
    expect(
      queryLocalSql(
        `SELECT user_id FROM person_profile WHERE phone='+852${shared}'`
      )
    ).toHaveLength(1);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id IN ('${memberUserId}','${target.id}') AND action IN ('own_phone_changed','staff_identity_corrected')`
      )
    ).toHaveLength(1);
  }
);

identityTest(
  "canonical duplicate-name correction remains ambiguous and email placeholder replacement stays unverified",
  async ({ member, staff, memberUserId, holder }) => {
    const other = person();
    await seedSyntheticAccounts([{ ...other, membershipStatus: "active" }]);
    const input = {
      ...identity(memberUserId),
      email: null,
      fullName: other.fullName,
    };
    await status(
      staff.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const [user] = queryLocalSql<{ email: string; email_verified: number }>(
      `SELECT email,email_verified FROM user WHERE id='${memberUserId}'`
    );
    expect(user?.email).toMatch(/@accounts\.efcc\.invalid$/u);
    expect(user?.email_verified).toBe(0);
    const ambiguous = await status(
      member.post("/api/auth/sign-in/name", {
        data: { fullName: other.fullName, password: holder.password },
      }),
      409
    );
    const body = await ambiguous.json();
    expect(body.code).toBe("NAME_AMBIGUOUS");
    expect(JSON.stringify(body)).not.toContain(other.username);
    await status(
      staff.post("/api/v2/staff/accounts/identity", {
        data: {
          ...input,
          email: `replacement.${randomBytes(5).toString("hex")}@example.com`,
          operationKey: randomUUID(),
        },
      }),
      201
    );
    expect(
      queryLocalSql(
        `SELECT email_verified FROM user WHERE id='${memberUserId}'`
      )
    ).toEqual([{ email_verified: 0 }]);
  }
);

identityTest(
  "actual own-phone page recovers a lost response after reload with metadata-only storage",
  async ({ browser, member, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.26.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      hasTouch: true,
      isMobile: true,
      storageState: await member.storageState(),
      viewport: {
        height: 915,
        width: 412,
      },
    });
    const page = await context.newPage();
    await page.goto(`${E2E_BASE_URL}/account`);
    const region = page.getByRole("region", { name: "更改自己的電話" });
    await page.route("**/api/v2/account/phone", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/account/changes/reconcile", (route) =>
      route.abort("failed")
    );
    const replacement = phone();
    await region.getByLabel("新電話", { exact: true }).fill(replacement);
    await region
      .getByRole("button", {
        exact: true,
        name: "更改電話",
      })
      .click();
    await expect(region.getByRole("status")).toContainText("結果仍未確認");
    const metadata = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.identity-change.operation.v1") ?? "null"
      )
    );
    expect(Object.keys(metadata).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
      "targetUserId",
    ]);
    expect(JSON.stringify(metadata)).not.toContain(replacement);
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    await expect(region.getByLabel("新電話", { exact: true })).toHaveValue(
      `+852${replacement}`
    );
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='own_phone_changed'`
      )
    ).toHaveLength(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await context.close();
  }
);

identityTest(
  "actual Staff identity form performs a verified correction and audit readers see its action",
  async ({ browser, staff, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await staff.storageState(),
    });
    const page = await context.newPage();
    await page.goto(`${E2E_BASE_URL}/staff/accounts`);
    await page
      .getByLabel("選擇修正資料的帳戶", { exact: true })
      .selectOption(memberUserId);
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    await region
      .getByLabel("中文全名", { exact: true })
      .fill(`陳實際修正${randomBytes(4).toString("hex")}`);
    await region
      .getByLabel("使用者名稱", { exact: true })
      .fill(`UI.${randomBytes(5).toString("hex")}`);
    await region
      .getByLabel("電郵（沒有電郵可留空）", { exact: true })
      .fill(`ui.${randomBytes(5).toString("hex")}@example.com`);
    await region.getByLabel("修正電話", { exact: true }).fill(phone());
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region
      .getByRole("button", {
        exact: true,
        name: "提交核實修正",
      })
      .click();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    await page.goto(`${E2E_BASE_URL}/staff/account-audit`);
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: memberUserId })
        .getByRole("heading", {
          exact: true,
          name: "職員核實修正身分資料",
        })
    ).toBeVisible();
    await context.close();
  }
);

for (const table of [
  "person_profile",
  "audit_event",
  "account_change_operation",
]) {
  for (const fault of ["ABORT", "IGNORE"]) {
    identityTest(
      `own phone ${table} ${fault} preserves contact and audit until a matching retry`,
      async ({ member, memberUserId, holder }) => {
        const input = { operationKey: randomUUID(), phone: phone() };
        const trigger = `fault_own_phone_${table}_${fault}`;
        const event = table === "person_profile" ? "UPDATE" : "INSERT";
        const condition =
          table === "person_profile"
            ? `NEW.user_id='${memberUserId}'`
            : `NEW.target_user_id='${memberUserId}' AND NEW.action='own_phone_changed'`;
        runLocalSql(
          `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic own phone fault'" : ""}); END`
        );
        try {
          await status(
            member.post("/api/v2/account/phone", { data: input }),
            500
          );
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
        }
        expect(
          queryLocalSql(
            `SELECT phone FROM person_profile WHERE user_id='${memberUserId}'`
          )
        ).toEqual([{ phone: `+852${holder.phone}` }]);
        expect(
          queryLocalSql(
            `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='own_phone_changed'`
          )
        ).toHaveLength(0);
        await status(
          member.post("/api/v2/account/phone", { data: input }),
          201
        );
      }
    );
  }
}

identityTest(
  "own identity data and operation metadata do not expose another account or accept foreign origins",
  async ({ member, memberUserId }) => {
    const input = { operationKey: randomUUID(), phone: phone() };
    await status(
      member.post("/api/v2/account/phone", {
        data: input,
        headers: { origin: "https://foreign.example" },
      }),
      403
    );
    await status(
      member.post("/api/v2/account/phone", {
        data: { ...input, targetUserId: randomUUID() },
      }),
      400
    );
    const read = await status(
      member.get("/api/v2/account/identity", {
        headers: { "x-efcc-user-id": randomUUID() },
      }),
      200
    );
    const body = await read.json();
    expect(body.data.identity.actorUserId).toBe(memberUserId);
    expect(read.headers()["cache-control"]).toContain("no-store");
  }
);

identityTest(
  "an incomplete profile does not block existing own-password controls",
  async ({ page, member, holder, memberUserId }) => {
    runLocalSql(`DELETE FROM person_profile WHERE user_id='${memberUserId}'`);
    const state = await member.storageState();
    await page.context().addCookies(state.cookies);
    await page.goto("/account");
    await expect(
      page.getByRole("region", { name: "帳戶安全操作" }).getByRole("button", {
        exact: true,
        name: "更改密碼",
      })
    ).toBeEnabled();
    await expect(
      page.getByRole("region", { name: "更改自己的電話" })
    ).toHaveCount(0);
    await status(
      member.post("/api/v2/account/password", {
        data: {
          currentPassword: holder.password,
          newPassword: "Synthetic-incomplete-profile-change!",
          operationKey: randomUUID(),
        },
      }),
      201
    );
  }
);
