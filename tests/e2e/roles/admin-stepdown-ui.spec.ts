import { randomUUID } from "node:crypto";

import type {
  Locator,
  Page,
  PlaywrightWorkerArgs,
  TestInfo,
} from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import type { PresentationAssertions } from "../presentation-assertions";

type GlobalRole = "admin" | "member" | "staff";
type ResultingRole = "member" | "staff";

interface Account {
  email: string;
  fullName: string;
  password: string;
  userId: string;
  username: string;
}

const syntheticPassword = "Synthetic-admin-stepdown-ui-password!";
const mutationPath = "/api/v2/roles/global-roles";
const reconciliationPath = `${mutationPath}/reconcile`;

const createAccount = async (
  app: NativeApp,
  label: string,
  role: GlobalRole
): Promise<Account> => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const email = `stepdown.ui.${label}.${suffix}@example.com`;
  const username = `sd.ui.${label.replaceAll("-", "")}.${suffix}`;
  const fullName = `陳自願退出${label}${suffix}`;
  const userId = await app.provision.account({
    email,
    fullName,
    membershipStatus: "active",
    password: syntheticPassword,
    role,
    username,
  });
  return {
    email,
    fullName,
    password: syntheticPassword,
    userId,
    username,
  };
};

const headersForClient = (
  headers: Record<string, string> | undefined,
  address: string
) => ({ ...headers, "cf-connecting-ip": address });

const signInBrowser = async (
  page: Page,
  account: Pick<Account, "password" | "username">
) => {
  if (!page.url().includes("/sign-in")) {
    await page.goto("/sign-in");
  }
  await page.getByRole("textbox", { name: "Username" }).fill(account.username);
  await page.getByRole("textbox", { name: "密碼" }).fill(account.password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};

const signInRequest = async (
  playwright: PlaywrightWorkerArgs["playwright"],
  app: NativeApp,
  headers: Record<string, string>,
  account: Pick<Account, "password" | "username">
) => {
  const context = await playwright.request.newContext({
    baseURL: app.origin,
    extraHTTPHeaders: headers,
  });
  try {
    const response = await context.post("/api/auth/sign-in/username", {
      data: { password: account.password, username: account.username },
    });
    expect(response.status()).toBe(200);
    return context;
  } catch (error) {
    await context.dispose();
    throw error;
  }
};

const openGlobalRoles = async (page: Page, account: Account) => {
  await signInBrowser(page, account);
  await page.goto("/staff/roles/global-roles");
  await expect(page).toHaveURL(/\/staff\/roles\/global-roles$/u);
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "自願退出管理員身份",
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "繼續" })
  ).toBeEnabled();
  await expect(
    page.getByRole("searchbox", { name: "姓名或 Username" })
  ).toBeEnabled();
};

const selectPerson = async (page: Page, target: Account) => {
  const search = page.getByRole("searchbox", { name: "姓名或 Username" });
  await search.fill(target.username);
  await page.getByRole("button", { exact: true, name: "搜尋" }).click();
  const targetButton = page.getByRole("button", {
    name: new RegExp(target.fullName, "u"),
  });
  await expect(targetButton).toBeVisible();
  await targetButton.click();

  const personRegion = page.getByRole("region", { name: target.fullName });
  await expect(
    personRegion.getByRole("heading", {
      exact: true,
      name: target.fullName,
    })
  ).toBeVisible();
  await expect(
    personRegion.getByText(target.username, { exact: true })
  ).toBeVisible();
  await expect(page.getByText(target.email, { exact: true })).toHaveCount(0);
  return { personRegion, search, targetButton };
};

const beginSelfStepdownReview = async (
  page: Page,
  resultingRole: ResultingRole
) => {
  const roleSelect = page.getByLabel("退出後的全域身份");
  await expect(roleSelect).toHaveValue("member");
  if (resultingRole === "staff") {
    await roleSelect.selectOption("staff");
  }
  await expect(roleSelect).toHaveValue(resultingRole);
  await page.getByRole("button", { exact: true, name: "繼續" }).click();

  const review = page.getByRole("heading", {
    exact: true,
    name: "確認自願退出",
  });
  await expect(review).toBeVisible();
  const roleLabel = resultingRole === "member" ? "會員" : "職員";
  await expect(
    page.getByText(
      `退出後的全域身份將是${roleLabel}。此操作會結束此帳戶所有登入工作階段，包括目前工作階段；完成後需要重新登入。`,
      { exact: true }
    )
  ).toBeVisible();

  const password = page.getByLabel("目前密碼", { exact: true });
  const confirm = page.getByRole("button", {
    exact: true,
    name: "確認並退出管理員身份",
  });
  await expect(password).toHaveValue("");
  await expect(confirm).toBeDisabled();
  return { confirm, password };
};

