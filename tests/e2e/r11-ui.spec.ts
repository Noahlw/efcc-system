/* eslint-disable no-await-in-loop -- Journey steps share the same Page and durable state. */
import { randomBytes } from "node:crypto";

import type { Page, Request } from "@playwright/test";

import { dedicatedTest, expect } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import { qualifyPresentation } from "./presentation-assertions";

dedicatedTest.use({ actionTimeout: 10_000 });
const presentationActions = (page: Page) => ({
  account: () =>
    page
      .getByRole("button", { exact: true, name: "登出" })
      .filter({ visible: true })
      .first(),
  accounts: () => page.getByRole("searchbox").filter({ visible: true }).first(),
  "app-edit": () =>
    page
      .getByRole("button", { exact: true, name: "檢查更改" })
      .filter({ visible: true })
      .first(),
  "app-edit-review": () =>
    page
      .getByRole("button", { exact: true, name: "確認並提交更改" })
      .filter({ visible: true })
      .first(),
  "app-resubmit": () =>
    page
      .getByRole("button", { exact: true, name: "確認重新提交" })
      .filter({ visible: true })
      .first(),
  "app-withdraw": () =>
    page
      .getByRole("button", { exact: true, name: "確認撤回" })
      .filter({ visible: true })
      .first(),
  application: () => page.getByRole("button", { name: /^修正申請資料/u }),
  "application-review": () =>
    page
      .getByRole("button", { exact: true, name: "返回待批清單" })
      .filter({ visible: true })
      .first(),
  applications: () =>
    page.getByRole("button").filter({ visible: true }).first(),
  apply: () =>
    page
      .getByRole("button", { exact: true, name: "提交申請" })
      .filter({ visible: true })
      .first(),
  "apply-result": () =>
    page
      .getByRole("button", { exact: true, name: "前往登入" })
      .filter({ visible: true })
      .first(),
  audit: () =>
    page.getByRole("main").getByRole("list").getByRole("link").first(),
  "audit-detail": () =>
    page.getByRole("link", { exact: true, name: "返回帳戶紀錄" }),
  ban: () =>
    page
      .getByRole("button", { exact: true, name: "確認並封鎖帳戶" })
      .filter({ visible: true })
      .first(),
  confirm: () =>
    page
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .filter({ visible: true })
      .first(),
  create: () =>
    page
      .getByRole("button", { exact: true, name: "檢查帳戶資料" })
      .filter({ visible: true })
      .first(),
  "create-handover": () =>
    page
      .getByRole("button", { exact: true, name: "完成，開始另一項操作" })
      .filter({ visible: true })
      .first(),
  "create-review": () =>
    page
      .getByRole("button", {
        exact: true,
        name: "確認並建立帳戶及發出臨時密碼",
      })
      .filter({ visible: true })
      .first(),
  deactivate: () =>
    page
      .getByRole("button", { exact: true, name: "確認並停用會籍" })
      .filter({ visible: true })
      .first(),
  deletion: () => page.getByRole("checkbox").filter({ visible: true }).first(),
  denied: () => page.getByRole("link", { exact: true, name: "返回個人主頁" }),
  error: () =>
    page
      .getByRole("button", { exact: true, name: "重試" })
      .filter({ visible: true })
      .first(),
  handover: () =>
    page
      .getByRole("button", { exact: true, name: "完成，開始另一項操作" })
      .filter({ visible: true })
      .first(),
  home: () => page.getByRole("button", { exact: true, name: "全部" }),
  identity: () =>
    page
      .getByRole("button", { exact: true, name: "檢查修正" })
      .filter({ visible: true })
      .first(),
  "identity-review": () =>
    page
      .getByRole("button", { exact: true, name: "確認目前密碼" })
      .filter({ visible: true })
      .first(),
  inbox: () =>
    page.getByRole("button", { exact: true, name: "重新檢查帳戶狀態" }),
  leave: () =>
    page
      .getByRole("button", { exact: true, name: "繼續編輯" })
      .filter({ visible: true })
      .first(),
  management: () => page.getByRole("link", { name: /^帳戶管理/u }),
  operation: () =>
    page
      .getByRole("button", { exact: true, name: "查核之前的操作" })
      .filter({ visible: true })
      .first(),
  password: () => page.getByRole("button", { exact: true, name: "更改密碼" }),
  person: () => page.getByRole("link", { name: /修正身份資料/u }),
  phone: () =>
    page
      .getByRole("button", { exact: true, name: "檢查電話" })
      .filter({ visible: true })
      .first(),
  reactivate: () =>
    page
      .getByRole("button", { exact: true, name: "確認並重新啟用會籍" })
      .filter({ visible: true })
      .first(),
  recovery: () =>
    page
      .getByRole("button", { exact: true, name: "檢查資料" })
      .filter({ visible: true })
      .first(),
  "recovery-review": () =>
    page
      .getByRole("button", {
        exact: true,
        name: "確認並重設密碼及登出全部裝置",
      })
      .filter({ visible: true })
      .first(),
  restrictions: () =>
    page
      .getByRole("button", { exact: true, name: "封鎖帳戶" })
      .filter({ visible: true })
      .first(),
  security: () => page.getByRole("link", { name: /^更改密碼/u }),
  sessions: () =>
    page
      .getByRole("button", { exact: true, name: "取消" })
      .filter({ visible: true })
      .first(),
  signin: () =>
    page
      .getByRole("button", { exact: true, name: "登入" })
      .filter({ visible: true })
      .first(),
  signout: () =>
    page
      .getByRole("button", { exact: true, name: "重試登出" })
      .filter({ visible: true })
      .first(),
  status: () =>
    page
      .getByRole("button", { exact: true, name: "登出" })
      .filter({ visible: true })
      .first(),
  "temp-password": () =>
    page
      .getByRole("button", { exact: true, name: "登出" })
      .filter({ visible: true })
      .first(),
  unavailable: () =>
    page.getByRole("button", { exact: true, name: "重新載入" }),
  unban: () =>
    page
      .getByRole("button", { exact: true, name: "確認並解除封鎖" })
      .filter({ visible: true })
      .first(),
});

