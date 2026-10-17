import { randomUUID } from "node:crypto";

import { dedicatedTest, expect, test } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import {
  applicationInput,
  submitApplication,
  applicationIdentity,
  decisionSnapshot,
  expectDecisionEffects,
  seedApplicantInboxDecisions,
  seedReviewQueueApplications,
} from "./test-helpers";

const storageKey = "efcc.application-decision.operation.v1";

dedicatedTest(
  "an active ordinary member cannot review applications or read private account audit",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
    ],
  },
  async ({
    account,
    caseApp,
    extraHTTPHeaders,
    playwright,
    signedInPage,
    signedInRequest,
    staff,
  }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
    const application = await applicationIdentity(caseApp, input.username);
    const internalNote = "只供已確認職員查閱的合成內部備註";
    const decisionResponse = await staff.context.post(
      "/api/v2/staff/application-decisions",
      {
        data: {
          applicationId: application.applicationId,
          internalNote,
          operationKey: randomUUID(),
          outcome: "approved",
        },
      }
    );
    expect(decisionResponse.status()).toBe(201);
    const auditResponse = await staff.context.get(
      "/api/v2/staff/account-audit"
    );
    expect(auditResponse.status()).toBe(200);
    const { data: auditData } = await auditResponse.json();
    expect(
      auditData.events.filter(
        (event: { action: string; targetUserId: string }) =>
          event.action === "application_approved" &&
          event.targetUserId === application.userId
      )
    ).toEqual([
      expect.objectContaining({
        action: "application_approved",
        actorUserId: staff.userId,
        internalNote,
        targetUserId: application.userId,
      }),
    ]);

    expect(account.membershipStatus).toBe("active");
    const ownProfile = await signedInRequest.get("/api/v2/me");
    expect(ownProfile.status()).toBe(200);
    const staffAccounts = await signedInRequest.get("/api/v2/staff/accounts");
    expect(staffAccounts.status()).toBe(403);
    const staffApplications = await signedInRequest.get(
      "/api/v2/staff/applications"
    );
    expect(staffApplications.status()).toBe(403);
    const staffAudit = await signedInRequest.get("/api/v2/staff/account-audit");
    expect(staffAudit.status()).toBe(403);

    const page = signedInPage;
    const assertRestrictedPage = async (path: string) => {
      await page.goto(path);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "你沒有帳戶管理權限" })
      ).toBeVisible();
      await expect(main).not.toContainText(staff.account.fullName);
      await expect(main).not.toContainText(staff.account.username);
      await expect(main).not.toContainText(application.userId);
      await expect(main).not.toContainText(input.fullName);
      await expect(main).not.toContainText(input.username);
      await expect(main).not.toContainText(internalNote);
      await expect(main.getByRole("button")).toHaveCount(0);
      await expect(main.getByRole("textbox")).toHaveCount(0);
      await expect(
        page.getByRole("link", { exact: true, name: "管理" })
      ).toHaveCount(0);
      const homeExit = main.getByRole("link", {
        exact: true,
        name: "返回個人主頁",
      });
      await expect(homeExit).toBeVisible();
      await expect(homeExit).toHaveAttribute("href", "/");
      await expect(
        main.getByRole("link", { exact: true, name: "查看帳戶狀態" })
      ).toHaveAttribute("href", "/status");
      await qualifyPresentation(page, test.info(), "member-denied", {
        criticalAction: homeExit,
        drafts: page.locator("input[id], textarea[id]"),
      });
      await homeExit.focus();
      await expect(homeExit).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/u);
      await expect(
        page.getByRole("heading", { name: "我的主頁" })
      ).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.removeProperty("font-size");
      });
    };
    await assertRestrictedPage("/staff/applications");
    await assertRestrictedPage("/staff/accounts");
    await assertRestrictedPage("/staff/account-audit");
  }
);

