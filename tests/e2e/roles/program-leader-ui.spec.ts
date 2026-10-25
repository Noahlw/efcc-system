import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

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
      fullName: `陳聚會管理${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-program-leader-admin-password!",
      role: "admin" as const,
      username: `program.admin.${suffix}`,
    };
    const userId = await caseApp.provision.account(account);
    await use({ ...account, userId });
  },
});

const signInAdmin = async (page: Page, username: string, password: string) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByRole("textbox", { name: "密碼" }).fill(password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};

roleUiTest.describe(
  "Admin Program Leader journey",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-resilience",
      "@risk-presentation",
    ],
  },
  () => {
    roleUiTest(
      "an Admin manages one person-first Program Leader assignment and reconciles a lost response",
      async ({ admin, browser, caseApp, extraHTTPHeaders }, testInfo) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳聚會受管理${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-program-leader-member-password!",
          role: "member" as const,
          username: `program.member.${suffix.slice(0, 8)}`,
        };
        await caseApp.provision.account(target);
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `聚會測試部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `聚會測試名稱${suffix}`)
          .run();

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const managerEntry = page.getByRole("link", {
            name: /^Program Leader/u,
          });
          await expect(managerEntry).toBeVisible();
          await managerEntry.click();
          await expect(page).toHaveURL(/\/staff\/roles\/program-leaders$/u);

          const search = page.getByRole("textbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const targetButton = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(targetButton).toBeVisible();
          await targetButton.click();
          const personRegion = page.getByRole("region", { name: "人士資料" });
          await expect(
            personRegion.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toBeVisible();
          await expect(
            personRegion.getByText(target.username, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);

          await page.locator("#program-leader-scope").selectOption(programId);
          const grant = page.getByRole("button", {
            exact: true,
            name: "授予 Program Leader",
          });
          const presentation = {
            criticalAction: grant,
            drafts: page.locator("input"),
            focus: search,
            masks: [
              search,
              personRegion.getByRole("heading", {
                exact: true,
                name: target.fullName,
              }),
              personRegion.getByText(target.username, { exact: true }),
              page.getByLabel("聚會"),
            ],
          };
          await qualifyPresentation(page, testInfo, "phone", presentation);
          await qualifyPresentation(page, testInfo, "desktop", presentation);

          let lostGrantResponse = false;
          const reconciledOperationKeys: string[] = [];
          await page.route(
            "**/api/v2/roles/program-leaders**",
            async (route) => {
              const request = route.request();
              const requestUrl = new URL(request.url());
              if (
                request.method() === "POST" &&
                requestUrl.pathname ===
                  "/api/v2/roles/program-leaders/reconcile"
              ) {
                const body = request.postDataJSON() as {
                  operationKey: string;
                };
                reconciledOperationKeys.push(body.operationKey);
                await route.continue();
                return;
              }
              if (
                !lostGrantResponse &&
                request.method() === "POST" &&
                requestUrl.pathname === "/api/v2/roles/program-leaders"
              ) {
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
          const operationStorageKey = `efcc.program-leader.operation.v1:${encodeURIComponent(admin.userId)}`;
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
          const assignment = page.getByRole("region", {
            name: "現有 Program Leader 職務",
          });
          await expect(
            assignment.getByText(`聚會測試名稱${suffix}`, { exact: false })
          ).toBeVisible();
          expect(reconciledOperationKeys).toEqual([
            pendingOperation?.operationKey,
          ]);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              operationStorageKey
            )
          ).toBeNull();

          await assignment
            .getByRole("button", {
              exact: true,
              name: "撤回 Program Leader",
            })
            .click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並撤回" })
            .click();
          await expect(page.getByRole("status")).toContainText("已撤回");
          await expect(
            page
              .getByRole("region", { name: "現有 Program Leader 職務" })
              .getByText(`聚會測試名稱${suffix}`, { exact: false })
          ).toHaveCount(0);
          expect(lostGrantResponse).toBe(true);
        } finally {
          await context.close();
        }
      }
    );

    roleUiTest(
      "a committed operation remains actor-bound across a late response and only its Admin can recover it",
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳延遲聚會${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-program-leader-member-password!",
          role: "member" as const,
          username: `program.late.${suffix}`,
        };
        await caseApp.provision.account(target);
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `延遲聚會部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `延遲聚會${suffix}`)
          .run();

        const nextAdmin = {
          email: `switch-${suffix}@example.com`,
          fullName: `陳聚會轉換${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-program-leader-admin-password!",
          role: "admin" as const,
          username: `program.switch.${suffix.slice(0, 8)}`,
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
        const appActorProbe = Promise.withResolvers<{
          actorUserId: string | null;
          status: number;
        }>();
        const reconciledOperationKeys: string[] = [];
        const actorAKey = `efcc.program-leader.operation.v1:${encodeURIComponent(admin.userId)}`;
        const actorBKey = `efcc.program-leader.operation.v1:${encodeURIComponent(nextAdminUserId)}`;
        let expectActorProbe = false;
        let commandCaptured = false;
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/roles/program-leaders");
          await page
            .getByRole("textbox", { name: "姓名或 Username" })
            .fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await page.locator("#program-leader-scope").selectOption(programId);

          await page.route(
            "**/api/v2/roles/program-leaders**",
            async (route) => {
              const request = route.request();
              const requestUrl = new URL(request.url());
              if (
                request.method() === "POST" &&
                requestUrl.pathname ===
                  "/api/v2/roles/program-leaders/reconcile"
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
                requestUrl.pathname === "/api/v2/roles/program-leaders"
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
                await route.fulfill({ response });
                deliveredMutation.resolve(null);
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
                appActorProbe.resolve({
                  actorUserId: body.data?.actorUserId ?? null,
                  status: response.status(),
                });
                await route.fulfill({ response });
                return;
              }
              await route.continue();
            }
          );

          await page
            .getByRole("button", {
              exact: true,
              name: "授予 Program Leader",
            })
            .click();
          await page.getByLabel("目前密碼").fill(admin.password);
          await page
            .getByRole("button", { exact: true, name: "確認並授予" })
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
          const directActor = await page.request.get(
            "/api/v2/roles/program-leaders?page=1&q="
          );
          expect(directActor.status()).toBe(200);
          const directBody = (await directActor.json()) as {
            data: { actorUserId: string };
          };
          expect(directBody.data.actorUserId).toBe(nextAdminUserId);

          expectActorProbe = true;
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          expect(await appActorProbe.promise).toEqual({
            actorUserId: nextAdminUserId,
            status: 200,
          });
          const search = page.getByRole("textbox", {
            name: "姓名或 Username",
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

          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核操作結果" })
          ).toHaveCount(0);

          const actorALogin = await nextSession.post(
            "/api/auth/sign-in/username",
            { data: { password: admin.password, username: admin.username } }
          );
          expect(actorALogin.status()).toBe(200);
          const requestContextActor = await nextSession.get(
            "/api/v2/roles/program-leaders?page=1&q="
          );
          expect(requestContextActor.status()).toBe(200);
          const requestContextActorBody =
            (await requestContextActor.json()) as {
              data: { actorUserId: string };
            };
          expect(requestContextActorBody.data.actorUserId).toBe(admin.userId);
          await context.clearCookies();
          const actorAStorageState = await nextSession.storageState();
          await context.addCookies(actorAStorageState.cookies);
          const browserActor = await page.request.get(
            "/api/v2/roles/program-leaders?page=1&q="
          );
          expect(browserActor.status()).toBe(200);
          const browserActorBody = (await browserActor.json()) as {
            data: { actorUserId: string };
          };
          expect(browserActorBody.data.actorUserId).toBe(admin.userId);
          await page.goto("/staff/roles/program-leaders");
          await expect(
            page.getByRole("button", { exact: true, name: "查核操作結果" })
          ).toBeVisible();
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
      "Staff cannot see the Program Leader entry or open its page",
      async ({ staffPage: page }) => {
        await page.goto("/staff/accounts");
        await expect(
          page.getByRole("link", { name: /^Program Leader/u })
        ).toHaveCount(0);

        await page.goto("/staff/roles/program-leaders");
        await expect(page).toHaveURL(/\/staff\/accounts$/u);
        await expect(
          page.getByRole("heading", { exact: true, name: "管理" })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /^Program Leader/u })
        ).toHaveCount(0);
      }
    );
  }
);

