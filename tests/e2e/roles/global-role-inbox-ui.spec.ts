import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const inboxTest = dedicatedTest.extend<{
  admin: { context: APIRequestContext; password: string; userId: string };
}>({
  admin: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const password = "Synthetic-native-password!";
    const username = `inboxa.${suffix}`;
    const userId = await caseApp.provision.account({
      email: `${suffix}@example.com`,
      fullName: `陳收件匣管理員${suffix}`,
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
      await use({ context, password, userId });
    } finally {
      await context.dispose();
    }
  },
});

const confirmAdmin = async (context: APIRequestContext, password: string) => {
  const confirmation = await context.post(
    "/api/v2/account/password-confirmation",
    { data: { operationKey: randomUUID(), password } }
  );
  expect(confirmation.status()).toBe(201);
};

inboxTest.describe(
  "Global role recipient Inbox",
  {
    tag: ["@native", "@risk-authorization", "@risk-history", "@risk-privacy"],
  },
  () => {
    inboxTest(
      "recipient role history has one bounded continuation without exposing history identifiers",
      { tag: ["@http"] },
      async ({ caseApp, playwright, extraHTTPHeaders }) => {
        const suffix = randomUUID().slice(0, 8);
        const password = "Synthetic-inbox-pagination-password!";
        const username = `inbox.page.${suffix}`;
        const userId = await caseApp.provision.account({
          email: `inbox-page-${suffix}@example.com`,
          fullName: "合成收件人",
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        await caseApp.db.batch(
          Array.from({ length: 26 }, (_, index) =>
            caseApp.db
              .prepare(
                "INSERT INTO role_assignment_history (id, actor_user_id, target_user_id, role, action, scope_id, scope_name, created_at) VALUES (?, ?, ?, 'department_manager', 'granted', ?, ?, ?)"
              )
              .bind(
                `private-history-${index.toString().padStart(2, "0")}`,
                "synthetic-actor",
                userId,
                "private-scope",
                `部門 ${index}`,
                1_700_000_000 + index
              )
          )
        );
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);
          const first = await recipient.get("/api/v2/inbox");
          const firstBody = await first.json();
          expect(firstBody.data.roleChanges).toHaveLength(25);
          expect(firstBody.data.page).toEqual({
            hasNext: true,
            hasPrevious: false,
            number: 1,
          });
          expect(JSON.stringify(firstBody)).not.toContain("private-history");
          expect(JSON.stringify(firstBody)).not.toContain("private-scope");
          const second = await recipient.get("/api/v2/inbox?page=2");
          const secondBody = await second.json();
          expect(secondBody.data.roleChanges).toHaveLength(1);
          expect(secondBody.data.roleChanges[0].scopeName).toBe("部門 0");
          expect(secondBody.data.page).toEqual({
            hasNext: false,
            hasPrevious: true,
            number: 2,
          });
        } finally {
          await recipient.dispose();
        }
      }
    );
    inboxTest(
      "an Admin grant appears as the resulting Admin role in the recipient Inbox",
      { tag: ["@browser", "@mobile-critical"] },
      async (
        { admin, browser, caseApp, extraHTTPHeaders, playwright },
        testInfo
      ) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const password = "Synthetic-admin-inbox-recipient-password!";
        const username = `inboxad.${suffix}`;
        const fullName = `陳管理員收件人${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const operationKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const grant = await admin.context.post("/api/v2/roles/global-roles", {
          data: {
            action: "granted",
            operationKey,
            role: "admin",
            targetUserId,
          },
        });
        expect(grant.status()).toBe(201);
        expect(await grant.json()).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              resultingGlobalRole: "admin",
              role: "admin",
              targetUserId,
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
          const roleRead = await recipient.get("/api/v2/roles/global-roles");
          expect(roleRead.status()).toBe(200);
          const response = await recipient.get("/api/v2/inbox");
          expect(response.status()).toBe(200);
          const inbox = (await response.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                resultingGlobalRole?: string;
                role: string;
                scopeName: string;
              }[];
            };
          };
          expect(inbox.data.roleChanges).toEqual([
            expect.objectContaining({
              action: "granted",
              createdAt: expect.any(Number),
              resultingGlobalRole: "admin",
              role: "admin",
              scopeName: "全域角色",
            }),
          ]);
          expect(
            Object.keys(inbox.data.roleChanges[0] ?? {}).toSorted()
          ).toEqual([
            "action",
            "createdAt",
            "resultingGlobalRole",
            "role",
            "scopeName",
          ]);
          const privateContent = JSON.stringify(inbox);
          for (const value of [
            admin.userId,
            targetUserId,
            operationKey,
            username,
            fullName,
          ]) {
            expect(privateContent).not.toContain(value);
          }

          const recipientContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const page = await recipientContext.newPage();
            await page.goto("/inbox");
            const main = page.getByRole("main");
            await expect(
              main.getByRole("heading", { exact: true, name: "收件匣" })
            ).toBeVisible();
            const adminHeading = main.getByRole("heading", {
              exact: true,
              name: "帳戶身份已變更為管理員",
            });
            await expect(adminHeading).toBeVisible();
            await expect(
              main.getByText("帳戶身份已變更", { exact: true })
            ).toBeVisible();
            await qualifyPresentation(page, testInfo, "inbox-admin-grant", {
              criticalAction: adminHeading,
              drafts: page.locator("input"),
              masks: [
                page
                  .getByRole("navigation", { name: "主要導覽" })
                  .getByText(fullName, { exact: true }),
                page
                  .getByRole("navigation", { name: "主要導覽" })
                  .getByText(username, { exact: true }),
              ],
            });
          } finally {
            await recipientContext.close();
          }
        } finally {
          await recipient.dispose();
        }
      }
    );

    inboxTest(
      "an Admin Staff grant shows the recipient's resulting Global role in Inbox",
      { tag: ["@browser", "@mobile-critical"] },
      async (
        { admin, browser, caseApp, extraHTTPHeaders, playwright },
        testInfo
      ) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const password = "Synthetic-recipient-password!";
        const username = `inboxm.${suffix}`;
        const fullName = `陳收件職員${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const operationKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const promotion = await admin.context.post(
          "/api/v2/roles/global-roles",
          {
            data: {
              action: "granted",
              operationKey,
              role: "staff",
              targetUserId,
            },
          }
        );
        expect(promotion.status()).toBe(201);
        expect(await promotion.json()).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              resultingGlobalRole: "staff",
              role: "staff",
              targetUserId,
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

          const staffAccess = await recipient.get("/api/v2/staff/accounts");
          expect(staffAccess.status()).toBe(200);

          const inboxResponse = await recipient.get("/api/v2/inbox");
          expect(inboxResponse.status()).toBe(200);
          const inbox = (await inboxResponse.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                resultingGlobalRole: string;
                role: string;
                scopeName: string;
              }[];
            };
          };
          expect(inbox.data.roleChanges).toEqual([
            expect.objectContaining({
              action: "granted",
              createdAt: expect.any(Number),
              resultingGlobalRole: "staff",
              role: "staff",
              scopeName: "全域角色",
            }),
          ]);
          const [event] = inbox.data.roleChanges;
          expect(event).toBeDefined();
          expect(Object.keys(event ?? {}).toSorted()).toEqual([
            "action",
            "createdAt",
            "resultingGlobalRole",
            "role",
            "scopeName",
          ]);
          expect(JSON.stringify(inbox)).not.toContain(targetUserId);
          expect(JSON.stringify(inbox)).not.toContain(operationKey);
          expect(JSON.stringify(inbox)).not.toContain(username);
          expect(JSON.stringify(inbox)).not.toContain(fullName);
          expect(JSON.stringify(inbox)).not.toContain(admin.userId);

          const recipientContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const page = await recipientContext.newPage();
            await page.goto("/inbox");
            const main = page.getByRole("main");
            await expect(
              main.getByRole("heading", { exact: true, name: "收件匣" })
            ).toBeVisible();
            await expect(
              main.getByRole("heading", {
                exact: true,
                name: "帳戶身份已變更為職員",
              })
            ).toBeVisible();
            await expect(
              main.getByText("全域角色", { exact: true })
            ).toBeVisible();
            const staffHeading = main.getByRole("heading", {
              exact: true,
              name: "帳戶身份已變更為職員",
            });
            await qualifyPresentation(page, testInfo, "inbox", {
              criticalAction: staffHeading,
              drafts: page.locator("input"),
              masks: [
                page
                  .getByRole("navigation", { name: "主要導覽" })
                  .getByText(fullName, { exact: true }),
                page
                  .getByRole("navigation", { name: "主要導覽" })
                  .getByText(username, { exact: true }),
              ],
            });
          } finally {
            await recipientContext.close();
          }
        } finally {
          await recipient.dispose();
        }
      }
    );

    inboxTest(
      "a recipient retains Staff and Role Assigner history after Staff exit",
      { tag: ["@browser", "@mobile-critical"] },
      async (
        { admin, browser, caseApp, extraHTTPHeaders, playwright },
        testInfo
      ) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const password = "Synthetic-exiting-staff-password!";
        const username = `inboxx.${suffix}`;
        const fullName = `陳退出職員${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });

        const staffGrantKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const staffGrant = await admin.context.post(
          "/api/v2/roles/global-roles",
          {
            data: {
              action: "granted",
              operationKey: staffGrantKey,
              role: "staff",
              targetUserId,
            },
          }
        );
        expect(staffGrant.status()).toBe(201);
        const staffGrantBody = (await staffGrant.json()) as {
          data: {
            receipt: { id: string; resultingGlobalRole: string; role: string };
          };
        };
        expect(staffGrantBody.data.receipt).toMatchObject({
          resultingGlobalRole: "staff",
          role: "staff",
          targetUserId,
        });

        const roleAssignerGrantKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const roleAssignerGrant = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: roleAssignerGrantKey,
              targetUserId,
            },
          }
        );
        expect(roleAssignerGrant.status()).toBe(201);
        const roleAssignerGrantBody = (await roleAssignerGrant.json()) as {
          data: { receipt: { action: string; id: string; role: string } };
        };
        expect(roleAssignerGrantBody.data.receipt).toMatchObject({
          action: "granted",
          role: "role_assigner",
          targetUserId,
        });
        expect(roleAssignerGrantBody.data.receipt).not.toHaveProperty(
          "resultingGlobalRole"
        );

        const staffExitKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const staffExit = await admin.context.post(
          "/api/v2/roles/global-roles",
          {
            data: {
              action: "withdrawn",
              operationKey: staffExitKey,
              role: "staff",
              targetUserId,
            },
          }
        );
        expect(staffExit.status()).toBe(201);
        const staffExitBody = (await staffExit.json()) as {
          data: { receipt: { id: string; resultingGlobalRole: string } };
        };
        expect(staffExitBody.data.receipt).toMatchObject({
          resultingGlobalRole: "member",
          role: "staff",
          targetUserId,
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
          const staffAccess = await recipient.get("/api/v2/staff/accounts");
          expect(staffAccess.status()).toBe(403);

          const inboxResponse = await recipient.get("/api/v2/inbox");
          expect(inboxResponse.status()).toBe(200);
          const inbox = (await inboxResponse.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                resultingGlobalRole?: string;
                role: string;
                scopeName: string;
              }[];
            };
          };
          const staffEvents = inbox.data.roleChanges.filter(
            (event) => event.role === "staff"
          );
          expect(staffEvents).toHaveLength(2);
          expect(staffEvents).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: "granted",
                resultingGlobalRole: "staff",
                role: "staff",
                scopeName: "全域角色",
              }),
              expect.objectContaining({
                action: "withdrawn",
                resultingGlobalRole: "member",
                role: "staff",
                scopeName: "全域角色",
              }),
            ])
          );
          expect(
            staffEvents.map((event) => Object.keys(event).toSorted())
          ).toEqual(
            Array.from({ length: 2 }, () => [
              "action",
              "createdAt",
              "resultingGlobalRole",
              "role",
              "scopeName",
            ])
          );

          const roleAssignerEvents = inbox.data.roleChanges.filter(
            (event) => event.role === "role_assigner"
          );
          expect(roleAssignerEvents).toHaveLength(2);
          expect(roleAssignerEvents).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: "granted",
                role: "role_assigner",
                scopeName: "全域角色",
              }),
              expect.objectContaining({
                action: "withdrawn",
                role: "role_assigner",
                scopeName: "全域角色",
              }),
            ])
          );
          expect(
            roleAssignerEvents.every(
              (event) => !("resultingGlobalRole" in event)
            )
          ).toBe(true);
          expect(
            roleAssignerEvents.map((event) => Object.keys(event).toSorted())
          ).toEqual(
            Array.from({ length: 2 }, () => [
              "action",
              "createdAt",
              "role",
              "scopeName",
            ])
          );

          const inboxJson = JSON.stringify(inbox);
          for (const privateValue of [
            admin.userId,
            targetUserId,
            staffGrantKey,
            staffGrantBody.data.receipt.id,
            roleAssignerGrantKey,
            roleAssignerGrantBody.data.receipt.id,
            staffExitKey,
            staffExitBody.data.receipt.id,
            username,
            fullName,
          ]) {
            expect(inboxJson).not.toContain(privateValue);
          }

          const recipientContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const page = await recipientContext.newPage();
            await page.goto("/inbox");
            const main = page.getByRole("main");
            await expect(
              main.getByRole("heading", {
                exact: true,
                name: "帳戶身份已變更為職員",
              })
            ).toBeVisible();
            const memberHeading = main.getByRole("heading", {
              exact: true,
              name: "帳戶身份已變更為會友",
            });
            await expect(memberHeading).toBeVisible();
            await expect(
              main.getByRole("heading", {
                exact: true,
                name: "獲委任為職務指派權",
              })
            ).toBeVisible();
            await expect(
              main.getByRole("heading", {
                exact: true,
                name: "職務指派權職責已撤回",
              })
            ).toBeVisible();
            await expect(
              main.getByText("全域角色", { exact: true })
            ).toHaveCount(4);
            await qualifyPresentation(page, testInfo, "inbox", {
              criticalAction: memberHeading,
              drafts: page.locator("input"),
              masks: [
                page
                  .getByRole("navigation", { name: "主要導覽" })
                  .getByText(fullName, { exact: true }),
                page
                  .getByRole("navigation", { name: "主要導覽" })
                  .getByText(username, { exact: true }),
              ],
            });
          } finally {
            await recipientContext.close();
          }
        } finally {
          await recipient.dispose();
        }
      }
    );
  }
);
