import { randomBytes, randomUUID } from "node:crypto";

import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";

interface TestAccount {
  account: ProvisionAccount;
  userId: string;
}

const passwordConfirmation = async (
  context: APIRequestContext,
  password: string
) => {
  const response = await context.post("/api/v2/account/password-confirmation", {
    data: { operationKey: randomUUID(), password },
  });
  expect(response.status()).toBe(201);
};

const signInPage = async (page: Page, account: ProvisionAccount) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(account.username);
  await page.getByRole("textbox", { name: "密碼" }).fill(account.password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};

const signInRequest = async (
  context: APIRequestContext,
  account: ProvisionAccount
) => {
  const response = await context.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
};

const submitGrant = async (
  context: APIRequestContext,
  password: string,
  path: string,
  input: Record<string, unknown>,
  receipt: Record<string, unknown>
) => {
  await passwordConfirmation(context, password);
  const response = await context.post(path, { data: input });
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ data: { receipt } });
};

const provisionAccount = async (
  app: NativeApp,
  suffix: string,
  usernamePrefix: string,
  displayName: string,
  password: string,
  role: "admin" | "member" = "member"
): Promise<TestAccount> => {
  const account: ProvisionAccount = {
    email: `${usernamePrefix}.${suffix}@example.com`,
    fullName: `陳${displayName}${suffix}`,
    membershipStatus: "active",
    password,
    role,
    username: `${usernamePrefix}${suffix}`,
  };
  return { account, userId: await app.provision.account(account) };
};

const assertOneGrantBundle = async (
  app: NativeApp,
  input: {
    actorUserId: string;
    auditAction: string;
    operationKey: string;
    role: string;
    scopeId?: string;
    targetUserId: string;
  }
) => {
  const scopeFilter = input.scopeId === undefined ? "" : " and scope_id = ?";
  const scopeBindings = input.scopeId === undefined ? [] : [input.scopeId];
  const effects = await app.db
    .prepare(
      `select
        (select count(*) from role_assignment_history where actor_user_id = ? and target_user_id = ? and role = ? and action = 'granted'${scopeFilter}) as history,
        (select count(*) from audit_event where actor_user_id = ? and target_user_id = ? and action = ?) as audits,
        (select count(*) from role_change_operation where actor_user_id = ? and operation_key = ? and target_user_id = ? and role = ? and action = 'granted'${scopeFilter}) as receipts`
    )
    .bind(
      input.actorUserId,
      input.targetUserId,
      input.role,
      ...scopeBindings,
      input.actorUserId,
      input.targetUserId,
      input.auditAction,
      input.actorUserId,
      input.operationKey,
      input.targetUserId,
      input.role,
      ...scopeBindings
    )
    .first<{ audits: number; history: number; receipts: number }>();
  expect(effects).toEqual({ audits: 1, history: 1, receipts: 1 });
};

const readMembershipAndEnrolment = async (
  app: NativeApp,
  userIds: readonly string[]
) => {
  const placeholders = userIds.map(() => "?").join(", ");
  const departmentMemberships = await app.db
    .prepare(
      `select department_id, id, user_id from department_membership where user_id in (${placeholders}) order by user_id, department_id`
    )
    .bind(...userIds)
    .all<{ department_id: string; id: string; user_id: string }>();
  const enrolments = await app.db
    .prepare(
      `select id, program_id, status, user_id from enrolment where user_id in (${placeholders}) order by user_id, program_id`
    )
    .bind(...userIds)
    .all<{ id: string; program_id: string; status: string; user_id: string }>();
  return {
    departmentMemberships: departmentMemberships.results,
    enrolments: enrolments.results,
  };
};

