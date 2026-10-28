import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

dedicatedTest.describe(
  "Member-only Department Manager Program Leader workspace",
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
    dedicatedTest(
      "a Department Manager reaches current Program Leaders and reviews a grant through Manage",
      async ({ browser, caseApp, extraHTTPHeaders }, testInfo) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const managerPassword = "Synthetic-department-manager-password!";
        const manager = {
          email: `manager.${suffix}@example.com`,
          fullName: `陳部門負責人${suffix}`,
          membershipStatus: "active" as const,
          password: managerPassword,
          role: "member" as const,
          username: `roles.dm.${suffix}`,
        };
        const managerUserId = await caseApp.provision.account(manager);
        const leader = {
          email: `leader.${suffix}@example.com`,
          fullName: `陳現任領袖${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-program-leader-password!",
          role: "member" as const,
          username: `roles.leader.${suffix}`,
        };
        const leaderUserId = await caseApp.provision.account(leader);
        const candidate = {
          email: `candidate.${suffix}@example.com`,
          fullName: `陳新任候選人${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-program-candidate-password!",
          role: "member" as const,
          username: `roles.candidate.${suffix}`,
        };
        const candidateUserId = await caseApp.provision.account(candidate);
        const ordinaryMember = {
          email: `member.${suffix}@example.com`,
          fullName: `陳一般會友${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-ordinary-member-password!",
          role: "member" as const,
          username: `roles.member.${suffix}`,
        };
        await caseApp.provision.account(ordinaryMember);

        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `範圍測試部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `範圍測試聚會${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, managerUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, leaderUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, candidateUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into program_leader_assignment (id,program_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), programId, leaderUserId)
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
            .fill(manager.username);
          await page
            .getByRole("textbox", { name: "密碼" })
            .fill(managerPassword);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);

          const manageEntry = page.getByRole("link", {
            exact: true,
            name: "管理",
          });
          await expect(manageEntry).toBeVisible();
          await expect(manageEntry).toHaveAttribute(
            "href",
            "/roles/program-leaders"
          );
          await manageEntry.click();
          await expect(page).toHaveURL(/\/roles\/program-leaders$/u);
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "Program Leader 管理",
            })
          ).toBeVisible();

          const department = page.getByRole("combobox", {
            exact: true,
            name: "部門",
          });
          await expect(department).toHaveCount(1);
          await expect(department.locator("option").nth(1)).toHaveAttribute(
            "value",
            departmentId
          );
          await department.selectOption({ value: departmentId });
          const program = page.getByRole("combobox", {
            exact: true,
            name: "聚會",
          });
          await expect(department).toHaveValue(departmentId);
          await expect(program).toBeEnabled();
          await expect(program.locator("option").nth(1)).toHaveAttribute(
            "value",
            programId
          );
          await program.selectOption(programId);
          const leaders = page.getByRole("region", {
            name: "現任 Program Leader",
          });
          await expect(
            leaders.getByText(leader.fullName, { exact: true })
          ).toBeVisible();
          await expect(
            leaders.getByText(leader.username, { exact: true })
          ).toBeVisible();

          const candidateSearch = page.getByRole("textbox", {
            name: "搜尋同部門 Member",
          });
          await candidateSearch.fill(candidate.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const candidateChoice = page.getByRole("button", {
            name: new RegExp(candidate.fullName, "u"),
          });
          await expect(candidateChoice).toBeVisible();
          await candidateChoice.click();
          await expect(
            page.getByText(candidate.email, { exact: true })
          ).toHaveCount(0);

          const reviewAction = page.getByRole("button", {
            exact: true,
            name: "檢視操作",
          });
          const presentation = {
            criticalAction: reviewAction,
            drafts: page.locator("input"),
            focus: candidateSearch,
            masks: [
              candidateSearch,
              leaders.getByText(leader.fullName, { exact: true }),
              leaders.getByText(leader.username, { exact: true }),
              page.getByText(candidate.fullName, { exact: true }),
              page.getByText(candidate.username, { exact: true }),
            ],
          };
          await qualifyPresentation(page, testInfo, "phone", presentation);
          await qualifyPresentation(page, testInfo, "desktop", presentation);

          await reviewAction.click();
          const review = page.getByRole("dialog");
          await expect(review).toContainText("授予 Program Leader");
          await expect(review).toContainText(`範圍測試聚會${suffix}`);
          await expect(review).toContainText(candidate.fullName);

          const ordinaryContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
          });
          try {
            const ordinaryPage = await ordinaryContext.newPage();
            await ordinaryPage.goto("/sign-in");
            await ordinaryPage
              .getByRole("textbox", { name: "Username" })
              .fill(ordinaryMember.username);
            await ordinaryPage
              .getByRole("textbox", { name: "密碼" })
              .fill(ordinaryMember.password);
            await ordinaryPage
              .getByRole("button", { exact: true, name: "登入" })
              .click();
            await expect(ordinaryPage).toHaveURL(/\/$/u);
            await ordinaryPage.goto("/roles/program-leaders");
            await expect(ordinaryPage).toHaveURL(/\/$/u);
            await expect(
              ordinaryPage.getByRole("heading", {
                exact: true,
                name: "我的主頁",
              })
            ).toBeVisible();
            await expect(
              ordinaryPage.getByRole("heading", {
                exact: true,
                name: "Program Leader 管理",
              })
            ).toHaveCount(0);
            await expect(
              ordinaryPage.getByText(leader.fullName, { exact: true })
            ).toHaveCount(0);
            await expect(
              ordinaryPage.getByLabel("搜尋同部門 Member", { exact: true })
            ).toHaveCount(0);
          } finally {
            await ordinaryContext.close();
          }
        } finally {
          await context.close();
        }
      }
    );

    dedicatedTest(
      "a Member Department Manager recovers a lost Program Leader grant after Worker reload",
      {
        tag: [
          "@native",
          "@browser",
          "@risk-authorization",
          "@risk-privacy",
          "@risk-resilience",
        ],
      },
      async ({ browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const manager = {
          email: `manager.recovery.${suffix}@example.com`,
          fullName: `陳復原部門負責人${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-dm-recovery-password!",
          role: "member" as const,
          username: `roles.dm.r${suffix}`,
        };
        const managerUserId = await caseApp.provision.account(manager);
        const candidate = {
          email: `candidate.recovery.${suffix}@example.com`,
          fullName: `陳復原候選人${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-dm-recovery-candidate!",
          role: "member" as const,
          username: `roles.candidate.r${suffix}`,
        };
        const candidateUserId = await caseApp.provision.account(candidate);
        const departmentId = randomUUID();
        const programId = randomUUID();
        const authorityAssignmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `復原測試部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `復原測試聚會${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(authorityAssignmentId, departmentId, managerUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, candidateUserId)
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
            .fill(manager.username);
          await page
            .getByRole("textbox", { name: "密碼" })
            .fill(manager.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);
          await page.goto("/roles/program-leaders");

          const department = page.getByRole("combobox", {
            exact: true,
            name: "部門",
          });
          await expect(department).toHaveCount(1);
          await department.selectOption({ value: departmentId });
          const program = page.getByRole("combobox", {
            exact: true,
            name: "聚會",
          });
          await expect(program).toBeEnabled();
          await program.selectOption(programId);
          const candidateSearch = page.getByRole("textbox", {
            name: "搜尋同部門 Member",
          });
          await candidateSearch.fill(candidate.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const candidateChoice = page.getByRole("button", {
            name: new RegExp(candidate.fullName, "u"),
          });
          await expect(candidateChoice).toBeVisible();
          await candidateChoice.click();
          await page
            .getByRole("button", { exact: true, name: "檢視操作" })
            .click();
          const review = page.getByRole("dialog");
          await expect(review).toContainText(candidate.fullName);
          await expect(review).toContainText(`復原測試聚會${suffix}`);

          const password = review.getByLabel("目前密碼", { exact: true });
          await expect(password).toBeVisible({ timeout: 5000 });
          const submit = review.getByRole("button", {
            exact: true,
            name: "確認並提交",
          });
          await expect(submit).toBeDisabled();

          const proofBodies: Record<string, unknown>[] = [];
          const commandBodies: Record<string, unknown>[] = [];
          const reconcileBodies: Record<string, unknown>[] = [];
          let lostCommandResponse = false;
          await page.route(
            "**/api/v2/account/password-confirmation",
            async (route) => {
              proofBodies.push(
                route.request().postDataJSON() as Record<string, unknown>
              );
              await route.continue();
            }
          );
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
                reconcileBodies.push(
                  request.postDataJSON() as Record<string, unknown>
                );
                await route.continue();
                return;
              }
              if (
                !lostCommandResponse &&
                request.method() === "POST" &&
                requestUrl.pathname === "/api/v2/roles/program-leaders"
              ) {
                lostCommandResponse = true;
                commandBodies.push(
                  request.postDataJSON() as Record<string, unknown>
                );
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                await route.abort("failed");
                return;
              }
              await route.continue();
            }
          );

          await password.fill(manager.password);
          await expect(submit).toBeEnabled();
          await submit.click();
          await expect(page.getByRole("status")).toContainText("結果未能確認");
          expect(proofBodies).toHaveLength(1);
          expect(proofBodies[0]).toMatchObject({ password: manager.password });
          expect(commandBodies).toHaveLength(1);
          const [command] = commandBodies;
          expect(command).toMatchObject({
            action: "granted",
            authorityAssignmentId,
            scopeId: programId,
            targetUserId: candidateUserId,
          });
          expect(command?.operationKey).toMatch(/^[0-9a-f-]{36}$/iu);

          const storageKey = `efcc.program-leader.operation.v1:${encodeURIComponent(managerUserId)}`;
          const rawOperation = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey
          );
          expect(rawOperation).not.toBeNull();
          const operation = JSON.parse(rawOperation ?? "null") as Record<
            string,
            unknown
          >;
          expect(Object.keys(operation).toSorted()).toEqual([
            "actorUserId",
            "operationKey",
          ]);
          expect(operation).toEqual({
            actorUserId: managerUserId,
            operationKey: command?.operationKey,
          });
          expect(rawOperation).not.toContain(manager.password);
          expect(rawOperation).not.toContain(candidateUserId);
          expect(rawOperation).not.toContain(programId);

          const priorWorker = caseApp.harness.getWorker<{
            BETTER_AUTH_SECRET: string;
            DB: NativeApp["db"];
          }>("efcc-system");
          const priorEnvironment = await priorWorker.getEnv();
          const beforeGrant = await priorEnvironment.DB.prepare(
            `SELECT
              (SELECT COUNT(*) FROM department_membership WHERE user_id = ? AND department_id = ?) AS departmentMemberships,
              (SELECT COUNT(*) FROM enrolment WHERE user_id = ?) AS enrolments`
          )
            .bind(candidateUserId, departmentId, candidateUserId)
            .first<{ departmentMemberships: number; enrolments: number }>();
          expect(beforeGrant).toEqual({
            departmentMemberships: 1,
            enrolments: 0,
          });

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
                  vars: { ...primary.vars, T3_DM_RELOAD_MARKER: marker },
                },
                ...remaining,
              ],
            };
          });
          const updatedWorker = caseApp.harness.getWorker<{
            BETTER_AUTH_SECRET: string;
            DB: NativeApp["db"];
            T3_DM_RELOAD_MARKER: string;
          }>("efcc-system");
          const updatedEnvironment = await updatedWorker.getEnv();
          expect(updatedEnvironment.T3_DM_RELOAD_MARKER).toBe(marker);
          expect(
            updatedEnvironment.BETTER_AUTH_SECRET ===
              priorEnvironment.BETTER_AUTH_SECRET
          ).toBe(true);
          const durableReceipt = await updatedEnvironment.DB.prepare(
            `SELECT action, actor_user_id, operation_key, role, scope_id, target_user_id
             FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?`
          )
            .bind(managerUserId, command?.operationKey)
            .first<Record<string, unknown>>();
          expect(durableReceipt).toMatchObject({
            action: "granted",
            actor_user_id: managerUserId,
            operation_key: command?.operationKey,
            role: "program_leader",
            scope_id: programId,
            target_user_id: candidateUserId,
          });
          const beforeReconcile = await updatedEnvironment.DB.prepare(
            `SELECT
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ? AND program_id = ?) AS assignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE action = 'granted' AND role = 'program_leader' AND scope_id = ? AND target_user_id = ?) AS history,
              (SELECT COUNT(*) FROM department_membership WHERE user_id = ? AND department_id = ?) AS departmentMemberships,
              (SELECT COUNT(*) FROM enrolment WHERE user_id = ?) AS enrolments`
          )
            .bind(
              candidateUserId,
              programId,
              programId,
              candidateUserId,
              candidateUserId,
              departmentId,
              candidateUserId
            )
            .first<{
              assignments: number;
              departmentMemberships: number;
              enrolments: number;
              history: number;
            }>();
          expect(beforeReconcile).toEqual({
            assignments: 1,
            departmentMemberships: beforeGrant?.departmentMemberships,
            enrolments: beforeGrant?.enrolments,
            history: 1,
          });

          await page.reload();
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核操作結果",
            })
          ).toBeVisible();
          await page
            .getByRole("button", { exact: true, name: "查核操作結果" })
            .click();
          await expect(page.getByRole("status")).toContainText("已授予");
          expect(reconcileBodies).toEqual([
            { operationKey: command?.operationKey },
          ]);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBeNull();
          const afterReconcile = await updatedEnvironment.DB.prepare(
            `SELECT
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ? AND program_id = ?) AS assignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE action = 'granted' AND role = 'program_leader' AND scope_id = ? AND target_user_id = ?) AS history`
          )
            .bind(candidateUserId, programId, programId, candidateUserId)
            .first<{ assignments: number; history: number }>();
          expect(afterReconcile).toEqual({ assignments: 1, history: 1 });
        } finally {
          await context.close();
        }
      }
    );

    dedicatedTest(
      "a late Member Department Manager response cannot restore the previous account workspace",
      {
        tag: ["@risk-authorization", "@risk-privacy", "@risk-resilience"],
      },
      async ({ browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const firstManager = {
          email: `manager.switch.a.${suffix}@example.com`,
          fullName: `陳轉換甲部門負責人${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-dm-switch-first-password!",
          role: "member" as const,
          username: `roles.dma.${suffix}`,
        };
        const firstManagerUserId =
          await caseApp.provision.account(firstManager);
        const nextManager = {
          email: `manager.switch.b.${suffix}@example.com`,
          fullName: `陳轉換乙部門負責人${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-dm-switch-next-password!",
          role: "member" as const,
          username: `roles.dmb.${suffix}`,
        };
        const nextManagerUserId = await caseApp.provision.account(nextManager);
        const candidate = {
          email: `candidate.switch.${suffix}@example.com`,
          fullName: `陳轉換候選人${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-dm-switch-candidate-password!",
          role: "member" as const,
          username: `roles.candidate.s${suffix}`,
        };
        const candidateUserId = await caseApp.provision.account(candidate);
        const departmentId = randomUUID();
        const nextDepartmentId = randomUUID();
        const programId = randomUUID();
        const authorityAssignmentId = randomUUID();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "insert into department (id,name,created_at) values (?,?,unixepoch())"
            )
            .bind(departmentId, `轉換甲測試部門${suffix}`),
          caseApp.db
            .prepare(
              "insert into department (id,name,created_at) values (?,?,unixepoch())"
            )
            .bind(nextDepartmentId, `轉換乙測試部門${suffix}`),
          caseApp.db
            .prepare(
              "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, `轉換測試聚會${suffix}`),
          caseApp.db
            .prepare(
              "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
            )
            .bind(authorityAssignmentId, departmentId, firstManagerUserId),
          caseApp.db
            .prepare(
              "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), nextDepartmentId, nextManagerUserId),
          caseApp.db
            .prepare(
              "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), departmentId, candidateUserId),
        ]);

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
        const commandBodies: Record<string, unknown>[] = [];
        const actorAKey = `efcc.program-leader.operation.v1:${encodeURIComponent(firstManagerUserId)}`;
        const actorBKey = `efcc.program-leader.operation.v1:${encodeURIComponent(nextManagerUserId)}`;
        let expectActorProbe = false;
        let commandCaptured = false;
        let commandDeliveryError: string | null = null;
        try {
          const page = await context.newPage();
          await page.goto("/sign-in");
          await page
            .getByRole("textbox", { name: "Username" })
            .fill(firstManager.username);
          await page
            .getByRole("textbox", { name: "密碼" })
            .fill(firstManager.password);
          await page.getByRole("button", { exact: true, name: "登入" }).click();
          await expect(page).toHaveURL(/\/$/u);
          await page.goto("/roles/program-leaders");

          const department = page.getByRole("combobox", {
            exact: true,
            name: "部門",
          });
          await expect(department).toHaveCount(1);
          await expect(department.locator("option").nth(1)).toHaveAttribute(
            "value",
            departmentId
          );
          await department.selectOption({ value: departmentId });
          const program = page.getByRole("combobox", {
            exact: true,
            name: "聚會",
          });
          await expect(program).toBeEnabled();
          await expect(program.locator("option").nth(1)).toHaveAttribute(
            "value",
            programId
          );
          await program.selectOption({ value: programId });
          const candidateSearch = page.getByRole("textbox", {
            name: "搜尋同部門 Member",
          });
          await candidateSearch.fill(candidate.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(candidate.fullName, "u") })
            .click();
          await page
            .getByRole("button", { exact: true, name: "檢視操作" })
            .click();
          const review = page.getByRole("dialog");
          await expect(review).toContainText(candidate.fullName);
          await expect(review).toContainText(`轉換測試聚會${suffix}`);
          const password = review.getByLabel("目前密碼", { exact: true });
          await password.fill(firstManager.password);
          const submit = review.getByRole("button", {
            exact: true,
            name: "確認並提交",
          });
          await expect(submit).toBeEnabled();

          await page.route(
            "**/api/v2/roles/program-leaders**",
            async (route) => {
              const request = route.request();
              const requestUrl = new URL(request.url());
              if (
                expectActorProbe &&
                request.method() === "GET" &&
                requestUrl.pathname ===
                  "/api/v2/roles/program-leaders/departments" &&
                requestUrl.searchParams.get("page") === "1"
              ) {
                expectActorProbe = false;
                const response = await route.fetch();
                const body = (await response.json()) as {
                  data?: { actorUserId?: string };
                };
                await route.fulfill({ response });
                appActorProbe.resolve({
                  actorUserId: body.data?.actorUserId ?? null,
                  status: response.status(),
                });
                return;
              }
              if (
                !commandCaptured &&
                request.method() === "POST" &&
                requestUrl.pathname === "/api/v2/roles/program-leaders"
              ) {
                commandCaptured = true;
                const body = request.postDataJSON() as Record<string, unknown>;
                commandBodies.push(body);
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                committedMutation.resolve({
                  operationKey: String(body.operationKey),
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
            }
          );

          await submit.click();
          const committed = await committedMutation.promise;
          expect(committed.status).toBe(201);
          expect(committed.operationKey).toMatch(/^[0-9a-f-]{36}$/iu);
          expect(commandBodies).toEqual([
            {
              action: "granted",
              authorityAssignmentId,
              operationKey: committed.operationKey,
              scopeId: programId,
              targetUserId: candidateUserId,
            },
          ]);
          const rawOperation = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            actorAKey
          );
          expect(rawOperation).toBe(
            JSON.stringify({
              actorUserId: firstManagerUserId,
              operationKey: committed.operationKey,
            })
          );

          const nextLogin = await nextSession.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: nextManager.password,
                username: nextManager.username,
              },
            }
          );
          expect(nextLogin.status()).toBe(200);
          const nextActorResponse = await nextSession.get(
            "/api/v2/roles/program-leaders/departments?page=1"
          );
          expect(nextActorResponse.status()).toBe(200);
          const nextActorBody = (await nextActorResponse.json()) as {
            data?: { actorUserId?: string };
          };
          expect(nextActorBody.data?.actorUserId).toBe(nextManagerUserId);
          await context.clearCookies();
          const nextSessionState = await nextSession.storageState();
          await context.addCookies(nextSessionState.cookies);
          const browserActorResponse = await page.request.get(
            "/api/v2/roles/program-leaders/departments?page=1"
          );
          expect(browserActorResponse.status()).toBe(200);
          const browserActorBody = (await browserActorResponse.json()) as {
            data?: { actorUserId?: string };
          };
          expect(browserActorBody.data?.actorUserId).toBe(nextManagerUserId);

          expectActorProbe = true;
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          expect(await appActorProbe.promise).toEqual({
            actorUserId: nextManagerUserId,
            status: 200,
          });
          await expect(
            page.getByText(candidate.fullName, { exact: false })
          ).toHaveCount(0);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByLabel("目前密碼", { exact: true })
          ).toHaveCount(0);
          await expect(candidateSearch).toHaveCount(0);
          await expect(department).toHaveValue("");
          await expect(program).toHaveValue("");
          await expect(program).toBeDisabled();
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核操作結果",
            })
          ).toHaveCount(0);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorAKey)
          ).toBe(rawOperation);
          expect(
            await page.evaluate((key) => sessionStorage.getItem(key), actorBKey)
          ).toBeNull();

          mutationResponseGate.resolve(null);
          await deliveredMutation.promise;
          expect(commandDeliveryError).toBeNull();
          await expect(
            page.getByText(candidate.fullName, { exact: false })
          ).toHaveCount(0);
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByLabel("目前密碼", { exact: true })
          ).toHaveCount(0);
          await expect(candidateSearch).toHaveCount(0);
          await expect(department).toHaveValue("");
          await expect(program).toHaveValue("");
          await expect(program).toBeDisabled();
          await expect(
            page.getByRole("button", {
              exact: true,
              name: "查核操作結果",
            })
          ).toHaveCount(0);
        } finally {
          mutationResponseGate.resolve(null);
          await context.close();
          await nextSession.dispose();
        }
      }
    );
  }
);