dedicatedTest(
  "Staff review queue pages preserve selected task context and normalize stale positions",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page }) => {
    const applications = await seedReviewQueueApplications(caseApp);
    const lastApplication = applications.at(-1);
    if (!lastApplication) {
      throw new Error("Missing synthetic application for queue paging");
    }

    await page.goto(
      "/staff/applications?query=kept&taskReturn=accounts&page=1"
    );
    await expect(
      page.getByRole("heading", { name: "會籍申請審批" })
    ).toBeVisible();
    await expect(page.locator("main ul > li")).toHaveCount(25);
    await expect(
      page.getByRole("button", { name: /審批 陳待批000/u })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /審批 陳待批027/u })
    ).toHaveCount(0);
    let currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBeNull();
    expect(currentUrl.searchParams.get("query")).toBe("kept");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    await page.getByRole("button", { name: "下一頁" }).click();
    await expect(page.locator("main ul > li")).toHaveCount(3);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBe("2");
    expect(currentUrl.searchParams.get("query")).toBe("kept");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");
    await expect(
      page.getByRole("button", { name: /審批 陳待批027/u })
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: new RegExp(`審批 ${lastApplication.fullName}`, "u"),
      })
      .click();
    await expect(
      page.getByRole("heading", { name: lastApplication.fullName })
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`record=${lastApplication.applicationId}(?:&|$)`, "u")
    );
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBe("2");
    expect(currentUrl.searchParams.get("record")).toBe(
      lastApplication.applicationId
    );
    expect(currentUrl.searchParams.get("query")).toBe("kept");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    await page.goBack();
    await expect(page).toHaveURL(
      /\/staff\/applications\?query=kept&taskReturn=accounts&page=2$/u
    );
    await expect(page.locator("main ul > li")).toHaveCount(3);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBe("2");
    expect(currentUrl.searchParams.get("record")).toBeNull();

    await page.goto(
      `/staff/applications?query=kept&taskReturn=accounts&page=1&record=${lastApplication.applicationId}`
    );
    await expect(
      page.getByRole("heading", { name: lastApplication.fullName })
    ).toBeVisible();
    await expect(page.getByText("Synthetic group note 027")).toBeVisible();
    await expect(page.getByText("Synthetic intent note 027")).toBeVisible();
    const taskPayload = await page.content();
    for (const application of applications.slice(25, 27)) {
      expect(taskPayload).not.toContain(application.fullName);
    }
    const returnToQueue = page.getByRole("button", {
      exact: true,
      name: "返回待批清單",
    });
    await expect(returnToQueue).toBeEnabled();
    await returnToQueue.click();
    await expect(page).toHaveURL(
      /\/staff\/applications\?query=kept&taskReturn=accounts$/u
    );
    await expect(page.locator("main ul > li")).toHaveCount(25);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBeNull();
    expect(currentUrl.searchParams.get("record")).toBeNull();
    expect(currentUrl.searchParams.get("query")).toBe("kept");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    const expectNormalizedQueuePosition = async (pagePosition: string) => {
      await page.goto(
        `/staff/applications?query=kept&taskReturn=accounts&page=${pagePosition}`
      );
      await expect(page.locator("main ul > li")).toHaveCount(25);
      currentUrl = new URL(page.url());
      expect(currentUrl.searchParams.get("page")).toBeNull();
      expect(currentUrl.searchParams.get("query")).toBe("kept");
      expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");
    };
    await expectNormalizedQueuePosition("not-a-page");
    await expectNormalizedQueuePosition("3");

    await page.goto(
      "/staff/applications?query=kept&taskReturn=accounts&record=missing-application"
    );
    await expect(page.locator("main ul > li")).toHaveCount(25);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("record")).toBeNull();
    expect(currentUrl.searchParams.get("query")).toBe("kept");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");
  }
);

test(
  "Staff keeps a dirty decision draft protected after browser Back before selecting another application",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, staffPage: page }) => {
    const [first, second] = await seedReviewQueueApplications(caseApp, 2);
    if (!first || !second) {
      throw new Error("Missing synthetic applications for dirty navigation");
    }

    const visibleReason = "返回後仍保留的合成拒絕原因。";
    const internalNote = "返回後仍保留的合成內部備註。";
    await page.goto("/staff/applications");
    const selectedRecordRsc = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/staff/applications" &&
        url.searchParams.get("record") === first.applicationId &&
        url.searchParams.has("_rsc")
      );
    });
    await page
      .getByRole("button", { name: new RegExp(`審批 ${first.fullName}`, "u") })
      .click();
    const selectedRecordResponse = await selectedRecordRsc;
    expect(selectedRecordResponse.status()).toBe(200);
    await page.waitForURL(
      (url) =>
        url.pathname === "/staff/applications" &&
        url.searchParams.get("record") === first.applicationId
    );
    const selectedUrl = new URL(page.url());
    expect(selectedUrl.pathname).toBe("/staff/applications");
    expect(selectedUrl.searchParams.get("record")).toBe(first.applicationId);
    await expect(
      page.getByRole("heading", { name: first.fullName })
    ).toBeVisible();
    await page.getByRole("radio", { name: "拒絕申請" }).check();
    await page.getByLabel("拒絕原因（申請人可見，必填）").fill(visibleReason);
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(internalNote);

    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/applications$/u);
    const secondApplication = page.getByRole("button", {
      name: new RegExp(`審批 ${second.fullName}`, "u"),
    });
    await expect(secondApplication).toBeVisible();
    await secondApplication.click();

    const discardDialog = page.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    await expect(discardDialog).toBeVisible();
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(page).toHaveURL(
      new RegExp(`record=${first.applicationId}$`, "u")
    );
    await expect(page.getByLabel("拒絕原因（申請人可見，必填）")).toHaveValue(
      visibleReason
    );
    await expect(page.getByLabel("內部備註（選填，申請人不可見）")).toHaveValue(
      internalNote
    );

    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/applications$/u);
    await secondApplication.click();
    await expect(discardDialog).toBeVisible();
    await page.getByRole("button", { name: "放棄變更" }).click();
    await expect(page).toHaveURL(
      new RegExp(`record=${second.applicationId}$`, "u")
    );
    await expect(
      page.getByRole("heading", { name: second.fullName })
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: "批准申請" })).toBeChecked();
    await expect(page.getByLabel("內部備註（選填，申請人不可見）")).toHaveValue(
      ""
    );
  }
);

