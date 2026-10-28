import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const password = "Synthetic-admin-stepdown-ui-password!";
const mutationPath = "/api/v2/roles/global-roles";
const tags = [
  "@native",
  "@browser",
  "@mobile-critical",
  "@risk-authorization",
  "@risk-session",
  "@risk-privacy",
  "@risk-presentation",
  "@risk-recovery",
];
const storageKey = (actor: string) =>
  `efcc.admin-stepdown.feedback.v1:${encodeURIComponent(actor)}`;
const createAccount = async (
  app: NativeApp,
  label: string,
  role: "admin" | "member" = "admin"
) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const username = `sd.ui.${label}.${suffix}`;
  const fullName = `陳自願退出${label}${suffix}`;
  const userId = await app.provision.account({
    email: `${username}@example.com`,
    fullName,
    membershipStatus: "active",
    password,
    role,
    username,
  });
  return { fullName, userId, username };
};
const signIn = async (page: Page, username: string) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByRole("textbox", { name: "密碼" }).fill(password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};
const openExit = async (page: Page) => {
  await page.goto("/account");
  await page.getByRole("link", { name: /^自願退出管理員身份/u }).click();
  await expect(page).toHaveURL(/\/account\?task=admin-exit$/u);
  await expect(page.getByRole("radio", { name: /^會友/u })).toBeChecked();
  await expect(
    page.getByRole("button", { exact: true, name: "繼續" })
  ).toBeEnabled();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
};
const confirmProof = async (page: Page) => {
  const dialog = page.getByRole("dialog", { name: "確認目前密碼" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("目前密碼", { exact: true }).fill(password);
  await dialog
    .getByRole("button", { exact: true, name: "確認並返回檢查" })
    .click();
  await expect(
    dialog.getByText("伺服器已確認「確認目前密碼」完成。", { exact: true })
  ).toBeVisible();
  await dialog
    .getByRole("button", { exact: true, name: "確認並返回檢查" })
    .click();
  await expect(dialog).toHaveCount(0);
};
const finalAction = (page: Page) =>
  page.getByRole("button", { exact: true, name: "確認並退出管理員身份" });
const effects = (app: NativeApp, actor: string) =>
  app.db
    .prepare(`SELECT
  (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
  (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
  (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id=? AND role='admin' AND action='withdrawn') AS history,
  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND role='admin' AND action='withdrawn') AS receipts,
  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND action='global_role_changed') AS audits,
  (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id=?) AS delegation`)
    .bind(actor, actor, actor, actor, actor, actor)
    .first();
const prepareReview = async (page: Page) => {
  await page.getByRole("button", { exact: true, name: "繼續" }).click();
  await confirmProof(page);
  // Confirmation is not a command: a second explicit action opens final review.
  await expect(finalAction(page)).toHaveCount(0);
  await page.getByRole("button", { exact: true, name: "繼續" }).click();
  await expect(
    page.getByRole("dialog", { name: "確認自願退出" })
  ).toBeVisible();
};

for (const malformed of ["invalid JSON", "invalid reference"] as const) {
  dedicatedTest(
    `Account exit preserves ${malformed} original-operation storage and blocks replacement`,
    { tag: tags },
    async ({ browser, caseApp, extraHTTPHeaders }) => {
      const actor = await createAccount(caseApp, "malformed");
      await createAccount(caseApp, "peer");
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await signIn(page, actor.username);
        const raw =
          malformed === "invalid JSON"
            ? "{"
            : JSON.stringify({
                actorUserId: actor.userId,
                operationKey: randomUUID(),
              });
        await page.evaluate(
          ({ key, value }) => sessionStorage.setItem(key, value),
          { key: storageKey(actor.userId), value: raw }
        );
        const commands: string[] = [];
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === mutationPath
          ) {
            commands.push(request.postData() ?? "");
          }
        });
        const assertFencedMount = async () => {
          await page.goto("/account?task=admin-exit");
          await expect(
            page.getByText(
              "暫時未能讀取原有操作記錄，資料已隱藏；請恢復瀏覽器儲存功能後重新載入。",
              { exact: true }
            )
          ).toBeVisible();
          await expect(page.getByRole("radio")).toHaveCount(0);
          await expect(finalAction(page)).toHaveCount(0);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey(actor.userId)
            )
          ).toBe(raw);
        };
        await assertFencedMount();
        await assertFencedMount();
        expect(commands).toEqual([]);
        expect(await effects(caseApp, actor.userId)).toMatchObject({
          audits: 0,
          history: 0,
          receipts: 0,
          role: "admin",
        });
      } finally {
        await context.close();
      }
    }
  );
}

