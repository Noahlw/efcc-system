import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { apiTransportHeaders, E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

const status = async (promise: Promise<APIResponse>, code: number) => {
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
  profile: ReturnType<typeof person>;
  applicationId: string;
  userId: string;
  staff: APIRequestContext;
}>({
  applicant: async ({ playwright, profile }, use) => {
    const context = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        ...apiTransportHeaders,
        "cf-connecting-ip": `198.20.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(context.post("/api/v2/applications", { data: profile }), 201);
    await status(
      context.post("/api/auth/sign-in/username", {
        data: {
          password: profile.password,
          username: profile.username,
        },
      }),
      200
    );
    await use(context);
    await context.dispose();
  },
  applicationId: async ({ applicant }, use) => {
    const response = await status(
      applicant.get("/api/v2/applications/mine"),
      200
    );
    const body = await response.json();
    await use(body.data.application.id);
  },
  profile: async ({ baseURL }, use) => {
    expect(baseURL).toBe(E2E_BASE_URL);
    await use(person());
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
        ...apiTransportHeaders,
        "cf-connecting-ip": `198.21.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(
      context.post("/api/auth/sign-in/username", {
        data: {
          password: holder.password,
          username: holder.username,
        },
      }),
      200
    );
    await use(context);
    await context.dispose();
  },
  userId: async ({ applicant, profile }, use) => {
    await applicant.get("/api/v2/applications/mine");
    const [row] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${profile.username}'`
    );
    if (!row) {
      throw new Error("Synthetic applicant missing");
    }
    await use(row.id);
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

applicantTest(
  "never-approved applicant corrects identity then withdraws and resubmits same account",
  async ({ applicant, applicationId, profile, userId }) => {
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${userId}'`);
    const input = correction(applicationId);
    const created = await status(
      applicant.post("/api/v2/applications/actions", { data: input }),
      201
    );
    const createdBody = await created.json();
    const { receipt } = createdBody.data;
    const replay = await status(
      applicant.post("/api/v2/applications/actions", { data: input }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(receipt);
    const [row] = queryLocalSql<{
      email_verified: number;
      username: string;
      name_lookup_key: string;
      verified_recovery_phone: string | null;
    }>(
      `SELECT u.email_verified,u.username,p.name_lookup_key,p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id=u.id WHERE u.id='${userId}'`
    );
    expect(row).toMatchObject({
      email_verified: 0,
      username: profile.username,
      verified_recovery_phone: null,
    });
    expect(row?.name_lookup_key).toContain("a");
    await status(
      applicant.post("/api/auth/sign-in/name", {
        data: {
          fullName: input.fullName.replace("Ａ", "a"),
          password: profile.password,
        },
      }),
      200
    );
    await status(
      applicant.post("/api/auth/sign-in/name", {
        data: { fullName: profile.fullName, password: profile.password },
      }),
      401
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: withdrawal(applicationId),
      }),
      201
    );
    const next = await status(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      201
    );
    const nextBody = await next.json();
    const nextId = nextBody.data.receipt.applicationId;
    expect(nextId).not.toBe(applicationId);
    const mineResponse = await status(
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
      queryLocalSql(`SELECT id FROM user WHERE id='${userId}'`)
    ).toHaveLength(1);
    expect(
      queryLocalSql(
        `SELECT status FROM membership_application WHERE user_id='${userId}' ORDER BY created_at`
      )
    ).toEqual([{ status: "withdrawn" }, { status: "pending" }]);
    expect(
      queryLocalSql(
        `SELECT username_key FROM username_reservation WHERE user_id='${userId}'`
      )
    ).toEqual([{ username_key: profile.username }]);
    await status(applicant.get("/api/v2/me"), 403);
  }
);
applicantTest(
  "rejected applicant resubmits while retaining private decision and note separation",
  async ({ applicant, applicationId, staff, userId }) => {
    await status(
      staff.post("/api/v2/staff/application-decisions", {
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
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: correction(applicationId),
      }),
      201
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      201
    );
    const inbox = await status(applicant.get("/api/v2/inbox"), 200);
    expect(await inbox.text()).toContain("請補資料");
    expect(await inbox.text()).not.toContain("Synthetic private note");
    expect(
      queryLocalSql(
        `SELECT outcome FROM application_decision WHERE target_user_id='${userId}'`
      )
    ).toEqual([{ outcome: "rejected" }]);
  }
);
applicantTest(
  "approval history, privileged applicant and forged targets cannot restore self-applicant authority",
  async ({ applicant, applicationId, staff, userId }) => {
    await status(
      staff.post("/api/v2/staff/application-decisions", {
        data: {
          applicationId,
          operationKey: randomUUID(),
          outcome: "approved",
        },
      }),
      201
    );
    runLocalSql(
      `UPDATE person_profile SET membership_status='pending' WHERE user_id='${userId}'`
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: correction(applicationId),
      }),
      403
    );
    runLocalSql(
      `UPDATE person_profile SET membership_status='deactivated' WHERE user_id='${userId}'`
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      403
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: { ...correction(applicationId), targetUserId: randomUUID() },
      }),
      400
    );
  }
);
applicantTest(
  "a forged expected actor cannot withdraw and leaves no durable effect",
  async ({ applicant, applicationId, userId }) => {
    const rejected = await applicant.post("/api/v2/applications/actions", {
      data: withdrawal(applicationId),
      headers: { "x-efcc-expected-actor-id": "different-synthetic-actor" },
    });
    expect(rejected.status()).toBe(409);
    const body = await rejected.json();
    expect(body.error.code).toBe("actor_changed");
    expect(
      queryLocalSql(
        `SELECT status FROM membership_application WHERE id='${applicationId}'`
      )
    ).toEqual([{ status: "pending" }]);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action='application_withdrawn'`
      )
    ).toHaveLength(0);
    expect(
      queryLocalSql(
        `SELECT id FROM applicant_operation WHERE user_id='${userId}'`
      )
    ).toHaveLength(0);
  }
);
applicantTest(
  "contact conflicts, Username forgery and closed email routes are safe",
  async ({ applicant, applicationId, profile }) => {
    const other = person();
    await seedSyntheticAccounts([{ ...other, membershipStatus: "active" }]);
    runLocalSql(
      `UPDATE person_profile SET phone='+852${other.phone}' WHERE user_id=(SELECT id FROM user WHERE username='${other.username}')`
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: { ...correction(applicationId), email: other.email },
      }),
      409
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: { ...correction(applicationId), phone: other.phone },
      }),
      409
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: {
          ...correction(applicationId),
          username: `${profile.username}x`,
        },
      }),
      400
    );
    await status(
      applicant.post("/api/auth/change-email", {
        data: { newEmail: "future@example.com" },
      }),
      404
    );
    expect(queryLocalSql("SELECT count(*) AS total FROM verification")).toEqual(
      [{ total: 0 }]
    );
  }
);
for (const table of [
  "user",
  "person_profile",
  "audit_event",
  "applicant_operation",
]) {
  for (const fault of ["ABORT", "IGNORE"]) {
    applicantTest(
      `applicant ${table} ${fault} rolls back correction and supports matching retry`,
      async ({ applicant, applicationId, userId, profile }) => {
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
        runLocalSql(
          `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic applicant fault'" : ""}); END`
        );
        try {
          const response = await status(
            applicant.post("/api/v2/applications/actions", { data: input }),
            500
          );
          expect(await response.text()).not.toContain(
            "Synthetic applicant fault"
          );
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
        }
        expect(
          queryLocalSql(`SELECT name,email FROM user WHERE id='${userId}'`)
        ).toEqual([
          {
            email: profile.email,
            name: profile.fullName,
          },
        ]);
        expect(
          queryLocalSql(
            `SELECT phone FROM person_profile WHERE user_id='${userId}'`
          )
        ).toEqual([{ phone: `+852${profile.phone}` }]);
        expect(
          queryLocalSql(
            `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action='application_corrected'`
          )
        ).toHaveLength(0);
        const recovered = await status(
          applicant.post("/api/v2/applications/actions/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        const recoveredBody = await recovered.json();
        expect(recoveredBody.data.receipt).toBeNull();
        await status(
          applicant.post("/api/v2/applications/actions", { data: input }),
          201
        );
      }
    );
  }
}
applicantTest(
  "Staff decision versus applicant withdrawal has one valid outcome without stale effects",
  async ({ applicant, applicationId, staff, userId }) => {
    const results = await Promise.all([
      staff.post("/api/v2/staff/application-decisions", {
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
    const [row] = queryLocalSql<{ status: string; membership_status: string }>(
      `SELECT a.status,p.membership_status FROM membership_application a INNER JOIN person_profile p ON p.user_id=a.user_id WHERE a.id='${applicationId}'`
    );
    expect(row).toEqual(
      row?.status === "approved"
        ? { membership_status: "active", status: "approved" }
        : { membership_status: "pending", status: "withdrawn" }
    );
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action IN ('application_approved','application_withdrawn')`
      )
    ).toHaveLength(1);
  }
);
applicantTest(
  "concurrent same-operation retries reconcile once and cross-account lookup reveals no receipt",
  async ({ applicant, applicationId, staff, userId }) => {
    const input = withdrawal(applicationId);
    const results = await Promise.all([
      applicant.post("/api/v2/applications/actions", { data: input }),
      applicant.post("/api/v2/applications/actions", { data: input }),
    ]);
    expect(results.map((x) => x.status()).toSorted()).toEqual([200, 201]);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action='application_withdrawn'`
      )
    ).toHaveLength(1);
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: { ...input, action: "application_resubmitted" },
      }),
      409
    );
    const foreignLookup = await status(
      staff.post("/api/v2/applications/actions/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    const foreignBody = await foreignLookup.json();
    expect(foreignBody.data.receipt).toBeNull();
    const denied = await applicant.post("/api/v2/applications/actions", {
      data: withdrawal(applicationId),
      headers: { origin: "https://foreign.example" },
    });
    expect(denied.status()).toBe(403);
  }
);
applicantTest(
  "pre-cutover applicant receipts replay without a second effect and reject changed payloads",
  async ({ applicant, applicationId, profile, userId }) => {
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
    for (const row of rows) {
      runLocalSql(
        `INSERT INTO applicant_operation (action, application_id, created_at, id, operation_key, request_hash, user_id)
        VALUES ('${row.action}', '${applicationId}', ${createdAt}, '${row.id}', '${row.key}', '${row.hash}', '${userId}')`
      );
    }

    const replays = await Promise.all(
      rows.map(async (row) => {
        const replay = await status(
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
      queryLocalSql(
        `SELECT id FROM applicant_operation WHERE user_id='${userId}'`
      )
    ).toHaveLength(3);
    expect(
      queryLocalSql(
        `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action IN ('application_corrected','application_withdrawn','application_resubmitted')`
      )
    ).toHaveLength(0);
    expect(
      queryLocalSql(
        `SELECT status FROM membership_application WHERE user_id='${userId}'`
      )
    ).toEqual([{ status: "pending" }]);
    expect(
      queryLocalSql(`SELECT email, name FROM user WHERE id='${userId}'`)
    ).toEqual([{ email: profile.email, name: profile.fullName }]);

    const changedContact = await status(
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
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: { ...withdrawn, applicationId: randomUUID() },
      }),
      409
    );
    expect(
      queryLocalSql(
        `SELECT id FROM applicant_operation WHERE user_id='${userId}'`
      )
    ).toHaveLength(3);
    expect(
      queryLocalSql(
        `SELECT status FROM membership_application WHERE user_id='${userId}'`
      )
    ).toEqual([{ status: "pending" }]);
    expect(
      queryLocalSql(`SELECT email, name FROM user WHERE id='${userId}'`)
    ).toEqual([{ email: profile.email, name: profile.fullName }]);
  }
);

applicantTest(
  "actual applicant UI recovers lost committed withdrawal after reload and resubmits",
  async ({ browser, applicant, profile }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.22.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      hasTouch: true,
      isMobile: true,
      storageState: await applicant.storageState(),
      viewport: { height: 915, width: 412 },
    });
    const page = await context.newPage();
    await page.goto(`${E2E_BASE_URL}/application`);
    await page.route("**/api/v2/applications/actions", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/applications/actions/reconcile", (route) =>
      route.abort("failed")
    );
    await page.getByRole("button", { exact: true, name: "撤回申請" }).click();
    await expect(page.getByRole("heading", { name: "確認撤回" })).toBeVisible();
    await page.getByRole("button", { name: "確認撤回" }).click();
    await expect(page.getByRole("status")).toContainText("結果仍未確認");
    const metadata = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("efcc.applicant.operation.v1") ?? "null")
    );
    expect(Object.keys(metadata).toSorted()).toEqual([
      "action",
      "actorUserId",
      "applicationId",
      "key",
    ]);
    expect(JSON.stringify(metadata)).not.toContain(profile.email);
    await page.unrouteAll();
    await page.reload();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    await page
      .getByRole("button", { exact: true, name: "重新提交申請" })
      .click();
    await expect(
      page.getByRole("heading", { name: "確認重新提交" })
    ).toBeVisible();
    await page.getByRole("button", { name: "確認重新提交" }).click();
    await expect(page.getByRole("status")).toContainText("重新提交申請");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "待批" })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await context.close();
  }
);
applicantTest(
  "privileged pending identity cannot use applicant corrections or another application id",
  async ({ applicant, applicationId, userId }) => {
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: correction(randomUUID()),
      }),
      409
    );
    runLocalSql(
      `UPDATE person_profile SET account_role='staff' WHERE user_id='${userId}'`
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: correction(applicationId),
      }),
      403
    );
  }
);
for (const fault of ["ABORT", "IGNORE"]) {
  applicantTest(
    `resubmission application INSERT ${fault} cannot leave an audit or completed receipt`,
    async ({ applicant, applicationId, userId }) => {
      await status(
        applicant.post("/api/v2/applications/actions", {
          data: withdrawal(applicationId),
        }),
        201
      );
      const input = resubmission(applicationId);
      const trigger = `fault_resubmit_${fault}`;
      runLocalSql(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON membership_application WHEN NEW.user_id='${userId}' BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'Synthetic resubmission fault'" : ""}); END`
      );
      try {
        await status(
          applicant.post("/api/v2/applications/actions", { data: input }),
          500
        );
      } finally {
        runLocalSql(`DROP TRIGGER ${trigger}`);
      }
      expect(
        queryLocalSql(
          `SELECT id FROM membership_application WHERE user_id='${userId}'`
        )
      ).toHaveLength(1);
      expect(
        queryLocalSql(
          `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action='application_resubmitted'`
        )
      ).toHaveLength(0);
      await status(
        applicant.post("/api/v2/applications/actions", { data: input }),
        201
      );
    }
  );
}