test(
  "applicant Inbox page links preserve back position and normalize invalid pages",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ browser, caseApp, extraHTTPHeaders, request }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const signIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(signIn.status()).toBe(200);
    const identity = await applicationIdentity(caseApp, input.username);
    await seedApplicantInboxDecisions(
      caseApp,
      "synthetic-inbox-staff-actor",
      identity.userId
    );

    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      storageState: await request.storageState(),
    });
    try {
      const page = await context.newPage();
      await page.goto("/inbox");
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { exact: true, name: "收件匣" })
      ).toBeVisible();
      await expect(page).toHaveURL(/\/inbox$/u);
      await expect(main.getByRole("listitem")).toHaveCount(25);
      await expect(
        main.getByText("Synthetic applicant reason 027", { exact: true })
      ).toBeVisible();
      await expect(
        main.getByText("Synthetic applicant reason 003", { exact: true })
      ).toBeVisible();
      await expect(
        main.getByText("Synthetic applicant reason 002", { exact: true })
      ).toHaveCount(0);
      await expect(main.getByText(/Staff-only synthetic note/u)).toHaveCount(0);

      const nextPage = main.getByRole("button", {
        exact: true,
        name: "下一頁",
      });
      await expect(nextPage).toHaveAttribute("href", "/inbox?page=2");
      await qualifyPresentation(page, test.info(), "decision-inbox-pages", {
        criticalAction: nextPage,
        drafts: page.locator("input[id], textarea[id]"),
      });
      await nextPage.click();
      await expect(page).toHaveURL(/\/inbox\?page=2$/u);
      await expect(main.getByRole("listitem")).toHaveCount(3);
      await expect(
        main.getByText("Synthetic applicant reason 002", { exact: true })
      ).toBeVisible();
      await expect(main.getByText(/Staff-only synthetic note/u)).toHaveCount(0);
      await expect(
        main.getByRole("button", { exact: true, name: "上一頁" })
      ).toHaveAttribute("href", "/inbox");

      await page.goBack();
      await expect(page).toHaveURL(/\/inbox$/u);
      await expect(main.getByRole("listitem")).toHaveCount(25);
      await page.goto("/inbox?page=not-a-page");
      await expect(page).toHaveURL(/\/inbox$/u);
      await expect(main.getByRole("listitem")).toHaveCount(25);
      await page.goto("/inbox?page=3");
      await expect(page).toHaveURL(/\/inbox$/u);
      await expect(main.getByRole("listitem")).toHaveCount(25);
    } finally {
      await context.close();
    }
  }
);

test(
  "rejection shows only the HK-localized visible reason in the applicant Inbox",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ browser, caseApp, extraHTTPHeaders, request, staff }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const signIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(signIn.status()).toBe(200);
    const identity = await applicationIdentity(caseApp, input.username);
    const body = {
      applicationId: identity.applicationId,
      internalNote: "不應出現在申請人畫面的內部備註",
      operationKey: randomUUID(),
      outcome: "rejected" as const,
    };
    const applicantVisibleReason =
      "請先完成會籍面談，並聯絡教會同工確認可用資料。".repeat(10);
    const invalid = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: body }
    );
    expect(invalid.status()).toBe(400);
    const rejected = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: { ...body, visibleReason: applicantVisibleReason } }
    );
    expect(rejected.status()).toBe(201);
    const {
      data: { decision },
    } = await rejected.json();
    expect(decision).toEqual({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: expect.any(Number),
      id: expect.any(String),
      internalNote: body.internalNote,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason: applicantVisibleReason,
    });
    await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      internalNote: body.internalNote,
      operationKey: body.operationKey,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason: applicantVisibleReason,
    });
    const inbox = await request.get("/api/v2/inbox");
    expect(await inbox.json()).toEqual({
      data: {
        decisions: [
          {
            applicationId: identity.applicationId,
            createdAt: decision.createdAt,
            id: decision.id,
            outcome: "rejected",
            visibleReason: applicantVisibleReason,
          },
        ],
        page: { hasNext: false, hasPrevious: false, number: 1 },
      },
    });

    const applicantState = await request.storageState();
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      storageState: applicantState,
    });
    try {
      const page = await context.newPage();
      await page.goto("/inbox");
      await expect(
        page.getByRole("heading", { exact: true, name: "收件匣" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { exact: true, name: "會籍申請已被拒絕" })
      ).toBeVisible();
      const decidedAt = new Date(decision.createdAt * 1000);
      const decisionTimes = page.getByRole("main").locator("time");
      await expect(decisionTimes).toHaveCount(2);
      await expect(decisionTimes.first()).toHaveAttribute(
        "datetime",
        decidedAt.toISOString()
      );
      await expect(decisionTimes.last()).toHaveAttribute(
        "datetime",
        decidedAt.toISOString()
      );
      const hongKongParts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          day: "numeric",
          hour: "2-digit",
          hourCycle: "h23",
          minute: "2-digit",
          month: "numeric",
          timeZone: "Asia/Hong_Kong",
          year: "numeric",
        })
          .formatToParts(decidedAt)
          .map(({ type, value }) => [type, value])
      ) as Record<string, string>;
      await expect(decisionTimes.last()).toHaveText(
        `${hongKongParts.year}年${hongKongParts.month}月${hongKongParts.day}日 ${hongKongParts.hour}:${hongKongParts.minute}（香港）`
      );
      await expect(
        page.getByText(applicantVisibleReason, { exact: true })
      ).toBeVisible();
      await expect(
        page.getByText(body.internalNote, { exact: true })
      ).toHaveCount(0);
      await qualifyPresentation(page, test.info(), "decision-inbox", {
        criticalAction: page.getByRole("button", { name: "查看我的申請" }),
        drafts: page.locator("input[id], textarea[id]"),
      });
    } finally {
      await context.close();
    }
    const ownApplication = await request.get("/api/v2/applications/mine");
    expect(await ownApplication.json()).toMatchObject({
      data: { application: { status: "rejected" } },
    });
    const currentAccount = await request.get("/api/v2/me");
    expect(currentAccount.status()).toBe(403);
    const stale = await staff.context.post(
      "/api/v2/staff/application-decisions",
      {
        data: {
          applicationId: identity.applicationId,
          operationKey: randomUUID(),
          outcome: "approved",
        },
      }
    );
    expect(stale.status()).toBe(409);
    const changedReplay = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: { ...body, visibleReason: "已改寫的原因" } }
    );
    expect(changedReplay.status()).toBe(409);
  }
);