const presentation = async (
  page: Page,
  screen: keyof ReturnType<typeof presentationActions>
) => {
  const actions = presentationActions(page);
  await qualifyPresentation(page, dedicatedTest.info(), screen, {
    criticalAction: actions[screen](),
    drafts: page.locator(
      "input[id]:not([type=hidden]):not([type=search]), textarea[id]"
    ),
  });
};

const holder = () => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `r11.${suffix}@example.com`,
    fullName: `陳驗收${suffix}`,
    membershipStatus: "active" as const,
    password: "Synthetic-R11-password!",
    phone: String(60_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    username: `r11.${suffix}`,
  };
};

const signIn = async (
  page: Page,
  account: { password: string; username: string }
) => {
  const response = await page.request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
};

const provisionAccountWithName = async (
  caseApp: NativeApp,
  fullName: string
) => {
  const account = { ...holder(), fullName };
  const userId = await caseApp.provision.account(account);
  return { account, userId };
};

const readStoredIdentity = (caseApp: NativeApp, userId: string) =>
  caseApp.db
    .prepare("SELECT name, username, display_username FROM user WHERE id = ?")
    .bind(userId)
    .first<{
      display_username: string | null;
      name: string;
      username: string;
    }>();

const accountInitial = async (
  page: Page,
  caseApp: NativeApp,
  identity: Awaited<ReturnType<typeof provisionAccountWithName>>,
  fullName: string,
  expectedInitial: string,
  capturePresentation = false
) => {
  const before = await readStoredIdentity(caseApp, identity.userId);
  expect(before).toEqual({
    display_username: identity.account.username,
    name: fullName,
    username: identity.account.username,
  });

  await signIn(page, identity.account);
  await page.goto("/account");
  const summary = page.locator(
    'section[aria-labelledby="account-summary-heading"]'
  );
  await expect(summary.locator("h2")).toHaveText(fullName);
  const initial = summary.locator(':scope > span[aria-hidden="true"]');
  await expect(initial).toHaveText(expectedInitial);
  expect(await initial.textContent()).toBe(expectedInitial);
  expect(await readStoredIdentity(caseApp, identity.userId)).toEqual(before);

  if (capturePresentation) {
    await presentation(page, "account");
  }
};

dedicatedTest(
  "R11 Account renders a complete BMP initial without changing identity",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-auth",
    ],
  },
  async ({ page, caseApp }) => {
    const fullName = "陳測試 Account BMP";
    const identity = await provisionAccountWithName(caseApp, fullName);

    await accountInitial(page, caseApp, identity, fullName, "陳");
  }
);

dedicatedTest(
  "R11 Account renders a complete non-BMP initial and keeps responsive presentation",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-auth",
    ],
  },
  async ({ page, caseApp }) => {
    const fullName = "𠮷測試 Account non-BMP";
    const identity = await provisionAccountWithName(caseApp, fullName);

    await accountInitial(page, caseApp, identity, fullName, "𠮷", true);
  }
);

dedicatedTest(
  "R11 Account keeps the empty-name initial fallback",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-auth",
    ],
  },
  async ({ page, caseApp }) => {
    const provisionedName = "陳測試 Account empty fallback";
    const identity = await provisionAccountWithName(caseApp, provisionedName);
    const cleared = await caseApp.db
      .prepare("UPDATE user SET name = '' WHERE id = ?")
      .bind(identity.userId)
      .run();
    expect(cleared.meta.changes).toBe(1);

    await accountInitial(page, caseApp, identity, "", "");
  }
);

const createApplication = async (page: Page) => {
  const account = holder();
  const response = await page.request.post("/api/v2/applications", {
    data: {
      email: account.email,
      fullName: account.fullName,
      operationKey: randomBytes(32).toString("hex"),
      password: account.password,
      phone: account.phone,
      username: account.username,
    },
  });
  expect(response.status()).toBe(201);
  return account;
};

