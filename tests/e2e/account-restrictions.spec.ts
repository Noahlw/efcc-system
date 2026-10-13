import { randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse, Locator } from "@playwright/test";

import type { RestrictionAction } from "@/features/account/restriction-contract";

import { expect, test } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";
import { qualifyPresentation } from "./r11-presentation";

type NativeAccount = ProvisionAccount & { userId: string };
type AdminPair = readonly [NativeAccount, NativeAccount];

const status = async (request: Promise<APIResponse>, expected: number) => {
  const response = await request;
  expect(response.status()).toBe(expected);
  return response;
};
const command = (targetUserId: string, action: RestrictionAction) => ({
  action,
  operationKey: randomUUID(),
  targetUserId,
});
const beginRestrictionReview = async (region: Locator, action: string) => {
  await region.getByRole("button", { exact: true, name: action }).click();
  await expect(
    region.getByRole("region", { exact: true, name: `核對${action}` })
  ).toBeVisible();
  return region.getByRole("button", {
    exact: true,
    name: `確認並${action}`,
  });
};
const administrator = (prefix: string): ProvisionAccount => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  return {
    email: `${prefix}.${suffix}@example.com`,
    fullName: `陳管理員${suffix}`,
    membershipStatus: "active",
    password: "Synthetic-native-password!",
    role: "admin",
    username: `native.${suffix}`,
  };
};

const adminTargetTest = test.extend<{ adminTarget: NativeAccount }>({
  adminTarget: async ({ caseApp }, use) => {
    const account = administrator("restriction-target");
    await use({
      ...account,
      userId: await caseApp.provision.account(account),
    });
  },
});
const isolatedTest = test.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

