import { randomBytes, randomUUID } from "node:crypto";

import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

interface Person {
  fullName: string;
  password: string;
  userId: string;
  username: string;
}

const person = async (
  app: NativeApp,
  prefix: string,
  role: "admin" | "member"
): Promise<Person> => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const username = `${prefix}.${suffix}`;
  const password = "Synthetic-connected-role-password!";
  const fullName = `陳連接測試${prefix}${suffix}`;
  const userId = await app.provision.account({
    email: `${username}@example.com`,
    fullName,
    membershipStatus: "active",
    password,
    role,
    username,
  });
  return { fullName, password, userId, username };
};

const login = async (context: APIRequestContext, account: Person) => {
  const response = await context.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
};

const confirm = async (context: APIRequestContext, account: Person) => {
  const response = await context.post("/api/v2/account/password-confirmation", {
    data: { operationKey: randomUUID(), password: account.password },
  });
  expect(response.status()).toBe(201);
};

const send = async (
  context: APIRequestContext,
  path: string,
  input: object
) => {
  const response = await context.post(path, { data: input });
  expect(response.status()).toBe(201);
  return response.json();
};

const headers = (origin: string) => {
  const bytes = randomBytes(2);
  return { "cf-connecting-ip": `198.19.${bytes[0]}.${bytes[1]}`, origin };
};