dedicatedTest(
  "R11 public sign-in, application, dirty-exit and submitted result",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-auth",
      "@risk-draft",
    ],
  },
  async ({ page, caseApp }) => {
    dedicatedTest.setTimeout(180_000);
    await page.goto("/sign-in");
    await expect(page.getByLabel("Username", { exact: true })).toHaveAttribute(
      "id",
      "sign-in-identifier"
    );
    await expect(page.getByLabel("密碼", { exact: true })).toHaveAttribute(
      "id",
      "sign-in-password"
    );
    await presentation(page, "signin");
    await page.goto("/apply");
    await presentation(page, "apply");
    const account = holder();
    await page.getByLabel("電話號碼", { exact: true }).fill(account.phone);
    await page.getByRole("link", { name: /返回登入/u }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await presentation(page, "leave");
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(page.getByLabel("電話號碼", { exact: true })).toHaveValue(
      account.phone
    );
    await page.getByLabel("中文全名", { exact: true }).fill(account.fullName);
    await page.getByLabel("Username", { exact: true }).fill(account.username);
    await page.getByLabel("電郵地址", { exact: true }).fill(account.email);
    await page.getByLabel("設定密碼", { exact: true }).fill(account.password);
    await page.getByRole("button", { exact: true, name: "提交申請" }).click();
    await expect(
      page.getByRole("button", { exact: true, name: "前往登入" })
    ).toBeVisible();
    await presentation(page, "apply-result");
    await page.getByRole("button", { exact: true, name: "前往登入" }).click();
    await expect(page).toHaveURL(/\/sign-in/u);
    await page.getByLabel("Username", { exact: true }).fill(account.username);
    await page.getByLabel("密碼", { exact: true }).fill(account.password);
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/sign-in/username" &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { exact: true, name: "登入" }).click();
    const loggedIn = await loginResponse;
    expect(loggedIn.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/sign-in/u);
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM session WHERE user_id=(SELECT id FROM user WHERE username=?)"
        )
        .bind(account.username)
        .first()
    ).toEqual({ count: 1 });
    const own = await page.request.get("/api/v2/applications/mine");
    expect(own.status()).toBe(200);
    const ownBody = await own.json();
    expect(ownBody.data.application.username).toBe(account.username);
    expect(
      await caseApp.db
        .prepare(
          "SELECT status FROM membership_application WHERE user_id=(SELECT id FROM user WHERE username=?)"
        )
        .bind(account.username)
        .first()
    ).toEqual({ status: "pending" });
  }
);

dedicatedTest(
  "R11 personal roots and focused security/contact tasks",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-security",
      "@risk-review",
    ],
  },
  async ({ page, caseApp }) => {
    dedicatedTest.setTimeout(240_000);
    const account = holder();
    await caseApp.provision.account(account);
    await signIn(page, account);
    for (const [screen, url] of [
      ["home", "/"],
      ["inbox", "/inbox"],
      ["account", "/account"],
      ["phone", "/account?task=phone"],
      ["security", "/account?task=security"],
      ["password", "/account?task=password"],
      ["sessions", "/account?task=sessions"],
      ["status", "/status"],
    ] as const) {
      await page.goto(url);
      await presentation(page, screen);
      await expect(page.locator("h1")).toBeVisible();
      if (screen === "security" || screen === "password") {
        await expect(page.locator("h1").locator("..")).toHaveCSS(
          "margin-bottom",
          "8px"
        );
        await expect(
          page.getByText(
            screen === "security"
              ? "管理你的登入與安全設定。"
              : "保留目前登入，其他裝置會在下次請求時登出。",
            { exact: true }
          )
        ).toHaveCSS("font-size", "16px");
      }
    }
    await page.goto("/account?task=sessions");
    await expect(
      page.getByRole("button", { exact: true, name: "取消" })
    ).toBeVisible();
    const beforeCancelResponse = await page.request.get(
      "/api/auth/get-session"
    );
    const sessionBeforeCancel = await beforeCancelResponse.json();
    let commands = 0;
    const recordCommand = (request: Request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          "/api/v2/account/sessions/revoke-others"
      ) {
        commands += 1;
      }
    };
    page.on("request", recordCommand);
    try {
      await page.getByRole("button", { exact: true, name: "取消" }).click();
      await expect(page).toHaveURL(/\/account\?task=security$/u);
      expect(commands).toBe(0);
      const afterCancelResponse = await page.request.get(
        "/api/auth/get-session"
      );
      const sessionAfterCancel = await afterCancelResponse.json();
      expect(sessionAfterCancel.session.id).toBe(
        sessionBeforeCancel.session.id
      );
    } finally {
      page.off("request", recordCommand);
    }
    await page.goto("/account?task=phone");
    await page.getByLabel("新電話", { exact: true }).fill(account.phone);
    await page.getByRole("button", { exact: true, name: "檢查電話" }).click();
    await page.getByRole("button", { name: "確認並儲存電話" }).click();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    const identityResponse = await page.request.get("/api/v2/account/identity");
    const identityBody = await identityResponse.json();
    expect(identityBody.data.identity.phone).toBe(`+852${account.phone}`);
    expect(
      await caseApp.db
        .prepare(
          "SELECT phone FROM person_profile WHERE user_id=(SELECT id FROM user WHERE username=?)"
        )
        .bind(account.username)
        .first()
    ).toEqual({ phone: `+852${account.phone}` });
  }
);