isolatedTest(
  "@native @browser @mobile-critical @risk-recovery definitive Staff conflict recovers after reload and permits a new restriction",
  async ({ browser, caseApp, extraHTTPHeaders, staff, account }) => {
    const context = await browser.newContext({
      extraHTTPHeaders,
      storageState: await staff.context.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
      );
      const region = page.getByRole("region", { name: "會籍與安全限制" });
      await expect(
        region.getByRole("button", { exact: true, name: "停用會籍" })
      ).toBeEnabled();
      const confirmDeactivation = await beginRestrictionReview(
        region,
        "停用會籍"
      );
      const competing = command(account.userId, "membership_deactivated");
      await status(
        staff.context.post("/api/v2/staff/accounts/restrictions", {
          data: competing,
        }),
        201
      );
      expect(
        await caseApp.db
          .prepare(
            "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, competing.operationKey)
          .first()
      ).toEqual({
        action: competing.action,
        actor_user_id: staff.userId,
        operation_key: competing.operationKey,
        target_user_id: account.userId,
      });
      const requestPromise = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      const responsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      await confirmDeactivation.click();
      const [request, response] = await Promise.all([
        requestPromise,
        responsePromise,
      ]);
      expect(response.status()).toBe(409);
      expect(request.postDataJSON()).toMatchObject({
        action: "membership_deactivated",
        targetUserId: account.userId,
      });
      expect(request.postDataJSON().operationKey).not.toBe(
        competing.operationKey
      );
      expect(request.headers()["x-efcc-expected-actor-id"]).toBe(staff.userId);
      await expect(region.getByRole("status")).toContainText("未完成");
      const metadata = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
        )
      );
      expect(metadata).toMatchObject({
        action: "membership_deactivated",
        actorUserId: staff.userId,
        key: request.postDataJSON().operationKey,
        rejected: true,
        targetUserId: account.userId,
      });
      expect(
        await caseApp.db
          .prepare(
            "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, request.postDataJSON().operationKey)
          .first()
      ).toBeNull();
      await page.reload();
      await expect(region.getByRole("status")).toContainText("未完成");
      await region
        .getByRole("button", {
          exact: true,
          name: "操作未完成，開始另一項操作",
        })
        .click();
      const confirmReactivation = await beginRestrictionReview(
        region,
        "重新啟用會籍"
      );
      const reactivationRequestPromise = page.waitForRequest(
        (next) =>
          next.method() === "POST" &&
          next.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      const reactivationResponsePromise = page.waitForResponse((next) =>
        next.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      await confirmReactivation.click();
      const [reactivationRequest, reactivationResponse] = await Promise.all([
        reactivationRequestPromise,
        reactivationResponsePromise,
      ]);
      expect(reactivationResponse.status()).toBe(201);
      expect(reactivationRequest.postDataJSON()).toMatchObject({
        action: "membership_reactivated",
        targetUserId: account.userId,
      });
      expect(reactivationRequest.headers()["x-efcc-expected-actor-id"]).toBe(
        staff.userId
      );
      await expect(region.getByRole("status")).toContainText("伺服器已確認");
      expect(
        await caseApp.db
          .prepare(
            "SELECT membership_status FROM person_profile WHERE user_id = ?"
          )
          .bind(account.userId)
          .first()
      ).toEqual({ membership_status: "active" });
      const events = await caseApp.db
        .prepare(
          "SELECT action FROM audit_event WHERE target_user_id = ? AND action IN (?, ?) ORDER BY action"
        )
        .bind(
          account.userId,
          "membership_deactivated",
          "membership_reactivated"
        )
        .all<{ action: string }>();
      expect(events.results).toEqual([
        { action: "membership_deactivated" },
        { action: "membership_reactivated" },
      ]);
    } finally {
      await context.close();
    }
  }
);

isolatedTest(
  "@native @browser @mobile-critical @risk-recovery UNKNOWN restriction retries its original actor-target key until an authoritative conflict",
  async ({ browser, caseApp, extraHTTPHeaders, staff, account }) => {
    const context = await browser.newContext({
      extraHTTPHeaders,
      storageState: await staff.context.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.goto(
        `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
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
      expect(metadata).toMatchObject({
        action: "membership_deactivated",
        actorUserId: staff.userId,
        targetUserId: account.userId,
      });
      expect(metadata.rejected).toBeUndefined();
      await expect(
        region.getByRole("button", {
          exact: true,
          name: "操作未完成，開始另一項操作",
        })
      ).toHaveCount(0);
      const competing = command(account.userId, "membership_deactivated");
      expect(competing.operationKey).not.toBe(metadata.key);
      await status(
        staff.context.post("/api/v2/staff/accounts/restrictions", {
          data: competing,
        }),
        201
      );
      expect(
        await caseApp.db
          .prepare(
            "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, competing.operationKey)
          .first()
      ).toEqual({ operation_key: competing.operationKey });
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
      const retryRequestPromise = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      const retryResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/v2/staff/accounts/restrictions")
      );
      await retryDeactivation.click();
      const [retryRequest, retryResponse] = await Promise.all([
        retryRequestPromise,
        retryResponsePromise,
      ]);
      expect(retryResponse.status()).toBe(409);
      expect(retryRequest.postDataJSON()).toEqual({
        action: metadata.action,
        operationKey: metadata.key,
        targetUserId: metadata.targetUserId,
      });
      expect(retryRequest.headers()["x-efcc-expected-actor-id"]).toBe(
        staff.userId
      );
      await expect(region.getByRole("status")).toContainText("操作未完成");
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
          )
        )
      ).toEqual({ ...metadata, rejected: true });
      expect(
        await caseApp.db
          .prepare(
            "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, metadata.key)
          .first()
      ).toBeNull();
      expect(
        await caseApp.db
          .prepare(
            "SELECT membership_status FROM person_profile WHERE user_id = ?"
          )
          .bind(account.userId)
          .first()
      ).toEqual({ membership_status: "deactivated" });
      const events = await caseApp.db
        .prepare(
          "SELECT action FROM audit_event WHERE target_user_id = ? AND action = 'membership_deactivated'"
        )
        .bind(account.userId)
        .all<{ action: string }>();
      expect(events.results).toHaveLength(1);
      await region
        .getByRole("button", {
          exact: true,
          name: "操作未完成，開始另一項操作",
        })
        .click();
      await expect(
        region.getByRole("button", { exact: true, name: "重新啟用會籍" })
      ).toBeEnabled();
    } finally {
      await context.close();
    }
  }
);

test("@native @http @risk-authority ban and membership deactivation remain independent on the next real request", async ({
  caseApp,
  account,
  signedInRequest,
  staff,
}) => {
  const ban = command(account.userId, "account_banned");
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: ban,
    }),
    201
  );
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: ban,
    }),
    200
  );
  await status(signedInRequest.get("/api/v2/me"), 403);
  await status(
    signedInRequest.post("/api/auth/sign-in/name", {
      data: { fullName: account.fullName, password: account.password },
    }),
    200
  );
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "membership_deactivated"),
    }),
    201
  );
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "account_unbanned"),
    }),
    201
  );
  await status(signedInRequest.get("/api/v2/me"), 403);
  expect(
    await caseApp.db
      .prepare(
        "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first()
  ).toEqual({ banned_at: null, membership_status: "deactivated" });
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "account_banned"),
    }),
    201
  );
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "membership_reactivated"),
    }),
    201
  );
  await status(signedInRequest.get("/api/v2/me"), 403);
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "account_unbanned"),
    }),
    201
  );
  await status(signedInRequest.get("/api/v2/me"), 200);
  expect(
    await caseApp.db
      .prepare(
        "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first()
  ).toEqual({ banned_at: null, membership_status: "active" });
  const events = await caseApp.db
    .prepare(
      "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('account_banned', 'account_unbanned', 'membership_deactivated', 'membership_reactivated')"
    )
    .bind(account.userId)
    .all<{ id: string }>();
  expect(events.results).toHaveLength(6);
  const receipts = await caseApp.db
    .prepare(
      "SELECT action, COUNT(*) AS count FROM account_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('account_banned', 'account_unbanned', 'membership_deactivated', 'membership_reactivated') GROUP BY action ORDER BY action"
    )
    .bind(staff.userId, account.userId)
    .all<{ action: string; count: number }>();
  expect(receipts.results).toEqual([
    { action: "account_banned", count: 2 },
    { action: "account_unbanned", count: 2 },
    { action: "membership_deactivated", count: 1 },
    { action: "membership_reactivated", count: 1 },
  ]);
});

for (const table of [
  "person_profile",
  "audit_event",
  "account_change_operation",
] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    isolatedTest(
      `@native @http @risk-atomicity @risk-recovery fresh-store restriction ${table} ${fault} rolls back domain and receipt effects before same-key recovery`,
      async ({ caseApp, staff, account }) => {
        const input = command(account.userId, "account_banned");
        const trigger = `fault_restriction_${table}_${fault}`;
        const event = table === "person_profile" ? "UPDATE" : "INSERT";
        const triggerCondition =
          table === "person_profile"
            ? `NEW.user_id='${account.userId}'`
            : `NEW.target_user_id='${account.userId}' AND NEW.action='account_banned'`;
        await caseApp.db
          .prepare(
            `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${triggerCondition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic restriction fault'" : ""}); END`
          )
          .run();
        try {
          await status(
            staff.context.post("/api/v2/staff/accounts/restrictions", {
              data: input,
            }),
            500
          );
        } finally {
          await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
        }
        expect(
          await caseApp.db
            .prepare(
              "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
            )
            .bind(account.userId)
            .first()
        ).toEqual({ banned_at: null, membership_status: "active" });
        expect(
          await caseApp.db
            .prepare(
              "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
            )
            .bind(account.userId)
            .all()
        ).toMatchObject({ results: [] });
        expect(
          await caseApp.db
            .prepare(
              "SELECT actor_user_id, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(staff.userId, input.operationKey)
            .first()
        ).toBeNull();
        const recovered = await status(
          staff.context.post("/api/v2/staff/accounts/restrictions", {
            data: input,
          }),
          201
        );
        const receipt = await recovered.json();
        expect(receipt.data.receipt).toMatchObject({
          action: "account_banned",
          targetUserId: account.userId,
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(staff.userId, input.operationKey)
            .first()
        ).toEqual({
          action: "account_banned",
          actor_user_id: staff.userId,
          operation_key: input.operationKey,
          target_user_id: account.userId,
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
            )
            .bind(account.userId)
            .all<{ id: string }>()
        ).toMatchObject({ results: [{ id: expect.any(String) }] });
        expect(
          await caseApp.db
            .prepare(
              "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
            )
            .bind(account.userId)
            .first()
        ).toMatchObject({
          banned_at: expect.any(Number),
          membership_status: "active",
        });
      }
    );
  }
}

const lastAdminTest = isolatedTest.extend<{ administrators: AdminPair }>({
  administrators: async ({ caseApp }, use) => {
    const first = administrator("restriction-admin-first");
    const second = administrator("restriction-admin-second");
    await use([
      { ...first, userId: await caseApp.provision.account(first) },
      { ...second, userId: await caseApp.provision.account(second) },
    ] as const);
  },
});

lastAdminTest(
  "@native @http @risk-authority @risk-concurrency last-effective Admin guard uses a fresh global store without login sessions and survives competing bans",
  async ({ caseApp, administrators, playwright }) => {
    const [first, second] = administrators;
    const sessions = await caseApp.db
      .prepare("SELECT id FROM session WHERE user_id IN (?, ?)")
      .bind(first.userId, second.userId)
      .all<{ id: string }>();
    expect(sessions.results).toEqual([]);
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
      )
      .bind(first.userId)
      .run();
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM person_profile WHERE account_role = 'admin' AND membership_status = 'active' AND banned_at IS NULL"
        )
        .first()
    ).toEqual({ count: 1 });
    await expect(
      caseApp.db
        .prepare(
          "UPDATE person_profile SET banned_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE user_id = ?"
        )
        .bind(second.userId)
        .run()
    ).rejects.toThrow("Last effective administrator");
    await expect(
      caseApp.db
        .prepare(
          "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
        )
        .bind(second.userId)
        .run()
    ).rejects.toThrow("Last effective administrator");
    await expect(
      caseApp.db
        .prepare("DELETE FROM user WHERE id = ?")
        .bind(second.userId)
        .run()
    ).rejects.toThrow("Last effective administrator");
    const remaining = await caseApp.db
      .prepare(
        "SELECT user_id, account_role, membership_status, banned_at FROM person_profile WHERE user_id IN (?, ?)"
      )
      .bind(first.userId, second.userId)
      .all<{
        account_role: string;
        banned_at: number | null;
        membership_status: string;
        user_id: string;
      }>();
    expect(remaining.results).toHaveLength(2);
    expect(remaining.results).toEqual(
      expect.arrayContaining([
        {
          account_role: "admin",
          banned_at: null,
          membership_status: "deactivated",
          user_id: first.userId,
        },
        {
          account_role: "admin",
          banned_at: null,
          membership_status: "active",
          user_id: second.userId,
        },
      ])
    );
    expect(
      await caseApp.db
        .prepare("SELECT id FROM user WHERE id = ?")
        .bind(second.userId)
        .first()
    ).toEqual({ id: second.userId });
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'active' WHERE user_id = ?"
      )
      .bind(first.userId)
      .run();
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM person_profile WHERE account_role = 'admin' AND membership_status = 'active' AND banned_at IS NULL"
        )
        .first()
    ).toEqual({ count: 2 });
    const contexts: APIRequestContext[] = [];
    try {
      const one = await playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: {
          "cf-connecting-ip": "198.18.0.11",
          origin: caseApp.origin,
        },
      });
      contexts.push(one);
      const two = await playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: {
          "cf-connecting-ip": "198.18.0.12",
          origin: caseApp.origin,
        },
      });
      contexts.push(two);
      await status(
        one.post("/api/auth/sign-in/username", {
          data: { password: first.password, username: first.username },
        }),
        200
      );
      await status(
        two.post("/api/auth/sign-in/username", {
          data: { password: second.password, username: second.username },
        }),
        200
      );
      await status(
        one.post("/api/v2/account/password-confirmation", {
          data: { operationKey: randomUUID(), password: first.password },
        }),
        201
      );
      await status(
        two.post("/api/v2/account/password-confirmation", {
          data: { operationKey: randomUUID(), password: second.password },
        }),
        201
      );
      const banSecond = command(second.userId, "account_banned");
      const banFirst = command(first.userId, "account_banned");
      const results = await Promise.all([
        one.post("/api/v2/staff/accounts/restrictions", { data: banSecond }),
        two.post("/api/v2/staff/accounts/restrictions", { data: banFirst }),
      ]);
      expect(results.map((response) => response.status()).toSorted()).toEqual([
        201, 403,
      ]);
      const winner =
        results[0].status() === 201
          ? {
              actorUserId: first.userId,
              operation: banSecond,
              targetUserId: second.userId,
            }
          : {
              actorUserId: second.userId,
              operation: banFirst,
              targetUserId: first.userId,
            };
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM person_profile WHERE account_role = 'admin' AND membership_status = 'active' AND banned_at IS NULL"
          )
          .first()
      ).toEqual({ count: 1 });
      const operations = await caseApp.db
        .prepare(
          "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE action = 'account_banned'"
        )
        .all<{
          action: string;
          actor_user_id: string;
          operation_key: string;
          target_user_id: string;
        }>();
      expect(operations.results).toEqual([
        {
          action: "account_banned",
          actor_user_id: winner.actorUserId,
          operation_key: winner.operation.operationKey,
          target_user_id: winner.targetUserId,
        },
      ]);
      const losingOperation =
        winner.operation === banSecond ? banFirst : banSecond;
      expect(
        await caseApp.db
          .prepare(
            "SELECT operation_key FROM account_change_operation WHERE operation_key = ?"
          )
          .bind(losingOperation.operationKey)
          .first()
      ).toBeNull();
      const audits = await caseApp.db
        .prepare(
          "SELECT target_user_id FROM audit_event WHERE action = 'account_banned'"
        )
        .all<{ target_user_id: string }>();
      expect(audits.results).toEqual([{ target_user_id: winner.targetUserId }]);
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  }
);