const qualifyReview = (
  page: Page,
  testInfo: TestInfo,
  screen: "phone" | "desktop",
  target: Account,
  confirm: Locator,
  password: Locator,
  search: Locator,
  targetButton: Locator,
  personRegion: Locator
) =>
  qualifyPresentation(page, testInfo, screen, {
    criticalAction: confirm,
    drafts: page.locator("input"),
    focus: password,
    masks: [
      search,
      targetButton,
      personRegion.getByRole("heading", {
        exact: true,
        name: target.fullName,
      }),
      personRegion.getByText(target.username, { exact: true }),
    ],
  });

const readStepdownEffects = (
  app: NativeApp,
  actorUserId: string,
  operationKey: string,
  resultingRole: ResultingRole
) =>
  app.db
    .prepare(
      `SELECT
        (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
        (SELECT COUNT(*) FROM session WHERE user_id = ?) AS sessions,
        (SELECT COUNT(*) FROM role_assignment_history
          WHERE actor_user_id = ? AND target_user_id = ?
            AND action = 'withdrawn' AND role = 'admin'
            AND resulting_global_role = ?) AS history,
        (SELECT COUNT(*) FROM role_change_operation
          WHERE actor_user_id = ? AND target_user_id = ?
            AND action = 'withdrawn' AND role = 'admin'
            AND resulting_global_role = ? AND operation_key = ?) AS receipts,
        (SELECT COUNT(*) FROM audit_event
          WHERE actor_user_id = ? AND target_user_id = ?
            AND action = 'global_role_changed') AS audits`
    )
    .bind(
      actorUserId,
      actorUserId,
      actorUserId,
      actorUserId,
      resultingRole,
      actorUserId,
      actorUserId,
      resultingRole,
      operationKey,
      actorUserId,
      actorUserId
    )
    .first<{
      audits: number;
      history: number;
      receipts: number;
      role: string;
      sessions: number;
    }>();

const readSessionCount = (app: NativeApp, actorUserId: string) =>
  app.db
    .prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
    .bind(actorUserId)
    .first<{ count: number }>();

const readAuthContextMarker = (page: Page) =>
  page.evaluate(() => {
    const marker = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("efcc-auth-context="));
    return marker?.slice("efcc-auth-context=".length) ?? null;
  });

const selfStepdownStorageKey = (actorUserId: string) =>
  `efcc.admin-stepdown.feedback.v1:${encodeURIComponent(actorUserId)}`;