dedicatedTest(
  "R11 applicant correction, withdrawal, lost response and resubmission",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-recovery",
      "@risk-review",
    ],
  },
  async ({ page, caseApp }) => {
    dedicatedTest.setTimeout(180_000);
    const account = await createApplication(page);
    await signIn(page, account);
    await page.goto("/application");
    await presentation(page, "application");
    await page.getByRole("button", { name: "修正申請資料" }).click();
    await page.getByRole("button", { name: "返回我的申請" }).click();
    await expect(
      page.getByRole("button", { name: "修正申請資料" })
    ).toBeVisible();
    await page.getByRole("button", { name: "修正申請資料" }).click();
    await page
      .getByLabel("中文全名", { exact: true })
      .fill(`${account.fullName}修正`);
    await presentation(page, "app-edit");
    await page.getByRole("button", { name: "檢查更改" }).click();
    await presentation(page, "app-edit-review");
    await page.getByRole("button", { name: "確認並提交更改" }).click();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    await page.getByRole("button", { exact: true, name: "撤回申請" }).click();
    await presentation(page, "app-withdraw");
    await page.route("**/api/v2/applications/actions", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/applications/actions/reconcile", (route) =>
      route.abort("failed")
    );
    await page.getByRole("button", { exact: true, name: "確認撤回" }).click();
    await expect(page.getByRole("status")).toContainText("結果仍未確認");
    await presentation(page, "operation");
    await page.unroute("**/api/v2/applications/actions/reconcile");
    await page.unroute("**/api/v2/applications/actions");
    await page.getByRole("button", { name: "查核之前的操作" }).click();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    await page
      .getByRole("button", { exact: true, name: "重新提交申請" })
      .click();
    await presentation(page, "app-resubmit");
    await page
      .getByRole("button", { exact: true, name: "確認重新提交" })
      .click();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    const applicationResponse = await page.request.get(
      "/api/v2/applications/mine"
    );
    const applicationBody = await applicationResponse.json();
    expect(applicationBody.data.application.status).toBe("pending");
    const receipts = await caseApp.db
      .prepare(
        "SELECT action FROM applicant_operation WHERE user_id=(SELECT id FROM user WHERE username=?) ORDER BY created_at, rowid"
      )
      .bind(account.username)
      .all<{ action: string }>();
    expect(receipts.results.map((row) => row.action)).toEqual([
      "application_corrected",
      "application_withdrawn",
      "application_resubmitted",
    ]);
  }
);

dedicatedTest(
  "R11 Staff person-first workspace, identity, confirmation and recovery",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-secret",
      "@risk-recovery",
      "@risk-review",
    ],
  },
  async ({ page, caseApp, staff }) => {
    dedicatedTest.setTimeout(240_000);
    const account = holder();
    await caseApp.provision.account(account);
    const target = await caseApp.db
      .prepare("SELECT id FROM user WHERE username=?")
      .bind(account.username)
      .first<{ id: string }>();
    if (!target) {
      throw new Error("Synthetic R11 target missing");
    }
    // The confirmation journey requires a fresh, genuinely unconfirmed login session.
    await signIn(page, staff.account);
    await page.goto("/staff/accounts");
    await presentation(page, "management");
    await page.getByRole("link", { name: /帳戶管理/u }).click();
    await expect(page.getByRole("searchbox")).toBeVisible();
    await presentation(page, "accounts");
    await page.getByRole("searchbox").fill(account.username);
    await page
      .getByRole("link", { name: new RegExp(account.fullName, "u") })
      .click();
    await expect(page.getByRole("region", { name: "操作對象" })).toContainText(
      account.username
    );
    await presentation(page, "person");
    await page.getByRole("link", { name: /修正身份資料/u }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toBeEnabled();
    await presentation(page, "identity");
    await page
      .getByLabel("中文全名", { exact: true })
      .fill(`${account.fullName}核實`);
    await page.getByLabel("修正電話", { exact: true }).fill(account.phone);
    await page.locator('input[type="radio"][value="face_to_face"]').check();
    await page.getByLabel("已按以上方式核實本人", { exact: false }).check();
    await page.getByRole("link", { exact: true, name: "更換對象" }).click();
    const switchDialog = page.getByRole("dialog");
    await expect(
      switchDialog.getByRole("heading", {
        exact: true,
        name: "放棄未提交的更改？",
      })
    ).toBeVisible();
    await switchDialog
      .getByRole("button", { exact: true, name: "繼續編輯" })
      .click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      `${account.fullName}核實`
    );
    await page.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await presentation(page, "identity-review");
    await page
      .getByRole("button", { exact: true, name: "確認目前密碼" })
      .click();
    await presentation(page, "confirm");
    await page
      .getByRole("dialog")
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    await page
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "伺服器已確認"
    );
    await page
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await page.getByRole("button", { name: "確認並提交修正" }).click();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    await page.goto(
      `/staff/accounts?view=people&person=${target.id}&task=recovery`
    );
    const verificationChoice = page.locator(
      'input[type="radio"][value="face_to_face"]'
    );
    await expect(verificationChoice).toBeEnabled();
    const verificationBox = await verificationChoice
      .locator("xpath=ancestor::label")
      .boundingBox();
    expect(verificationBox?.height).toBeGreaterThanOrEqual(52);
    await presentation(page, "recovery");
    await verificationChoice.check();
    await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
    await page.getByRole("button", { name: "檢查資料" }).click();
    await presentation(page, "recovery-review");
    await page
      .getByRole("button", { name: "確認並重設密碼及登出全部裝置" })
      .click();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
    await presentation(page, "handover");
    const temporaryPassword = await page
      .getByLabel("新臨時密碼", { exact: true })
      .textContent();
    expect(temporaryPassword).toHaveLength(32);
    expect(
      await caseApp.db
        .prepare(
          "SELECT action, actor_user_id, target_user_id FROM staff_account_operation WHERE target_user_id=?"
        )
        .bind(target.id)
        .first()
    ).toEqual({
      action: "staff_password_reset",
      actor_user_id: staff.userId,
      target_user_id: target.id,
    });
    const recoveredOperation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/accounts/reconcile")
    );
    await page.reload();
    const recoveredResponse = await recoveredOperation;
    expect(recoveredResponse.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "臨時密碼不能再次顯示",
      })
    ).toBeVisible();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    await page.request.post("/api/auth/sign-out", { data: {} });
    await signIn(page, { ...account, password: temporaryPassword ?? "" });
    const temporaryPage = await page.context().newPage();
    try {
      await temporaryPage.goto("/account");
      await expect(
        temporaryPage.getByRole("heading", {
          exact: true,
          name: "設定你的新密碼",
        })
      ).toBeVisible();
      await presentation(temporaryPage, "temp-password");
    } finally {
      await temporaryPage.close();
    }
  }
);