applicantTest(
  "resubmission follows durable append order without inventing a future submission time",
  async ({ applicant, applicationId }) => {
    runLocalSql(
      `UPDATE membership_application SET created_at=CAST(strftime('%s','now') AS INTEGER)+3600 WHERE id='${applicationId}'`
    );
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: withdrawal(applicationId),
      }),
      201
    );
    const response = await status(
      applicant.post("/api/v2/applications/actions", {
        data: resubmission(applicationId),
      }),
      201
    );
    const body = await response.json();
    const mineResponse = await status(
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
  async ({ browser, applicant, applicationId }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { origin: E2E_BASE_URL },
      storageState: await applicant.storageState(),
    });
    const page = await context.newPage();
    await page.goto(`${E2E_BASE_URL}/application`);
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
    await context.close();
  }
);

applicantTest(
  "applicant action limits preserve authorised lifecycle reads",
  async ({ applicant }) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- The shared bucket requires ordered attempts.
      await status(
        applicant.post("/api/v2/applications/actions", {
          data: { operationKey: randomUUID() },
        }),
        400
      );
    }
    await status(
      applicant.post("/api/v2/applications/actions", {
        data: { operationKey: randomUUID() },
      }),
      429
    );
    const read = await status(
      applicant.get("/api/v2/applications/self-service"),
      200
    );
    expect(read.headers()["cache-control"]).toContain("no-store");
  }
);

