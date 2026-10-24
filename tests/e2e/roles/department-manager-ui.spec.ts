import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

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
        await caseApp.provision.account(target);
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
            name: /^部門主管/u,
          });
          await expect(managerEntry).toBeVisible();
          await managerEntry.click();
          await expect(page).toHaveURL(/\/staff\/roles\/department-managers$/u);

          const search = page.getByRole("textbox", {
            name: "搜尋姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const targetButton = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(targetButton).toBeVisible();
          await targetButton.click();
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toBeVisible();
          await expect(
            page.getByText(target.username, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);

          await page
            .locator("#department-manager-scope")
            .selectOption(departmentId);
          const grant = page.getByRole("button", {
            exact: true,
            name: "授予部門主管",
          });
          const presentation = {
            criticalAction: grant,
            drafts: page.locator("input"),
            focus: search,
            masks: [
              search,
              page.getByText(target.fullName, { exact: true }),
              page.getByText(target.username, { exact: true }),
            ],
          };
          await qualifyPresentation(page, testInfo, "phone", presentation);
          await qualifyPresentation(page, testInfo, "desktop", presentation);

          let lostGrantResponse = false;
          await page.route(
            "**/api/v2/roles/department-managers",
            async (route) => {
              if (!lostGrantResponse && route.request().method() === "POST") {
                lostGrantResponse = true;
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                await route.abort();
                return;
              }
              await route.continue();
            }
          );

          await grant.click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並授予" })
            .click();
          await expect(page.getByRole("status")).toContainText("結果未能確認");
          const operationStorageKey = `efcc.department-manager.operation.v1:${encodeURIComponent(admin.userId)}`;
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
            .getByRole("button", { exact: true, name: "查核操作結果" })
            .click();
          await expect(page.getByRole("status")).toContainText("已授予");
          await expect(
            page
              .getByRole("region", { name: "人士資料" })
              .getByRole("list")
              .getByText(`角色測試部門${suffix}`, { exact: true })
          ).toBeVisible();

          const withdraw = page.getByRole("button", {
            exact: true,
            name: "撤回部門主管",
          });
          await withdraw.click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並撤回" })
            .click();
          await expect(page.getByRole("status")).toContainText("已撤回");

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
        await caseApp.provision.account(target);
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
        const appActorProbe = Promise.withResolvers<{
          actorUserId: string | null;
          status: number;
        }>();
        const reconciledOperationKeys: string[] = [];
        const actorAKey = `efcc.department-manager.operation.v1:${encodeURIComponent(admin.userId)}`;
        const actorBKey = `efcc.department-manager.operation.v1:${encodeURIComponent(nextAdminUserId)}`;
        let expectActorProbe = false;
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

          await page
            .getByRole("textbox", { name: "搜尋姓名或 Username" })
            .fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await page
            .locator("#department-manager-scope")
            .selectOption(departmentId);

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
          await page.route(
            "**/api/v2/roles/department-managers**",
            async (route) => {
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
              if (
                expectActorProbe &&
                request.method() === "GET" &&
                requestUrl.searchParams.get("q") === ""
              ) {
                expectActorProbe = false;
                const response = await route.fetch();
                const body = (await response.json()) as {
                  data?: { actorUserId?: string };
                };
                const result = {
                  actorUserId: body.data?.actorUserId ?? null,
                  status: response.status(),
                };
                appActorProbe.resolve(result);
                await route.fulfill({ response });
                return;
              }
              await route.continue();
            }
          );

          await page
            .getByRole("button", { exact: true, name: "授予部門主管" })
            .click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並授予" })
            .click();
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
          await context.clearCookies();
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

          expectActorProbe = true;
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          expect(await appActorProbe.promise).toEqual({
            actorUserId: nextAdminUserId,
            status: 200,
          });
          const search = page.getByRole("textbox", {
            name: "搜尋姓名或 Username",
          });
          await expect(search).toHaveValue("");
          await expect(search).toBeEnabled();
          await expect(
            page.getByRole("button", { name: new RegExp(target.fullName, "u") })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核操作結果" })
          ).toHaveCount(0);
          expect(storedAOperation?.key).toBe(actorAKey);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(JSON.stringify(storedAOperation?.value));

          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          expect(commandDeliveryError).toBeNull();
          expect(await browserMutationOutcome.promise).toEqual({
            kind: "response",
            status: 201,
          });
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("button", { exact: true, name: "查核操作結果" })
          ).toHaveCount(0);

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
            page.getByRole("button", { exact: true, name: "查核操作結果" })
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
            .getByRole("button", { exact: true, name: "查核操作結果" })
            .click();
          await expect(page.getByRole("status")).toContainText("已授予");
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
      "Staff cannot see the Department Manager entry or open its page",
      async ({ staffPage: page }) => {
        await page.goto("/staff/accounts");
        await expect(
          page.getByRole("link", { name: /^部門主管/u })
        ).toHaveCount(0);

        await page.goto("/staff/roles/department-managers");
        await expect(page).toHaveURL(/\/staff\/accounts$/u);
        await expect(
          page.getByRole("heading", { exact: true, name: "管理" })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /^部門主管/u })
        ).toHaveCount(0);
      }
    );
  }
);
