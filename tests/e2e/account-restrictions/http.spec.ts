import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { dedicatedTest, expect, test } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";
import { expectResponseStatus, restrictionCommand } from "./test-helpers";

type NativeAccount = ProvisionAccount & { userId: string };

type AdminPair = readonly [NativeAccount, NativeAccount];

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

const lastAdminTest = dedicatedTest.extend<{ administrators: AdminPair }>({
  administrators: async ({ caseApp }, use) => {
    const first = administrator("restriction-admin-first");
    const second = administrator("restriction-admin-second");
    await use([
      { ...first, userId: await caseApp.provision.account(first) },
      { ...second, userId: await caseApp.provision.account(second) },
    ] as const);
  },
});

test("@native @http @risk-authority ban and membership deactivation remain independent on the next real request", async ({
  caseApp,
  account,
  signedInRequest,
  staff,
}) => {
  const ban = restrictionCommand(account.userId, "account_banned");
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: ban,
    }),
    201
  );
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: ban,
    }),
    200
  );
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 403);
  await expectResponseStatus(
    signedInRequest.post("/api/auth/sign-in/name", {
      data: { fullName: account.fullName, password: account.password },
    }),
    200
  );
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "membership_deactivated"),
    }),
    201
  );
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "account_unbanned"),
    }),
    201
  );
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 403);
  expect(
    await caseApp.db
      .prepare(
        "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first()
  ).toEqual({ banned_at: null, membership_status: "deactivated" });
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "account_banned"),
    }),
    201
  );
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "membership_reactivated"),
    }),
    201
  );
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 403);
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "account_unbanned"),
    }),
    201
  );
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 200);
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
    dedicatedTest(
      `@native @http @risk-atomicity @risk-recovery fresh-store restriction ${table} ${fault} rolls back domain and receipt effects before same-key recovery`,
      async ({ caseApp, staff, account }) => {
        const input = restrictionCommand(account.userId, "account_banned");
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
          await expectResponseStatus(
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
        const recovered = await expectResponseStatus(
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
      await expectResponseStatus(
        one.post("/api/auth/sign-in/username", {
          data: { password: first.password, username: first.username },
        }),
        200
      );
      await expectResponseStatus(
        two.post("/api/auth/sign-in/username", {
          data: { password: second.password, username: second.username },
        }),
        200
      );
      await expectResponseStatus(
        one.post("/api/v2/account/password-confirmation", {
          data: { operationKey: randomUUID(), password: first.password },
        }),
        201
      );
      await expectResponseStatus(
        two.post("/api/v2/account/password-confirmation", {
          data: { operationKey: randomUUID(), password: second.password },
        }),
        201
      );
      const banSecond = restrictionCommand(second.userId, "account_banned");
      const banFirst = restrictionCommand(first.userId, "account_banned");
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
    const own = await expectResponseStatus(
      staff.context.get("/api/v2/account/identity"),
      200
    );
    const identity = await own.json();
    expect(identity.data.identity.actorUserId).toBe(staff.userId);
    const selfRestriction = restrictionCommand(staff.userId, "account_banned");
    const administratorRestriction = restrictionCommand(
      adminTarget.userId,
      "account_banned"
    );
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: selfRestriction,
      }),
      403
    );
    await expectResponseStatus(
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
    const staleRestriction = restrictionCommand(
      account.userId,
      "account_banned"
    );
    await expectResponseStatus(
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
  const reset = await expectResponseStatus(
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
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 401);
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "account_banned"),
    }),
    201
  );
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: restrictionCommand(account.userId, "membership_deactivated"),
    }),
    201
  );
  await expectResponseStatus(
    signedInRequest.post("/api/auth/sign-in/username", {
      data: {
        password: body.data.temporaryPassword,
        username: account.username,
      },
    }),
    200
  );
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 403);
  await expectResponseStatus(
    signedInRequest.post("/api/v2/account/password", {
      data: {
        currentPassword: body.data.temporaryPassword,
        newPassword: "Synthetic-restriction-permanent!",
        operationKey: randomUUID(),
      },
    }),
    201
  );
  const current = await expectResponseStatus(
    signedInRequest.get("/api/v2/status"),
    200
  );
  const currentBody = await current.json();
  expect(currentBody.data.reasons).toEqual([
    "membership_deactivated",
    "security_ban",
  ]);
  await expectResponseStatus(signedInRequest.get("/api/v2/me"), 403);
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

dedicatedTest(
  "@native @http @risk-concurrency @risk-recovery @risk-privacy concurrent matching restriction retries have one actor-bound receipt and no cross-actor disclosure",
  async ({ caseApp, staff, account, signedInRequest }) => {
    const input = restrictionCommand(account.userId, "account_banned");
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
    const ownReceipt = await expectResponseStatus(
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
    await expectResponseStatus(
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
    const lookup = await expectResponseStatus(
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
  const foreignOrigin = restrictionCommand(account.userId, "account_banned");
  await expectResponseStatus(
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
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: { operationKey: randomUUID() },
      }),
      400
    );
  }
  await expectResponseStatus(
    staff.context.post("/api/v2/staff/accounts/restrictions", {
      data: { operationKey: randomUUID() },
    }),
    429
  );
  const read = await expectResponseStatus(
    staff.context.get("/api/v2/staff/accounts"),
    200
  );
  expect(read.headers()["cache-control"]).toContain("no-store");
});
