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
  syntheticPhone,
  userIdOf,
} from "./staff-fixture";
import type { SyntheticPerson } from "./staff-fixture";

const phone = syntheticPhone;
const person = () => syntheticPerson("identity");
const identityTest = test.extend<{
  holder: SyntheticPerson;
  member: APIRequestContext;
  staff: APIRequestContext;
  staffAccount: SyntheticPerson;
  staffUserId: string;
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
    const response = await staff.get("/api/v2/me");
    expect(response.status()).toBe(200);
    await use(userIdOf(staffAccount.username));
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
  "actor-bound requests cannot use forged actor headers to mutate or reconcile another account",
  async ({ member, memberUserId }) => {
    const headers = {
      "x-efcc-expected-actor-id": "different-account",
      "x-efcc-session-id": "forged-session",
      "x-efcc-user-id": "different-account",
    };
    await Promise.all(
      [
        "/api/v2/account/security/reconcile",
        "/api/v2/account/changes/reconcile",
        "/api/v2/staff/accounts/reconcile",
        "/api/v2/applications/actions/reconcile",
        "/api/v2/staff/application-decisions/reconcile",
      ].map(async (path) => {
        const response = await status(
          member.post(path, {
            data: {
              operationKey: randomUUID(),
              ...(path.includes("application-decisions")
                ? { applicationId: randomUUID() }
                : {}),
            },
            headers,
          }),
          409
        );
        const body = await response.json();
        expect(body.error.code).toBe("actor_changed");
      })
    );
    const rejected = await status(
      member.post("/api/v2/staff/accounts/restrictions", {
        data: {
          action: "account_banned",
          operationKey: randomUUID(),
          targetUserId: memberUserId,
        },
        headers,
      }),
      409
    );
    const rejectedBody = await rejected.json();
    expect(rejectedBody.error.code).toBe("actor_changed");
    const input = { operationKey: randomUUID(), phone: phone() };
    const ownHeaders = { "x-efcc-expected-actor-id": memberUserId };
    const created = await status(
      member.post("/api/v2/account/phone", {
        data: input,
        headers: ownHeaders,
      }),
      201
    );
    const replayed = await status(
      member.post("/api/v2/account/phone", {
        data: input,
        headers: ownHeaders,
      }),
      200
    );
    const replayedBody = await replayed.json();
    const createdBody = await created.json();
    expect(replayedBody.data.receipt.id).toBe(createdBody.data.receipt.id);
  }
);