for (const resultingRole of ["member", "staff"] as const) {
  dedicatedTest(
    `Account Admin exit confirms ${resultingRole}, revokes every Session and requires fresh sign-in`,
    { tag: tags },
    async ({ browser, caseApp, extraHTTPHeaders }, testInfo) => {
      const actor = await createAccount(caseApp, "actor");
      const peer = await createAccount(caseApp, "peer");
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      const second = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const secondPage = await second.newPage();
        await signIn(secondPage, actor.username);
        const page = await context.newPage();
        await signIn(page, actor.username);
        await openExit(page);
        if (resultingRole === "staff") {
          await page.getByRole("radio", { name: /^職員/u }).check();
        }
        let commands = 0;
        let dispatched = false;
        const afterDispatch: string[] = [];
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (!url.pathname.startsWith(mutationPath)) {
            return;
          }
          if (dispatched) {
            afterDispatch.push(`${request.method()} ${url.pathname}`);
          }
          if (request.method() === "POST" && url.pathname === mutationPath) {
            commands += 1;
            dispatched = true;
          }
        });
        await prepareReview(page);
        expect(commands).toBe(0);
        const reviewPresentation = {
          criticalAction: finalAction(page),
          drafts: page.locator("input"),
          masks: [
            page.getByText(actor.fullName, { exact: true }),
            page.getByText(actor.username, { exact: true }),
          ],
        };
        await qualifyPresentation(
          page,
          testInfo,
          "admin-exit-review-phone",
          reviewPresentation
        );
        await qualifyPresentation(
          page,
          testInfo,
          "admin-exit-review-desktop",
          reviewPresentation
        );
        const response = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === mutationPath &&
            r.request().method() === "POST"
        );
        await finalAction(page).click();
        const completedResponse = await response;
        expect(completedResponse.status()).toBe(201);
        await expect(
          page.getByRole("heading", { exact: true, name: "操作已完成" })
        ).toBeVisible();
        await expect(
          page.getByText(actor.fullName, { exact: true })
        ).toHaveCount(0);
        await expect(page.getByRole("radio")).toHaveCount(0);
        await expect(page.getByLabel("目前密碼", { exact: true })).toHaveCount(
          0
        );
        await qualifyPresentation(page, testInfo, "admin-exit-confirmed", {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        });
        expect(await effects(caseApp, actor.userId)).toEqual({
          audits: 1,
          delegation: 0,
          history: 1,
          receipts: 1,
          role: resultingRole,
          sessions: 0,
        });
        const secondSession = await second.request.get("/api/auth/get-session");
        expect(await secondSession.json()).toBeNull();
        const initiatingSession = await context.request.get(
          "/api/auth/get-session"
        );
        expect(await initiatingSession.json()).toBeNull();
        expect(commands).toBe(1);
        expect(afterDispatch).toEqual([]);
        expect(
          await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey(actor.userId)
          )
        ).toBeNull();
        await page.getByRole("link", { exact: true, name: "前往登入" }).click();
        await expect(page).toHaveURL(/\/sign-in$/u);
        await qualifyPresentation(page, testInfo, "admin-exit-fresh-sign-in", {
          criticalAction: page.getByRole("button", {
            exact: true,
            name: "登入",
          }),
          drafts: page.locator("input"),
          focus: page.getByRole("textbox", { name: "Username" }),
        });
        await signIn(page, actor.username);
        await page.goto("/account");
        await expect(
          page.getByRole("link", { name: /^自願退出管理員身份/u })
        ).toHaveCount(0);
        await page.goto("/account?task=admin-exit");
        await expect(page).toHaveURL(/\/account$/u);
        const peerRole = await caseApp.db
          .prepare(
            "SELECT account_role AS role FROM person_profile WHERE user_id=?"
          )
          .bind(peer.userId)
          .first();
        expect(peerRole).toEqual({ role: "admin" });
      } finally {
        await context.close();
        await second.close();
      }
    }
  );
}

