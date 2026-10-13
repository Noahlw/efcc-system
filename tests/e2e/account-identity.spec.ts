import { randomInt, randomUUID } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";
import { qualifyPresentation } from "./r11-presentation";

const identityTest = test;
const dedicatedIdentityTest = test.extend<{ caseApp: NativeApp }>({
  caseApp: ({ dedicatedApp }, use) => use(dedicatedApp),
});

const status = async (response: Promise<APIResponse>, expected: number) => {
  const result = await response;
  expect(result.status()).toBe(expected);
  return result;
};

const phone = () => String(randomInt(60_000_000, 70_000_000));

const identity = (targetUserId: string) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
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
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, signedInRequest }) => {
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
          signedInRequest.post(path, {
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
      signedInRequest.post("/api/v2/staff/accounts/restrictions", {
        data: {
          action: "account_banned",
          operationKey: randomUUID(),
          targetUserId: account.userId,
        },
        headers,
      }),
      409
    );
    const rejectedBody = await rejected.json();
    expect(rejectedBody.error.code).toBe("actor_changed");
    const input = { operationKey: randomUUID(), phone: phone() };
    const ownHeaders = { "x-efcc-expected-actor-id": account.userId };
    const created = await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: input,
        headers: ownHeaders,
      }),
      201
    );
    const replayed = await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: input,
        headers: ownHeaders,
      }),
      200
    );
    const replayedBody = await replayed.json();
    const createdBody = await created.json();
    expect(replayedBody.data.receipt.id).toBe(createdBody.data.receipt.id);
    const { results: receipts } = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(account.userId, input.operationKey)
      .all<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipts).toEqual([
      {
        action: "own_phone_changed",
        actor_user_id: account.userId,
        id: createdBody.data.receipt.id,
        target_user_id: account.userId,
      },
    ]);
  }
);