adminTargetTest(
  "@native @http @risk-authority Staff cannot restrict its own account or an Admin and stale ten-minute confirmation is rejected",
  async ({ caseApp, staff, account, adminTarget }) => {
    const own = await status(
      staff.context.get("/api/v2/account/identity"),
      200
    );
    const identity = await own.json();
    expect(identity.data.identity.actorUserId).toBe(staff.userId);
    const selfRestriction = command(staff.userId, "account_banned");
    const administratorRestriction = command(
      adminTarget.userId,
      "account_banned"
    );
    await status(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: selfRestriction,
      }),
      403
    );
    await status(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: administratorRestriction,
      }),
      403
    );
    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s', 'now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const expired = await caseApp.db
      .prepare("SELECT password_confirmed_at FROM session WHERE user_id = ?")
      .bind(staff.userId)
      .first<{ password_confirmed_at: number }>();
    expect(expired?.password_confirmed_at).toBeLessThan(
      Math.floor(Date.now() / 1000) - 600
    );
    const staleRestriction = command(account.userId, "account_banned");
    await status(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: staleRestriction,
      }),
      403
    );
    const denied = await caseApp.db
      .prepare(
        "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key IN (?, ?, ?)"
      )
      .bind(
        staff.userId,
        selfRestriction.operationKey,
        administratorRestriction.operationKey,
        staleRestriction.operationKey
      )
      .all<{ operation_key: string }>();
    expect(denied.results).toEqual([]);
  }
);