dedicatedTest(
  "Account exit reuses valid proof and expired proof retains Staff without automatically exiting",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }) => {
    const actor = await createAccount(caseApp, "proof");
    await createAccount(caseApp, "peer");
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const page = await context.newPage();
      await signIn(page, actor.username);
      const confirmation = await page.request.post(
        "/api/v2/account/password-confirmation",
        {
          data: { operationKey: randomUUID(), password },
        }
      );
      expect(confirmation.status()).toBe(201);
      await openExit(page);
      await page.getByRole("radio", { name: /^職員/u }).check();
      await page.getByRole("button", { exact: true, name: "繼續" }).click();
      await expect(
        page.getByRole("dialog", { name: "確認自願退出" })
      ).toBeVisible();
      await expect(page.getByLabel("目前密碼", { exact: true })).toHaveCount(0);
      // Expire the exact Session-bound proof on real storage after final review.
      await caseApp.db
        .prepare("UPDATE session SET password_confirmed_at=0 WHERE user_id=?")
        .bind(actor.userId)
        .run();
      await finalAction(page).click();
      await confirmProof(page);
      await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
      });
      await expect(finalAction(page)).toHaveCount(0);
      await page.getByRole("button", { exact: true, name: "繼續" }).click();
      await finalAction(page).click();
      await expect(
        page.getByRole("heading", { exact: true, name: "操作已完成" })
      ).toBeVisible();
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        history: 1,
        receipts: 1,
        role: "staff",
      });
    } finally {
      await context.close();
    }
  }
);

for (const loss of ["lost", "401 after"] as const) {
  dedicatedTest(
    `Account exit ${loss} committed response stays UNKNOWN without receipt lookup, replacement or inference after sign-in`,
    { tag: tags },
    async ({ browser, caseApp, extraHTTPHeaders }, testInfo) => {
      const actor = await createAccount(caseApp, "lost");
      await createAccount(caseApp, "peer");
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await signIn(page, actor.username);
        await openExit(page);
        await prepareReview(page);
        let commands = 0;
        const forbidden: string[] = [];
        await page.route("**/api/v2/roles/global-roles**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (
            request.method() === "POST" &&
            url.pathname === mutationPath &&
            commands === 0
          ) {
            commands += 1;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            const delivery =
              loss === "lost"
                ? route.abort("failed")
                : route.fulfill({
                    body: JSON.stringify({
                      error: {
                        code: "unauthorized",
                        message: "Authentication required",
                      },
                    }),
                    contentType: "application/json",
                    status: 401,
                  });
            await delivery;
          } else {
            if (commands > 0) {
              forbidden.push(`${request.method()} ${url.pathname}`);
            }
            await route.continue();
          }
        });
        await finalAction(page).click();
        await expect(
          page.getByRole("heading", { exact: true, name: "操作結果未能確認" })
        ).toBeVisible();
        await expect(page.getByRole("radio")).toHaveCount(0);
        await expect(finalAction(page)).toHaveCount(0);
        await expect(
          page.getByText(actor.fullName, { exact: true })
        ).toHaveCount(0);
        await qualifyPresentation(page, testInfo, "admin-exit-unknown", {
          criticalAction: page.getByRole("link", {
            exact: true,
            name: "前往登入",
          }),
          drafts: page.locator("input"),
        });
        const stored = await page.evaluate(
          (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
          storageKey(actor.userId)
        );
        expect(stored).toEqual({
          actorUserId: actor.userId,
          authContextMarker: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
          operationKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
        });
        expect(await effects(caseApp, actor.userId)).toMatchObject({
          audits: 1,
          history: 1,
          receipts: 1,
          role: "member",
          sessions: 0,
        });
        await page.reload();
        await expect(page).toHaveURL(
          /\/sign-in\?reason=authentication-required$/u
        );
        await signIn(page, actor.username);
        await page.goto("/inbox");
        await expect(
          page.getByRole("heading", { exact: true, name: "操作已完成" })
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
            storageKey(actor.userId)
          )
        ).toEqual(stored);
        expect(commands).toBe(1);
        expect(forbidden).toEqual([]);
      } finally {
        await context.close();
      }
    }
  );
}