for (const action of ["phone", "revoke-others"] as const) {
  identityTest(
    `stale ${action} page cannot mutate the account signed in by another tab`,
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@account-identity",
        "@risk-auth",
        "@risk-recovery",
      ],
    },
    async ({
      account,
      caseApp,
      extraHTTPHeaders,
      playwright,
      signedInPage: page,
    }) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const other: ProvisionAccount = {
        email: `identity.other.${suffix}@example.com`,
        fullName: `陳另一帳戶${suffix}`,
        membershipStatus: "active",
        password: "Synthetic-identity-password!",
        username: `identity.other.${suffix}`,
      };
      const otherId = await caseApp.provision.account(other);
      const context = page.context();
      await page.goto("/account");
      const isPhone = action === "phone";
      if (isPhone) {
        await page.getByRole("link", { name: "更新聯絡電話" }).click();
      } else {
        await page.getByRole("link", { name: /^帳戶安全/u }).click();
        await page.getByRole("link", { name: /^登出其他裝置/u }).click();
      }
      const region = isPhone
        ? page.getByRole("region", { name: "更改自己的電話" })
        : page.getByRole("main", { name: "帳戶安全操作" });
      const startButton = region.getByRole("button", {
        exact: true,
        name: isPhone ? "檢查電話" : "登出其他裝置",
      });
      await expect(startButton).toBeEnabled();
      const secondPage = await context.newPage();
      await secondPage.goto("/account");
      await secondPage
        .getByRole("button", { exact: true, name: "登出" })
        .click();
      await expect(secondPage).toHaveURL(/\/sign-in$/u);
      await secondPage.getByLabel("Username").fill(other.username);
      await secondPage.getByLabel("密碼", { exact: true }).fill(other.password);
      await secondPage
        .getByRole("button", { exact: true, name: "登入" })
        .click();
      await expect(secondPage).toHaveURL(/\/$/u);
      await expect(
        secondPage.getByText(`歡迎回來，${other.fullName}。`, { exact: true })
      ).toBeVisible();
      const current = await status(
        context.request.get("/api/v2/account/identity"),
        200
      );
      const currentBody = await current.json();
      expect(currentBody.data.identity.actorUserId).toBe(otherId);
      if (!extraHTTPHeaders) {
        throw new Error("Native request headers are unavailable.");
      }
      const primaryIp = extraHTTPHeaders["cf-connecting-ip"];
      if (!primaryIp) {
        throw new Error("The native client address header is unavailable.");
      }
      // A distinct trusted /64 represents the other device and its own limiter bucket.
      const [firstGroup, secondGroup, thirdGroup, lastGroup] =
        primaryIp.split(":");
      if (
        !firstGroup ||
        !secondGroup ||
        !thirdGroup ||
        !lastGroup ||
        !/^[0-9a-f]{4}$/u.test(lastGroup)
      ) {
        throw new Error("Expected a native IPv6 /64 client address.");
      }
      const lastValue = Number.parseInt(lastGroup, 16);
      const nextGroup = ((lastValue + 1) % 65_536)
        .toString(16)
        .padStart(4, "0");
      const secondDeviceIp = `${firstGroup}:${secondGroup}:${thirdGroup}:${nextGroup}::1`;
      expect(secondDeviceIp).not.toBe(primaryIp);
      const secondDevice = await playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: {
          ...extraHTTPHeaders,
          "cf-connecting-ip": secondDeviceIp,
        },
      });
      try {
        const secondDeviceLogin = await status(
          secondDevice.post("/api/auth/sign-in/username", {
            data: { password: other.password, username: other.username },
          }),
          200
        );
        const secondDeviceLoginBody = await secondDeviceLogin.json();
        expect(secondDeviceLoginBody.user.id).toBe(otherId);
      } finally {
        await secondDevice.dispose();
      }

      const { results: before } = await caseApp.db
        .prepare(
          "SELECT id,ip_address FROM session WHERE user_id = ? ORDER BY id"
        )
        .bind(otherId)
        .all<{ id: string; ip_address: string | null }>();
      expect(before).toHaveLength(2);
      expect(new Set(before.map((session) => session.ip_address)).size).toBe(2);
      const draftPhone = isPhone ? phone() : null;
      if (draftPhone) {
        await region.getByLabel("新電話", { exact: true }).fill(draftPhone);
        await startButton.click();
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
      expect(response.request().headers()["x-efcc-expected-actor-id"]).toBe(
        metadata.actorUserId
      );
      expect(response.request().postDataJSON().operationKey).toBe(metadata.key);
      expect(metadata.actorUserId).toBe(account.userId);
      const { results: after } = await caseApp.db
        .prepare(
          "SELECT id,ip_address FROM session WHERE user_id = ? ORDER BY id"
        )
        .bind(otherId)
        .all<{ id: string; ip_address: string | null }>();
      expect(after).toEqual(before);
      const { results: identityOperations } = await caseApp.db
        .prepare(
          "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(account.userId, metadata.key)
        .all<{ id: string }>();
      expect(identityOperations).toHaveLength(0);
      const { results: securityOperations } = await caseApp.db
        .prepare(
          "SELECT id FROM account_security_operation WHERE operation_key = ?"
        )
        .bind(metadata.key)
        .all<{ id: string }>();
      expect(securityOperations).toHaveLength(0);
      const unchanged = await status(
        context.request.get("/api/v2/account/identity"),
        200
      );
      const unchangedBody = await unchanged.json();
      expect(unchangedBody.data.identity.phone).toBeNull();
      await page.goto("/account");
      await page.goBack();
      await expect(
        page.getByText(account.fullName, { exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByText(account.username, { exact: true })
      ).toHaveCount(0);
      await expect(region.getByRole("status")).toContainText("另一帳戶");
      if (draftPhone) {
        await expect(page.getByText(draftPhone, { exact: true })).toHaveCount(
          0
        );
        expect(
          await region
            .locator("input:visible")
            .evaluateAll((inputs) =>
              inputs.map((input) => (input as HTMLInputElement).value)
            )
        ).not.toContain(draftPhone);
      }
      await page.goForward();
      await expect(
        page.getByRole("region", { name: "個人資料" })
      ).toContainText(other.username);
      await expect(
        page.getByText(account.fullName, { exact: true })
      ).toHaveCount(0);
      await secondPage.goto("/account");
      await secondPage
        .getByRole("button", { exact: true, name: "登出" })
        .click();
      await expect(secondPage).toHaveURL(/\/sign-in$/u);
      await secondPage.getByLabel("Username").fill(account.username);
      await secondPage
        .getByLabel("密碼", { exact: true })
        .fill(account.password);
      await secondPage
        .getByRole("button", { exact: true, name: "登入" })
        .click();
      await expect(secondPage).toHaveURL(/\/$/u);
      await page.goBack();
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
    }
  );
}

identityTest(
  "approved holder changes only own unique phone and Staff corrects canonical identity with permanent aliases",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-recovery",
    ],
  },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const ownInput = { operationKey: randomUUID(), phone: phone() };
    const ownChange = await status(
      signedInRequest.post("/api/v2/account/phone", { data: ownInput }),
      201
    );
    const ownChangeBody = await ownChange.json();
    const ownReplay = await status(
      signedInRequest.post("/api/v2/account/phone", { data: ownInput }),
      200
    );
    const ownReplayBody = await ownReplay.json();
    expect(ownReplayBody.data.receipt).toEqual(ownChangeBody.data.receipt);
    await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: { ...ownInput, fullName: "不允許自行改名" },
      }),
      400
    );
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(account.userId)
      .run();
    const input = identity(account.userId);
    const changed = await status(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const changedBody = await changed.json();
    const replay = await status(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(changedBody.data.receipt);
    const row = await caseApp.db
      .prepare(
        "SELECT u.name,u.username,u.display_username,u.email_verified,p.phone,p.name_lookup_key,p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(account.userId)
      .first<{
        display_username: string;
        email_verified: number;
        name: string;
        name_lookup_key: string;
        phone: string;
        username: string;
        verified_recovery_phone: string | null;
      }>();
    expect(row).toMatchObject({
      display_username: input.username,
      email_verified: 0,
      name: input.fullName,
      phone: `+852${input.phone}`,
      username: input.username.toLowerCase(),
      verified_recovery_phone: null,
    });
    expect(row?.name_lookup_key).toContain("a");

    const { results: usernames } = await caseApp.db
      .prepare(
        "SELECT username_key FROM username_reservation WHERE user_id = ? ORDER BY username_key"
      )
      .bind(account.userId)
      .all<{ username_key: string }>();
    expect(usernames).toEqual([
      { username_key: account.username },
      { username_key: input.username.toLowerCase() },
    ]);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    await status(
      staff.context.post("/api/v2/applications", {
        data: {
          email: `duplicate.${suffix}@example.com`,
          fullName: `陳申請${suffix}`,
          operationKey: randomUUID(),
          password: "Synthetic-identity-password!",
          phone: phone(),
          username: account.username,
        },
      }),
      409
    );
    await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: account.userId,
        },
      }),
      403
    );
    await status(
      signedInRequest.post("/api/auth/update-user", {
        data: { name: "forged name" },
      }),
      404
    );
    await status(
      signedInRequest.post("/api/auth/change-email", {
        data: { newEmail: "future@example.com" },
      }),
      404
    );
    const { results: operations } = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,operation_key,target_user_id FROM account_change_operation WHERE target_user_id = ? ORDER BY action"
      )
      .bind(account.userId)
      .all<{
        action: string;
        actor_user_id: string;
        id: string;
        operation_key: string;
        target_user_id: string;
      }>();
    expect(operations).toEqual([
      {
        action: "own_phone_changed",
        actor_user_id: account.userId,
        id: ownChangeBody.data.receipt.id,
        operation_key: ownInput.operationKey,
        target_user_id: account.userId,
      },
      {
        action: "staff_identity_corrected",
        actor_user_id: staff.userId,
        id: changedBody.data.receipt.id,
        operation_key: input.operationKey,
        target_user_id: account.userId,
      },
    ]);
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT action FROM audit_event WHERE target_user_id = ? AND action IN ('own_phone_changed','staff_identity_corrected') ORDER BY action"
      )
      .bind(account.userId)
      .all<{ action: string }>();
    expect(audits).toEqual([
      { action: "own_phone_changed" },
      { action: "staff_identity_corrected" },
    ]);
  }
);

