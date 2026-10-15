import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";

const expectResponseStatus = async (
  promise: Promise<APIResponse>,
  code: number
) => {
  const response = await promise;
  expect(response.status()).toBe(code);
  return response;
};
const phone = () =>
  String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000));
const person = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `applicant.${suffix}@example.com`,
    fullName: `陳申請${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-applicant-password!",
    phone: phone(),
    username: `applicant.${suffix}`,
  };
};
const applicantTest = test.extend<{
  applicant: APIRequestContext;
  applicationId: string;
  profile: {
    email: string;
    fullName: string;
    operationKey: string;
    password: string;
    phone: string;
    username: string;
  };
  userId: string;
}>({
  applicant: async (
    { caseApp, extraHTTPHeaders, playwright, profile },
    use
  ) => {
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await expectResponseStatus(
        context.post("/api/v2/applications", {
          data: {
            ...profile,
            group: "Synthetic original group",
            intent: "Synthetic original intent",
            referral: "Synthetic original referral",
          },
        }),
        201
      );
      await expectResponseStatus(
        context.post("/api/auth/sign-in/username", {
          data: { password: profile.password, username: profile.username },
        }),
        200
      );
      await use(context);
    } finally {
      await context.dispose();
    }
  },
  applicationId: async ({ applicant }, use) => {
    const response = await expectResponseStatus(
      applicant.get("/api/v2/applications/mine"),
      200
    );
    const body = await response.json();
    await use(body.data.application.id);
  },
  profile: async ({ baseURL, caseApp }, use) => {
    expect(baseURL).toBe(caseApp.origin);
    await use(person());
  },
  // inherited signedInPage must use this applicant's genuine HTTP session.
  signedInRequest: async ({ applicant }, use) => {
    await use(applicant);
  },
  userId: async ({ applicationId, caseApp }, use) => {
    const row = await caseApp.db
      .prepare("SELECT user_id AS id FROM membership_application WHERE id = ?")
      .bind(applicationId)
      .first<{ id: string }>();
    if (!row) {
      throw new Error("Synthetic applicant missing");
    }
    await use(row.id);
  },
});
const isolatedApplicantTest = applicantTest.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});
const crossAccountApplicantTest = isolatedApplicantTest.extend<{
  foreignApplicant: APIRequestContext;
}>({
  foreignApplicant: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const foreignProfile = person();
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await expectResponseStatus(
        context.post("/api/v2/applications", { data: foreignProfile }),
        201
      );
      await expectResponseStatus(
        context.post("/api/auth/sign-in/username", {
          data: {
            password: foreignProfile.password,
            username: foreignProfile.username,
          },
        }),
        200
      );
      await use(context);
    } finally {
      await context.dispose();
    }
  },
});
const withdrawal = (applicationId: string) => ({
  action: "application_withdrawn",
  applicationId,
  operationKey: randomUUID(),
});
const correction = (applicationId: string) => ({
  action: "application_corrected",
  applicationId,
  email: `corrected.${randomBytes(6).toString("hex")}@example.com`,
  fullName: `陳修正Ａ${randomBytes(4).toString("hex")}`,
  operationKey: randomUUID(),
  phone: phone(),
});
const resubmission = (applicationId: string) => ({
  action: "application_resubmitted",
  applicationId,
  operationKey: randomUUID(),
});

isolatedApplicantTest(
  "never-approved applicant corrects identity then withdraws and resubmits same account",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-recovery",
      "@risk-immutability",
      "@risk-atomicity",
      "@risk-authorization",
    ],
  },
  async ({ caseApp, applicant, applicationId, profile, userId }) => {
    const original = await caseApp.db
      .prepare(
        "SELECT id, created_at, group_note, intent_note, operation_key_hash, referral_note, request_hash, status FROM membership_application WHERE id = ?"
      )
      .bind(applicationId)
      .first<{
        created_at: number;
        group_note: string | null;
        id: string;
        intent_note: string | null;
        operation_key_hash: string;
        referral_note: string | null;
        request_hash: string;
        status: string;
      }>();
    if (!original) {
      throw new Error("Original synthetic application missing");
    }
    expect(original).toMatchObject({
      group_note: "Synthetic original group",
      intent_note: "Synthetic original intent",
      referral_note: "Synthetic original referral",
      status: "pending",
    });
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();
    const input = correction(applicationId);
    const created = await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", { data: input }),
      201
    );
    const createdBody = await created.json();
    const { receipt } = createdBody.data;
    const replay = await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", { data: input }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(receipt);
    const [row] = await caseApp.db
      .prepare(
        "SELECT u.email_verified, u.username, p.name_lookup_key, p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(userId)
      .all<{
        email_verified: number;
        username: string;
        name_lookup_key: string;
        verified_recovery_phone: string | null;
      }>()
      .then(({ results: persistedRows }) => persistedRows);
    expect(row).toMatchObject({
      email_verified: 0,
      username: profile.username,
      verified_recovery_phone: null,
    });
    expect(row?.name_lookup_key).toContain("a");
    await expectResponseStatus(
      applicant.post("/api/auth/sign-in/name", {
        data: {
          fullName: input.fullName.replace("Ａ", "a"),
          password: profile.password,
        },
      }),
      200
    );
    await expectResponseStatus(
      applicant.post("/api/auth/sign-in/name", {
        data: { fullName: profile.fullName, password: profile.password },
      }),
      401
    );
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: withdrawal(applicationId),
      }),
      201
    );
    const next = await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      201
    );
    const nextBody = await next.json();
    const nextId = nextBody.data.receipt.applicationId;
    expect(nextId).not.toBe(applicationId);
    const mineResponse = await expectResponseStatus(
      applicant.get("/api/v2/applications/mine"),
      200
    );
    const mineBody = await mineResponse.json();
    const mine = mineBody.data.application;
    expect(mine).toMatchObject({
      fullName: input.fullName,
      id: nextId,
      status: "pending",
    });
    expect(
      await caseApp.db
        .prepare("SELECT id FROM user WHERE id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(1);
    expect(
      await caseApp.db
        .prepare(
          "SELECT status FROM membership_application WHERE user_id = ? ORDER BY rowid"
        )
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ status: "withdrawn" }, { status: "pending" }]);
    expect(
      await caseApp.db
        .prepare(
          "SELECT username_key FROM username_reservation WHERE user_id = ?"
        )
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ username_key: profile.username }]);
    await expectResponseStatus(applicant.get("/api/v2/me"), 403);
    const originalAfter = await caseApp.db
      .prepare(
        "SELECT id, created_at, group_note, intent_note, operation_key_hash, referral_note, request_hash, status FROM membership_application WHERE id = ?"
      )
      .bind(applicationId)
      .first<typeof original>();
    expect(originalAfter).toEqual({ ...original, status: "withdrawn" });
    const resubmitted = await caseApp.db
      .prepare(
        "SELECT id, created_at, group_note, intent_note, operation_key_hash, referral_note, request_hash, status FROM membership_application WHERE id = ?"
      )
      .bind(nextId)
      .first<typeof original>();
    expect(resubmitted).toMatchObject({
      group_note: original.group_note,
      intent_note: original.intent_note,
      referral_note: original.referral_note,
      status: "pending",
    });
    expect(resubmitted?.operation_key_hash).not.toBe(
      original.operation_key_hash
    );
    expect(resubmitted?.request_hash).not.toBe(original.request_hash);
    const readDurableState = async () => {
      const worker = caseApp.harness.getWorker<Cloudflare.Env>("efcc-system");
      const { DB: database } = await worker.getEnv();
      const [operation, audit] = await Promise.all([
        database
          .prepare(
            "SELECT action, application_id, created_at, id, operation_key, request_hash, user_id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
          )
          .bind(userId, input.operationKey)
          .first<{
            action: string;
            application_id: string;
            created_at: number;
            id: string;
            operation_key: string;
            request_hash: string;
            user_id: string;
          }>(),
        database
          .prepare(
            "SELECT action, actor_user_id, id, target_user_id FROM audit_event WHERE id = ?"
          )
          .bind(receipt.id)
          .first<{
            action: string;
            actor_user_id: string;
            id: string;
            target_user_id: string;
          }>(),
      ]);
      return { audit, operation };
    };

    const durableBefore = await readDurableState();
    if (!durableBefore.operation || !durableBefore.audit) {
      throw new Error(
        "Applicant durable receipt or audit missing from D1 before reload"
      );
    }
    expect({
      action: durableBefore.operation.action,
      applicationId: durableBefore.operation.application_id,
      createdAt: durableBefore.operation.created_at,
      id: durableBefore.operation.id,
    }).toEqual(receipt);
    const auditBefore = durableBefore.audit;
    expect(auditBefore).toEqual({
      action: "application_corrected",
      actor_user_id: userId,
      id: receipt.id,
      target_user_id: userId,
    });
    const rotatedSecret = randomBytes(32).toString("hex");
    await caseApp.harness.update((current) => ({
      ...current,
      workers: current.workers.map((worker) =>
        "configPath" in worker
          ? {
              ...worker,
              secrets: { ...worker.secrets, BETTER_AUTH_SECRET: rotatedSecret },
            }
          : worker
      ),
    }));
    const oldSession = await applicant.get("/api/v2/applications/mine");
    expect(oldSession.status()).toBe(401);
    await expectResponseStatus(
      applicant.post("/api/auth/sign-in/username", {
        data: { password: profile.password, username: profile.username },
      }),
      200
    );
    const afterReloadReplay = await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", { data: input }),
      200
    );
    const afterReloadBody = await afterReloadReplay.json();
    expect(afterReloadBody.data.receipt).toEqual(receipt);
    expect(await readDurableState()).toEqual(durableBefore);
  }
);
applicantTest(
  "rejected applicant resubmits while retaining private decision and note separation",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-privacy",
      "@risk-authorization",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, applicant, applicationId, staff, userId }) => {
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/application-decisions", {
        data: {
          applicationId,
          internalNote: "Synthetic private note",
          operationKey: randomUUID(),
          outcome: "rejected",
          visibleReason: "請補資料",
        },
      }),
      201
    );
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: correction(applicationId),
      }),
      201
    );
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      201
    );
    const inbox = await expectResponseStatus(
      applicant.get("/api/v2/inbox"),
      200
    );
    expect(await inbox.text()).toContain("請補資料");
    expect(await inbox.text()).not.toContain("Synthetic private note");
    expect(
      await caseApp.db
        .prepare(
          "SELECT internal_note, outcome, visible_reason FROM application_decision WHERE target_user_id = ?"
        )
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([
      {
        internal_note: "Synthetic private note",
        outcome: "rejected",
        visible_reason: "請補資料",
      },
    ]);
  }
);
applicantTest(
  "approval history, privileged applicant and forged targets cannot restore self-applicant authority",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-authorization",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, applicant, applicationId, staff, userId }) => {
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/application-decisions", {
        data: {
          applicationId,
          operationKey: randomUUID(),
          outcome: "approved",
        },
      }),
      201
    );
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'pending' WHERE user_id = ?"
      )
      .bind(userId)
      .run();
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: correction(applicationId),
      }),
      403
    );
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
      )
      .bind(userId)
      .run();
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      403
    );
    {
      await expectResponseStatus(
        applicant.post("/api/v2/applications/actions", {
          data: { ...correction(applicationId), targetUserId: randomUUID() },
        }),
        400
      );
      expect(
        await caseApp.db
          .prepare("SELECT status FROM membership_application WHERE id = ?")
          .bind(applicationId)
          .first<{ status: string }>()
      ).toEqual({ status: "approved" });
      expect(
        await caseApp.db
          .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
      expect(
        await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('application_corrected', 'application_resubmitted')"
          )
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
    }
  }
);
applicantTest(
  "a forged expected actor cannot withdraw and leaves no durable effect",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-authorization",
      "@risk-no-write",
      "@risk-atomicity",
    ],
  },
  async ({ caseApp, applicant, applicationId, userId }) => {
    const rejected = await applicant.post("/api/v2/applications/actions", {
      data: withdrawal(applicationId),
      headers: { "x-efcc-expected-actor-id": "different-synthetic-actor" },
    });
    expect(rejected.status()).toBe(409);
    const body = await rejected.json();
    expect(body.error.code).toBe("actor_changed");
    expect(
      await caseApp.db
        .prepare("SELECT status FROM membership_application WHERE id = ?")
        .bind(applicationId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ status: "pending" }]);
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'application_withdrawn'"
        )
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(0);
    expect(
      await caseApp.db
        .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(0);
  }
);
isolatedApplicantTest(
  "contact conflicts, Username forgery and closed email routes are safe",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-validation",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, applicant, applicationId, profile, userId }) => {
    const other = person();
    await caseApp.provision.account({
      email: other.email,
      fullName: other.fullName,
      membershipStatus: "active",
      password: other.password,
      phone: `+852${other.phone}`,
      username: other.username,
    });

    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: { ...correction(applicationId), email: other.email },
      }),
      409
    );
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: { ...correction(applicationId), phone: other.phone },
      }),
      409
    );
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: {
          ...correction(applicationId),
          username: `${profile.username}x`,
        },
      }),
      400
    );
    await expectResponseStatus(
      applicant.post("/api/auth/change-email", {
        data: { newEmail: "future@example.com" },
      }),
      404
    );
    {
      expect(
        await caseApp.db
          .prepare("SELECT count(*) AS total FROM verification")
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toEqual([{ total: 0 }]);
      expect(
        await caseApp.db
          .prepare("SELECT name, email FROM user WHERE id = ?")
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toEqual([{ email: profile.email, name: profile.fullName }]);
      expect(
        await caseApp.db
          .prepare("SELECT phone FROM person_profile WHERE user_id = ?")
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toEqual([{ phone: `+852${profile.phone}` }]);
      expect(
        await caseApp.db
          .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
      expect(
        await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'application_corrected'"
          )
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
    }
  }
);
for (const table of [
  "user",
  "person_profile",
  "audit_event",
  "applicant_operation",
]) {
  for (const fault of ["ABORT", "IGNORE"]) {
    isolatedApplicantTest(
      `applicant ${table} ${fault} rolls back correction and supports matching retry`,
      {
        tag: [
          "@native",
          "@account-applicant",
          "@http",
          "@risk-rollback",
          "@risk-atomicity",
          "@risk-recovery",
        ],
      },
      async ({ caseApp, applicant, applicationId, userId, profile }) => {
        const input = correction(applicationId);
        const trigger = `fault_applicant_${table}_${fault}`;
        const event =
          table === "user" || table === "person_profile" ? "UPDATE" : "INSERT";
        const condition = {
          applicant_operation: `NEW.user_id='${userId}'`,
          audit_event: `NEW.target_user_id='${userId}' AND NEW.action='application_corrected'`,
          person_profile: `NEW.user_id='${userId}'`,
          user: `NEW.id='${userId}'`,
        }[
          table as
            | "applicant_operation"
            | "audit_event"
            | "person_profile"
            | "user"
        ];
        await caseApp.db
          .prepare(
            `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic applicant fault'" : ""}); END`
          )
          .run();
        try {
          const response = await expectResponseStatus(
            applicant.post("/api/v2/applications/actions", { data: input }),
            500
          );
          expect(await response.text()).not.toContain(
            "Synthetic applicant fault"
          );
        } finally {
          await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
        }
        expect(
          await caseApp.db
            .prepare("SELECT name, email FROM user WHERE id = ?")
            .bind(userId)
            .all()
            .then(({ results: persistedRows }) => persistedRows)
        ).toEqual([
          {
            email: profile.email,
            name: profile.fullName,
          },
        ]);
        expect(
          await caseApp.db
            .prepare("SELECT phone FROM person_profile WHERE user_id = ?")
            .bind(userId)
            .all()
            .then(({ results: persistedRows }) => persistedRows)
        ).toEqual([{ phone: `+852${profile.phone}` }]);
        expect(
          await caseApp.db
            .prepare(
              "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'application_corrected'"
            )
            .bind(userId)
            .all()
            .then(({ results: persistedRows }) => persistedRows)
        ).toHaveLength(0);
        const recovered = await expectResponseStatus(
          applicant.post("/api/v2/applications/actions/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const recoveredBody = await recovered.json();
        {
          expect(recoveredBody.data.receipt).toBeNull();
          expect(
            await caseApp.db
              .prepare(
                "SELECT id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
              )
              .bind(userId, input.operationKey)
              .all()
              .then(({ results: persistedRows }) => persistedRows)
          ).toHaveLength(0);
        }
        {
          const recoveredAction = await expectResponseStatus(
            applicant.post("/api/v2/applications/actions", { data: input }),
            201
          );
          const recoveredActionBody = await recoveredAction.json();
          const { receipt } = recoveredActionBody.data;
          const durable = await caseApp.db
            .prepare(
              "SELECT action, application_id, created_at, id, operation_key, user_id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
            )
            .bind(userId, input.operationKey)
            .first<{
              action: string;
              application_id: string;
              created_at: number;
              id: string;
              operation_key: string;
              user_id: string;
            }>();
          if (!durable) {
            throw new Error("Recovered applicant receipt missing from D1");
          }
          expect({
            action: durable.action,
            applicationId: durable.application_id,
            createdAt: durable.created_at,
            id: durable.id,
          }).toEqual(receipt);
          expect(durable.operation_key).toBe(input.operationKey);
        }
      }
    );
  }
}
isolatedApplicantTest(
  "Staff decision versus applicant withdrawal has one valid outcome without stale effects",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-concurrency",
      "@risk-atomicity",
      "@risk-authorization",
    ],
  },
  async ({ caseApp, applicant, applicationId, staff, userId }) => {
    const results = await Promise.all([
      staff.context.post("/api/v2/staff/application-decisions", {
        data: {
          applicationId,
          operationKey: randomUUID(),
          outcome: "approved",
        },
      }),
      applicant.post("/api/v2/applications/actions", {
        data: withdrawal(applicationId),
      }),
    ]);
    expect(
      results.map((x) => x.status()).filter((x) => x === 201)
    ).toHaveLength(1);
    expect(
      results.map((x) => x.status()).every((x) => [201, 403, 409].includes(x))
    ).toBe(true);
    const [row] = await caseApp.db
      .prepare(
        "SELECT a.status, p.membership_status FROM membership_application a INNER JOIN person_profile p ON p.user_id = a.user_id WHERE a.id = ?"
      )
      .bind(applicationId)
      .all<{ status: string; membership_status: string }>()
      .then(({ results: persistedRows }) => persistedRows);
    expect(row).toEqual(
      row?.status === "approved"
        ? { membership_status: "active", status: "approved" }
        : { membership_status: "pending", status: "withdrawn" }
    );
    {
      expect(
        await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('application_approved', 'application_withdrawn')"
          )
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(1);
      const receipts = await caseApp.db
        .prepare(
          "SELECT id FROM applicant_operation WHERE user_id = ? AND action = 'application_withdrawn'"
        )
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows);
      expect(receipts).toHaveLength(row?.status === "withdrawn" ? 1 : 0);
    }
  }
);
crossAccountApplicantTest(
  "concurrent same-operation retries reconcile once and cross-account lookup reveals no receipt",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-concurrency",
      "@risk-atomicity",
      "@risk-privacy",
      "@risk-actor-target-key",
      "@risk-recovery",
      "@risk-origin",
      "@risk-authorization",
    ],
  },
  async ({
    caseApp,
    applicant,
    applicationId,
    foreignApplicant,
    request,
    userId,
  }) => {
    const input = withdrawal(applicationId);
    const results = await Promise.all([
      applicant.post("/api/v2/applications/actions", { data: input }),
      applicant.post("/api/v2/applications/actions", { data: input }),
    ]);
    expect(results.map((x) => x.status()).toSorted()).toEqual([200, 201]);
    {
      expect(
        await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'application_withdrawn'"
          )
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(1);
      const receipt = await caseApp.db
        .prepare(
          "SELECT action, application_id, operation_key, user_id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
        )
        .bind(userId, input.operationKey)
        .first<{
          action: string;
          application_id: string;
          operation_key: string;
          user_id: string;
        }>();
      expect(receipt).toEqual({
        action: "application_withdrawn",
        application_id: applicationId,
        operation_key: input.operationKey,
        user_id: userId,
      });
    }
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: { ...input, action: "application_resubmitted" },
      }),
      409
    );
    const anonymousLookup = await expectResponseStatus(
      request.post("/api/v2/applications/actions/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      401
    );
    expect(await anonymousLookup.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
    const foreignLookup = await expectResponseStatus(
      foreignApplicant.post("/api/v2/applications/actions/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    const foreignLookupBody = await foreignLookup.json();
    expect(foreignLookupBody.data.receipt).toBeNull();

    const denied = await applicant.post("/api/v2/applications/actions", {
      data: withdrawal(applicationId),
      headers: { origin: "https://foreign.example" },
    });
    expect(denied.status()).toBe(403);
  }
);
isolatedApplicantTest(
  "pre-cutover applicant receipts replay without a second effect and reject changed payloads",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-compatibility",
      "@risk-atomicity",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, applicant, applicationId, profile, userId }) => {
    const legacyEmail = `Legacy.${randomBytes(4).toString("hex")}@Example.TEST`;
    const normalizedEmail = legacyEmail.trim().toLowerCase();
    const localPhone = phone();
    const correctedKey = randomUUID().toUpperCase();
    const corrected = {
      action: "application_corrected",
      applicationId,
      email: `  ${legacyEmail}  `,
      fullName: `陳舊版${randomBytes(3).toString("hex")}`,
      operationKey: correctedKey,
      phone: localPhone,
    };
    const withdrawn = {
      action: "application_withdrawn",
      applicationId,
      operationKey: randomUUID(),
    };
    const resubmitted = {
      action: "application_resubmitted",
      applicationId,
      operationKey: randomUUID(),
    };
    const createdAt = Math.floor(Date.now() / 1000);
    // The pre-cutover duplication fingerprint: the parsed value in contract declaration order,
    // so the entry lists below must not be re-sorted.
    const fingerprints = {
      application_corrected: JSON.stringify(
        Object.fromEntries([
          ["operationKey", correctedKey.toLowerCase()],
          ["action", "application_corrected"],
          ["applicationId", applicationId],
          ["email", normalizedEmail],
          ["fullName", corrected.fullName],
          ["phone", `+852${localPhone}`],
        ])
      ),
      application_resubmitted: JSON.stringify(
        Object.fromEntries([
          ["operationKey", resubmitted.operationKey],
          ["action", "application_resubmitted"],
          ["applicationId", applicationId],
        ])
      ),
      application_withdrawn: JSON.stringify(
        Object.fromEntries([
          ["operationKey", withdrawn.operationKey],
          ["action", "application_withdrawn"],
          ["applicationId", applicationId],
        ])
      ),
    };
    const rows = [
      {
        action: "application_corrected",
        hash: createHash("sha256")
          .update(fingerprints.application_corrected)
          .digest("hex"),
        input: corrected,
        key: correctedKey.toLowerCase(),
      },
      {
        action: "application_withdrawn",
        hash: createHash("sha256")
          .update(fingerprints.application_withdrawn)
          .digest("hex"),
        input: withdrawn,
        key: withdrawn.operationKey,
      },
      {
        action: "application_resubmitted",
        hash: createHash("sha256")
          .update(fingerprints.application_resubmitted)
          .digest("hex"),
        input: resubmitted,
        key: resubmitted.operationKey,
      },
    ].map((row) => ({ ...row, id: randomUUID() }));
    await Promise.all(
      rows.map((row) =>
        caseApp.db
          .prepare(
            "INSERT INTO applicant_operation (action, application_id, created_at, id, operation_key, request_hash, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            row.action,
            applicationId,
            createdAt,
            row.id,
            row.key,
            row.hash,
            userId
          )
          .run()
      )
    );

    const replays = await Promise.all(
      rows.map(async (row) => {
        const replay = await expectResponseStatus(
          applicant.post("/api/v2/applications/actions", { data: row.input }),
          200
        );
        const body = await replay.json();
        return { body, row };
      })
    );
    for (const { body, row } of replays) {
      expect(body.data.receipt).toEqual({
        action: row.action,
        applicationId,
        createdAt,
        id: row.id,
      });
    }
    expect(
      await caseApp.db
        .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(3);
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('application_corrected', 'application_withdrawn', 'application_resubmitted')"
        )
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(0);
    expect(
      await caseApp.db
        .prepare("SELECT status FROM membership_application WHERE user_id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ status: "pending" }]);
    expect(
      await caseApp.db
        .prepare("SELECT email, name FROM user WHERE id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ email: profile.email, name: profile.fullName }]);

    const changedContact = await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: {
          ...corrected,
          email: `changed.${randomBytes(4).toString("hex")}@example.test`,
        },
      }),
      409
    );
    const changedBody = await changedContact.json();
    expect(changedBody.error.code).toBe("conflict");
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: { ...withdrawn, applicationId: randomUUID() },
      }),
      409
    );
    expect(
      await caseApp.db
        .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(3);
    expect(
      await caseApp.db
        .prepare("SELECT status FROM membership_application WHERE user_id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ status: "pending" }]);
    expect(
      await caseApp.db
        .prepare("SELECT email, name FROM user WHERE id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toEqual([{ email: profile.email, name: profile.fullName }]);
  }
);

applicantTest(
  "actual applicant UI recovers lost committed withdrawal after reload and resubmits",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({
    caseApp,
    signedInPage: page,
    applicant,
    profile,
    applicationId,
    userId,
  }) => {
    const browserSession = await page.request.get("/api/auth/get-session");
    expect(await browserSession.json()).toMatchObject({ user: { id: userId } });
    await page.goto("/application");
    await page.route("**/api/v2/applications/actions", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/applications/actions/reconcile", (route) =>
      route.abort("failed")
    );
    await page.getByRole("button", { exact: true, name: "撤回申請" }).click();
    await page.getByRole("button", { name: "確認撤回" }).click();
    await expect(page.getByRole("status")).toContainText("結果仍未確認");
    const metadata = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("efcc.applicant.operation.v1") ?? "null")
    );
    expect(JSON.stringify(metadata)).not.toContain(profile.email);
    await page.unrouteAll();
    await page.reload();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    await page
      .getByRole("button", { exact: true, name: "重新提交申請" })
      .click();
    await page.getByRole("button", { name: "確認重新提交" }).click();
    await expect(page.getByRole("status")).toContainText("重新提交申請");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    const currentApplicationResponse = await applicant.get(
      "/api/v2/applications/mine"
    );
    const currentApplication = await currentApplicationResponse.json();
    expect(currentApplication.data.application.status).toBe("pending");
    {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      const original = await caseApp.db
        .prepare("SELECT status FROM membership_application WHERE id = ?")
        .bind(applicationId)
        .first<{ status: string }>();
      expect(original).toEqual({ status: "withdrawn" });
      const latest = await caseApp.db
        .prepare(
          "SELECT id, status FROM membership_application WHERE user_id = (SELECT user_id FROM membership_application WHERE id = ?) ORDER BY rowid DESC LIMIT 1"
        )
        .bind(applicationId)
        .first<{ id: string; status: string }>();
      expect(latest).toEqual({
        id: currentApplication.data.application.id,
        status: "pending",
      });
    }
  }
);
applicantTest(
  "privileged pending identity cannot use applicant corrections or another application id",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-authorization",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, applicant, applicationId, userId }) => {
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: correction(randomUUID()),
      }),
      409
    );
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
      )
      .bind(userId)
      .run();
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: correction(applicationId),
      }),
      403
    );
  }
);
for (const fault of ["ABORT", "IGNORE"]) {
  isolatedApplicantTest(
    `resubmission application INSERT ${fault} cannot leave an audit or completed receipt`,
    {
      tag: [
        "@native",
        "@account-applicant",
        "@http",
        "@risk-rollback",
        "@risk-atomicity",
        "@risk-recovery",
      ],
    },
    async ({ caseApp, applicant, applicationId, userId }) => {
      await expectResponseStatus(
        applicant.post("/api/v2/applications/actions", {
          data: withdrawal(applicationId),
        }),
        201
      );
      const input = resubmission(applicationId);
      const trigger = `fault_resubmit_${fault}`;
      await caseApp.db
        .prepare(
          `CREATE TRIGGER ${trigger} BEFORE INSERT ON membership_application WHEN NEW.user_id='${userId}' BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic resubmission fault'" : ""}); END`
        )
        .run();
      try {
        await expectResponseStatus(
          applicant.post("/api/v2/applications/actions", { data: input }),
          500
        );
      } finally {
        await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
      }
      expect(
        await caseApp.db
          .prepare(
            "SELECT id, status FROM membership_application WHERE user_id = ?"
          )
          .bind(userId)
          .all<{ id: string; status: string }>()
          .then(({ results: persistedRows }) => persistedRows)
      ).toEqual([{ id: applicationId, status: "withdrawn" }]);
      {
        expect(
          await caseApp.db
            .prepare(
              "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'application_resubmitted'"
            )
            .bind(userId)
            .all()
            .then(({ results: persistedRows }) => persistedRows)
        ).toHaveLength(0);
        expect(
          await caseApp.db
            .prepare(
              "SELECT id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
            )
            .bind(userId, input.operationKey)
            .all()
            .then(({ results: persistedRows }) => persistedRows)
        ).toHaveLength(0);
      }
      {
        const recovered = await expectResponseStatus(
          applicant.post("/api/v2/applications/actions", { data: input }),
          201
        );
        const recoveredResponseBody = await recovered.json();
        const { receipt } = recoveredResponseBody.data;
        const durable = await caseApp.db
          .prepare(
            "SELECT action, application_id, created_at, id, operation_key, user_id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
          )
          .bind(userId, input.operationKey)
          .first<{
            action: string;
            application_id: string;
            created_at: number;
            id: string;
            operation_key: string;
            user_id: string;
          }>();
        if (!durable) {
          throw new Error("Recovered applicant receipt missing from D1");
        }
        expect({
          action: durable.action,
          applicationId: durable.application_id,
          createdAt: durable.created_at,
          id: durable.id,
        }).toEqual(receipt);
        expect(durable.operation_key).toBe(input.operationKey);
        expect(durable.user_id).toBe(userId);
        const audit = await caseApp.db
          .prepare(
            "SELECT action, actor_user_id, id, target_user_id FROM audit_event WHERE id = ?"
          )
          .bind(durable.id)
          .first<{
            action: string;
            actor_user_id: string;
            id: string;
            target_user_id: string;
          }>();
        expect(audit).toEqual({
          action: input.action,
          actor_user_id: userId,
          id: durable.id,
          target_user_id: userId,
        });
      }
    }
  );
}