dedicatedTest(
  "Account exit ignores held acknowledgement after actor context replacement and never reads a child receipt",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }) => {
    const actor = await createAccount(caseApp, "old");
    const next = await createAccount(caseApp, "next");
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    const other = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    const { resolve: release, promise: held } = Promise.withResolvers<null>();
    const { resolve: committed, promise: reached } =
      Promise.withResolvers<null>();
    const delivered = Promise.withResolvers<null>();
    try {
      const nextPage = await other.newPage();
      await signIn(nextPage, next.username);
      const page = await context.newPage();
      await signIn(page, actor.username);
      await openExit(page);
      await prepareReview(page);
      const commands: unknown[] = [];
      const reads: string[] = [];
      await page.route("**/api/v2/roles/global-roles**", async (route) => {
        const request = route.request();
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === mutationPath
        ) {
          commands.push(request.postDataJSON());
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          committed(null);
          await held;
          try {
            await route.fulfill({ response });
            delivered.resolve(null);
          } catch (error) {
            delivered.reject(error);
            throw error;
          }
        } else {
          if (commands.length > 0) {
            reads.push(request.url());
          }
          await route.continue();
        }
      });
      await finalAction(page).click();
      await reached;
      const saved = await page.evaluate(
        (key) => sessionStorage.getItem(key),
        storageKey(actor.userId)
      );
      await context.clearCookies();
      const nextStorageState = await other.storageState();
      await context.addCookies(nextStorageState.cookies);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByText(actor.fullName, { exact: true })).toHaveCount(
        0
      );
      release(null);
      await delivered.promise;
      await expect(page).toHaveURL(/\/account$/u);
      await expect(
        page.getByRole("heading", { exact: true, name: "操作已完成" })
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { exact: true, name: "操作結果未能確認" })
      ).toHaveCount(0);
      expect(commands).toHaveLength(1);
      expect(reads).toEqual([]);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          storageKey(actor.userId)
        )
      ).toBe(saved);
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          storageKey(next.userId)
        )
      ).toBeNull();
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });
    } finally {
      release(null);
      await context.close();
      await other.close();
    }
  }
);

dedicatedTest(
  "Account last Admin exit keeps explicit Staff after definite no-write and guards unsent departure",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }, testInfo) => {
    const actor = await createAccount(caseApp, "last");
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const page = await context.newPage();
      await signIn(page, actor.username);
      await openExit(page);
      await page.getByRole("radio", { name: /^職員/u }).check();
      await page.getByRole("link", { exact: true, name: "返回帳戶" }).click();
      await page.getByRole("button", { exact: true, name: "繼續編輯" }).click();
      await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
      await qualifyPresentation(page, testInfo, "admin-exit-choice-reflow", {
        criticalAction: page.getByRole("button", { exact: true, name: "繼續" }),
        drafts: page.locator("input"),
        focus: page.getByRole("radio", { name: /^職員/u }),
        masks: [
          page.getByText(actor.fullName, { exact: true }),
          page.getByText(actor.username, { exact: true }),
        ],
      });
      await prepareReview(page);
      await page.keyboard.press("Escape");
      await expect(finalAction(page)).toHaveCount(0);
      await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
      await page.getByRole("button", { exact: true, name: "繼續" }).click();
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === mutationPath &&
          r.request().method() === "POST"
      );
      await finalAction(page).click();
      const rejectedResponse = await response;
      expect(rejectedResponse.status()).toBe(409);
      await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
      await expect(
        page.getByRole("button", { exact: true, name: "繼續" })
      ).toBeEnabled();
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
      });
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          storageKey(actor.userId)
        )
      ).toBeNull();
      await page.getByRole("button", { exact: true, name: "重設" }).click();
      await expect(page.getByRole("radio", { name: /^會友/u })).toBeChecked();
      // This is an explicit command; default Member requires no fake dirty edit.
      await expect(
        page.getByRole("button", { exact: true, name: "繼續" })
      ).toBeEnabled();
      await page.getByRole("radio", { name: /^職員/u }).check();
      await page.getByRole("link", { exact: true, name: "返回帳戶" }).click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await expect(page).toHaveURL(/\/account$/u);
    } finally {
      await context.close();
    }
  }
);