dedicatedTest(
  "R11 Staff creation, four restriction actions, deletion and retained audit",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-restriction",
      "@risk-deletion",
      "@risk-secret",
      "@risk-review",
    ],
  },
  async ({ staffPage: page, caseApp }) => {
    dedicatedTest.setTimeout(240_000);

    await page.goto("/staff/accounts?task=create");
    await expect(page.getByLabel("中文全名", { exact: true })).toBeEnabled();
    await presentation(page, "create");
    const account = holder();
    await page.getByLabel("中文全名", { exact: true }).fill(account.fullName);
    await page.getByLabel("使用者名稱", { exact: true }).fill(account.username);
    await page.getByLabel("電話", { exact: true }).fill(account.phone);
    await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    await presentation(page, "create-review");
    await page
      .getByRole("button", { name: "確認並建立帳戶及發出臨時密碼" })
      .click();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
    await presentation(page, "create-handover");
    const target = await caseApp.db
      .prepare("SELECT id FROM user WHERE username=?")
      .bind(account.username)
      .first<{ id: string }>();
    if (!target) {
      throw new Error("Synthetic R11 target missing");
    }
    await page.goto(
      `/staff/accounts?view=people&person=${target.id}&task=restrictions`
    );
    await presentation(page, "restrictions");
    const region = page.getByRole("region", { name: "會籍與安全限制" });
    for (const [screen, label, nextLabel] of [
      ["ban", "封鎖帳戶", "解除封鎖"],
      ["unban", "解除封鎖", "封鎖帳戶"],
      ["deactivate", "停用會籍", "重新啟用會籍"],
      ["reactivate", "重新啟用會籍", "停用會籍"],
    ] as const) {
      await region.getByRole("button", { exact: true, name: label }).click();
      const details = region.getByRole("group", {
        exact: true,
        name: "操作詳情",
      });
      await expect(details).not.toHaveAttribute("open", "");
      const summary = details.locator("summary");
      await summary.focus();
      await page.keyboard.press("Space");
      await expect(details).toHaveAttribute("open", "");
      await expect(
        details
          .getByRole("definition")
          .filter({ hasText: new RegExp(`^${target.id}$`, "u") })
      ).toBeVisible();
      await page.keyboard.press("Space");
      await expect(details).not.toHaveAttribute("open", "");
      await presentation(page, screen);
      await region
        .getByRole("button", { exact: true, name: `確認並${label}` })
        .click();
      await expect(region.getByRole("status")).toContainText("伺服器已確認");
      await region
        .getByRole("button", { name: "完成，開始另一項操作" })
        .click();
      await expect(
        region.getByRole("button", { exact: true, name: nextLabel })
      ).toBeEnabled();
    }
    await expect(
      region.getByRole("button", { exact: true, name: "封鎖帳戶" })
    ).toBeEnabled();
    await caseApp.db
      .prepare("UPDATE user SET display_username=NULL WHERE id=?")
      .bind(target.id)
      .run();
    await page.getByRole("link", { exact: true, name: "返回帳戶詳情" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶詳情" })
    ).toBeVisible();
    await page.getByText("其他操作", { exact: true }).click();
    await page.getByRole("link", { name: /永久刪除帳戶/u }).click();
    await page
      .getByRole("button", { exact: true, name: "檢查刪除資料" })
      .click();
    await expect(page.getByRole("checkbox")).toBeEnabled();
    await page.getByText("操作詳情", { exact: true }).click();
    await expect(
      page.getByRole("definition").filter({
        hasText: new RegExp(`^${target.id}$`, "u"),
      })
    ).toBeVisible();
    await page.getByText("操作詳情", { exact: true }).click();
    await presentation(page, "deletion");
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM account_change_operation WHERE target_user_id=? AND action='account_deleted'"
        )
        .bind(target.id)
        .first()
    ).toEqual({ count: 0 });
    await page.getByRole("checkbox").check();
    const permanentDelete = page.getByRole("button", {
      exact: true,
      name: "確認並永久刪除",
    });
    await expect(permanentDelete).toBeEnabled();
    await qualifyPresentation(page, dedicatedTest.info(), "deletion-submit", {
      criticalAction: permanentDelete,
      drafts: page.getByRole("checkbox"),
      focus: permanentDelete,
    });
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page
      .getByRole("button", { exact: true, name: "確認並永久刪除" })
      .click();
    await expect(page.getByRole("status")).toContainText("伺服器已確認");
    expect(
      await caseApp.db
        .prepare("SELECT id FROM user WHERE id=?")
        .bind(target.id)
        .first()
    ).toBeNull();
    const retained = await caseApp.db
      .prepare(
        "SELECT action FROM account_change_operation WHERE target_user_id=?"
      )
      .bind(target.id)
      .all<{ action: string }>();
    expect(retained.results.map((row) => row.action).toSorted()).toEqual([
      "account_banned",
      "account_deleted",
      "account_unbanned",
      "membership_deactivated",
      "membership_reactivated",
    ]);
    await page.goto("/staff/account-audit");
    await expect(
      page.getByRole("link", { exact: true, name: "管理" })
    ).toHaveAttribute("aria-current", "page");
    await presentation(page, "audit");
    await page
      .getByRole("main")
      .getByRole("list")
      .getByRole("link")
      .first()
      .click();
    await expect(
      page.getByRole("region", { name: "帳戶紀錄詳情" })
    ).toBeVisible();
    await presentation(page, "audit-detail");
  }
);

