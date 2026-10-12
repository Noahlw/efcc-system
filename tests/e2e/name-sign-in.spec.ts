import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import {
  approvedAccounts,
  findAccount,
  restrictedAccounts,
} from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { qualifyPresentation } from "./r11-presentation";
import { postSeed, runLocalSql, seedSyntheticAccounts } from "./seed";

const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");
const duplicateName = findAccount(approvedAccounts, "wong.tai.ming.two");
const simplified = findAccount(approvedAccounts, "chen.simplified");
const romanised = findAccount(approvedAccounts, "ng.wing.yan");
const pendingPerson = findAccount(restrictedAccounts, "law.pending");

const signInWithName = async (
  api: APIRequestContext,
  fullName: string,
  password: string
) => {
  await waitForSignInWindow("/sign-in/name");
  return api.post("/api/auth/sign-in/name", {
    data: { fullName, password },
  });
};

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

test("revealing a sign-in password preserves the draft without submitting", async ({
  page,
}) => {
  const signInRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/auth/sign-in/")
    ) {
      signInRequests.push(request.url());
    }
  });
  await page.goto("/sign-in");
  const identifier = page.getByLabel("Username", { exact: true });
  const password = page.getByLabel("密碼", { exact: true });
  await identifier.fill(chan.username);
  await password.fill(chan.password);
  await page.getByRole("button", { exact: true, name: "顯示密碼" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue(chan.password);
  const hide = page.getByRole("button", { exact: true, name: "隱藏密碼" });
  await hide.focus();
  await hide.press("Space");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue(chan.password);
  await expect(identifier).toHaveValue(chan.username);
  await expect(page).toHaveURL(/\/sign-in$/u);
  expect(signInRequests).toEqual([]);
});

test("an unsent sign-in draft is guarded before opening account application", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const username = page.getByLabel("Username");
  const password = page.getByLabel("密碼", { exact: true });

  await username.fill(chan.username);
  await password.fill(chan.password);
  await page.getByRole("link", { name: "申請帳戶" }).click();

  const leaveDialog = page.getByRole("dialog");
  await expect(leaveDialog).toBeVisible();
  await expect(leaveDialog).toContainText("放棄未提交的更改");
  await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
  await expect(username).toHaveValue(chan.username);
  await expect(password).toHaveValue(chan.password);

  const beforeUnloadCancelled = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(beforeUnloadCancelled).toBe(true);
  await expect(username).toHaveValue(chan.username);
  await expect(password).toHaveValue(chan.password);

  await page.getByRole("link", { name: "申請帳戶" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "放棄變更" })
    .click();
  await expect(page).toHaveURL(/\/apply$/u);
  await page.goBack();
  await expect(username).toHaveValue("");
  await expect(password).toHaveValue("");
});

test("permitted Staff reach Management from every root destination", async ({
  page,
}) => {
  runLocalSql(
    "update person_profile set account_role = 'staff' where user_id = (select id from user where lower(username) = lower('Chan.Siu.Fong'))"
  );
  try {
    await waitForSignInWindow();
    await page.goto("/sign-in");
    await page.getByLabel("Username").fill(chan.username);
    await page.getByLabel("密碼", { exact: true }).fill(chan.password);
    await page.getByRole("button", { name: "登入" }).click();

    await expect(page).toHaveURL(/\/$/u);
    await expect(
      page
        .getByRole("navigation", { name: "主要導覽" })
        .getByRole("link", { name: "管理" })
    ).toBeVisible();

    await page.getByRole("link", { name: "帳戶" }).click();
    await expect(page).toHaveURL(/\/account$/u);
    await expect(page.getByRole("link", { name: "帳戶狀態" })).toHaveAttribute(
      "href",
      "/status"
    );
    await expect(
      page
        .getByRole("navigation", { name: "主要導覽" })
        .getByRole("link", { name: "管理" })
    ).toBeVisible();

    await page.getByRole("link", { name: "帳戶狀態" }).click();
    await expect(page).toHaveURL(/\/status$/u);
    await expect(
      page.getByText("你的帳戶目前可使用教會功能。", { exact: true })
    ).toBeVisible();
    await page.getByRole("link", { name: "返回帳戶" }).click();
    await expect(page).toHaveURL(/\/account$/u);

    await page.getByRole("link", { name: "收件匣" }).click();
    await expect(page).toHaveURL(/\/inbox$/u);
    await expect(
      page
        .getByRole("navigation", { name: "主要導覽" })
        .getByRole("link", { name: "管理" })
    ).toBeVisible();
  } finally {
    runLocalSql(
      "update person_profile set account_role = 'member' where user_id = (select id from user where lower(username) = lower('Chan.Siu.Fong'))"
    );
  }
});