const expectNoStepdownOutcome = async (page: Page) => {
  await expect(
    page.getByRole("heading", { exact: true, name: "操作已完成" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { exact: true, name: "操作結果未能確認" })
  ).toHaveCount(0);
};

type SelfStepdownFeedbackScreen =
  | "self-stepdown-ack-desktop"
  | "self-stepdown-ack-phone"
  | "self-stepdown-sign-in-desktop"
  | "self-stepdown-sign-in-phone"
  | "self-stepdown-unknown-desktop"
  | "self-stepdown-unknown-phone";

const qualifyWithoutUsernameMetadata = async (
  page: Page,
  testInfo: TestInfo,
  screen: SelfStepdownFeedbackScreen,
  assertions: PresentationAssertions
) => {
  await expect(page.locator("dt")).toHaveCount(0);
  if (screen.startsWith("self-stepdown-sign-in-")) {
    await expect(
      page.getByRole("textbox", { name: "Username" })
    ).toHaveAttribute("id", "sign-in-identifier");
    await expect(page.getByLabel("密碼", { exact: true })).toHaveAttribute(
      "id",
      "sign-in-password"
    );
  }
  await qualifyPresentation(page, testInfo, screen, assertions);
};

dedicatedTest(
  "an Admin confirms the default Member step-down, sees acknowledgement and signs in with the resulting role",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-session",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  async ({ browser, caseApp, extraHTTPHeaders, playwright }, testInfo) => {
    const actor = await createAccount(caseApp, "actor", "admin");
    const remainingAdmin = await createAccount(caseApp, "peer", "admin");
    const target = await createAccount(caseApp, "target", "member");
    const browserHeaders = headersForClient(extraHTTPHeaders, "198.19.31.10");
    const secondSessionHeaders = headersForClient(
      extraHTTPHeaders,
      "198.19.31.11"
    );
    const browserContext = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: browserHeaders,
    });
    const secondSession = await signInRequest(
      playwright,
      caseApp,
      secondSessionHeaders,
      actor
    );
    const roleReadsAfterCommand: string[] = [];
    const commandBodies: Record<string, unknown>[] = [];
    let commandDispatched = false;
    let reconciliations = 0;

    try {
      const page = await browserContext.newPage();
      await openGlobalRoles(page, actor);
      const selected = await selectPerson(page, target);
      expect(await readSessionCount(caseApp, actor.userId)).toEqual({
        count: 2,
      });
      const review = await beginSelfStepdownReview(page, "member");
      await qualifyReview(
        page,
        testInfo,
        "phone",
        target,
        review.confirm,
        review.password,
        selected.search,
        selected.targetButton,
        selected.personRegion
      );
      await qualifyReview(
        page,
        testInfo,
        "desktop",
        target,
        review.confirm,
        review.password,
        selected.search,
        selected.targetButton,
        selected.personRegion
      );

      await page.route("**/api/v2/roles/global-roles**", async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (pathname === reconciliationPath) {
          reconciliations += 1;
        }
        if (commandDispatched && pathname.startsWith(mutationPath)) {
          roleReadsAfterCommand.push(`${request.method()} ${pathname}`);
        }
        if (request.method() === "POST" && pathname === mutationPath) {
          commandDispatched = true;
          commandBodies.push(request.postDataJSON() as Record<string, unknown>);
        }
        await route.continue();
      });

      const responsePromise = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "POST" &&
          new URL(response.url()).pathname === mutationPath
        );
      });
      await review.password.fill(actor.password);
      await review.confirm.click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      expect(commandBodies).toHaveLength(1);
      const operationKey = commandBodies[0]?.operationKey;
      expect(operationKey).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/iu));
      expect(commandBodies[0]).toMatchObject({
        action: "withdrawn",
        operationKey,
        resultingGlobalRole: "member",
        role: "admin",
        targetUserId: actor.userId,
      });

      const completedHeading = page.getByRole("heading", {
        exact: true,
        name: "操作已完成",
      });
      const outcome = page.getByRole("status").filter({
        has: completedHeading,
      });
      await expect(outcome).toContainText("操作已完成");
      await expect(outcome).toContainText("現時全域身份為會員");
      await expect(outcome).toContainText("所有登入工作階段已結束");
      await expect(page.getByLabel("目前密碼", { exact: true })).toHaveCount(0);
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-ack-phone",
        {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        }
      );
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-ack-desktop",
        {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        }
      );

      expect(
        await readStepdownEffects(
          caseApp,
          actor.userId,
          operationKey as string,
          "member"
        )
      ).toEqual({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });
      const peerRole = await caseApp.db
        .prepare(
          "SELECT account_role AS role FROM person_profile WHERE user_id=?"
        )
        .bind(remainingAdmin.userId)
        .first<{ role: string }>();
      expect(peerRole).toEqual({ role: "admin" });
      const revokedSecondSession = await secondSession.get(
        "/api/auth/get-session"
      );
      expect(revokedSecondSession.status()).toBe(200);
      expect(await revokedSecondSession.json()).toBeNull();
      expect(roleReadsAfterCommand).toEqual([]);
      expect(reconciliations).toBe(0);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          selfStepdownStorageKey(actor.userId)
        )
      ).toBeNull();

      const markerBeforeFreshSignIn = await readAuthContextMarker(page);
      await page.getByRole("link", { exact: true, name: "前往登入" }).click();
      await expect(page).toHaveURL(/\/sign-in$/u);
      const usernameInput = page.getByRole("textbox", { name: "Username" });
      const loginButton = page.getByRole("button", {
        exact: true,
        name: "登入",
      });
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-sign-in-phone",
        {
          criticalAction: loginButton,
          drafts: page.locator("input"),
          focus: usernameInput,
          masks: [usernameInput],
        }
      );
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-sign-in-desktop",
        {
          criticalAction: loginButton,
          drafts: page.locator("input"),
          focus: usernameInput,
          masks: [usernameInput],
        }
      );
      await signInBrowser(page, actor);
      const markerAfterFreshSignIn = await readAuthContextMarker(page);
      expect(markerBeforeFreshSignIn).not.toBeNull();
      expect(markerAfterFreshSignIn).not.toBe(markerBeforeFreshSignIn);
      const freshSession = await page.request.get("/api/auth/get-session");
      expect(await freshSession.json()).toMatchObject({
        user: { id: actor.userId },
      });
      await page.goto("/staff/roles/global-roles");
      await expect(page).toHaveURL(/\/staff\/accounts$/u);
      await expectNoStepdownOutcome(page);
      expect(roleReadsAfterCommand).toEqual([]);
      expect(reconciliations).toBe(0);
    } finally {
      await browserContext.close();
      await secondSession.dispose();
    }
  }
);