dedicatedTest(
  "R11 Staff application decisions preserve applicant privacy",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-privacy",
      "@risk-review",
    ],
  },
  async ({ page: publicPage, staffPage: page, caseApp, staff }) => {
    dedicatedTest.setTimeout(180_000);
    const account = await createApplication(publicPage);

    await page.goto("/staff/applications");
    await presentation(page, "applications");
    await page
      .getByRole("button", {
        name: new RegExp(`審批 ${account.fullName}`, "u"),
      })
      .click();
    await presentation(page, "application-review");
    await page
      .getByRole("button", { exact: true, name: "返回待批清單" })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: new RegExp(`審批 ${account.fullName}`, "u"),
      })
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: new RegExp(`審批 ${account.fullName}`, "u"),
      })
      .click();
    // The chooser transfers focus on the next frame; let it settle before native WebKit input.
    await expect(page.locator("#review-name")).toBeFocused();
    const internalNote = page.getByLabel("內部備註（選填，申請人不可見）");
    await internalNote.fill("Synthetic private R11 note");
    await expect(internalNote).toHaveValue("Synthetic private R11 note");
    await page
      .getByRole("button", { exact: true, name: "檢查並預覽決定" })
      .click();
    expect(
      await caseApp.db
        .prepare("SELECT COUNT(*) AS count FROM application_decision")
        .first()
    ).toEqual({ count: 0 });
    await page.getByRole("button", { exact: true, name: "返回修改" }).click();
    await expect(page.getByLabel("內部備註（選填，申請人不可見）")).toHaveValue(
      "Synthetic private R11 note"
    );
    await page
      .getByRole("button", { exact: true, name: "檢查並預覽決定" })
      .click();
    const approveSubmit = page.getByRole("button", {
      exact: true,
      name: "確認並提交批准",
    });
    await expect(approveSubmit).toBeEnabled();
    await qualifyPresentation(page, dedicatedTest.info(), "decision-submit", {
      criticalAction: approveSubmit,
      drafts: page.getByLabel("內部備註（選填，申請人不可見）"),
      focus: approveSubmit,
    });
    await expect(
      page
        .getByRole("definition")
        .filter({ hasText: /^Synthetic private R11 note$/u })
    ).toBeVisible();
    expect(
      await caseApp.db
        .prepare("SELECT COUNT(*) AS count FROM application_decision")
        .first()
    ).toEqual({ count: 0 });
    await page
      .getByRole("button", { exact: true, name: "確認並提交批准" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "伺服器已確認" })
    ).toBeVisible();
    expect(
      await caseApp.db
        .prepare(
          "SELECT outcome, internal_note, actor_user_id FROM application_decision"
        )
        .first()
    ).toEqual({
      actor_user_id: staff.userId,
      internal_note: "Synthetic private R11 note",
      outcome: "approved",
    });
    const signOut = await page.request.post("/api/auth/sign-out", { data: {} });
    expect(signOut.status()).toBe(200);
    await page.goto("/sign-in");
    await page.getByLabel("Username", { exact: true }).fill(account.username);
    await page.getByLabel("密碼", { exact: true }).fill(account.password);
    const signedIn = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/sign-in/username" &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { exact: true, name: "登入" }).click();
    const login = await signedIn;
    expect(login.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/u);
    await page.goto("/inbox");
    await expect(
      page.getByRole("heading", { exact: true, name: "收件匣" })
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic private R11 note", { exact: true })
    ).toHaveCount(0);
  }
);