test("@native @http @risk-authority changing a temporary password never removes a current ban or deactivation", async ({
  caseApp,
  account,
  signedInRequest,
  staff,
}) => {
  const reset = await status(
    staff.context.post("/api/v2/staff/accounts/password-reset", {
      data: {
        identityCheck: "face_to_face",
        operationKey: randomUUID(),
        targetUserId: account.userId,
      },
    }),
    201
  );
  const body = await reset.json();
  await status(signedInRequest.get("/api/v2/me"), 401);
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "account_banned"),
    }),
    201
  );
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: command(account.userId, "membership_deactivated"),
    }),
    201
  );
  await status(
    signedInRequest.post("/api/auth/sign-in/username", {
      data: {
        password: body.data.temporaryPassword,
        username: account.username,
      },
    }),
    200
  );
  await status(signedInRequest.get("/api/v2/me"), 403);
  await status(
    signedInRequest.post("/api/v2/account/password", {
      data: {
        currentPassword: body.data.temporaryPassword,
        newPassword: "Synthetic-restriction-permanent!",
        operationKey: randomUUID(),
      },
    }),
    201
  );
  const current = await status(signedInRequest.get("/api/v2/status"), 200);
  const currentBody = await current.json();
  expect(currentBody.data.reasons).toEqual([
    "membership_deactivated",
    "security_ban",
  ]);
  await status(signedInRequest.get("/api/v2/me"), 403);
  expect(
    await caseApp.db
      .prepare(
        "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first()
  ).toMatchObject({
    banned_at: expect.any(Number),
    membership_status: "deactivated",
  });
});