dedicatedTest.describe(
  "Connected Roles delegation journey",
  {
    tag: [
      "@native",
      "@browser",
      "@home",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-history",
      "@risk-privacy",
    ],
  },
  () => {
    dedicatedTest(
      "an Admin delegates Staff and Role Assigner, then a Member Department Manager grants only the intended Program notice",
      async ({ browser, caseApp, extraHTTPHeaders, playwright }) => {
        const actorAddresses = new Set<string>();
        const headersForActor = () => {
          let address: string;
          do {
            const bytes = randomBytes(2);
            address = `198.19.${bytes.readUInt8(0)}.${bytes.readUInt8(1)}`;
          } while (actorAddresses.has(address));
          actorAddresses.add(address);
          return {
            ...extraHTTPHeaders,
            "cf-connecting-ip": address,
          };
        };
        const adminHeaders = headersForActor();
        const roleAssignerHeaders = headersForActor();
        const managerHeaders = headersForActor();
        const recipientHeaders = headersForActor();
        const suffix = randomBytes(4).toString("hex");
        const admin = await provisionAccount(
          caseApp,
          suffix,
          "a",
          "管理員",
          "Synthetic-roles-admin-password!",
          "admin"
        );
        const roleAssigner = await provisionAccount(
          caseApp,
          suffix,
          "ra",
          "角色委派",
          "Synthetic-roles-assigner-password!"
        );
        const manager = await provisionAccount(
          caseApp,
          suffix,
          "dm",
          "部門負責",
          "Synthetic-roles-manager-password!"
        );
        const recipient = await provisionAccount(
          caseApp,
          suffix,
          "pl",
          "聚會候選",
          "Synthetic-roles-recipient-password!"
        );

        const departmentId = randomUUID();
        const programId = randomUUID();
        const otherProgramId = randomUUID();
        const departmentMembershipId = randomUUID();
        const programNoticeTitle = `指定聚會通告${suffix}`;
        const otherProgramNoticeTitle = `其他聚會通告${suffix}`;
        await caseApp.db
          .prepare(
            "insert into department (id, name, created_at) values (?, ?, unixepoch())"
          )
          .bind(departmentId, `角色測試部門${suffix}`)
          .run();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "insert into program (id, department_id, name, created_at) values (?, ?, ?, unixepoch())"
            )
            .bind(programId, departmentId, `角色測試聚會${suffix}`),
          caseApp.db
            .prepare(
              "insert into program (id, department_id, name, created_at) values (?, ?, ?, unixepoch())"
            )
            .bind(otherProgramId, departmentId, `另一聚會${suffix}`),
          caseApp.db
            .prepare(
              "insert into department_membership (id, department_id, user_id, created_at) values (?, ?, ?, unixepoch())"
            )
            .bind(departmentMembershipId, departmentId, recipient.userId),
          caseApp.db
            .prepare(
              "insert into notice (id, title, body, scope_type, scope_id, published_at, expires_at, created_at) values (?, ?, ?, 'program', ?, unixepoch(), null, unixepoch())"
            )
            .bind(
              randomUUID(),
              programNoticeTitle,
              "只供獲授權人士閱讀。",
              programId
            ),
          caseApp.db
            .prepare(
              "insert into notice (id, title, body, scope_type, scope_id, published_at, expires_at, created_at) values (?, ?, ?, 'program', ?, unixepoch(), null, unixepoch())"
            )
            .bind(
              randomUUID(),
              otherProgramNoticeTitle,
              "不應向未獲授權人士顯示。",
              otherProgramId
            ),
        ]);

        const apiContexts: APIRequestContext[] = [];
        const browserContexts: BrowserContext[] = [];
        try {
          const adminContext = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: adminHeaders,
          });
          apiContexts.push(adminContext);
          const roleAssignerContext = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: roleAssignerHeaders,
          });
          apiContexts.push(roleAssignerContext);
          await signInRequest(adminContext, admin.account);
          await signInRequest(roleAssignerContext, roleAssigner.account);

          const staffOperationKey = randomUUID();
          await submitGrant(
            adminContext,
            admin.account.password,
            "/api/v2/roles/global-roles",
            {
              action: "granted",
              operationKey: staffOperationKey,
              role: "staff",
              targetUserId: roleAssigner.userId,
            },
            {
              action: "granted",
              resultingGlobalRole: "staff",
              role: "staff",
              targetUserId: roleAssigner.userId,
            }
          );

          const roleAssignerProfile = await caseApp.db
            .prepare(
              "select account_role, membership_status from person_profile where user_id = ?"
            )
            .bind(roleAssigner.userId)
            .first<{ account_role: string; membership_status: string }>();
          expect(roleAssignerProfile).toEqual({
            account_role: "staff",
            membership_status: "active",
          });

          const roleAssignerOperationKey = randomUUID();
          await submitGrant(
            adminContext,
            admin.account.password,
            "/api/v2/roles/role-assigners",
            {
              action: "granted",
              operationKey: roleAssignerOperationKey,
              targetUserId: roleAssigner.userId,
            },
            {
              action: "granted",
              role: "role_assigner",
              targetUserId: roleAssigner.userId,
            }
          );

          const roleAssignerAssignments = await caseApp.db
            .prepare(
              "select id from role_assigner_assignment where user_id = ?"
            )
            .bind(roleAssigner.userId)
            .all<{ id: string }>();
          expect(roleAssignerAssignments.results).toHaveLength(1);
          const [roleAssignerAssignment] = roleAssignerAssignments.results;
          if (!roleAssignerAssignment) {
            throw new TypeError(
              "Admin grant returned no current Role Assigner assignment"
            );
          }

          const managerProfile = await caseApp.db
            .prepare(
              "select account_role, membership_status from person_profile where user_id = ?"
            )
            .bind(manager.userId)
            .first<{ account_role: string; membership_status: string }>();
          expect(managerProfile).toEqual({
            account_role: "member",
            membership_status: "active",
          });

          const managerOperationKey = randomUUID();
          await submitGrant(
            roleAssignerContext,
            roleAssigner.account.password,
            "/api/v2/roles/department-managers",
            {
              action: "granted",
              authorityAssignmentId: roleAssignerAssignment.id,
              operationKey: managerOperationKey,
              scopeId: departmentId,
              targetUserId: manager.userId,
            },
            {
              action: "granted",
              scopeId: departmentId,
              scopeName: `角色測試部門${suffix}`,
              targetUserId: manager.userId,
            }
          );

          const managerAssignment = await caseApp.db
            .prepare(
              "select id from department_manager_assignment where department_id = ? and user_id = ?"
            )
            .bind(departmentId, manager.userId)
            .first<{ id: string }>();
          expect(managerAssignment).not.toBeNull();
          if (!managerAssignment) {
            throw new TypeError(
              "Role Assigner grant returned no Department Manager assignment"
            );
          }
          const managerAssignmentCount = await caseApp.db
            .prepare(
              "select count(*) as count from department_manager_assignment where user_id = ?"
            )
            .bind(manager.userId)
            .first<{ count: number }>();
          expect(managerAssignmentCount?.count).toBe(1);

          const userIds = [
            admin.userId,
            roleAssigner.userId,
            manager.userId,
            recipient.userId,
          ];
          const relationshipsBeforeProgramLeader =
            await readMembershipAndEnrolment(caseApp, userIds);
          expect(relationshipsBeforeProgramLeader).toEqual({
            departmentMemberships: [
              {
                department_id: departmentId,
                id: departmentMembershipId,
                user_id: recipient.userId,
              },
            ],
            enrolments: [],
          });

          const managerContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: managerHeaders,
          });
          browserContexts.push(managerContext);
          const recipientContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: recipientHeaders,
          });
          browserContexts.push(recipientContext);
          const managerPage = await managerContext.newPage();
          const recipientPage = await recipientContext.newPage();
          await signInPage(managerPage, manager.account);
          await signInPage(recipientPage, recipient.account);

          await recipientPage.goto("/");
          const notices = recipientPage.getByRole("region", {
            name: "教會消息",
          });
          await expect(notices.locator("details > summary")).toHaveCount(0);

          const manageEntry = managerPage.getByRole("link", {
            exact: true,
            name: "管理",
          });
          await expect(manageEntry).toBeVisible();
          await expect(manageEntry).toHaveAttribute(
            "href",
            "/roles/program-leaders"
          );
          await manageEntry.click();
          await expect(managerPage).toHaveURL(/\/roles\/program-leaders$/u);
          await expect(
            managerPage.getByRole("heading", {
              exact: true,
              name: "Program Leader 管理",
            })
          ).toBeVisible();

          const department = managerPage.getByRole("combobox", {
            exact: true,
            name: "部門",
          });
          await department.selectOption({ value: departmentId });
          const program = managerPage.getByRole("combobox", {
            exact: true,
            name: "聚會",
          });
          await expect(program).toBeEnabled();
          await program.selectOption(programId);

          const candidateSearch = managerPage.getByRole("textbox", {
            name: "搜尋同部門 Member",
          });
          await candidateSearch.fill(recipient.account.username);
          await managerPage
            .getByRole("button", { exact: true, name: "搜尋" })
            .click();
          const candidate = managerPage.getByRole("button", {
            name: new RegExp(recipient.account.fullName, "u"),
          });
          await expect(candidate).toBeVisible();
          await candidate.click();
          await expect(
            managerPage.getByText(recipient.account.email, { exact: true })
          ).toHaveCount(0);

          const commandBodies: Record<string, unknown>[] = [];
          let passwordConfirmationRequests = 0;
          managerPage.on("request", (request) => {
            const url = new URL(request.url());
            if (
              request.method() === "POST" &&
              url.pathname === "/api/v2/account/password-confirmation"
            ) {
              passwordConfirmationRequests += 1;
            }
            if (
              request.method() === "POST" &&
              url.pathname === "/api/v2/roles/program-leaders"
            ) {
              commandBodies.push(
                request.postDataJSON() as Record<string, unknown>
              );
            }
          });

          await managerPage
            .getByRole("button", { exact: true, name: "檢視操作" })
            .click();
          const review = managerPage.getByRole("dialog");
          await expect(review).toContainText(recipient.account.fullName);
          await expect(review).toContainText(`角色測試聚會${suffix}`);
          const passwordField = review.getByLabel("目前密碼", {
            exact: true,
          });
          const submit = review.getByRole("button", {
            exact: true,
            name: "確認並提交",
          });
          await expect(submit).toBeDisabled();
          await passwordField.fill(manager.account.password);
          await expect(submit).toBeEnabled();
          await submit.click();
          await expect(managerPage.getByRole("status")).toContainText("已授予");

          expect(passwordConfirmationRequests).toBe(1);
          expect(commandBodies).toHaveLength(1);
          const [programLeaderCommand] = commandBodies;
          expect(programLeaderCommand).toMatchObject({
            action: "granted",
            authorityAssignmentId: managerAssignment.id,
            scopeId: programId,
            targetUserId: recipient.userId,
          });
          expect(programLeaderCommand?.operationKey).toMatch(
            /^[0-9a-f-]{36}$/iu
          );

          const programLeaderOperationKey = programLeaderCommand?.operationKey;
          if (typeof programLeaderOperationKey !== "string") {
            throw new TypeError("Program Leader command had no operation key");
          }

          await assertOneGrantBundle(caseApp, {
            actorUserId: admin.userId,
            auditAction: "global_role_changed",
            operationKey: staffOperationKey,
            role: "staff",
            targetUserId: roleAssigner.userId,
          });
          await assertOneGrantBundle(caseApp, {
            actorUserId: admin.userId,
            auditAction: "role_assigner_granted",
            operationKey: roleAssignerOperationKey,
            role: "role_assigner",
            targetUserId: roleAssigner.userId,
          });
          await assertOneGrantBundle(caseApp, {
            actorUserId: roleAssigner.userId,
            auditAction: "department_manager_granted",
            operationKey: managerOperationKey,
            role: "department_manager",
            scopeId: departmentId,
            targetUserId: manager.userId,
          });
          await assertOneGrantBundle(caseApp, {
            actorUserId: manager.userId,
            auditAction: "program_leader_granted",
            operationKey: programLeaderOperationKey,
            role: "program_leader",
            scopeId: programId,
            targetUserId: recipient.userId,
          });

          const actualProgramLeaderCount = await caseApp.db
            .prepare(
              "select count(*) as count from program_leader_assignment where program_id = ? and user_id = ?"
            )
            .bind(programId, recipient.userId)
            .first<{ count: number }>();
          expect(actualProgramLeaderCount?.count).toBe(1);

          const relationshipsAfterProgramLeader =
            await readMembershipAndEnrolment(caseApp, userIds);
          expect(relationshipsAfterProgramLeader).toEqual(
            relationshipsBeforeProgramLeader
          );

          await recipientPage.reload();
          await expect(
            recipientPage.getByRole("heading", {
              exact: true,
              name: "我的主頁",
            })
          ).toBeVisible();
          await expect(
            notices.getByText(programNoticeTitle, { exact: true })
          ).toBeVisible();
          await expect(
            notices.getByText(otherProgramNoticeTitle, { exact: true })
          ).toHaveCount(0);
          await expect(notices.locator("details > summary")).toHaveText([
            programNoticeTitle,
          ]);
          await notices.getByText(programNoticeTitle, { exact: true }).click();
          await expect(
            notices.getByText(`角色測試聚會${suffix}`, { exact: true })
          ).toBeVisible();
        } finally {
          await Promise.all(browserContexts.map((context) => context.close()));
          await Promise.all(apiContexts.map((context) => context.dispose()));
        }
      }
    );
  }
);