isolatedApplicantTest(
  "resubmission follows durable append order without inventing a future submission time",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-immutability",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, applicant, applicationId }) => {
    await caseApp.db
      .prepare(
        "UPDATE membership_application SET created_at = CAST(strftime('%s', 'now') AS INTEGER) + 3600 WHERE id = ?"
      )
      .bind(applicationId)
      .run();
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: withdrawal(applicationId),
      }),
      201
    );
    const response = await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      201
    );
    const body = await response.json();
    const mineResponse = await expectResponseStatus(
      applicant.get("/api/v2/applications/mine"),
      200
    );
    const mineBody = await mineResponse.json();
    expect(mineBody.data.application.id).toBe(body.data.receipt.applicationId);
    expect(mineBody.data.application.createdAt).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000)
    );
  }
);

applicantTest(
  "actual applicant page preserves another actor's unresolved operation",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-recovery",
      "@risk-actor-target-key",
    ],
  },
  async ({ signedInPage: page, applicationId }) => {
    await page.goto("/application");
    const saved = {
      action: "application_withdrawn",
      actorUserId: "different-synthetic-actor",
      applicationId,
      key: randomUUID(),
    };
    await page.evaluate(
      (value) =>
        localStorage.setItem(
          "efcc.applicant.operation.v1",
          JSON.stringify(value)
        ),
      saved
    );
    await page.reload();
    await expect(page.getByRole("status")).toContainText("另一帳戶未確認");
    await expect(
      page.getByRole("button", {
        exact: true,
        name: "撤回申請",
      })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "查核之前的操作" }).click();
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.applicant.operation.v1") ?? "null"
        )
      )
    ).toEqual(saved);
  }
);