dedicatedTest(
  "an Admin can explicitly choose Staff for a confirmed self-step-down",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-session",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  async ({ browser, caseApp, extraHTTPHeaders, playwright }, testInfo) => {
    const actor = await createAccount(caseApp, "staff-actor", "admin");
    const remainingAdmin = await createAccount(caseApp, "staff-peer", "admin");
    const target = await createAccount(caseApp, "staff-target", "member");
    const browserContext = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: headersForClient(extraHTTPHeaders, "198.19.32.10"),
    });
    const secondSession = await signInRequest(
      playwright,
      caseApp,
      headersForClient(extraHTTPHeaders, "198.19.32.11"),
      actor
    );
    const commandBodies: Record<string, unknown>[] = [];
    const roleReadsAfterCommand: string[] = [];
    let commandDispatched = false;
    let reconciliations = 0;

    try {
      const page = await browserContext.newPage();
      await openGlobalRoles(page, actor);
      const selected = await selectPerson(page, target);
      expect(await readSessionCount(caseApp, actor.userId)).toEqual({
        count: 2,
      });
      const review = await beginSelfStepdownReview(page, "staff");
      await qualifyReview(
        page,
        testInfo,
        "phone",
        target,
        review.confirm,
        review.password,
        selected.search,
        selected.targetButton,
        selected.personRegion
      );
      await qualifyReview(
        page,
        testInfo,
        "desktop",
        target,
        review.confirm,
        review.password,
        selected.search,
        selected.targetButton,
        selected.personRegion
      );

      await page.route("**/api/v2/roles/global-roles**", async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (pathname === reconciliationPath) {
          reconciliations += 1;
        }
        if (commandDispatched && pathname.startsWith(mutationPath)) {
          roleReadsAfterCommand.push(`${request.method()} ${pathname}`);
        }
        if (request.method() === "POST" && pathname === mutationPath) {
          commandDispatched = true;
          commandBodies.push(request.postDataJSON() as Record<string, unknown>);
        }
        await route.continue();
      });

      const responsePromise = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "POST" &&
          new URL(response.url()).pathname === mutationPath
        );
      });
      await review.password.fill(actor.password);
      await review.confirm.click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      expect(commandBodies).toHaveLength(1);
      const operationKey = commandBodies[0]?.operationKey;
      expect(operationKey).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/iu));
      expect(commandBodies[0]).toMatchObject({
        action: "withdrawn",
        operationKey,
        resultingGlobalRole: "staff",
        role: "admin",
        targetUserId: actor.userId,
      });

      const completedHeading = page.getByRole("heading", {
        exact: true,
        name: "操作已完成",
      });
      const outcome = page.getByRole("status").filter({
        has: completedHeading,
      });
      await expect(outcome).toContainText("操作已完成");
      await expect(outcome).toContainText("現時全域身份為職員");
      expect(
        await readStepdownEffects(
          caseApp,
          actor.userId,
          operationKey as string,
          "staff"
        )
      ).toEqual({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "staff",
        sessions: 0,
      });
      const assignments = await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM role_assigner_assignment WHERE user_id=?"
        )
        .bind(actor.userId)
        .first<{ count: number }>();
      expect(assignments).toEqual({ count: 0 });
      const peerRole = await caseApp.db
        .prepare(
          "SELECT account_role AS role FROM person_profile WHERE user_id=?"
        )
        .bind(remainingAdmin.userId)
        .first<{ role: string }>();
      expect(peerRole).toEqual({ role: "admin" });
      const revokedSecondSession = await secondSession.get(
        "/api/auth/get-session"
      );
      expect(revokedSecondSession.status()).toBe(200);
      expect(await revokedSecondSession.json()).toBeNull();
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-ack-phone",
        {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        }
      );
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-ack-desktop",
        {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        }
      );
      expect(roleReadsAfterCommand).toEqual([]);
      expect(reconciliations).toBe(0);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          selfStepdownStorageKey(actor.userId)
        )
      ).toBeNull();
    } finally {
      await browserContext.close();
      await secondSession.dispose();
    }
  }
);

