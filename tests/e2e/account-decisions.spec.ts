import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { apiTransportHeaders, E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

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
        ...apiTransportHeaders,
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
  browser,
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
  const context = await browser.newContext({
    extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
    storageState: await request.storageState(),
    viewport: { height: 568, width: 320 },
  });
  const page = await context.newPage();
  const assertRestrictedPage = async (path: string, title: string) => {
    await page.goto(`${E2E_BASE_URL}${path}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "主要導覽" });
    await Promise.all(
      ["主頁", "收件匣", "帳戶"].map((label) =>
        expect(
          navigation.getByRole("link", { exact: true, name: label })
        ).toBeVisible()
      )
    );
    await expect(
      navigation.getByRole("link", { exact: true, name: "管理" })
    ).toHaveCount(0);
    const navBox = await navigation.boundingBox();
    if (!navBox) {
      throw new Error("Mobile primary navigation has no layout box");
    }
    expect(navBox.y + navBox.height).toBeGreaterThanOrEqual(568);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
    await page.evaluate(() => {
      document.documentElement.style.removeProperty("font-size");
    });
  };
  await assertRestrictedPage("/staff/applications", "你沒有帳戶管理權限");
  await assertRestrictedPage("/staff/accounts", "無法管理帳戶");
  await context.close();
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
    extraHTTPHeaders: {
      ...test.info().project.use.extraHTTPHeaders,
      ...apiTransportHeaders,
    },
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
  async ({ request, staff, page }) => {
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
    const applicantVisibleReason =
      "請先完成會籍面談，並聯絡教會同工確認可用資料。".repeat(10);
    await expectStatus(
      staff.post("/api/v2/staff/application-decisions", { data: body }),
      400
    );
    const rejected = await staff.post("/api/v2/staff/application-decisions", {
      data: { ...body, visibleReason: applicantVisibleReason },
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
            visibleReason: applicantVisibleReason,
          },
        ],
      },
    });
    const applicantStorage = await request.storageState();
    await page.context().addCookies(applicantStorage.cookies);
    await page.goto("/inbox");
    await expect(
      page.getByRole("heading", { exact: true, name: "收件匣" })
    ).toBeVisible();
    await expect(
      page.getByText(applicantVisibleReason, { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(body.internalNote, { exact: true })
    ).toHaveCount(0);
    await page.setViewportSize({ height: 740, width: 320 });
    const inboxWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    expect(inboxWidth).toBeLessThanOrEqual(320);
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
  async ({ browser, request, staff }) => {
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

    const context = await browser.newContext({
      extraHTTPHeaders: {
        ...test.info().project.use.extraHTTPHeaders,
        "cf-connecting-ip": "198.51.100.95",
      },
      storageState: await staff.storageState(),
      viewport: { height: 740, width: 320 },
    });
    const page = await context.newPage();
    await page.goto(`${E2E_BASE_URL}/staff/account-audit`);
    const row = page.getByRole("listitem").filter({ hasText: decision.id });
    await expect(row.getByRole("link", { name: "查看詳情" })).toBeVisible();
    await expect(
      row.getByText("保留歷史核對資料", { exact: true })
    ).toHaveCount(0);
    await row.getByRole("link", { name: "查看詳情" }).click();
    await expect(
      page.getByRole("region", { name: "帳戶紀錄詳情" })
    ).toBeVisible();
    const detail = page.getByRole("region", { name: "帳戶紀錄詳情" });
    await expect(
      detail.getByText(decision.actorUserId, { exact: true })
    ).toBeVisible();
    await expect(detail.getByText(userId, { exact: true })).toBeVisible();
    await expect(detail.getByText(decision.id, { exact: true })).toBeVisible();
    await expect(
      detail.getByText("保留歷史核對資料", { exact: true })
    ).toBeVisible();
    await expect(detail.locator("time")).toContainText("香港");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(320);
    await expect(
      page.getByRole("link", { name: "返回帳戶紀錄" })
    ).toBeVisible();
    await context.close();
  }
);

staffTest(
  "Staff reviews the exact rejection and notes before one explicit final submit",
  async ({ request, staff, page }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.91" },
      }),
      201
    );
    const staffStorage = await staff.storageState();
    await page.context().addCookies(staffStorage.cookies);

    let decisionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/application-decisions")
      ) {
        decisionPosts += 1;
      }
    });

    await page.goto("/staff/applications");
    await expect(
      page.getByRole("heading", { exact: true, name: "審批會籍申請" })
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();
    await page.getByRole("radio", { name: "拒絕申請" }).check();

    const visibleReason = "R".repeat(500);
    const internalNote = "N".repeat(500);
    await page.getByLabel("拒絕原因（申請人可見，必填）").fill("R".repeat(501));
    await page
      .getByLabel("內部備註（選填，申請人不可見）")
      .fill("N".repeat(501));
    const previewDecision = page.getByRole("button", {
      name: "檢查並預覽決定",
    });
    await expect(previewDecision).toBeVisible();
    await previewDecision.click();
    await expect(
      page.getByText("申請人可見原因不可多於 500 個字元。", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("內部備註不可多於 500 個字元。", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByLabel("拒絕原因（申請人可見，必填）")
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByLabel("內部備註（選填，申請人不可見）")
    ).toHaveAttribute("aria-invalid", "true");
    expect(decisionPosts).toBe(0);

    await page.getByLabel("拒絕原因（申請人可見，必填）").fill(visibleReason);
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(internalNote);
    await previewDecision.click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    await expect(page.getByText(visibleReason, { exact: true })).toBeVisible();
    await expect(page.getByText(internalNote, { exact: true })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(decisionPosts).toBe(0);
    await page.setViewportSize({ height: 740, width: 320 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(320);

    await page.getByRole("link", { name: "返回管理" }).click();
    await expect(
      page.getByRole("heading", { name: "放棄未提交的更改？" })
    ).toBeVisible();
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    await expect(page.getByText(visibleReason, { exact: true })).toBeVisible();

    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/application-decisions")
    );
    await page.getByRole("button", { name: "確認並提交拒絕" }).click();
    const decisionResponse = await submitted;
    expect(decisionResponse.status()).toBe(201);
    expect(decisionPosts).toBe(1);
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認拒絕申請" })
    ).toBeVisible();
    await expect(page.getByText(visibleReason, { exact: true })).toBeVisible();
    await expect(page.getByText(internalNote, { exact: true })).toHaveCount(0);
  }
);

staffTest(
  "Staff decision validation marks visible fields and keeps the default approval reason optional",
  async ({ request, staff, page }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.93" },
      }),
      201
    );
    const staffStorage = await staff.storageState();
    await page.context().addCookies(staffStorage.cookies);

    let decisionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/application-decisions")
      ) {
        decisionPosts += 1;
      }
    });
    await page.goto("/staff/applications");
    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();

    const previewDecision = page.getByRole("button", {
      name: "檢查並預覽決定",
    });
    await previewDecision.click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查批准決定" })
    ).toBeVisible();
    await expect(page.getByText("申請人可見原因", { exact: true })).toHaveCount(
      0
    );
    await page.getByRole("button", { exact: true, name: "返回修改" }).click();

    await page.getByRole("radio", { name: "拒絕申請" }).check();
    const visibleReason = page.getByLabel("拒絕原因（申請人可見，必填）");
    const internalNote = page.getByLabel("內部備註（選填，申請人不可見）");
    await internalNote.fill("N".repeat(501));
    await previewDecision.click();
    await expect(
      page.getByText("拒絕申請必須填寫申請人可見的原因。", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("內部備註不可多於 500 個字元。", { exact: true })
    ).toBeVisible();
    await expect(visibleReason).toHaveAttribute("aria-invalid", "true");
    await expect(internalNote).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toHaveCount(0);
    expect(decisionPosts).toBe(0);

    await visibleReason.fill("  請先安排會面。  ");
    await internalNote.fill("  只供職員查閱。  ");
    await previewDecision.click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    await expect(
      page.getByText("請先安排會面。", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("只供職員查閱。", { exact: true })
    ).toBeVisible();
    expect(
      await page
        .getByRole("definition")
        .filter({ hasText: "請先安排會面。" })
        .textContent()
    ).toBe("請先安排會面。");
    expect(
      await page
        .getByRole("definition")
        .filter({ hasText: "只供職員查閱。" })
        .textContent()
    ).toBe("只供職員查閱。");
    expect(decisionPosts).toBe(0);
  }
);

staffTest(
  "a committed decision with a lost response is confirmed once and never reopened",
  async ({ request, staff, page }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.86" },
      }),
      201
    );
    const { applicationId } = persistedApplication(input.username);
    const staffStorage = await staff.storageState();
    await page.context().addCookies(staffStorage.cookies);

    let decisionWrites = 0;
    await page.route("**/api/v2/staff/application-decisions", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      decisionWrites += 1;
      // The decision commits in D1; the browser never receives the response.
      await route.fetch();
      await route.abort();
    });

    await page.goto("/staff/applications");
    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();
    await page.getByRole("radio", { name: "批准申請" }).check();
    await page
      .getByLabel("內部備註（選填，申請人不可見）")
      .fill("遺失回應的內部備註");
    await page.getByRole("button", { name: "檢查並預覽決定" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查批准決定" })
    ).toBeVisible();
    await page.getByRole("button", { name: "確認並提交批准" }).click();

    // Truthful recovery: reconciliation reports the committed decision; the
    // lost response itself never counts as success or as rollback.
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認批准申請" })
    ).toBeVisible();
    expect(decisionWrites).toBe(1);
    const saved = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.application-decision.operation.v1") ?? "null"
      )
    );
    const committed = queryLocalSql<{
      applicationDecisionId: string;
      decisionId: string;
      operationKey: string;
      status: string;
    }>(
      `select d.id as decisionId, d.operation_key as operationKey,
        a.decision_id as applicationDecisionId, a.status
      from application_decision d
      join membership_application a on a.id = d.application_id
      where d.application_id = '${applicationId}'`
    );
    expect(committed).toHaveLength(1);
    expect(committed[0]?.operationKey).toBe(saved.key);
    expect(committed[0]?.applicationDecisionId).toBe(committed[0]?.decisionId);
    expect(committed[0]?.status).toBe("approved");
    await expect(
      page.getByText(committed[0]?.decisionId ?? "missing", { exact: true })
    ).toBeVisible();

    // A reload reconciles the same original operation; the terminal record is
    // never reopened and no second decision is written.
    await page.reload();
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認批准申請" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "檢查並預覽決定" })
    ).toHaveCount(0);
    expect(decisionWrites).toBe(1);
    expect(
      queryLocalSql(
        `select count(*) as decisions from application_decision
        where application_id = '${applicationId}'`
      )
    ).toEqual([{ decisions: 1 }]);
  }
);

staffTest(
  "a decision lost before commit stays unresolved until the explicit original retry",
  async ({ request, staff, page }) => {
    const input = applicationInput();
    await expectStatus(
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": "198.51.100.87" },
      }),
      201
    );
    const { applicationId } = persistedApplication(input.username);
    const staffStorage = await staff.storageState();
    await page.context().addCookies(staffStorage.cookies);

    const decisionRoute = "**/api/v2/staff/application-decisions";
    await page.route(decisionRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      // The request never reaches the server; the browser sees a transport error.
      await route.abort();
    });

    const visibleReason = "需要先核對組別資料。";
    const internalNote = "未提交前的內部備註";
    await page.goto("/staff/applications");
    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();
    await page.getByRole("radio", { name: "拒絕申請" }).check();
    await page.getByLabel("拒絕原因（申請人可見，必填）").fill(visibleReason);
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(internalNote);
    await page.getByRole("button", { name: "檢查並預覽決定" }).click();
    await page.getByRole("button", { name: "確認並提交拒絕" }).click();

    const retryCopy =
      "尚未找到此操作的完成紀錄，不能當作已成功。重試會保留原申請與決定；重新載入後，請填寫同一份原因及備註。";
    await expect(page.getByText(retryCopy, { exact: true })).toBeVisible();
    expect(
      queryLocalSql(
        `select count(*) as decisions from application_decision
        where application_id = '${applicationId}'`
      )
    ).toEqual([{ decisions: 0 }]);
    const saved = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.application-decision.operation.v1") ?? "null"
      )
    );

    // After a reload the operator re-enters the same values explicitly; the
    // operation key is preserved and one matching record is committed.
    await page.unroute(decisionRoute);
    await page.reload();
    await expect(page.getByText(retryCopy, { exact: true })).toBeVisible();
    await page.getByLabel("拒絕原因（申請人可見，必填）").fill(visibleReason);
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(internalNote);
    await page.getByRole("button", { name: "檢查後重試同一決定" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    const retried = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/application-decisions")
    );
    await page.getByRole("button", { name: "重試同一決定" }).click();
    const retriedResponse = await retried;
    expect(retriedResponse.status()).toBe(201);
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認拒絕申請" })
    ).toBeVisible();
    expect(
      queryLocalSql(
        `select d.operation_key as operationKey, d.visible_reason as visibleReason,
          d.internal_note as internalNote, a.status
        from application_decision d
        join membership_application a on a.id = d.application_id
        where d.application_id = '${applicationId}'`
      )
    ).toEqual([
      {
        internalNote,
        operationKey: saved.key,
        status: "rejected",
        visibleReason,
      },
    ]);
  }
);
