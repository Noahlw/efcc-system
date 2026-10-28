import { randomUUID } from "node:crypto";

import type { APIResponse, Page } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const scopedTaskTest = dedicatedTest.extend<{
  accounts: {
    actor: { password: string; userId: string; username: string };
    target: {
      fullName: string;
      password: string;
      userId: string;
      username: string;
    };
  };
}>({
  accounts: async ({ caseApp }, use) => {
    const suffix = randomUUID().slice(0, 8);
    const actor = {
      email: `scoped.admin.${suffix}@example.com`,
      fullName: `陳部門管理員${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-scoped-admin-password!",
      role: "admin" as const,
      username: `scoped.admin.${suffix}`,
    };
    const target = {
      email: `scoped.member.${suffix}@example.com`,
      fullName: `陳部門職務對象${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-scoped-member-password!",
      role: "member" as const,
      username: `scoped.member.${suffix}`,
    };
    await use({
      actor: { ...actor, userId: await caseApp.provision.account(actor) },
      target: { ...target, userId: await caseApp.provision.account(target) },
    });
  },
});

const expectStatus = async (pending: Promise<APIResponse>, status: number) => {
  const response = await pending;
  expect(response.status()).toBe(status);
};

const signIn = async (
  page: Page,
  actor: { password: string; username: string }
) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(actor.username);
  await page
    .getByRole("textbox", { exact: true, name: "密碼" })
    .fill(actor.password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};

const department = async (app: NativeApp, name: string) => {
  const id = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
    )
    .bind(id, name)
    .run();
  return { id, name };
};

const seedDepartments = async (
  app: NativeApp,
  prefix: string,
  count: number
) => {
  const seedNext = async (index: number): Promise<void> => {
    if (index >= count) {
      return;
    }
    await department(app, `${prefix}${String(index).padStart(2, "0")}`);
    await seedNext(index + 1);
  };
  await seedNext(0);
};

const openTask = async (
  page: Page,
  target: { fullName: string; username: string }
) => {
  await page.goto("/roles/people");
  await page
    .getByRole("searchbox", { name: "姓名或 Username" })
    .fill(target.username);
  await page
    .getByRole("button", { name: new RegExp(target.fullName, "u") })
    .click();
  await page
    .getByRole("link", { exact: true, name: "編輯部門主管職務" })
    .click();
  await expect(page).toHaveURL(/\/roles\/people\/duties\?/u);
  await expect(
    page.getByRole("status").filter({ hasText: "正在讀取部門職務" })
  ).toHaveCount(0);
};

const foregroundTask = async (page: Page) => {
  const otherTab = await page.context().newPage();
  await otherTab.goto("/");
  await page.bringToFront();
  await otherTab.close();
};