dedicatedTest(
  "decision receipt and read-only audit survive target deletion",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-authorization",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, request, staff, staffPage: page }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const applicantSignIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(applicantSignIn.status()).toBe(200);
    const identity = await applicationIdentity(caseApp, input.username);
    const operationKey = randomUUID();
    const internalNote = "保留歷史核對資料";
    const visibleReason = "請先安排面談。";
    const result = await staff.context.post(
      "/api/v2/staff/application-decisions",
      {
        data: {
          applicationId: identity.applicationId,
          internalNote,
          operationKey,
          outcome: "rejected",
          visibleReason,
        },
      }
    );
    expect(result.status()).toBe(201);
    const {
      data: { decision },
    } = await result.json();
    expect(decision).toEqual({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: expect.any(Number),
      id: expect.any(String),
      internalNote,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason,
    });
    const beforeSnapshot = await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      internalNote,
      operationKey,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason,
    });
    const before = await staff.context.get("/api/v2/staff/account-audit");
    expect(before.status()).toBe(200);
    const beforeData = await before.json();
    const auditBefore = beforeData.data.events.filter(
      (event: { id: string }) => event.id === decision.id
    );
    expect(auditBefore).toEqual([
      {
        action: "application_rejected",
        actorUserId: staff.userId,
        createdAt: decision.createdAt,
        id: decision.id,
        internalNote,
        targetUserId: identity.userId,
      },
    ]);

    await caseApp.db
      .prepare("delete from user where id = ?")
      .bind(identity.userId)
      .run();
    expect(
      await caseApp.db
        .prepare("select id from user where id = ?")
        .bind(identity.userId)
        .first()
    ).toBeNull();
    const afterSnapshot = await decisionSnapshot(
      caseApp,
      identity.applicationId
    );
    expect(afterSnapshot.application).toEqual({
      applicationId: identity.applicationId,
      decisionId: decision.id,
      membershipStatus: null,
      status: "rejected",
      targetRole: null,
      targetUserId: identity.userId,
    });
    expect(afterSnapshot.decisions).toEqual(beforeSnapshot.decisions);
    expect(afterSnapshot.auditEvents).toEqual([
      {
        action: "application_rejected",
        actorUserId: staff.userId,
        createdAt: decision.createdAt,
        id: decision.id,
        targetUserId: identity.userId,
      },
    ]);
    const deletedApplicantInbox = await request.get("/api/v2/inbox");
    expect(deletedApplicantInbox.status()).toBe(401);
    expect(await deletedApplicantInbox.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
    const after = await staff.context.get("/api/v2/staff/account-audit");
    expect(after.status()).toBe(200);
    const afterData = await after.json();
    expect(
      afterData.data.events.filter(
        (event: { id: string }) => event.id === decision.id
      )
    ).toEqual(auditBefore);
    const reconciled = await staff.context.post(
      "/api/v2/staff/application-decisions/reconcile",
      { data: { applicationId: identity.applicationId, operationKey } }
    );
    expect(await reconciled.json()).toEqual({
      data: { applicationStatus: "rejected", decision },
    });
    expect(
      await caseApp.db
        .prepare(
          "select username_key as usernameKey, user_id as userId from username_reservation where username_key = ?"
        )
        .bind(input.username)
        .first()
    ).toEqual({ userId: identity.userId, usernameKey: input.username });

    await page.goto("/staff/account-audit");
    const row = page.getByRole("listitem").filter({
      has: page.locator(`a[href="/staff/account-audit?record=${decision.id}"]`),
    });
    await expect(row.getByRole("link")).toBeVisible();
    await expect(row.getByText(internalNote, { exact: true })).toHaveCount(0);
    await row.getByRole("link").click();
    const detail = page.getByRole("region", { name: "帳戶紀錄詳情" });
    await expect(detail).toBeVisible();
    await detail.getByText("紀錄詳情", { exact: true }).click();
    await expect(
      detail.getByText(decision.actorUserId, { exact: true })
    ).toBeVisible();
    await expect(
      detail.getByText(identity.userId, { exact: true })
    ).toBeVisible();
    await expect(detail.getByText(decision.id, { exact: true })).toBeVisible();
    await expect(detail.getByText(internalNote, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").locator("time")).toContainText("香港");
    await expect(detail.getByRole("button")).toHaveCount(0);
    await expect(detail.getByRole("textbox")).toHaveCount(0);
    await expect(
      detail.getByRole("link", {
        name: /編輯|修改|刪除|匯出|export|edit|delete/iu,
      })
    ).toHaveCount(0);
    await qualifyPresentation(page, test.info(), "decision-audit", {
      criticalAction: page.getByRole("link", { name: "返回帳戶紀錄" }),
      drafts: page.locator("input[id], textarea[id]"),
    });
  }
);

test(
  "Staff's unsaved rejection draft blocks page unload and preserves private notes",
  {
    tag: ["@native", "@browser", "@risk-recovery", "@risk-privacy"],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
    const identity = await applicationIdentity(caseApp, input.username);
    let decisionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/application-decisions")
      ) {
        decisionPosts += 1;
      }
    });

    const visibleReason = "請先核對申請資料。";
    const internalNote = "僅供職員查閱的草稿備註";
    await page.goto("/staff/applications");
    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();
    await page.getByRole("radio", { name: "拒絕申請" }).check();
    await page.getByLabel("拒絕原因（申請人可見，必填）").fill(visibleReason);
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(internalNote);

    const dismissUnload = page
      .waitForEvent("dialog", { timeout: 5000 })
      .then(async (dialog) => {
        expect(dialog.type()).toBe("beforeunload");
        await dialog.dismiss();
      });
    await Promise.all([
      dismissUnload,
      page
        .getByRole("navigation", { name: "主要導覽" })
        .getByRole("link", { exact: true, name: "主頁" })
        .click({ noWaitAfter: true }),
    ]);
    await expect(page).toHaveURL(
      new RegExp(`/staff/applications\\?record=${identity.applicationId}$`, "u")
    );
    await expect(page.getByLabel("拒絕原因（申請人可見，必填）")).toHaveValue(
      visibleReason
    );
    await expect(page.getByLabel("內部備註（選填，申請人不可見）")).toHaveValue(
      internalNote
    );
    expect(decisionPosts).toBe(0);
  }
);