dedicatedTest(
  "a committed self-step-down with an aborted response remains UNKNOWN without result lookup or retry",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-session",
      "@risk-resilience",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  async ({ browser, caseApp, extraHTTPHeaders, playwright }, testInfo) => {
    const actor = await createAccount(caseApp, "unknown-actor", "admin");
    await createAccount(caseApp, "unknown-peer", "admin");
    const target = await createAccount(caseApp, "unknown-target", "member");
    const browserContext = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: headersForClient(extraHTTPHeaders, "198.19.33.10"),
    });
    const secondSession = await signInRequest(
      playwright,
      caseApp,
      headersForClient(extraHTTPHeaders, "198.19.33.11"),
      actor
    );
    const fetchedCommand = Promise.withResolvers<{
      operationKey: string;
      status: number;
    }>();
    const commandBodies: Record<string, unknown>[] = [];
    const protectedRoleRequestsAfterDispatch: string[] = [];
    let commandDispatched = false;
    let reconciliations = 0;

    try {
      const page = await browserContext.newPage();
      await openGlobalRoles(page, actor);
      await selectPerson(page, target);
      expect(await readSessionCount(caseApp, actor.userId)).toEqual({
        count: 2,
      });
      const review = await beginSelfStepdownReview(page, "member");
      const markerBeforeSubmit = await readAuthContextMarker(page);
      expect(markerBeforeSubmit).toMatch(/^[0-9a-f-]{36}$/iu);

      await page.route("**/api/v2/roles/global-roles**", async (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (pathname === reconciliationPath) {
          reconciliations += 1;
        }
        if (commandDispatched && pathname.startsWith(mutationPath)) {
          protectedRoleRequestsAfterDispatch.push(
            `${request.method()} ${pathname}`
          );
        }
        if (request.method() === "POST" && pathname === mutationPath) {
          commandDispatched = true;
          const body = request.postDataJSON() as Record<string, unknown>;
          commandBodies.push(body);
          const response = await route.fetch();
          await route.abort();
          fetchedCommand.resolve({
            operationKey: String(body.operationKey),
            status: response.status(),
          });
          return;
        }
        await route.continue();
      });

      await review.password.fill(actor.password);
      await review.confirm.click();
      const committed = await fetchedCommand.promise;
      expect(committed.status).toBe(201);
      expect(commandBodies).toHaveLength(1);
      expect(commandBodies[0]).toMatchObject({
        action: "withdrawn",
        operationKey: committed.operationKey,
        resultingGlobalRole: "member",
        role: "admin",
        targetUserId: actor.userId,
      });
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: "操作結果未能確認",
        })
      ).toBeVisible();
      await expect(
        page.getByText(
          "請勿重複提交。此頁的管理資料已清除；請重新登入以繼續使用帳戶。",
          { exact: true }
        )
      ).toBeVisible();
      expect(
        await readStepdownEffects(
          caseApp,
          actor.userId,
          committed.operationKey,
          "member"
        )
      ).toEqual({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });
      const storedReference = await page.evaluate((key) => {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      }, selfStepdownStorageKey(actor.userId));
      expect(storedReference).toEqual({
        actorUserId: actor.userId,
        authContextMarker: markerBeforeSubmit,
        operationKey: committed.operationKey,
      });
      await expect(page.getByRole("region", { name: "人士資料" })).toHaveCount(
        0
      );
      await expect(page.getByRole("searchbox")).toHaveCount(0);
      await expect(
        page.getByRole("button", { exact: true, name: "查核操作結果" })
      ).toHaveCount(0);
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-unknown-phone",
        {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        }
      );
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-unknown-desktop",
        {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        }
      );

      await page.reload();
      await expect(page).toHaveURL(
        /\/sign-in\?reason=authentication-required$/u
      );
      await expectNoStepdownOutcome(page);
      expect(await readAuthContextMarker(page)).toBe(markerBeforeSubmit);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          selfStepdownStorageKey(actor.userId)
        )
      ).toBe(JSON.stringify(storedReference));
      const usernameInput = page.getByRole("textbox", { name: "Username" });
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-sign-in-phone",
        {
          criticalAction: page.getByRole("button", {
            exact: true,
            name: "登入",
          }),
          drafts: page.locator("input"),
          focus: usernameInput,
          masks: [usernameInput],
        }
      );
      await qualifyWithoutUsernameMetadata(
        page,
        testInfo,
        "self-stepdown-sign-in-desktop",
        {
          criticalAction: page.getByRole("button", {
            exact: true,
            name: "登入",
          }),
          drafts: page.locator("input"),
          focus: usernameInput,
          masks: [usernameInput],
        }
      );

      await signInBrowser(page, actor);
      const markerAfterFreshSignIn = await readAuthContextMarker(page);
      expect(markerAfterFreshSignIn).not.toBe(markerBeforeSubmit);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          selfStepdownStorageKey(actor.userId)
        )
      ).toBe(JSON.stringify(storedReference));
      await expectNoStepdownOutcome(page);
      const freshSession = await page.request.get("/api/auth/get-session");
      expect(await freshSession.json()).toMatchObject({
        user: { id: actor.userId },
      });
      await page.goto("/staff/roles/global-roles");
      await expect(page).toHaveURL(/\/staff\/accounts$/u);
      await expectNoStepdownOutcome(page);
      expect(commandBodies).toHaveLength(1);
      expect(reconciliations).toBe(0);
      expect(protectedRoleRequestsAfterDispatch).toEqual([]);
      const revokedSecondSession = await secondSession.get(
        "/api/auth/get-session"
      );
      expect(await revokedSecondSession.json()).toBeNull();
    } finally {
      await browserContext.close();
      await secondSession.dispose();
    }
  }
);