isolatedApplicantTest(
  "applicant action limits preserve authorised lifecycle reads",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@http",
      "@risk-rate-limit",
      "@risk-authorization",
    ],
  },
  async ({ caseApp, applicant, applicationId }) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- The shared bucket requires ordered attempts.
      await expectResponseStatus(
        applicant.post("/api/v2/applications/actions", {
          data: { operationKey: randomUUID() },
        }),
        400
      );
    }
    await expectResponseStatus(
      applicant.post("/api/v2/applications/actions", {
        data: { operationKey: randomUUID() },
      }),
      429
    );
    const read = await expectResponseStatus(
      applicant.get("/api/v2/applications/self-service"),
      200
    );
    {
      expect(read.headers()["cache-control"]).toContain("no-store");
      const application = await caseApp.db
        .prepare("SELECT status FROM membership_application WHERE id = ?")
        .bind(applicationId)
        .first<{ status: string }>();
      expect(application).toEqual({ status: "pending" });
      expect(
        await caseApp.db
          .prepare(
            "SELECT id FROM applicant_operation WHERE application_id = ?"
          )
          .bind(applicationId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
    }
  }
);

applicantTest(
  "applicant edit review keeps the draft until Continue or Discard",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-draft",
      "@risk-privacy",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, signedInPage: page, profile, userId }) => {
    let submissions = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/applications/actions"
      ) {
        submissions += 1;
      }
    });
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();

    {
      await page.goto("/application");
      const navigation = page.getByRole("navigation", { name: "主要導覽" });
      await ((await page.evaluate(() => innerWidth)) <= 640
        ? expect(navigation).toHaveCount(0)
        : expect(navigation).toBeVisible());
      await page.getByRole("button", { name: "修正申請資料" }).click();
      const draft = {
        email: `review.${randomBytes(4).toString("hex")}@example.test`,
        fullName: `陳草稿${randomBytes(3).toString("hex")}`,
        phone: `+852${phone()}`,
      };
      await page.getByLabel("中文全名").fill(draft.fullName);
      await page.getByLabel("電郵地址").fill(draft.email);
      await page.getByLabel("電話").fill(draft.phone);
      await page.getByRole("button", { name: "檢查更改" }).click();

      await expect(page.getByText(draft.fullName)).toBeVisible();
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();

      const returnToApplication = page.getByRole("link", {
        exact: true,
        name: "返回我的申請",
      });
      await returnToApplication.click();
      await expect(
        page.getByRole("heading", { name: "放棄未提交的更改？" })
      ).toBeVisible();
      await page.getByRole("button", { name: "繼續編輯" }).click();
      await expect(page.getByText(draft.fullName)).toBeVisible();

      await returnToApplication.click();
      await page.getByRole("button", { name: "放棄變更" }).click();
      await expect(page).toHaveURL(/\/application$/u);
      await page.getByRole("button", { name: "修正申請資料" }).click();
      await expect(page.getByLabel("中文全名")).toHaveValue(profile.fullName);
      await expect(page.getByLabel("電郵地址")).toHaveValue(profile.email);
      await expect(page.getByLabel("電話")).toHaveValue(
        new RegExp(profile.phone, "u")
      );
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();
    }
    expect(submissions).toBe(0);
    expect(
      await caseApp.db
        .prepare(
          "SELECT status FROM membership_application WHERE user_id = ? ORDER BY rowid DESC LIMIT 1"
        )
        .bind(userId)
        .first<{ status: string }>()
    ).toEqual({ status: "pending" });
    expect(
      await caseApp.db
        .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
        .bind(userId)
        .all()
        .then(({ results: persistedRows }) => persistedRows)
    ).toHaveLength(0);
  }
);