identityTest(
  "a former Username stays unavailable while the corrected Username is case-insensitive",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, request, staff }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const target: ProvisionAccount = {
      email: `identity.alias.${suffix}@example.com`,
      fullName: `陳別名帳戶${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      username: `identity.alias.${suffix}`,
    };
    const targetUserId = await caseApp.provision.account(target);
    const input = identity(targetUserId);
    const corrected = await status(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const correctedBody = await corrected.json();
    await status(
      request.post("/api/auth/sign-in/username", {
        data: { password: target.password, username: target.username },
      }),
      401
    );
    const currentLogin = await status(
      request.post("/api/auth/sign-in/username", {
        data: {
          password: target.password,
          username: input.username.toUpperCase(),
        },
      }),
      200
    );
    const currentLoginBody = await currentLogin.json();
    expect(currentLoginBody.user.id).toBe(targetUserId);
    const { results: usernames } = await caseApp.db
      .prepare(
        "SELECT username_key FROM username_reservation WHERE user_id = ? ORDER BY username_key"
      )
      .bind(targetUserId)
      .all<{ username_key: string }>();
    expect(usernames).toEqual([
      { username_key: target.username },
      { username_key: input.username.toLowerCase() },
    ]);
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, input.operationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toEqual({
      action: "staff_identity_corrected",
      actor_user_id: staff.userId,
      id: correctedBody.data.receipt.id,
      target_user_id: targetUserId,
    });
  }
);

dedicatedIdentityTest(
  "shared-phone Staff exception is audited without turning an edited contact into recovery proof",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
      "@risk-atomicity",
    ],
  },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const other: ProvisionAccount = {
      email: `identity.shared.${suffix}@example.com`,
      fullName: `陳共用電話${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      username: `identity.shared.${suffix}`,
    };
    const otherId = await caseApp.provision.account(other);
    const sharedPhone = phone();
    await caseApp.db
      .prepare("UPDATE person_profile SET phone = ? WHERE user_id = ?")
      .bind(`+852${sharedPhone}`, otherId)
      .run();
    await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: { operationKey: randomUUID(), phone: sharedPhone },
      }),
      409
    );
    const input = {
      ...identity(account.userId),
      phone: sharedPhone,
      sharedPhone: true,
    };
    const response = await status(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const body = await response.json();
    expect(body.data.receipt.action).toBe("staff_shared_phone_corrected");
    const profile = await caseApp.db
      .prepare(
        "SELECT phone,phone_shared,verified_recovery_phone FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first<{
        phone: string;
        phone_shared: number;
        verified_recovery_phone: string | null;
      }>();
    expect(profile).toEqual({
      phone: `+852${sharedPhone}`,
      phone_shared: 1,
      verified_recovery_phone: null,
    });
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, input.operationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toEqual({
      action: "staff_shared_phone_corrected",
      actor_user_id: staff.userId,
      id: body.data.receipt.id,
      target_user_id: account.userId,
    });
    await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: account.userId,
        },
      }),
      403
    );
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: {
          ...input,
          operationKey: randomUUID(),
          verifiedRecoveryPhone: sharedPhone,
        },
      }),
      400
    );
    await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: { operationKey: randomUUID(), phone: phone() },
      }),
      201
    );
    const updatedProfile = await caseApp.db
      .prepare(
        "SELECT phone_shared,verified_recovery_phone FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first<{
        phone_shared: number;
        verified_recovery_phone: string | null;
      }>();
    expect(updatedProfile).toEqual({
      phone_shared: 0,
      verified_recovery_phone: null,
    });
  }
);