dedicatedTest(
  "R11 denied and authentication-unavailable views have working exits",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-authority",
    ],
  },
  async ({ page, caseApp }) => {
    dedicatedTest.setTimeout(180_000);
    const account = holder();
    await caseApp.provision.account(account);
    await signIn(page, account);
    await page.goto("/staff/accounts");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await presentation(page, "denied");
    await page.goto("/unavailable");
    await presentation(page, "unavailable");
  }
);

dedicatedTest(
  "R11 real client error boundary hides internal failure and retries",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ page }) => {
    dedicatedTest.setTimeout(180_000);
    await page.addInitScript(() => {
      const originalFocus = HTMLInputElement.prototype.focus;
      let failOnce = sessionStorage.getItem("r11-focus-fault-used") === null;
      HTMLInputElement.prototype.focus = function focus(options) {
        if (failOnce) {
          failOnce = false;
          sessionStorage.setItem("r11-focus-fault-used", "1");
          throw new Error("Synthetic private focus failure");
        }
        originalFocus.call(this, options);
      };
    });
    await page.goto("/apply");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    // vinext's development-only overlay exposes diagnostic errors to developers.
    // Dismiss it; the production application boundary must keep its own copy safe.
    const developmentOverlay = page.getByRole("dialog", {
      name: "Runtime Error",
    });
    if (await developmentOverlay.isVisible()) {
      await developmentOverlay.getByRole("button", { name: "Dismiss" }).click();
    }
    await expect(
      page
        .locator("main")
        .getByText("Synthetic private focus failure", { exact: true })
    ).toHaveCount(0);
    await presentation(page, "error");
    await page.getByRole("button", { exact: true, name: "重試" }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toBeEnabled();
  }
);

dedicatedTest(
  "R11 native Staff fields and Management destination meet shared rules",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
    ],
  },
  async ({ page: publicPage, staffPage: page, caseApp }) => {
    const account = holder();
    await caseApp.provision.account(account);
    const target = await caseApp.db
      .prepare("SELECT id FROM user WHERE username=?")
      .bind(account.username)
      .first<{ id: string }>();
    if (!target) {
      throw new Error("Synthetic R11 target missing");
    }
    await publicPage.goto("/apply");
    for (const name of ["中文全名", "設定密碼"]) {
      await publicPage.getByText(name, { exact: true }).click();
      await expect(publicPage.getByLabel(name, { exact: true })).toBeFocused();
    }
    await publicPage.keyboard.press("Tab");
    await publicPage.keyboard.press("Shift+Tab");
    await expect(
      publicPage.getByLabel("設定密碼", { exact: true })
    ).toBeFocused();
    await expect(publicPage.getByLabel("設定密碼", { exact: true })).toHaveCSS(
      "outline-style",
      "solid"
    );
    await expect(publicPage.getByLabel("設定密碼", { exact: true })).toHaveCSS(
      "outline-width",
      "3px"
    );
    await expect(publicPage.getByLabel("中文全名", { exact: true })).toHaveCSS(
      "border-radius",
      "10px"
    );
    await expect(publicPage.getByText("中文全名", { exact: true })).toHaveCSS(
      "font-weight",
      "600"
    );
    const submit = publicPage.getByRole("button", {
      exact: true,
      name: "提交申請",
    });
    await expect(submit).toHaveCSS("font-size", "16px");
    await expect(submit).toHaveCSS("font-weight", "650");
    await expect(submit).toHaveCSS("border-radius", "10px");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(
      `/staff/accounts?view=people&person=${target.id}&task=recovery`
    );
    const field = page.locator('input[type="radio"][value="face_to_face"]');
    await expect(field).toBeEnabled();
    const fieldBox = await field.locator("xpath=ancestor::label").boundingBox();
    expect(fieldBox?.height).toBeGreaterThanOrEqual(52);
    await expect(field.locator("xpath=ancestor::label")).toHaveCSS(
      "background-color",
      "rgb(243, 248, 245)"
    );
    await expect(
      field
        .locator("xpath=ancestor::label")
        .getByText("親身核實", { exact: true })
    ).toHaveCSS("font-size", "16px");
    await expect(
      field
        .locator("xpath=ancestor::label")
        .getByText("親身核實", { exact: true })
    ).toHaveCSS("font-weight", "700");
    await page.goto(`/staff/accounts?view=people&person=${target.id}`);
    await page.setViewportSize({ height: 1024, width: 1440 });
    await expect(
      page.getByRole("heading", { exact: true, name: "你想處理甚麼？" })
    ).toHaveCSS("margin-bottom", "0px");
    const selectedPerson = page.locator('a[aria-current="true"]');
    await expect(selectedPerson).toHaveCSS("border-color", "rgb(13, 97, 93)");
    await expect(selectedPerson).toHaveCSS(
      "background-color",
      "rgb(239, 247, 242)"
    );
    await page.goto("/staff/account-audit");
    await expect(
      page.getByRole("link", { exact: true, name: "管理" })
    ).toHaveAttribute("aria-current", "page");
  }
);