test("@native @browser @mobile-critical @risk-recovery @risk-privacy management and current-status pages recover a committed ban after reload", async ({
  browser,
  caseApp,
  extraHTTPHeaders,
  staff,
  account,
  signedInPage,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders,
    storageState: await staff.context.storageState(),
  });
  try {
    const page = await context.newPage();
    await page.goto(
      `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
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
    await expect(
      region.getByRole("link", { exact: true, name: "更換對象" })
    ).toHaveCount(0);
    await expect(
      region.locator('[aria-disabled="true"]').filter({ hasText: "更換對象" })
    ).toBeVisible();
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
    expect(metadata).toMatchObject({
      action: "account_banned",
      actorUserId: staff.userId,
      targetUserId: account.userId,
    });
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    expect(
      await caseApp.db
        .prepare(
          "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, metadata.key)
        .first()
    ).toEqual({
      action: "account_banned",
      actor_user_id: staff.userId,
      operation_key: metadata.key,
      target_user_id: account.userId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
        )
        .bind(account.userId)
        .all<{ id: string }>()
    ).toMatchObject({ results: [{ id: expect.any(String) }] });
    await signedInPage.goto("/status");
    await expect(
      signedInPage.getByRole("heading", {
        exact: true,
        name: "帳戶已暫停使用",
      })
    ).toBeVisible();
    expect(
      await signedInPage.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("@native @browser @mobile-critical @risk-authority restriction impact review keeps its draft through cancel and password modal before immutable Submit", async ({
  browser,
  caseApp,
  extraHTTPHeaders,
  staff,
  account,
}, testInfo) => {
  await caseApp.db
    .prepare("UPDATE session SET password_confirmed_at = 0 WHERE user_id = ?")
    .bind(staff.userId)
    .run();
  const context = await browser.newContext({
    extraHTTPHeaders,
    storageState: await staff.context.storageState(),
  });
  try {
    const page = await context.newPage();
    await page.goto(
      `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
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
    await beginRestrictionReview(region, "封鎖帳戶");
    const firstReview = region.getByRole("region", {
      exact: true,
      name: "核對封鎖帳戶",
    });
    await expect(firstReview).toContainText(account.fullName);
    await expect(firstReview).toContainText("已批准");
    await expect(firstReview).toContainText("未封鎖");
    await expect(firstReview).toContainText("已封鎖");
    await expect(firstReview).toContainText(
      "此人不能使用教會功能；會籍狀態不變。"
    );
    await region.getByRole("button", { exact: true, name: "返回修改" }).click();
    await expect(firstReview).toHaveCount(0);
    expect(restrictionRequests).toBe(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.restriction.operation.v1")
      )
    ).toBeNull();
    const submit = await beginRestrictionReview(region, "封鎖帳戶");
    const review = region.getByRole("region", {
      exact: true,
      name: "核對封鎖帳戶",
    });
    const confirmationPrompt =
      "提交前需要確認目前密碼。完成後會返回這裏，再由你確認提交。";
    const reviewSnapshot = async () => ({
      action: (await submit.textContent()) ?? "",
      impact:
        (await review
          .getByText("此人不能使用教會功能；會籍狀態不變。", {
            exact: true,
          })
          .textContent()) ?? "",
      result:
        (await review
          .locator("p")
          .filter({ hasText: "操作後" })
          .textContent()) ?? "",
      rows: (await review.locator("dl").first().textContent()) ?? "",
    });
    const reviewBeforeModal = await reviewSnapshot();
    await expect(review).toContainText(confirmationPrompt);
    await region.getByRole("link", { exact: true, name: "更換對象" }).click();
    const targetDialog = page.getByRole("dialog");
    await expect(
      targetDialog.getByRole("heading", {
        exact: true,
        name: "放棄未提交的更改？",
      })
    ).toBeVisible();
    await targetDialog
      .getByRole("button", { exact: true, name: "繼續編輯" })
      .click();
    await expect(review).toBeVisible();
    expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
    await page.getByRole("link", { name: /返回帳戶詳情/u }).click();
    const leaveDialog = page.getByRole("dialog");
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(review).toBeVisible();
    expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
    expect(restrictionRequests).toBe(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.restriction.operation.v1")
      )
    ).toBeNull();
    await qualifyPresentation(page, testInfo, "desktop", {
      criticalAction: submit,
      drafts: review.locator(
        'input:not([type="hidden"]):not([type="search"]), textarea'
      ),
      focus: submit,
    });
    expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
    await submit.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { exact: true, name: "確認目前密碼" })
    ).toBeVisible();
    const password = dialog.getByLabel("目前密碼", { exact: true });
    await password.fill(staff.account.password);
    const confirmPassword = dialog.getByRole("button", {
      exact: true,
      name: "確認並返回檢查",
    });
    await qualifyPresentation(page, testInfo, "desktop", {
      criticalAction: confirmPassword,
      drafts: password,
      focus: password,
      masks: [password],
    });
    await confirmPassword.click();
    await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
    await confirmPassword.click();
    await expect(dialog).not.toBeVisible();
    await expect(review).toBeVisible();
    await expect(review).not.toContainText(confirmationPrompt);
    expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
    expect(restrictionRequests).toBe(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.account-security.operation.v1")
      )
    ).toBeNull();
    const requestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    await submit.click();
    const [request, response] = await Promise.all([
      requestPromise,
      responsePromise,
    ]);
    expect(response.status()).toBe(201);
    expect(request.postDataJSON()).toEqual({
      action: "account_banned",
      operationKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
      ),
      targetUserId: account.userId,
    });
    expect(request.headers()["x-efcc-expected-actor-id"]).toBe(staff.userId);
    expect(restrictionRequests).toBe(1);
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    const payload = request.postDataJSON() as {
      action: RestrictionAction;
      operationKey: string;
      targetUserId: string;
    };
    expect(
      await caseApp.db
        .prepare(
          "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, payload.operationKey)
        .first()
    ).toEqual({
      action: payload.action,
      actor_user_id: staff.userId,
      operation_key: payload.operationKey,
      target_user_id: account.userId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
        )
        .bind(account.userId)
        .first()
    ).toMatchObject({
      banned_at: expect.any(Number),
      membership_status: "active",
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
        )
        .bind(account.userId)
        .all<{ id: string }>()
    ).toMatchObject({ results: [{ id: expect.any(String) }] });
  } finally {
    await context.close();
  }
});

