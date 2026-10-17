import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import { dedicatedTest, expect, test } from "../support/fixtures";

const applicationInput = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `applicant.${suffix}@example.test`,
    fullName: `陳申請${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-password-17!",
    phone: String(50_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    username: `applicant.${suffix}`,
  };
};

interface ExpectedApiError {
  code: string;
  message: string;
  status: number;
}

const expectApiFailure = async (
  response: APIResponse,
  expected: ExpectedApiError
) => {
  expect(response.status()).toBe(expected.status);
  expect(await response.json()).toEqual({
    error: { code: expected.code, message: expected.message },
  });
  expect(response.headers()["cache-control"]).toContain("no-store");
};

test(
  "an application provisions no session and native sign-in reaches only Pending",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, request }) => {
    const input = applicationInput();
    const submitted = await request.post("/api/v2/applications", {
      data: input,
    });
    expect(submitted.status()).toBe(201);
    expect(await submitted.json()).toEqual({ data: { outcome: "pending" } });
    expect(submitted.headers()["set-cookie"]).toBeUndefined();
    expect(submitted.headers()["cache-control"]).toContain("no-store");
    const operation = await caseApp.db
      .prepare(
        "SELECT request_hash FROM membership_application WHERE user_id=(SELECT id FROM user WHERE username=?)"
      )
      .bind(input.username)
      .first<{ request_hash: string }>();
    // Independent pre-refactor recipe: decoded capability bytes and null optional fields.
    const fingerprint = JSON.stringify([
      input.fullName,
      input.username,
      input.email,
      `+852${input.phone}`,
      input.password,
      null,
      null,
      null,
    ]);
    expect(operation?.request_hash).toBe(
      createHmac("sha256", Buffer.from(input.operationKey, "hex"))
        .update(fingerprint)
        .digest("hex")
    );

    const anonymousBusiness = await request.get("/api/v2/me");
    expect(anonymousBusiness.status()).toBe(401);
    const signedIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(signedIn.status()).toBe(200);
    const usernameBusiness = await request.get("/api/v2/me");
    expect(usernameBusiness.status()).toBe(403);
    const status = await request.get("/api/v2/status");
    expect(status.status()).toBe(200);
    expect(await status.json()).toEqual({
      data: {
        accessAllowed: false,
        displayName: input.fullName,
        reasons: ["membership_pending"],
      },
    });
    const signedOut = await request.post("/api/auth/sign-out", { data: {} });
    expect(signedOut.status()).toBe(200);
    const byName = await request.post("/api/auth/sign-in/name", {
      data: { fullName: input.fullName, password: input.password },
    });
    expect(byName.status()).toBe(200);
    const nameBusiness = await request.get("/api/v2/me");
    expect(nameBusiness.status()).toBe(403);
    const persisted = await caseApp.db
      .prepare(
        `SELECT (SELECT status FROM membership_application WHERE user_id = u.id ORDER BY rowid DESC LIMIT 1) AS application_status, (SELECT membership_status FROM person_profile WHERE user_id = u.id) AS membership_status, (SELECT count(*) FROM application_decision WHERE target_user_id = u.id) AS decisions FROM user u WHERE u.username = ?`
      )
      .bind(input.username)
      .first<{
        application_status: string;
        decisions: number;
        membership_status: string;
      }>();
    expect(persisted).toEqual({
      application_status: "pending",
      decisions: 0,
      membership_status: "pending",
    });
  }
);

test(
  "lost-response reconciliation and replay disclose only the original outcome",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, request }) => {
    const input = applicationInput();
    const first = await request.post("/api/v2/applications", {
      data: input,
      headers: { "cf-connecting-ip": "198.51.100.17" },
    });
    expect(first.status()).toBe(201);
    const reconciled = await request.post("/api/v2/applications/reconcile", {
      data: { operationKey: input.operationKey },
    });
    expect(reconciled.status()).toBe(200);
    expect(await reconciled.json()).toEqual({ data: { outcome: "pending" } });
    const replay = await request.post("/api/v2/applications", {
      data: input,
      headers: { "cf-connecting-ip": "198.51.100.18" },
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ data: { outcome: "pending" } });
    const stranger = await request.post("/api/v2/applications/reconcile", {
      data: { operationKey: randomBytes(32).toString("hex") },
    });
    expect(stranger.status()).toBe(200);
    expect(await stranger.json()).toEqual({ data: { outcome: "not_found" } });
    const reused = await request.post("/api/v2/applications", {
      data: { ...input, username: `${input.username}.new` },
      headers: { "cf-connecting-ip": "198.51.100.19" },
    });
    expect(reused.status()).toBe(409);
    const keyHash = createHash("sha256")
      .update(Buffer.from(input.operationKey, "hex"))
      .digest("hex");
    const stored = await caseApp.db
      .prepare(
        "SELECT id, operation_key_hash, status FROM membership_application WHERE operation_key_hash = ?"
      )
      .bind(keyHash)
      .all<{ id: string; operation_key_hash: string; status: string }>()
      .then(({ results }) => results);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      operation_key_hash: keyHash,
      status: "pending",
    });
    const owner = await caseApp.db
      .prepare(
        "SELECT u.username FROM membership_application a INNER JOIN user u ON u.id = a.user_id WHERE a.operation_key_hash = ?"
      )
      .bind(keyHash)
      .first<{ username: string }>();
    expect(owner?.username).toBe(input.username);
    const projection = await caseApp.db
      .prepare(
        "SELECT p.staff_search_key FROM person_profile p INNER JOIN user u ON u.id = p.user_id WHERE u.username = ?"
      )
      .bind(input.username)
      .first<{ staff_search_key: string | null }>();
    expect(projection).toEqual({
      staff_search_key: `${input.fullName} ${input.username}`.toLowerCase(),
    });
  }
);

dedicatedTest(
  "competing duplicate submissions leave exactly one complete canonical identity",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-atomicity",
      "@risk-concurrency",
    ],
  },
  async ({ caseApp, request }) => {
    const input = applicationInput();
    const responses = await Promise.all(
      [0, 1].map((index) =>
        request.post("/api/v2/applications", {
          data: {
            ...input,
            operationKey: randomBytes(32).toString("hex"),
            username:
              index === 0 ? input.username : input.username.toUpperCase(),
          },
          headers: { "cf-connecting-ip": `198.51.100.${20 + index}` },
        })
      )
    );
    expect(responses.map((response) => response.status()).toSorted()).toEqual([
      201, 409,
    ]);
    const rows = await caseApp.db
      .prepare(
        `WITH candidate AS (SELECT id FROM user WHERE username = ?) SELECT (SELECT count(*) FROM candidate) AS people, (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM candidate)) AS credentials, (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM candidate)) AS profiles, (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM candidate)) AS applications, (SELECT count(*) FROM audit_event WHERE action = 'self_application_created' AND target_user_id IN (SELECT id FROM candidate)) AS audits, (SELECT count(*) FROM username_reservation WHERE user_id IN (SELECT id FROM candidate)) AS reservations`
      )
      .bind(input.username)
      .all<{
        applications: number;
        audits: number;
        credentials: number;
        people: number;
        profiles: number;
        reservations: number;
      }>()
      .then(({ results }) => results);
    expect(rows).toEqual([
      {
        applications: 1,
        audits: 1,
        credentials: 1,
        people: 1,
        profiles: 1,
        reservations: 1,
      },
    ]);
  }
);

test(
  "new applications with duplicate Chinese names remain non-enumerating on native sign-in",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ request }) => {
    const first = applicationInput();
    const second = applicationInput();
    second.fullName = first.fullName;
    const creations = await Promise.all(
      [first, second].map((input, index) =>
        request.post("/api/v2/applications", {
          data: input,
          headers: { "cf-connecting-ip": `198.51.100.${25 + index}` },
        })
      )
    );
    expect(creations.map((response) => response.status())).toEqual([201, 201]);
    const ambiguous = await request.post("/api/auth/sign-in/name", {
      data: { fullName: first.fullName, password: first.password },
    });
    expect(ambiguous.status()).toBe(409);
    const body: unknown = await ambiguous.json();
    expect(body).toEqual({
      code: "NAME_AMBIGUOUS",
      message: "此中文姓名對應多個帳戶，請改用使用者名稱登入。",
    });
    expect(ambiguous.headers()["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(first.username);
    expect(JSON.stringify(body)).not.toContain(second.username);
  }
);

test(
  "invalid public inputs and cross-origin submissions never provision credentials",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-validation",
      "@risk-no-write",
      "@risk-origin",
    ],
  },
  async ({ caseApp, request }) => {
    const input = applicationInput();
    const invalidInputs = [
      { username: "x" },
      { email: "not-an-email" },
      { email: "no-email@efcc.invalid" },
      { email: "a@b.c" },
      { phone: "123" },
      { password: "short" },
      { membershipStatus: "active" },
    ];
    await Promise.all(
      invalidInputs.map(async (invalid, index) => {
        const response = await request.post("/api/v2/applications", {
          data: { ...input, ...invalid },
          headers: { "cf-connecting-ip": `198.51.100.${30 + index}` },
        });
        expect(response.status()).toBe(400);
      })
    );
    const crossOrigin = await request.post("/api/v2/applications", {
      data: input,
      headers: { origin: "https://untrusted.example.test" },
    });
    expect(crossOrigin.status()).toBe(403);
    const crossSiteMetadata = await request.post("/api/v2/applications", {
      data: input,
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSiteMetadata.status()).toBe(403);
    expect(await crossSiteMetadata.json()).toMatchObject({
      error: { code: "origin_denied" },
    });
    expect(
      await caseApp.db
        .prepare("select count(*) as people from user where username = ?")
        .bind(input.username)
        .all<{ people: number }>()
        .then(({ results }) => results)
    ).toEqual([{ people: 0 }]);
    const untouched = await caseApp.db
      .prepare(
        `SELECT (SELECT count(*) FROM user WHERE username IN (?, ?)) AS users, (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM user WHERE username IN (?, ?))) AS accounts, (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM user WHERE username IN (?, ?))) AS profiles, (SELECT count(*) FROM username_reservation WHERE username_key IN (?, ?)) AS reservations, (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM user WHERE username IN (?, ?))) AS applications, (SELECT count(*) FROM audit_event WHERE target_user_id IN (SELECT id FROM user WHERE username IN (?, ?))) AS audits`
      )
      .bind(
        "x",
        input.username,
        "x",
        input.username,
        "x",
        input.username,
        "x",
        input.username,
        "x",
        input.username,
        "x",
        input.username
      )
      .first<{
        accounts: number;
        applications: number;
        audits: number;
        profiles: number;
        reservations: number;
        users: number;
      }>();
    expect(untouched).toEqual({
      accounts: 0,
      applications: 0,
      audits: 0,
      profiles: 0,
      reservations: 0,
      users: 0,
    });
  }
);

dedicatedTest(
  "case-equivalent email and existing phone conflicts leave no second account",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-validation",
      "@risk-no-write",
      "@risk-atomicity",
    ],
  },
  async ({ caseApp, request }) => {
    const original = applicationInput();
    const created = await request.post("/api/v2/applications", {
      data: original,
      headers: { "cf-connecting-ip": "198.51.100.40" },
    });
    expect(created.status()).toBe(201);
    await Promise.all(
      [{ email: original.email.toUpperCase() }, { phone: original.phone }].map(
        async (contact, index) => {
          const candidate = { ...applicationInput(), ...contact };
          const response = await request.post("/api/v2/applications", {
            data: candidate,
            headers: { "cf-connecting-ip": `198.51.100.${41 + index}` },
          });
          expect(response.status()).toBe(409);
          expect(
            await caseApp.db
              .prepare("select count(*) as people from user where username = ?")
              .bind(candidate.username)
              .all<{ people: number }>()
              .then(({ results }) => results)
          ).toEqual([{ people: 0 }]);
          const outcome = await request.post("/api/v2/applications/reconcile", {
            data: { operationKey: candidate.operationKey },
            headers: { "cf-connecting-ip": `198.51.100.${43 + index}` },
          });
          expect(await outcome.json()).toEqual({
            data: { outcome: "not_found" },
          });
        }
      )
    );
  }
);

for (const fault of [
  "profile-abort",
  "profile-ignore",
  "profile-corrupt",
  "audit",
] as const) {
  dedicatedTest(
    `${fault} failure rolls back auth, application, reservation and required audit`,
    {
      tag: [
        "@native",
        "@account-application",
        "@http",
        "@risk-rollback",
        "@risk-atomicity",
      ],
    },
    async ({ caseApp, request }) => {
      const input = applicationInput();
      const before = await caseApp.db
        .prepare(`select
    (select count(*) from account) as accounts,
    (select count(*) from membership_application) as applications,
    (select count(*) from audit_event) as audits,
    (select count(*) from person_profile) as profiles,
    (select count(*) from username_reservation) as reservations,
    (select count(*) from user) as users`)
        .all<{
          accounts: number;
          applications: number;
          audits: number;
          profiles: number;
          reservations: number;
          users: number;
        }>()
        .then(({ results }) => results);
      const trigger = `application_failure_${fault.replaceAll("-", "_")}`;
      if (fault === "profile-corrupt") {
        await caseApp.db
          .prepare(`CREATE TRIGGER ${trigger} AFTER INSERT ON person_profile
            WHEN NEW.user_id = (SELECT id FROM user WHERE username = '${input.username}')
            BEGIN
              UPDATE person_profile SET staff_search_key = 'corrupt projection' WHERE user_id = NEW.user_id;
            END`)
          .run();
      } else {
        const table = fault === "audit" ? "audit_event" : "person_profile";
        const target = fault === "audit" ? "target_user_id" : "user_id";
        const failure =
          fault === "profile-ignore"
            ? "RAISE(IGNORE)"
            : "RAISE(ABORT, 'synthetic application fault')";
        await caseApp.db
          .prepare(`create trigger ${trigger} before insert on ${table}
            when NEW.${target} = (select id from user where username = '${input.username}')
            begin select ${failure}; end`)
          .run();
      }
      try {
        const response = await request.post("/api/v2/applications", {
          data: input,
          headers: {
            "cf-connecting-ip":
              fault === "profile-abort" ? "198.51.100.50" : "198.51.100.51",
          },
        });
        expect(response.status()).toBe(500);
        expect(await response.json()).toEqual({
          error: {
            code: "internal_error",
            message: "系統暫時無法完成請求，請稍後再試。",
          },
        });
        expect(
          await caseApp.db
            .prepare(`select
        (select count(*) from account) as accounts,
        (select count(*) from membership_application) as applications,
        (select count(*) from audit_event) as audits,
        (select count(*) from person_profile) as profiles,
        (select count(*) from username_reservation) as reservations,
        (select count(*) from user) as users`)
            .all()
            .then(({ results }) => results)
        ).toEqual(before);
        const reconciled = await request.post(
          "/api/v2/applications/reconcile",
          {
            data: { operationKey: input.operationKey },
          }
        );
        expect(await reconciled.json()).toEqual({
          data: { outcome: "not_found" },
        });
      } finally {
        await caseApp.db.prepare(`drop trigger ${trigger}`).run();
      }
      const recovered = await request.post("/api/v2/applications", {
        data: input,
        headers: {
          "cf-connecting-ip":
            fault === "profile-abort" ? "198.51.100.52" : "198.51.100.53",
        },
      });
      expect(recovered.status()).toBe(201);
      const recoveredProjection = await caseApp.db
        .prepare(
          "SELECT p.staff_search_key FROM person_profile p INNER JOIN user u ON u.id = p.user_id WHERE u.username = ?"
        )
        .bind(input.username)
        .first<{ staff_search_key: string | null }>();
      expect(recoveredProjection).toEqual({
        staff_search_key: `${input.fullName} ${input.username}`.toLowerCase(),
      });
    }
  );
}

test(
  "oversized bodies, malformed JSON, invalid content types and placeholder emails reject writes",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-validation",
      "@risk-no-write",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, request }) => {
    const input = applicationInput();
    const oversized = await request.post("/api/v2/applications", {
      data: JSON.stringify({ ...input, intent: "x".repeat(9000) }),
      headers: {
        "cf-connecting-ip": "198.51.100.90",
        "content-type": "application/json",
      },
    });
    expect(oversized.status()).toBe(400);
    const wrongContentType = await request.post("/api/v2/applications", {
      data: input,
      headers: {
        "cf-connecting-ip": "198.51.100.91",
        "content-type": "text/plain",
      },
    });
    expect(wrongContentType.status()).toBe(400);
    const control = applicationInput();
    const healthy = await request.post("/api/v2/applications", {
      data: control,
      headers: { "cf-connecting-ip": "198.51.100.100" },
    });
    expect(healthy.status()).toBe(201);
    expect(await healthy.json()).toEqual({ data: { outcome: "pending" } });
    const controlState = await caseApp.db
      .prepare(
        `WITH candidate AS (SELECT id FROM user WHERE username = ?) SELECT (SELECT count(*) FROM candidate) AS users, (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM candidate)) AS accounts, (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM candidate)) AS profiles, (SELECT count(*) FROM username_reservation WHERE user_id IN (SELECT id FROM candidate)) AS reservations, (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM candidate)) AS applications, (SELECT count(*) FROM audit_event WHERE target_user_id IN (SELECT id FROM candidate)) AS audits`
      )
      .bind(control.username)
      .first<{
        accounts: number;
        applications: number;
        audits: number;
        profiles: number;
        reservations: number;
        users: number;
      }>();
    expect(controlState).toEqual({
      accounts: 1,
      applications: 1,
      audits: 1,
      profiles: 1,
      reservations: 1,
      users: 1,
    });
    const malformedJson = await request.post("/api/v2/applications", {
      data: '{"operationKey":',
      headers: {
        "cf-connecting-ip": "198.51.100.95",
        "content-type": "application/json",
      },
    });
    expect(malformedJson.status()).toBe(400);
    expect(await malformedJson.json()).toEqual({
      error: {
        code: "validation_error",
        message: "申請資料格式不正確。",
      },
    });
    const reservedEmail = await request.post("/api/v2/applications", {
      data: { ...input, email: "nobody@example.invalid" },
      headers: { "cf-connecting-ip": "198.51.100.92" },
    });
    expect(reservedEmail.status()).toBe(400);
    const untouched = await caseApp.db
      .prepare(
        `WITH candidate AS (SELECT id FROM user WHERE username = ?) SELECT (SELECT count(*) FROM candidate) AS users, (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM candidate)) AS accounts, (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM candidate)) AS profiles, (SELECT count(*) FROM username_reservation WHERE user_id IN (SELECT id FROM candidate)) AS reservations, (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM candidate)) AS applications, (SELECT count(*) FROM audit_event WHERE target_user_id IN (SELECT id FROM candidate)) AS audits`
      )
      .bind(input.username)
      .first<{
        accounts: number;
        applications: number;
        audits: number;
        profiles: number;
        reservations: number;
        users: number;
      }>();
    expect(untouched).toEqual({
      accounts: 0,
      applications: 0,
      audits: 0,
      profiles: 0,
      reservations: 0,
      users: 0,
    });
  }
);

test(
  "parameterized JSON content types outside Hono's own grammar still reach the schema",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-validation",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, request }) => {
    const input = applicationInput();
    const created = await request.post("/api/v2/applications", {
      data: JSON.stringify(input),
      headers: {
        "cf-connecting-ip": "198.51.100.97",
        "content-type": "application/json; profile_id=example",
      },
    });
    expect(created.status()).toBe(201);
    expect(await created.json()).toEqual({ data: { outcome: "pending" } });

    const reconciled = await request.post("/api/v2/applications/reconcile", {
      data: JSON.stringify({ operationKey: input.operationKey }),
      headers: {
        "cf-connecting-ip": "198.51.100.98",
        "content-type": "application/json; profile_id=example",
      },
    });
    expect(reconciled.status()).toBe(200);
    expect(await reconciled.json()).toEqual({ data: { outcome: "pending" } });

    const malformed = await request.post("/api/v2/applications/reconcile", {
      data: '{"operationKey":',
      headers: {
        "cf-connecting-ip": "198.51.100.99",
        "content-type": "application/json; profile_id=example",
      },
    });
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toEqual({
      error: {
        code: "validation_error",
        message: "申請資料格式不正確。",
      },
    });
    const persisted = await caseApp.db
      .prepare(
        `WITH candidate AS (SELECT id FROM user WHERE username = ?) SELECT (SELECT count(*) FROM candidate) AS users, (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM candidate)) AS accounts, (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM candidate)) AS profiles, (SELECT count(*) FROM username_reservation WHERE user_id IN (SELECT id FROM candidate)) AS reservations, (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM candidate)) AS applications, (SELECT count(*) FROM audit_event WHERE target_user_id IN (SELECT id FROM candidate)) AS audits`
      )
      .bind(input.username)
      .first<{
        accounts: number;
        applications: number;
        audits: number;
        profiles: number;
        reservations: number;
        users: number;
      }>();
    expect(persisted).toEqual({
      accounts: 1,
      applications: 1,
      audits: 1,
      profiles: 1,
      reservations: 1,
      users: 1,
    });
  }
);

test(
  "invalid UTF-8 application JSON returns validation_error without creating records",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-validation",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, request }) => {
    const input = { ...applicationInput(), fullName: "abc" };
    const body = Buffer.from(JSON.stringify(input));
    const marker = Buffer.from('"fullName":"abc"');
    const nameOffset = body.indexOf(marker);
    if (nameOffset === -1) {
      throw new Error("Synthetic application name missing from JSON body");
    }
    body[nameOffset + Buffer.byteLength('"fullName":"')] = 0xff;

    const response = await request.post("/api/v2/applications", {
      data: body,
      headers: {
        "cf-connecting-ip": "198.51.100.96",
        "content-type": "application/json",
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "validation_error",
        message: "申請資料格式不正確。",
      },
    });
    expect(
      await caseApp.db
        .prepare(`SELECT
    (SELECT count(*) FROM user WHERE username='${input.username}') AS users,
    (SELECT count(*) FROM account WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS credentials,
    (SELECT count(*) FROM person_profile WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS profiles,
    (SELECT count(*) FROM username_reservation WHERE username_key='${input.username}') AS reservations,
    (SELECT count(*) FROM audit_event WHERE target_user_id=(SELECT id FROM user WHERE username='${input.username}')) AS audits,
    (SELECT count(*) FROM membership_application WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS applications`)
        .all()
        .then(({ results }) => results)
    ).toEqual([
      {
        applications: 0,
        audits: 0,
        credentials: 0,
        profiles: 0,
        reservations: 0,
        users: 0,
      },
    ]);
  }
);

test(
  "reload reconciles committed applications without retaining form secrets",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, page }) => {
    const suffix = randomBytes(6).toString("hex");
    const username = `reload.${suffix}`;
    const fullName = `陳重載${suffix}`;
    const password = "Synthetic-reload-password!";
    const phone = String(
      50_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)
    );
    await page.goto("/apply");
    await page.locator('input[name="phone"]').fill(phone);
    await page.locator('input[name="fullName"]').fill(fullName);
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="email"]').fill(`${username}@example.test`);
    await page.locator('input[name="password"]').fill(password);
    let committedWithoutResponse = false;
    let reconciliationCalls = 0;
    await page.route("**/api/v2/applications", async (route) => {
      if (route.request().method() === "POST" && !committedWithoutResponse) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        committedWithoutResponse = true;
        await route.abort();
        return;
      }
      await route.continue();
    });
    page.on("request", (outgoing) => {
      if (
        new URL(outgoing.url()).pathname === "/api/v2/applications/reconcile"
      ) {
        reconciliationCalls += 1;
      }
    });
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    await expect(page.getByText(fullName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(username, { exact: true })).toHaveCount(0);
    const committedRows = await caseApp.db
      .prepare(`select
  (select count(*) from membership_application where user_id =
    (select id from user where username = '${username.toLowerCase()}')) as applications,
  (select count(*) from user where username = '${username.toLowerCase()}') as users`)
      .all<{ applications: number; users: number }>()
      .then(({ results }) => results);
    expect(committedRows).toEqual([{ applications: 1, users: 1 }]);
    await page.reload();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    await expect(page.getByText(fullName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(username, { exact: true })).toHaveCount(0);
    expect(reconciliationCalls).toBeGreaterThan(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const record = await caseApp.db
      .prepare(`select u.name as name, u.username as username, u.email as email,
  a.password as password, u.id as id,
  p.phone as profilePhone
  from user u
  inner join account a on a.user_id = u.id
  inner join person_profile p on p.user_id = u.id
  where u.username = '${username.toLowerCase()}'`)
      .all<{
        email: string;
        name: string;
        password: string;
        phone: string;
        profilePhone: string;
        username: string;
      }>()
      .then(({ results }) => results);
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({
      email: `${username}@example.test`,
      name: fullName,
      profilePhone: `+852${phone}`,
      username: username.toLowerCase(),
    });
    expect(record[0]?.password).not.toBe(password);
  }
);

dedicatedTest(
  "application operation limiter permits ten requests and rate-limits later requests per action and IP",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-rate-limit",
      "@risk-recovery",
    ],
  },
  async ({ request }) => {
    const key = randomBytes(32).toString("hex");
    const headers = { "cf-connecting-ip": "198.51.100.93" };
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        request.post("/api/v2/applications/reconcile", {
          data: { operationKey: key },
          headers,
        })
      )
    );
    expect(attempts.map((response) => response.status()).toSorted()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429,
    ]);
  }
);

test(
  "mobile application form is labelled, keyboard/paste ready and reaches Pending",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-accessibility",
      "@risk-auth",
      "@risk-rate-limit",
      "@risk-recovery",
    ],
  },
  async ({ browserName, caseApp, page }) => {
    {
      const input = applicationInput();
      if (browserName === "chromium") {
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"], {
            origin: caseApp.origin,
          });
      }
      await page.goto("/apply");
      await expect(page.getByLabel("電話號碼")).toBeVisible();
      await page.evaluate((clipboardText) => {
        const summary = document.querySelector("details > summary");
        if (!(summary instanceof HTMLElement)) {
          throw new Error("Application optional-fields disclosure is missing.");
        }
        document.documentElement.dataset.clipboardWrite = "pending";
        summary.addEventListener(
          "click",
          () => {
            void navigator.clipboard.writeText(clipboardText).then(
              () => {
                document.documentElement.dataset.clipboardWrite = "ready";
              },
              () => {
                document.documentElement.dataset.clipboardWrite = "failed";
              }
            );
          },
          { once: true }
        );
      }, input.phone);
      await page.locator("details > summary").click();
      await page.waitForFunction(
        () => document.documentElement.dataset.clipboardWrite !== "pending"
      );
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.clipboardWrite
        )
      ).toBe("ready");
      const measurements = await page.evaluate(() => ({
        bodyFontSize: Number(
          getComputedStyle(document.body).fontSize.slice(0, -2)
        ),
        controls: [...document.querySelectorAll("button, input, textarea")].map(
          (element) => {
            const { height, width } = element.getBoundingClientRect();
            return { height, width };
          }
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(measurements.bodyFontSize).toBeGreaterThanOrEqual(17);
      expect(measurements.overflow).toBe(false);
      expect(
        measurements.controls.every(
          ({ height, width }) => height >= 44 && width >= 44
        )
      ).toBe(true);

      await expect(page.getByLabel("電話號碼")).toHaveAttribute(
        "autocomplete",
        "tel"
      );
      await expect(page.getByLabel("中文全名")).toHaveAttribute(
        "autocomplete",
        "name"
      );
      await expect(
        page.getByLabel("設定密碼", { exact: true })
      ).toHaveAttribute("autocomplete", "new-password");

      await page.getByLabel("電話號碼").focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+V" : "Control+V"
      );
      await expect(page.getByLabel("電話號碼")).toHaveValue(input.phone);
      await page.getByLabel("中文全名").fill(input.fullName);
      await page.getByLabel("Username", { exact: true }).fill(input.username);
      await page.getByLabel("電郵地址").fill(input.email);
      await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
      await page.getByLabel("介紹人").fill("合成介紹人");
      await page.getByLabel("小組").fill("合成小組");
      await page.getByLabel("申請原因或補充資料").fill("合成申請原因");

      const applicationEndpoint = "**/api/v2/applications";
      const responseArrived = Promise.withResolvers<{
        body: Record<string, unknown>;
        status: number;
      }>();
      const releaseResponse = Promise.withResolvers<boolean>();
      const requestSettled = Promise.withResolvers<boolean>();
      let submissions = 0;
      const submittedKeys: string[] = [];
      await page.route(applicationEndpoint, async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        submissions += 1;
        try {
          const body = route.request().postDataJSON() as Record<
            string,
            unknown
          >;
          submittedKeys.push(String(body.operationKey));
          if (submissions === 1) {
            await route.fulfill({
              contentType: "application/json",
              json: {
                error: { code: "rate_limited", message: "Too many requests" },
              },
              status: 429,
            });
            return;
          }
          const response = await route.fetch();
          responseArrived.resolve({
            body,
            status: response.status(),
          });
          await releaseResponse.promise;
          await route.fulfill({ response });
        } catch (error) {
          responseArrived.reject(error);
          throw error;
        } finally {
          if (submissions > 1) {
            requestSettled.resolve(true);
          }
        }
      });
      try {
        await page.getByLabel("電郵地址").press("Enter");
        await expect(page.getByRole("status")).toContainText("提交次數較多");
        await expect(page.getByRole("status")).toContainText("同一申請編號");
        expect(submissions).toBe(1);
        await expect(
          page.getByRole("button", { name: "提交申請" })
        ).toBeEnabled();
        await Promise.all(
          (
            [
              ["電話號碼", input.phone],
              ["中文全名", input.fullName],
              ["Username", input.username],
              ["電郵地址", input.email],
              ["設定密碼", input.password],
              ["介紹人", "合成介紹人"],
              ["小組", "合成小組"],
              ["申請原因或補充資料", "合成申請原因"],
            ] as const
          ).map(async ([label, value]) => {
            await expect(page.getByLabel(label, { exact: true })).toHaveValue(
              value
            );
          })
        );
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.account-application.operationKey.v1")
          )
        ).toBe(submittedKeys[0]);
        expect(
          await caseApp.db
            .prepare("select count(*) as people from user where username = ?")
            .bind(input.username)
            .all<{ people: number }>()
            .then(({ results }) => results)
        ).toEqual([{ people: 0 }]);
        const limitedSession = await page.request.get("/api/auth/get-session");
        expect(await limitedSession.json()).toBeNull();
        await page.getByRole("button", { name: "提交申請" }).click();
        const submission = await responseArrived.promise;
        expect(submissions).toBe(2);
        expect(submission.status).toBe(201);
        await expect(
          page.getByRole("button", { name: "正在處理…" })
        ).toBeDisabled();
        await expect(
          page.locator('fieldset button[type="button"]')
        ).toBeDisabled();
        await Promise.all(
          (
            [
              ["電話號碼", input.phone],
              ["中文全名", input.fullName],
              ["Username", input.username],
              ["電郵地址", input.email],
              ["設定密碼", input.password],
              ["介紹人", "合成介紹人"],
              ["小組", "合成小組"],
              ["申請原因或補充資料", "合成申請原因"],
            ] as const
          ).map(async ([label, value]) => {
            const field = page.getByLabel(label, { exact: true });
            await expect(field).toHaveValue(value);
            await expect(field).toBeDisabled();
          })
        );

        const operationKey = await page.evaluate(
          (storageKey) => localStorage.getItem(storageKey),
          "efcc.account-application.operationKey.v1"
        );
        if (operationKey === null) {
          throw new Error("The application operation reference was not saved.");
        }
        expect(submission.body).toMatchObject({
          email: input.email,
          fullName: input.fullName,
          group: "合成小組",
          intent: "合成申請原因",
          operationKey,
          password: input.password,
          referral: "合成介紹人",
          username: input.username,
        });
        await page.keyboard.press("Enter");
      } finally {
        releaseResponse.resolve(true);
        if (submissions > 1) {
          await requestSettled.promise;
        }
        await page.unroute(applicationEndpoint);
      }
      expect(submissions).toBe(2);
      expect(submittedKeys).toHaveLength(2);
      expect(submittedKeys[1]).toBe(submittedKeys[0]);
      expect(
        await caseApp.db
          .prepare(`select count(*) as people,
          (select count(*) from membership_application where user_id in
              (select id from user where username = '${input.username}')) as applications,
          (select count(*) from audit_event where action = 'self_application_created'
              and target_user_id in (select id from user where username = '${input.username}')) as audits
          from user where username = '${input.username}'`)
          .all<{ applications: number; audits: number; people: number }>()
          .then(({ results }) => results)
      ).toEqual([{ applications: 1, audits: 1, people: 1 }]);
      await expect(
        page.getByRole("button", { name: "前往登入" })
      ).toBeVisible();
      expect(
        await page.evaluate((secret) => {
          for (const storage of [localStorage, sessionStorage]) {
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              if (key && storage.getItem(key)?.includes(secret)) {
                return true;
              }
            }
          }
          return false;
        }, input.password)
      ).toBe(false);
      const publicRead = await page.request.get("/api/v2/me");
      expect(publicRead.status()).toBe(401);
      const completedSession = await page.request.get("/api/auth/get-session");
      expect(await completedSession.json()).toBeNull();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
    }
  }
);

test(
  "full-name boundary rejects 101 code points on the field and the server",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@risk-validation",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, page, request }) => {
    const writes: string[] = [];
    page.on("request", (browserRequest) => {
      if (
        browserRequest.method() === "POST" &&
        new URL(browserRequest.url()).pathname === "/api/v2/applications"
      ) {
        writes.push(browserRequest.url());
      }
    });
    const input = applicationInput();
    await page.goto("/apply");
    const fullName = page.getByLabel("中文全名", { exact: true });
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
    await fullName.fill("陳".repeat(101));
    await fullName.blur();
    await expect(fullName).toHaveAttribute("aria-invalid", "true");

    await expect(page.getByRole("button", { name: "提交申請" })).toBeDisabled();
    await fullName.press("Enter");
    await expect(
      page.getByText("中文全名不可多於 100 個字元。", { exact: true })
    ).toBeVisible();
    await expect(fullName).toHaveValue("陳".repeat(101));
    expect(writes).toEqual([]);
    const rejected = await request.post("/api/v2/applications", {
      data: { ...input, fullName: "陳".repeat(101) },
      headers: { "cf-connecting-ip": "198.51.100.94" },
    });
    expect(rejected.status()).toBe(400);
    const untouched = await caseApp.db
      .prepare(
        `WITH candidate AS (SELECT id FROM user WHERE username = ?) SELECT (SELECT count(*) FROM candidate) AS users, (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM candidate)) AS accounts, (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM candidate)) AS profiles, (SELECT count(*) FROM username_reservation WHERE user_id IN (SELECT id FROM candidate)) AS reservations, (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM candidate)) AS applications, (SELECT count(*) FROM audit_event WHERE target_user_id IN (SELECT id FROM candidate)) AS audits`
      )
      .bind(input.username)
      .first<{
        accounts: number;
        applications: number;
        audits: number;
        profiles: number;
        reservations: number;
        users: number;
      }>();
    expect(untouched).toEqual({
      accounts: 0,
      applications: 0,
      audits: 0,
      profiles: 0,
      reservations: 0,
      users: 0,
    });
  }
);

test(
  "unsent public application can be resumed or discarded without saving it",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-draft",
      "@risk-privacy",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, page }) => {
    {
      const input = applicationInput();
      let submissions = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === "/api/v2/applications"
        ) {
          submissions += 1;
        }
      });
      await page.goto("/apply");
      await page.getByLabel("電話號碼").fill(input.phone);
      await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
      expect(
        await page.evaluate(
          (password) => ({
            keys: [localStorage, sessionStorage].flatMap((storage) =>
              Array.from({ length: storage.length }, (_, index) =>
                storage.key(index)
              )
            ),
            passwordStored: [localStorage, sessionStorage].some((storage) =>
              Array.from({ length: storage.length }, (_, index) =>
                storage.getItem(storage.key(index) ?? "")
              ).includes(password)
            ),
          }),
          input.password
        )
      ).toEqual({ keys: [], passwordStored: false });
      expect(
        await page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        })
      ).toBe(true);

      const backToSignIn = page.getByRole("link", {
        exact: true,
        name: "返回登入",
      });
      await backToSignIn.click();
      await expect(
        page.getByRole("heading", { name: "放棄未提交的更改？" })
      ).toBeVisible();
      await page.getByRole("button", { name: "繼續編輯" }).click();
      await expect(page.getByLabel("電話號碼")).toHaveValue(input.phone);
      await expect(page.getByLabel("設定密碼", { exact: true })).toHaveValue(
        input.password
      );

      await backToSignIn.click();
      await page.getByRole("button", { name: "放棄變更" }).click();
      await expect(page).toHaveURL(/\/sign-in$/u);
      await page.goto("/apply");
      await expect(page.getByLabel("電話號碼")).toHaveValue("");
      await expect(page.getByLabel("設定密碼", { exact: true })).toHaveValue(
        ""
      );
      expect(submissions).toBe(0);
      expect(
        await caseApp.db
          .prepare("SELECT id FROM user WHERE username = ?")
          .bind(input.username)
          .all()
          .then(({ results }) => results)
      ).toHaveLength(0);
    }
  }
);

test(
  "public application remains usable on desktop and at 320px with 200% text",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-responsive",
      "@risk-draft",
    ],
  },
  async ({ page }) => {
    {
      const input = applicationInput();
      await page.goto("/apply");
      const desktopLayout = await (async () => {
        await page.setViewportSize({ height: 1024, width: 1440 });
        return page.evaluate(() => ({
          mainWidth: document.querySelector("main")?.getBoundingClientRect()
            .width,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
      })();
      expect(desktopLayout.mainWidth).toBeLessThanOrEqual(448);
      expect(desktopLayout.overflow).toBe(false);

      await page.setViewportSize({ height: 568, width: 320 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.getByLabel("電話號碼").fill(input.phone);
      await page.getByLabel("中文全名").fill(input.fullName);
      await page.getByLabel("Username", { exact: true }).fill(input.username);
      await page.getByLabel("電郵地址").fill(input.email);
      await page.getByLabel("設定密碼", { exact: true }).fill(input.password);

      const pageSize = await page.evaluate(() => ({
        height: innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
      }));
      expect(pageSize.width).toBe(320);
      expect(pageSize.scrollWidth).toBeLessThanOrEqual(pageSize.width);
      expect(pageSize.scrollHeight).toBeGreaterThan(pageSize.height);

      const submit = page.getByRole("button", { name: "提交申請" });
      await expect(submit).toBeEnabled();
      await submit.scrollIntoViewIfNeeded();
      const submitBox = await submit.boundingBox();
      if (!submitBox) {
        throw new Error(
          "The submit button should have a visible box after scrolling"
        );
      }
      expect(submitBox.x).toBeGreaterThanOrEqual(0);
      expect(submitBox.x + submitBox.width).toBeLessThanOrEqual(pageSize.width);
      expect(submitBox.y).toBeGreaterThanOrEqual(0);
      expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(
        pageSize.height
      );
      expect(
        await page.evaluate(() =>
          [localStorage, sessionStorage].some((storage) =>
            Array.from({ length: storage.length }, (_, index) =>
              storage.getItem(storage.key(index) ?? "")
            ).some((value) => value?.includes("Synthetic-password-17!"))
          )
        )
      ).toBe(false);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.account-application.operationKey.v1")
        )
      ).toBeNull();
    }
  }
);

test(
  "an unreadable saved application reference blocks a blank application",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-no-write",
    ],
  },
  async ({ page }) => {
    const key = "efcc.account-application.operationKey.v1";
    await page.addInitScript((storageKey) => {
      localStorage.setItem(storageKey, "unreadable-application-reference");
    }, key);
    await page.goto("/apply");

    await expect(page.getByLabel("電話號碼")).toHaveCount(0);
    const recoveryAction = page.getByRole("button");
    await recoveryAction.click();
    await expect(page.getByLabel("電話號碼")).toHaveCount(0);
    expect(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
    ).toBe("unreadable-application-reference");
  }
);

test(
  "an invalid reference added after startup is never overwritten by submit",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-no-write",
    ],
  },
  async ({ page }) => {
    const key = "efcc.account-application.operationKey.v1";
    const input = applicationInput();
    await page.goto("/apply");
    await page.evaluate(
      (storageKey) => localStorage.setItem(storageKey, ""),
      key
    );
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);

    let submissions = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/v2/applications" &&
        request.method() === "POST"
      ) {
        submissions += 1;
      }
    });
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByLabel("電話號碼")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "提交申請" })).toHaveCount(0);
    const recoveryAction = page.getByRole("button");
    await expect(recoveryAction).toBeVisible();
    expect(submissions).toBe(0);
    expect(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
    ).toBe("");
    await recoveryAction.click();
    await expect(page.getByRole("button", { name: "提交申請" })).toBeVisible();
    await expect(page.getByLabel("電話號碼")).toHaveValue(input.phone);
  }
);

test(
  "application submission waits until its operation reference can be stored",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-no-write",
    ],
  },
  async ({ caseApp, page }) => {
    const key = "efcc.account-application.operationKey.v1";
    const input = applicationInput();
    await page.addInitScript((storageKey) => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(name, value) {
        if (name === storageKey) {
          throw new DOMException(
            "Storage is unavailable",
            "QuotaExceededError"
          );
        }
        originalSetItem.call(this, name, value);
      };
    }, key);
    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
    await page.locator("details > summary").click();
    await page.getByLabel("介紹人").fill("合成介紹人");
    await page.getByLabel("小組").fill("合成小組");
    await page.getByLabel("申請原因或補充資料").fill("合成申請原因");

    let submissions = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/v2/applications" &&
        request.method() === "POST"
      ) {
        submissions += 1;
      }
    });
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByLabel("電話號碼")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "提交申請" })).toHaveCount(0);
    const recoveryAction = page.getByRole("button");
    await expect(recoveryAction).toBeVisible();
    expect(submissions).toBe(0);
    expect(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
    ).toBeNull();
    await recoveryAction.click();
    await expect(page.getByRole("button", { name: "提交申請" })).toBeVisible();
    await Promise.all(
      (
        [
          ["電話號碼", input.phone],
          ["中文全名", input.fullName],
          ["Username", input.username],
          ["電郵地址", input.email],
          ["設定密碼", input.password],
          ["介紹人", "合成介紹人"],
          ["小組", "合成小組"],
          ["申請原因或補充資料", "合成申請原因"],
        ] as const
      ).map(([label, value]) =>
        expect(page.getByLabel(label, { exact: true })).toHaveValue(value)
      )
    );
    expect(
      await caseApp.db
        .prepare("SELECT id FROM user WHERE username = ?")
        .bind(input.username)
        .all()
        .then(({ results }) => results)
    ).toHaveLength(0);
  }
);

test(
  "a confirmed application can clear its reference before another blank application",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
    ],
  },
  async ({ page }) => {
    const input = applicationInput();
    const key = "efcc.account-application.operationKey.v1";
    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
    const optional = page.locator("details");
    await expect(optional).not.toHaveAttribute("open");
    await optional.locator("summary").click();
    await page.getByLabel("介紹人", { exact: true }).fill("合成介紹人");
    await optional.locator("summary").click();
    await expect(optional).not.toHaveAttribute("open");
    await optional.locator("summary").click();
    await expect(page.getByLabel("介紹人", { exact: true })).toHaveValue(
      "合成介紹人"
    );
    await optional.locator("summary").click();
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    await expect(page.getByText(input.fullName, { exact: true })).toBeVisible();
    await expect(page.getByText(input.username, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    await expect(page.getByText(input.fullName, { exact: true })).toHaveCount(
      0
    );
    await expect(page.getByText(input.username, { exact: true })).toHaveCount(
      0
    );
    expect(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
    ).not.toBeNull();

    await page
      .getByRole("button", { name: "清除此裝置記錄，開始另一份申請" })
      .click();
    await expect(page.getByLabel("電話號碼")).toHaveValue("");
    await expect(page.getByLabel("設定密碼", { exact: true })).toHaveValue("");
    expect(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
    ).toBeNull();
  }
);

test(
  "a duplicate submission response does not reconstruct current-only identity",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ page }) => {
    const input = applicationInput();
    await page.route("**/api/v2/applications", async (route) => {
      const created = await route.fetch();
      expect(created.status()).toBe(201);
      const replay = await page.request.post(route.request().url(), {
        data: route.request().postDataJSON(),
      });
      expect(replay.status()).toBe(200);
      await route.fulfill({ response: replay });
    });
    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    await expect(page.getByText(input.fullName, { exact: true })).toHaveCount(
      0
    );
    await expect(page.getByText(input.username, { exact: true })).toHaveCount(
      0
    );
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  }
);

test(
  "an uncertain public submission retries with the same operation reference",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-actor-target-key",
    ],
  },
  async ({ page }) => {
    const input = applicationInput();
    const operationKeys: string[] = [];
    let droppedFirstSubmission = false;
    await page.route("**/api/v2/applications*", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (
        pathname === "/api/v2/applications" &&
        route.request().method() === "POST"
      ) {
        const body = route.request().postDataJSON() as { operationKey: string };
        operationKeys.push(body.operationKey);
        if (!droppedFirstSubmission) {
          droppedFirstSubmission = true;
          await route.abort();
          return;
        }
      }
      await route.continue();
    });

    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByText(/查核後未找到已完成的申請/u)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "清除此裝置記錄，開始另一份申請" })
    ).toHaveCount(0);
    expect(operationKeys).toHaveLength(1);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.account-application.operationKey.v1")
      )
    ).toBe(operationKeys[0]);

    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    expect(operationKeys).toHaveLength(2);
    expect(operationKeys[1]).toBe(operationKeys[0]);
  }
);

test(
  "a public application conflict hides its form until its reference is checked",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-no-write",
    ],
  },
  async ({ page, request }) => {
    const existing = applicationInput();
    const established = await request.post("/api/v2/applications", {
      data: existing,
    });
    expect(established.status()).toBe(201);

    const conflicting = { ...applicationInput(), phone: existing.phone };
    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(conflicting.phone);
    await page.getByLabel("中文全名").fill(conflicting.fullName);
    await page
      .getByLabel("Username", { exact: true })
      .fill(conflicting.username);
    await page.getByLabel("電郵地址").fill(conflicting.email);
    await page
      .getByLabel("設定密碼", { exact: true })
      .fill(conflicting.password);
    await page.getByRole("button", { name: "提交申請" }).click();

    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByLabel("電話號碼")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "提交申請" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "重新查核申請結果" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "清除此裝置記錄，開始另一份申請" })
    ).toHaveCount(0);
  }
);
test(
  "a committed browser application survives response loss, Staff approval, replay and reconciliation",
  {
    tag: [
      "@native",
      "@account-application",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-authority",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, staff, page }) => {
    const input = applicationInput();
    let droppedResponse = false;
    await page.route("**/api/v2/applications", async (route) => {
      if (route.request().method() === "POST" && !droppedResponse) {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        droppedResponse = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("Username", { exact: true }).fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(input.password);
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();

    const operationKey = await page.evaluate(() =>
      localStorage.getItem("efcc.account-application.operationKey.v1")
    );
    expect(operationKey).toMatch(/^[0-9a-f]{64}$/u);
    const [application] = await caseApp.db
      .prepare(`SELECT a.id FROM membership_application a
 JOIN user u ON u.id=a.user_id
 WHERE u.username='${input.username}'`)
      .all<{ id: string }>()
      .then(({ results }) => results);
    if (!application || !operationKey) {
      throw new Error("Committed synthetic application is missing");
    }

    const decision = await staff.context.post(
      "/api/v2/staff/application-decisions",
      {
        data: {
          applicationId: application.id,
          operationKey: randomUUID(),
          outcome: "approved",
        },
        headers: { "cf-connecting-ip": "198.51.100.241" },
      }
    );
    expect(decision.status()).toBe(201);

    await page.reload();
    await expect(page.getByRole("button", { name: "前往登入" })).toBeVisible();
    const replay = await page.evaluate(
      async (body) => {
        const response = await fetch("/api/v2/applications", {
          body: JSON.stringify(body),
          cache: "no-store",
          credentials: "omit",
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        return { body: await response.json(), status: response.status };
      },
      { ...input, operationKey }
    );
    expect(replay).toEqual({
      body: { data: { outcome: "pending" } },
      status: 200,
    });
    const reconciliation = await page.evaluate(async (key) => {
      const response = await fetch("/api/v2/applications/reconcile", {
        body: JSON.stringify({ operationKey: key }),
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return { body: await response.json(), status: response.status };
    }, operationKey);
    expect(reconciliation).toEqual({
      body: { data: { outcome: "pending" } },
      status: 200,
    });

    expect(
      await caseApp.db
        .prepare(`SELECT
    (SELECT count(*) FROM user WHERE username='${input.username}') AS users,
    (SELECT count(*) FROM account WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS credentials,
    (SELECT count(*) FROM person_profile WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS profiles,
    (SELECT count(*) FROM username_reservation WHERE username_key='${input.username}') AS reservations,
    (SELECT count(*) FROM audit_event WHERE target_user_id=(SELECT id FROM user WHERE username='${input.username}') AND action='self_application_created') AS applicationAudits,
    (SELECT count(*) FROM membership_application WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS applications,
    (SELECT count(*) FROM application_decision WHERE target_user_id=(SELECT id FROM user WHERE username='${input.username}')) AS decisions,
    (SELECT count(*) FROM audit_event WHERE target_user_id=(SELECT id FROM user WHERE username='${input.username}') AND action='application_approved') AS approvalAudits,
    (SELECT status FROM membership_application WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS applicationStatus,
    (SELECT membership_status FROM person_profile WHERE user_id=(SELECT id FROM user WHERE username='${input.username}')) AS membershipStatus`)
        .all()
        .then(({ results }) => results)
    ).toEqual([
      {
        applicationAudits: 1,
        applicationStatus: "approved",
        applications: 1,
        approvalAudits: 1,
        credentials: 1,
        decisions: 1,
        membershipStatus: "active",
        profiles: 1,
        reservations: 1,
        users: 1,
      },
    ]);
  }
);

test(
  "oversized streamed application bodies reject without writes and leave ingress usable",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-validation",
      "@risk-no-write",
      "@risk-recovery",
    ],
  },
  async ({ caseApp }) => {
    const invalid = applicationInput();
    const bytes = new TextEncoder().encode(
      JSON.stringify({ ...invalid, intent: "x".repeat(9000) })
    );
    const streamedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 4096));
        controller.enqueue(bytes.subarray(4096));
        controller.close();
      },
    });
    const streamedRequest: RequestInit & { duplex: "half" } = {
      body: streamedBody,
      duplex: "half",
      headers: {
        "cf-connecting-ip": "198.51.100.101",
        "content-type": "application/json",
        origin: caseApp.origin,
      },
      method: "POST",
    };
    const rejected = await fetch(
      `${caseApp.origin}/api/v2/applications`,
      streamedRequest
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      error: {
        code: "validation_error",
        message: "申請資料格式不正確。",
      },
    });
    expect(rejected.headers.get("cache-control")).toContain("no-store");

    interface Counts {
      accounts: number;
      applications: number;
      audits: number;
      profiles: number;
      reservations: number;
      users: number;
    }
    const readCounts = (username: string) =>
      caseApp.db
        .prepare(
          `WITH candidate AS (SELECT id FROM user WHERE username = ?)
           SELECT
             (SELECT count(*) FROM candidate) AS users,
             (SELECT count(*) FROM account WHERE user_id IN (SELECT id FROM candidate)) AS accounts,
             (SELECT count(*) FROM person_profile WHERE user_id IN (SELECT id FROM candidate)) AS profiles,
             (SELECT count(*) FROM username_reservation WHERE user_id IN (SELECT id FROM candidate)) AS reservations,
             (SELECT count(*) FROM membership_application WHERE user_id IN (SELECT id FROM candidate)) AS applications,
             (SELECT count(*) FROM audit_event WHERE target_user_id IN (SELECT id FROM candidate)) AS audits`
        )
        .bind(username)
        .first<Counts>();
    expect(await readCounts(invalid.username)).toEqual({
      accounts: 0,
      applications: 0,
      audits: 0,
      profiles: 0,
      reservations: 0,
      users: 0,
    });

    const control = applicationInput();
    const created = await fetch(`${caseApp.origin}/api/v2/applications`, {
      body: JSON.stringify(control),
      headers: {
        "cf-connecting-ip": "198.51.100.102",
        "content-type": "application/json",
        origin: caseApp.origin,
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ data: { outcome: "pending" } });
    expect(created.headers.get("set-cookie")).toBeNull();
    expect(await readCounts(control.username)).toEqual({
      accounts: 1,
      applications: 1,
      audits: 1,
      profiles: 1,
      reservations: 1,
      users: 1,
    });
  }
);

dedicatedTest(
  "request guards retain precedence over malformed bodies and leave independent effects",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-auth",
      "@risk-atomicity",
    ],
  },
  async ({ caseApp, request, signedInRequest, account }) => {
    const routes = [
      ["/api/v2/applications", "create", "申請資料格式不正確。"],
      [
        "/api/v2/applications/actions",
        "applicant-action",
        "申請操作資料格式不正確。",
      ],
      [
        "/api/v2/staff/accounts",
        "staff-account-create",
        "請填妥帳戶資料及身分核實方式。",
      ],
    ] as const;
    await Promise.all(
      routes.map(async ([path, action, schemaMessage]) => {
        const ip = `2001:db8:${randomBytes(2).toString("hex")}::1`;
        const key = `application:${action}:${ip}`;
        const malformed = {
          data: Buffer.from("{"),
          headers: {
            "cf-connecting-ip": ip,
            "content-type": "application/json",
          },
        };
        const originDenied = await request.post(path, {
          ...malformed,
          headers: {
            ...malformed.headers,
            origin: "https://different.example.test",
          },
        });
        expect(originDenied.status()).toBe(403);
        expect(await originDenied.json()).toEqual({
          error: { code: "origin_denied", message: "只允許同一來源提交請求。" },
        });
        await Promise.all(
          ["invalid,ip", "invalid ip"].map(async (invalidIp) => {
            const denied = await request.post(path, {
              ...malformed,
              headers: { ...malformed.headers, "cf-connecting-ip": invalidIp },
            });
            expect(denied.status()).toBe(429);
            expect(await denied.json()).toEqual({
              error: {
                code: "rate_limited",
                message: "提交次數過多，請稍後再試。",
              },
            });
          })
        );
        expect(
          await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM rate_limit WHERE key LIKE ?"
            )
            .bind(`application:${action}:%`)
            .first()
        ).toEqual({ count: 0 });
        const parseFailure = await request.post(path, malformed);
        expect(parseFailure.status()).toBe(400);
        expect(await parseFailure.json()).toEqual({
          error: { code: "validation_error", message: "申請資料格式不正確。" },
        });
        const schemaFailure = await request.post(path, {
          ...malformed,
          data: {},
        });
        expect(schemaFailure.status()).toBe(400);
        expect(await schemaFailure.json()).toEqual({
          error: { code: "validation_error", message: schemaMessage },
        });
        await caseApp.db
          .prepare("UPDATE rate_limit SET count=10 WHERE key=?")
          .bind(key)
          .run();
        const exhausted = await request.post(path, malformed);
        expect(exhausted.status()).toBe(429);
        expect(await exhausted.json()).toEqual({
          error: {
            code: "rate_limited",
            message: "提交次數過多，請稍後再試。",
          },
        });
        expect(
          await caseApp.db
            .prepare("SELECT count FROM rate_limit WHERE key=?")
            .bind(key)
            .first()
        ).toEqual({ count: 11 });
      })
    );
    // Genuine credentials/session; only the synthetic credential deadline changes.
    await caseApp.db
      .prepare(
        "UPDATE account SET temporary_password_expires_at=CAST(strftime('%s','now') AS INTEGER)+3600 WHERE user_id=? AND provider_id='credential'"
      )
      .bind(account.userId)
      .run();
    const restricted = await signedInRequest.post("/api/v2/staff/accounts", {
      data: Buffer.from("{"),
      headers: {
        "cf-connecting-ip": "invalid,ip",
        "content-type": "application/json",
        origin: "https://different.example.test",
      },
    });
    expect(restricted.status()).toBe(403);
    const restrictedBody = await restricted.json();
    expect(restrictedBody.error.code).toBe("password_change_required");
    expect(
      await caseApp.db
        .prepare(
          "SELECT (SELECT count(*) FROM membership_application) AS applications, (SELECT count(*) FROM account_change_operation) AS changes, (SELECT count(*) FROM staff_account_operation) AS staff_operations"
        )
        .first()
    ).toEqual({ applications: 0, changes: 0, staff_operations: 0 });
  }
);

dedicatedTest(
  "early business denials leave the next body-bearing HTTP request usable",
  {
    tag: [
      "@native",
      "@account-application",
      "@http",
      "@risk-origin",
      "@risk-rate-limit",
      "@risk-resilience",
      "@risk-no-write",
      "@risk-atomicity",
    ],
  },
  async ({ caseApp, request }) => {
    interface RateLimitState {
      count: number;
      last_request: number;
    }
    interface BusinessEffects {
      accounts: number;
      audits: number;
      operations: number;
      users: number;
    }

    const body = Buffer.from("{}");
    const paddedBody = Buffer.from(`{"padding":"${"x".repeat(4082)}"}`);
    expect(paddedBody.byteLength).toBe(4096);
    const originDenied: ExpectedApiError = {
      code: "origin_denied",
      message: "只允許同一來源提交請求。",
      status: 403,
    };
    const rateLimited: ExpectedApiError = {
      code: "rate_limited",
      message: "提交次數過多，請稍後再試。",
      status: 429,
    };
    const validationFailure: ExpectedApiError = {
      code: "validation_error",
      message: "請填妥帳戶資料及身分核實方式。",
      status: 400,
    };
    const passwordReissuePath = "/api/v2/staff/accounts/password-reissue";
    const reconciliationPath = "/api/v2/staff/accounts/reconcile";
    const requestHeaders = (ip: string, origin = caseApp.origin) => ({
      "cf-connecting-ip": ip,
      "content-type": "application/json",
      origin,
    });
    const post = (
      path: string,
      ip: string,
      requestBody = body,
      origin = caseApp.origin
    ) =>
      request.post(path, {
        data: requestBody,
        headers: requestHeaders(ip, origin),
      });
    const expectPostFailure = async (
      response: Promise<APIResponse>,
      expected: ExpectedApiError
    ) => expectApiFailure(await response, expected);
    const readRateLimit = (key: string) =>
      caseApp.db
        .prepare("SELECT count, last_request FROM rate_limit WHERE key = ?")
        .bind(key)
        .first<RateLimitState>();
    const readBusinessEffects = () =>
      caseApp.db
        .prepare(
          `SELECT
             (SELECT count(*) FROM account) AS accounts,
             (SELECT count(*) FROM user) AS users,
             (SELECT count(*) FROM staff_account_operation) AS operations,
             (SELECT count(*) FROM audit_event) AS audits`
        )
        .first<BusinessEffects>();

    const noBusinessEffects: BusinessEffects = {
      accounts: 0,
      audits: 0,
      operations: 0,
      users: 0,
    };
    expect(await readBusinessEffects()).toEqual(noBusinessEffects);

    const originIp = "198.51.100.201";
    const originKey = `application:staff-password-reissue:${originIp}`;
    expect(await readRateLimit(originKey)).toBeNull();
    await expectPostFailure(
      post(
        passwordReissuePath,
        originIp,
        paddedBody,
        "https://foreign.example.test"
      ),
      originDenied
    );
    await expectPostFailure(
      post(passwordReissuePath, originIp),
      validationFailure
    );
    expect(await readRateLimit(originKey)).toMatchObject({ count: 1 });

    const invalidIp = "invalid,ip";
    const invalidIpKey = `application:staff-password-reissue:${invalidIp}`;
    expect(await readRateLimit(invalidIpKey)).toBeNull();
    await expectPostFailure(
      post(passwordReissuePath, invalidIp, paddedBody),
      rateLimited
    );
    const invalidIpControl = "198.51.100.202";
    await expectPostFailure(
      post(passwordReissuePath, invalidIpControl),
      validationFailure
    );
    expect(await readRateLimit(invalidIpKey)).toBeNull();
    expect(
      await readRateLimit(
        `application:staff-password-reissue:${invalidIpControl}`
      )
    ).toMatchObject({ count: 1 });

    const quotaIp = "198.51.100.203";
    const quotaKey = `application:staff-password-reissue:${quotaIp}`;
    /* eslint-disable no-await-in-loop -- Establish the exhausted bucket using ten real HTTP requests. */
    for (let index = 0; index < 10; index += 1) {
      await expectPostFailure(
        post(passwordReissuePath, quotaIp),
        validationFailure
      );
    }
    /* eslint-enable no-await-in-loop */
    const rateLimitBeforeQuota = await readRateLimit(quotaKey);
    if (rateLimitBeforeQuota?.count !== 10) {
      throw new Error("Ten malformed HTTP requests did not reach the quota.");
    }
    const windowAnchor = rateLimitBeforeQuota.last_request;
    const reconciliationKey = `application:staff-account-reconcile:${quotaIp}`;
    expect(await readRateLimit(reconciliationKey)).toBeNull();
    await expectPostFailure(
      post(passwordReissuePath, quotaIp, paddedBody),
      rateLimited
    );
    await expectPostFailure(
      post(reconciliationPath, quotaIp, body, "https://foreign.example.test"),
      originDenied
    );
    expect(await readRateLimit(quotaKey)).toEqual({
      count: 11,
      last_request: windowAnchor,
    });
    expect(await readRateLimit(reconciliationKey)).toBeNull();

    expect(await readBusinessEffects()).toEqual(noBusinessEffects);
  }
);