test("a unique full name signs in with the same engine as Username", async ({
  request,
}) => {
  const response = await signInWithName(request, chan.fullName, chan.password);
  expect(response.status()).toBe(200);
  expect(response.headers()["set-cookie"]).toContain(
    "better-auth.session_token"
  );

  const identity = await request.get("/api/v2/me");
  expect(identity.status()).toBe(200);
  expect(await identity.json()).toEqual({
    data: {
      displayName: chan.fullName,
      membershipStatus: "active",
      username: chan.username,
    },
  });
});

const emailStates = [
  {
    ...romanised,
    email: "verified-login@example.invalid",
    emailVerified: true,
    fullName: "驗證電郵測試",
    username: "email.verified",
  },
  {
    ...romanised,
    // Per-account, non-deliverable address for a person without real email.
    email: "email-placeholder@members.example.invalid",
    emailVerified: false,
    fullName: "無電郵測試",
    username: "email.placeholder",
  },
];

for (const person of emailStates) {
  test(`both identifiers work with email state: ${person.username}`, async ({
    request,
  }) => {
    await postSeed({ accounts: [person] });
    runLocalSql(
      `update user set email_verified = ${person.emailVerified ? 1 : 0} where username = '${person.username}'`
    );

    await waitForSignInWindow("/sign-in/username");
    const usernameResponse = await request.post("/api/auth/sign-in/username", {
      data: { password: person.password, username: person.username },
    });
    expect(usernameResponse.status()).toBe(200);
    const session = await request.get("/api/auth/get-session");
    const sessionBody = await session.json();
    expect(sessionBody.user.email).toBe(person.email);
    expect(sessionBody.user.emailVerified).toBe(person.emailVerified);

    const signOut = await request.post("/api/auth/sign-out", { data: {} });
    expect(signOut.status()).toBe(200);
    const nameResponse = await signInWithName(
      request,
      person.fullName,
      person.password
    );
    expect(nameResponse.status()).toBe(200);
    const identity = await request.get("/api/v2/me");
    expect(identity.status()).toBe(200);
    const identityBody = await identity.json();
    expect(identityBody.data.username).toBe(person.username);

    const emailResponse = await request.post("/api/auth/sign-in/email", {
      data: { email: person.email, password: person.password },
    });
    expect(emailResponse.status()).toBe(404);
  });
}

test("a duplicated full name requires Username without exposing accounts", async ({
  request,
}) => {
  const response = await signInWithName(
    request,
    duplicateName.fullName,
    duplicateName.password
  );
  expect(response.status()).toBe(409);
  const body = await response.json();
  expect(body).toEqual({
    code: "NAME_AMBIGUOUS",
    message: "此中文姓名對應多個帳戶，請改用使用者名稱登入。",
  });
  // Neither canonical username, other account data nor an email alternative.
  expect(JSON.stringify(body)).not.toContain(duplicateName.username);
  expect(JSON.stringify(body)).not.toContain("wong.tai.ming");

  const session = await request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
});

test("trim, full-width and Latin case map to the same account", async ({
  request,
}) => {
  const fullWidthLatin = "  ＮＧ　ＷＩＮＧ　ＹＡＮ 吳詠恩  ";
  const response = await signInWithName(
    request,
    fullWidthLatin,
    romanised.password
  );
  expect(response.status()).toBe(200);

  const identity = await request.get("/api/v2/me");
  expect(await identity.json()).toEqual({
    data: {
      displayName: romanised.fullName,
      membershipStatus: "active",
      username: romanised.username,
    },
  });

  // The display form is unchanged by the lookup key.
  const session = await request.get("/api/auth/get-session");
  const sessionBody = await session.json();
  expect(sessionBody.user.name).toBe(romanised.fullName);
  expect(sessionBody.user.displayUsername).toBe(romanised.username);
});

const distinctNames = [
  {
    ...romanised,
    email: "matching-space-a@example.invalid",
    fullName: "修名 A  B",
    username: "matching.space.a",
  },
  {
    ...romanised,
    email: "matching-space-b@example.invalid",
    fullName: "修名 A B",
    username: "matching.space.b",
  },

  {
    ...romanised,
    email: "matching-compat-a@example.invalid",
    fullName: "修名①",
    username: "matching.compat.a",
  },
  {
    ...romanised,
    email: "matching-compat-b@example.invalid",
    fullName: "修名1",
    username: "matching.compat.b",
  },
  {
    ...romanised,
    email: "matching-script-a@example.invalid",
    fullName: "修名Д",
    username: "matching.script.a",
  },
  {
    ...romanised,
    email: "matching-script-b@example.invalid",
    fullName: "修名д",
    username: "matching.script.b",
  },
];

for (const person of distinctNames) {
  test(`distinct full-name identity: ${person.username}`, async ({
    request,
  }) => {
    await postSeed({ accounts: distinctNames });
    const response = await signInWithName(
      request,
      person.fullName,
      person.password
    );
    expect(response.status()).toBe(200);
    const identity = await request.get("/api/v2/me");
    const body = await identity.json();
    expect(body.data.username).toBe(person.username);
  });
}