dedicatedTest(
  "R11 sign-out pending and retry use compact Auth presentation and real retry",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-auth",
      "@risk-recovery",
    ],
  },
  async ({ page, caseApp }) => {
    dedicatedTest.setTimeout(180_000);
    const account = holder();
    await caseApp.provision.account(account);
    await signIn(page, account);
    await page.goto("/account");
    const { promise: responseGate, resolve: releaseResponse } =
      Promise.withResolvers<boolean>();
    await page.route("**/api/auth/sign-out", async (route) => {
      await responseGate;
      await route.abort("failed");
    });
    await page.getByRole("button", { exact: true, name: "登出" }).click();
    const pending = page.getByRole("dialog", { name: "正在登出" });
    await expect(pending).toBeVisible();
    await expect(pending.getByRole("status")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pending).toBeVisible();
    releaseResponse(true);
    const dialog = page.getByRole("dialog", { name: "未能確認登出" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).not.toBeVisible();
    await presentation(page, "signout");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶" })
    ).toBeVisible();
    await page.getByRole("button", { exact: true, name: "登出" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "返回並重新檢查登入狀態" })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶" })
    ).toBeVisible();
    await page.getByRole("button", { exact: true, name: "登出" }).click();
    await expect(dialog).toBeVisible();
    await page.unroute("**/api/auth/sign-out");
    await dialog.getByRole("button", { name: "重試登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    const sessionResponse = await page.request.get("/api/auth/get-session");
    const sessionBody = await sessionResponse.json();
    expect(sessionBody).toBeNull();
  }
);

dedicatedTest(
  "sign-out Query rechecks a stale verdict after a committed but lost response",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-presentation",
      "@risk-auth",
      "@risk-recovery",
    ],
  },
  async ({ page, caseApp }) => {
    const account = holder();
    await caseApp.provision.account(account);
    await signIn(page, account);
    await page.goto("/account");
    let writes = 0;
    let reads = 0;
    await page.route("**/api/auth/get-session", async (route) => {
      reads += 1;
      await route.continue();
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      writes += 1;
      if (writes === 2) {
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
      }
      await route.abort("failed");
    });
    await page.getByRole("button", { exact: true, name: "登出" }).click();
    const dialog = page.getByRole("dialog", { name: "未能確認登出" });
    await expect(dialog).toBeVisible();
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    await dialog.getByRole("button", { name: "重試登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    expect(writes).toBe(2);
    expect(reads).toBe(2);
    const sessions = await caseApp.db
      .prepare(
        "SELECT COUNT(*) AS count FROM session WHERE user_id=(SELECT id FROM user WHERE username=?)"
      )
      .bind(account.username)
      .first<{ count: number }>();
    expect(sessions?.count).toBe(0);
  }
);

dedicatedTest(
  "R11 second-tab actor changes cannot submit a stale review or reveal history",
  {
    tag: [
      "@native",
      "@browser",
      "@r11-ui",
      "@mobile-critical",
      "@risk-actor-isolation",
      "@risk-history",
    ],
  },
  async ({ staffPage: page, caseApp }) => {
    const target = holder();
    const targetId = await caseApp.provision.account(target);

    await page.goto(
      `/staff/accounts?view=people&person=${targetId}&task=restrictions`
    );
    await page.getByRole("button", { exact: true, name: "封鎖帳戶" }).click();
    const otherTab = await page.context().newPage();
    try {
      await otherTab.goto("/account");
      await otherTab.request.post("/api/auth/sign-out", { data: {} });
      await signIn(otherTab, target);
      await otherTab.goto("/account");
      await expect(
        otherTab.getByRole("heading", { exact: true, name: "帳戶" })
      ).toBeVisible();
      await page
        .getByRole("button", { exact: true, name: "確認並封鎖帳戶" })
        .click();
      await expect(page.getByRole("status")).toContainText(/未|改變/u);
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM account_change_operation WHERE target_user_id=?"
          )
          .bind(targetId)
          .first()
      ).toEqual({ count: 0 });
      expect(
        await caseApp.db
          .prepare("SELECT banned_at FROM person_profile WHERE user_id=?")
          .bind(targetId)
          .first()
      ).toEqual({ banned_at: null });
      await otherTab.goto("/staff/account-audit");
      await expect(otherTab.getByRole("main").getByRole("alert")).toBeVisible();
      await otherTab.goBack();
      await expect(
        otherTab.getByRole("heading", { exact: true, name: "帳戶" })
      ).toBeVisible();
      await expect(
        otherTab.getByLabel("新臨時密碼", { exact: true })
      ).toHaveCount(0);
    } finally {
      await otherTab.close();
    }
  }
);