test(
  "Staff reviews the exact rejection and private note before one explicit final submit",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-authorization",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
    const identity = await applicationIdentity(caseApp, input.username);
    let decisionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/application-decisions")
      ) {
        decisionPosts += 1;
      }
    });

    const originalViewport = page.viewportSize();
    await page.goto("/staff/applications");
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
    await expect(
      page.getByRole("definition").filter({ hasText: visibleReason })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: internalNote })
    ).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect(decisionPosts).toBe(0);
    const finalSubmit = page.getByRole("button", {
      name: "確認並提交拒絕",
    });
    await page.setViewportSize({ height: 740, width: 320 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(320);
    await page
      .getByRole("button", { exact: true, name: "返回待批清單" })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "放棄未提交的更改？" })
    ).toBeVisible();
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: visibleReason })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: internalNote })
    ).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.style.removeProperty("font-size");
    });
    if (originalViewport) {
      await page.setViewportSize(originalViewport);
    }
    await page
      .getByRole("button", { exact: true, name: "返回待批清單" })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "放棄未提交的更改？" })
    ).toBeVisible();
    await page.getByRole("button", { name: "放棄變更" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toHaveCount(0);
    const reopenApplication = page.getByRole("button", {
      name: `審批 ${input.fullName}（${input.username}）`,
    });
    await expect(reopenApplication).toBeVisible();
    expect(decisionPosts).toBe(0);
    await reopenApplication.click();
    await page.getByRole("radio", { name: "拒絕申請" }).check();
    const visibleReasonField = page.getByLabel("拒絕原因（申請人可見，必填）");
    const internalNoteField = page.getByLabel("內部備註（選填，申請人不可見）");
    await expect(visibleReasonField).toHaveValue("");
    await expect(internalNoteField).toHaveValue("");
    await visibleReasonField.fill(visibleReason);
    await internalNoteField.fill(internalNote);
    await previewDecision.click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: visibleReason })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: internalNote })
    ).toBeVisible();
    expect(decisionPosts).toBe(0);
    await qualifyPresentation(page, test.info(), "decision-rejection-review", {
      criticalAction: finalSubmit,
      drafts: page.locator("input[id], textarea[id]"),
    });
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/application-decisions")
    );
    await finalSubmit.click();
    const decisionResponse = await submitted;
    expect(decisionResponse.status()).toBe(201);
    expect(decisionPosts).toBe(1);
    const {
      data: { decision },
    } = await decisionResponse.json();
    expect(decision).toEqual({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: expect.any(Number),
      id: expect.any(String),
      internalNote,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason,
    });
    const operation = await page.evaluate((key) => {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, storageKey);
    expect(operation).toMatchObject({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      key: expect.stringMatching(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
      ),
      outcome: "rejected",
    });
    const savedSnapshot = await decisionSnapshot(
      caseApp,
      identity.applicationId
    );
    const [savedDecision] = savedSnapshot.decisions;
    if (!savedDecision) {
      throw new Error("Submitted synthetic decision is missing from app D1");
    }
    expect(savedDecision.operationKey).toBe(operation.key);
    await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      internalNote,
      operationKey: operation.key,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason,
    });
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認拒絕申請" })
    ).toBeVisible();
    await expect(page.getByText(visibleReason, { exact: true })).toBeVisible();
    await expect(page.getByText(internalNote, { exact: true })).toHaveCount(0);
  }
);