dedicatedTest(
  "Account exit authentication expiry disposes choices instead of requesting password proof",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }) => {
    const actor = await createAccount(caseApp, "expired");
    await createAccount(caseApp, "peer");
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const page = await context.newPage();
      await signIn(page, actor.username);
      await openExit(page);
      await page.getByRole("radio", { name: /^職員/u }).check();
      await caseApp.db
        .prepare("UPDATE session SET expires_at=unixepoch()-1 WHERE user_id=?")
        .bind(actor.userId)
        .run();
      const commandRequests: string[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === mutationPath
        ) {
          commandRequests.push(request.url());
        }
      });
      const expiredAuthority = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === mutationPath &&
          response.status() === 401
      );
      await page.getByRole("button", { exact: true, name: "繼續" }).click();
      const authorityResponse = await expiredAuthority;
      expect(authorityResponse.status()).toBe(401);
      await expect(page).toHaveURL(/\/sign-in(?:\?|$)/u);
      await expect(
        page.getByRole("dialog", { name: "確認目前密碼" })
      ).toHaveCount(0);
      await expect(page.getByText(actor.fullName, { exact: true })).toHaveCount(
        0
      );
      await expect(page.getByRole("radio")).toHaveCount(0);
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
      });
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          storageKey(actor.userId)
        )
      ).toBeNull();
      expect(commandRequests).toEqual([]);
    } finally {
      await context.close();
    }
  }
);

dedicatedTest(
  "Account exit unavailable authority read hides labels and reloads without inventing denial or an exit",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }) => {
    const actor = await createAccount(caseApp, "unavailable");
    await createAccount(caseApp, "peer");
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const page = await context.newPage();
      await signIn(page, actor.username);
      await page.route("**/api/v2/roles/global-roles?**", (route) =>
        route.abort("failed")
      );
      await page.goto("/account?task=admin-exit");
      await expect(
        page.getByText("暫時未能確認管理權限，資料已隱藏；請重新載入。", {
          exact: true,
        })
      ).toBeVisible();
      await expect(page.getByText(actor.fullName, { exact: true })).toHaveCount(
        0
      );
      await expect(page.getByRole("radio")).toHaveCount(0);
      await expect(finalAction(page)).toHaveCount(0);
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
      });
      await page.unroute("**/api/v2/roles/global-roles?**");
      await page.getByRole("button", { exact: true, name: "重新載入" }).click();
      await expect(
        page.getByRole("button", { exact: true, name: "繼續" })
      ).toBeEnabled();
      await expect(page.getByRole("radio", { name: /^會友/u })).toBeChecked();
    } finally {
      await context.close();
    }
  }
);

dedicatedTest(
  "Account exit danger confirmation remains reachable in controlled reduced and offset visual viewport simulation",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }) => {
    const actor = await createAccount(caseApp, "viewport");
    await createAccount(caseApp, "peer");
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      reducedMotion: "reduce",
      viewport: { height: 700, width: 390 },
    });
    try {
      const page = await context.newPage();
      await signIn(page, actor.username);
      await openExit(page);
      await page.getByRole("radio", { name: /^職員/u }).check();
      await prepareReview(page);
      const layoutHeight = await page.evaluate(() => window.innerHeight);
      const dialog = page.getByRole("dialog", { name: "確認自願退出" });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      const assertDialogViewport = async (
        offsetTop: number,
        eventName: "resize" | "scroll"
      ) => {
        // Controlled metrics on the native EventTarget simulate occlusion.
        // They do not qualify an actual software keyboard, zoom or device.
        await page.evaluate(
          ({ top, event }) => {
            const viewport = window.visualViewport;
            if (!viewport) {
              throw new Error(
                "This browser has no VisualViewport presentation seam"
              );
            }
            Object.defineProperties(viewport, {
              height: { configurable: true, value: 320 },
              offsetTop: { configurable: true, value: top },
              scale: { configurable: true, value: 1 },
            });
            viewport.dispatchEvent(new Event(event));
          },
          { event: eventName, top: offsetTop }
        );
        await expect
          .poll(
            async () => {
              const box = await dialog.boundingBox();
              return box
                ? {
                    bottomOverflow: Math.max(
                      0,
                      box.y + box.height - offsetTop - 321
                    ),
                    topOverflow: Math.max(0, offsetTop - 1 - box.y),
                  }
                : null;
            },
            {
              message:
                "The final confirmation must fit the simulated visible viewport",
            }
          )
          .toEqual({
            bottomOverflow: 0,
            topOverflow: 0,
          });
        const danger = finalAction(page);
        await danger.focus();
        await danger.scrollIntoViewIfNeeded();
        await expect(danger).toBeFocused();
        await expect
          .poll(
            async () => {
              const box = await danger.boundingBox();
              return box
                ? {
                    bottomOverflow: Math.max(
                      0,
                      box.y + box.height - offsetTop - 321
                    ),
                    topOverflow: Math.max(0, offsetTop - 1 - box.y),
                  }
                : null;
            },
            {
              message:
                "The focused final danger action must remain inside the simulated visible viewport",
            }
          )
          .toEqual({
            bottomOverflow: 0,
            topOverflow: 0,
          });
      };
      await assertDialogViewport(60, "resize");
      await assertDialogViewport(100, "scroll");
      expect(await page.evaluate(() => window.innerHeight)).toBe(layoutHeight);
      await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
      await dialog.getByRole("button", { exact: true, name: "取消" }).click();
      await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
      });
    } finally {
      await context.close();
    }
  }
);

