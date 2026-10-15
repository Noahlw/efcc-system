import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { dedicatedTest, expect, test } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";
import { expectResponseStatus, phone } from "./test-helpers";

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

test(
  "actor-bound requests cannot use forged actor headers to mutate or reconcile another account",
  {
    tag: [
      "@native",
      "@http",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
      "@risk-actor-target-key",
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
        const response = await expectResponseStatus(
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
    const rejected = await expectResponseStatus(
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
    const created = await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", {
        data: input,
        headers: ownHeaders,
      }),
      201
    );
    const replayed = await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", {
        data: input,
        headers: ownHeaders,
      }),
      200
    );
    const replayedBody = await replayed.json();
    const createdBody = await created.json();
    expect(replayedBody.data.receipt.id).toBe(createdBody.data.receipt.id);
    const { BETTER_AUTH_SECRET: secret } = await caseApp.server
      .getWorker<Cloudflare.Env>("efcc-system")
      .getEnv();
    if (!secret) {
      throw new Error("Synthetic harness auth secret is missing");
    }
    const persistedHash = await caseApp.db
      .prepare(
        "SELECT request_hash FROM account_change_operation WHERE actor_user_id=? AND operation_key=?"
      )
      .bind(account.userId, input.operationKey)
      .first<{ request_hash: string }>();
    // Legacy operation recipe and property order, independent of the writer's schema.
    expect(persistedHash?.request_hash).toBe(
      createHmac("sha256", secret)
        .update(
          JSON.stringify([
            account.userId,
            "own_phone_changed",
            { operationKey: input.operationKey, phone: `+852${input.phone}` },
          ])
        )
        .digest("hex")
    );
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

test(
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
    const ownChange = await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", { data: ownInput }),
      201
    );
    const ownChangeBody = await ownChange.json();
    const ownReplay = await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", { data: ownInput }),
      200
    );
    const ownReplayBody = await ownReplay.json();
    expect(ownReplayBody.data.receipt).toEqual(ownChangeBody.data.receipt);
    await expectResponseStatus(
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
    const changed = await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const changedBody = await changed.json();
    const replay = await expectResponseStatus(
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
      { username_key: input.username.toLowerCase() },
      { username_key: account.username },
    ]);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    await expectResponseStatus(
      staff.context.post("/api/v2/applications", {
        data: {
          email: `duplicate.${suffix}@example.com`,
          fullName: `陳申請${suffix}`,
          operationKey: randomBytes(32).toString("hex"),
          password: "Synthetic-identity-password!",
          phone: phone(),
          username: account.username,
        },
      }),
      409
    );
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: account.userId,
        },
      }),
      403
    );
    await expectResponseStatus(
      signedInRequest.post("/api/auth/update-user", {
        data: { name: "forged name" },
      }),
      404
    );
    await expectResponseStatus(
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

test(
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
    const corrected = await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/identity", { data: input }),
      201
    );
    const correctedBody = await corrected.json();
    await expectResponseStatus(
      request.post("/api/auth/sign-in/username", {
        data: { password: target.password, username: target.username },
      }),
      401
    );
    const currentLogin = await expectResponseStatus(
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

dedicatedTest(
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
    await expectResponseStatus(
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
    const response = await expectResponseStatus(
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
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: account.userId,
        },
      }),
      403
    );
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: {
          ...input,
          operationKey: randomUUID(),
          verifiedRecoveryPhone: sharedPhone,
        },
      }),
      400
    );
    await expectResponseStatus(
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
    dedicatedTest(
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
          const response = await expectResponseStatus(
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
        const reconciliation = await expectResponseStatus(
          staff.context.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const reconciliationBody = await reconciliation.json();
        expect(reconciliationBody.data.receipt).toBeNull();
        const retried = await expectResponseStatus(
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

dedicatedTest(
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
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: { ...input, phone: phone() },
      }),
      409
    );
    const ownKey = randomUUID();
    const ownPhone = await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", {
        data: { operationKey: ownKey, phone: phone() },
      }),
      201
    );
    const ownPhoneBody = await ownPhone.json();
    const foreign = await expectResponseStatus(
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
    await expectResponseStatus(
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

test(
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
    const selfResponse = await expectResponseStatus(
      staff.context.get("/api/v2/account/identity"),
      200
    );
    const selfBody = await selfResponse.json();
    await expectResponseStatus(
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
    await expectResponseStatus(
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
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/identity", {
        data: identity(privilegedId),
      }),
      403
    );
    const input = identity(account.userId);
    await expectResponseStatus(
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
    const corrected = await expectResponseStatus(
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
    await expectResponseStatus(
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

dedicatedTest(
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

dedicatedTest(
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
    const canonicalLogin = await expectResponseStatus(
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
    const corrected = await expectResponseStatus(
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
    const ambiguous = await expectResponseStatus(
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
    const replaced = await expectResponseStatus(
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

for (const table of [
  "person_profile",
  "audit_event",
  "account_change_operation",
] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    dedicatedTest(
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
          await expectResponseStatus(
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
        const reconciliation = await expectResponseStatus(
          signedInRequest.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const reconciliationBody = await reconciliation.json();
        expect(reconciliationBody.data.receipt).toBeNull();
        const retried = await expectResponseStatus(
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

test(
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
    await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", {
        data: input,
        headers: { origin: "https://foreign.example" },
      }),
      403
    );
    await expectResponseStatus(
      signedInRequest.post("/api/v2/account/phone", {
        data: { ...input, targetUserId: randomUUID() },
      }),
      400
    );
    const read = await expectResponseStatus(
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