for (const table of [
  "user",
  "person_profile",
  "username_reservation",
  "audit_event",
  "account_change_operation",
] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    dedicatedIdentityTest(
      `Staff identity ${table} ${fault} rolls back every required identity and audit effect`,
      {
        tag: [
          "@native",
          "@http",
          "@account-identity",
          "@risk-atomicity",
          "@risk-recovery",
        ],
      },
      async ({ account, caseApp, staff }) => {
        const input = identity(account.userId);
        const trigger = `fault_identity_${table}_${fault}`;
        const event =
          table === "user" || table === "person_profile" ? "UPDATE" : "INSERT";
        const condition: Record<typeof table, string> = {
          account_change_operation: `NEW.target_user_id='${account.userId}' AND NEW.action='staff_identity_corrected'`,
          audit_event: `NEW.target_user_id='${account.userId}' AND NEW.action='staff_identity_corrected'`,
          person_profile: `NEW.user_id='${account.userId}'`,
          user: `NEW.id='${account.userId}'`,
          username_reservation: `NEW.user_id='${account.userId}' AND NEW.username_key='${input.username.toLowerCase()}'`,
        };
        const previousPhone = `+852${phone()}`;
        await caseApp.db
          .prepare("UPDATE person_profile SET phone = ? WHERE user_id = ?")
          .bind(previousPhone, account.userId)
          .run();
        await caseApp.db
          .prepare(
            `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition[table]} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic identity fault'" : ""}); END`
          )
          .run();
        try {
          const response = await status(
            staff.context.post("/api/v2/staff/accounts/identity", {
              data: input,
            }),
            500
          );
          expect(await response.text()).not.toContain(
            "Synthetic identity fault"
          );
        } finally {
          await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
        }
        const user = await caseApp.db
          .prepare("SELECT name,email,username FROM user WHERE id = ?")
          .bind(account.userId)
          .first<{ email: string; name: string; username: string }>();
        expect(user).toEqual({
          email: account.email,
          name: account.fullName,
          username: account.username,
        });
        const profile = await caseApp.db
          .prepare("SELECT phone FROM person_profile WHERE user_id = ?")
          .bind(account.userId)
          .first<{ phone: string | null }>();
        expect(profile).toEqual({ phone: previousPhone });
        const { results: usernameReservations } = await caseApp.db
          .prepare(
            "SELECT username_key FROM username_reservation WHERE user_id = ? AND username_key = ?"
          )
          .bind(account.userId, input.username.toLowerCase())
          .all<{ username_key: string }>();
        expect(usernameReservations).toHaveLength(0);
        const { results: audits } = await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
          )
          .bind(account.userId)
          .all<{ id: string }>();
        expect(audits).toHaveLength(0);
        const { results: operations } = await caseApp.db
          .prepare(
            "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, input.operationKey)
          .all<{ id: string }>();
        expect(operations).toHaveLength(0);
        const reconciliation = await status(
          staff.context.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const reconciliationBody = await reconciliation.json();
        expect(reconciliationBody.data.receipt).toBeNull();
        const retried = await status(
          staff.context.post("/api/v2/staff/accounts/identity", {
            data: input,
          }),
          201
        );
        const retryBody = await retried.json();
        const committed = await caseApp.db
          .prepare(
            "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, input.operationKey)
          .first<{
            action: string;
            actor_user_id: string;
            id: string;
            target_user_id: string;
          }>();
        expect(committed).toEqual({
          action: "staff_identity_corrected",
          actor_user_id: staff.userId,
          id: retryBody.data.receipt.id,
          target_user_id: account.userId,
        });
        const { results: committedAudits } = await caseApp.db
          .prepare(
            "SELECT action FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
          )
          .bind(account.userId)
          .all<{ action: string }>();
        expect(committedAudits).toEqual([
          { action: "staff_identity_corrected" },
        ]);
      }
    );
  }
}

dedicatedIdentityTest(
  "competing identity claims and same-operation retries retain exactly one authoritative effect",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-atomicity",
      "@risk-recovery",
    ],
  },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const input = identity(account.userId);
    const results = await Promise.all([
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    const bodies = await Promise.all(
      results.map((response) => response.json())
    );
    expect(bodies[0]?.data.receipt).toEqual(bodies[1]?.data.receipt);
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, input.operationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toEqual({
      action: "staff_identity_corrected",
      actor_user_id: staff.userId,
      id: bodies[0]?.data.receipt.id,
      target_user_id: account.userId,
    });
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(1);
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: { ...input, phone: phone() },
      }),
      409
    );
    const ownKey = randomUUID();
    const ownPhone = await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: { operationKey: ownKey, phone: phone() },
      }),
      201
    );
    const ownPhoneBody = await ownPhone.json();
    const foreign = await status(
      staff.context.post("/api/v2/account/changes/reconcile", {
        data: { operationKey: ownKey },
      }),
      200
    );
    const foreignBody = await foreign.json();
    expect(foreignBody.data.receipt).toBeNull();
    const ownReceipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(account.userId, ownKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(ownReceipt).toEqual({
      action: "own_phone_changed",
      actor_user_id: account.userId,
      id: ownPhoneBody.data.receipt.id,
      target_user_id: account.userId,
    });
    // A reserved old Username remains unavailable even to its original Account.
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: {
          ...input,
          operationKey: randomUUID(),
          username: account.username,
        },
      }),
      409
    );
  }
);

identityTest(
  "fixed Staff targets, stale confirmation and pre-existing verified phone policy remain authoritative",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, staff }) => {
    const selfResponse = await status(
      staff.context.get("/api/v2/account/identity"),
      200
    );
    const selfBody = await selfResponse.json();
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: identity(selfBody.data.identity.actorUserId),
      }),
      403
    );
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const privilegedId = await caseApp.provision.account({
      email: `identity.privileged.${suffix}@example.com`,
      fullName: `陳權限帳戶${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      role: "staff",
      username: `identity.privileged.${suffix}`,
    });
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: identity(privilegedId),
      }),
      403
    );
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'admin' WHERE user_id = ?"
      )
      .bind(privilegedId)
      .run();
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: identity(privilegedId),
      }),
      403
    );
    const input = identity(account.userId);
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: { ...input, identityCheck: "verified_phone" },
      }),
      403
    );
    const verified = `+852${phone()}`;
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET verified_recovery_phone = ? WHERE user_id = ?"
      )
      .bind(verified, account.userId)
      .run();
    const corrected = await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: { ...input, identityCheck: "verified_phone" },
      }),
      201
    );
    const correctedBody = await corrected.json();
    const profile = await caseApp.db
      .prepare(
        "SELECT phone,verified_recovery_phone FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first<{
        phone: string | null;
        verified_recovery_phone: string | null;
      }>();
    expect(profile).toEqual({
      phone: `+852${input.phone}`,
      verified_recovery_phone: verified,
    });
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, input.operationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toEqual({
      action: "staff_identity_corrected",
      actor_user_id: staff.userId,
      id: correctedBody.data.receipt.id,
      target_user_id: account.userId,
    });
    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const staleInput = identity(account.userId);
    await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: staleInput,
      }),
      403
    );
    const { results: staleOperations } = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, staleInput.operationKey)
      .all<{ id: string }>();
    expect(staleOperations).toHaveLength(0);
  }
);

dedicatedIdentityTest(
  "competing unique phone changes cannot claim the same number for two accounts",
  {
    tag: ["@native", "@http", "@account-identity", "@risk-atomicity"],
  },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const other: ProvisionAccount = {
      email: `identity.race.${suffix}@example.com`,
      fullName: `陳電話競爭${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      username: `identity.race.${suffix}`,
    };
    const targetUserId = await caseApp.provision.account(other);
    const shared = phone();
    const ownInput = { operationKey: randomUUID(), phone: shared };
    const staffInput = { ...identity(targetUserId), phone: shared };
    const results = await Promise.all([
      signedInRequest.post("/api/v2/account/phone", { data: ownInput }),
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: staffInput,
      }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      201, 409,
    ]);
    const ownOperations = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(account.userId, ownInput.operationKey)
      .all<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    const staffOperations = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, staffInput.operationKey)
      .all<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    const { results: owners } = await caseApp.db
      .prepare("SELECT user_id FROM person_profile WHERE phone = ?")
      .bind(`+852${shared}`)
      .all<{ user_id: string }>();
    expect(owners).toHaveLength(1);
    expect(ownOperations.results.length + staffOperations.results.length).toBe(
      1
    );
    const ownWon = ownOperations.results.length === 1;
    expect(owners[0]?.user_id).toBe(ownWon ? account.userId : targetUserId);
    const winningResponse = ownWon ? results[0] : results[1];
    const winningBody = await winningResponse?.json();
    expect(
      ownWon ? ownOperations.results[0]?.id : staffOperations.results[0]?.id
    ).toBe(winningBody.data.receipt.id);
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT target_user_id,action FROM audit_event WHERE target_user_id IN (?,?) AND action IN ('own_phone_changed','staff_identity_corrected')"
      )
      .bind(account.userId, targetUserId)
      .all<{ action: string; target_user_id: string }>();
    expect(audits).toEqual([
      ownWon
        ? { action: "own_phone_changed", target_user_id: account.userId }
        : { action: "staff_identity_corrected", target_user_id: targetUserId },
    ]);
  }
);