applicantTest(
  "applicant task reflows at desktop and 320px with 200% text",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-responsive",
      "@risk-accessibility",
    ],
  },
  async ({ caseApp, signedInPage: page, profile, userId }) => {
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();

    {
      await page.goto("/application");
      const desktop = await (async () => {
        await page.setViewportSize({ height: 1024, width: 1440 });
        return page.evaluate(() => ({
          mainWidth: document.querySelector("main")?.getBoundingClientRect()
            .width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
      })();
      expect(desktop.mainWidth).toBeLessThanOrEqual(640);
      expect(desktop.overflow).toBe(false);

      await page.setViewportSize({ height: 568, width: 320 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.getByRole("button", { name: "修正申請資料" }).click();
      await page
        .getByLabel("中文全名")
        .fill(`${profile.fullName}${"教會".repeat(20)}`);
      await page
        .getByLabel("電郵地址")
        .fill(`reflow.${randomBytes(8).toString("hex")}@example.test`);
      await page.getByLabel("電話").fill(`+852${phone()}`);
      const mobile = await page.evaluate(() => ({
        height: innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
      }));
      expect(mobile.width).toBe(320);
      expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.width);
      expect(mobile.scrollHeight).toBeGreaterThan(mobile.height);

      await page.getByRole("button", { name: "檢查更改" }).click();
      const submit = page.getByRole("button", { name: "確認並提交更改" });
      await submit.scrollIntoViewIfNeeded();
      const box = await submit.boundingBox();
      if (!box) {
        throw new Error(
          "Applicant review submit action should remain reachable"
        );
      }
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(mobile.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(mobile.height);
    }
  }
);

applicantTest(
  "applicant retries an absent withdrawal receipt with the original operation key",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-immutability",
      "@risk-actor-target-key",
    ],
  },
  async ({ caseApp, signedInPage: page, applicationId, userId }) => {
    {
      const operationKeys: string[] = [];
      await page.route("**/api/v2/applications/actions", async (route) => {
        const { pathname } = new URL(route.request().url());
        if (
          pathname === "/api/v2/applications/actions" &&
          route.request().method() === "POST"
        ) {
          const body = route.request().postDataJSON() as {
            operationKey: string;
          };
          operationKeys.push(body.operationKey);
          if (operationKeys.length === 1) {
            await route.abort("failed");
            return;
          }
        }
        await route.continue();
      });
      await page.goto("/application");
      await page.getByRole("button", { name: "撤回申請" }).click();
      await page.getByRole("button", { name: "確認撤回" }).click();
      await expect(page.getByRole("status")).toContainText("未找到完成紀錄");
      expect(operationKeys).toHaveLength(1);
      await page.getByRole("button", { name: "以同一操作重試" }).click();
      await expect(page.getByRole("status")).toContainText("伺服器已確認");
      expect(operationKeys).toHaveLength(2);
      {
        expect(operationKeys[1]).toBe(operationKeys[0]);
        const receipt = await caseApp.db
          .prepare(
            "SELECT action, application_id, id, operation_key, user_id FROM applicant_operation WHERE user_id = ? AND operation_key = ?"
          )
          .bind(userId, operationKeys[0])
          .first<{
            action: string;
            application_id: string;
            id: string;
            operation_key: string;
            user_id: string;
          }>();
        expect(receipt).toMatchObject({
          action: "application_withdrawn",
          application_id: applicationId,
          operation_key: operationKeys[0],
          user_id: userId,
        });
      }
    }
  }
);

applicantTest(
  "applicant review blocks invalid fields before freezing the draft",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-validation",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, signedInPage: page, profile, userId }) => {
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();

    {
      let submissions = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v2/applications/actions" &&
          request.method() === "POST"
        ) {
          submissions += 1;
        }
      });
      await page.goto("/application");
      await page.getByRole("button", { name: "修正申請資料" }).click();
      const tooLongName = "陳修".repeat(51);
      await page.getByLabel("中文全名").fill(tooLongName);
      await page.getByLabel("電話").fill("abc");
      await page.getByRole("button", { name: "檢查更改" }).click();

      await expect(
        page.getByText("中文全名不可多於 100 個字元。")
      ).toBeVisible();
      await expect(
        page.getByText(
          "請輸入有效的香港電話號碼，或 E.164 國際格式（+ 國家碼及 8 至 15 位數字）。"
        )
      ).toBeVisible();
      await expect(page.getByLabel("中文全名")).toHaveValue(tooLongName);
      expect(submissions).toBe(0);

      await page.getByLabel("中文全名").fill(`${profile.fullName}修正`);
      await page.getByLabel("電話").fill(`+852${phone()}`);
      await page.getByRole("button", { name: "檢查更改" }).click();

      await expect(page.getByText(`${profile.fullName}修正`)).toBeVisible();
      expect(submissions).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();
    }
  }
);