dedicatedTest(
  "Account exit unresolved original operation blocks a new exit after same-actor fresh sign-in and public Admin regrant",
  { tag: tags },
  async ({ browser, caseApp, extraHTTPHeaders }) => {
    const actor = await createAccount(caseApp, "regrant");
    const peer = await createAccount(caseApp, "peer");
    // Stable logical clients: A keeps one address across all three sign-ins;
    // the peer Admin has a separate address, not a per-attempt limiter bypass.
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.0.10",
      },
    });
    const peerContext = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.0.11",
      },
    });
    try {
      const page = await context.newPage();
      const peerPage = await peerContext.newPage();
      await signIn(peerPage, peer.username);
      await signIn(page, actor.username);
      await openExit(page);
      await prepareReview(page);
      const exitCommands: Record<string, unknown>[] = [];
      const protectedReads: string[] = [];
      await page.route("**/api/v2/roles/global-roles**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "POST" && url.pathname === mutationPath) {
          exitCommands.push(request.postDataJSON() as Record<string, unknown>);
          if (exitCommands.length === 1) {
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            await route.abort("failed");
            return;
          }
        } else if (exitCommands.length > 0) {
          protectedReads.push(`${request.method()} ${url.pathname}`);
        }
        await route.continue();
      });
      await finalAction(page).click();
      await expect(
        page.getByRole("heading", {
          exact: true,
          name: "操作結果未能確認",
        })
      ).toBeVisible();
      const original = await page.evaluate((key) => {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      }, storageKey(actor.userId));
      expect(original).toEqual({
        actorUserId: actor.userId,
        authContextMarker: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
        operationKey: exitCommands[0]?.operationKey,
      });
      if (!original) {
        throw new Error("The unresolved original reference was lost");
      }
      const originalRaw = await page.evaluate(
        (key) => sessionStorage.getItem(key),
        storageKey(actor.userId)
      );
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });

      // Fresh Member sign-in and Inbox navigation do not settle that command.
      await signIn(page, actor.username);
      await page.goto("/inbox");
      const memberCookies = await context.cookies();
      const memberMarker = memberCookies.find(
        (cookie) => cookie.name === "efcc-auth-context"
      )?.value;
      expect(memberMarker).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/iu));
      expect(memberMarker).not.toBe(original.authContextMarker);
      await expect(
        page.getByRole("heading", { exact: true, name: "操作已完成" })
      ).toHaveCount(0);

      // Another Admin uses the real public command, revoking A's Member Session.
      const confirmation = await peerPage.request.post(
        "/api/v2/account/password-confirmation",
        {
          data: { operationKey: randomUUID(), password },
        }
      );
      expect(confirmation.status()).toBe(201);
      const grant = await peerPage.request.post(mutationPath, {
        data: {
          action: "granted",
          operationKey: randomUUID(),
          role: "admin",
          targetUserId: actor.userId,
        },
        headers: { "x-efcc-expected-actor-id": peer.userId },
      });
      expect(grant.status()).toBe(201);
      expect(await grant.json()).toMatchObject({
        data: {
          receipt: {
            action: "granted",
            resultingGlobalRole: "admin",
            targetUserId: actor.userId,
          },
        },
      });
      const revokedMemberSession = await context.request.get(
        "/api/auth/get-session"
      );
      expect(await revokedMemberSession.json()).toBeNull();
      await signIn(page, actor.username);
      const adminCookies = await context.cookies();
      const adminMarker = adminCookies.find(
        (cookie) => cookie.name === "efcc-auth-context"
      )?.value;
      expect(adminMarker).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/iu));
      expect(adminMarker).not.toBe(memberMarker);
      expect(adminMarker).not.toBe(original.authContextMarker);

      // A throwing read must not look like absence, even though native removal
      // still works. Instrument only the browser storage boundary after commit.
      await page.evaluate(() => {
        sessionStorage.setItem("efcc.test.admin-stepdown.read-fault", "on");
      });
      await page.addInitScript(() => {
        const nativeGetItem = Storage.prototype.getItem;
        const nativeSetItem = Storage.prototype.setItem;
        Reflect.set(window, "__efccStepdownReferenceWrites", 0);
        Reflect.set(window, "__efccPeekStepdownReference", (key: string) =>
          nativeGetItem.call(sessionStorage, key)
        );
        Object.defineProperty(Storage.prototype, "getItem", {
          configurable: true,
          value(this: Storage, key: string) {
            if (
              key.startsWith("efcc.admin-stepdown.feedback.v1:") &&
              nativeGetItem.call(
                this,
                "efcc.test.admin-stepdown.read-fault"
              ) === "on"
            ) {
              throw new DOMException(
                "Synthetic transient storage read fault",
                "SecurityError"
              );
            }
            return nativeGetItem.call(this, key);
          },
        });
        Object.defineProperty(Storage.prototype, "setItem", {
          configurable: true,
          value(this: Storage, key: string, value: string) {
            if (key.startsWith("efcc.admin-stepdown.feedback.v1:")) {
              const writes = Reflect.get(
                window,
                "__efccStepdownReferenceWrites"
              ) as number;
              Reflect.set(window, "__efccStepdownReferenceWrites", writes + 1);
            }
            nativeSetItem.call(this, key, value);
          },
        });
      });

      await page.goto("/account");
      await page.getByRole("link", { name: /^自願退出管理員身份/u }).click();
      await expect(page).toHaveURL(/\/account\?task=admin-exit$/u);
      await expect(
        page.getByText(
          "暫時未能讀取原有操作記錄，資料已隱藏；請恢復瀏覽器儲存功能後重新載入。",
          { exact: true }
        )
      ).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(0);
      await expect(finalAction(page)).toHaveCount(0);
      await expect(page.getByText(actor.fullName, { exact: true })).toHaveCount(
        0
      );
      const inaccessibleReference = await page.evaluate((key) => {
        const peek = Reflect.get(window, "__efccPeekStepdownReference") as (
          key: string
        ) => string | null;
        return peek(key);
      }, storageKey(actor.userId));
      expect(inaccessibleReference).toBe(originalRaw);
      const removalProbe = await page.evaluate(() => {
        const key = "efcc.test.admin-stepdown.removal-probe";
        sessionStorage.setItem(key, "probe");
        sessionStorage.removeItem(key);
        return sessionStorage.getItem(key);
      });
      expect(removalProbe).toBeNull();
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "__efccStepdownReferenceWrites")
        )
      ).toBe(0);
      expect(exitCommands).toHaveLength(1);
      expect(protectedReads).toEqual([]);

      // The existing reload action stays fail closed while the fault persists.
      await page.getByRole("button", { exact: true, name: "重新載入" }).click();
      await expect(
        page.getByText(
          "暫時未能讀取原有操作記錄，資料已隱藏；請恢復瀏覽器儲存功能後重新載入。",
          { exact: true }
        )
      ).toBeVisible();
      const stillPreserved = await page.evaluate((key) => {
        const peek = Reflect.get(window, "__efccPeekStepdownReference") as (
          key: string
        ) => string | null;
        return peek(key);
      }, storageKey(actor.userId));
      expect(stillPreserved).toBe(originalRaw);
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "__efccStepdownReferenceWrites")
        )
      ).toBe(0);
      await page.evaluate(() => {
        sessionStorage.setItem("efcc.test.admin-stepdown.read-fault", "off");
      });
      await page.getByRole("button", { exact: true, name: "重新載入" }).click();
      await expect(
        page.getByRole("heading", { exact: true, name: "操作結果未能確認" })
      ).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(0);
      await expect(finalAction(page)).toHaveCount(0);
      await expect(
        page.getByRole("button", { exact: true, name: "繼續" })
      ).toHaveCount(0);
      await expect(page.getByText(actor.fullName, { exact: true })).toHaveCount(
        0
      );
      await expect(page.getByText(actor.username, { exact: true })).toHaveCount(
        0
      );
      expect(
        await page.evaluate((key) => {
          const raw = sessionStorage.getItem(key);
          return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        }, storageKey(actor.userId))
      ).toEqual(original);
      expect(exitCommands).toHaveLength(1);
      expect(protectedReads).toEqual([]);
      expect(
        await page.evaluate(() =>
          Reflect.get(window, "__efccStepdownReferenceWrites")
        )
      ).toBe(0);
      expect(await effects(caseApp, actor.userId)).toMatchObject({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "admin",
      });
    } finally {
      await context.close();
      await peerContext.close();
    }
  }
);