for (const action of ["phone", "revoke-others"] as const) {
  identityTest(
    `stale ${action} page cannot mutate the account signed in by another tab`,
    async ({ browser, member, holder }) => {
      const other = person();
      await seedSyntheticAccounts([{ ...other, membershipStatus: "active" }]);
      const context = await browser.newContext({
        extraHTTPHeaders: {
          "cf-connecting-ip": `198.31.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
          origin: E2E_BASE_URL,
        },
        storageState: await member.storageState(),
      });
      try {
        const page = await context.newPage();
        await page.goto(`${E2E_BASE_URL}/account`);
        const isPhone = action === "phone";
        if (isPhone) {
          await page.getByRole("link", { name: "更新聯絡電話" }).click();
        } else {
          await page
            .getByRole("link", { exact: true, name: "帳戶安全" })
            .click();
          await page
            .getByRole("link", { exact: true, name: "登出其他裝置" })
            .click();
        }
        const region = isPhone
          ? page.getByRole("region", { name: "更改自己的電話" })
          : page.getByRole("main", { name: "帳戶安全操作" });
        const startButton = region.getByRole("button", {
          exact: true,
          name: isPhone ? "檢查電話" : "登出其他裝置",
        });
        await expect(startButton).toBeEnabled();
        await status(
          context.request.post(`${E2E_BASE_URL}/api/auth/sign-out`, {
            data: {},
          }),
          200
        );
        await status(
          context.request.post(`${E2E_BASE_URL}/api/auth/sign-in/username`, {
            data: { password: other.password, username: other.username },
          }),
          200
        );
        const current = await status(
          context.request.get(`${E2E_BASE_URL}/api/v2/account/identity`),
          200
        );
        const currentBody = await current.json();
        const otherId = currentBody.data.identity.actorUserId;
        const otherDevice = await browser.newContext({
          extraHTTPHeaders: { origin: E2E_BASE_URL },
        });
        try {
          await status(
            otherDevice.request.post(
              `${E2E_BASE_URL}/api/auth/sign-in/username`,
              {
                data: { password: other.password, username: other.username },
              }
            ),
            200
          );
        } finally {
          await otherDevice.close();
        }
        const before = queryLocalSql(
          `SELECT id FROM session WHERE user_id='${otherId}' ORDER BY id`
        );
        expect(before).toHaveLength(2);
        if (isPhone) {
          await region.getByLabel("新電話", { exact: true }).fill(phone());
          await startButton.click();
          await expect(
            region.getByRole("heading", { name: "提交前檢查" })
          ).toBeVisible();
        }
        const path = isPhone
          ? "/api/v2/account/phone"
          : "/api/v2/account/sessions/revoke-others";
        const submitButton = isPhone
          ? region.getByRole("button", {
              exact: true,
              name: "確認並儲存電話",
            })
          : startButton;
        const pending = page.waitForResponse((response) =>
          response.url().endsWith(path)
        );
        await submitButton.click();
        const response = await pending;
        expect(response.status()).toBe(409);
        const responseBody = await response.json();
        expect(responseBody.error.code).toBe("actor_changed");
        await expect(region.getByRole("status")).toContainText("未確認");
        const metadata = await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
          action === "phone"
            ? "efcc.identity-change.operation.v1"
            : "efcc.account-security.operation.v1"
        );
        expect(metadata).not.toBeNull();
        expect(
          queryLocalSql(
            `SELECT id FROM session WHERE user_id='${otherId}' ORDER BY id`
          )
        ).toEqual(before);
        expect(
          queryLocalSql(
            `SELECT id FROM account_change_operation WHERE operation_key='${metadata.key}'`
          )
        ).toHaveLength(0);
        expect(
          queryLocalSql(
            `SELECT id FROM account_security_operation WHERE operation_key='${metadata.key}'`
          )
        ).toHaveLength(0);
        const unchanged = await status(
          context.request.get(`${E2E_BASE_URL}/api/v2/account/identity`),
          200
        );
        const unchangedBody = await unchanged.json();
        expect(unchangedBody.data.identity.phone).toBeNull();
        await page.reload();
        await expect(region.getByRole("status")).toContainText("另一帳戶");
        await status(
          context.request.post(`${E2E_BASE_URL}/api/auth/sign-out`, {
            data: {},
          }),
          200
        );
        await status(
          context.request.post(`${E2E_BASE_URL}/api/auth/sign-in/username`, {
            data: { password: holder.password, username: holder.username },
          }),
          200
        );
        await page.reload();
        await expect(
          region.getByText("尚未找到完成紀錄", { exact: false })
        ).toBeVisible();
        const retryButtonName = isPhone ? "檢查電話" : "登出其他裝置";
        await expect(
          region.getByRole("button", {
            exact: true,
            name: retryButtonName,
          })
        ).toBeEnabled();
      } finally {
        await context.close();
      }
    }
  );
}

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
  "own-phone task reviews the contact change and recovers a committed lost response",
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
    await page.getByRole("link", { name: "更新聯絡電話" }).click();
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
    const phoneField = region.getByLabel("新電話", { exact: true });
    await phoneField.fill(replacement);
    await region.getByRole("link", { name: "← 返回帳戶" }).click();
    const leaveDialog = page.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(phoneField).toHaveValue(replacement);
    await region.getByRole("link", { name: "← 返回帳戶" }).click();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    await page.getByRole("link", { name: "更新聯絡電話" }).click();
    await phoneField.fill(replacement);
    await region
      .getByRole("button", {
        exact: true,
        name: "檢查電話",
      })
      .click();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();
    await region
      .getByRole("button", { exact: true, name: "確認並儲存電話" })
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
    await page.getByRole("button", { name: "完成，返回帳戶" }).click();
    await expect(page).toHaveURL(`${E2E_BASE_URL}/account`);
    await expect(
      page.getByText(`+852${replacement}`, { exact: true })
    ).toBeVisible();
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
  "Staff identity review preserves empty and false edits through verification and password confirmation",
  async ({
    browser,
    staff,
    staffAccount,
    staffUserId,
    memberUserId,
    holder,
  }) => {
    runLocalSql(
      `UPDATE session SET password_confirmed_at=CAST(strftime('%s','now') AS INTEGER)-601 WHERE user_id='${staffUserId}'`
    );
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${memberUserId}'`);
    runLocalSql(
      `UPDATE person_profile SET phone_shared=1, verified_recovery_phone='+852${holder.phone}' WHERE user_id='${memberUserId}'`
    );
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await staff.storageState(),
    });
    const page = await context.newPage();
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    const correctedName = `陳實際修正${randomBytes(4).toString("hex")}`;
    const correctedUsername = `UI.${randomBytes(5).toString("hex")}`;
    await region.getByLabel("中文全名", { exact: true }).fill(correctedName);
    await region
      .getByLabel("使用者名稱", { exact: true })
      .fill(correctedUsername);
    await region.getByLabel("電郵（沒有電郵可留空）", { exact: true }).fill("");
    await region.getByLabel("修正電話", { exact: true }).fill(phone());
    await region.getByLabel("已核實共用電話例外").uncheck();
    await region.getByLabel("身分核實方式").selectOption("verified_phone");
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region
      .getByRole("button", {
        exact: true,
        name: "檢查修正",
      })
      .click();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();
    await expect(region.getByText("清除電郵", { exact: true })).toBeVisible();
    await expect(region.getByText("否", { exact: true })).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText("透過原有已核實電話主動聯絡", { exact: true })
    ).toBeVisible();
    await expect(region.getByText("已核實", { exact: true })).toBeVisible();
    await region.getByRole("button", { name: "確認目前密碼" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "返回原工作" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();
    await expect(region.getByText("清除電郵", { exact: true })).toBeVisible();
    await expect(region.getByText("否", { exact: true })).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText("透過原有已核實電話主動聯絡", { exact: true })
    ).toBeVisible();
    await expect(region.getByText("已核實", { exact: true })).toBeVisible();
    await region.getByRole("button", { name: "確認目前密碼" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();
    await region.getByRole("button", { name: "確認目前密碼" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staffAccount.password);
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();
    expect(
      queryLocalSql<{ id: string }>(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action='staff_identity_corrected'`
      )
    ).toHaveLength(0);
    await region
      .getByRole("button", { exact: true, name: "確認並提交修正" })
      .click();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    expect(
      queryLocalSql<{
        email: string;
        email_verified: number;
        phone_shared: number;
        verified_recovery_phone: string | null;
      }>(
        `SELECT u.email,u.email_verified,p.phone_shared,p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id=u.id WHERE u.id='${memberUserId}'`
      )
    ).toMatchObject([
      {
        email_verified: 0,
        phone_shared: 0,
        verified_recovery_phone: `+852${holder.phone}`,
      },
    ]);
    await region.getByRole("button", { name: "返回帳戶詳情" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/staff/accounts\\?view=people&person=${memberUserId}`, "u")
    );
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

identityTest(
  "Staff identity refresh clears an unavailable method without losing its draft or unresolved reference",
  async ({
    browser,
    staff,
    staffAccount,
    staffUserId,
    memberUserId,
    holder,
  }) => {
    const orphanReference = {
      action: "staff_identity_corrected" as const,
      actorUserId: staffUserId,
      key: randomUUID(),
      targetUserId: memberUserId,
    };
    runLocalSql(
      `UPDATE session SET password_confirmed_at=CAST(strftime('%s','now') AS INTEGER)-601 WHERE user_id='${staffUserId}'`
    );
    runLocalSql(
      `UPDATE person_profile SET phone_shared=1, verified_recovery_phone='+852${holder.phone}' WHERE user_id='${memberUserId}'`
    );
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await staff.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.addInitScript((operation) => {
        localStorage.setItem(
          "efcc.identity-change.operation.v1",
          JSON.stringify(operation)
        );
      }, orphanReference);

      let identityPosts = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().endsWith("/api/v2/staff/accounts/identity")
        ) {
          identityPosts += 1;
        }
      });
      await page.goto(
        `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=identity`
      );
      const region = page.getByRole("region", {
        name: "職員核實修正身分資料",
      });
      await expect(region.getByRole("status")).toContainText(
        "尚未找到完成紀錄"
      );

      const correctedName = `陳保留草稿${randomBytes(4).toString("hex")}`;
      const correctedUsername = `UI.${randomBytes(5).toString("hex")}`;
      const correctedPhone = phone();
      const fullName = region.getByLabel("中文全名", { exact: true });
      const username = region.getByLabel("使用者名稱", { exact: true });
      const email = region.getByLabel("電郵（沒有電郵可留空）", {
        exact: true,
      });
      const phoneField = region.getByLabel("修正電話", { exact: true });
      const sharedPhone = region.getByLabel("已核實共用電話例外");
      const verificationMethod = region.getByLabel("身分核實方式");
      const acknowledgement = region.getByLabel(
        "已按以上方式核實本人，新聯絡資料沒有用作復原憑證",
        { exact: true }
      );

      await fullName.fill(correctedName);
      await username.fill(correctedUsername);
      await email.fill("");
      await phoneField.fill(correctedPhone);
      await sharedPhone.uncheck();
      await verificationMethod.selectOption("verified_phone");
      await acknowledgement.check();
      await region
        .getByRole("button", { exact: true, name: "檢查修正" })
        .click();
      await expect(
        region.getByRole("heading", { name: "提交前檢查" })
      ).toBeVisible();
      await expect(
        region.getByText("透過原有已核實電話主動聯絡", { exact: true })
      ).toBeVisible();

      runLocalSql(
        `UPDATE person_profile SET verified_recovery_phone=NULL WHERE user_id='${memberUserId}'`
      );
      await region
        .getByRole("button", { exact: true, name: "確認目前密碼" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog
        .getByLabel("目前密碼", { exact: true })
        .fill(staffAccount.password);
      await dialog
        .getByRole("button", { exact: true, name: "確認並返回檢查" })
        .click();
      await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
      await dialog
        .getByRole("button", { exact: true, name: "確認並返回檢查" })
        .click();

      await expect(
        verificationMethod.locator('option[value="verified_phone"]')
      ).toHaveCount(0);
      await expect(
        region.getByRole("heading", { name: "提交前檢查" })
      ).toHaveCount(0);
      await expect(verificationMethod).toHaveValue("");
      await expect(acknowledgement).not.toBeChecked();
      await expect(fullName).toHaveValue(correctedName);
      await expect(username).toHaveValue(correctedUsername);
      await expect(email).toHaveValue("");
      await expect(phoneField).toHaveValue(correctedPhone);
      await expect(sharedPhone).not.toBeChecked();
      await expect(region).toContainText(
        `對象：${holder.fullName}（${holder.username}）`
      );
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("efcc.identity-change.operation.v1") ?? "null"
          )
        )
      ).toEqual(orphanReference);
      expect(identityPosts).toBe(0);
      expect(
        await verificationMethod.evaluate(
          (element) =>
            element instanceof HTMLSelectElement &&
            element.validity.valueMissing
        )
      ).toBe(true);

      await region
        .getByRole("button", { exact: true, name: "檢查修正" })
        .click();
      await expect(
        region.getByRole("heading", { name: "提交前檢查" })
      ).toHaveCount(0);
      await verificationMethod.selectOption("face_to_face");
      await acknowledgement.check();
      await region
        .getByRole("button", { exact: true, name: "檢查修正" })
        .click();
      await expect(
        region.getByRole("heading", { name: "提交前檢查" })
      ).toBeVisible();
      await expect(
        region.getByRole("definition").filter({ hasText: "親身核實" })
      ).toBeVisible();
      await expect(
        region.getByText(correctedName, { exact: true })
      ).toBeVisible();
      await expect(
        region.getByText(correctedUsername, { exact: true })
      ).toBeVisible();
      expect(identityPosts).toBe(0);
    } finally {
      await context.close();
    }
  }
);

identityTest(
  "Staff identity review rejects a target that changed before explicit submit",
  async ({ browser, staff, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await staff.storageState(),
    });
    const page = await context.newPage();
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    const correctedName = `陳過時修正${randomBytes(4).toString("hex")}`;
    const correctedUsername = `UI.${randomBytes(5).toString("hex")}`;
    const currentEmail = `current.${randomBytes(5).toString("hex")}@example.com`;
    const reviewedEmail = `review.${randomBytes(5).toString("hex")}@example.com`;
    await region.getByLabel("中文全名", { exact: true }).fill(correctedName);
    await region
      .getByLabel("使用者名稱", { exact: true })
      .fill(correctedUsername);
    await region
      .getByLabel("電郵（沒有電郵可留空）", { exact: true })
      .fill(reviewedEmail);
    await region.getByLabel("修正電話", { exact: true }).fill(phone());
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();

    runLocalSql(
      `UPDATE user SET email='${currentEmail}', email_verified=1 WHERE id='${memberUserId}'`
    );
    await region
      .getByRole("button", { exact: true, name: "確認並提交修正" })
      .click();

    await expect(
      region.getByRole("heading", { name: "修正未提交" })
    ).toBeVisible();
    await expect(region.getByText(currentEmail, { exact: true })).toBeVisible();
    await expect(
      region.getByText(reviewedEmail, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    const [row] = queryLocalSql<{
      name: string;
      username: string;
      email: string;
      email_verified: number;
    }>(
      `SELECT name,username,email,email_verified FROM user WHERE id='${memberUserId}'`
    );
    expect(row).toMatchObject({
      email: currentEmail,
      email_verified: 1,
    });
    expect(row?.name).not.toBe(correctedName);
    expect(row?.username).not.toBe(correctedUsername.toLowerCase());
    expect(
      queryLocalSql<{ id: string }>(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')`
      )
    ).toHaveLength(0);
    await context.close();
  }
);

identityTest(
  "Staff identity work is suppressed when the actor loses management access before submit",
  async ({ browser, staff, staffUserId, memberUserId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.28.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await staff.storageState(),
    });
    const page = await context.newPage();
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=${memberUserId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    await region
      .getByLabel("中文全名", { exact: true })
      .fill(`陳權限變更${randomBytes(4).toString("hex")}`);
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await expect(
      region.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();

    runLocalSql(
      `UPDATE person_profile SET account_role='member' WHERE user_id='${staffUserId}'`
    );
    await region
      .getByRole("button", { exact: true, name: "確認並提交修正" })
      .click();

    await expect(page.getByRole("status")).toContainText(
      "你目前沒有帳戶管理權限"
    );
    await expect(page.getByText(memberUserId, { exact: false })).toHaveCount(0);
    expect(
      queryLocalSql<{ id: string }>(
        `SELECT id FROM audit_event WHERE target_user_id='${memberUserId}' AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')`
      )
    ).toHaveLength(0);
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
    await page.getByRole("link", { exact: true, name: "帳戶安全" }).click();
    await page.getByRole("link", { name: /更改密碼/u }).click();
    await expect(page.getByLabel("目前密碼", { exact: true })).toBeVisible();
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
