import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const taskTest = dedicatedTest.extend<{
  identityAccounts: {
    admin: { userId: string; username: string; password: string };
    target: { userId: string; username: string; fullName: string };
  };
}>({
  identityAccounts: async ({ caseApp }, use) => {
    const suffix = randomUUID().slice(0, 8);
    const admin = {
      email: `identity.admin.${suffix}@example.com`,
      fullName: `陳身份管理員${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-identity-admin-password!",
      role: "admin" as const,
      username: `identity.admin.${suffix}`,
    };
    const target = {
      email: `identity.member.${suffix}@example.com`,
      fullName: `陳身份測試長名字${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-identity-member-password!",
      role: "member" as const,
      username: `identity.member.${suffix}`,
    };
    await use({
      admin: { ...admin, userId: await caseApp.provision.account(admin) },
      target: { ...target, userId: await caseApp.provision.account(target) },
    });
  },
});

const login = async (
  page: Page,
  account: { username: string; password: string }
) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(account.username);
  await page
    .getByRole("textbox", { exact: true, name: "密碼" })
    .fill(account.password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};
const chooseStaff = async (page: Page) => {
  await expect(page.getByRole("radio", { name: /^職員/u })).toBeEnabled();
  await page.getByRole("radio", { name: /^職員/u }).check();
};
const confirmInTask = async (page: Page, password: string) => {
  const dialog = page.getByRole("dialog", { name: "確認目前密碼" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { exact: true, name: "目前密碼" })
    .fill(password);
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
const openTask = async (
  page: Page,
  target: { userId: string; username: string; fullName: string }
) => {
  await page.goto("/roles/people");
  await page
    .getByRole("searchbox", { name: "姓名或 Username" })
    .fill(target.username);
  await page
    .getByRole("button", { name: new RegExp(target.fullName, "u") })
    .click();
  await page.getByRole("link", { exact: true, name: "管理帳戶身份" }).click();
  await expect(page).toHaveURL(/\/roles\/people\/identity\?/u);
  await expect(page.getByRole("radio", { name: /^會友/u })).toBeEnabled();
};

const assertFooterGeometry = async (
  page: Page,
  viewport: { height: number; width: number }
) => {
  await page.setViewportSize(viewport);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const footer = page.getByRole("contentinfo", { name: "任務操作" });
  // Native VisualViewport resize delivery and focus scrolling are asynchronous.
  // Poll the unchanged consumer geometry bounds, not a presumed event delay.
  await expect
    .poll(
      async () => {
        const box = await footer.boundingBox();
        return box
          ? Math.abs(box.y + box.height - viewport.height)
          : Number.POSITIVE_INFINITY;
      },
      { message: "The task footer must settle at the resized viewport bottom" }
    )
    .toBeLessThanOrEqual(1);
  const lastField = page.getByRole("radio", { name: /^管理員/u });
  await lastField.focus();
  await expect(lastField).toBeFocused();
  await expect
    .poll(
      async () => {
        const fieldBox = await lastField.boundingBox();
        const footerBox = await footer.boundingBox();
        if (!fieldBox || !footerBox) {
          return Number.POSITIVE_INFINITY;
        }
        return fieldBox.y + fieldBox.height - footerBox.y;
      },
      { message: "The focused final field must remain above the task footer" }
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
};

// Controlled visual-only occlusion on the browser's native viewport EventTarget.
// This is presentation simulation, not a real OSK, pinch gesture or device claim.
const simulateVisualViewport = async (
  page: Page,
  metrics: { height: number; offsetTop: number; scale: number },
  event: "resize" | "scroll"
) => {
  await page.evaluate(
    ({ eventName, values }) => {
      const viewport = window.visualViewport;
      if (!viewport) {
        throw new Error("This browser has no VisualViewport presentation seam");
      }
      Object.defineProperties(viewport, {
        height: { configurable: true, value: values.height },
        offsetTop: { configurable: true, value: values.offsetTop },
        scale: { configurable: true, value: values.scale },
      });
      viewport.dispatchEvent(new Event(eventName));
    },
    { eventName: event, values: metrics }
  );
};

const expectWithinViewport = async (
  control: Locator,
  top: number,
  bottom: number
) => {
  await expect
    .poll(
      async () => {
        const box = await control.boundingBox();
        return box?.y ?? Number.NEGATIVE_INFINITY;
      },
      {
        message:
          "The rendered control must settle below the visual viewport top",
      }
    )
    .toBeGreaterThanOrEqual(top - 1);
  await expect
    .poll(
      async () => {
        const box = await control.boundingBox();
        return box ? box.y + box.height : Number.POSITIVE_INFINITY;
      },
      {
        message:
          "The rendered control must settle above the visual viewport bottom",
      }
    )
    .toBeLessThanOrEqual(bottom + 1);
};

taskTest.describe(
  "Focused Member Staff identity task",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-session",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  () => {
    taskTest(
      "missing proof preserves choices and requires a second explicit Save; valid proof is reused for return to Member",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await openTask(page, target);
          const dispatches: {
            actor: string | undefined;
            body: Record<string, unknown>;
          }[] = [];
          page.on("request", (request) => {
            if (
              new URL(request.url()).pathname ===
                "/api/v2/roles/global-roles" &&
              request.method() === "POST"
            ) {
              dispatches.push({
                actor: request.headers()["x-efcc-expected-actor-id"],
                body: request.postDataJSON(),
              });
            }
          });
          await chooseStaff(page);
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await confirmInTask(page, admin.password);
          await expect(
            page.getByRole("radio", { name: /^職員/u })
          ).toBeChecked();
          expect(dispatches).toHaveLength(1);
          expect(dispatches[0]?.actor).toBe(admin.userId);
          const before = await context.request.get(
            `/api/v2/roles/global-roles/${target.userId}`
          );
          expect(before.status()).toBe(200);
          const beforeBody = await before.json();
          expect(beforeBody.data.person.role).toBe("member");
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toBeVisible();
          expect(dispatches).toHaveLength(2);
          expect(dispatches[1]?.body.operationKey).not.toBe(
            dispatches[0]?.body.operationKey
          );
          const delegation = await context.request.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId: target.userId,
              },
            }
          );
          expect(delegation.status()).toBe(201);
          await page
            .getByRole("link", { exact: true, name: "管理帳戶身份" })
            .click();
          await page.getByRole("radio", { name: /^會友/u }).check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          const after = await context.request.get(
            `/api/v2/roles/global-roles/${target.userId}`
          );
          expect(after.status()).toBe(200);
          const afterBody = await after.json();
          expect(afterBody.data.person).toMatchObject({
            role: "member",
            roleAssignerAssignment: null,
          });
        } finally {
          await context.close();
        }
      }
    );

    taskTest(
      "Reset, reverted choice and Keep Discard preserve the selected return context and real footer geometry",
      async (
        { browser, caseApp, extraHTTPHeaders, identityAccounts },
        testInfo
      ) => {
        const { admin, target } = identityAccounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await openTask(page, target);
          await expect(
            page.getByRole("contentinfo", { name: "任務操作" })
          ).toHaveCount(0);
          await chooseStaff(page);
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeChecked();
          await expect(
            page.getByRole("contentinfo", { name: "任務操作" })
          ).toHaveCount(0);
          await chooseStaff(page);
          await page.getByRole("radio", { name: /^會友/u }).check();
          await expect(
            page.getByRole("contentinfo", { name: "任務操作" })
          ).toHaveCount(0);
          await chooseStaff(page);
          await page.getByRole("link", { name: "返回人員權責" }).click();
          await page
            .getByRole("button", { exact: true, name: "繼續編輯" })
            .click();
          await expect(
            page.getByRole("radio", { name: /^職員/u })
          ).toBeChecked();
          const presentation = {
            criticalAction: page.getByRole("button", {
              exact: true,
              name: "儲存",
            }),
            drafts: page.locator("input"),
            focus: page.getByRole("radio", { name: /^職員/u }),
          };
          await qualifyPresentation(
            page,
            testInfo,
            "identity-task",
            presentation
          );
          await assertFooterGeometry(page, { height: 480, width: 320 });
          await assertFooterGeometry(page, { height: 600, width: 768 });
          await assertFooterGeometry(page, { height: 720, width: 1280 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "";
          });
          await page.getByRole("link", { name: "返回人員權責" }).click();
          await page
            .getByRole("button", { exact: true, name: "放棄變更" })
            .click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(new URL(page.url()).searchParams.get("person")).toBe(
            target.userId
          );
          expect(new URL(page.url()).searchParams.get("q")).toBe(
            target.username
          );
        } finally {
          await context.close();
        }
      }
    );

    taskTest(
      "lost real committed response preserves the original actor key across reload and reconciles without a replacement Save",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          const confirmation = await context.request.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password: admin.password } }
          );
          expect(confirmation.status()).toBe(201);
          await openTask(page, target);
          let originalKey = "";
          let writes = 0;
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            writes += 1;
            ({ operationKey: originalKey } = route.request().postDataJSON());
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            await route.abort("failed");
          });
          await chooseStaff(page);
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeVisible();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeDisabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          const key = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
          expect(
            await page.evaluate(
              (storageKey) =>
                JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
              key
            )
          ).toEqual({ actorUserId: admin.userId, operationKey: originalKey });
          await page.reload();
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(writes).toBe(1);
          expect(
            await page.evaluate(
              (storageKey) => sessionStorage.getItem(storageKey),
              key
            )
          ).toBeNull();
        } finally {
          await context.close();
        }
      }
    );

    taskTest(
      "a stale task cannot dispatch as a replacement Admin even if the account changes after the authorization read",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳接替管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-replacement-admin-password!",
          role: "admin" as const,
          username: `replacement.${randomUUID().slice(0, 8)}`,
        };
        const replacementUserId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await openTask(page, target);
          await chooseStaff(page);
          const arrived = Promise.withResolvers<boolean>();
          const release = Promise.withResolvers<boolean>();
          const settled = Promise.withResolvers<boolean>();
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            arrived.resolve(true);
            try {
              await release.promise;
              // route.fetch would replay A's already captured Cookie after
              // sign-out. Dispatch the exact UI command with the browser
              // context's current authenticated cookie jar instead.
              const headers = await route.request().allHeaders();
              expect(headers["x-efcc-expected-actor-id"]).toBe(admin.userId);
              delete headers.cookie;
              const requestBody = route.request().postDataBuffer();
              if (!requestBody) {
                throw new Error("The UI role command has no request body");
              }
              const response = await context.request.post(
                route.request().url(),
                {
                  data: requestBody,
                  headers,
                }
              );
              expect(response.status()).toBe(409);
              const body = await response.json();
              expect(body.error.code).toBe("actor_changed");
              await route.fulfill({ response });
            } finally {
              settled.resolve(true);
            }
          });
          try {
            await page
              .getByRole("button", { exact: true, name: "儲存" })
              .click();
            await arrived.promise;
            const signOut = await context.request.post("/api/auth/sign-out", {
              data: {},
            });
            expect(signOut.status()).toBe(200);
            const signIn = await context.request.post(
              "/api/auth/sign-in/username",
              {
                data: {
                  password: replacement.password,
                  username: replacement.username,
                },
              }
            );
            expect(signIn.status()).toBe(200);
            const currentSessionResponse = await context.request.get(
              "/api/auth/get-session"
            );
            expect(currentSessionResponse.status()).toBe(200);
            const currentSession = await currentSessionResponse.json();
            expect(currentSession.user.id).toBe(replacementUserId);
            release.resolve(true);
            await settled.promise;
            await expect(
              page.getByText(target.fullName, { exact: true })
            ).toHaveCount(0);
            const state = await context.request.get(
              `/api/v2/roles/global-roles/${target.userId}`
            );
            expect(state.status()).toBe(200);
            const stateBody = await state.json();
            expect(stateBody.data.person.role).toBe("member");
            const originalStorageKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                originalStorageKey
              )
            ).toBeNull();
            const replacementSignOut = await context.request.post(
              "/api/auth/sign-out",
              { data: {} }
            );
            expect(replacementSignOut.status()).toBe(200);
            const originalSignIn = await context.request.post(
              "/api/auth/sign-in/username",
              {
                data: { password: admin.password, username: admin.username },
              }
            );
            expect(originalSignIn.status()).toBe(200);
            await openTask(page, target);
            await expect(
              page.getByRole("radio", { name: /^會友/u })
            ).toBeChecked();
            await expect(
              page.getByRole("radio", { name: /^職員/u })
            ).toBeEnabled();
            await expect(
              page.getByRole("button", { exact: true, name: "查核原有操作" })
            ).toHaveCount(0);
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                originalStorageKey
              )
            ).toBeNull();
            const originalActorResponse = await context.request.get(
              `/api/v2/roles/people/${admin.userId}`
            );
            expect(originalActorResponse.status()).toBe(200);
            const originalActorBody = await originalActorResponse.json();
            expect(originalActorBody.data.person.identity.role).toBe("admin");
            const replacementActorResponse = await context.request.get(
              `/api/v2/roles/people/${replacementUserId}`
            );
            expect(replacementActorResponse.status()).toBe(200);
            const replacementActorBody = await replacementActorResponse.json();
            expect(replacementActorBody.data.person.identity.role).toBe(
              "admin"
            );
          } finally {
            release.resolve(true);
          }
        } finally {
          await context.close();
        }
      }
    );
    taskTest(
      "expired proof is a no-write with the same editable choice, but expired authentication never opens proof",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          const confirmation = await context.request.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password: admin.password } }
          );
          expect(confirmation.status()).toBe(201);
          await openTask(page, target);
          await chooseStaff(page);
          await caseApp.db
            .prepare(
              "UPDATE session SET password_confirmed_at = unixepoch() - 601 WHERE user_id = ?"
            )
            .bind(admin.userId)
            .run();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await confirmInTask(page, admin.password);
          await expect(
            page.getByRole("radio", { name: /^職員/u })
          ).toBeChecked();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeEnabled();
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "密碼已確認，請再按一次儲存。" })
          ).toBeFocused();
          const unchanged = await context.request.get(
            `/api/v2/roles/global-roles/${target.userId}`
          );
          expect(unchanged.status()).toBe(200);
          const unchangedBody = await unchanged.json();
          expect(unchangedBody.data.person.role).toBe("member");
          await caseApp.db
            .prepare(
              "UPDATE session SET expires_at = unixepoch() - 1 WHERE user_id = ?"
            )
            .bind(admin.userId)
            .run();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/sign-in/u);
          await expect(
            page.getByRole("dialog", { name: "確認目前密碼" })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );
    taskTest(
      "a late committed response cannot restore protected task state after authority replacement",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        await caseApp.provision.account({
          email: `${randomUUID()}@example.com`,
          fullName: "陳保留管理員",
          membershipStatus: "active",
          password: "Synthetic-continuity-admin-password!",
          role: "admin",
          username: `continuity.${randomUUID().slice(0, 8)}`,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const release = Promise.withResolvers<boolean>();
        const arrived = Promise.withResolvers<boolean>();
        const settled = Promise.withResolvers<boolean>();
        try {
          const page = await context.newPage();
          await login(page, admin);
          const confirmation = await context.request.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password: admin.password } }
          );
          expect(confirmation.status()).toBe(201);
          await openTask(page, target);
          await chooseStaff(page);
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            arrived.resolve(true);
            try {
              await release.promise;
              await route.fulfill({ response });
            } finally {
              settled.resolve(true);
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await arrived.promise;
          await expect(
            page.getByRole("button", { exact: true, name: "重設" })
          ).toBeDisabled();
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
            )
            .bind(admin.userId)
            .run();
          release.resolve(true);
          await settled.promise;
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("radio")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          const reference = await page.evaluate(
            (id) =>
              JSON.parse(
                sessionStorage.getItem(
                  `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
                ) ?? "null"
              ),
            admin.userId
          );
          expect(reference.actorUserId).toBe(admin.userId);
          expect(reference.operationKey).toMatch(/^[0-9a-f-]{36}$/u);
          const reconciliation = await context.request.post(
            "/api/v2/roles/global-roles/reconcile",
            { data: { operationKey: reference.operationKey } }
          );
          expect(reconciliation.status()).toBe(403);
        } finally {
          release.resolve(true);
          await context.close();
        }
      }
    );
    taskTest(
      "a restored actor-wide operation settles its authoritative original target rather than the newly opened identity task",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const other = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳另一身份對象",
          membershipStatus: "active" as const,
          password: "Synthetic-other-identity-password!",
          role: "member" as const,
          username: `other.identity.${randomUUID().slice(0, 8)}`,
        };
        const originalTarget = await caseApp.provision.account(other);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          const proofResponse = await context.request.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password: admin.password } }
          );
          expect(proofResponse.status()).toBe(201);
          const operationKey = randomUUID();
          const committed = await context.request.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey,
                role: "admin",
                targetUserId: originalTarget,
              },
            }
          );
          expect(committed.status()).toBe(201);
          await page.evaluate(
            (reference) => {
              sessionStorage.setItem(
                `efcc.global-role.operation.v1:${encodeURIComponent(reference.actorUserId)}`,
                JSON.stringify(reference)
              );
            },
            { actorUserId: admin.userId, operationKey }
          );
          await page.goto(
            `/roles/people/identity?person=${encodeURIComponent(target.userId)}`
          );
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeVisible();
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toHaveCount(0);
          await expect(page.getByRole("radio")).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          await expect(page).toHaveURL(
            new RegExp(`/roles/people\\?person=${originalTarget}$`, "u")
          );
          await expect(
            page.getByRole("heading", { exact: true, name: other.fullName })
          ).toBeVisible();
          const unchangedResponse = await context.request.get(
            `/api/v2/roles/global-roles/${target.userId}`
          );
          expect(unchangedResponse.status()).toBe(200);
          const unchangedBody = await unchangedResponse.json();
          expect(unchangedBody.data.person.role).toBe("member");
          const storedReference = await page.evaluate(
            (id) =>
              sessionStorage.getItem(
                `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
              ),
            admin.userId
          );
          expect(storedReference).toBeNull();
        } finally {
          await context.close();
        }
      }
    );
    taskTest(
      "a confirmed restricted Staff exit returns fresh context even when the target leaves the editable projection",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          const proofResponse = await context.request.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password: admin.password } }
          );
          expect(proofResponse.status()).toBe(201);
          const staffResponse = await context.request.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                role: "staff",
                targetUserId: target.userId,
              },
            }
          );
          expect(staffResponse.status()).toBe(201);
          const delegationResponse = await context.request.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId: target.userId,
              },
            }
          );
          expect(delegationResponse.status()).toBe(201);
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
            )
            .bind(target.userId)
            .run();
          await openTask(page, target);
          let operationKey = "";
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname === "/api/v2/roles/global-roles"
            ) {
              ({ operationKey } = request.postDataJSON());
            }
          });
          await page.getByRole("radio", { name: /^會友/u }).check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(new URL(page.url()).searchParams.get("person")).toBe(
            target.userId
          );
          await expect(
            page.getByRole("heading", { exact: true, name: "管理帳戶身份" })
          ).toHaveCount(0);
          expect(operationKey).toMatch(/^[0-9a-f-]{36}$/u);
          const resultResponse = await context.request.post(
            "/api/v2/roles/global-roles/reconcile",
            { data: { operationKey } }
          );
          expect(resultResponse.status()).toBe(200);
          const resultBody = await resultResponse.json();
          expect(resultBody.data).toMatchObject({
            outcome: "committed",
            receipt: {
              action: "withdrawn",
              resultingGlobalRole: "member",
              role: "staff",
              targetUserId: target.userId,
            },
          });
          const storedReference = await page.evaluate(
            (id) =>
              sessionStorage.getItem(
                `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
              ),
            admin.userId
          );
          expect(storedReference).toBeNull();
        } finally {
          await context.close();
        }
      }
    );
    taskTest(
      "simulated visual-only keyboard occlusion and panning keep task footer and Security proof controls reachable without changing the draft",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await page.setViewportSize({ height: 700, width: 390 });
          await login(page, admin);
          await openTask(page, target);
          await chooseStaff(page);
          const layoutHeight = await page.evaluate(() => window.innerHeight);
          await simulateVisualViewport(
            page,
            { height: 320, offsetTop: 60, scale: 1 },
            "resize"
          );
          expect(await page.evaluate(() => window.innerHeight)).toBe(
            layoutHeight
          );
          const footer = page.getByRole("contentinfo", { name: "任務操作" });
          await expectWithinViewport(footer, 60, 380);
          const lastField = page.getByRole("radio", { name: /^職員/u });
          await lastField.focus();
          await expectWithinViewport(lastField, 60, 380);
          await expect(lastField).toBeChecked();
          await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
          await simulateVisualViewport(
            page,
            { height: 320, offsetTop: 100, scale: 1 },
            "scroll"
          );
          await expectWithinViewport(footer, 100, 420);
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const dialog = page.getByRole("dialog", { name: "確認目前密碼" });
          await expect(dialog).toBeVisible();
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          const password = dialog.getByRole("textbox", {
            exact: true,
            name: "目前密碼",
          });
          await password.focus();
          await password.scrollIntoViewIfNeeded();
          await expectWithinViewport(password, 100, 420);
          const confirm = dialog.getByRole("button", {
            exact: true,
            name: "確認並返回檢查",
          });
          await confirm.focus();
          await confirm.scrollIntoViewIfNeeded();
          await expectWithinViewport(confirm, 100, 420);
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "";
          });
          await dialog
            .getByRole("button", { exact: true, name: "返回原工作" })
            .click();
          await expect(lastField).toBeChecked();
          // The scale branch restores normal layout rather than fixing controls
          // to the magnified viewport and hijacking native pinch/pan behavior.
          await simulateVisualViewport(
            page,
            { height: 320, offsetTop: 100, scale: 2 },
            "resize"
          );
          const normalFooter = await footer.boundingBox();
          expect(normalFooter).not.toBeNull();
          if (!normalFooter) {
            throw new Error(
              "The task footer disappeared during simulated zoom"
            );
          }
          expect(normalFooter.y + normalFooter.height).toBeCloseTo(
            layoutHeight,
            0
          );
          await expect(lastField).toBeChecked();
        } finally {
          await context.close();
        }
      }
    );
    taskTest(
      "a real no-write eligibility conflict refreshes a readable Member baseline and blocks the invalid Staff choice without replacing the operation",
      async ({ browser, caseApp, extraHTTPHeaders, identityAccounts }) => {
        const { admin, target } = identityAccounts;
        const departmentId = randomUUID();
        const assignmentId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
          )
          .bind(departmentId, "身份資格保留職務部門")
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,department_id,user_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(assignmentId, departmentId, target.userId)
          .run();
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const settled = Promise.withResolvers<boolean>();
        try {
          const page = await context.newPage();
          await login(page, admin);
          const proof = await context.request.post(
            "/api/v2/account/password-confirmation",
            {
              data: { operationKey: randomUUID(), password: admin.password },
            }
          );
          expect(proof.status()).toBe(201);
          await openTask(page, target);
          await chooseStaff(page);
          let writes = 0;
          let originalKey = "";
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            writes += 1;
            ({ operationKey: originalKey } = route.request().postDataJSON());
            arrived.resolve(true);
            try {
              await release.promise;
              const response = await route.fetch();
              expect(response.status()).toBe(409);
              const body = await response.json();
              expect(body.error.code).toBe("conflict");
              await route.fulfill({ response });
            } finally {
              settled.resolve(true);
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await arrived.promise;
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET banned_at=unixepoch() WHERE user_id=?"
            )
            .bind(target.userId)
            .run();
          release.resolve(true);
          await settled.promise;
          const staff = page.getByRole("radio", { name: /^職員/u });
          await expect(staff).toBeChecked();
          await expect(staff).toBeDisabled();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeDisabled();
          await expect(
            page.getByRole("button", { exact: true, name: "重設" })
          ).toBeEnabled();
          await expect(page.getByRole("alert")).toContainText(
            "目前不符合新增職員身份"
          );
          const freshResponse = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          expect(freshResponse.status()).toBe(200);
          const fresh = await freshResponse.json();
          expect(fresh.data.person).toMatchObject({
            capabilities: { canManageAccountRole: true },
            global: { eligibleForStaff: false, role: "member" },
            identity: { accountState: "banned" },
          });
          // A crafted form-submit event must still stop at the newly authorized
          // preflight read, even though the selected value remains in the form.
          const preflight = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                `/api/v2/roles/people/${target.userId}` &&
              response.request().method() === "GET"
          );
          await page.evaluate(() => {
            const form = document.querySelector("#account-identity-form");
            if (!(form instanceof HTMLFormElement)) {
              throw new Error("Identity form is not mounted");
            }
            form.requestSubmit();
          });
          const preflightResponse = await preflight;
          expect(preflightResponse.status()).toBe(200);
          await expect(
            page.getByRole("button", { exact: true, name: "重設" })
          ).toBeEnabled();
          expect(writes).toBe(1);
          const originalStorageKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              originalStorageKey
            )
          ).toBeNull();
          const effects = await caseApp.db
            .prepare(`SELECT
            (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
            (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='staff') AS history,
            (SELECT COUNT(*) FROM audit_event WHERE target_user_id=? AND action='global_role_changed') AS audits,
            (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=?) AS receipts,
            (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id=?) AS delegations,
            (SELECT COUNT(*) FROM department_manager_assignment WHERE id=? AND user_id=?) AS survivingDuty`)
            .bind(
              target.userId,
              target.userId,
              target.userId,
              admin.userId,
              originalKey,
              target.userId,
              assignmentId,
              target.userId
            )
            .first();
          expect(effects).toEqual({
            audits: 0,
            delegations: 0,
            history: 0,
            receipts: 0,
            role: "member",
            survivingDuty: 1,
          });
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeChecked();
          await expect(
            page.getByRole("contentinfo", { name: "任務操作" })
          ).toHaveCount(0);
        } finally {
          release.resolve(true);
          await context.close();
        }
      }
    );
  }
);