applicantTest(
  "applicant edit review keeps the draft until Continue or Discard",
  async ({ browser, applicant, profile, userId }) => {
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${userId}'`);
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.23.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await applicant.storageState(),
      viewport: { height: 844, width: 390 },
    });
    try {
      const page = await context.newPage();
      await page.goto(`${E2E_BASE_URL}/application`);
      await expect(
        page.getByRole("navigation", { name: "主要導覽" })
      ).toHaveCount(0);
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
      await expect(
        page.getByRole("heading", { name: "提交前檢查" })
      ).toBeVisible();
      await expect(page.getByText(draft.fullName)).toBeVisible();
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();

      const returnToAccount = page.getByRole("link", { name: "← 返回帳戶" });
      await returnToAccount.click();
      await expect(
        page.getByRole("heading", { name: "放棄未提交的更改？" })
      ).toBeVisible();
      await page.getByRole("button", { name: "繼續編輯" }).click();
      await expect(page.getByText(draft.fullName)).toBeVisible();

      await returnToAccount.click();
      await page.getByRole("button", { name: "放棄變更" }).click();
      await expect(page).toHaveURL(/\/account$/u);
      await page.goto(`${E2E_BASE_URL}/application`);
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
    } finally {
      await context.close();
    }
  }
);

applicantTest(
  "applicant task reflows at desktop and 320px with 200% text",
  async ({ browser, applicant, profile, userId }) => {
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${userId}'`);
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.24.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await applicant.storageState(),
      viewport: { height: 1024, width: 1440 },
    });
    try {
      const page = await context.newPage();
      await page.goto(`${E2E_BASE_URL}/application`);
      const desktop = await page.evaluate(() => ({
        mainWidth: document.querySelector("main")?.getBoundingClientRect()
          .width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(desktop.mainWidth).toBeLessThanOrEqual(640);
      expect(desktop.overflow).toBe(false);
      await expect(
        page.getByRole("navigation", { name: "主要導覽" })
      ).toHaveCount(0);

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
    } finally {
      await context.close();
    }
  }
);

applicantTest(
  "applicant retries an absent withdrawal receipt with the original operation key",
  async ({ browser, applicant }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.25.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await applicant.storageState(),
    });
    try {
      const page = await context.newPage();
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
      await page.goto(`${E2E_BASE_URL}/application`);
      await page.getByRole("button", { name: "撤回申請" }).click();
      await page.getByRole("button", { name: "確認撤回" }).click();
      await expect(page.getByRole("status")).toContainText("未找到完成紀錄");
      expect(operationKeys).toHaveLength(1);
      await page.getByRole("button", { name: "以同一操作重試" }).click();
      await expect(page.getByRole("status")).toContainText("伺服器已確認");
      expect(operationKeys).toHaveLength(2);
      expect(operationKeys[1]).toBe(operationKeys[0]);
    } finally {
      await context.close();
    }
  }
);

