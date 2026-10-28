import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

interface LocalScope {
  manager: { username: string; password: string; userId: string };
  leader: { fullName: string; username: string; userId: string };
  department: { id: string; name: string; assignmentId: string };
  program: { id: string; name: string; assignmentId: string };
}

const entryTest = dedicatedTest.extend<{ scope: LocalScope }>({
  scope: async ({ caseApp }, use) => {
    const suffix = randomUUID().slice(0, 8);
    const manager = {
      email: `local.manager.${suffix}@example.com`,
      fullName: `陳本地部門主管${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-local-manager-password!",
      role: "member" as const,
      username: `local.manager.${suffix}`,
    };
    const leader = {
      email: `local.leader.${suffix}@example.com`,
      fullName: `陳離開部門的現任聚會負責人${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-local-leader-password!",
      role: "member" as const,
      username: `local.leader.${suffix}`,
    };
    const managerId = await caseApp.provision.account(manager);
    const leaderId = await caseApp.provision.account(leader);
    const department = {
      assignmentId: randomUUID(),
      id: randomUUID(),
      name: `很長的部門名稱用作手機及放大文字測試${suffix}`,
    };
    const program = {
      assignmentId: randomUUID(),
      id: randomUUID(),
      name: `很長的聚會名稱保持返回及標題同一行並可閱讀${suffix}`,
    };
    await caseApp.db
      .prepare(
        "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
      )
      .bind(department.id, department.name)
      .run();
    await caseApp.db
      .prepare(
        "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(program.id, department.id, program.name)
      .run();
    await caseApp.db
      .prepare(
        "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(department.assignmentId, department.id, managerId)
      .run();
    await caseApp.db
      .prepare(
        "INSERT INTO program_leader_assignment(id,program_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(program.assignmentId, program.id, leaderId)
      .run();
    // Neither manager nor existing assignee needs current Department membership for cleanup.
    await use({
      department,
      leader: { ...leader, userId: leaderId },
      manager: { ...manager, userId: managerId },
      program,
    });
  },
});

const signIn = async (
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

const openEditor = async (page: Page, scope: LocalScope) => {
  await page.goto(
    `/roles/program-leaders?department=${scope.department.id}&program=${scope.program.id}`
  );
  await expect(
    page.getByRole("heading", { exact: true, name: scope.program.name })
  ).toBeVisible();
  await page
    .getByRole("link", {
      exact: true,
      name: `編輯${scope.leader.fullName}的聚會職務`,
    })
    .click();
  await expect(
    page.getByRole("checkbox", {
      exact: true,
      name: `聚會負責人：${scope.program.name}`,
    })
  ).toBeChecked();
};

const seedLargeContext = async (
  app: NativeApp,
  scope: LocalScope,
  index = 0
): Promise<void> => {
  if (index >= 26) {
    return;
  }
  const departmentId = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
    )
    .bind(departmentId, `000部門${String(index).padStart(2, "0")}`)
    .run();
  await app.db
    .prepare(
      "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(randomUUID(), departmentId, scope.manager.userId)
    .run();
  await app.db
    .prepare(
      "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(
      randomUUID(),
      scope.department.id,
      `000聚會${String(index).padStart(2, "0")}`
    )
    .run();
  if (index < 25) {
    const suffix = randomUUID().slice(0, 8);
    const userId = await app.provision.account({
      email: `paged.leader.${suffix}@example.com`,
      fullName: `陳甲現任${String(index).padStart(2, "0")}`,
      membershipStatus: "active",
      password: "Synthetic-paged-leader-password!",
      role: "member",
      username: `paged.leader.${suffix}`,
    });
    await app.db
      .prepare(
        "INSERT INTO program_leader_assignment(id,program_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(randomUUID(), scope.program.id, userId)
      .run();
  }
  await seedLargeContext(app, scope, index + 1);
};

const expectLocalAdminGrantConflict = async (
  page: Page,
  app: NativeApp,
  scope: LocalScope,
  actor: { password: string; userId: string }
) => {
  const membershipId = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department_membership(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(membershipId, scope.department.id, scope.leader.userId)
    .run();
  await page.getByRole("button", { exact: true, name: "指派負責人" }).click();
  await page
    .getByRole("textbox", { name: "搜尋會友" })
    .fill(scope.leader.username);
  await page.getByRole("button", { exact: true, name: "搜尋會友" }).click();
  await page
    .getByRole("button", { name: new RegExp(scope.leader.fullName, "u") })
    .click();
  let operationKey = "";
  await page.route(
    "**/api/v2/roles/program-leader-grant-batches",
    async (route) => {
      ({ operationKey } = route.request().postDataJSON());
      // Change the real candidate predicate after the UI's last authority probe.
      // Independent Admin authority survives, but must not authorize this local grant.
      await app.db
        .prepare("DELETE FROM department_membership WHERE id=?")
        .bind(membershipId)
        .run();
      await route.continue();
    }
  );
  const command = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        "/api/v2/roles/program-leader-grant-batches"
  );
  await page.getByRole("button", { exact: true, name: "儲存變更" }).click();
  const response = await command;
  expect(response.status()).toBe(409);
  await expect(
    page.getByRole("button", { exact: true, name: "查核原有操作" })
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const effects = await app.db
    .prepare(
      `SELECT
      (SELECT COUNT(*) FROM program_leader_assignment WHERE program_id=? AND user_id=?) AS assignments,
      (SELECT COUNT(*) FROM role_assignment_history WHERE role='program_leader' AND action='granted' AND scope_id=? AND target_user_id=?) AS history,
      (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=?) AS receipts`
    )
    .bind(
      scope.program.id,
      scope.leader.userId,
      scope.program.id,
      scope.leader.userId,
      actor.userId,
      operationKey
    )
    .first<{ assignments: number; history: number; receipts: number }>();
  expect(effects).toEqual({ assignments: 0, history: 0, receipts: 0 });
  const stillAdmin = await page
    .context()
    .request.get("/api/v2/roles/program-leaders/programs?page=1");
  expect(stillAdmin.status()).toBe(200);
  await page.unroute("**/api/v2/roles/program-leader-grant-batches");
};

entryTest.describe(
  "Department-origin shared scoped task",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-privacy",
      "@risk-session",
      "@risk-recovery",
      "@risk-resilience",
      "@risk-presentation",
    ],
  },
  () => {
    entryTest(
      "a Member DM withdraws a departed existing Leader through the shared task and returns to the fresh exact Program roster",
      async ({ scope, browser, caseApp, extraHTTPHeaders }, testInfo) => {
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await page.goto("/sign-in");
          await page
            .getByRole("textbox", { name: "Username" })
            .fill(scope.manager.username);
          await page
            .getByRole("textbox", { exact: true, name: "密碼" })
            .fill(scope.manager.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);
          await page.getByRole("link", { exact: true, name: "管理" }).click();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: scope.department.name,
            })
          ).toBeVisible();
          await page
            .getByRole("button", {
              exact: true,
              name: `管理${scope.program.name}的負責人`,
            })
            .click();
          await expect(
            page.getByRole("heading", { exact: true, name: scope.program.name })
          ).toBeVisible();
          const roster = page.getByRole("region", { name: "現任負責人" });
          await expect(
            roster.getByText(scope.leader.fullName, { exact: true })
          ).toBeVisible();
          const edit = roster.getByRole("link", {
            exact: true,
            name: `編輯${scope.leader.fullName}的聚會職務`,
          });
          await qualifyPresentation(
            page,
            testInfo,
            "department-program-roster",
            {
              criticalAction: edit,
              drafts: page.locator("input"),
              focus: edit,
              masks: [
                roster.getByText(scope.leader.fullName, { exact: true }),
                roster.getByText(scope.leader.username, { exact: true }),
              ],
            }
          );
          await page.setViewportSize({ height: 480, width: 320 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          const title = await page
            .getByRole("heading", { exact: true, name: scope.program.name })
            .boundingBox();
          const back = await page
            .getByRole("link", {
              exact: true,
              name: `返回${scope.department.name}`,
            })
            .boundingBox();
          if (!title || !back) {
            throw new Error("The Program title and Back must be rendered");
          }
          expect(title.x).toBeGreaterThanOrEqual(back.x + back.width);
          expect(back.y + back.height / 2).toBeGreaterThanOrEqual(title.y);
          expect(back.y + back.height / 2).toBeLessThanOrEqual(
            title.y + title.height
          );
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "";
          });
          const returnHref =
            new URL(page.url()).pathname + new URL(page.url()).search;
          await roster
            .getByRole("link", {
              exact: true,
              name: `編輯${scope.leader.fullName}的聚會職務`,
            })
            .click();
          await expect(page).toHaveURL(/\/roles\/people\/duties\?/u);
          await expect(page.getByRole("checkbox")).toHaveCount(1);
          const choice = page.getByRole("checkbox", {
            exact: true,
            name: `聚會負責人：${scope.program.name}`,
          });
          await expect(choice).toBeChecked();
          await choice.uncheck();
          await qualifyPresentation(
            page,
            testInfo,
            "department-program-cleanup-task",
            {
              criticalAction: page.getByRole("button", {
                exact: true,
                name: "儲存",
              }),
              drafts: page.locator("input"),
              focus: choice,
              masks: [
                page.getByRole("heading", {
                  exact: true,
                  name: scope.leader.fullName,
                }),
              ],
            }
          );
          await page.setViewportSize({ height: 480, width: 320 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          await choice.focus();
          const footer = page.getByRole("contentinfo", { name: "任務操作" });
          await expect
            .poll(async () => {
              const field = await choice.boundingBox();
              const actions = await footer.boundingBox();
              return field && actions
                ? field.y + field.height - actions.y
                : Number.POSITIVE_INFINITY;
            })
            .toBeLessThanOrEqual(1);
          await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "";
          });
          const denied = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leaders"
          );
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const deniedResponse = await denied;
          expect(deniedResponse.status()).toBe(403);
          const dialog = page.getByRole("dialog");
          await expect(
            dialog.getByRole("region", { name: "這次確認的工作" })
          ).toContainText("撤回聚會負責人");
          await dialog
            .getByRole("textbox", { exact: true, name: "目前密碼" })
            .fill(scope.manager.password);
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(
            dialog.getByText("伺服器已確認「確認目前密碼」完成。", {
              exact: true,
            })
          ).toBeVisible();
          const refreshed = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/roles/people/duties" &&
              response.request().headers().rsc === "1"
          );
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          const refreshedResponse = await refreshed;
          await refreshedResponse.finished();
          await expect(dialog).toHaveCount(0);
          await expect(choice).not.toBeChecked();
          const before = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.program.id}/leaders?page=1`
          );
          expect(before.status()).toBe(200);
          const beforeBody = await before.json();
          expect(beforeBody.data.leaders).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ userId: scope.leader.userId }),
            ])
          );
          const committed = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leaders"
          );
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const response = await committed;
          expect(response.status()).toBe(201);
          expect(response.request().headers()["x-efcc-expected-actor-id"]).toBe(
            scope.manager.userId
          );
          expect(response.request().postDataJSON()).toEqual({
            action: "withdrawn",
            authorityAssignmentId: scope.department.assignmentId,
            authorityKind: "department_manager",
            expectedAssignmentId: scope.program.assignmentId,
            operationKey: expect.any(String),
            scopeId: scope.program.id,
            targetUserId: scope.leader.userId,
          });
          await expect(page).toHaveURL(
            new URL(returnHref, caseApp.origin).href
          );
          await expect(
            page.getByRole("heading", { exact: true, name: scope.program.name })
          ).toBeVisible();
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          await page
            .getByRole("link", {
              exact: true,
              name: `返回${scope.department.name}`,
            })
            .click();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: scope.department.name,
            })
          ).toBeVisible();
        } finally {
          await context.close();
        }
      }
    );

    entryTest(
      "a committed withdrawal with lost response restores only its original key even when the exact-assignee baseline is now 404",
      async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, scope.manager);
          const proof = await context.request.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: scope.manager.password,
              },
            }
          );
          expect(proof.status()).toBe(201);
          await openEditor(page, scope);
          const taskHref = page.url();
          let originalKey = "";
          let posts = 0;
          await page.route("**/api/v2/roles/program-leaders", async (route) => {
            posts += 1;
            originalKey = route.request().postDataJSON().operationKey;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            await route.abort("failed");
          });
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `聚會負責人：${scope.program.name}`,
            })
            .uncheck();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const missing = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.program.id}/leaders/${scope.leader.userId}`
          );
          expect(missing.status()).toBe(404);
          await page.reload();
          await expect(page).toHaveURL(taskHref);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(scope.program.name, { exact: true })
          ).toHaveCount(0);
          const stored = await page.evaluate(
            (actor) =>
              JSON.parse(
                sessionStorage.getItem(
                  `efcc.program-leader.operation.v1:${encodeURIComponent(actor)}`
                ) ?? "null"
              ),
            scope.manager.userId
          );
          expect(stored).toEqual({
            actorUserId: scope.manager.userId,
            operationKey: originalKey,
          });
          const reconciled = page.waitForRequest(
            (request) =>
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/program-leaders/reconcile"
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const reconciledRequest = await reconciled;
          expect(reconciledRequest.postDataJSON()).toEqual({
            authorityKind: "department_manager",
            operationKey: originalKey,
          });
          await expect(
            page.getByRole("heading", { exact: true, name: scope.program.name })
          ).toBeVisible();
          expect(new URL(page.url()).searchParams.get("program")).toBe(
            scope.program.id
          );
          expect(new URL(page.url()).searchParams.get("department")).toBe(
            scope.department.id
          );
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          expect(posts).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    entryTest(
      "bounded Department, Program and Leader pages preserve search and exact Back context through Reset and Keep/Discard",
      async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
        await seedLargeContext(caseApp, scope);
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET membership_status='deactivated' WHERE user_id=?"
          )
          .bind(scope.leader.userId)
          .run();
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, scope.manager);
          await page.goto("/roles/program-leaders");
          await expect(
            page.getByRole("heading", { exact: true, name: "選擇部門" })
          ).toBeVisible();
          await expect(
            page
              .getByRole("region", { name: "可管理的部門" })
              .getByRole("button", { name: /^進入/u })
          ).toHaveCount(25);
          await expect(
            page.getByRole("button", {
              exact: true,
              name: `進入${scope.department.name}`,
            })
          ).toHaveCount(0);
          const departmentPageResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
              "/api/v2/roles/program-leaders/departments"
          );
          await page
            .getByRole("button", { exact: true, name: "下一頁部門" })
            .click();
          const nextDepartments = await departmentPageResponse;
          expect(nextDepartments.status()).toBe(200);
          const nextDepartmentBody = await nextDepartments.json();
          expect(nextDepartmentBody.data.page).toBe(2);
          await expect(page).toHaveURL(/departmentPage=2/u);
          await page
            .getByRole("button", {
              exact: true,
              name: `進入${scope.department.name}`,
            })
            .click();
          await expect(
            page.getByRole("button", { name: /^管理.*的負責人$/u })
          ).toHaveCount(25);
          await expect(
            page.getByRole("button", {
              exact: true,
              name: `管理${scope.program.name}的負責人`,
            })
          ).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "下一頁聚會" })
            .click();
          await page
            .getByRole("button", {
              exact: true,
              name: `管理${scope.program.name}的負責人`,
            })
            .click();
          const roster = page.getByRole("region", { name: "現任負責人" });
          await expect(roster.getByRole("listitem")).toHaveCount(25);
          await expect(
            roster.getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "下一頁負責人" })
            .click();
          await expect(roster.getByRole("listitem")).toHaveCount(1);
          await expect(
            roster.getByText(scope.leader.fullName, { exact: true })
          ).toBeVisible();
          await page
            .getByRole("button", { exact: true, name: "指派負責人" })
            .click();
          await page
            .getByRole("textbox", { name: "搜尋會友" })
            .fill(scope.leader.username);
          const searched = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname.endsWith("/candidates") &&
              response.request().method() === "GET"
          );
          await page
            .getByRole("button", { exact: true, name: "搜尋會友" })
            .click();
          const searchedResponse = await searched;
          expect(searchedResponse.status()).toBe(200);
          await expect(
            page.getByRole("list", { name: "候選會友" }).getByRole("listitem")
          ).toHaveCount(0);
          await page
            .getByRole("link", { exact: true, name: "返回聚會" })
            .click();
          const returnContext = {
            department: scope.department.id,
            departmentPage: "2",
            program: scope.program.id,
            programPage: "2",
            q: scope.leader.username,
            rosterPage: "2",
          };
          const isRosterReturn = (url: URL) =>
            url.pathname === "/roles/program-leaders" &&
            url.searchParams.size === Object.keys(returnContext).length &&
            Object.entries(returnContext).every(
              ([key, value]) => url.searchParams.get(key) === value
            );
          await expect(page).toHaveURL(isRosterReturn);
          await roster
            .getByRole("link", {
              exact: true,
              name: `編輯${scope.leader.fullName}的聚會職務`,
            })
            .click();
          const choice = page.getByRole("checkbox", {
            exact: true,
            name: `聚會負責人：${scope.program.name}`,
          });
          await expect(choice).toBeChecked();
          await choice.uncheck();
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(choice).toBeChecked();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await choice.uncheck();
          await page
            .getByRole("link", { exact: true, name: "返回聚會" })
            .click();
          await page
            .getByRole("button", { exact: true, name: "繼續編輯" })
            .click();
          await expect(choice).not.toBeChecked();
          await page
            .getByRole("link", { exact: true, name: "返回聚會" })
            .click();
          await page
            .getByRole("button", { exact: true, name: "放棄變更" })
            .click();
          await expect(page).toHaveURL(isRosterReturn);
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(scope.leader.fullName, { exact: true })
          ).toBeVisible();
          expect(new URL(page.url()).searchParams.get("departmentPage")).toBe(
            "2"
          );
          expect(new URL(page.url()).searchParams.get("programPage")).toBe("2");
          expect(new URL(page.url()).searchParams.get("rosterPage")).toBe("2");
          expect(new URL(page.url()).searchParams.get("q")).toBe(
            scope.leader.username
          );
          await page
            .getByRole("button", { exact: true, name: "指派負責人" })
            .click();
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveValue(scope.leader.username);
          await page
            .getByRole("link", { exact: true, name: "返回聚會" })
            .click();
          const proof = await context.request.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: scope.manager.password,
              },
            }
          );
          expect(proof.status()).toBe(201);
          await page
            .getByRole("link", {
              exact: true,
              name: `編輯${scope.leader.fullName}的聚會職務`,
            })
            .click();
          await choice.uncheck();
          const withdrawn = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leaders"
          );
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          const withdrawnResponse = await withdrawn;
          expect(withdrawnResponse.status()).toBe(201);
          await expect(page).toHaveURL(isRosterReturn);
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "上一頁負責人" })
          ).toBeEnabled();
        } finally {
          await context.close();
        }
      }
    );

    entryTest(
      "a Department Manager regrant cannot revive a focused cleanup draft or stale direct task link",
      async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, scope.manager);
          await openEditor(page, scope);
          const staleHref = page.url();
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `聚會負責人：${scope.program.name}`,
            })
            .uncheck();
          let posts = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/program-leaders"
            ) {
              posts += 1;
            }
          });
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id=?")
            .bind(scope.department.assignmentId)
            .run();
          await caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
            )
            .bind(randomUUID(), scope.department.id, scope.manager.userId)
            .run();
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: scope.leader.fullName,
            })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(page).toHaveURL(/\/roles\/program-leaders(?:\?|$)/u);
          await page.goto(staleHref);
          await expect(page).toHaveURL(/\/roles\/program-leaders(?:\?|$)/u);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          expect(posts).toBe(0);
          expect(
            await page.evaluate(
              (actor) =>
                sessionStorage.getItem(
                  `efcc.program-leader.operation.v1:${encodeURIComponent(actor)}`
                ),
              scope.manager.userId
            )
          ).toBeNull();
        } finally {
          await context.close();
        }
      }
    );

    entryTest(
      "a replaced Leader assignment conflicts without dispatch and only fresh explicit selection can withdraw the replacement",
      async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, scope.manager);
          const proof = await context.request.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: scope.manager.password,
              },
            }
          );
          expect(proof.status()).toBe(201);
          await openEditor(page, scope);
          const choice = page.getByRole("checkbox", {
            exact: true,
            name: `聚會負責人：${scope.program.name}`,
          });
          await choice.uncheck();
          const replacement = randomUUID();
          await caseApp.db
            .prepare("DELETE FROM program_leader_assignment WHERE id=?")
            .bind(scope.program.assignmentId)
            .run();
          await caseApp.db
            .prepare(
              "INSERT INTO program_leader_assignment(id,program_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
            )
            .bind(replacement, scope.program.id, scope.leader.userId)
            .run();
          const commands: unknown[] = [];
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/program-leaders"
            ) {
              commands.push(request.postDataJSON());
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("heading", { exact: true, name: "上次未儲存的選擇" })
          ).toBeVisible();
          expect(commands).toEqual([]);
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "按最新職務重新選擇",
            })
          ).toBeEnabled();
          await expect(choice).toBeDisabled();
          await page
            .getByRole("button", { exact: true, name: "按最新職務重新選擇" })
            .click();
          await expect(choice).toBeChecked();
          await choice.uncheck();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("heading", { exact: true, name: scope.program.name })
          ).toBeVisible();
          expect(commands).toEqual([
            expect.objectContaining({
              action: "withdrawn",
              authorityAssignmentId: scope.department.assignmentId,
              expectedAssignmentId: replacement,
              scopeId: scope.program.id,
              targetUserId: scope.leader.userId,
            }),
          ]);
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );

    entryTest(
      "a held exact-assignee read is cancelled on real account replacement and cannot restore old protected names or choices",
      async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().slice(0, 8);
        const next = {
          email: `local.next.${suffix}@example.com`,
          fullName: `陳替任帳戶${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-next-local-account!",
          role: "member" as const,
          username: `local.next.${suffix}`,
        };
        const nextId = await caseApp.provision.account(next);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        const delivered = Promise.withResolvers<null>();
        try {
          const page = await context.newPage();
          await signIn(page, scope.manager);
          await page.goto(
            `/roles/program-leaders?department=${scope.department.id}&program=${scope.program.id}`
          );
          await expect(
            page.getByRole("heading", { exact: true, name: scope.program.name })
          ).toBeVisible();
          const readPath = `/api/v2/roles/program-leaders/programs/${scope.program.id}/leaders/${scope.leader.userId}`;
          await page.route(`**${readPath}`, async (route) => {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            arrived.resolve(null);
            await release.promise;
            try {
              await route.fulfill({ response });
            } finally {
              delivered.resolve(null);
            }
          });
          await page
            .getByRole("link", {
              exact: true,
              name: `編輯${scope.leader.fullName}的聚會職務`,
            })
            .click();
          await arrived.promise;
          const cancelled = page.waitForEvent(
            "requestfailed",
            (request) => new URL(request.url()).pathname === readPath
          );
          const signedOut = await context.request.post("/api/auth/sign-out", {
            data: {},
          });
          expect(signedOut.status()).toBe(200);
          const signedIn = await context.request.post(
            "/api/auth/sign-in/username",
            {
              data: { password: next.password, username: next.username },
            }
          );
          expect(signedIn.status()).toBe(200);
          const session = await context.request.get("/api/auth/get-session");
          const sessionBody = await session.json();
          expect(sessionBody.user.id).toBe(nextId);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          release.resolve(null);
          await delivered.promise;
          await cancelled;
          await expect(
            page.getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(scope.program.name, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );

    entryTest(
      "authorized empty scope pages remain distinct from unavailable reads and crafted out-of-scope local or aggregate work stays denied",
      async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
        await caseApp.db
          .prepare("DELETE FROM program_leader_assignment WHERE id=?")
          .bind(scope.program.assignmentId)
          .run();
        await caseApp.db
          .prepare("DELETE FROM program WHERE id=?")
          .bind(scope.program.id)
          .run();
        const outsideDepartment = randomUUID();
        const outsideProgram = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
          )
          .bind(outsideDepartment, "不可管理的部門")
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(outsideProgram, outsideDepartment, "不可管理的聚會")
          .run();
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, scope.manager);
          const departmentHref = `/roles/program-leaders?department=${scope.department.id}`;
          await page.goto(departmentHref);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: scope.department.name,
            })
          ).toBeVisible();
          await expect(
            page.getByText("此部門暫時未有可管理的聚會。", { exact: true })
          ).toBeVisible();
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveCount(0);
          await page.goto("/roles/program-leaders?departmentPage=2");
          await expect(
            page.getByText("此頁沒有部門，請返回上一頁。", { exact: true })
          ).toBeVisible();
          await expect(
            page.getByRole("button", { exact: true, name: "上一頁部門" })
          ).toBeEnabled();
          await page.route(
            "**/api/v2/roles/program-leaders/programs?**",
            (route) => route.abort("failed")
          );
          await page.goto(departmentHref);
          await expect(page.getByRole("alert")).toBeVisible();
          await expect(
            page.getByText("此部門暫時未有可管理的聚會。", { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText("目前沒有可管理的部門。", { exact: true })
          ).toHaveCount(0);
          await page.unroute("**/api/v2/roles/program-leaders/programs?**");
          await page
            .getByRole("button", { exact: true, name: "重新載入工作區" })
            .click();
          await expect(
            page.getByText("此部門暫時未有可管理的聚會。", { exact: true })
          ).toBeVisible();
          const input = new URLSearchParams({
            assignment: scope.program.assignmentId,
            authority: scope.department.assignmentId,
            department: outsideDepartment,
            origin: "program",
            person: scope.leader.userId,
            program: outsideProgram,
          });
          await page.goto(`/roles/people/duties?${input}`);
          await expect(page).toHaveURL(/\/roles\/program-leaders(?:\?|$)/u);
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await expect(
            page.getByText(scope.leader.fullName, { exact: true })
          ).toHaveCount(0);
          const denied = await context.request.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                authorityAssignmentId: scope.department.assignmentId,
                changes: [
                  {
                    action: "granted",
                    expectedDepartmentId: outsideDepartment,
                    role: "program_leader",
                    scopeId: outsideProgram,
                  },
                ],
                operationKey: randomUUID(),
                targetUserId: scope.leader.userId,
              },
            }
          );
          expect(denied.status()).toBe(403);
          const outsideRoster = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${outsideProgram}/leaders?page=1`
          );
          expect(outsideRoster.status()).toBe(403);
        } finally {
          await context.close();
        }
      }
    );

    for (const role of ["member", "staff", "admin"] as const) {
      entryTest(
        `${role} enters Department work only with a current DM assignment while independent Manage access survives its withdrawal`,
        async ({ scope, browser, caseApp, extraHTTPHeaders }) => {
          const suffix = randomUUID().slice(0, 8);
          const actor = {
            email: `combined.${role}.${suffix}@example.com`,
            fullName: `陳獨立權限${suffix}`,
            membershipStatus: "active" as const,
            password: "Synthetic-combined-authorities-password!",
            role,
            username: `combined.${role}.${suffix}`,
          };
          const userId = await caseApp.provision.account(actor);
          const assignmentId = randomUUID();
          const context = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
          });
          try {
            const page = await context.newPage();
            await signIn(page, actor);
            const entry = page.getByRole("link", {
              exact: true,
              name: "進入部門工作區",
            });
            await expect(entry).toHaveCount(0);
            const beforeAssignment = await context.request.get(
              "/api/v2/roles/program-leaders/departments?page=1"
            );
            expect(beforeAssignment.status()).toBe(403);
            const manage = page.getByRole("link", {
              exact: true,
              name: "管理",
            });
            await (role === "member"
              ? expect(manage).toHaveCount(0)
              : expect(manage).toHaveAttribute("href", "/staff/accounts"));
            await caseApp.db
              .prepare(
                "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
              )
              .bind(assignmentId, scope.department.id, userId)
              .run();
            await page.reload();
            await expect(entry).toBeVisible();
            await entry.click();
            await expect(
              page.getByRole("heading", {
                exact: true,
                name: scope.department.name,
              })
            ).toBeVisible();
            await page
              .getByRole("button", {
                exact: true,
                name: `管理${scope.program.name}的負責人`,
              })
              .click();
            await page
              .getByRole("link", {
                exact: true,
                name: `編輯${scope.leader.fullName}的聚會職務`,
              })
              .click();
            const choice = page.getByRole("checkbox", {
              exact: true,
              name: `聚會負責人：${scope.program.name}`,
            });
            await expect(choice).toBeChecked();
            const proof = await context.request.post(
              "/api/v2/account/password-confirmation",
              {
                data: {
                  operationKey: randomUUID(),
                  password: actor.password,
                },
              }
            );
            expect(proof.status()).toBe(201);
            await choice.uncheck();
            const saved = page.waitForResponse(
              (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname ===
                  "/api/v2/roles/program-leaders"
            );
            await page
              .getByRole("button", { exact: true, name: "儲存" })
              .click();
            const result = await saved;
            expect(result.status()).toBe(201);
            expect(result.request().postDataJSON()).toEqual(
              expect.objectContaining({
                action: "withdrawn",
                authorityAssignmentId: assignmentId,
                authorityKind: "department_manager",
                expectedAssignmentId: scope.program.assignmentId,
                scopeId: scope.program.id,
                targetUserId: scope.leader.userId,
              })
            );
            await expect(
              page.getByRole("heading", {
                exact: true,
                name: scope.program.name,
              })
            ).toBeVisible();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            if (role === "admin") {
              await expectLocalAdminGrantConflict(page, caseApp, scope, {
                password: actor.password,
                userId,
              });
            }
            await caseApp.db
              .prepare("DELETE FROM department_manager_assignment WHERE id=?")
              .bind(assignmentId)
              .run();
            await page.goto("/");
            await expect(entry).toHaveCount(0);
            const afterWithdrawal = await context.request.get(
              "/api/v2/roles/program-leaders/departments?page=1"
            );
            expect(afterWithdrawal.status()).toBe(403);
            await (role === "member"
              ? expect(manage).toHaveCount(0)
              : expect(manage).toHaveAttribute("href", "/staff/accounts"));
          } finally {
            await context.close();
          }
        }
      );
    }
  }
);