test("@native @http @risk-freshness records local per-request read freshness without claiming production capacity or missing D1 counters", async ({
  signedInRequest,
  staff,
}, testInfo) => {
  const routes = [
    { actor: signedInRequest, path: "/api/v2/me" },
    { actor: signedInRequest, path: "/api/v2/status" },
    { actor: staff.context, path: "/api/v2/staff/accounts" },
  ];
  const measurements = [];
  for (const route of routes) {
    const times = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      // eslint-disable-next-line no-await-in-loop -- Each request measures one local response.
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
  await testInfo.attach("restriction-read-freshness", {
    body: JSON.stringify(
      {
        cookieOrPermissionCache: "No new cache",
        d1RowsReadWrite: "Unavailable at the HTTP harness; not claimed",
        environment:
          "localhost Worker / disposable local D1 / synthetic fixtures",
        measurements,
        production200DauCapacity: "Unverified",
      },
      null,
      2
    ),
    contentType: "application/json",
  });
});

isolatedTest(
  "@native @http @risk-concurrency @risk-recovery @risk-privacy concurrent matching restriction retries have one actor-bound receipt and no cross-actor disclosure",
  async ({ caseApp, staff, account, signedInRequest }) => {
    const input = command(account.userId, "account_banned");
    const results = await Promise.all([
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: input,
      }),
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: input,
      }),
    ]);
    expect(results.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    const operation = await caseApp.db
      .prepare(
        "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, input.operationKey)
      .first();
    expect(operation).toEqual({
      action: "account_banned",
      actor_user_id: staff.userId,
      operation_key: input.operationKey,
      target_user_id: account.userId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
        )
        .bind(account.userId)
        .all<{ id: string }>()
    ).toMatchObject({ results: [{ id: expect.any(String) }] });
    const ownReceipt = await status(
      staff.context.post("/api/v2/account/changes/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    const ownReceiptBody = await ownReceipt.json();
    expect(ownReceiptBody.data.receipt).toMatchObject({
      action: "account_banned",
      targetUserId: account.userId,
    });
    await status(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: { ...input, action: "account_unbanned" },
      }),
      409
    );
    expect(
      await caseApp.db
        .prepare("SELECT banned_at FROM person_profile WHERE user_id = ?")
        .bind(account.userId)
        .first<{ banned_at: number | null }>()
    ).toMatchObject({ banned_at: expect.any(Number) });
    const lookup = await status(
      signedInRequest.post("/api/v2/account/changes/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    const lookupBody = await lookup.json();
    expect(lookupBody.data.receipt).toBeNull();
  }
);

test("@native @http @risk-origin @risk-privacy restriction Origin and database limits preserve private current-state reads", async ({
  caseApp,
  staff,
  account,
}) => {
  const foreignOrigin = command(account.userId, "account_banned");
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: foreignOrigin,
      headers: { origin: "https://foreign.example" },
    }),
    403
  );
  expect(
    await caseApp.db
      .prepare(
        "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first()
  ).toEqual({ banned_at: null, membership_status: "active" });
  expect(
    await caseApp.db
      .prepare(
        "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, foreignOrigin.operationKey)
      .first()
  ).toBeNull();
  for (let index = 0; index < 10; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- The sequence establishes the real boundary.
    await status(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: { operationKey: randomUUID() },
      }),
      400
    );
  }
  await status(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: { operationKey: randomUUID() },
    }),
    429
  );
  const read = await status(staff.context.get("/api/v2/staff/accounts"), 200);
  expect(read.headers()["cache-control"]).toContain("no-store");
});