test(
  "Staff decision validation keeps approval reason optional and focuses invalid rejection fields",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
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
    await qualifyPresentation(page, test.info(), "decision-approve-review", {
      criticalAction: page.getByRole("button", { name: "確認並提交批准" }),
      drafts: page.locator("input[id], textarea[id]"),
    });
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
    await expect(visibleReason).toBeFocused();
    await expect(page.getByText("501／500 字", { exact: true })).toBeVisible();
    await expect(internalNote).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toHaveCount(0);
    expect(decisionPosts).toBe(0);
    await qualifyPresentation(page, test.info(), "decision-validation", {
      criticalAction: previewDecision,
      drafts: page.locator("input[id], textarea[id]"),
      focus: visibleReason,
    });

    await visibleReason.fill("  請先安排會面。  ");
    await internalNote.fill("  只供職員查閱。  ");
    await previewDecision.click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: "請先安排會面。" })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: "只供職員查閱。" })
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
    await qualifyPresentation(page, test.info(), "decision-reject-review", {
      criticalAction: page.getByRole("button", { name: "確認並提交拒絕" }),
      drafts: page.locator("input[id], textarea[id]"),
    });
  }
);

dedicatedTest(
  "a pending selection heading focus cannot steal input from the decision note",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }

    await page.goto("/staff/applications");
    await page.evaluate(() => {
      const traceWindow = window as Window & {
        __pendingReviewFocusFrame?: FrameRequestCallback;
        __reviewFocusEvents?: string[];
      };
      const events: string[] = [];
      const requestAnimationFrame = window.requestAnimationFrame.bind(window);
      let captureNextFrame = false;
      const captureFrame = (frame: FrameRequestCallback) => {
        if (captureNextFrame) {
          captureNextFrame = false;
          traceWindow.__pendingReviewFocusFrame = frame;
          window.requestAnimationFrame = requestAnimationFrame;
          return 0;
        }
        return requestAnimationFrame(frame);
      };
      window.requestAnimationFrame = captureFrame;
      traceWindow.__reviewFocusEvents = events;
      document.addEventListener(
        "click",
        (event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest(
              'button[aria-pressed="false"][aria-label^="審批 "]'
            )
          ) {
            return;
          }
          captureNextFrame = true;
          window.requestAnimationFrame = captureFrame;
          events.push("queue-application.click");
        },
        true
      );
      document.addEventListener(
        "focusin",
        (event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.id === "review-name"
          ) {
            events.push("heading.focusin");
            return;
          }
          if (
            !(event.target instanceof HTMLTextAreaElement) ||
            event.target.id !== "decision-internal-note"
          ) {
            return;
          }
          events.push("textarea.focusin");
          const frameToFocus = traceWindow.__pendingReviewFocusFrame;
          if (!frameToFocus) {
            throw new Error("Pending review heading focus callback is missing");
          }
          traceWindow.__pendingReviewFocusFrame = undefined;
          return frameToFocus(performance.now());
        },
        true
      );
      document.addEventListener(
        "focusout",
        (event) => {
          if (
            event.target instanceof HTMLTextAreaElement &&
            event.target.id === "decision-internal-note"
          ) {
            events.push("textarea.focusout");
          }
        },
        true
      );
      for (const type of ["beforeinput", "input"]) {
        document.addEventListener(
          type,
          (event) => {
            if (
              event.target instanceof HTMLTextAreaElement &&
              event.target.id === "decision-internal-note"
            ) {
              events.push(`textarea.${type}`);
            }
          },
          true
        );
      }
    });

    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: input.fullName })
    ).toBeVisible();
    const callbackCaptured = await page.evaluate(() =>
      Boolean(
        (
          window as Window & {
            __pendingReviewFocusFrame?: FrameRequestCallback;
          }
        ).__pendingReviewFocusFrame
      )
    );
    expect(callbackCaptured).toBe(true);

    const headingFocusTarget = await page.evaluate(() => {
      const traceWindow = window as Window & {
        __pendingReviewFocusFrame?: FrameRequestCallback;
      };
      const frameToFocus = traceWindow.__pendingReviewFocusFrame;
      if (!frameToFocus) {
        throw new Error("Pending review heading focus callback is missing");
      }
      traceWindow.__pendingReviewFocusFrame = undefined;
      frameToFocus(performance.now());
      return document.activeElement instanceof HTMLElement
        ? document.activeElement.id
        : null;
    });
    expect(headingFocusTarget).toBe("review-name");

    await page.getByRole("button", { name: "返回待批清單" }).click();
    await expect(page).toHaveURL(/\/staff\/applications$/u);
    await page
      .getByRole("button", {
        name: `審批 ${input.fullName}（${input.username}）`,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: input.fullName })
    ).toBeVisible();
    const pendingUserFocus = await page.evaluate(() =>
      Boolean(
        (
          window as Window & {
            __pendingReviewFocusFrame?: FrameRequestCallback;
          }
        ).__pendingReviewFocusFrame
      )
    );
    expect(pendingUserFocus).toBe(true);

    await page.getByRole("radio", { name: "批准申請" }).check();
    const internalNote = "焦點競賽下保留的合成備註";
    const field = page.getByLabel("內部備註（選填，申請人不可見）");
    let fillError: string | null = null;
    try {
      await field.fill(internalNote);
    } catch (error: unknown) {
      fillError = `${error}`;
    }
    const focusTrace = await page.evaluate(() => {
      const traceWindow = window as Window & {
        __pendingReviewFocusFrame?: FrameRequestCallback;
        __reviewFocusEvents?: string[];
      };
      return {
        activeElementId:
          document.activeElement instanceof HTMLElement
            ? document.activeElement.id
            : null,
        events: traceWindow.__reviewFocusEvents ?? [],
        pendingFrame: Boolean(traceWindow.__pendingReviewFocusFrame),
        value:
          document.querySelector<HTMLTextAreaElement>("#decision-internal-note")
            ?.value ?? null,
      };
    });
    console.log(
      `[W10 pending heading focus] ${JSON.stringify({ fillError, ...focusTrace })}`
    );
    expect(fillError).toBeNull();
    expect(focusTrace.value).toBe(internalNote);
  }
);

