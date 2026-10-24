import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";

const roleTest = dedicatedTest;

roleTest.describe(
  "Department Manager Program Leader assignments",
  {
    tag: ["@native", "@risk-authorization", "@risk-atomicity"],
  },
  () => {
    roleTest(
      "a Member-only Department Manager grants a current Member only that Program's Home notice",
      { tag: ["@browser", "@home", "@mobile-critical"] },
      async ({ browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-department-manager-password!";
        const managerUsername = `roles.dm.${suffix}`;
        const targetUsername = `roles.candidate.${suffix}`;
        const targetPassword = "Synthetic-program-leader-password!";
        const managerUserId = await caseApp.provision.account({
          email: `dm.${suffix}@example.com`,
          fullName: `陳部門負責人${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username: managerUsername,
        });
        const targetUserId = await caseApp.provision.account({
          email: `target.${suffix}@example.com`,
          fullName: `陳聚會候選人${suffix}`,
          membershipStatus: "active",
          password: targetPassword,
          role: "member",
          username: targetUsername,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        const otherDepartmentId = randomUUID();
        const otherProgramId = randomUUID();
        const managerAssignmentId = randomUUID();
        const departmentMembershipId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `本部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `本部門聚會${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(managerAssignmentId, departmentId, managerUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(departmentMembershipId, departmentId, targetUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(otherDepartmentId, `其他部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(otherProgramId, otherDepartmentId, `其他聚會${suffix}`)
          .run();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `DM Program 通告${suffix}`,
              "只供獲授權人士閱讀。",
              programId
            ),
          caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `其他 Program 通告${suffix}`,
              "不應向未獲授權人士顯示。",
              otherProgramId
            ),
        ]);

        const manager = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await manager.post("/api/auth/sign-in/username", {
            data: { password, username: managerUsername },
          });
          expect(login.status()).toBe(200);
          const confirmation = await manager.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password } }
          );
          expect(confirmation.status()).toBe(201);

          const grant = await manager.post("/api/v2/roles/program-leaders", {
            data: {
              action: "granted",
              authorityAssignmentId: managerAssignmentId,
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          });
          const body: unknown = await grant.json();
          expect(grant.status(), JSON.stringify(body)).toBe(201);
          expect(body).toMatchObject({
            data: {
              receipt: {
                action: "granted",
                scopeId: programId,
                scopeName: `本部門聚會${suffix}`,
                targetUserId,
              },
            },
          });

          const recipient = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
          });
          try {
            const recipientLogin = await recipient.post(
              "/api/auth/sign-in/username",
              {
                data: { password: targetPassword, username: targetUsername },
              }
            );
            expect(recipientLogin.status()).toBe(200);

            const homeContext = await browser.newContext({
              baseURL: caseApp.origin,
              extraHTTPHeaders,
              storageState: await recipient.storageState(),
            });
            try {
              const page = await homeContext.newPage();
              await page.goto("/");
              const notices = page.getByRole("region", { name: "教會消息" });
              await expect(
                notices.getByText(`DM Program 通告${suffix}`, { exact: true })
              ).toBeVisible();
              await expect(
                notices.getByText(`其他 Program 通告${suffix}`, {
                  exact: true,
                })
              ).toHaveCount(0);
            } finally {
              await homeContext.close();
            }
          } finally {
            await recipient.dispose();
          }

          const departmentMembershipCount = await caseApp.db
            .prepare(
              "select count(*) as count from department_membership where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          const departmentMembership = await caseApp.db
            .prepare(
              "select id, department_id from department_membership where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ department_id: string; id: string }>();
          const enrolmentCount = await caseApp.db
            .prepare(
              "select count(*) as count from enrolment where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          expect(departmentMembershipCount?.count).toBe(1);
          expect(departmentMembership).toEqual({
            department_id: departmentId,
            id: departmentMembershipId,
          });
          expect(enrolmentCount?.count).toBe(0);
        } finally {
          await manager.dispose();
        }
      }
    );
  }
);
