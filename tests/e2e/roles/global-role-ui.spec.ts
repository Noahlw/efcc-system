import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const globalRoleUiTest = dedicatedTest.extend<{
  admin: {
    password: string;
    userId: string;
    username: string;
  };
}>({
  admin: async ({ caseApp }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const admin = {
      email: `${suffix}@example.com`,
      fullName: `陳全域管理員${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-global-role-admin-password!",
      role: "admin" as const,
      username: `global.admin.${suffix}`,
    };
    const userId = await caseApp.provision.account(admin);
    await use({ ...admin, userId });
  },
});

const signInAdmin = async (page: Page, username: string, password: string) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByRole("textbox", { name: "密碼" }).fill(password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};

globalRoleUiTest.describe(
  "Admin Global Role journey",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  () => {
    globalRoleUiTest(
      "an Admin can find one Member and review the safe Global Role record",
      async ({ admin, browser, caseApp, extraHTTPHeaders }, testInfo) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳全域受管理${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-member-password!",
          role: "member" as const,
          username: `global.member.${suffix}`,
        };
        await caseApp.provision.account(target);

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managementEntry = page.getByRole("link", {
            name: /全域角色/u,
          });
          await expect(managementEntry).toBeVisible();
          await expect(managementEntry).toHaveAttribute(
            "href",
            "/staff/roles/global-roles"
          );
          await managementEntry.click();
          await expect(page).toHaveURL(/\/staff\/roles\/global-roles$/u);

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const targetButton = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(targetButton).toBeVisible();
          await targetButton.click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          await expect(
            personRegion.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toBeVisible();
          await expect(
            personRegion.getByText("會員", { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);

          const presentation = {
            criticalAction: page.getByRole("button", {
              exact: true,
              name: "搜尋",
            }),
            drafts: page.locator("input"),
            focus: search,
            masks: [
              search,
              targetButton,
              personRegion.getByRole("heading", {
                exact: true,
                name: target.fullName,
              }),
              personRegion.getByText(target.username, { exact: true }),
            ],
          };
          await qualifyPresentation(page, testInfo, "phone", presentation);
          await qualifyPresentation(page, testInfo, "desktop", presentation);
        } finally {
          await context.close();
        }
      }
    );

    globalRoleUiTest(
      "an Admin grant completes, clears the selected person and keeps the actor session",
      { tag: ["@risk-resilience"] },
      async ({ admin, browser, caseApp, extraHTTPHeaders }, testInfo) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}.admin-ack@example.com`,
          fullName: `陳管理員確認${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-admin-ack-password!",
          role: "member" as const,
          username: `global.admin.ack.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const mutationBodies: Record<string, unknown>[] = [];
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/roles/global-roles");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const targetButton = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(targetButton).toBeVisible();
          await targetButton.click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          await expect(
            personRegion.getByText("會員", { exact: true })
          ).toBeVisible();
          const grantAdmin = page.getByRole("button", {
            exact: true,
            name: "設為管理員",
          });
          await expect(grantAdmin).toBeEnabled();
          await grantAdmin.click();

          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          const password = page.getByLabel("目前密碼", { exact: true });
          await expect(password).toHaveValue("");
          await password.fill(admin.password);
          const confirmAdmin = page.getByRole("button", {
            exact: true,
            name: "確認並設為管理員",
          });
          await expect(confirmAdmin).toBeEnabled();
          await page.route("**/api/v2/roles/global-roles**", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
              request.method() === "POST" &&
              url.pathname === "/api/v2/roles/global-roles"
            ) {
              mutationBodies.push(
                request.postDataJSON() as Record<string, unknown>
              );
            }
            await route.continue();
          });
          const mutationResponsePromise = page.waitForResponse((response) => {
            const request = response.request();
            return (
              request.method() === "POST" &&
              new URL(response.url()).pathname === "/api/v2/roles/global-roles"
            );
          });
          await confirmAdmin.click();
          const mutationResponse = await mutationResponsePromise;
          expect(mutationResponse.status()).toBe(201);
          expect(mutationBodies).toHaveLength(1);
          expect(mutationBodies[0]).toMatchObject({
            action: "granted",
            role: "admin",
            targetUserId,
          });
          expect(await mutationResponse.json()).toMatchObject({
            data: {
              receipt: {
                action: "granted",
                resultingGlobalRole: "admin",
                role: "admin",
                targetUserId,
              },
            },
          });

          const acknowledgement = page.getByRole("status");
          await expect(acknowledgement).toContainText(
            "管理員身份已新增；其現有登入工作階段已全部結束。"
          );
          await expect(
            page.getByRole("region", { name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toHaveCount(0);
          await expect(password).toHaveCount(0);
          await expect(grantAdmin).toHaveCount(0);

          const actorRead = await page.request.get(
            "/api/v2/roles/global-roles?q=&page=1"
          );
          expect(actorRead.status()).toBe(200);
          expect(await actorRead.json()).toMatchObject({
            data: { actorUserId: admin.userId },
          });
          const committed = await caseApp.db
            .prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS targetRole,
                (SELECT COUNT(*) FROM session WHERE user_id = ?) AS targetSessions,
                (SELECT COUNT(*) FROM session WHERE user_id = ?) AS grantorSessions`
            )
            .bind(targetUserId, targetUserId, admin.userId)
            .first<{
              grantorSessions: number;
              targetRole: string;
              targetSessions: number;
            }>();
          expect(committed).toMatchObject({
            targetRole: "admin",
            targetSessions: 0,
          });
          expect(committed?.grantorSessions).toBeGreaterThan(0);

          const presentation = {
            criticalAction: acknowledgement,
            drafts: page.locator("input"),
            masks: [search],
          };
          await qualifyPresentation(
            page,
            testInfo,
            "admin-grant-ack-phone",
            presentation
          );
          await qualifyPresentation(
            page,
            testInfo,
            "admin-grant-ack-desktop",
            presentation
          );
        } finally {
          await context.close();
        }
      }
    );

    globalRoleUiTest(
      "an Admin can grant Admin and reconcile the exact receipt after Worker reload",
      { tag: ["@risk-resilience"] },
      async (
        { admin, browser, caseApp, extraHTTPHeaders, playwright },
        testInfo
      ) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}.admin-grant@example.com`,
          fullName: `陳新增管理員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-admin-grant-password!",
          role: "member" as const,
          username: `global.admin.grant.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const nextAdmin = {
          email: `${suffix}.next-admin@example.com`,
          fullName: `陳轉換管理員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-next-admin-password!",
          role: "admin" as const,
          username: `global.admin.next.${suffix}`,
        };
        const nextAdminUserId = await caseApp.provision.account(nextAdmin);
        const actorAHeaders = {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.0.10",
        };
        const actorBHeaders = {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.0.11",
        };
        const recipientHeaders = {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.0.12",
        };
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: recipientHeaders,
        });
        const nextSession = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: actorBHeaders,
        });
        const actorASession = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: actorAHeaders,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: actorAHeaders,
        });
        const mutationBodies: Record<string, unknown>[] = [];
        const reconcileBodies: Record<string, unknown>[] = [];
        const mutationResponseGate = Promise.withResolvers<null>();
        const committedMutation = Promise.withResolvers<{
          operationKey: string;
          status: number;
        }>();
        const deliveredMutation = Promise.withResolvers<null>();
        const appActorProbe = Promise.withResolvers<{
          actorUserId: string | null;
          status: number;
        }>();
        let expectActorProbe = false;
        let commandCaptured = false;
        try {
          const memberLogin = await recipient.post(
            "/api/auth/sign-in/username",
            { data: { password: target.password, username: target.username } }
          );
          expect(memberLogin.status()).toBe(200);
          const recipientInbox = await recipient.get("/api/v2/inbox");
          expect(recipientInbox.status()).toBe(200);
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM session WHERE user_id = ?"
              )
              .bind(targetUserId)
              .first()
          ).toEqual({ count: 1 });

          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/roles/global-roles");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const targetButton = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(targetButton).toBeVisible();
          await targetButton.click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          await expect(
            personRegion.getByText("會員", { exact: true })
          ).toBeVisible();
          const grantAdmin = page.getByRole("button", {
            exact: true,
            name: "設為管理員",
          });
          await expect(grantAdmin).toBeVisible();
          await expect(grantAdmin).toBeEnabled();
          await grantAdmin.click();

          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await expect(
            page.getByText(
              `確定將「${target.fullName}」的全域身份改為管理員？其現有登入工作階段將全部結束。`,
              { exact: true }
            )
          ).toBeVisible();
          const password = page.getByLabel("目前密碼", { exact: true });
          const confirmAdmin = page.getByRole("button", {
            exact: true,
            name: "確認並設為管理員",
          });
          await expect(password).toHaveValue("");
          await expect(confirmAdmin).toBeDisabled();

          const presentation = {
            criticalAction: confirmAdmin,
            drafts: page.locator("input"),
            focus: password,
            masks: [
              search,
              personRegion.getByRole("heading", {
                exact: true,
                name: target.fullName,
              }),
              personRegion.getByText(target.username, { exact: true }),
            ],
          };
          await qualifyPresentation(page, testInfo, "phone", presentation);
          await qualifyPresentation(page, testInfo, "desktop", presentation);

          await page.route("**/api/v2/roles/global-roles**", async (route) => {
            const request = route.request();
            const requestUrl = new URL(request.url());
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/global-roles/reconcile"
            ) {
              reconcileBodies.push(
                request.postDataJSON() as Record<string, unknown>
              );
              await route.continue();
              return;
            }
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/global-roles"
            ) {
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              mutationBodies.push(body);
              if (!commandCaptured) {
                commandCaptured = true;
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                committedMutation.resolve({
                  operationKey: body.operationKey,
                  status: response.status(),
                });
                await mutationResponseGate.promise;
                await route.fulfill({ response });
                deliveredMutation.resolve(null);
                return;
              }
            }
            if (
              expectActorProbe &&
              request.method() === "GET" &&
              requestUrl.pathname === "/api/v2/roles/global-roles" &&
              requestUrl.searchParams.get("q") === ""
            ) {
              expectActorProbe = false;
              const response = await route.fetch();
              const body = (await response.json()) as {
                data?: { actorUserId?: string };
              };
              appActorProbe.resolve({
                actorUserId: body.data?.actorUserId ?? null,
                status: response.status(),
              });
              await route.fulfill({ response });
              return;
            }
            await route.continue();
          });

          await password.fill(admin.password);
          await expect(confirmAdmin).toBeEnabled();
          await confirmAdmin.click();
          const committedMutationResult = await committedMutation.promise;
          expect(committedMutationResult.status).toBe(201);
          expect(mutationBodies).toHaveLength(1);
          expect(mutationBodies[0]).toMatchObject({
            action: "granted",
            role: "admin",
            targetUserId,
          });
          const { operationKey } = committedMutationResult;
          expect(operationKey).toMatch(/^[0-9a-f-]{36}$/iu);

          const operationStorageKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
          const storedOperation = await page.evaluate((key) => {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }, operationStorageKey);
          expect(storedOperation).toEqual({
            actorUserId: admin.userId,
            operationKey,
          });

          const priorWorker = caseApp.harness.getWorker<{
            BETTER_AUTH_SECRET: string;
            DB: NativeApp["db"];
          }>("efcc-system");
          const priorEnvironment = await priorWorker.getEnv();
          expect(
            await priorEnvironment.DB.prepare(
              "SELECT COUNT(*) AS count FROM session WHERE user_id = ?"
            )
              .bind(targetUserId)
              .first()
          ).toEqual({ count: 0 });

          const nextLogin = await nextSession.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: nextAdmin.password,
                username: nextAdmin.username,
              },
            }
          );
          expect(nextLogin.status()).toBe(200);
          await context.clearCookies();
          const nextSessionState = await nextSession.storageState();
          await context.addCookies(nextSessionState.cookies);
          const directActorResponse = await page.request.get(
            "/api/v2/roles/global-roles?page=1&q="
          );
          expect(directActorResponse.status()).toBe(200);
          expect(await directActorResponse.json()).toMatchObject({
            data: { actorUserId: nextAdminUserId },
          });

          expectActorProbe = true;
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          expect(await appActorProbe.promise).toEqual({
            actorUserId: nextAdminUserId,
            status: 200,
          });
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("button", {
              name: new RegExp(target.fullName, "u"),
            })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toHaveCount(0);
          await expect(password).toHaveCount(0);
          expect(reconcileBodies).toEqual([]);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              operationStorageKey
            )
          ).toBe(JSON.stringify(storedOperation));
          const nextActorStorageKey = `efcc.global-role.operation.v1:${encodeURIComponent(nextAdminUserId)}`;
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              nextActorStorageKey
            )
          ).toBeNull();

          const mutationResponsePromise = page.waitForResponse((response) => {
            const request = response.request();
            return (
              request.method() === "POST" &&
              new URL(response.url()).pathname === "/api/v2/roles/global-roles"
            );
          });
          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          const mutationResponse = await mutationResponsePromise;
          expect(mutationResponse.status()).toBe(201);
          expect(mutationBodies).toHaveLength(1);
          await expect(
            page.getByText("管理員身份已新增", { exact: false })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toHaveCount(0);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              operationStorageKey
            )
          ).toBe(JSON.stringify(storedOperation));
          const adminTargetDetail = await page.request.get(
            `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
          );
          expect(adminTargetDetail.status()).toBe(404);

          const marker = randomUUID();
          await caseApp.harness.update((current) => {
            const [primary, ...remaining] = current.workers;
            if (!primary || !("configPath" in primary)) {
              throw new Error(
                "Native app primary worker config is unavailable"
              );
            }
            return {
              ...current,
              workers: [
                {
                  ...primary,
                  vars: { ...primary.vars, T5_ADMIN_RELOAD_MARKER: marker },
                },
                ...remaining,
              ],
            };
          });
          const updatedWorker = caseApp.harness.getWorker<{
            BETTER_AUTH_SECRET: string;
            DB: NativeApp["db"];
            T5_ADMIN_RELOAD_MARKER: string;
          }>("efcc-system");
          const updatedEnvironment = await updatedWorker.getEnv();
          expect(updatedEnvironment.T5_ADMIN_RELOAD_MARKER).toBe(marker);
          expect(
            updatedEnvironment.BETTER_AUTH_SECRET ===
              priorEnvironment.BETTER_AUTH_SECRET
          ).toBe(true);
          const committed = await updatedEnvironment.DB.prepare(
            `SELECT
              (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
              (SELECT COUNT(*) FROM session WHERE user_id = ?) AS sessions,
              (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'admin' AND action = 'granted' AND resulting_global_role = 'admin') AS history,
              (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS audits,
              (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'admin' AND action = 'granted' AND resulting_global_role = 'admin' AND operation_key = ?) AS receipts`
          )
            .bind(
              targetUserId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              operationKey
            )
            .first();
          expect(committed).toEqual({
            audits: 1,
            history: 1,
            receipts: 1,
            role: "admin",
            sessions: 0,
          });
          const durableReceipt = await updatedEnvironment.DB.prepare(
            `SELECT action, role, operation_key AS operationKey,
                    resulting_global_role AS resultingGlobalRole,
                    target_user_id AS targetUserId
             FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?`
          )
            .bind(admin.userId, operationKey)
            .first<Record<string, unknown>>();
          expect(durableReceipt).toEqual({
            action: "granted",
            operationKey,
            resultingGlobalRole: "admin",
            role: "admin",
            targetUserId,
          });
          const revokedRecipientInbox = await recipient.get("/api/v2/inbox");
          expect(revokedRecipientInbox.status()).toBe(401);

          const actorALogin = await actorASession.post(
            "/api/auth/sign-in/username",
            { data: { password: admin.password, username: admin.username } }
          );
          expect(actorALogin.status()).toBe(200);
          await context.clearCookies();
          const actorASessionState = await actorASession.storageState();
          await context.addCookies(actorASessionState.cookies);
          await page.reload();
          const reconcile = page.getByRole("button", {
            exact: true,
            name: "查核操作結果",
          });
          await expect(reconcile).toBeVisible();
          await expect(
            page.getByRole("region", { name: /待查核的/u })
          ).toContainText("操作結果未能確認");
          const reconcileResponsePromise = page.waitForResponse((response) => {
            const request = response.request();
            return (
              request.method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/global-roles/reconcile"
            );
          });
          await reconcile.click();
          const reconcileResponse = await reconcileResponsePromise;
          expect(reconcileResponse.status()).toBe(200);
          const reconciliation = (await reconcileResponse.json()) as {
            data?: {
              outcome?: string;
              receipt?: Record<string, unknown> | null;
            };
          };
          expect(reconciliation.data).toMatchObject({
            outcome: "committed",
            receipt: {
              action: "granted",
              resultingGlobalRole: "admin",
              role: "admin",
              targetUserId,
            },
          });
          await expect(page.getByRole("status")).toContainText(
            "管理員身份已新增；其現有登入工作階段已全部結束。"
          );
          expect(reconcileBodies).toEqual([{ operationKey }]);
          expect(mutationBodies).toHaveLength(1);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              operationStorageKey
            )
          ).toBeNull();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toHaveCount(0);
          await expect(
            page.getByRole("region", { name: target.fullName })
          ).toHaveCount(0);
          await expect(grantAdmin).toHaveCount(0);

          expect(
            await updatedEnvironment.DB.prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'admin' AND action = 'granted' AND resulting_global_role = 'admin') AS history,
                (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'admin' AND action = 'granted' AND resulting_global_role = 'admin' AND operation_key = ?) AS receipts`
            )
              .bind(
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                operationKey
              )
              .first()
          ).toEqual({ audits: 1, history: 1, receipts: 1, role: "admin" });
        } finally {
          mutationResponseGate.resolve(null);
          await context.close();
          await nextSession.dispose();
          await actorASession.dispose();
          await recipient.dispose();
        }
      }
    );

    globalRoleUiTest(
      "an Admin can delegate Role Assigner to an eligible Staff account",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳角色委派${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-staff-password!",
          role: "staff" as const,
          username: `global.ra.${suffix}`,
        };
        await caseApp.provision.account(target);

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managementEntry = page.getByRole("link", {
            name: /全域角色/u,
          });
          await expect(managementEntry).toHaveAttribute(
            "href",
            "/staff/roles/global-roles"
          );
          await managementEntry.click();

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          await expect(
            personRegion.getByText("職員", { exact: true })
          ).toBeVisible();
          await expect(
            personRegion.getByText("未委派", { exact: true })
          ).toBeVisible();

          const grantRoleAssigner = page.getByRole("button", {
            exact: true,
            name: "委派 Role Assigner",
          });
          await expect(grantRoleAssigner).toBeVisible();
          await expect(grantRoleAssigner).toBeEnabled();
          await grantRoleAssigner.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並委派" })
            .click();

          await expect(
            personRegion.getByText("已委派", { exact: true })
          ).toBeVisible();
        } finally {
          await context.close();
        }
      }
    );

    globalRoleUiTest(
      "an Admin can review and withdraw Role Assigner with current password confirmation",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳撤回委派${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-withdrawal-password!",
          role: "staff" as const,
          username: `global.rw.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managementEntry = page.getByRole("link", {
            name: /全域角色/u,
          });
          await expect(managementEntry).toHaveAttribute(
            "href",
            "/staff/roles/global-roles"
          );
          await managementEntry.click();
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          const grantRoleAssigner = page.getByRole("button", {
            exact: true,
            name: "委派 Role Assigner",
          });
          await expect(grantRoleAssigner).toBeVisible();
          await expect(grantRoleAssigner).toBeEnabled();
          await grantRoleAssigner.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並委派" })
            .click();
          await expect(
            personRegion.getByText("已委派", { exact: true })
          ).toBeVisible();

          const assignment = await caseApp.db
            .prepare(
              "SELECT id FROM role_assigner_assignment WHERE user_id = ?"
            )
            .bind(targetUserId)
            .first<{ id: string }>();
          expect(assignment?.id).toBeTruthy();
          const withdrawRoleAssigner = page.getByRole("button", {
            exact: true,
            name: "撤回 Role Assigner",
          });
          await expect(withdrawRoleAssigner).toBeVisible();
          await expect(withdrawRoleAssigner).toBeEnabled();
          await withdrawRoleAssigner.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await expect(
            page.getByText(
              `確定要撤回「${target.fullName}」的 Role Assigner 職務？`,
              { exact: true }
            )
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並撤回" })
            .click();
          await expect(
            personRegion.getByText("未委派", { exact: true })
          ).toBeVisible();
          await expect(withdrawRoleAssigner).toHaveCount(0);

          expect(
            await caseApp.db
              .prepare(
                `SELECT
                  (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS assignments,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'role_assigner') AS history,
                  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('role_assigner_granted','role_assigner_withdrawn')) AS audits,
                  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'role_assigner') AS receipts`
              )
              .bind(
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId
              )
              .first()
          ).toEqual({ assignments: 0, audits: 2, history: 2, receipts: 2 });
        } finally {
          await context.close();
        }
      }
    );

    globalRoleUiTest(
      "an Admin can promote an eligible Member to Staff and the new Staff can use account tools",
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳新職員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-member-password!",
          role: "member" as const,
          username: `global.staff.${suffix}`,
        };
        await caseApp.provision.account(target);

        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const memberLogin = await recipient.post(
            "/api/auth/sign-in/username",
            { data: { password: target.password, username: target.username } }
          );
          expect(memberLogin.status()).toBe(200);
          const memberStaffTools = await recipient.get(
            "/api/v2/staff/accounts"
          );
          expect(memberStaffTools.status()).toBe(403);

          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managementEntry = page.getByRole("link", {
            name: /全域角色/u,
          });
          await expect(managementEntry).toHaveAttribute(
            "href",
            "/staff/roles/global-roles"
          );
          await managementEntry.click();

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          await expect(
            personRegion.getByText("會員", { exact: true })
          ).toBeVisible();
          const promote = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promote).toBeVisible();
          await expect(promote).toBeEnabled();
          await promote.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並設為職員" })
            .click();

          await expect(
            personRegion.getByText("職員", { exact: true })
          ).toBeVisible();
          const promotedStaffTools = await recipient.get(
            "/api/v2/staff/accounts"
          );
          expect(promotedStaffTools.status()).toBe(200);
        } finally {
          await context.close();
          await recipient.dispose();
        }
      }
    );

    globalRoleUiTest(
      "an Admin can exit Staff with Role Assigner and re-entry never restores delegation",
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳退出及重返${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-role-exit-member-password!",
          role: "member" as const,
          username: `global.exit.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);

        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const memberLogin = await recipient.post(
            "/api/auth/sign-in/username",
            { data: { password: target.password, username: target.username } }
          );
          expect(memberLogin.status()).toBe(200);

          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managementEntry = page.getByRole("link", {
            name: /全域角色/u,
          });
          await expect(managementEntry).toHaveAttribute(
            "href",
            "/staff/roles/global-roles"
          );
          await managementEntry.click();

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const targetButton = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(targetButton).toBeVisible();
          await targetButton.click();

          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          const promote = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promote).toBeVisible();
          await expect(promote).toBeEnabled();
          await promote.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並設為職員" })
            .click();
          await expect(
            personRegion.getByText("職員", { exact: true })
          ).toBeVisible();

          const staffTools = await recipient.get("/api/v2/staff/accounts");
          expect(staffTools.status()).toBe(200);

          const delegate = page.getByRole("button", {
            exact: true,
            name: "委派 Role Assigner",
          });
          await expect(delegate).toBeVisible();
          await expect(delegate).toBeEnabled();
          await delegate.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並委派" })
            .click();
          await expect(
            personRegion.getByText("已委派", { exact: true })
          ).toBeVisible();
          const delegated = await caseApp.db
            .prepare(
              "SELECT id FROM role_assigner_assignment WHERE user_id = ?"
            )
            .bind(targetUserId)
            .first<{ id: string }>();
          expect(delegated?.id).toBeTruthy();

          const demote = page.getByRole("button", {
            exact: true,
            name: "改為會員",
          });
          await expect(demote).toBeVisible();
          await expect(demote).toBeEnabled();
          await demote.click();
          await expect(
            page.getByText("此操作亦會撤回其 Role Assigner 委派。", {
              exact: true,
            })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並改為會員" })
            .click();
          await expect(
            personRegion.getByText("會員", { exact: true })
          ).toBeVisible();
          await expect(
            personRegion.getByText("未委派", { exact: true })
          ).toBeVisible();
          const staffAfterExit = await recipient.get("/api/v2/staff/accounts");
          expect(staffAfterExit.status()).toBe(403);
          const noDelegationAfterExit = await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM role_assigner_assignment WHERE user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          expect(noDelegationAfterExit).toEqual({ count: 0 });

          const promoteAgain = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promoteAgain).toBeVisible();
          await expect(promoteAgain).toBeEnabled();
          await promoteAgain.click();
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並設為職員" })
            .click();
          await expect(
            personRegion.getByText("職員", { exact: true })
          ).toBeVisible();
          await expect(
            personRegion.getByText("未委派", { exact: true })
          ).toBeVisible();
          const staffAfterReentry = await recipient.get(
            "/api/v2/staff/accounts"
          );
          expect(staffAfterReentry.status()).toBe(200);
          const noDelegationAfterReentry = await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM role_assigner_assignment WHERE user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          expect(noDelegationAfterReentry).toEqual({ count: 0 });
        } finally {
          await context.close();
          await recipient.dispose();
        }
      }
    );

    globalRoleUiTest(
      "changing the selected person discards the reviewed Staff action and password",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const firstTarget = {
          email: `${suffix}.first@example.com`,
          fullName: `陳第一全域目標${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-first-member-password!",
          role: "member" as const,
          username: `global.first.${suffix}`,
        };
        const secondTarget = {
          email: `${suffix}.second@example.com`,
          fullName: `陳第二全域目標${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-second-member-password!",
          role: "member" as const,
          username: `global.second.${suffix}`,
        };
        const firstTargetUserId = await caseApp.provision.account(firstTarget);
        const secondTargetUserId =
          await caseApp.provision.account(secondTarget);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const roleWriteRequests: string[] = [];
        try {
          const page = await context.newPage();
          page.on("request", (request) => {
            const { pathname } = new URL(request.url());
            if (
              request.method() === "POST" &&
              [
                "/api/v2/account/password-confirmation",
                "/api/v2/roles/global-roles",
                "/api/v2/roles/role-assigners",
              ].includes(pathname)
            ) {
              roleWriteRequests.push(pathname);
            }
          });
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managementEntry = page.getByRole("link", {
            name: /全域角色/u,
          });
          await expect(managementEntry).toHaveAttribute(
            "href",
            "/staff/roles/global-roles"
          );
          await managementEntry.click();

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          const findTarget = async (target: typeof firstTarget) => {
            await search.fill(target.username);
            await page
              .getByRole("button", { exact: true, name: "搜尋" })
              .click();
            const targetButton = page.getByRole("button", {
              name: new RegExp(target.fullName, "u"),
            });
            await expect(targetButton).toBeVisible();
            await targetButton.click();
            const personRegion = page.getByRole("region", {
              name: target.fullName,
            });
            await expect(
              personRegion.getByRole("heading", {
                exact: true,
                name: target.fullName,
              })
            ).toBeVisible();
            return personRegion;
          };

          await findTarget(firstTarget);
          const promoteFirstTarget = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promoteFirstTarget).toBeVisible();
          await expect(promoteFirstTarget).toBeEnabled();
          await promoteFirstTarget.click();
          await expect(
            page.getByText(
              `確定將「${firstTarget.fullName}」的全域身份改為職員？`,
              { exact: true }
            )
          ).toBeVisible();
          await page.getByLabel("目前密碼").fill(admin.password);
          await expect(page.getByLabel("目前密碼")).toHaveValue(admin.password);

          const secondTargetRegion = await findTarget(secondTarget);
          await expect(
            secondTargetRegion.getByText("會員", { exact: true })
          ).toBeVisible();
          expect(roleWriteRequests).toEqual([]);
          const unchangedEffects = await caseApp.db
            .prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS firstRole,
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS secondRole,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id IN (?, ?) AND role IN ('staff', 'role_assigner')) AS history,
                (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id IN (?, ?) AND action IN ('global_role_changed', 'role_assigner_granted', 'role_assigner_withdrawn')) AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id IN (?, ?)) AS receipts`
            )
            .bind(
              firstTargetUserId,
              secondTargetUserId,
              firstTargetUserId,
              secondTargetUserId,
              admin.userId,
              firstTargetUserId,
              secondTargetUserId,
              admin.userId,
              firstTargetUserId,
              secondTargetUserId
            )
            .first();
          expect(unchangedEffects).toEqual({
            audits: 0,
            firstRole: "member",
            history: 0,
            receipts: 0,
            secondRole: "member",
          });

          await expect(
            page.getByText(
              `確定將「${secondTarget.fullName}」的全域身份改為職員？`,
              { exact: true }
            )
          ).toHaveCount(0);
          await expect(page.getByLabel("目前密碼")).toHaveCount(0);

          const promoteSecondTarget = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promoteSecondTarget).toBeVisible();
          await promoteSecondTarget.click();
          await expect(
            page.getByText(
              `確定將「${secondTarget.fullName}」的全域身份改為職員？`,
              { exact: true }
            )
          ).toBeVisible();
          const freshPassword = page.getByLabel("目前密碼");
          await expect(freshPassword).toHaveValue("");
          const confirmSecondTarget = page.getByRole("button", {
            exact: true,
            name: "確認並設為職員",
          });
          await expect(confirmSecondTarget).toBeDisabled();
          await freshPassword.fill(admin.password);
          await expect(confirmSecondTarget).toBeEnabled();
          expect(roleWriteRequests).toEqual([]);
          const effectsBeforeFreshSubmit = await caseApp.db
            .prepare(
              "SELECT (SELECT account_role FROM person_profile WHERE user_id = ?) AS role, (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'staff') AS history, (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS audits, (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff') AS receipts"
            )
            .bind(
              secondTargetUserId,
              secondTargetUserId,
              admin.userId,
              secondTargetUserId,
              admin.userId,
              secondTargetUserId
            )
            .first();
          expect(effectsBeforeFreshSubmit).toEqual({
            audits: 0,
            history: 0,
            receipts: 0,
            role: "member",
          });
        } finally {
          await context.close();
        }
      }
    );

    globalRoleUiTest(
      "recovers a committed Staff promotion after its response is lost and the page reloads",
      { tag: ["@risk-resilience"] },
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}.lost@example.com`,
          fullName: `陳遺失回應職員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-lost-response-password!",
          role: "member" as const,
          username: `global.lost.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const mutationOperationKeys: string[] = [];
        const reconciledOperationKeys: string[] = [];
        let lostMutationResponse = false;
        try {
          const memberLogin = await recipient.post(
            "/api/auth/sign-in/username",
            { data: { password: target.password, username: target.username } }
          );
          expect(memberLogin.status()).toBe(200);

          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/roles/global-roles");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          const personRegion = page.getByRole("region", {
            name: target.fullName,
          });
          await expect(
            personRegion.getByText("會員", { exact: true })
          ).toBeVisible();

          await page.route("**/api/v2/roles/global-roles**", async (route) => {
            const request = route.request();
            const requestUrl = new URL(request.url());
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/global-roles/reconcile"
            ) {
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              reconciledOperationKeys.push(body.operationKey);
              await route.continue();
              return;
            }
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/global-roles"
            ) {
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              mutationOperationKeys.push(body.operationKey);
              if (!lostMutationResponse) {
                lostMutationResponse = true;
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                await route.abort();
                return;
              }
            }
            await route.continue();
          });

          const promote = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promote).toBeVisible();
          await expect(promote).toBeEnabled();
          await promote.click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並設為職員" })
            .click();
          await expect(page.getByRole("status")).toContainText(
            "操作結果未能確認"
          );

          expect(mutationOperationKeys).toHaveLength(1);
          const [operationKey] = mutationOperationKeys;
          expect(operationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          const expectedEffects = {
            audits: 1,
            history: 1,
            receipts: 1,
            role: "staff",
          };
          const readCommittedEffects = () =>
            caseApp.db
              .prepare(
                `SELECT
                  (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff' AND action = 'granted' AND resulting_global_role = 'staff') AS history,
                  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS audits,
                  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff' AND action = 'granted' AND operation_key = ?) AS receipts`
              )
              .bind(
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                operationKey
              )
              .first();
          const operationStorageKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
          const storedOperation = await page.evaluate((key) => {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }, operationStorageKey);
          expect(storedOperation).toEqual({
            actorUserId: admin.userId,
            operationKey,
          });
          expect(await readCommittedEffects()).toEqual(expectedEffects);

          await page.reload();
          const reconcile = page.getByRole("button", {
            exact: true,
            name: "查核操作結果",
          });
          await expect(reconcile).toBeVisible();
          await reconcile.click();
          await expect(page.getByRole("status")).toContainText(
            "職員身份已新增"
          );
          expect(reconciledOperationKeys).toEqual([operationKey]);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              operationStorageKey
            )
          ).toBeNull();
          expect(mutationOperationKeys).toEqual([operationKey]);
          expect(await readCommittedEffects()).toEqual(expectedEffects);

          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await expect(
            page
              .getByRole("region", { name: target.fullName })
              .getByText("職員", { exact: true })
          ).toBeVisible();
          const staffTools = await recipient.get("/api/v2/staff/accounts");
          expect(staffTools.status()).toBe(200);
        } finally {
          await context.close();
          await recipient.dispose();
        }
      }
    );

    globalRoleUiTest(
      "a held Staff response cannot restore the prior Global Roles actor workspace",
      { tag: ["@risk-resilience"] },
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const target = {
          email: `${suffix}.switch@example.com`,
          fullName: `陳遲到回應職員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-switch-member-password!",
          role: "member" as const,
          username: `global.switch.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const actorAHeaders = {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.0.10",
        };
        const actorBHeaders = {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.0.11",
        };
        const recipientHeaders = {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.0.12",
        };
        const nextAdmin = {
          email: `${suffix}.next-admin@example.com`,
          fullName: `陳全域轉換管理員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-global-role-next-admin-password!",
          role: "admin" as const,
          username: `global.next.${suffix}`,
        };
        const nextAdminUserId = await caseApp.provision.account(nextAdmin);
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: recipientHeaders,
        });
        const nextSession = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: actorBHeaders,
        });
        const actorASession = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: actorAHeaders,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: actorAHeaders,
        });
        const mutationResponseGate = Promise.withResolvers<null>();
        const committedMutation = Promise.withResolvers<{
          operationKey: string;
          status: number;
        }>();
        const deliveredMutation = Promise.withResolvers<null>();
        const appActorProbe = Promise.withResolvers<{
          actorUserId: string | null;
          status: number;
        }>();
        const mutationOperationKeys: string[] = [];
        const reconciledOperationKeys: string[] = [];
        const actorAKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
        const actorBKey = `efcc.global-role.operation.v1:${encodeURIComponent(nextAdminUserId)}`;
        let expectActorProbe = false;
        let commandCaptured = false;
        try {
          const memberLogin = await recipient.post(
            "/api/auth/sign-in/username",
            { data: { password: target.password, username: target.username } }
          );
          expect(memberLogin.status()).toBe(200);
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/roles/global-roles");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          const promote = page.getByRole("button", {
            exact: true,
            name: "設為職員",
          });
          await expect(promote).toBeVisible();
          await expect(promote).toBeEnabled();

          await page.route("**/api/v2/roles/global-roles**", async (route) => {
            const request = route.request();
            const requestUrl = new URL(request.url());
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/global-roles/reconcile"
            ) {
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              reconciledOperationKeys.push(body.operationKey);
              await route.continue();
              return;
            }
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/global-roles"
            ) {
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              mutationOperationKeys.push(body.operationKey);
              if (!commandCaptured) {
                commandCaptured = true;
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                committedMutation.resolve({
                  operationKey: body.operationKey,
                  status: response.status(),
                });
                await mutationResponseGate.promise;
                await route.fulfill({ response });
                deliveredMutation.resolve(null);
                return;
              }
              await route.continue();
              return;
            }
            if (
              expectActorProbe &&
              request.method() === "GET" &&
              requestUrl.pathname === "/api/v2/roles/global-roles" &&
              requestUrl.searchParams.get("q") === ""
            ) {
              expectActorProbe = false;
              const response = await route.fetch();
              const body = (await response.json()) as {
                data?: { actorUserId?: string };
              };
              appActorProbe.resolve({
                actorUserId: body.data?.actorUserId ?? null,
                status: response.status(),
              });
              await route.fulfill({ response });
              return;
            }
            await route.continue();
          });

          await promote.click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並設為職員" })
            .click();
          const committed = await committedMutation.promise;
          expect(committed.status).toBe(201);
          expect(committed.operationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          const storedOperation = await page.evaluate((key) => {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }, actorAKey);
          expect(storedOperation).toEqual({
            actorUserId: admin.userId,
            operationKey: committed.operationKey,
          });
          const expectedEffects = {
            audits: 1,
            history: 1,
            receipts: 1,
            role: "staff",
          };
          const readCommittedEffects = () =>
            caseApp.db
              .prepare(
                `SELECT
                  (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff' AND action = 'granted' AND resulting_global_role = 'staff') AS history,
                  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS audits,
                  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff' AND action = 'granted' AND operation_key = ?) AS receipts`
              )
              .bind(
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId,
                committed.operationKey
              )
              .first();
          expect(await readCommittedEffects()).toEqual(expectedEffects);

          const nextLogin = await nextSession.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: nextAdmin.password,
                username: nextAdmin.username,
              },
            }
          );
          expect(nextLogin.status()).toBe(200);
          await context.setExtraHTTPHeaders(actorBHeaders);
          await context.clearCookies();
          const nextState = await nextSession.storageState();
          await context.addCookies(nextState.cookies);
          const directActor = await page.request.get(
            "/api/v2/roles/global-roles?page=1&q="
          );
          expect(directActor.status()).toBe(200);
          const directActorBody = (await directActor.json()) as {
            data: { actorUserId: string };
          };
          expect(directActorBody.data.actorUserId).toBe(nextAdminUserId);

          expectActorProbe = true;
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          expect(await appActorProbe.promise).toEqual({
            actorUserId: nextAdminUserId,
            status: 200,
          });
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("button", { name: new RegExp(target.fullName, "u") })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toHaveCount(0);
          await expect(page.getByLabel("目前密碼")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核操作結果" })
          ).toHaveCount(0);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(JSON.stringify(storedOperation));
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();

          const mutationResponse = page.waitForResponse((response) => {
            const request = response.request();
            return (
              request.method() === "POST" &&
              new URL(response.url()).pathname === "/api/v2/roles/global-roles"
            );
          });
          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          const deliveredResponse = await mutationResponse;
          expect(deliveredResponse.status()).toBe(201);
          expect(mutationOperationKeys).toEqual([committed.operationKey]);
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: "確認操作" })
          ).toHaveCount(0);
          await expect(page.getByLabel("目前密碼")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核操作結果" })
          ).toHaveCount(0);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(JSON.stringify(storedOperation));
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();

          const actorALogin = await actorASession.post(
            "/api/auth/sign-in/username",
            { data: { password: admin.password, username: admin.username } }
          );
          expect(actorALogin.status()).toBe(200);
          await context.setExtraHTTPHeaders(actorAHeaders);
          await context.clearCookies();
          const actorAState = await actorASession.storageState();
          await context.addCookies(actorAState.cookies);
          await page.goto("/staff/roles/global-roles");
          const reconcile = page.getByRole("button", {
            exact: true,
            name: "查核操作結果",
          });
          await expect(reconcile).toBeVisible();
          await reconcile.click();
          await expect(page.getByRole("status")).toContainText(
            "職員身份已新增"
          );
          expect(reconciledOperationKeys).toEqual([committed.operationKey]);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBeNull();
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();
          expect(await readCommittedEffects()).toEqual(expectedEffects);

          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await expect(
            page
              .getByRole("region", { name: target.fullName })
              .getByText("職員", { exact: true })
          ).toBeVisible();
          const staffTools = await recipient.get("/api/v2/staff/accounts");
          expect(staffTools.status()).toBe(200);
          expect(mutationOperationKeys).toEqual([committed.operationKey]);
        } finally {
          mutationResponseGate.resolve(null);
          await context.close();
          await nextSession.dispose();
          await actorASession.dispose();
          await recipient.dispose();
        }
      }
    );
  }
);
