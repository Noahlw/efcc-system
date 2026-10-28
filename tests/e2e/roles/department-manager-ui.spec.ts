import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import {
  confirmRoleTaskPassword,
  dispatchOriginalRole,
  openPersonOverview,
  openRoleTask,
} from "./role-navigation";

const roleUiTest = dedicatedTest.extend<{
  admin: {
    fullName: string;
    password: string;
    userId: string;
    username: string;
  };
}>({
  admin: async ({ caseApp }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const account = {
      email: `${suffix}@example.com`,
      fullName: `陳角色管理${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-role-admin-password!",
      role: "admin" as const,
      username: `role.admin.${suffix}`,
    };
    const userId = await caseApp.provision.account(account);
    await use({ ...account, userId });
  },
});

roleUiTest.describe(
  "Admin Department Manager journey",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-resilience",
    ],
  },
  () => {
    roleUiTest(
      "an Admin manages one person-first assignment and can reconcile a lost response",
      async ({ admin, browser, caseApp, extraHTTPHeaders }, testInfo) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳受管理${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-role-member-password!",
          role: "member" as const,
          username: `role.member.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `角色測試部門${suffix}`)
          .run();

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await page.goto("/sign-in");
          await page
            .getByRole("textbox", { name: "Username" })
            .fill(admin.username);
          await page
            .getByRole("textbox", { name: "密碼" })
            .fill(admin.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);

          await page.goto("/staff/accounts");
          const managerEntry = page.getByRole("link", {
            name: /^人員權責/u,
          });
          await expect(managerEntry).toBeVisible();
          await managerEntry.click();
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await openRoleTask(page, target, "department-managers");

          await expect(
            page.getByText(target.username, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);
          const choice = page.getByRole("checkbox", {
            exact: true,
            name: `部門主管：角色測試部門${suffix}`,
          });
          await choice.check();
          const grant = page.getByRole("button", { exact: true, name: "儲存" });
          const presentation = {
            criticalAction: grant,
            drafts: page.locator("input"),
            focus: choice,
            masks: [
              page.getByText(target.fullName, { exact: true }),
              page.getByText(target.username, { exact: true }),
            ],
          };
          await qualifyPresentation(
            page,
            testInfo,
            "person-department-duties",
            presentation
          );

          let lostGrantResponse = false;
          let proofOperationKey = "";
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              if (!lostGrantResponse && route.request().method() === "POST") {
                const response = await route.fetch();
                if (response.status() === 403) {
                  expect(await response.json()).toMatchObject({
                    error: { code: "password_confirmation_required" },
                  });
                  proofOperationKey = route
                    .request()
                    .postDataJSON().operationKey;
                  await route.fulfill({ response });
                  return;
                }
                expect(response.status()).toBe(201);
                lostGrantResponse = true;
                await route.abort();
                return;
              }
              await route.continue();
            }
          );

          await grant.click();
          await expect(page.getByRole("dialog")).toBeVisible();
          expect(proofOperationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          const deniedEffects = await caseApp.db
            .prepare(
              "SELECT (SELECT count(*) FROM department_manager_assignment WHERE user_id = ? AND department_id = ?) AS assignments, (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history, (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'department_manager_granted') AS audits, (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts"
            )
            .bind(
              targetUserId,
              departmentId,
              targetUserId,
              targetUserId,
              admin.userId,
              proofOperationKey
            )
            .first();
          expect(deniedEffects).toEqual({
            assignments: 0,
            audits: 0,
            history: 0,
            receipts: 0,
          });
          await confirmRoleTaskPassword(page, admin.password);
          expect(lostGrantResponse).toBe(false);
          await expect(choice).toBeChecked();
          await grant.click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          expect(lostGrantResponse).toBe(true);
          const operationStorageKey = `efcc.scoped-role.operation.v1:${encodeURIComponent(admin.userId)}`;
          const pendingOperation = await page.evaluate((key) => {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }, operationStorageKey);
          expect(Object.keys(pendingOperation ?? {}).toSorted()).toEqual([
            "actorUserId",
            "operationKey",
          ]);
          expect(pendingOperation?.actorUserId).toBe(admin.userId);
          expect(pendingOperation?.operationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const overview = page.getByRole("article", { name: target.fullName });
          await expect(
            overview.getByText(`角色測試部門${suffix}`, { exact: true })
          ).toBeVisible();

          await overview
            .getByRole("link", { exact: true, name: "編輯職務" })
            .click();
          await choice.uncheck();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(overview).toBeVisible();
          await expect(
            overview.getByText(`角色測試部門${suffix}`, { exact: true })
          ).toHaveCount(0);
          const currentPerson = await context.request.get(
            `/api/v2/roles/people/${encodeURIComponent(targetUserId)}`
          );
          expect(currentPerson.status()).toBe(200);
          expect(await currentPerson.json()).toMatchObject({
            data: {
              person: {
                duties: { groups: [], hasNextPage: false, status: "complete" },
                identity: { userId: targetUserId },
              },
            },
          });

          expect(lostGrantResponse).toBe(true);
        } finally {
          await context.close();
        }
      }
    );

    roleUiTest(
      "a committed command survives account switching and only its actor can recover it",
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳延遲結果${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-role-member-password!",
          role: "member" as const,
          username: `role.late.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `延遲結果部門${suffix}`)
          .run();

        const nextAdmin = {
          email: `switch-${suffix}@example.com`,
          fullName: `陳轉換帳戶${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-role-admin-password!",
          role: "admin" as const,
          username: `role.switch.${suffix}`,
        };
        const nextAdminUserId = await caseApp.provision.account(nextAdmin);

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const nextSession = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const mutationResponseGate = Promise.withResolvers<null>();
        const committedMutation = Promise.withResolvers<{
          operationKey: string;
          status: number;
        }>();
        const deliveredMutation = Promise.withResolvers<null>();
        const browserMutationOutcome = Promise.withResolvers<
          | { kind: "response"; status: number }
          | { error: string; kind: "failed" }
        >();
        const reconciledOperationKeys: string[] = [];
        const actorAKey = `efcc.department-manager.operation.v1:${encodeURIComponent(admin.userId)}`;
        const actorBKey = `efcc.department-manager.operation.v1:${encodeURIComponent(nextAdminUserId)}`;
        let commandCaptured = false;
        let commandDeliveryError: string | null = null;
        try {
          const page = await context.newPage();
          await page.goto("/sign-in");
          await page
            .getByRole("textbox", { name: "Username" })
            .fill(admin.username);
          await page
            .getByRole("textbox", { name: "密碼" })
            .fill(admin.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);
          await page.goto("/staff/roles/department-managers");

          await openPersonOverview(page, target);

          page.on("response", (response) => {
            const request = response.request();
            const { pathname } = new URL(response.url());
            if (
              request.method() === "POST" &&
              pathname === "/api/v2/roles/department-managers"
            ) {
              browserMutationOutcome.resolve({
                kind: "response",
                status: response.status(),
              });
            }
          });
          page.on("requestfailed", (request) => {
            const { pathname } = new URL(request.url());
            if (
              request.method() === "POST" &&
              pathname === "/api/v2/roles/department-managers"
            ) {
              browserMutationOutcome.resolve({
                error:
                  request.failure()?.errorText ?? "unknown request failure",
                kind: "failed",
              });
            }
          });
          await page.route("**/api/v2/roles/**", async (route) => {
            const request = route.request();
            const requestUrl = new URL(request.url());
            if (
              request.method() === "POST" &&
              requestUrl.pathname ===
                "/api/v2/roles/department-managers/reconcile"
            ) {
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              reconciledOperationKeys.push(body.operationKey);
              await route.continue();
              return;
            }
            if (
              !commandCaptured &&
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/department-managers"
            ) {
              commandCaptured = true;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              const body = request.postDataJSON() as {
                operationKey: string;
              };
              committedMutation.resolve({
                operationKey: body.operationKey,
                status: response.status(),
              });
              await mutationResponseGate.promise;
              try {
                await route.fulfill({ response });
              } catch (error) {
                commandDeliveryError =
                  error instanceof Error ? error.message : String(error);
              } finally {
                deliveredMutation.resolve(null);
              }
              return;
            }
            await route.continue();
          });

          const originalDispatch = dispatchOriginalRole(
            page,
            admin,
            "department-manager",
            {
              action: "granted",
              scopeId: departmentId,
              targetUserId,
            }
          );
          const committed = await committedMutation.promise;
          expect(committed.status).toBe(201);
          expect(committed.operationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          const storedAOperation = await page.evaluate(
            ({ actorId, prefix }) => {
              for (const key of Object.keys(sessionStorage)) {
                if (key.startsWith(prefix)) {
                  const raw = sessionStorage.getItem(key);
                  if (!raw) {
                    continue;
                  }
                  const value = JSON.parse(raw) as Record<string, unknown>;
                  if (value.actorUserId === actorId) {
                    return { key, value };
                  }
                }
              }
              return null;
            },
            {
              actorId: admin.userId,
              prefix: "efcc.department-manager.operation.v1",
            }
          );
          expect(storedAOperation?.value).toEqual({
            actorUserId: admin.userId,
            operationKey: committed.operationKey,
          });

          const login = await nextSession.post("/api/auth/sign-in/username", {
            data: {
              password: nextAdmin.password,
              username: nextAdmin.username,
            },
          });
          expect(login.status()).toBe(200);
          const nextStorageState = await nextSession.storageState();
          await context.addCookies(nextStorageState.cookies);
          const actorResponse = await page.request.get(
            "/api/v2/roles/department-managers?page=1&q="
          );
          expect(actorResponse.status()).toBe(200);
          const actorBody = (await actorResponse.json()) as {
            data: { actorUserId: string };
          };
          expect(actorBody.data.actorUserId).toBe(nextAdminUserId);

          expect(actorAKey).not.toBe(actorBKey);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();

          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await expect(search).toHaveValue("");
          await expect(search).toBeEnabled();
          await expect(
            page.getByRole("button", { name: new RegExp(target.fullName, "u") })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有部門主管職務操作",
            })
          ).toHaveCount(0);
          expect(storedAOperation?.key).toBe(actorAKey);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(JSON.stringify(storedAOperation?.value));

          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          await originalDispatch;
          expect(commandDeliveryError).toBeNull();
          expect(await browserMutationOutcome.promise).toEqual({
            kind: "response",
            status: 201,
          });
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有部門主管職務操作",
            })
          ).toHaveCount(0);
          await page.goto("about:blank");

          const actorALogin = await nextSession.post(
            "/api/auth/sign-in/username",
            {
              data: { password: admin.password, username: admin.username },
            }
          );
          expect(actorALogin.status()).toBe(200);
          await context.clearCookies();
          const actorAStorageState = await nextSession.storageState();
          await context.addCookies(actorAStorageState.cookies);
          await page.goto("/staff/roles/department-managers");
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有部門主管職務操作",
            })
          ).toBeVisible();
          const recoveredAOperation = await page.evaluate((key) => {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }, actorAKey);
          expect(recoveredAOperation).toEqual(storedAOperation?.value);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();

          await page
            .getByRole("button", {
              exact: true,
              name: "查核原有部門主管職務操作",
            })
            .click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          expect(reconciledOperationKeys).toEqual([committed.operationKey]);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBeNull();
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();
        } finally {
          mutationResponseGate.resolve(null);
          await context.close();
          await nextSession.dispose();
        }
      }
    );

    roleUiTest(
      "a current Role Assigner can grant and reconcile a church-wide Department Manager assignment",
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const roleAssigner = {
          email: `${suffix}.ra@example.com`,
          fullName: `陳角色委派員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-role-assigner-password!",
          role: "staff" as const,
          username: `role.ra.${suffix}`,
        };
        const roleAssignerUserId =
          await caseApp.provision.account(roleAssigner);
        const target = {
          email: `${suffix}.member@example.com`,
          fullName: `陳跨部門會員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-role-member-password!",
          role: "member" as const,
          username: `role.member.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `跨部門測試${suffix}`)
          .run();

        const adminRequest = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const adminLogin = await adminRequest.post(
            "/api/auth/sign-in/username",
            { data: { password: admin.password, username: admin.username } }
          );
          expect(adminLogin.status()).toBe(200);
          const adminConfirmation = await adminRequest.post(
            "/api/v2/account/password-confirmation",
            {
              data: { operationKey: randomUUID(), password: admin.password },
            }
          );
          expect(adminConfirmation.status()).toBe(201);
          const delegation = await adminRequest.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId: roleAssignerUserId,
              },
            }
          );
          expect(delegation.status()).toBe(201);
          const authority = await caseApp.db
            .prepare(
              "select id from role_assigner_assignment where user_id = ?"
            )
            .bind(roleAssignerUserId)
            .first<{ id: string }>();
          expect(authority).not.toBeNull();
          if (!authority) {
            throw new TypeError("Role Assigner has no current authority row");
          }

          const page = await context.newPage();
          await page.goto("/sign-in");
          await page
            .getByRole("textbox", { name: "Username" })
            .fill(roleAssigner.username);
          await page
            .getByRole("textbox", { name: "密碼" })
            .fill(roleAssigner.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);

          await page.goto("/staff/accounts");
          const managerEntry = page.getByRole("link", {
            name: /^人員權責/u,
          });
          await expect(managerEntry).toBeVisible();
          await managerEntry.click();
          await expect(page).toHaveURL(/\/roles\/people$/u);

          await openPersonOverview(page, target);
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);

          const commandBodies: Record<string, unknown>[] = [];
          const reconciliationBodies: Record<string, unknown>[] = [];
          let passwordConfirmationRequests = 0;
          let lostGrantResponse = false;
          page.on("request", (request) => {
            const { pathname } = new URL(request.url());
            if (
              request.method() === "POST" &&
              pathname === "/api/v2/account/password-confirmation"
            ) {
              passwordConfirmationRequests += 1;
            }
            if (
              request.method() === "POST" &&
              pathname === "/api/v2/roles/department-managers"
            ) {
              commandBodies.push(
                request.postDataJSON() as Record<string, unknown>
              );
            }
            if (
              request.method() === "POST" &&
              pathname === "/api/v2/roles/department-managers/reconcile"
            ) {
              reconciliationBodies.push(
                request.postDataJSON() as Record<string, unknown>
              );
            }
          });
          await page.route(
            "**/api/v2/roles/department-managers",
            async (route) => {
              if (!lostGrantResponse && route.request().method() === "POST") {
                lostGrantResponse = true;
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                await route.abort("failed");
                return;
              }
              await route.continue();
            }
          );

          await dispatchOriginalRole(
            page,
            { password: roleAssigner.password, userId: roleAssignerUserId },
            "department-manager",
            {
              action: "granted",
              authorityAssignmentId: authority.id,
              scopeId: departmentId,
              targetUserId,
            }
          );
          await page.reload();
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有部門主管職務操作",
            })
          ).toBeVisible();

          expect(lostGrantResponse).toBe(true);
          expect(passwordConfirmationRequests).toBe(1);
          expect(commandBodies).toHaveLength(1);
          const [command] = commandBodies;
          expect(command?.authorityAssignmentId).toBe(authority.id);
          expect(command?.action).toBe("granted");
          expect(command?.scopeId).toBe(departmentId);
          expect(command?.targetUserId).toBe(targetUserId);
          expect(command?.operationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          expect(Object.keys(command ?? {}).toSorted()).toEqual([
            "action",
            "authorityAssignmentId",
            "operationKey",
            "scopeId",
            "targetUserId",
          ]);
          const operationKey = command?.operationKey;
          if (typeof operationKey !== "string") {
            throw new TypeError(
              "Department Manager command had no operation key"
            );
          }

          const operationStorageKey = `efcc.department-manager.operation.v1:${encodeURIComponent(roleAssignerUserId)}`;
          const pendingOperation = await page.evaluate((key) => {
            const raw = sessionStorage.getItem(key);
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          }, operationStorageKey);
          expect(Object.keys(pendingOperation ?? {}).toSorted()).toEqual([
            "actorUserId",
            "operationKey",
          ]);
          expect(pendingOperation).toEqual({
            actorUserId: roleAssignerUserId,
            operationKey,
          });
          await page.goto(
            `/roles/people/duties?person=${encodeURIComponent(targetUserId)}`
          );
          await expect(page).toHaveURL(
            (url) => url.pathname === "/roles/people"
          );
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);

          const reconcile = page.getByRole("button", {
            exact: true,
            name: "查核原有部門主管職務操作",
          });
          await expect(reconcile).toBeVisible();
          await reconcile.click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          expect(reconciliationBodies).toEqual([{ operationKey }]);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              operationStorageKey
            )
          ).toBeNull();
          await expect(
            page
              .getByRole("article", { name: target.fullName })
              .getByText(`跨部門測試${suffix}`, { exact: true })
          ).toBeVisible();

          const currentPerson = await page.request.get(
            `/api/v2/roles/department-managers/${encodeURIComponent(targetUserId)}?assignmentPage=1`
          );
          expect(currentPerson.status()).toBe(200);
          const currentPersonBody = (await currentPerson.json()) as {
            data: {
              person: {
                assignments: { scopeId: string; scopeName: string }[];
                userId: string;
              };
            };
          };
          expect(currentPersonBody.data.person).toMatchObject({
            assignments: [
              expect.objectContaining({
                scopeId: departmentId,
                scopeName: `跨部門測試${suffix}`,
              }),
            ],
            userId: targetUserId,
          });
          expect(JSON.stringify(currentPersonBody)).not.toContain(target.email);

          const durableEffects = await caseApp.db
            .prepare(
              "select (select count(*) from department_manager_assignment where department_id = ? and user_id = ?) as assignments, (select count(*) from role_assignment_history where actor_user_id = ? and target_user_id = ? and scope_id = ? and role = 'department_manager' and action = 'granted') as history, (select count(*) from audit_event where actor_user_id = ? and target_user_id = ? and action = 'department_manager_granted') as audits, (select count(*) from role_change_operation where actor_user_id = ? and operation_key = ? and target_user_id = ? and role = 'department_manager') as receipts"
            )
            .bind(
              departmentId,
              targetUserId,
              roleAssignerUserId,
              targetUserId,
              departmentId,
              roleAssignerUserId,
              targetUserId,
              roleAssignerUserId,
              operationKey,
              targetUserId
            )
            .first<{
              assignments: number;
              audits: number;
              history: number;
              receipts: number;
            }>();
          expect(durableEffects).toEqual({
            assignments: 1,
            audits: 1,
            history: 1,
            receipts: 1,
          });
          const memberships = await caseApp.db
            .prepare(
              "select count(*) as count from department_membership where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          expect(memberships).toEqual({ count: 0 });
        } finally {
          await context.close();
          await adminRequest.dispose();
        }
      }
    );

    roleUiTest(
      "an absent legacy receipt keeps its original key and fences only scoped replacement work after convergence",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().slice(0, 8);
        const target = {
          email: `legacy.unknown.${suffix}@example.com`,
          fullName: `陳原有待查核${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-legacy-unknown-password!",
          role: "member" as const,
          username: `legacy.unknown.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
          )
          .bind(departmentId, `原有待查核部門${suffix}`)
          .run();
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await page.goto("/sign-in");
          await page
            .getByRole("textbox", { name: "Username" })
            .fill(admin.username);
          await page
            .getByRole("textbox", { exact: true, name: "密碼" })
            .fill(admin.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);
          let commands = 0;
          await page.route(
            "**/api/v2/roles/department-managers",
            async (route) => {
              if (route.request().method() === "POST") {
                commands += 1;
                await route.abort("failed");
              } else {
                await route.continue();
              }
            }
          );
          await dispatchOriginalRole(page, admin, "department-manager", {
            action: "granted",
            scopeId: departmentId,
            targetUserId,
          });
          const storageKey = `efcc.department-manager.operation.v1:${encodeURIComponent(admin.userId)}`;
          const original = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey
          );
          expect(original).not.toBeNull();
          await page.goto("/staff/roles/department-managers");
          const reconciliation = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
              "/api/v2/roles/department-managers/reconcile"
          );
          await page
            .getByRole("button", {
              exact: true,
              name: "查核原有部門主管職務操作",
            })
            .click();
          const result = await reconciliation;
          expect(result.status()).toBe(200);
          expect(await result.json()).toMatchObject({
            data: { outcome: "unknown", receipt: null },
          });
          await expect(
            page.getByText(
              "原有操作結果仍未能確認。操作編號已保留，請勿重新提交相同工作。",
              { exact: true }
            )
          ).toBeVisible();
          await openPersonOverview(page, target);
          await page
            .getByRole("link", { exact: true, name: "編輯職務" })
            .click();
          // The source overview already has this pathname; only the neutral
          // query-free return proves the focused task's guard has completed.
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(
            page.getByRole("searchbox", { name: "姓名或 Username" })
          ).toHaveValue("");
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await openPersonOverview(page, target);
          await page
            .getByRole("link", { exact: true, name: "管理帳戶身份" })
            .click();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeChecked();
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBe(original);
          expect(commands).toBe(1);
          const state = await page.request.get(
            `/api/v2/roles/department-managers/${encodeURIComponent(targetUserId)}?assignmentPage=1`
          );
          expect(state.status()).toBe(200);
          expect(await state.json()).toMatchObject({
            data: { person: { assignments: [] } },
          });
        } finally {
          await context.close();
        }
      }
    );

    roleUiTest(
      "Staff cannot see the Department Manager entry or open its page",
      async ({ staffPage: page }) => {
        await page.goto("/staff/accounts");
        await expect(
          page.getByRole("link", { name: /^人員權責/u })
        ).toHaveCount(0);

        await page.goto("/staff/roles/department-managers");
        await expect(page).toHaveURL(/\/staff\/accounts$/u);
        await expect(
          page.getByRole("link", { name: /^人員權責/u })
        ).toHaveCount(0);
      }
    );
  }
);