dedicatedTest.describe(
  "Connected role history and current access",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-history",
      "@risk-privacy",
      "@risk-recovery",
      "@risk-session",
      "@risk-presentation",
      "@home",
    ],
  },
  () => {
    dedicatedTest(
      "single and both aggregate senders reach only each recipient's historical Inbox while current access changes",
      async ({ browser, caseApp }, testInfo) => {
        const admin = await person(caseApp, "connected.admin", "admin");
        const manager = await person(caseApp, "connected.manager", "member");
        const first = await person(caseApp, "connected.first", "member");
        const second = await person(caseApp, "connected.second", "member");
        const departmentA = randomUUID();
        const departmentB = randomUUID();
        const departmentC = randomUUID();
        const programP = randomUUID();
        const programQ = randomUUID();
        const suffix = randomUUID().slice(0, 8);
        const nameA = `舊主管部門${suffix}`;
        const nameB = `現任主管部門${suffix}`;
        const nameC = `另一主管部門${suffix}`;
        const nameP = `批次聚會${suffix}`;
        const nameQ = `單一聚會${suffix}`;
        const noticeP = `保留聚會消息${suffix}`;
        const noticeQ = `撤回聚會消息${suffix}`;
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department(id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentA, nameA),
          caseApp.db
            .prepare(
              "INSERT INTO department(id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentB, nameB),
          caseApp.db
            .prepare(
              "INSERT INTO department(id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentC, nameC),
          caseApp.db
            .prepare(
              "INSERT INTO program(id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(programP, departmentB, nameP),
          caseApp.db
            .prepare(
              "INSERT INTO program(id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(programQ, departmentC, nameQ),
          caseApp.db
            .prepare(
              "INSERT INTO department_membership(id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), first.userId, departmentB),
          caseApp.db
            .prepare(
              "INSERT INTO department_membership(id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), second.userId, departmentB),
          caseApp.db
            .prepare(
              "INSERT INTO notice(id,title,body,scope_type,scope_id,published_at,created_at) VALUES (?,?,?,'program',?,unixepoch(),unixepoch())"
            )
            .bind(randomUUID(), noticeP, "聚會範圍消息", programP),
          caseApp.db
            .prepare(
              "INSERT INTO notice(id,title,body,scope_type,scope_id,published_at,created_at) VALUES (?,?,?,'program',?,unixepoch(),unixepoch())"
            )
            .bind(randomUUID(), noticeQ, "聚會範圍消息", programQ),
        ]);
        const contexts: BrowserContext[] = [];
        const open = async (account: Person) => {
          const context = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: headers(caseApp.origin),
          });
          contexts.push(context);
          await login(context.request, account);
          return context;
        };
        try {
          const adminContext = await open(admin);
          const managerContext = await open(manager);
          const firstContext = await open(first);
          const secondContext = await open(second);
          await confirm(adminContext.request, admin);
          const singleKey = randomUUID();
          await send(
            adminContext.request,
            "/api/v2/roles/department-managers",
            {
              action: "granted",
              operationKey: singleKey,
              scopeId: departmentA,
              targetUserId: manager.userId,
            }
          );
          const personKey = randomUUID();
          await send(
            adminContext.request,
            "/api/v2/roles/scoped-department-managers",
            {
              changes: [
                {
                  action: "granted",
                  role: "department_manager",
                  scopeId: departmentB,
                },
                {
                  action: "granted",
                  role: "department_manager",
                  scopeId: departmentC,
                },
              ],
              operationKey: personKey,
              targetUserId: manager.userId,
            }
          );
          const assignmentA = await caseApp.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE user_id=? AND department_id=?"
            )
            .bind(manager.userId, departmentA)
            .first<{ id: string }>();
          const assignmentB = await caseApp.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE user_id=? AND department_id=?"
            )
            .bind(manager.userId, departmentB)
            .first<{ id: string }>();
          if (!assignmentA || !assignmentB) {
            throw new Error("Expected current Department Manager witnesses");
          }
          await confirm(managerContext.request, manager);
          const batchKey = randomUUID();
          await send(
            managerContext.request,
            "/api/v2/roles/program-leader-grant-batches",
            {
              authorityAssignmentId: assignmentB.id,
              authorityKind: "department_manager",
              expectedDepartmentId: departmentB,
              operationKey: batchKey,
              scopeId: programP,
              targetUserIds: [first.userId, second.userId],
            }
          );
          const programKey = randomUUID();
          await send(adminContext.request, "/api/v2/roles/program-leaders", {
            action: "granted",
            operationKey: programKey,
            scopeId: programQ,
            targetUserId: first.userId,
          });
          const programAssignment = await caseApp.db
            .prepare(
              "SELECT id FROM program_leader_assignment WHERE user_id=? AND program_id=?"
            )
            .bind(first.userId, programQ)
            .first<{ id: string }>();
          if (!programAssignment) {
            throw new Error("Expected current Program Leader witness");
          }
          const firstPage = await firstContext.newPage();
          await firstPage.goto("/");
          const homeNotices = firstPage.getByRole("region", {
            name: "教會消息",
          });
          await expect(
            homeNotices.getByText(noticeP, { exact: true })
          ).toBeVisible();
          await expect(
            homeNotices.getByText(noticeQ, { exact: true })
          ).toBeVisible();
          await send(adminContext.request, "/api/v2/roles/program-leaders", {
            action: "withdrawn",
            expectedAssignmentId: programAssignment.id,
            operationKey: randomUUID(),
            scopeId: programQ,
            targetUserId: first.userId,
          });
          await send(
            adminContext.request,
            "/api/v2/roles/department-managers",
            {
              action: "withdrawn",
              expectedAssignmentId: assignmentA.id,
              operationKey: randomUUID(),
              scopeId: departmentA,
              targetUserId: manager.userId,
            }
          );
          await caseApp.db.batch([
            caseApp.db
              .prepare("UPDATE program SET name=? WHERE id=?")
              .bind(`改名後聚會${suffix}`, programQ),
            caseApp.db
              .prepare("UPDATE department SET name=? WHERE id=?")
              .bind(`改名後部門${suffix}`, departmentA),
          ]);
          await firstPage.reload();
          await expect(
            homeNotices.getByText(noticeP, { exact: true })
          ).toBeVisible();
          await expect(
            homeNotices.getByText(noticeQ, { exact: true })
          ).toHaveCount(0);
          const firstInboxResponse =
            await firstContext.request.get("/api/v2/inbox");
          expect(firstInboxResponse.status()).toBe(200);
          const firstInbox = await firstInboxResponse.json();
          expect(firstInbox.data.roleChanges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: "granted",
                createdAt: expect.any(Number),
                role: "program_leader",
                scopeName: nameP,
              }),
              expect.objectContaining({
                action: "granted",
                createdAt: expect.any(Number),
                role: "program_leader",
                scopeName: nameQ,
              }),
              expect.objectContaining({
                action: "withdrawn",
                createdAt: expect.any(Number),
                role: "program_leader",
                scopeName: nameQ,
              }),
            ])
          );
          expect(firstInbox.data.roleChanges).toHaveLength(3);
          const firstText = JSON.stringify(firstInbox);
          expect(firstText).not.toContain(`改名後聚會${suffix}`);
          for (const secret of [
            admin.userId,
            admin.username,
            manager.userId,
            manager.username,
            first.userId,
            second.userId,
            second.fullName,
            second.username,
            singleKey,
            personKey,
            batchKey,
            programKey,
          ]) {
            expect(firstText).not.toContain(secret);
          }
          expect(
            Object.keys(firstInbox.data.roleChanges[0]).toSorted()
          ).toEqual(["action", "createdAt", "role", "scopeName"]);
          const secondInboxResponse =
            await secondContext.request.get("/api/v2/inbox");
          const secondInbox = await secondInboxResponse.json();
          expect(secondInboxResponse.status()).toBe(200);
          expect(secondInbox.data.roleChanges).toEqual([
            expect.objectContaining({
              action: "granted",
              role: "program_leader",
              scopeName: nameP,
            }),
          ]);
          expect(JSON.stringify(secondInbox)).not.toContain(nameQ);
          const secondPage = await secondContext.newPage();
          await secondPage.goto("/inbox");
          const secondHistory = secondPage.getByRole("list", {
            name: "收件紀錄",
          });
          await expect(
            secondHistory.getByText(nameP, { exact: true })
          ).toBeVisible();
          await expect(
            secondHistory.getByText(nameQ, { exact: true })
          ).toHaveCount(0);
          await expect(
            secondHistory.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          const managerInboxResponse =
            await managerContext.request.get("/api/v2/inbox");
          expect(managerInboxResponse.status()).toBe(200);
          const managerInbox = await managerInboxResponse.json();
          expect(managerInbox.data.roleChanges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: "granted",
                role: "department_manager",
                scopeName: nameA,
              }),
              expect.objectContaining({
                action: "withdrawn",
                role: "department_manager",
                scopeName: nameA,
              }),
              expect.objectContaining({
                action: "granted",
                role: "department_manager",
                scopeName: nameB,
              }),
              expect.objectContaining({
                action: "granted",
                role: "department_manager",
                scopeName: nameC,
              }),
            ])
          );
          expect(managerInbox.data.roleChanges).toHaveLength(4);
          expect(JSON.stringify(managerInbox)).not.toContain(
            `改名後部門${suffix}`
          );
          expect(JSON.stringify(managerInbox)).not.toContain(first.fullName);
          await firstPage.goto("/inbox");
          const history = firstPage.getByRole("list", { name: "收件紀錄" });
          await expect(history.getByText(nameP, { exact: true })).toBeVisible();
          await expect(history.getByText(nameQ, { exact: true })).toHaveCount(
            2
          );
          await expect(
            history.getByRole("heading", { name: "聚會負責人職責已撤回" })
          ).toBeVisible();
          await expect(
            history.getByText(second.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            history.getByText(second.username, { exact: true })
          ).toHaveCount(0);
          await expect(
            history.getByText(batchKey, { exact: true })
          ).toHaveCount(0);
          await qualifyPresentation(
            firstPage,
            testInfo,
            "s3-connected-recipient-inbox",
            {
              criticalAction: history.getByRole("heading", {
                name: "聚會負責人職責已撤回",
              }),
              drafts: firstPage.locator("input"),
              masks: [firstPage.getByRole("navigation", { name: "主要導覽" })],
            }
          );
          await firstPage
            .getByRole("link", { exact: true, name: "帳戶" })
            .click();
          await expect(
            firstPage.getByRole("heading", { exact: true, name: "帳戶" })
          ).toBeVisible();
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET membership_status='deactivated' WHERE user_id=?"
            )
            .bind(second.userId)
            .run();
          const denied = await secondContext.request.get("/api/v2/inbox");
          expect(denied.status()).toBe(403);
          expect(await denied.text()).not.toContain(nameP);
          await secondPage.goto("/inbox");
          await expect(
            secondPage.getByText(nameP, { exact: true })
          ).toHaveCount(0);
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET membership_status='active' WHERE user_id=?"
            )
            .bind(second.userId)
            .run();
          const restored = await secondContext.request.get("/api/v2/inbox");
          expect(restored.status()).toBe(200);
          const restoredBody = await restored.json();
          expect(restoredBody.data.roleChanges).toEqual(
            secondInbox.data.roleChanges
          );
          const currentDepartments = await managerContext.request.get(
            "/api/v2/roles/program-leaders/departments?page=1"
          );
          expect(currentDepartments.status()).toBe(200);
          const currentDepartmentsBody = await currentDepartments.json();
          expect(
            currentDepartmentsBody.data.departments
              .map((entry: { id: string }) => entry.id)
              .toSorted()
          ).toEqual([departmentB, departmentC].toSorted());
          const managerPage = await managerContext.newPage();
          await managerPage.goto("/inbox");
          const managerHistory = managerPage.getByRole("list", {
            name: "收件紀錄",
          });
          await expect(
            managerHistory.getByText(nameA, { exact: true })
          ).toHaveCount(2);
          await expect(
            managerHistory.getByText(nameB, { exact: true })
          ).toBeVisible();
          await expect(
            managerHistory.getByText(nameC, { exact: true })
          ).toBeVisible();
          await expect(
            managerPage.getByRole("link", { exact: true, name: "管理" })
          ).toBeVisible();
          await managerPage
            .getByRole("link", { exact: true, name: "帳戶" })
            .click();
          await expect(
            managerPage.getByRole("heading", { exact: true, name: "帳戶" })
          ).toBeVisible();
          await expect(
            managerPage.getByRole("link", { exact: true, name: "管理" })
          ).toBeVisible();
          await managerPage.goto("/");
          const manage = managerPage.getByRole("link", {
            exact: true,
            name: "管理",
          });
          await expect(manage).toBeVisible();
          await manage.click();
          await expect(managerPage).toHaveURL(/\/roles\/program-leaders/u);
          await managerPage.goto(
            `/staff/roles/program-leaders?department=${departmentB}&program=${programP}`
          );
          await expect(managerPage).toHaveURL(/\/roles\/program-leaders/u);
          await expect(
            managerPage
              .getByRole("region", { name: "現任負責人" })
              .getByText(second.fullName, { exact: true })
          ).toBeVisible();
          expect(new URL(managerPage.url()).pathname).toBe(
            "/roles/program-leaders"
          );
          await expect(
            managerPage.getByText(nameA, { exact: true })
          ).toHaveCount(0);
          const signOut = await managerContext.request.post(
            "/api/auth/sign-out",
            { data: {} }
          );
          expect(signOut.status()).toBe(200);
          await login(managerContext.request, first);
          await managerPage.evaluate(() =>
            window.dispatchEvent(new Event("focus"))
          );
          await expect(
            managerPage.getByText(manager.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            managerPage.getByText(second.fullName, { exact: true })
          ).toHaveCount(0);
          await managerPage.goto("/inbox");
          await expect(
            managerPage.getByText(nameP, { exact: true })
          ).toBeVisible();
          await expect(
            managerPage.getByText(nameA, { exact: true })
          ).toHaveCount(0);
          const firstSignOut = await managerContext.request.post(
            "/api/auth/sign-out",
            { data: {} }
          );
          expect(firstSignOut.status()).toBe(200);
          await login(managerContext.request, manager);
          const assignmentC = await caseApp.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE user_id=? AND department_id=?"
            )
            .bind(manager.userId, departmentC)
            .first<{ id: string }>();
          if (!assignmentC) {
            throw new Error("Expected remaining Department Manager witness");
          }
          await send(
            adminContext.request,
            "/api/v2/roles/department-managers",
            {
              action: "withdrawn",
              expectedAssignmentId: assignmentB.id,
              operationKey: randomUUID(),
              scopeId: departmentB,
              targetUserId: manager.userId,
            }
          );
          await send(
            adminContext.request,
            "/api/v2/roles/department-managers",
            {
              action: "withdrawn",
              expectedAssignmentId: assignmentC.id,
              operationKey: randomUUID(),
              scopeId: departmentC,
              targetUserId: manager.userId,
            }
          );
          const noAuthority = await managerContext.request.get(
            "/api/v2/roles/program-leaders/departments?page=1"
          );
          expect(noAuthority.status()).toBe(403);
          await managerPage.goto("/");
          await expect(
            managerPage.getByRole("link", { exact: true, name: "管理" })
          ).toHaveCount(0);
          await managerPage.goto(
            `/staff/roles/program-leaders?department=${departmentB}&program=${programP}`
          );
          await expect(managerPage).toHaveURL(/\/$/u);
          await expect(
            managerPage.getByText(second.fullName, { exact: true })
          ).toHaveCount(0);
          await managerPage.goto("/inbox");
          await expect(
            managerPage.getByRole("link", { exact: true, name: "管理" })
          ).toHaveCount(0);
          await expect(
            managerPage.getByText(nameB, { exact: true })
          ).toHaveCount(2);
          await expect(
            managerPage.getByText(nameC, { exact: true })
          ).toHaveCount(2);
          await managerPage
            .getByRole("link", { exact: true, name: "帳戶" })
            .click();
          await expect(
            managerPage.getByRole("heading", { exact: true, name: "帳戶" })
          ).toBeVisible();
          await expect(
            managerPage.getByRole("link", { exact: true, name: "管理" })
          ).toHaveCount(0);
        } finally {
          await Promise.all(contexts.map((context) => context.close()));
        }
      }
    );
    dedicatedTest(
      "recipient Inbox cannot settle a lost committed batch or authorize a replacement Save",
      async ({ browser, caseApp }) => {
        const admin = await person(caseApp, "unknown.admin", "admin");
        const manager = await person(caseApp, "unknown.manager", "member");
        const first = await person(caseApp, "unknown.first", "member");
        const second = await person(caseApp, "unknown.second", "member");
        const departmentId = randomUUID();
        const programId = randomUUID();
        const scopeName = `未知操作聚會${randomUUID().slice(0, 8)}`;
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department(id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentId, "未知操作部門"),
          caseApp.db
            .prepare(
              "INSERT INTO program(id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, scopeName),
          caseApp.db
            .prepare(
              "INSERT INTO department_membership(id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), first.userId, departmentId),
          caseApp.db
            .prepare(
              "INSERT INTO department_membership(id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), second.userId, departmentId),
        ]);
        const adminContext = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: headers(caseApp.origin),
        });
        const managerContext = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: headers(caseApp.origin),
        });
        const recipientContext = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: headers(caseApp.origin),
        });
        try {
          await login(adminContext.request, admin);
          await confirm(adminContext.request, admin);
          await send(
            adminContext.request,
            "/api/v2/roles/department-managers",
            {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: departmentId,
              targetUserId: manager.userId,
            }
          );
          await login(managerContext.request, manager);
          await confirm(managerContext.request, manager);
          await login(recipientContext.request, first);
          const page = await managerContext.newPage();
          await page.goto(
            `/staff/roles/program-leaders?department=${departmentId}&program=${programId}`
          );
          await expect(
            page.getByRole("region", { name: "現任負責人" })
          ).toBeVisible();
          expect(new URL(page.url()).pathname).toBe("/roles/program-leaders");
          await page
            .getByRole("button", { exact: true, name: "指派負責人" })
            .click();
          await page
            .getByRole("textbox", { name: "搜尋會友" })
            .fill(first.username);
          await page
            .getByRole("button", { exact: true, name: "搜尋會友" })
            .click();
          await page
            .getByRole("button", {
              exact: true,
              name: `選取${first.fullName} · ${first.username}`,
            })
            .click();
          await page
            .getByRole("textbox", { name: "搜尋會友" })
            .fill(second.username);
          await page
            .getByRole("button", { exact: true, name: "搜尋會友" })
            .click();
          await page
            .getByRole("button", {
              exact: true,
              name: `選取${second.fullName} · ${second.username}`,
            })
            .click();
          let operationKey = "";
          let dispatches = 0;
          let reconciliations = 0;
          page.on("request", (request) => {
            if (
              new URL(request.url()).pathname ===
              "/api/v2/roles/program-leader-grant-batches/reconcile"
            ) {
              reconciliations += 1;
            }
          });
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              dispatches += 1;
              ({ operationKey } = route.request().postDataJSON());
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              await route.abort("failed");
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const reconcile = page.getByRole("button", {
            exact: true,
            name: "查核原有操作",
          });
          await expect(reconcile).toBeEnabled();
          const recipientPage = await recipientContext.newPage();
          await recipientPage.goto("/inbox");
          await expect(
            recipientPage.getByRole("heading", {
              exact: true,
              name: "獲委任為聚會負責人",
            })
          ).toBeVisible();
          await expect(
            recipientPage.getByText(scopeName, { exact: true })
          ).toBeVisible();
          await expect(reconcile).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toHaveCount(0);
          expect(dispatches).toBe(1);
          expect(reconciliations).toBe(0);
          const stored = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            manager.userId
          );
          expect(JSON.parse(stored ?? "null")).toEqual({
            actorUserId: manager.userId,
            operationKey,
          });
          const requested = page.waitForRequest(
            (request) =>
              new URL(request.url()).pathname ===
              "/api/v2/roles/program-leader-grant-batches/reconcile"
          );
          await reconcile.click();
          const original = await requested;
          expect(original.postDataJSON().operationKey).toBe(operationKey);
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(first.fullName, { exact: true })
          ).toBeVisible();
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(second.fullName, { exact: true })
          ).toBeVisible();
          expect(dispatches).toBe(1);
        } finally {
          await Promise.all([
            adminContext.close(),
            managerContext.close(),
            recipientContext.close(),
          ]);
        }
      }
    );
  }
);