test("Traditional and Simplified names stay distinct accounts", async ({
  request,
}) => {
  const response = await signInWithName(
    request,
    simplified.fullName,
    simplified.password
  );
  expect(response.status()).toBe(200);
  const identity = await request.get("/api/v2/me");
  expect(await identity.json()).toEqual({
    data: {
      displayName: simplified.fullName,
      membershipStatus: "active",
      username: simplified.username,
    },
  });
});

test("wrong password and unknown names fail closed", async ({ request }) => {
  const wrongPassword = await signInWithName(
    request,
    chan.fullName,
    "definitely-wrong"
  );
  expect(wrongPassword.status()).toBe(401);

  const unknown = await signInWithName(request, "不存在的人", chan.password);
  expect(unknown.status()).toBe(401);

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(401);
});

test("restricted people still reach status through name sign-in", async ({
  request,
}) => {
  const response = await signInWithName(
    request,
    pendingPerson.fullName,
    pendingPerson.password
  );
  expect(response.status()).toBe(200);

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(403);
  const status = await request.get("/status", { maxRedirects: 0 });
  expect(status.status()).toBe(200);
});

test("the name entry keeps the public boundary and origin checks", async ({
  request,
}) => {
  const wrongMethod = await request.get("/api/auth/sign-in/name");
  expect(wrongMethod.status()).toBe(404);

  const otherLifecycle = await request.post("/api/auth/sign-up/name");
  expect(otherLifecycle.status()).toBe(404);

  await waitForSignInWindow("/sign-in/name");
  const crossOrigin = await request.post("/api/auth/sign-in/name", {
    data: { fullName: chan.fullName, password: chan.password },
    headers: { origin: "https://evil.example" },
  });
  expect(crossOrigin.status()).toBe(403);
});