applicantTest(
  "applicant review blocks invalid fields before freezing the draft",
  async ({ browser, applicant, profile, userId }) => {
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${userId}'`);
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.26.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await applicant.storageState(),
    });
    try {
      const page = await context.newPage();
      let submissions = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v2/applications/actions" &&
          request.method() === "POST"
        ) {
          submissions += 1;
        }
      });
      await page.goto(`${E2E_BASE_URL}/application`);
      await page.getByRole("button", { name: "修正申請資料" }).click();
      const tooLongName = "陳修".repeat(51);
      await page.getByLabel("中文全名").fill(tooLongName);
      await page.getByLabel("電話").fill("abc");
      await page.getByRole("button", { name: "檢查更改" }).click();
      await expect(
        page.getByRole("heading", { name: "提交前檢查" })
      ).toHaveCount(0);
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
      await expect(
        page.getByRole("heading", { name: "提交前檢查" })
      ).toBeVisible();
      await expect(page.getByText(`${profile.fullName}修正`)).toBeVisible();
      expect(submissions).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();
    } finally {
      await context.close();
    }
  }
);

applicantTest(
  "applicant review rejects a one-character TLD email before freezing the draft",
  async ({ browser, applicant, profile, userId }) => {
    runLocalSql(`UPDATE user SET email_verified=1 WHERE id='${userId}'`);
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.28.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await applicant.storageState(),
    });
    try {
      const page = await context.newPage();
      let submissions = 0;
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname === "/api/v2/applications/actions" &&
          request.method() === "POST"
        ) {
          submissions += 1;
        }
      });
      await page.goto(`${E2E_BASE_URL}/application`);
      await page.getByRole("button", { name: "修正申請資料" }).click();
      await page.getByLabel("中文全名").fill(`${profile.fullName}更正`);
      await page.getByLabel("電郵地址").fill("a@b.c");
      await page.getByRole("button", { name: "檢查更改" }).click();
      await expect(
        page.getByRole("heading", { name: "提交前檢查" })
      ).toHaveCount(0);
      await expect(
        page.getByText("請輸入有效的電郵地址；不可使用 .invalid 網域。")
      ).toBeVisible();
      await expect(page.getByLabel("電郵地址")).toHaveValue("a@b.c");
      expect(submissions).toBe(0);

      const corrected = `corrected.${randomBytes(4).toString("hex")}@example.test`;
      await page.getByLabel("電郵地址").fill(corrected);
      await page.getByRole("button", { name: "檢查更改" }).click();
      await expect(
        page.getByRole("heading", { name: "提交前檢查" })
      ).toBeVisible();
      await expect(page.getByText(corrected)).toBeVisible();
      expect(submissions).toBe(0);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        )
      ).toBeNull();
      expect(
        queryLocalSql(
          `SELECT id FROM applicant_operation WHERE user_id='${userId}'`
        )
      ).toHaveLength(0);
      expect(
        queryLocalSql(
          `SELECT id FROM audit_event WHERE target_user_id='${userId}' AND action='application_corrected'`
        )
      ).toHaveLength(0);
      expect(
        queryLocalSql(`SELECT email FROM user WHERE id='${userId}'`)
      ).toEqual([{ email: profile.email }]);
    } finally {
      await context.close();
    }
  }
);

applicantTest(
  "applicant storage failure prevents sending a withdrawal and keeps its review context",
  async ({ browser, applicant }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
      storageState: await applicant.storageState(),
    });
    try {
      const page = await context.newPage();
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
      await page.goto(`${E2E_BASE_URL}/application`);
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
      await expect(
        page.getByRole("heading", { name: "確認撤回" })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  }
);