dedicatedIdentityTest(
  "canonical duplicate-name correction remains ambiguous and email placeholder replacement stays unverified",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const other: ProvisionAccount = {
      email: `identity.duplicate.${suffix}@example.com`,
      fullName: `陳同名帳戶${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      username: `identity.duplicate.${suffix}`,
    };
    await caseApp.provision.account(other);
    const canonicalLogin = await status(
      signedInRequest.post("/api/auth/sign-in/name", {
        data: { fullName: account.fullName, password: account.password },
      }),
      200
    );
    const canonicalLoginBody = await canonicalLogin.json();
    expect(canonicalLoginBody.user.id).toBe(account.userId);

    const input = {
      ...identity(account.userId),
      email: null,
      fullName: other.fullName,
    };
    const corrected = await status(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const correctedBody = await corrected.json();
    const user = await caseApp.db
      .prepare("SELECT email,email_verified FROM user WHERE id = ?")
      .bind(account.userId)
      .first<{ email: string; email_verified: number }>();
    expect(user?.email).toMatch(/@accounts\.efcc\.invalid$/u);
    expect(user?.email_verified).toBe(0);
    const ambiguous = await status(
      signedInRequest.post("/api/auth/sign-in/name", {
        data: { fullName: other.fullName, password: account.password },
      }),
      409
    );
    const body = await ambiguous.json();
    expect(body.code).toBe("NAME_AMBIGUOUS");
    expect(JSON.stringify(body)).not.toContain(other.username);
    const replacementInput = {
      ...input,
      email: `replacement.${suffix}@example.com`,
      operationKey: randomUUID(),
    };
    const replaced = await status(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: replacementInput,
      }),
      201
    );
    const replacedBody = await replaced.json();
    const replacedUser = await caseApp.db
      .prepare("SELECT email,email_verified FROM user WHERE id = ?")
      .bind(account.userId)
      .first<{ email: string; email_verified: number }>();
    expect(replacedUser).toEqual({
      email: replacementInput.email,
      email_verified: 0,
    });
    const firstReceipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, input.operationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    const secondReceipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, replacementInput.operationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(firstReceipt?.id).toBe(correctedBody.data.receipt.id);
    expect(secondReceipt?.id).toBe(replacedBody.data.receipt.id);
  }
);

identityTest(
  "own-phone task reviews the contact change and recovers a committed lost response",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, signedInPage: page }) => {
    await page.goto("/account");
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
    await region.getByRole("link", { name: "返回帳戶" }).click();
    const leaveDialog = page.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(phoneField).toHaveValue(replacement);
    await region.getByRole("link", { name: "返回帳戶" }).click();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    await page.getByRole("link", { name: "更新聯絡電話" }).click();
    await phoneField.fill(replacement);
    await region
      .getByRole("button", {
        exact: true,
        name: "檢查電話",
      })
      .click();
    const draftFields = region.locator('input:not([type="hidden"]), textarea');
    await qualifyPresentation(page, test.info(), "own-phone-review", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "確認並儲存電話",
      }),
      drafts: draftFields,
    });
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
    expect(metadata.actorUserId).toBe(account.userId);
    expect(metadata.targetUserId).toBe(account.userId);
    expect(JSON.stringify(metadata)).not.toContain(replacement);
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    await page.getByRole("button", { name: "完成，返回帳戶" }).click();
    await expect(page).toHaveURL(`${caseApp.origin}/account`);
    await expect(
      page.getByText(`+852${replacement}`, { exact: true })
    ).toBeVisible();
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(account.userId, metadata.key)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toMatchObject({
      action: "own_phone_changed",
      actor_user_id: account.userId,
      target_user_id: account.userId,
    });
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'own_phone_changed'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
);

identityTest(
  "Staff identity review preserves empty and false edits through verification and password confirmation",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, page, staff }) => {
    const existingVerifiedPhone = `+852${phone()}`;
    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(account.userId)
      .run();
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET phone_shared = 1, verified_recovery_phone = ? WHERE user_id = ?"
      )
      .bind(existingVerifiedPhone, account.userId)
      .run();
    const staffState = await staff.context.storageState();
    await page.context().addCookies(staffState.cookies);
    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    const correctedName = `陳實際修正${randomUUID().slice(0, 8)}`;
    const correctedUsername = `UI.${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const correctedPhone = phone();
    await region.getByLabel("中文全名", { exact: true }).fill(correctedName);
    await region
      .getByLabel("使用者名稱", { exact: true })
      .fill(correctedUsername);
    await region.getByLabel("電郵（沒有電郵可留空）", { exact: true }).fill("");
    await region.getByLabel("修正電話", { exact: true }).fill(correctedPhone);
    await region.getByLabel("已核實共用電話例外").uncheck();
    await region.locator('input[type="radio"][value="verified_phone"]').check();
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
    const draftFields = region.locator('input:not([type="hidden"]), textarea');
    await qualifyPresentation(page, test.info(), "identity-review", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "確認目前密碼",
      }),
      drafts: draftFields,
      focus: region.getByRole("button", { name: "確認目前密碼" }),
    });
    let identityPosts = 0;
    let submittedOperationKey: string | null = null;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/identity")
      ) {
        identityPosts += 1;
        submittedOperationKey = request.postDataJSON().operationKey;
      }
    });
    const { results: confirmationsBefore } = await caseApp.db
      .prepare(
        "SELECT id FROM account_security_operation WHERE user_id = ? AND action = 'password_confirmed' ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string }>();
    const { results: sessionsBefore } = await caseApp.db
      .prepare(
        "SELECT id,password_confirmed_at FROM session WHERE user_id = ? ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string; password_confirmed_at: number | null }>();
    await region.getByRole("button", { name: "確認目前密碼" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const currentPassword = dialog.getByLabel("目前密碼", { exact: true });
    await currentPassword.fill("Wrong-password!");
    const wrongConfirmation = page.waitForResponse((response) =>
      response.url().endsWith("/api/v2/account/password-confirmation")
    );
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    const wrongResponse = await wrongConfirmation;
    expect(wrongResponse.status()).toBe(400);
    expect(await wrongResponse.json()).toMatchObject({
      error: { code: "invalid_password" },
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "目前密碼未獲接受，確認未完成"
    );
    await expect(dialog.getByRole("alert")).toContainText(
      "請檢查目前登入帳戶的密碼"
    );
    await qualifyPresentation(page, test.info(), "confirm-error", {
      criticalAction: dialog.getByRole("button", {
        exact: true,
        name: "確認並返回檢查",
      }),
      drafts: draftFields,
      focus: currentPassword,
    });
    expect(identityPosts).toBe(0);
    const { results: confirmationsAfterInvalidPassword } = await caseApp.db
      .prepare(
        "SELECT id FROM account_security_operation WHERE user_id = ? AND action = 'password_confirmed' ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string }>();
    const { results: sessionsAfterInvalidPassword } = await caseApp.db
      .prepare(
        "SELECT id,password_confirmed_at FROM session WHERE user_id = ? ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string; password_confirmed_at: number | null }>();
    expect(confirmationsAfterInvalidPassword).toEqual(confirmationsBefore);
    expect(sessionsAfterInvalidPassword).toEqual(sessionsBefore);
    const { results: auditsAfterInvalidPassword } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(auditsAfterInvalidPassword).toHaveLength(0);
    const security = await status(
      page.context().request.get("/api/v2/account/security"),
      200
    );
    const securityBody = await security.json();
    expect(securityBody.data.state.passwordConfirmationExpiresAt).toBeNull();
    await currentPassword.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "返回原工作" })
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(currentPassword).toBeFocused();
    await dialog.getByRole("button", { name: "返回原工作" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      region.getByRole("button", { name: "確認目前密碼" })
    ).toBeFocused();

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
      region.getByRole("button", { name: "確認目前密碼" })
    ).toBeFocused();

    await region.getByRole("button", { name: "確認目前密碼" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog).toBeHidden();
    const submitButton = region.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await qualifyPresentation(page, test.info(), "identity-confirmed-review", {
      criticalAction: submitButton,
      drafts: draftFields,
      focus: submitButton,
    });
    expect(identityPosts).toBe(0);
    const { results: auditsBeforeSubmit } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(auditsBeforeSubmit).toHaveLength(0);
    await submitButton.click();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    expect(identityPosts).toBe(1);
    if (!submittedOperationKey) {
      throw new Error("Staff identity submit did not carry an operation key.");
    }
    const changed = await caseApp.db
      .prepare(
        "SELECT u.email,u.email_verified,p.phone,p.phone_shared,p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(account.userId)
      .first<{
        email: string;
        email_verified: number;
        phone: string | null;
        phone_shared: number;
        verified_recovery_phone: string | null;
      }>();
    expect(changed).toMatchObject({
      email_verified: 0,
      phone: `+852${correctedPhone}`,
      phone_shared: 0,
      verified_recovery_phone: existingVerifiedPhone,
    });
    expect(changed?.email).toMatch(/@accounts\.efcc\.invalid$/u);
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, submittedOperationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toMatchObject({
      action: "staff_identity_corrected",
      actor_user_id: staff.userId,
      target_user_id: account.userId,
    });
    const detailsNavigation = page.waitForURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("view") === "people" &&
        url.searchParams.get("person") === account.userId
    );
    await region.getByRole("button", { name: "返回帳戶詳情" }).click();
    await detailsNavigation;
    await expect(page.getByRole("region", { name: "帳戶詳情" })).toBeVisible();
    const listNavigation = page.waitForURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("view") === "people" &&
        !url.searchParams.has("person")
    );
    await page.getByRole("link", { name: "返回帳戶列表" }).click();
    await listNavigation;
    const auditNavigation = page.waitForURL(
      (url) => url.pathname === "/staff/account-audit"
    );
    await page
      .getByRole("navigation", { name: "管理工作" })
      .getByRole("link", { exact: true, name: "紀錄" })
      .click();
    await auditNavigation;
    const identityAudit = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .first<{ id: string }>();
    await expect(
      page.locator(`a[href="/staff/account-audit?record=${identityAudit?.id}"]`)
    ).toBeVisible();
  }
);

identityTest(
  "Staff identity refresh clears an unavailable method without losing its draft or unresolved reference",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, page, staff }) => {
    const orphanReference = {
      action: "staff_identity_corrected" as const,
      actorUserId: staff.userId,
      key: randomUUID(),
      targetUserId: account.userId,
    };
    const existingVerifiedPhone = `+852${phone()}`;
    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET phone_shared = 1, verified_recovery_phone = ? WHERE user_id = ?"
      )
      .bind(existingVerifiedPhone, account.userId)
      .run();
    const staffState = await staff.context.storageState();
    await page.context().addCookies(staffState.cookies);
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
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", {
      name: "職員核實修正身分資料",
    });
    await expect(region.getByRole("status")).toContainText("尚未找到完成紀錄");

    const correctedName = `陳保留草稿${randomUUID().slice(0, 8)}`;
    const correctedUsername = `UI.${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const correctedPhone = phone();
    const fullName = region.getByLabel("中文全名", { exact: true });
    const username = region.getByLabel("使用者名稱", { exact: true });
    const email = region.getByLabel("電郵（沒有電郵可留空）", {
      exact: true,
    });
    const phoneField = region.getByLabel("修正電話", { exact: true });
    const sharedPhone = region.getByLabel("已核實共用電話例外");
    const verificationMethod = region.getByRole("radiogroup", {
      exact: true,
      name: "身分核實方式",
    });
    const acknowledgement = region.getByLabel(
      "已按以上方式核實本人，新聯絡資料沒有用作復原憑證",
      { exact: true }
    );
    const draftFields = region.locator('input:not([type="hidden"]), textarea');

    await fullName.fill(correctedName);
    await username.fill(correctedUsername);
    await email.fill("");
    await phoneField.fill(correctedPhone);
    await sharedPhone.uncheck();
    await verificationMethod.locator('input[value="verified_phone"]').check();
    await acknowledgement.check();
    await qualifyPresentation(page, test.info(), "identity-edit-draft", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "檢查修正",
      }),
      drafts: draftFields,
      focus: fullName,
    });
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await expect(
      region.getByText("透過原有已核實電話主動聯絡", { exact: true })
    ).toBeVisible();

    await caseApp.db
      .prepare(
        "UPDATE person_profile SET verified_recovery_phone = NULL WHERE user_id = ?"
      )
      .bind(account.userId)
      .run();
    await region
      .getByRole("button", { exact: true, name: "確認目前密碼" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();

    await expect(
      verificationMethod.locator('input[value="verified_phone"]')
    ).toBeDisabled();
    await expect(verificationMethod.locator("input:checked")).toHaveCount(0);
    await expect(acknowledgement).not.toBeChecked();
    await expect(fullName).toHaveValue(correctedName);
    await expect(username).toHaveValue(correctedUsername);
    await expect(email).toHaveValue("");
    await expect(phoneField).toHaveValue(correctedPhone);
    await expect(sharedPhone).not.toBeChecked();
    const originalTarget = region.getByRole("region", { name: "操作對象" });
    await expect(originalTarget).toContainText(account.fullName);
    await expect(originalTarget).toContainText(account.username);
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.identity-change.operation.v1") ?? "null"
        )
      )
    ).toEqual(orphanReference);
    expect(identityPosts).toBe(0);
    await qualifyPresentation(page, test.info(), "identity-refresh-draft", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "檢查修正",
      }),
      drafts: draftFields,
      focus: fullName,
    });

    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await verificationMethod.locator('input[value="face_to_face"]').check();
    await acknowledgement.check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();

    await expect(
      region.getByRole("definition").filter({ hasText: "親身核實" })
    ).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    await qualifyPresentation(page, test.info(), "identity-reverified-review", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "確認並提交修正",
      }),
      drafts: draftFields,
    });
    expect(identityPosts).toBe(0);
  }
);

identityTest(
  "Staff identity review rejects a target that changed before explicit submit",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, page, staff }) => {
    const staffState = await staff.context.storageState();
    await page.context().addCookies(staffState.cookies);
    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    const correctedName = `陳過時修正${randomUUID().slice(0, 8)}`;
    const correctedUsername = `UI.${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const currentEmail = `current.${randomUUID().slice(0, 8)}@example.com`;
    const reviewedEmail = `review.${randomUUID().slice(0, 8)}@example.com`;
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
    const submitButton = region.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await qualifyPresentation(page, test.info(), "identity-stale-review", {
      criticalAction: submitButton,
      drafts: region.locator('input:not([type="hidden"]), textarea'),
    });

    await caseApp.db
      .prepare("UPDATE user SET email = ?, email_verified = 1 WHERE id = ?")
      .bind(currentEmail, account.userId)
      .run();
    await submitButton.click();

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
    const user = await caseApp.db
      .prepare(
        "SELECT name,username,email,email_verified FROM user WHERE id = ?"
      )
      .bind(account.userId)
      .first<{
        email: string;
        email_verified: number;
        name: string;
        username: string;
      }>();
    expect(user).toMatchObject({
      email: currentEmail,
      email_verified: 1,
      name: account.fullName,
      username: account.username,
    });
    expect(user?.name).not.toBe(correctedName);
    expect(user?.username).not.toBe(correctedUsername.toLowerCase());
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(0);
    const { results: operations } = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE target_user_id = ? AND actor_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId, staff.userId)
      .all<{ id: string }>();
    expect(operations).toHaveLength(0);
  }
);