roleUiTest.describe(
  "Staff Role Assigner Program Leader journey",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-resilience",
      "@risk-presentation",
    ],
  },
  () => {
    roleUiTest(
      "a current Staff Role Assigner manages a Member through the person-first page",
      async ({ caseApp, staff, staffPage: page }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const authorityAssignmentId = randomUUID();
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳角色委派聚會${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-program-leader-member-password!",
          role: "member" as const,
          username: `program.ra.${suffix.slice(0, 8)}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO role_assigner_assignment(created_at,id,user_id) VALUES(unixepoch(),?,?)"
          )
          .bind(authorityAssignmentId, staff.userId)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
          )
          .bind(departmentId, `角色委派部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `角色委派聚會${suffix}`)
          .run();

        const initialSearchResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            response.request().method() === "GET" &&
            url.pathname === "/api/v2/roles/program-leaders" &&
            url.searchParams.get("page") === "1" &&
            url.searchParams.get("q") === ""
          );
        });
        const initialProgramsResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            response.request().method() === "GET" &&
            url.pathname === "/api/v2/roles/program-leaders/programs" &&
            url.searchParams.get("page") === "1"
          );
        });
        await page.goto("/staff/roles/program-leaders");
        await expect(page).toHaveURL(/\/staff\/roles\/program-leaders$/u);

        const [initialSearch, initialPrograms] = await Promise.all([
          initialSearchResponse,
          initialProgramsResponse,
        ]);
        expect(initialSearch.status()).toBe(200);
        expect(initialPrograms.status()).toBe(200);
        const initialSearchBody = (await initialSearch.json()) as {
          data: { actorUserId: string; authorityAssignmentId: string };
        };
        const initialProgramsBody = (await initialPrograms.json()) as {
          data: {
            actorUserId: string;
            authorityAssignmentId: string;
            programs: { id: string }[];
          };
        };
        expect(initialSearchBody.data.actorUserId).toBe(staff.userId);
        expect(initialSearchBody.data.authorityAssignmentId).toBe(
          authorityAssignmentId
        );
        expect(initialProgramsBody.data.authorityAssignmentId).toBe(
          authorityAssignmentId
        );
        expect(initialProgramsBody.data.actorUserId).toBe(staff.userId);
        expect(initialProgramsBody.data.programs).toContainEqual(
          expect.objectContaining({ id: programId })
        );

        const search = page.getByRole("textbox", {
          name: "姓名或 Username",
        });
        const candidateResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            response.request().method() === "GET" &&
            url.pathname === "/api/v2/roles/program-leaders" &&
            url.searchParams.get("q") === target.username
          );
        });
        await search.fill(target.username);
        await page.getByRole("button", { exact: true, name: "搜尋" }).click();
        const candidates = await candidateResponse;
        expect(candidates.status()).toBe(200);
        const candidatesBody = (await candidates.json()) as {
          data: {
            authorityAssignmentId: string;
            candidates: {
              fullName: string;
              userId: string;
              username: string;
            }[];
          };
        };
        expect(candidatesBody.data.authorityAssignmentId).toBe(
          authorityAssignmentId
        );
        expect(candidatesBody.data.candidates).toContainEqual({
          fullName: target.fullName,
          userId: targetUserId,
          username: target.username,
        });
        expect(JSON.stringify(candidatesBody)).not.toContain(target.email);

        const personResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            response.request().method() === "GET" &&
            url.pathname ===
              `/api/v2/roles/program-leaders/${encodeURIComponent(targetUserId)}` &&
            url.searchParams.get("assignmentPage") === "1"
          );
        });
        await page
          .getByRole("button", { name: new RegExp(target.fullName, "u") })
          .click();
        const person = await personResponse;
        expect(person.status()).toBe(200);
        const personBody = (await person.json()) as {
          data: {
            person: {
              authorityAssignmentId: string;
              eligibleForGrant: boolean;
              userId: string;
            };
          };
        };
        expect(personBody.data.person.authorityAssignmentId).toBe(
          authorityAssignmentId
        );
        expect(personBody.data.person.userId).toBe(targetUserId);
        expect(personBody.data.person.eligibleForGrant).toBe(true);
        await expect(page.getByText(target.email, { exact: true })).toHaveCount(
          0
        );

        await page.locator("#program-leader-scope").selectOption(programId);
        await page
          .getByRole("button", {
            exact: true,
            name: "授予 Program Leader",
          })
          .click();
        await page.getByLabel("目前密碼").fill(staff.account.password);

        const commandRequest = page.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/v2/roles/program-leaders"
        );
        const commandResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/v2/roles/program-leaders"
        );
        await page
          .getByRole("button", { exact: true, name: "確認並授予" })
          .click();
        const [request, response] = await Promise.all([
          commandRequest,
          commandResponse,
        ]);
        expect(request.postDataJSON()).toEqual({
          action: "granted",
          authorityAssignmentId,
          operationKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
          scopeId: programId,
          targetUserId,
        });
        expect(response.status()).toBe(201);
        await expect(page.getByRole("status")).toContainText("已授予");
      }
    );
  }
);