applicantTest(
  "applicant review rejects a one-character TLD email before freezing the draft",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-validation",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, signedInPage: page, profile, userId }) => {
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(userId)
      .run();

    {
      let submissions = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v2/applications/actions" &&
          request.method() === "POST"
        ) {
          submissions += 1;
        }
      });
      await page.goto("/application");
      await page.getByRole("button", { name: "修正申請資料" }).click();
      await page.getByLabel("中文全名").fill(`${profile.fullName}更正`);
      await page.getByLabel("電郵地址").fill("a@b.c");
      await page.getByRole("button", { name: "檢查更改" }).click();

      await expect(
        page.getByText("請輸入有效的電郵地址；不可使用 .invalid 網域。")
      ).toBeVisible();
      await expect(page.getByLabel("電郵地址")).toHaveValue("a@b.c");
      expect(submissions).toBe(0);

      const corrected = `corrected.${randomBytes(4).toString("hex")}@example.test`;
      await page.getByLabel("電郵地址").fill(corrected);
      await page.getByRole("button", { name: "檢查更改" }).click();

      await expect(page.getByText(corrected)).toBeVisible();
      expect(submissions).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();
      expect(
        await caseApp.db
          .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
      expect(
        await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'application_corrected'"
          )
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toHaveLength(0);
      expect(
        await caseApp.db
          .prepare("SELECT email FROM user WHERE id = ?")
          .bind(userId)
          .all()
          .then(({ results: persistedRows }) => persistedRows)
      ).toEqual([{ email: profile.email }]);
    }
  }
);