dedicatedTest(
  "a committed decision with a lost response reconciles to one receipt and never reopens",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-atomicity",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
    const identity = await applicationIdentity(caseApp, input.username);
    let decisionWrites = 0;
    const reconciliationBodies: unknown[] = [];
    const selectedRecordRscFetched = Promise.withResolvers<null>();
    const releaseSelectedRecordRsc = Promise.withResolvers<null>();
    const decisionInputObserved = Promise.withResolvers<number>();
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent
          .url()
          .endsWith("/api/v2/staff/application-decisions/reconcile")
      ) {
        reconciliationBodies.push(requestEvent.postDataJSON());
      }
    });
    await page.route("**/api/v2/staff/application-decisions", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      decisionWrites += 1;
      await route.fetch();
      await route.abort();
    });
    await page.route(
      (url) =>
        url.pathname === "/staff/applications" &&
        url.searchParams.get("record") === identity.applicationId &&
        url.searchParams.has("_rsc"),
      async (route) => {
        const response = await route.fetch();
        selectedRecordRscFetched.resolve(null);
        await releaseSelectedRecordRsc.promise;
        await route.fulfill({ response });
      }
    );
    await page.exposeFunction(
      "releaseSelectedDecisionRscAfterInput",
      (valueLength: number) => {
        decisionInputObserved.resolve(valueLength);
        releaseSelectedRecordRsc.resolve(null);
      }
    );

    const internalNote = "遺失回應的內部備註";
    const internalNoteField = page.getByLabel("內部備註（選填，申請人不可見）");
    await page.goto("/staff/applications");
    try {
      await page
        .getByRole("button", {
          name: `審批 ${input.fullName}（${input.username}）`,
        })
        .click();
      await selectedRecordRscFetched.promise;
      await page.getByRole("radio", { name: "批准申請" }).check();
      await page.evaluate(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "#decision-internal-note"
        );
        if (!textarea) {
          throw new Error(
            "Decision note field is missing during selection RSC"
          );
        }
        type WindowWithDecisionInputSignal = Window & {
          releaseSelectedDecisionRscAfterInput?: (
            valueLength: number
          ) => Promise<void>;
        };
        document.addEventListener(
          "input",
          (event) => {
            if (event.target !== textarea) {
              return;
            }
            const signal = (window as WindowWithDecisionInputSignal)
              .releaseSelectedDecisionRscAfterInput;
            if (!signal) {
              throw new Error("Decision note input signal is missing");
            }
            void signal(textarea.value.length);
          },
          { once: true }
        );
      });
      const typeNote = internalNoteField.pressSequentially(internalNote);
      const valueLengthAtRscRelease = await decisionInputObserved.promise;
      expect(valueLengthAtRscRelease).toBeGreaterThan(0);
      expect(valueLengthAtRscRelease).toBeLessThan(internalNote.length);
      await typeNote;
      await expect(internalNoteField).toHaveValue(internalNote);
      releaseSelectedRecordRsc.resolve(null);
      await expect(internalNoteField).toHaveValue(internalNote);
    } finally {
      releaseSelectedRecordRsc.resolve(null);
    }
    await expect(internalNoteField).toHaveValue(internalNote);
    await page.getByRole("button", { name: "檢查並預覽決定" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查批准決定" })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: internalNote })
    ).toHaveText(internalNote);
    await page.getByRole("button", { name: "確認並提交批准" }).click();

    await expect(
      page.getByRole("heading", { exact: true, name: "已確認批准申請" })
    ).toBeVisible();
    expect(decisionWrites).toBe(1);
    const saved = await page.evaluate((key) => {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, storageKey);
    expect(saved).toMatchObject({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      key: expect.stringMatching(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
      ),
      outcome: "approved",
    });
    const persisted = await decisionSnapshot(caseApp, identity.applicationId);
    const [storedDecision] = persisted.decisions;
    if (!storedDecision) {
      throw new Error("Committed synthetic decision is missing from app D1");
    }
    expect(storedDecision.operationKey).toBe(saved.key);
    expect(storedDecision.actorUserId).toBe(staff.userId);
    expect(storedDecision.targetUserId).toBe(identity.userId);
    expect(storedDecision.applicationId).toBe(identity.applicationId);
    expect(storedDecision.outcome).toBe("approved");
    await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: storedDecision.createdAt,
      decisionId: storedDecision.id,
      internalNote,
      operationKey: saved.key,
      outcome: "approved",
      targetUserId: identity.userId,
      visibleReason: null,
    });
    await expect(
      page.getByText(storedDecision.id, { exact: true })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認批准申請" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "檢查並預覽決定" })
    ).toHaveCount(0);
    expect(decisionWrites).toBe(1);
    const afterReload = await decisionSnapshot(caseApp, identity.applicationId);
    expect(afterReload.decisions).toHaveLength(1);
    expect(afterReload.auditEvents).toHaveLength(1);
    expect(afterReload.decisions[0]?.operationKey).toBe(saved.key);
    expect(reconciliationBodies.length).toBeGreaterThan(0);
    expect(reconciliationBodies).toEqual(
      Array.from({ length: reconciliationBodies.length }, () => ({
        applicationId: identity.applicationId,
        operationKey: saved.key,
      }))
    );
  }
);