dedicatedTest(
  "a held successful self-step-down acknowledgement cannot restore actor A data after the cookie switches to Admin B",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-session",
      "@risk-resilience",
      "@risk-privacy",
    ],
  },
  async ({ browser, caseApp, extraHTTPHeaders, playwright }) => {
    const actorA = await createAccount(caseApp, "switch-a", "admin");
    const actorB = await createAccount(caseApp, "switch-b", "admin");
    const target = await createAccount(caseApp, "switch-target", "member");
    const browserContext = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: headersForClient(extraHTTPHeaders, "198.19.34.10"),
    });
    const secondActorASession = await signInRequest(
      playwright,
      caseApp,
      headersForClient(extraHTTPHeaders, "198.19.34.11"),
      actorA
    );
    const actorBSession = await signInRequest(
      playwright,
      caseApp,
      headersForClient(extraHTTPHeaders, "198.19.34.12"),
      actorB
    );
    const holdAcknowledgement = Promise.withResolvers<null>();
    const committedCommand = Promise.withResolvers<{
      operationKey: string;
      status: number;
    }>();
    const deliveredAcknowledgement = Promise.withResolvers<null>();
    const commandBodies: Record<string, unknown>[] = [];
    const reconciliations: string[] = [];
    const protectedResultLookups: string[] = [];
    let commandCaptured = false;

    try {
      const page = await browserContext.newPage();
      await openGlobalRoles(page, actorA);
      await selectPerson(page, target);
      expect(await readSessionCount(caseApp, actorA.userId)).toEqual({
        count: 2,
      });
      const review = await beginSelfStepdownReview(page, "member");
      const actorAOperationKey = selfStepdownStorageKey(actorA.userId);
      const actorBOperationKey = selfStepdownStorageKey(actorB.userId);

      await page.route("**/api/v2/roles/global-roles**", async (route) => {
        const request = route.request();
        const requestUrl = new URL(request.url());
        if (
          commandCaptured &&
          request.method() === "GET" &&
          requestUrl.pathname === mutationPath &&
          requestUrl.searchParams.has("operationKey")
        ) {
          protectedResultLookups.push(requestUrl.pathname);
        }
        if (requestUrl.pathname === reconciliationPath) {
          reconciliations.push(request.method());
          await route.continue();
          return;
        }
        if (
          request.method() === "POST" &&
          requestUrl.pathname === mutationPath
        ) {
          const body = request.postDataJSON() as Record<string, unknown>;
          commandBodies.push(body);
          if (!commandCaptured) {
            commandCaptured = true;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            committedCommand.resolve({
              operationKey: String(body.operationKey),
              status: response.status(),
            });
            await holdAcknowledgement.promise;
            await route.fulfill({ response });
            deliveredAcknowledgement.resolve(null);
            return;
          }
        }
        await route.continue();
      });

      const responsePromise = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === "POST" &&
          new URL(response.url()).pathname === mutationPath
        );
      });
      await review.password.fill(actorA.password);
      await review.confirm.click();
      const committed = await committedCommand.promise;
      expect(committed.status).toBe(201);
      expect(commandBodies).toHaveLength(1);
      expect(commandBodies[0]).toMatchObject({
        action: "withdrawn",
        operationKey: committed.operationKey,
        resultingGlobalRole: "member",
        role: "admin",
        targetUserId: actorA.userId,
      });
      const storedAReference = await page.evaluate((key) => {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      }, actorAOperationKey);
      expect(storedAReference).toEqual({
        actorUserId: actorA.userId,
        authContextMarker: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
        operationKey: committed.operationKey,
      });
      expect(
        await readStepdownEffects(
          caseApp,
          actorA.userId,
          committed.operationKey,
          "member"
        )
      ).toEqual({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });

      await browserContext.clearCookies();
      const actorBStorageState = await actorBSession.storageState();
      await browserContext.addCookies(actorBStorageState.cookies);
      const actorBMarker = await readAuthContextMarker(page);
      expect(actorBMarker).not.toBe(storedAReference?.authContextMarker);
      const actorBIdentity = await page.request.get("/api/auth/get-session");
      expect(await actorBIdentity.json()).toMatchObject({
        user: { id: actorB.userId },
      });
      const actorBProbePromise = page.waitForResponse((response) => {
        const request = response.request();
        const requestUrl = new URL(response.url());
        return (
          request.method() === "GET" &&
          requestUrl.pathname === mutationPath &&
          requestUrl.searchParams.get("q") === "" &&
          !requestUrl.searchParams.has("operationKey")
        );
      });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const actorBProbeResponse = await actorBProbePromise;
      expect(actorBProbeResponse.status()).toBe(200);
      const actorBProbeBody = (await actorBProbeResponse.json()) as {
        data?: { actorUserId?: string };
      };
      expect(actorBProbeBody.data?.actorUserId).toBe(actorB.userId);
      await expect(page.getByRole("region", { name: "人士資料" })).toHaveCount(
        0
      );
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: target.fullName,
        })
      ).toHaveCount(0);
      await expect(page.getByLabel("目前密碼", { exact: true })).toHaveCount(0);
      await expectNoStepdownOutcome(page);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          actorAOperationKey
        )
      ).toBe(JSON.stringify(storedAReference));
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          actorBOperationKey
        )
      ).toBeNull();

      holdAcknowledgement.resolve(null);
      await deliveredAcknowledgement.promise;
      const delivered = await responsePromise;
      expect(delivered.status()).toBe(201);
      await expect(page.getByRole("region", { name: "人士資料" })).toHaveCount(
        0
      );
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: target.fullName,
        })
      ).toHaveCount(0);
      await expectNoStepdownOutcome(page);
      expect(commandBodies).toHaveLength(1);
      expect(reconciliations).toEqual([]);
      expect(protectedResultLookups).toEqual([]);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          actorAOperationKey
        )
      ).toBe(JSON.stringify(storedAReference));
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          actorBOperationKey
        )
      ).toBeNull();

      const bRole = await caseApp.db
        .prepare(
          "SELECT account_role AS role FROM person_profile WHERE user_id=?"
        )
        .bind(actorB.userId)
        .first<{ role: string }>();
      expect(bRole).toEqual({ role: "admin" });
    } finally {
      holdAcknowledgement.resolve(null);
      await browserContext.close();
      await secondActorASession.dispose();
      await actorBSession.dispose();
    }
  }
);