applicantTest(
  "applicant storage failure prevents sending a withdrawal and keeps its review context",
  {
    tag: [
      "@native",
      "@account-applicant",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, signedInPage: page, userId }) => {
    {
      await page.addInitScript((operationStorageKey) => {
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItem(name, value) {
          if (name === operationStorageKey) {
            throw new DOMException("Storage unavailable", "QuotaExceededError");
          }
          originalSetItem.call(this, name, value);
        };
      }, "efcc.applicant.operation.v1");
      let requests = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v2/applications/actions" &&
          request.method() === "POST"
        ) {
          requests += 1;
        }
      });
      await page.goto("/application");
      await page.getByRole("button", { name: "撤回申請" }).click();
      await page.getByRole("button", { name: "確認撤回" }).click();
      await expect(page.getByRole("alert")).toContainText("操作尚未提交");
      expect(requests).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();
      await page.getByRole("button", { name: "重新檢查本機儲存" }).click();
      {
        await expect(
          page.getByRole("heading", { name: "確認撤回" })
        ).toBeVisible();
        const application = await caseApp.db
          .prepare(
            "SELECT status FROM membership_application WHERE user_id = ? ORDER BY rowid DESC LIMIT 1"
          )
          .bind(userId)
          .first<{ status: string }>();
        expect(application).toEqual({ status: "pending" });
        expect(
          await caseApp.db
            .prepare("SELECT id FROM applicant_operation WHERE user_id = ?")
            .bind(userId)
            .all()
            .then(({ results: persistedRows }) => persistedRows)
        ).toHaveLength(0);
      }
    }
  }
);