test("the browser switches modes, signs in by name and handles duplicates", async ({
  page,
}) => {
  const signInRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/auth/sign-in/")
    ) {
      signInRequests.push(new URL(request.url()).pathname);
    }
  });
  await waitForSignInWindow("/sign-in/name");
  await page.goto("/sign-in");

  // Username is the default mode.
  await expect(page.getByRole("button", { name: "Username" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByLabel("Username")).toBeVisible();

  // A name typed in the default mode produces a Username-specific error.
  await page.getByLabel("Username").fill(chan.fullName);
  await page.getByLabel("密碼", { exact: true }).fill(chan.password);
  await expect(page.getByLabel("Username")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  expect(signInRequests).toEqual([]);
  await page.getByRole("button", { name: "中文全名" }).click();
  await expect(page.getByLabel("中文全名")).toBeVisible();
  await expect(page.getByLabel("中文全名")).not.toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await expect(page.getByLabel("中文全名")).toHaveValue("");
  await expect(page.getByLabel("密碼", { exact: true })).toHaveValue(
    chan.password
  );

  // Duplicate names ask for Username without listing accounts.
  await page.getByLabel("中文全名").fill(duplicateName.fullName);
  await page.getByLabel("密碼", { exact: true }).fill(duplicateName.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("alert")).toContainText("有多個帳戶使用這個姓名");
  await expect(page).toHaveURL(/\/sign-in$/u);
  const ambiguousSession = await page.request.get("/api/auth/get-session");
  expect(await ambiguousSession.json()).toBeNull();
  await expect(page.getByRole("alert")).not.toContainText(
    duplicateName.username
  );
  await expect(page.getByRole("alert")).not.toContainText("wong.tai.ming");
  await qualifyPresentation(page, test.info(), "signin-error");

  await page.getByRole("button", { name: "改用使用者名稱" }).click();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("密碼", { exact: true })).toHaveValue(
    duplicateName.password
  );
  await waitForSignInWindow();
  await page.getByLabel("Username").fill(duplicateName.username);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
  const usernameIdentity = await page.request.get("/api/v2/me");
  const usernameBody = await usernameIdentity.json();
  expect(usernameBody.data.username).toBe(duplicateName.username);
  await page.goto("/account");
  await page.getByRole("button", { exact: true, name: "登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);

  // A unique name reaches the same private Home.
  await waitForSignInWindow("/sign-in/name");
  await page.getByRole("button", { name: "中文全名" }).click();
  await page.getByLabel("中文全名").fill(chan.fullName);
  await page.getByLabel("密碼", { exact: true }).fill(chan.password);
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await expect(
    page.getByText(`歡迎回來，${chan.fullName}。`, { exact: true })
  ).toBeVisible();
  const nameIdentity = await page.request.get("/api/v2/me");
  const nameBody = await nameIdentity.json();
  expect(nameBody.data.username).toBe(chan.username);
  expect(signInRequests).toEqual([
    "/api/auth/sign-in/name",
    "/api/auth/sign-in/username",
    "/api/auth/sign-in/name",
  ]);
});

test("both browser sign-in modes preserve expired temporary-password errors", async ({
  page,
}) => {
  runLocalSql(`UPDATE account SET temporary_password_expires_at=CAST(strftime('%s','now') AS INTEGER)-1
    WHERE user_id=(SELECT id FROM user WHERE username='${chan.username.toLowerCase()}') AND provider_id='credential'`);
  try {
    await waitForSignInWindow();
    await page.goto("/sign-in");
    await page.getByLabel("Username").fill(chan.username);
    await page.getByLabel("密碼", { exact: true }).fill(chan.password);
    await page.getByRole("button", { exact: true, name: "登入" }).click();
    await expect(page.getByRole("alert")).toContainText("臨時密碼已到期");
    await expect(page.getByRole("alert")).toContainText("請聯絡職員");
    await expect(page).toHaveURL(/\/sign-in$/u);
    const usernameSession = await page.request.get("/api/auth/get-session");
    expect(await usernameSession.json()).toBeNull();
    await expect(
      page.getByRole("button", { exact: true, name: "登入" })
    ).toBeEnabled();
    await waitForSignInWindow("/sign-in/name");
    await page.getByRole("button", { name: "中文全名" }).click();
    await page.getByLabel("中文全名").fill(chan.fullName);
    await page.getByRole("button", { exact: true, name: "登入" }).click();
    await expect(page.getByRole("alert")).toContainText("臨時密碼已到期");
    await expect(page.getByRole("alert")).toContainText("請聯絡職員");
    await expect(page).toHaveURL(/\/sign-in$/u);
    await expect(page.getByLabel("中文全名")).toHaveValue(chan.fullName);
    await expect(
      page.getByRole("button", { exact: true, name: "登入" })
    ).toBeEnabled();
    const session = await page.request.get("/api/auth/get-session");
    expect(await session.json()).toBeNull();
  } finally {
    runLocalSql(`UPDATE account SET temporary_password_expires_at=NULL
      WHERE user_id=(SELECT id FROM user WHERE username='${chan.username.toLowerCase()}') AND provider_id='credential'`);
  }
});

for (const mode of ["username", "name"] as const) {
  test(`the browser retries ${mode} sign-in after rate limiting and network failure`, async ({
    page,
  }) => {
    const endpoint = `/api/auth/sign-in/${mode}`;
    const identifier = mode === "name" ? chan.fullName : chan.username;
    const label = mode === "name" ? "中文全名" : "Username";
    const attempts: unknown[] = [];
    await page.goto("/sign-in");
    if (mode === "name") {
      await page.getByRole("button", { name: "中文全名" }).click();
    }
    await page.getByLabel(label, { exact: true }).fill(identifier);
    await page.getByLabel("密碼", { exact: true }).fill(chan.password);
    await page.route(`**${endpoint}`, async (route) => {
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) {
        await route.fulfill({
          contentType: "application/json",
          json: { code: "TOO_MANY_REQUESTS", message: "Too many requests" },
          status: 429,
        });
      } else if (attempts.length === 2) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    const attemptFailure = async (outcome: string) => {
      await page.getByRole("button", { exact: true, name: "登入" }).click();
      await expect(page.getByRole("alert")).toContainText(outcome);
      await expect(page).toHaveURL(/\/sign-in$/u);
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(
        identifier
      );
      await expect(page.getByLabel("密碼", { exact: true })).toHaveValue(
        chan.password
      );
      await expect(
        page.getByRole("button", { exact: true, name: "登入" })
      ).toBeEnabled();
      const failedSession = await page.request.get("/api/auth/get-session");
      expect(await failedSession.json()).toBeNull();
      const deniedRead = await page.request.get("/api/v2/me");
      expect(deniedRead.status()).toBe(401);
    };
    await attemptFailure("請稍後再試");
    await attemptFailure("無法連接系統");
    expect(attempts).toHaveLength(2);
    await waitForSignInWindow(`/sign-in/${mode}`);
    await page.getByRole("button", { exact: true, name: "登入" }).click();
    await expect(page).toHaveURL(/\/$/u);
    expect(attempts).toEqual(
      Array.from({ length: 3 }, () => ({
        [mode === "name" ? "fullName" : "username"]: identifier,
        password: chan.password,
      }))
    );
    const session = await page.request.get("/api/auth/get-session");
    const sessionBody = await session.json();
    expect(sessionBody.user.username).toBe(chan.username.toLowerCase());
    const identity = await page.request.get("/api/v2/me");
    expect(identity.status()).toBe(200);
    const identityBody = await identity.json();
    expect(identityBody.data.username).toBe(chan.username);
  });
}