identityTest(
  "Staff identity work is suppressed when the actor loses management access before submit",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, page, staff }) => {
    const staffState = await staff.context.storageState();
    await page.context().addCookies(staffState.cookies);
    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    await region
      .getByLabel("中文全名", { exact: true })
      .fill(`陳權限變更${randomUUID().slice(0, 8)}`);
    await region.getByLabel("修正電話", { exact: true }).fill(phone());
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    const submitButton = region.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await qualifyPresentation(page, test.info(), "identity-access-review", {
      criticalAction: submitButton,
      drafts: region.locator('input:not([type="hidden"]), textarea'),
    });

    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    let identityCommands = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/accounts/identity")
      ) {
        identityCommands += 1;
      }
    });
    await submitButton.click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(account.userId, { exact: false })).toHaveCount(
      0
    );
    expect(identityCommands).toBe(0);
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(0);
    const { results: operations } = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE target_user_id = ? AND actor_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId, staff.userId)
      .all<{ id: string }>();
    expect(operations).toHaveLength(0);
  }
);

for (const table of [
  "person_profile",
  "audit_event",
  "account_change_operation",
] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    dedicatedIdentityTest(
      `own phone ${table} ${fault} preserves contact and audit until a matching retry`,
      {
        tag: [
          "@native",
          "@http",
          "@account-identity",
          "@risk-atomicity",
          "@risk-recovery",
        ],
      },
      async ({ account, caseApp, signedInRequest }) => {
        const input = { operationKey: randomUUID(), phone: phone() };
        const trigger = `fault_own_phone_${table}_${fault}`;
        const event = table === "person_profile" ? "UPDATE" : "INSERT";
        const condition =
          table === "person_profile"
            ? `NEW.user_id='${account.userId}'`
            : `NEW.target_user_id='${account.userId}' AND NEW.action='own_phone_changed'`;
        const previousPhone = `+852${phone()}`;
        await caseApp.db
          .prepare("UPDATE person_profile SET phone = ? WHERE user_id = ?")
          .bind(previousPhone, account.userId)
          .run();
        await caseApp.db
          .prepare(
            `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic own phone fault'" : ""}); END`
          )
          .run();
        try {
          await status(
            signedInRequest.post("/api/v2/account/phone", { data: input }),
            500
          );
        } finally {
          await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
        }
        const profile = await caseApp.db
          .prepare("SELECT phone FROM person_profile WHERE user_id = ?")
          .bind(account.userId)
          .first<{ phone: string | null }>();
        expect(profile).toEqual({ phone: previousPhone });
        const { results: audits } = await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'own_phone_changed'"
          )
          .bind(account.userId)
          .all<{ id: string }>();
        expect(audits).toHaveLength(0);
        const { results: operations } = await caseApp.db
          .prepare(
            "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(account.userId, input.operationKey)
          .all<{ id: string }>();
        expect(operations).toHaveLength(0);
        const reconciliation = await status(
          signedInRequest.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const reconciliationBody = await reconciliation.json();
        expect(reconciliationBody.data.receipt).toBeNull();
        const retried = await status(
          signedInRequest.post("/api/v2/account/phone", { data: input }),
          201
        );
        const retryBody = await retried.json();
        const receipt = await caseApp.db
          .prepare(
            "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(account.userId, input.operationKey)
          .first<{
            action: string;
            actor_user_id: string;
            id: string;
            target_user_id: string;
          }>();
        expect(receipt).toEqual({
          action: "own_phone_changed",
          actor_user_id: account.userId,
          id: retryBody.data.receipt.id,
          target_user_id: account.userId,
        });
        const { results: committedAudits } = await caseApp.db
          .prepare(
            "SELECT action FROM audit_event WHERE target_user_id = ? AND action = 'own_phone_changed'"
          )
          .bind(account.userId)
          .all<{ action: string }>();
        expect(committedAudits).toEqual([{ action: "own_phone_changed" }]);
      }
    );
  }
}

identityTest(
  "own identity data and operation metadata do not expose another account or accept foreign origins",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, signedInRequest }) => {
    const input = { operationKey: randomUUID(), phone: phone() };
    await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: input,
        headers: { origin: "https://foreign.example" },
      }),
      403
    );
    await status(
      signedInRequest.post("/api/v2/account/phone", {
        data: { ...input, targetUserId: randomUUID() },
      }),
      400
    );
    const read = await status(
      signedInRequest.get("/api/v2/account/identity", {
        headers: { "x-efcc-user-id": randomUUID() },
      }),
      200
    );
    const body = await read.json();
    expect(body.data.identity.actorUserId).toBe(account.userId);
    expect(read.headers()["cache-control"]).toContain("no-store");
    const { results: operations } = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(account.userId, input.operationKey)
      .all<{ id: string }>();
    expect(operations).toHaveLength(0);
  }
);

identityTest(
  "an incomplete profile does not block existing own-password controls",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
    ],
  },
  async ({ account, caseApp, signedInPage: page, signedInRequest }) => {
    await caseApp.db
      .prepare("DELETE FROM person_profile WHERE user_id = ?")
      .bind(account.userId)
      .run();
    await page.goto("/account");
    await page.getByRole("link", { name: /^帳戶安全/u }).click();
    await page.getByRole("link", { name: /更改密碼/u }).click();
    await expect(page.getByLabel("目前密碼", { exact: true })).toBeVisible();
    await status(
      signedInRequest.post("/api/v2/account/password", {
        data: {
          currentPassword: account.password,
          newPassword: "Synthetic-incomplete-profile-change!",
          operationKey: randomUUID(),
        },
      }),
      201
    );
  }
);
