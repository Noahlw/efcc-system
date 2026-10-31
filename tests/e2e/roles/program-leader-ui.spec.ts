import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

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
        const targetUserId = await caseApp.provision.account(target);
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
            name: /^人員權責/u,
          });
          await expect(managerEntry).toBeVisible();
          await managerEntry.click();
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await openRoleTask(page, target, "program-leaders");

          await expect(
            page.getByText(target.username, { exact: true })
          ).toBeVisible();
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);
          await page
            .getByRole("button", {
              exact: true,
              name: `讀取聚會測試部門${suffix}的聚會職務`,
            })
            .click();
          const choice = page.getByRole("checkbox", {
            exact: true,
            name: `聚會負責人：聚會測試名稱${suffix}`,
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
            "person-program-duties",
            presentation
          );

          let lostGrantResponse = false;
          let proofOperationKey = "";
          const reconciledOperationKeys: string[] = [];
          await page.route(
            "**/api/v2/roles/scoped-department-managers**",
            async (route) => {
              const request = route.request();
              const requestUrl = new URL(request.url());
              if (
                request.method() === "POST" &&
                requestUrl.pathname ===
                  "/api/v2/roles/scoped-department-managers/reconcile"
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
                requestUrl.pathname ===
                  "/api/v2/roles/scoped-department-managers"
              ) {
                const response = await route.fetch();
                if (response.status() === 403) {
                  expect(await response.json()).toMatchObject({
                    error: { code: "password_confirmation_required" },
                  });
                  proofOperationKey = request.postDataJSON().operationKey;
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
              "SELECT (SELECT count(*) FROM program_leader_assignment WHERE user_id = ? AND program_id = ?) AS assignments, (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history, (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_granted') AS audits, (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts"
            )
            .bind(
              targetUserId,
              programId,
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
          const assignment = page.getByRole("article", {
            name: target.fullName,
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
            .getByRole("link", { exact: true, name: "編輯職務" })
            .click();
          await page
            .getByRole("button", {
              exact: true,
              name: `讀取聚會測試部門${suffix}的聚會職務`,
            })
            .click();
          await choice.uncheck();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(assignment).toBeVisible();
          await expect(
            assignment.getByText(`聚會測試名稱${suffix}`, { exact: false })
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
        const targetUserId = await caseApp.provision.account(target);
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
        await caseApp.db
          .prepare(
            "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, admin.userId)
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
        const reconciledOperationKeys: string[] = [];
        const actorAKey = `efcc.program-leader.operation.v1:${encodeURIComponent(admin.userId)}`;
        const actorBKey = `efcc.program-leader.operation.v1:${encodeURIComponent(nextAdminUserId)}`;
        let commandCaptured = false;
        try {
          const page = await context.newPage();
          await signInAdmin(page, admin.username, admin.password);
          await page.goto("/staff/roles/program-leaders");
          await openPersonOverview(page, target);

          await page.route("**/api/v2/roles/**", async (route) => {
            const request = route.request();
            const requestUrl = new URL(request.url());
            if (
              request.method() === "POST" &&
              requestUrl.pathname === "/api/v2/roles/program-leaders/reconcile"
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
            await route.continue();
          });

          const originalDispatch = dispatchOriginalRole(
            page,
            admin,
            "program-leader",
            {
              action: "granted",
              scopeId: programId,
              targetUserId,
            }
          );
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

          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("button", { name: new RegExp(target.fullName, "u") })
          ).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(page.getByLabel("目前密碼")).toHaveCount(0);
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有聚會負責人職務操作",
            })
          ).toHaveCount(0);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(JSON.stringify(storedOperation));
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();

          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          await originalDispatch;
          await expect(search).toHaveValue("");
          await expect(
            page.getByRole("heading", { exact: true, name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有聚會負責人職務操作",
            })
          ).toHaveCount(0);
          await page.goto("about:blank");

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
          await page.goto(
            `/roles/program-leaders?picker=grant&department=${departmentId}&program=${programId}`
          );
          await expect(page).toHaveURL(
            (url) =>
              url.pathname === "/roles/program-leaders" &&
              !url.searchParams.has("picker")
          );
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("list", { name: "候選會友" })
          ).toHaveCount(0);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(JSON.stringify(storedOperation));
          await page.goto("/staff/roles/program-leaders");
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核原有聚會負責人職務操作",
            })
          ).toBeVisible();
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();
          await page
            .getByRole("button", {
              exact: true,
              name: "查核原有聚會負責人職務操作",
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
      "Staff cannot see the Program Leader entry or open its page",
      async ({ staffPage: page }) => {
        await page.goto("/staff/accounts");
        await expect(
          page.getByRole("link", { name: /^人員權責/u })
        ).toHaveCount(0);

        await page.goto("/staff/roles/program-leaders");
        await expect(page).toHaveURL(/\/$/u);
        await expect(
          page.getByRole("link", { name: /^人員權責/u })
        ).toHaveCount(0);
        await expect(
          page.getByRole("heading", { exact: true, name: "選擇部門" })
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { exact: true, name: "指派負責人" })
        ).toHaveCount(0);
        await page.goto("/staff/accounts");
        await expect(page).toHaveURL(/\/staff\/accounts$/u);
        await expect(
          page.getByRole("link", { name: /^人員權責/u })
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

        const initialSearchResponse = page.request.get(
          "/api/v2/roles/program-leaders?q=&page=1"
        );
        const initialProgramsResponse = page.request.get(
          "/api/v2/roles/program-leaders/programs?page=1"
        );
        await page.goto("/staff/roles/program-leaders");
        await expect(page).toHaveURL(/\/roles\/people$/u);

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

        const candidateResponse = page.request.get(
          `/api/v2/roles/program-leaders?q=${encodeURIComponent(target.username)}&page=1`
        );
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

        const personResponse = page.request.get(
          `/api/v2/roles/program-leaders/${encodeURIComponent(targetUserId)}?assignmentPage=1`
        );
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

        await openRoleTask(page, target, "program-leaders");
        await page
          .getByRole("button", {
            exact: true,
            name: `讀取角色委派部門${suffix}的聚會職務`,
          })
          .click();
        await page
          .getByRole("checkbox", {
            exact: true,
            name: `聚會負責人：角色委派聚會${suffix}`,
          })
          .check();

        const commandRequest = page.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            new URL(request.url()).pathname ===
              "/api/v2/roles/scoped-department-managers"
        );
        const commandResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              "/api/v2/roles/scoped-department-managers"
        );
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const [request, response] = await Promise.all([
          commandRequest,
          commandResponse,
        ]);
        expect(request.postDataJSON()).toEqual({
          authorityAssignmentId,
          changes: [
            {
              action: "granted",
              expectedDepartmentId: departmentId,
              role: "program_leader",
              scopeId: programId,
            },
          ],
          operationKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
          targetUserId,
        });
        expect(response.status()).toBe(201);
        await expect(
          page.getByRole("article", { name: target.fullName })
        ).toBeVisible();
      }
    );
  }
);
