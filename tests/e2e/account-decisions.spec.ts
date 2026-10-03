import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { queryLocalSql, runLocalSql } from "./seed";

const applicationInput = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `decision.${suffix}@example.test`,
    fullName: `陳決定${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-decision-password!",
    phone: String(60_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    username: `decision.${suffix}`,
  };
};

const persistedApplication = (username: string) => {
  const [application] = queryLocalSql<{
    applicationId: string;
    userId: string;
  }>(
    `select a.id as applicationId, a.user_id as userId
     from membership_application a join user u on u.id = a.user_id
     where u.username = '${username}'`
  );
  if (!application) {
    throw new Error("Submitted synthetic application is missing");
  }
  return application;
};

const expectStatus = async (pending: Promise<APIResponse>, status: number) => {
  const response = await pending;
  expect(response.status()).toBe(status);
  return response;
};

const responseJson = async (pending: Promise<APIResponse>) => {
  const response = await pending;
  return response.json();
};

const staffTest = test.extend<{ staff: APIRequestContext }>({
  staff: async ({ playwright }, use) => {
    const ipSuffix = randomBytes(2).readUInt16BE();
    const staff = await playwright.request.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: {
        ...test.info().project.use.extraHTTPHeaders,
        "cf-connecting-ip": `198.18.${Math.floor(ipSuffix / 256)}.${ipSuffix % 256}`,
      },
    });
    const account = findAccount(approvedAccounts, "ng.wing.yan");
    runLocalSql(`update person_profile set account_role = 'staff' where user_id =
      (select id from user where username = 'ng.wing.yan')`);
    try {
      await waitForSignInWindow();
      await expectStatus(
        staff.post("/api/auth/sign-in/username", {
          data: { password: account.password, username: account.username },
        }),
        200
      );
      await use(staff);
    } finally {
      runLocalSql(`update person_profile set account_role = 'member' where user_id =
        (select id from user where username = 'ng.wing.yan')`);
      await staff.dispose();
    }
  },
});

test("a native applicant reads their own Pending application without member access", async ({
  request,
}) => {
  const input = applicationInput();
  const created = await request.post("/api/v2/applications", { data: input });
  expect(created.status()).toBe(201);
  await waitForSignInWindow();
  const signIn = await request.post("/api/auth/sign-in/username", {
    data: { password: input.password, username: input.username },
  });
  expect(signIn.status()).toBe(200);
  const application = await request.get("/api/v2/applications/mine");
  expect(application.status()).toBe(200);
  expect(await application.json()).toMatchObject({
    data: { application: { fullName: input.fullName, status: "pending" } },
  });
  const memberData = await request.get("/api/v2/me");
  expect(memberData.status()).toBe(403);
});

test("an active ordinary member cannot review applications or read account audit", async ({
  request,
}) => {
  const account = findAccount(approvedAccounts, "wong.tai.ming");
  await waitForSignInWindow();
  const signIn = await request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(signIn.status()).toBe(200);
  await expectStatus(request.get("/api/v2/me"), 200);
  await expectStatus(request.get("/api/v2/staff/applications"), 403);
  await expectStatus(request.get("/api/v2/staff/account-audit"), 403);
});

test("routine Staff approval atomically unlocks membership and publishes one durable decision", async ({
  request,
  playwright,
}) => {
  const input = applicationInput();
  await expectStatus(
    request.post("/api/v2/applications", { data: input }),
    201
  );
  await waitForSignInWindow();
  await expectStatus(
    request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    }),
    200
  );
  const {
    data: { application },
  } = await responseJson(request.get("/api/v2/applications/mine"));
  const staffAccount = findAccount(approvedAccounts, "ng.wing.yan");
  const staff = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  runLocalSql(`update person_profile set account_role = 'staff' where user_id =
    (select id from user where username = 'ng.wing.yan')`);
  try {
    await waitForSignInWindow();
    await expectStatus(
      staff.post("/api/auth/sign-in/username", {
        data: {
          password: staffAccount.password,
          username: staffAccount.username,
        },
      }),
      200
    );
    const decisionInput = {
      applicationId: application.id,
      internalNote: "只供職員查閱的審批備註",
      operationKey: crypto.randomUUID(),
      outcome: "approved",
    };
    const approved = await staff.post("/api/v2/staff/application-decisions", {
      data: decisionInput,
    });
    expect(approved.status()).toBe(201);
    const {
      data: { decision },
    } = await approved.json();
    expect(decision).toMatchObject({
      applicationId: application.id,
      outcome: "approved",
    });
    await expectStatus(request.get("/api/v2/me"), 200);
    const inbox = await request.get("/api/v2/inbox");
    expect(await inbox.json()).toEqual({
      data: {
        decisions: [
          {
            applicationId: application.id,
            createdAt: decision.createdAt,
            id: decision.id,
            outcome: "approved",
            visibleReason: null,
          },
        ],
      },
    });
    const replay = await staff.post("/api/v2/staff/application-decisions", {
      data: decisionInput,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ data: { decision } });
    const audit = await responseJson(staff.get("/api/v2/staff/account-audit"));
    expect(
      audit.data.events.filter(
        (event: { id: string }) => event.id === decision.id
      )
    ).toEqual([
      {
        action: "application_approved",
        actorUserId: decision.actorUserId,
        createdAt: decision.createdAt,
        id: decision.id,
        internalNote: decisionInput.internalNote,
        targetUserId: decision.targetUserId,
      },
    ]);
  } finally {
    runLocalSql(`update person_profile set account_role = 'member' where user_id =
      (select id from user where username = 'ng.wing.yan')`);
    await staff.dispose();
  }
});

staffTest(
  "rejection requires a visible reason and never discloses private notes to the applicant",
  async ({ request, staff }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.80" },
      }),
      201
    );
    await waitForSignInWindow();
    await expectStatus(
      request.post("/api/auth/sign-in/username", {
        data: { password: input.password, username: input.username },
      }),
      200
    );
    const {
      data: { application },
    } = await responseJson(request.get("/api/v2/applications/mine"));
    const body = {
      applicationId: application.id,
      internalNote: "不應出現在申請人畫面的內部備註",
      operationKey: crypto.randomUUID(),
      outcome: "rejected",
    };
    await expectStatus(
      staff.post("/api/v2/staff/application-decisions", { data: body }),
      400
    );
    const rejected = await staff.post("/api/v2/staff/application-decisions", {
      data: { ...body, visibleReason: "請先完成會籍面談。" },
    });
    expect(rejected.status()).toBe(201);
    const {
      data: { decision },
    } = await rejected.json();
    const inbox = await request.get("/api/v2/inbox");
    expect(await inbox.json()).toEqual({
      data: {
        decisions: [
          {
            applicationId: application.id,
            createdAt: decision.createdAt,
            id: decision.id,
            outcome: "rejected",
            visibleReason: "請先完成會籍面談。",
          },
        ],
      },
    });
    expect(
      await responseJson(request.get("/api/v2/applications/mine"))
    ).toMatchObject({
      data: { application: { status: "rejected" } },
    });
    await expectStatus(request.get("/api/v2/me"), 403);
    const stale = await staff.post("/api/v2/staff/application-decisions", {
      data: {
        applicationId: application.id,
        operationKey: crypto.randomUUID(),
        outcome: "approved",
      },
    });
    expect(stale.status()).toBe(409);
    const changedReplay = await staff.post(
      "/api/v2/staff/application-decisions",
      {
        data: { ...body, visibleReason: "已改寫的原因" },
      }
    );
    expect(changedReplay.status()).toBe(409);
  }
);

staffTest(
  "competing approve and reject requests commit exactly one decision and business audit",
  async ({ request, staff }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.81" },
      }),
      201
    );
    const { applicationId, userId } = persistedApplication(input.username);
    const outcomes = await Promise.all(
      ["approved", "rejected"].map((outcome) =>
        staff.post("/api/v2/staff/application-decisions", {
          data: {
            applicationId,
            operationKey: crypto.randomUUID(),
            outcome,
            visibleReason: outcome === "rejected" ? "請重新面談。" : undefined,
          },
        })
      )
    );
    expect(outcomes.map((response) => response.status()).toSorted()).toEqual([
      201, 409,
    ]);
    const winner = outcomes.find((response) => response.status() === 201);
    if (!winner) {
      throw new Error("No valid concurrent decision");
    }
    const {
      data: { decision },
    } = await winner.json();
    expect(
      queryLocalSql(
        `select a.status, p.membership_status as membership,
       (select count(*) from application_decision where application_id = a.id) as decisions,
       (select count(*) from audit_event where target_user_id = '${userId}'
         and action in ('application_approved', 'application_rejected')) as audits
     from membership_application a join person_profile p on p.user_id = a.user_id
     where a.id = '${applicationId}'`
      )
    ).toEqual([
      {
        audits: 1,
        decisions: 1,
        membership: decision.outcome === "approved" ? "active" : "pending",
        status: decision.outcome,
      },
    ]);
  }
);

for (const { failure, table } of [
  { failure: "ABORT, 'Synthetic decision failure'", table: "person_profile" },
  { failure: "IGNORE", table: "person_profile" },
  { failure: "ABORT, 'Synthetic decision failure'", table: "audit_event" },
  { failure: "IGNORE", table: "audit_event" },
]) {
  staffTest(
    `${table} ${failure} rolls back required decision effects and permits a matching retry`,
    async ({ request, staff }) => {
      const input = applicationInput();
      await expectStatus(
        request.post("/api/v2/applications", {
          data: input,
          headers: { "cf-connecting-ip": "198.51.100.82" },
        }),
        201
      );
      const { applicationId, userId } = persistedApplication(input.username);
      const body = {
        applicationId,
        operationKey: crypto.randomUUID(),
        outcome: "approved",
      };
      const trigger = `synthetic_decision_${applicationId.replaceAll("-", "")}`;
      const condition =
        table === "person_profile"
          ? `NEW.user_id = '${userId}' AND NEW.membership_status = 'active'`
          : `NEW.target_user_id = '${userId}' AND NEW.action = 'application_approved'`;
      runLocalSql(`CREATE TRIGGER ${trigger} BEFORE ${table === "person_profile" ? "UPDATE" : "INSERT"}
        ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${failure}); END;`);
      try {
        const failed = await staff.post("/api/v2/staff/application-decisions", {
          data: body,
        });
        expect(failed.status()).toBe(500);
        expect(await failed.json()).toMatchObject({
          error: { code: "internal_error" },
        });
        expect(
          queryLocalSql(
            `select a.status, a.decision_id as decisionId, p.membership_status as membership,
            (select count(*) from application_decision where application_id = a.id) as decisions,
            (select count(*) from audit_event where target_user_id = '${userId}'
              and action = 'application_approved') as audits
          from membership_application a join person_profile p on p.user_id = a.user_id
          where a.id = '${applicationId}'`
          )
        ).toEqual([
          {
            audits: 0,
            decisionId: null,
            decisions: 0,
            membership: "pending",
            status: "pending",
          },
        ]);
        expect(
          await responseJson(
            staff.post("/api/v2/staff/application-decisions/reconcile", {
              data: { operationKey: body.operationKey },
            })
          )
        ).toEqual({ data: { decision: null } });
      } finally {
        runLocalSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      }
      await expectStatus(
        staff.post("/api/v2/staff/application-decisions", { data: body }),
        201
      );
    }
  );
}

staffTest(
  "current target and actor authority deny self, peer Staff, Admin and forged access",
  async ({ request, staff }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.83" },
      }),
      201
    );
    const { applicationId, userId } = persistedApplication(input.username);
    const body = {
      applicationId,
      operationKey: crypto.randomUUID(),
      outcome: "approved",
    };
    await expectStatus(
      request.post("/api/v2/staff/application-decisions", {
        data: body,
        headers: {
          "x-efcc-access": "full",
          "x-efcc-session-id": crypto.randomUUID(),
          "x-efcc-user-id": userId,
        },
      }),
      401
    );
    const original = await responseJson(
      staff.get("/api/v2/staff/applications")
    );
    expect(
      original.data.applications.some(
        (application: { id: string }) => application.id === applicationId
      )
    ).toBe(true);
    runLocalSql(
      `update person_profile set account_role = 'staff' where user_id = '${userId}'`
    );
    await expectStatus(
      staff.post("/api/v2/staff/application-decisions", { data: body }),
      403
    );
    runLocalSql(
      `update person_profile set account_role = 'admin' where user_id = '${userId}'`
    );
    await expectStatus(
      staff.post("/api/v2/staff/application-decisions", { data: body }),
      403
    );
    runLocalSql(`update person_profile set account_role = 'member' where user_id = '${userId}';
    update person_profile set account_role = 'member' where user_id =
      (select id from user where username = 'ng.wing.yan');`);
    await expectStatus(
      staff.post("/api/v2/staff/application-decisions", { data: body }),
      403
    );
    runLocalSql(`update person_profile set account_role = 'staff', membership_status = 'active'
    where user_id = '${userId}'`);
    await waitForSignInWindow();
    await expectStatus(
      request.post("/api/auth/sign-in/username", {
        data: { password: input.password, username: input.username },
      }),
      200
    );
    await expectStatus(
      request.post("/api/v2/staff/application-decisions", {
        data: body,
      }),
      403
    );
    expect(
      queryLocalSql(`select status, decision_id as decisionId from membership_application
    where id = '${applicationId}'`)
    ).toEqual([{ decisionId: null, status: "pending" }]);
    runLocalSql(`update person_profile set account_role = 'member', membership_status = 'pending'
    where user_id = '${userId}'`);
  }
);

staffTest(
  "decision and read-only audit history survive deletion of the target account",
  async ({ request, staff }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.84" },
      }),
      201
    );
    const { applicationId, userId } = persistedApplication(input.username);
    const operationKey = crypto.randomUUID();
    const result = await staff.post("/api/v2/staff/application-decisions", {
      data: {
        applicationId,
        internalNote: "保留歷史核對資料",
        operationKey,
        outcome: "rejected",
        visibleReason: "請先安排面談。",
      },
    });
    expect(result.status()).toBe(201);
    const {
      data: { decision },
    } = await result.json();
    const before = await responseJson(staff.get("/api/v2/staff/account-audit"));
    const auditBefore = before.data.events.filter(
      (event: { id: string }) => event.id === decision.id
    );
    runLocalSql(`delete from user where id = '${userId}'`);
    const after = await responseJson(staff.get("/api/v2/staff/account-audit"));
    expect(
      after.data.events.filter(
        (event: { id: string }) => event.id === decision.id
      )
    ).toEqual(auditBefore);
    expect(
      await responseJson(
        staff.post("/api/v2/staff/application-decisions/reconcile", {
          data: { operationKey },
        })
      )
    ).toEqual({ data: { decision } });
    expect(
      queryLocalSql(`select username_key, user_id as userId from username_reservation
    where username_key = '${input.username}'`)
    ).toEqual([{ userId, username_key: input.username }]);
  }
);