scopedTaskTest.describe(
  "Person scoped Department Manager aggregate task",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-session",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  () => {
    scopedTaskTest(
      "storage exceptions and failed round trips block dispatch; one prepared key survives retry, committed-response loss and unreadable restoration",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "原有查核記錄保留部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await openTask(page, accounts.target);
          await page.evaluate(() => {
            const write = Storage.prototype.setItem;
            const read = Storage.prototype.getItem;
            let readBackBlocked = false;
            const attempts: string[] = [];
            Reflect.set(window, "scopedStorageAttempts", attempts);
            Storage.prototype.setItem = function setItem(
              this: Storage,
              key: string,
              value: string
            ) {
              if (
                this === sessionStorage &&
                key.startsWith("efcc.scoped-role.operation.v1:")
              ) {
                attempts.push(value);
                if (window.name === "scoped-write-throw") {
                  throw new DOMException(
                    "Synthetic storage write outage",
                    "QuotaExceededError"
                  );
                }
                if (window.name === "scoped-write-drop") {
                  return;
                }
              }
              write.call(this, key, value);
              if (
                this === sessionStorage &&
                key.startsWith("efcc.scoped-role.operation.v1:") &&
                window.name === "scoped-write-readback"
              ) {
                readBackBlocked = true;
              }
            };
            Storage.prototype.getItem = function getItem(
              this: Storage,
              key: string
            ) {
              if (
                this === sessionStorage &&
                key.startsWith("efcc.scoped-role.operation.v1:") &&
                readBackBlocked &&
                window.name === "scoped-write-readback"
              ) {
                throw new DOMException(
                  "Synthetic read-back outage after a retained write",
                  "SecurityError"
                );
              }
              return read.call(this, key);
            };
            window.name = "scoped-write-throw";
          });
          let submissions = 0;
          let originalKey = "";
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              submissions += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              await route.abort("failed");
            }
          );
          const checkbox = page.getByRole("checkbox", {
            exact: true,
            name: `部門主管：${row.name}`,
          });
          await checkbox.check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page.getByRole("alert")).toContainText(
            "無法安全保留操作查核記錄"
          );
          await expect(checkbox).toBeChecked();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeEnabled();
          expect(submissions).toBe(0);
          await page.evaluate(() => {
            window.name = "scoped-write-drop";
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect
            .poll(() =>
              page.evaluate(
                () => Reflect.get(window, "scopedStorageAttempts").length
              )
            )
            .toBe(2);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeEnabled();
          await expect(checkbox).toBeChecked();
          expect(submissions).toBe(0);
          const before = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(before?.count).toBe(0);
          await page.evaluate(() => {
            window.name = "scoped-write-readback";
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect
            .poll(() =>
              page.evaluate(
                () => Reflect.get(window, "scopedStorageAttempts").length
              )
            )
            .toBe(3);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeEnabled();
          await expect(checkbox).toBeChecked();
          expect(submissions).toBe(0);
          await page.evaluate(() => {
            window.name = "";
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const attempts = await page.evaluate(() =>
            Reflect.get(window, "scopedStorageAttempts")
          );
          const expectedReference = {
            actorUserId: accounts.actor.userId,
            operationKey: originalKey,
          };
          const serializedReference = JSON.stringify(expectedReference);
          expect(attempts).toEqual([
            serializedReference,
            serializedReference,
            serializedReference,
            serializedReference,
          ]);
          expect(submissions).toBe(1);
          await page.addInitScript(() => {
            const read = Storage.prototype.getItem;
            Storage.prototype.getItem = function getItem(
              this: Storage,
              key: string
            ) {
              if (
                this === sessionStorage &&
                key.startsWith("efcc.scoped-role.operation.v1:") &&
                window.name === "scoped-read-blocked"
              ) {
                throw new DOMException(
                  "Synthetic storage read outage",
                  "SecurityError"
                );
              }
              return read.call(this, key);
            };
          });
          await page.evaluate(() => {
            window.name = "scoped-read-blocked";
          });
          await page.reload();
          await expect(
            page.getByRole("button", { exact: true, name: "重新載入查核記錄" })
          ).toBeVisible();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toHaveCount(0);
          expect(submissions).toBe(1);
          await page.evaluate(() => {
            window.name = "";
          });
          const originalReference = await page.evaluate(
            (actorId) =>
              sessionStorage.getItem(
                `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
              ),
            accounts.actor.userId
          );
          expect(originalReference).toBe(serializedReference);
          await page
            .getByRole("button", { exact: true, name: "重新載入查核記錄" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const reconciled = page.waitForRequest((request) =>
            new URL(request.url()).pathname.endsWith(
              "/scoped-department-managers/reconcile"
            )
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const originalRequest = await reconciled;
          expect(originalRequest.postDataJSON()).toEqual({
            operationKey: originalKey,
          });
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(new URL(page.url()).searchParams.get("person")).toBe(
            accounts.target.userId
          );
          expect(submissions).toBe(1);
          const after = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(after?.count).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "a fresh failed read-back is cleaned before reload, so a never-dispatched draft cannot become permanent UNKNOWN",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "未提交查核記錄清理部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await openTask(page, accounts.target);
          let submissions = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/scoped-department-managers"
            ) {
              submissions += 1;
            }
          });
          await page.evaluate(() => {
            const write = Storage.prototype.setItem;
            const read = Storage.prototype.getItem;
            let written = false;
            window.name = "fresh-readback-outage";
            Storage.prototype.setItem = function setItem(
              this: Storage,
              key: string,
              value: string
            ) {
              write.call(this, key, value);
              if (
                this === sessionStorage &&
                key.startsWith("efcc.scoped-role.operation.v1:")
              ) {
                written = true;
                Reflect.set(window, "freshPreparedReference", value);
              }
            };
            Storage.prototype.getItem = function getItem(
              this: Storage,
              key: string
            ) {
              if (
                this === sessionStorage &&
                key.startsWith("efcc.scoped-role.operation.v1:") &&
                written &&
                window.name === "fresh-readback-outage"
              ) {
                throw new DOMException(
                  "Synthetic read-back outage after a retained write",
                  "SecurityError"
                );
              }
              return read.call(this, key);
            };
          });
          const checkbox = page.getByRole("checkbox", {
            exact: true,
            name: `部門主管：${row.name}`,
          });
          await checkbox.check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page.getByRole("alert")).toContainText(
            "無法安全保留操作查核記錄"
          );
          await expect(checkbox).toBeChecked();
          expect(submissions).toBe(0);
          const cleaned = await page.evaluate((actorId) => {
            window.name = "";
            return {
              prepared: Reflect.get(window, "freshPreparedReference"),
              stored: sessionStorage.getItem(
                `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
              ),
            };
          }, accounts.actor.userId);
          expect(JSON.parse(cleaned.prepared)).toEqual({
            actorUserId: accounts.actor.userId,
            operationKey: expect.any(String),
          });
          expect(cleaned.stored).toBeNull();
          const before = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(before?.count).toBe(0);
          await page.reload();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toBeVisible();
          await expect(checkbox).toBeEnabled();
          await expect(checkbox).not.toBeChecked();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          expect(submissions).toBe(0);
          await checkbox.check();
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/scoped-department-managers"
          );
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const response = await saved;
          expect(response.status()).toBe(201);
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(submissions).toBe(1);
          const after = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(after?.count).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "account replacement during a failed definite-no-write refresh disposes old labels and leaves neither actor an operation key",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "明確未提交後轉換帳戶部門");
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳未提交讀取替任管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-no-write-reader-replacement!",
          role: "admin" as const,
          username: `nowrite.${randomUUID().slice(0, 8)}`,
        };
        const replacementId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        let proofRejected = false;
        let originalKey = "";
        let submissions = 0;
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await openTask(page, accounts.target);
          await page.route(
            `**/scoped-department-managers/${accounts.target.userId}?page=1`,
            async (route) => {
              if (!proofRejected) {
                await route.continue();
                return;
              }
              arrived.resolve(null);
              await release.promise;
              await route.abort("failed");
            }
          );
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              submissions += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(403);
              const body = await response.json();
              expect(body.error.code).toBe("password_confirmation_required");
              proofRejected = true;
              await route.fulfill({ response });
            }
          );
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
            .check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await arrived.promise;
          await expectStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          const session = await context.request.get("/api/auth/get-session");
          const sessionBody = await session.json();
          expect(sessionBody.user.id).toBe(replacementId);
          await foregroundTask(page);
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          await expect(page.getByText(row.name, { exact: true })).toHaveCount(
            0
          );
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toHaveCount(0);
          const references = await page.evaluate(
            ({ originalActor, currentActor }) => [
              sessionStorage.getItem(
                `efcc.scoped-role.operation.v1:${encodeURIComponent(originalActor)}`
              ),
              sessionStorage.getItem(
                `efcc.scoped-role.operation.v1:${encodeURIComponent(currentActor)}`
              ),
            ],
            {
              currentActor: replacementId,
              originalActor: accounts.actor.userId,
            }
          );
          expect(references).toEqual([null, null]);
          expect(submissions).toBe(1);
          const effects = await caseApp.db
            .prepare(
              "SELECT (SELECT count(*) FROM department_manager_assignment WHERE user_id = ? AND department_id = ?) AS assignments, (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history, (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'department_manager_granted') AS audits, (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts"
            )
            .bind(
              accounts.target.userId,
              row.id,
              accounts.target.userId,
              accounts.target.userId,
              accounts.actor.userId,
              originalKey
            )
            .first();
          expect(effects).toEqual({
            assignments: 0,
            audits: 0,
            history: 0,
            receipts: 0,
          });
          release.resolve(null);
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "definite proof rejection followed by a failed baseline read keeps an unsent draft unavailable, not UNKNOWN",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "未提交草稿讀取失敗部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await openTask(page, accounts.target);
          let failBaseline = false;
          let failedOnce = false;
          const outcomes: number[] = [];
          const keys: string[] = [];
          await page.route(
            `**/scoped-department-managers/${accounts.target.userId}?page=1`,
            async (route) => {
              await (failBaseline ? route.abort("failed") : route.continue());
            }
          );
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              keys.push(route.request().postDataJSON().operationKey);
              const response = await route.fetch();
              outcomes.push(response.status());
              if (response.status() === 403 && !failedOnce) {
                const body = await response.json();
                expect(body.error.code).toBe("password_confirmation_required");
                failBaseline = true;
                failedOnce = true;
              }
              await route.fulfill({ response });
            }
          );
          const checkbox = page.getByRole("checkbox", {
            exact: true,
            name: `部門主管：${row.name}`,
          });
          await checkbox.check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("alert").filter({ hasText: "未讀取的部門不能編輯" })
          ).toBeVisible();
          await expect(
            page.getByRole("status").filter({ hasText: "1 項未提交更改" })
          ).toBeVisible();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeDisabled();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toHaveCount(0);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          expect(
            await page.evaluate(
              (actorId) =>
                sessionStorage.getItem(
                  `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
                ),
              accounts.actor.userId
            )
          ).toBeNull();
          const empty = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(empty?.count).toBe(0);
          expect(outcomes).toEqual([403]);
          failBaseline = false;
          await page
            .getByRole("button", { exact: true, name: "重新讀取部門職務" })
            .click();
          await expect(checkbox).toBeChecked();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeEnabled();
          expect(outcomes).toEqual([403]);
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const dialog = page.getByRole("dialog", { name: "確認目前密碼" });
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole("textbox", { exact: true, name: "目前密碼" })
            .fill(accounts.actor.password);
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(
            dialog.getByText("伺服器已確認「確認目前密碼」完成。", {
              exact: true,
            })
          ).toBeVisible();
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(dialog).toHaveCount(0);
          await expect(checkbox).toBeChecked();
          expect(outcomes).toEqual([403, 403]);
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(outcomes).toEqual([403, 403, 201]);
          expect(new Set(keys).size).toBe(3);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "authentication replacement while busy plus a lost committed response clears protected UI immediately but preserves the original actor key",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "失去回應時轉換帳戶部門");
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳錯誤回應替任管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-lost-response-replacement!",
          role: "admin" as const,
          username: `lost.${randomUUID().slice(0, 8)}`,
        };
        const replacementId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        let originalKey = "";
        let submissions = 0;
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await openTask(page, accounts.target);
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              submissions += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const committed = await route.fetch();
              expect(committed.status()).toBe(201);
              arrived.resolve(null);
              await release.promise;
              await route.abort("failed");
            }
          );
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
            .check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await arrived.promise;
          await expectStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          const session = await context.request.get("/api/auth/get-session");
          const sessionBody = await session.json();
          expect(sessionBody.user.id).toBe(replacementId);
          await foregroundTask(page);
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(page.getByText(row.name, { exact: true })).toHaveCount(
            0
          );
          expect(
            await page.evaluate(
              (actorId) =>
                JSON.parse(
                  sessionStorage.getItem(
                    `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
                  ) ?? "null"
                ),
              accounts.actor.userId
            )
          ).toEqual({
            actorUserId: accounts.actor.userId,
            operationKey: originalKey,
          });
          expect(
            await page.evaluate(
              (actorId) =>
                sessionStorage.getItem(
                  `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
                ),
              replacementId
            )
          ).toBeNull();
          release.resolve(null);
          await expectStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: accounts.actor.password,
                username: accounts.actor.username,
              },
            }),
            200
          );
          await page.goto(
            `/roles/people/duties?person=${encodeURIComponent(accounts.target.userId)}`
          );
          const reconciliation = page.waitForRequest((request) =>
            new URL(request.url()).pathname.endsWith(
              "/scoped-department-managers/reconcile"
            )
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const originalRequest = await reconciliation;
          expect(originalRequest.postDataJSON()).toEqual({
            operationKey: originalKey,
          });
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(new URL(page.url()).searchParams.get("person")).toBe(
            accounts.target.userId
          );
          expect(submissions).toBe(1);
          const count = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(count?.count).toBe(1);
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "current Role Assigner enters the focused route and saves grants and exact-witness withdrawals with real receipt and Inbox effects",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().slice(0, 8);
        const staff = {
          email: `scoped.assigner.${suffix}@example.com`,
          fullName: `陳部門委派職員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-scoped-assigner-password!",
          role: "staff" as const,
          username: `scoped.assigner.${suffix}`,
        };
        const staffId = await caseApp.provision.account(staff);
        const row = await department(caseApp, "由現任角色委派員處理的部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const recipient = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          const delegation = await context.request.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId: staffId,
              },
              headers: { "x-efcc-expected-actor-id": accounts.actor.userId },
            }
          );
          expect(delegation.status()).toBe(201);
          const assignment = await caseApp.db
            .prepare(
              "SELECT id FROM role_assigner_assignment WHERE user_id = ?"
            )
            .bind(staffId)
            .first<{ id: string }>();
          expect(assignment?.id).toEqual(expect.any(String));
          await expectStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await signIn(page, staff);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: staff.password,
              },
            }),
            201
          );
          let reviewedWitness: string | null = null;
          const operationKeys: string[] = [];
          const saveDuty = async (action: "granted" | "withdrawn") => {
            const baselineResponse = page.waitForResponse(
              (response) =>
                response.request().method() === "GET" &&
                new URL(response.url()).pathname ===
                  `/api/v2/roles/scoped-department-managers/${accounts.target.userId}`
            );
            await openTask(page, accounts.target);
            const baseline = await baselineResponse;
            expect(baseline.status()).toBe(200);
            expect(
              baseline.request().headers()["x-efcc-expected-actor-id"]
            ).toBe(staffId);
            const baselineBody = await baseline.json();
            expect(baselineBody.data).toMatchObject({
              actorKind: "role-assigner",
              actorUserId: staffId,
              authorityAssignmentId: assignment?.id,
              departments: expect.arrayContaining([
                {
                  assignmentId: reviewedWitness,
                  scopeId: row.id,
                  scopeName: row.name,
                },
              ]),
            });
            const checkbox = page.getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            });
            await expect(checkbox).toBeChecked({
              checked: action === "withdrawn",
            });
            await checkbox.setChecked(action === "granted");
            const saved = page.waitForResponse(
              (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname ===
                  "/api/v2/roles/scoped-department-managers"
            );
            await page
              .getByRole("button", { exact: true, name: "儲存" })
              .click();
            const response = await saved;
            const request = response.request();
            expect(request.headers()["x-efcc-expected-actor-id"]).toBe(staffId);
            const input = request.postDataJSON();
            expect(input).toEqual({
              authorityAssignmentId: assignment?.id,
              changes: [
                action === "granted"
                  ? { action, scopeId: row.id }
                  : {
                      action,
                      expectedAssignmentId: reviewedWitness,
                      scopeId: row.id,
                    },
              ],
              operationKey: expect.any(String),
              targetUserId: accounts.target.userId,
            });
            operationKeys.push(input.operationKey);
            expect(response.status()).toBe(201);
            const receiptBody = await response.json();
            expect(receiptBody.data.receipt).toMatchObject({
              changes: [{ action, scopeId: row.id, scopeName: row.name }],
              targetUserId: accounts.target.userId,
            });
            await expect(page).toHaveURL(/\/roles\/people\?/u);
            expect(new URL(page.url()).searchParams.get("person")).toBe(
              accounts.target.userId
            );
            await expect(
              page.getByRole("heading", {
                exact: true,
                name: accounts.target.fullName,
              })
            ).toBeVisible();
            const current = await caseApp.db
              .prepare(
                "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
              )
              .bind(accounts.target.userId, row.id)
              .first<{ id: string }>();
            if (action === "granted") {
              expect(current?.id).toEqual(expect.any(String));
              reviewedWitness = current?.id ?? null;
            } else {
              expect(current).toBeNull();
            }
          };
          await saveDuty("granted");
          await saveDuty("withdrawn");
          expect(new Set(operationKeys).size).toBe(2);
          const effects = await caseApp.db
            .prepare(
              "SELECT (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history, (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action IN ('department_manager_granted','department_manager_withdrawn')) AS audits, (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key IN (?,?)) AS receipts"
            )
            .bind(
              accounts.target.userId,
              accounts.target.userId,
              staffId,
              operationKeys[0],
              operationKeys[1]
            )
            .first();
          expect(effects).toEqual({ audits: 2, history: 2, receipts: 2 });
          await expectStatus(
            recipient.request.post("/api/auth/sign-in/username", {
              data: {
                password: accounts.target.password,
                username: accounts.target.username,
              },
            }),
            200
          );
          const inbox = await recipient.request.get("/api/v2/inbox");
          expect(inbox.status()).toBe(200);
          const body = await inbox.json();
          expect(body.data.roleChanges).toHaveLength(2);
          expect(body.data.roleChanges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: "granted",
                role: "department_manager",
                scopeName: row.name,
              }),
              expect.objectContaining({
                action: "withdrawn",
                role: "department_manager",
                scopeName: row.name,
              }),
            ])
          );
          expect(JSON.stringify(body)).not.toContain(staffId);
          for (const key of operationKeys) {
            expect(JSON.stringify(body)).not.toContain(key);
          }
        } finally {
          await recipient.close();
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "one explicit Save commits mixed exact-witness changes while reverted and untouched assignments stay unchanged",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const first = await department(caseApp, "甲部門（撤回未提交選擇）");
        const second = await department(caseApp, "乙部門（新增）");
        const third = await department(caseApp, "丙部門（新增）");
        const untouched = await department(caseApp, "丁部門（保留）");
        const witness = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,department_id,user_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(witness, untouched.id, accounts.target.userId)
          .run();
        const withdrawn = await department(caseApp, "戊部門（撤回）");
        const withdrawnWitness = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,department_id,user_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(withdrawnWitness, withdrawn.id, accounts.target.userId)
          .run();
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          const proof = await context.request.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }
          );
          expect(proof.status()).toBe(201);
          await openTask(page, accounts.target);
          const reverted = page.getByRole("checkbox", {
            exact: true,
            name: `部門主管：${first.name}`,
          });
          await reverted.check();
          await reverted.uncheck();
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${second.name}`,
            })
            .check();
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${third.name}`,
            })
            .check();
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${withdrawn.name}`,
            })
            .uncheck();
          const requests: Record<string, unknown>[] = [];
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/scoped-department-managers"
            ) {
              expect(request.headers()["x-efcc-expected-actor-id"]).toBe(
                accounts.actor.userId
              );
              requests.push(request.postDataJSON());
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(new URL(page.url()).searchParams.get("person")).toBe(
            accounts.target.userId
          );
          expect(requests).toHaveLength(1);
          expect(requests[0]?.changes).toEqual(
            expect.arrayContaining([
              { action: "granted", scopeId: second.id },
              { action: "granted", scopeId: third.id },
              {
                action: "withdrawn",
                expectedAssignmentId: withdrawnWitness,
                scopeId: withdrawn.id,
              },
            ])
          );
          expect(requests[0]?.changes).toHaveLength(3);
          const response = await context.request.get(
            `/api/v2/roles/scoped-department-managers/${accounts.target.userId}?page=1`,
            { headers: { "x-efcc-expected-actor-id": accounts.actor.userId } }
          );
          expect(response.status()).toBe(200);
          const body = await response.json();
          expect(body.data.departments).toEqual(
            expect.arrayContaining([
              { assignmentId: null, scopeId: first.id, scopeName: first.name },
              {
                assignmentId: expect.any(String),
                scopeId: second.id,
                scopeName: second.name,
              },
              {
                assignmentId: expect.any(String),
                scopeId: third.id,
                scopeName: third.name,
              },
              {
                assignmentId: witness,
                scopeId: untouched.id,
                scopeName: untouched.name,
              },
              {
                assignmentId: null,
                scopeId: withdrawn.id,
                scopeName: withdrawn.name,
              },
            ])
          );
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toBeVisible();
        } finally {
          await context.close();
        }
      }
    );
    scopedTaskTest(
      "Reset, complete reversion and Keep/Discard never dispatch an unsaved draft",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "可重設部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          let writes = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/scoped-department-managers"
            ) {
              writes += 1;
            }
          });
          await signIn(page, accounts.actor);
          await openTask(page, accounts.target);
          const checkbox = page.getByRole("checkbox", {
            exact: true,
            name: `部門主管：${row.name}`,
          });
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await checkbox.check();
          await checkbox.uncheck();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await checkbox.check();
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(checkbox).not.toBeChecked();
          await checkbox.check();
          await page.getByRole("link", { name: "返回人員權責" }).click();
          await page
            .getByRole("button", { exact: true, name: "繼續編輯" })
            .click();
          await expect(checkbox).toBeChecked();
          await page.getByRole("link", { name: "返回人員權責" }).click();
          await page
            .getByRole("button", { exact: true, name: "放棄變更" })
            .click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(writes).toBe(0);
          const count = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(count?.count).toBe(0);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "expired proof retains reviewed choices and confirmation requires a second explicit Save",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "密碼確認部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await caseApp.db
            .prepare(
              "UPDATE session SET password_confirmed_at = unixepoch() - 601 WHERE user_id = ?"
            )
            .bind(accounts.actor.userId)
            .run();
          await openTask(page, accounts.target);
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
            .check();
          const outcomes: number[] = [];
          page.on("response", (response) => {
            if (
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/scoped-department-managers"
            ) {
              outcomes.push(response.status());
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          const review = dialog.getByRole("region", { name: "這次確認的工作" });
          await expect(
            review.getByRole("term").filter({ hasText: row.name })
          ).toHaveText(`${row.name}：`);
          await expect(
            review.getByRole("definition").filter({ hasText: "新增部門主管" })
          ).toHaveText("新增部門主管");
          await dialog
            .getByRole("textbox", { exact: true, name: "目前密碼" })
            .fill(accounts.actor.password);
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(
            dialog.getByText("伺服器已確認「確認目前密碼」完成。", {
              exact: true,
            })
          ).toBeVisible();
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
          ).toBeChecked();
          expect(outcomes).toEqual([403]);
          const before = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(before?.count).toBe(0);
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(outcomes).toEqual([403, 201]);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "UNKNOWN preserves its original key across target Admin promotion and another opened person, then reconciles without replay and retains current scoped editing capability",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "查核原操作部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await openTask(page, accounts.target);
          let originalKey = "";
          let submissions = 0;
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              submissions += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const committed = await route.fetch();
              expect(committed.status()).toBe(201);
              await route.abort("failed");
            }
          );
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
            .check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          const stored = await page.evaluate(
            (actorId) =>
              JSON.parse(
                sessionStorage.getItem(
                  `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
                ) ?? "null"
              ),
            accounts.actor.userId
          );
          expect(stored).toEqual({
            actorUserId: accounts.actor.userId,
            operationKey: originalKey,
          });
          const promotion = await context.request.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                role: "admin",
                targetUserId: accounts.target.userId,
              },
              headers: { "x-efcc-expected-actor-id": accounts.actor.userId },
            }
          );
          expect(promotion.status()).toBe(201);
          const promoted = await promotion.json();
          expect(promoted.data.receipt).toMatchObject({
            resultingGlobalRole: "admin",
            role: "admin",
            targetUserId: accounts.target.userId,
          });
          await page.reload();
          await expect(page).toHaveURL(/\/roles\/people\/duties\?/u);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          await expect(page.getByText(row.name, { exact: true })).toHaveCount(
            0
          );
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          const otherTargetId = await caseApp.provision.account({
            email: `${randomUUID()}@example.com`,
            fullName: "陳另一部門對象",
            membershipStatus: "active",
            password: "Synthetic-other-scoped-target!",
            role: "member",
            username: `other.${randomUUID().slice(0, 8)}`,
          });
          await page.goto(
            `/roles/people/duties?person=${encodeURIComponent(otherTargetId)}`
          );
          await expect(
            page.getByRole("heading", { exact: true, name: "陳另一部門對象" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          const reconciliation = page.waitForRequest((request) =>
            new URL(request.url()).pathname.endsWith(
              "/scoped-department-managers/reconcile"
            )
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const originalRequest = await reconciliation;
          expect(originalRequest.postDataJSON()).toEqual({
            operationKey: originalKey,
          });
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(new URL(page.url()).searchParams.get("person")).toBe(
            accounts.target.userId
          );
          expect(submissions).toBe(1);
          const count = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(count?.count).toBe(1);
          await page.goto(
            `/roles/people/duties?person=${encodeURIComponent(accounts.target.userId)}`
          );
          await expect(page).toHaveURL(/\/roles\/people\/duties\?/u);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toBeVisible();
          await expect(
            page.getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
          ).toBeChecked();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          expect(submissions).toBe(1);
        } finally {
          await context.close();
        }
      }
    );
    scopedTaskTest(
      "a real concurrent grant rejects the whole batch and old intent is readonly until fresh re-selection",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const first = await department(caseApp, "並行改變部門");
        const second = await department(caseApp, "整批不應新增部門");
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await openTask(page, accounts.target);
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${first.name}`,
            })
            .check();
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${second.name}`,
            })
            .check();
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              const concurrent = await context.request.post(
                "/api/v2/roles/scoped-department-managers",
                {
                  data: {
                    changes: [{ action: "granted", scopeId: first.id }],
                    operationKey: randomUUID(),
                    targetUserId: accounts.target.userId,
                  },
                  headers: {
                    "x-efcc-expected-actor-id": accounts.actor.userId,
                  },
                }
              );
              expect(concurrent.status()).toBe(201);
              const response = await route.fetch();
              expect(response.status()).toBe(409);
              await route.fulfill({ response });
            }
          );
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("heading", { exact: true, name: "上次未儲存的選擇" })
          ).toBeVisible();
          await expect(
            page.getByRole("checkbox", {
              exact: true,
              name: `部門主管：${second.name}`,
            })
          ).toBeDisabled();
          const untouched = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, second.id)
            .first<{ count: number }>();
          expect(untouched?.count).toBe(0);
          await page
            .getByRole("button", { exact: true, name: "按最新職務重新選擇" })
            .click();
          await expect(
            page.getByRole("heading", { exact: true, name: "上次未儲存的選擇" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("checkbox", {
              exact: true,
              name: `部門主管：${first.name}`,
            })
          ).toBeChecked();
          await expect(
            page.getByRole("checkbox", {
              exact: true,
              name: `部門主管：${second.name}`,
            })
          ).not.toBeChecked();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "unloaded pages never appear unchecked; exact net cap allows reversion and preserves choices across pages",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        await seedDepartments(caseApp, "可分頁部門", 28);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await openTask(page, accounts.target);
          const first = page.getByRole("checkbox").nth(0);
          const firstName = "部門主管：可分頁部門00";
          await expect(
            page.getByRole("checkbox", { exact: true, name: firstName })
          ).not.toBeChecked();
          await page.getByRole("checkbox").nth(0).check();
          await page.getByRole("checkbox").nth(1).check();
          await page.getByRole("checkbox").nth(2).check();
          await page.getByRole("checkbox").nth(3).check();
          await expect(page.getByRole("checkbox").nth(4)).toBeDisabled();
          await first.uncheck();
          await expect(page.getByRole("checkbox").nth(4)).toBeEnabled();
          const { promise: gate, resolve: release } =
            Promise.withResolvers<null>();
          await page.route(
            `**/scoped-department-managers/${accounts.target.userId}?page=2`,
            async (route) => {
              await gate;
              await route.continue();
            }
          );
          await page
            .getByRole("button", { exact: true, name: "下一頁部門" })
            .click();
          await expect(
            page.getByText("正在讀取部門職務…", { exact: true })
          ).toBeVisible();
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeDisabled();
          release(null);
          await expect(page.getByRole("checkbox").first()).toBeVisible();
          await expect(page.getByRole("checkbox")).toHaveCount(3);
          await page
            .getByRole("button", { exact: true, name: "上一頁部門" })
            .click();
          await expect(
            page.getByRole("checkbox", { exact: true, name: firstName })
          ).not.toBeChecked();
          await expect(page.getByRole("checkbox").nth(1)).toBeChecked();
          await expect(page.getByRole("checkbox").nth(2)).toBeChecked();
          await expect(page.getByRole("checkbox").nth(3)).toBeChecked();
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "pending command is actor-fenced after authentication replacement without effects or replacement replay",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const row = await department(caseApp, "登入轉換部門");
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳替任管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-replacement-scoped-password!",
          role: "admin" as const,
          username: `replacement.${randomUUID().slice(0, 8)}`,
        };
        const replacementId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await expectStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: accounts.actor.password,
              },
            }),
            201
          );
          await openTask(page, accounts.target);
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              arrived.resolve(null);
              await release.promise;
              const headers = await route.request().allHeaders();
              expect(headers["x-efcc-expected-actor-id"]).toBe(
                accounts.actor.userId
              );
              delete headers.cookie;
              const response = await context.request.post(
                route.request().url(),
                { data: route.request().postDataBuffer() ?? undefined, headers }
              );
              expect(response.status()).toBe(409);
              const body = await response.json();
              expect(body.error.code).toBe("actor_changed");
              await route.fulfill({ response });
            }
          );
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `部門主管：${row.name}`,
            })
            .check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await arrived.promise;
          await expectStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          const session = await context.request.get("/api/auth/get-session");
          const sessionBody = await session.json();
          expect(sessionBody.user.id).toBe(replacementId);
          release.resolve(null);
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          const count = await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(accounts.target.userId, row.id)
            .first<{ count: number }>();
          expect(count?.count).toBe(0);
          await expect
            .poll(() =>
              page.evaluate(
                (actorId) =>
                  sessionStorage.getItem(
                    `efcc.scoped-role.operation.v1:${encodeURIComponent(actorId)}`
                  ),
                accounts.actor.userId
              )
            )
            .toBeNull();
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "shared actions stay outside one natural scroller at phone, tablet, desktop and reduced-height 200% text",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }, testInfo) => {
        await seedDepartments(caseApp, "長部門名稱供最後欄位測試", 15);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          await openTask(page, accounts.target);
          await page.getByRole("checkbox").first().check();
          const last = page.getByRole("checkbox").last();
          await qualifyPresentation(page, testInfo, "scoped-role-task", {
            criticalAction: page.getByRole("button", {
              exact: true,
              name: "儲存",
            }),
            drafts: page.locator("input"),
            focus: last,
          });
          const assertGeometry = async (viewport: {
            height: number;
            width: number;
          }) => {
            await page.setViewportSize(viewport);
            await page.evaluate(() => {
              document.documentElement.style.fontSize = "200%";
            });
            const footer = page.getByRole("contentinfo", { name: "任務操作" });
            await expect
              .poll(async () => {
                const bounds = await footer.boundingBox();
                return bounds
                  ? Math.abs(bounds.y + bounds.height - viewport.height)
                  : Number.POSITIVE_INFINITY;
              })
              .toBeLessThanOrEqual(1);
            await last.focus();
            await expect(last).toBeFocused();
            await expect
              .poll(async () => {
                const field = await last.boundingBox();
                const actions = await footer.boundingBox();
                return field && actions
                  ? field.y + field.height - actions.y
                  : Number.POSITIVE_INFINITY;
              })
              .toBeLessThanOrEqual(1);
            await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
          };
          await assertGeometry({ height: 480, width: 320 });
          await assertGeometry({ height: 600, width: 768 });
          await assertGeometry({ height: 720, width: 1280 });
        } finally {
          await context.close();
        }
      }
    );

    scopedTaskTest(
      "unavailable baseline stays non-editable and a late original-actor read cannot restore protected labels",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        await department(caseApp, "延後讀取部門");
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳讀取替任管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-read-replacement-password!",
          role: "admin" as const,
          username: `reader.${randomUUID().slice(0, 8)}`,
        };
        await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        try {
          const page = await context.newPage();
          await signIn(page, accounts.actor);
          let reads = 0;
          await page.route(
            `**/scoped-department-managers/${accounts.target.userId}?page=1`,
            async (route) => {
              reads += 1;
              if (reads === 1) {
                await route.abort("failed");
                return;
              }
              const response = await route.fetch();
              expect(response.status()).toBe(200);
              arrived.resolve(null);
              await release.promise;
              await route.fulfill({ response });
            }
          );
          await openTask(page, accounts.target);
          await expect(page.getByRole("alert")).toContainText(
            "未讀取的部門不能編輯"
          );
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "重新讀取部門職務" })
            .click();
          await arrived.promise;
          await expectStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          release.resolve(null);
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: accounts.target.fullName,
            })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );
  }
);
