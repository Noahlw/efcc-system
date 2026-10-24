import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";

const roleTest = dedicatedTest.extend<{
  admin: { context: APIRequestContext; userId: string };
}>({
  admin: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `roles.admin.${suffix}`;
    const password = "Synthetic-native-password!";
    const userId = await caseApp.provision.account({
      email: `${suffix}@example.com`,
      fullName: `陳角色${suffix}`,
      membershipStatus: "active",
      password,
      role: "admin",
      username,
    });
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const login = await context.post("/api/auth/sign-in/username", {
        data: { password, username },
      });
      expect(login.status()).toBe(200);
      const confirmation = await context.post(
        "/api/v2/account/password-confirmation",
        { data: { operationKey: randomUUID(), password } }
      );
      expect(confirmation.status()).toBe(201);
      await use({ context, userId });
    } finally {
      await context.dispose();
    }
  },
});

roleTest.describe(
  "Admin Program Leader assignments",
  {
    tag: [
      "@native",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-privacy",
      "@home",
    ],
  },
  () => {
    roleTest(
      "an Admin grant gives the recipient only that Program's Home notice",
      { tag: ["@browser", "@mobile-critical"] },
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-recipient-password!";
        const username = `roles.member.${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳收件人${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);

          const departmentId = randomUUID();
          const programId = randomUUID();
          const otherDepartmentId = randomUUID();
          const otherProgramId = randomUUID();
          await caseApp.db
            .prepare(
              "insert into department (id,name,created_at) values (?,?,unixepoch())"
            )
            .bind(departmentId, `角色負責部門${suffix}`)
            .run();
          await caseApp.db
            .prepare(
              "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, `角色負責聚會${suffix}`)
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
          await caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `Program Leader 通告${suffix}`,
              "只供獲授權人士閱讀。",
              programId
            )
            .run();
          await caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `其他 Program 通告${suffix}`,
              "不應向未獲授權人士顯示。",
              otherProgramId
            )
            .run();

          const grant = await admin.context.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                scopeId: programId,
                targetUserId,
              },
            }
          );
          expect(grant.status()).toBe(201);

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
              notices.getByText(`Program Leader 通告${suffix}`)
            ).toBeVisible();
            await expect(
              notices.getByText(`其他 Program 通告${suffix}`)
            ).toHaveCount(0);
          } finally {
            await homeContext.close();
          }

          const memberships = await caseApp.db
            .prepare(
              "select count(*) as count from department_membership where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          const enrolments = await caseApp.db
            .prepare(
              "select count(*) as count from enrolment where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          expect(memberships?.count).toBe(0);
          expect(enrolments?.count).toBe(0);
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "withdrawing a Program Leader removes only that Home path and retains role history",
      { tag: ["@browser", "@risk-atomicity", "@risk-privacy"] },
      async ({
        admin,
        browser,
        caseApp,
        extraHTTPHeaders,
        playwright,
        staff,
      }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-recipient-password!";
        const username = `roles.member.${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳收件人${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);
          const homeContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const departmentA = randomUUID();
            const programA = randomUUID();
            const departmentB = randomUUID();
            const programB = randomUUID();
            await caseApp.db
              .prepare(
                "insert into department (id,name,created_at) values (?,?,unixepoch())"
              )
              .bind(departmentA, `負責聚會部門${suffix}`)
              .run();
            await caseApp.db
              .prepare(
                "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
              )
              .bind(programA, departmentA, `負責聚會${suffix}`)
              .run();
            await caseApp.db
              .prepare(
                "insert into department (id,name,created_at) values (?,?,unixepoch())"
              )
              .bind(departmentB, `獨立會籍部門${suffix}`)
              .run();
            await caseApp.db
              .prepare(
                "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
              )
              .bind(programB, departmentB, `獨立會籍聚會${suffix}`)
              .run();
            await caseApp.db
              .prepare(
                "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
              )
              .bind(randomUUID(), departmentB, targetUserId)
              .run();
            await caseApp.db
              .prepare(
                "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,'approved',unixepoch(),unixepoch())"
              )
              .bind(randomUUID(), programB, targetUserId)
              .run();
            await caseApp.db.batch(
              (
                [
                  [`撤回後不可見聚會通告${suffix}`, "program", programA],
                  [`仍可見會籍聚會通告${suffix}`, "program", programB],
                  [`仍可見部門通告${suffix}`, "department", departmentB],
                ] as const
              ).map(([title, scopeType, scopeId]) =>
                caseApp.db
                  .prepare(
                    "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,? ,?, ?,unixepoch(),null,unixepoch())"
                  )
                  .bind(
                    randomUUID(),
                    title,
                    "合成測試通告。",
                    scopeType,
                    scopeId
                  )
              )
            );

            const operationKey = randomUUID();
            const grant = await admin.context.post(
              "/api/v2/roles/program-leaders",
              {
                data: {
                  action: "granted",
                  operationKey,
                  scopeId: programA,
                  targetUserId,
                },
              }
            );
            expect(grant.status()).toBe(201);
            const assignment = await caseApp.db
              .prepare(
                "select id from program_leader_assignment where user_id = ? and program_id = ?"
              )
              .bind(targetUserId, programA)
              .first<{ id: string }>();
            if (!assignment) {
              throw new Error("Expected Program Leader assignment");
            }

            const page = await homeContext.newPage();
            await page.goto("/");
            const notices = page.getByRole("region", { name: "教會消息" });
            await expect(
              notices.getByText(`撤回後不可見聚會通告${suffix}`)
            ).toBeVisible();
            await expect(
              notices.getByText(`仍可見會籍聚會通告${suffix}`)
            ).toBeVisible();
            await expect(
              notices.getByText(`仍可見部門通告${suffix}`)
            ).toBeVisible();

            await caseApp.db
              .prepare("update program set name = ? where id = ?")
              .bind(`重新命名聚會${suffix}`, programA)
              .run();

            const withdrawal = await admin.context.post(
              "/api/v2/roles/program-leaders",
              {
                data: {
                  action: "withdrawn",
                  expectedAssignmentId: assignment.id,
                  operationKey: randomUUID(),
                  scopeId: programA,
                  targetUserId,
                },
              }
            );
            expect(withdrawal.status()).toBe(201);
            await page.reload();
            await expect(
              notices.getByText(`撤回後不可見聚會通告${suffix}`)
            ).toHaveCount(0);
            await expect(
              notices.getByText(`仍可見會籍聚會通告${suffix}`)
            ).toBeVisible();
            await expect(
              notices.getByText(`仍可見部門通告${suffix}`)
            ).toBeVisible();

            const roleEvents = await recipient.get("/api/v2/inbox");
            expect(roleEvents.status()).toBe(200);
            const inbox = (await roleEvents.json()) as {
              data: {
                roleChanges: {
                  action: string;
                  createdAt: number;
                  role: string;
                  scopeName: string;
                }[];
              };
            };
            expect(inbox.data.roleChanges).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  action: "granted",
                  role: "program_leader",
                  scopeName: `負責聚會${suffix}`,
                }),
                expect.objectContaining({
                  action: "withdrawn",
                  role: "program_leader",
                  scopeName: `重新命名聚會${suffix}`,
                }),
              ])
            );
            expect(JSON.stringify(inbox)).not.toContain(targetUserId);
            expect(JSON.stringify(inbox)).not.toContain(operationKey);
            const otherInbox = await staff.context.get("/api/v2/inbox");
            expect(otherInbox.status()).toBe(200);
            const otherInboxBody = await otherInbox.json();
            expect(otherInboxBody.data.roleChanges).toEqual([]);

            const retained = await caseApp.db
              .prepare(
                "select count(*) as assignments from program_leader_assignment where user_id = ?"
              )
              .bind(targetUserId)
              .first<{ assignments: number }>();
            expect(retained?.assignments).toBe(0);
            expect(
              await caseApp.db
                .prepare(
                  "select count(*) as count from department_membership where user_id = ?"
                )
                .bind(targetUserId)
                .first<{ count: number }>()
            ).toEqual({ count: 1 });
            expect(
              await caseApp.db
                .prepare(
                  "select count(*) as count from enrolment where user_id = ?"
                )
                .bind(targetUserId)
                .first<{ count: number }>()
            ).toEqual({ count: 1 });

            await caseApp.db
              .prepare("delete from department_membership where user_id = ?")
              .bind(targetUserId)
              .run();
            await caseApp.db
              .prepare("delete from enrolment where user_id = ?")
              .bind(targetUserId)
              .run();
            const deletion = await admin.context.post(
              "/api/v2/staff/accounts/delete",
              { data: { operationKey: randomUUID(), targetUserId } }
            );
            expect(deletion.status()).toBe(409);
            expect(await deletion.json()).toMatchObject({
              error: { code: "church_history_retained" },
            });
            await expect(
              caseApp.db
                .prepare("delete from user where id = ?")
                .bind(targetUserId)
                .run()
            ).rejects.toThrow();
          } finally {
            await homeContext.close();
          }
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "Admin projections are current and Staff or a Program Leader cannot manage assignments",
      { tag: ["@http", "@risk-authorization", "@risk-privacy"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright, staff }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const username = `roles.member.${suffix}`;
        const password = "Synthetic-recipient-password!";
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳選取人士${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `選取部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `選取聚會${suffix}`)
          .run();
        const grant = await admin.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          }
        );
        expect(grant.status()).toBe(201);

        const search = await admin.context.get(
          `/api/v2/roles/program-leaders?q=${encodeURIComponent(`陳選取人士${suffix}`)}`
        );
        expect(search.status()).toBe(200);
        const searchBody = (await search.json()) as {
          data: {
            actorUserId: string;
            candidates: { fullName: string; userId: string }[];
            hasNextPage: boolean;
            page: number;
          };
        };
        expect(searchBody.data.actorUserId).toBe(admin.userId);
        expect(searchBody.data.candidates).toContainEqual({
          fullName: `陳選取人士${suffix}`,
          userId: targetUserId,
          username,
        });
        expect(searchBody.data.page).toBe(1);

        const programs = await admin.context.get(
          "/api/v2/roles/program-leaders/programs?page=1"
        );
        expect(programs.status()).toBe(200);
        expect(await programs.json()).toMatchObject({
          data: {
            page: 1,
            programs: [
              expect.objectContaining({
                departmentName: `選取部門${suffix}`,
                id: programId,
                name: `選取聚會${suffix}`,
              }),
            ],
          },
        });

        const person = await admin.context.get(
          `/api/v2/roles/program-leaders/${encodeURIComponent(targetUserId)}?assignmentPage=1`
        );
        expect(person.status()).toBe(200);
        expect(await person.json()).toMatchObject({
          data: {
            person: {
              assignments: [
                expect.objectContaining({
                  departmentName: `選取部門${suffix}`,
                  scopeId: programId,
                  scopeName: `選取聚會${suffix}`,
                }),
              ],
              eligibleForGrant: true,
              fullName: `陳選取人士${suffix}`,
              userId: targetUserId,
              username,
            },
          },
        });

        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);
          const memberRead = await recipient.get(
            "/api/v2/roles/program-leaders/programs"
          );
          expect(memberRead.status()).toBe(403);
          const memberWrite = await recipient.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                scopeId: programId,
                targetUserId,
              },
            }
          );
          expect(memberWrite.status()).toBe(403);
        } finally {
          await recipient.dispose();
        }

        const staffRead = await staff.context.get(
          "/api/v2/roles/program-leaders/programs"
        );
        expect(staffRead.status()).toBe(403);
        const staffWrite = await staff.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          }
        );
        expect(staffWrite.status()).toBe(403);
      }
    );

    roleTest(
      "an Admin may assign Member, Staff and Admin accounts including self without scoped membership",
      { tag: ["@http", "@risk-authorization", "@risk-atomicity"] },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `廣泛授權部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `廣泛授權聚會${suffix}`)
          .run();

        const targetIds = [
          admin.userId,
          ...(await Promise.all(
            (["member", "staff", "admin"] as const).map((role) =>
              caseApp.provision.account({
                email: `${suffix}.${role}@example.com`,
                fullName: `陳廣泛授權${role}${suffix}`,
                membershipStatus: "active",
                password: "Synthetic-role-target-password!",
                role,
                username: `roles.${role}.${suffix}`,
              })
            )
          )),
        ];

        const grants = await Promise.all(
          targetIds.map((targetUserId) =>
            admin.context.post("/api/v2/roles/program-leaders", {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                scopeId: programId,
                targetUserId,
              },
            })
          )
        );
        expect(grants.map((grant) => grant.status())).toEqual(
          targetIds.map(() => 201)
        );

        const assignments = await caseApp.db
          .prepare(
            "select count(*) as count from program_leader_assignment where program_id = ?"
          )
          .bind(programId)
          .first<{ count: number }>();
        expect(assignments?.count).toBe(4);
        const targetParticipation = await Promise.all(
          targetIds.map((targetUserId) =>
            caseApp.db
              .prepare(
                "select (select count(*) from department_membership where user_id = ?) as memberships, (select count(*) from enrolment where user_id = ?) as enrolments"
              )
              .bind(targetUserId, targetUserId)
              .first()
          )
        );
        expect(targetParticipation).toEqual(
          targetIds.map(() => ({ enrolments: 0, memberships: 0 }))
        );
      }
    );

    roleTest(
      "an existing Program Leader remains withdrawable after membership deactivation",
      { tag: ["@http", "@risk-authorization", "@risk-atomicity"] },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳已離任負責人${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-role-target-password!",
          role: "member",
          username: `roles.departed.${suffix}`,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `已離任部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `已離任聚會${suffix}`)
          .run();
        const grant = await admin.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          }
        );
        expect(grant.status()).toBe(201);
        await caseApp.db
          .prepare(
            "update person_profile set membership_status='deactivated' where user_id=?"
          )
          .bind(targetUserId)
          .run();

        const detail = await admin.context.get(
          `/api/v2/roles/program-leaders/${encodeURIComponent(targetUserId)}`
        );
        expect(detail.status()).toBe(200);
        const detailBody = (await detail.json()) as {
          data: {
            person: {
              assignments: { assignmentId: string; scopeId: string }[];
              eligibleForGrant: boolean;
            };
          };
        };
        expect(detailBody.data.person.eligibleForGrant).toBe(false);
        const assignment = detailBody.data.person.assignments.find(
          (current) => current.scopeId === programId
        );
        if (!assignment) {
          throw new Error("Expected retained Program Leader assignment");
        }
        const withdrawal = await admin.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: assignment.assignmentId,
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          }
        );
        expect(withdrawal.status()).toBe(201);
        expect(
          await caseApp.db
            .prepare(
              "select count(*) as count from program_leader_assignment where user_id=? and program_id=?"
            )
            .bind(targetUserId, programId)
            .first<{ count: number }>()
        ).toEqual({ count: 0 });
      }
    );
  }
);