test(
  "a decision lost before commit remains unresolved until the explicit original-key retry",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-recovery",
      "@risk-atomicity",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
    const identity = await applicationIdentity(caseApp, input.username);
    const decisionRoute = "**/api/v2/staff/application-decisions";
    let decisionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/application-decisions")
      ) {
        decisionPosts += 1;
      }
    });
    await page.route(decisionRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
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
    expect(decisionPosts).toBe(1);
    const beforeRetry = await decisionSnapshot(caseApp, identity.applicationId);
    expect(beforeRetry.application).toEqual({
      applicationId: identity.applicationId,
      decisionId: null,
      membershipStatus: "pending",
      status: "pending",
      targetRole: "member",
      targetUserId: identity.userId,
    });
    expect(beforeRetry.decisions).toEqual([]);
    expect(beforeRetry.auditEvents).toEqual([]);
    const saved = await page.evaluate((key) => {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, storageKey);
    expect(saved).toMatchObject({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      key: expect.stringMatching(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu
      ),
      outcome: "rejected",
    });

    await page.unroute(decisionRoute);
    await page.reload();
    await expect(page.getByText(retryCopy, { exact: true })).toBeVisible();
    await page.getByLabel("拒絕原因（申請人可見，必填）").fill(visibleReason);
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(internalNote);
    await page.getByRole("button", { name: "檢查後重試同一決定" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "檢查拒絕決定" })
    ).toBeVisible();
    expect(decisionPosts).toBe(1);
    const retried = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/application-decisions")
    );
    await page.getByRole("button", { name: "重試同一決定" }).click();
    const retriedResponse = await retried;
    expect(retriedResponse.status()).toBe(201);
    expect(decisionPosts).toBe(2);
    await expect(
      page.getByRole("heading", { exact: true, name: "已確認拒絕申請" })
    ).toBeVisible();
    const {
      data: { decision },
    } = await retriedResponse.json();
    expect(decision.actorUserId).toBe(staff.userId);
    expect(decision.applicationId).toBe(identity.applicationId);
    expect(decision.outcome).toBe("rejected");
    await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      internalNote,
      operationKey: saved.key,
      outcome: "rejected",
      targetUserId: identity.userId,
      visibleReason,
    });
  }
);

dedicatedTest(
  "a decision key from another Staff actor is retained and never reconciled as the current actor",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-actor-target-key",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staffPage: page }) => {
    const input = applicationInput();
    const applicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(applicant, input);
    } finally {
      await applicant.dispose();
    }
    const identity = await applicationIdentity(caseApp, input.username);
    const otherSuffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const otherActorId = await caseApp.provision.account({
      email: `other.${otherSuffix}@example.test`,
      fullName: "陳另一位職員",
      membershipStatus: "active",
      password: "Synthetic-other-staff-password!",
      role: "staff",
      username: `other.${otherSuffix}`,
    });
    const savedOperation = {
      actorUserId: otherActorId,
      applicationId: identity.applicationId,
      key: randomUUID(),
      outcome: "approved",
    } as const;
    await page.addInitScript(
      ({ key, operation }) => {
        localStorage.setItem(key, JSON.stringify(operation));
      },
      { key: storageKey, operation: savedOperation }
    );
    let reconcilePosts = 0;
    let decisionPosts = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent
          .url()
          .endsWith("/api/v2/staff/application-decisions/reconcile")
      ) {
        reconcilePosts += 1;
      }
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/application-decisions")
      ) {
        decisionPosts += 1;
      }
    });

    await page.goto("/staff/applications");
    await expect(
      page.getByText(
        "此瀏覽器保留了另一帳戶尚未確認的操作。請先以原職員帳戶登入查核；操作代碼不會被覆蓋或清除。",
        { exact: true }
      )
    ).toBeVisible();
    expect(reconcilePosts).toBe(0);
    expect(decisionPosts).toBe(0);
    expect(
      await page.evaluate((key) => {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      }, storageKey)
    ).toEqual(savedOperation);
    const unchanged = await decisionSnapshot(caseApp, identity.applicationId);
    expect(unchanged.application).toEqual({
      applicationId: identity.applicationId,
      decisionId: null,
      membershipStatus: "pending",
      status: "pending",
      targetRole: "member",
      targetUserId: identity.userId,
    });
    expect(unchanged.decisions).toEqual([]);
    expect(unchanged.auditEvents).toEqual([]);
  }
);