for (const fault of ["throws", "does not retain the write"] as const) {
  dedicatedTest(
    `Account exit browser-storage platform fault ${fault} blocks dispatch until storage recovery and explicit final action`,
    { tag: tags },
    async ({ browser, caseApp, extraHTTPHeaders }) => {
      const actor = await createAccount(caseApp, "storage");
      await createAccount(caseApp, "peer");
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      // Inject a platform-storage fault, not a command response or domain result.
      await context.addInitScript((mode) => {
        Reflect.set(window, "__efccStepdownStorageFault", true);
        const nativeSetItem = Storage.prototype.setItem;
        Object.defineProperty(Storage.prototype, "setItem", {
          configurable: true,
          value(this: Storage, key: string, value: string) {
            if (
              key.startsWith("efcc.admin-stepdown.feedback.v1:") &&
              Reflect.get(window, "__efccStepdownStorageFault")
            ) {
              if (mode === "throws") {
                throw new DOMException(
                  "Synthetic storage platform fault",
                  "QuotaExceededError"
                );
              }
              return;
            }
            nativeSetItem.call(this, key, value);
          },
        });
      }, fault);
      try {
        const page = await context.newPage();
        await signIn(page, actor.username);
        await openExit(page);
        await page.getByRole("radio", { name: /^職員/u }).check();
        await prepareReview(page);
        const exitCommands: Record<string, unknown>[] = [];
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === mutationPath
          ) {
            exitCommands.push(
              request.postDataJSON() as Record<string, unknown>
            );
          }
        });
        await finalAction(page).click();
        await expect(
          page.getByText(
            "未有提交退出操作。暫時未能保留安全操作記錄；請恢復瀏覽器儲存功能後，再明確確認退出。",
            { exact: true }
          )
        ).toBeVisible();
        await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
        await expect(
          page.getByRole("button", { exact: true, name: "繼續" })
        ).toBeEnabled();
        expect(exitCommands).toEqual([]);
        expect(
          await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey(actor.userId)
          )
        ).toBeNull();
        expect(await effects(caseApp, actor.userId)).toMatchObject({
          audits: 0,
          history: 0,
          receipts: 0,
          role: "admin",
        });

        await page.reload();
        await expect(page.getByRole("radio", { name: /^會友/u })).toBeChecked();
        await expect(
          page.getByRole("heading", { exact: true, name: "操作結果未能確認" })
        ).toHaveCount(0);
        await page.getByRole("radio", { name: /^職員/u }).check();
        await page.getByRole("button", { exact: true, name: "繼續" }).click();
        await expect(
          page.getByRole("dialog", { name: "確認自願退出" })
        ).toBeVisible();
        await finalAction(page).click();
        await expect(
          page.getByText(
            "未有提交退出操作。暫時未能保留安全操作記錄；請恢復瀏覽器儲存功能後，再明確確認退出。",
            { exact: true }
          )
        ).toBeVisible();
        await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
        expect(exitCommands).toEqual([]);
        expect(
          await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey(actor.userId)
          )
        ).toBeNull();
        expect(await effects(caseApp, actor.userId)).toMatchObject({
          audits: 0,
          history: 0,
          receipts: 0,
          role: "admin",
        });

        await page.evaluate(() => {
          Reflect.set(window, "__efccStepdownStorageFault", false);
        });
        // Restoring storage alone must not dispatch or restore a submitted state.
        expect(exitCommands).toEqual([]);
        await expect(
          page.getByRole("heading", { exact: true, name: "操作結果未能確認" })
        ).toHaveCount(0);
        await page.getByRole("button", { exact: true, name: "繼續" }).click();
        await expect(
          page.getByRole("dialog", { name: "確認自願退出" })
        ).toBeVisible();
        expect(exitCommands).toEqual([]);
        await finalAction(page).click();
        await expect(
          page.getByRole("heading", { exact: true, name: "操作已完成" })
        ).toBeVisible();
        expect(exitCommands).toHaveLength(1);
        expect(await effects(caseApp, actor.userId)).toMatchObject({
          audits: 1,
          history: 1,
          receipts: 1,
          role: "staff",
          sessions: 0,
        });
      } finally {
        await context.close();
      }
    }
  );
}
