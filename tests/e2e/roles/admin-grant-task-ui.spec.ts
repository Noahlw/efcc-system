import { randomUUID } from "node:crypto";

import type { APIResponse, Page } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const expectHttpStatus = async (
  pending: Promise<APIResponse>,
  status: number
) => {
  const response = await pending;
  expect(response.status()).toBe(status);
};

const expectSessionActor = async (
  pending: Promise<APIResponse>,
  actorUserId: string | null
) => {
  const response = await pending;
  expect(response.status()).toBe(200);
  const body = await response.json();
  if (actorUserId === null) {
    expect(body).toBeNull();
  } else {
    expect(body.user.id).toBe(actorUserId);
  }
};

const expectPersonRole = async (response: APIResponse, role: string) => {
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.person.identity.role).toBe(role);
};

const login = async (
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

const grantTest = dedicatedTest.extend<{
  accounts: {
    admin: { userId: string; username: string; password: string };
    target: {
      userId: string;
      username: string;
      password: string;
      fullName: string;
    };
  };
}>({
  accounts: async ({ caseApp }, use) => {
    const suffix = randomUUID().slice(0, 8);
    const admin = {
      email: `grant.admin.${suffix}@example.com`,
      fullName: `陳授權管理員${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-admin-grant-password!",
      role: "admin" as const,
      username: `grant.admin.${suffix}`,
    };
    const target = {
      email: `grant.target.${suffix}@example.com`,
      fullName: `陳管理員授權測試長名字${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-admin-target-password!",
      role: "member" as const,
      username: `grant.target.${suffix}`,
    };
    await use({
      admin: { ...admin, userId: await caseApp.provision.account(admin) },
      target: { ...target, userId: await caseApp.provision.account(target) },
    });
  },
});

const openTask = async (page: Page, target: { userId: string }) => {
  await page.goto(
    `/roles/people/identity?person=${target.userId}&returnTo=${encodeURIComponent(`/roles/people?person=${target.userId}`)}`
  );
  await expect(page.getByRole("radio", { name: /^管理員/u })).toBeEnabled();
  await page.getByRole("radio", { name: /^管理員/u }).check();
  await expect(
    page.getByText(
      "此帳戶的所有登入將會結束，須重新登入；你會保留管理員身份及目前登入。",
      { exact: false }
    )
  ).toBeVisible();
};
const confirmProof = async (page: Page, password: string) => {
  const dialog = page.getByRole("dialog", { name: "確認目前密碼" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { exact: true, name: "目前密碼" })
    .fill(password);
  await dialog
    .getByRole("button", { exact: true, name: "確認並返回檢查" })
    .click();
  await expect(
    dialog.getByText("伺服器已確認「確認目前密碼」完成。", { exact: true })
  ).toBeVisible();
  await dialog
    .getByRole("button", { exact: true, name: "確認並返回檢查" })
    .click();
  await expect(dialog).toHaveCount(0);
};
const save = (page: Page) =>
  page.getByRole("button", { exact: true, name: "儲存" }).click();

grantTest.describe(
  "Direct Admin grant task",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-history",
      "@risk-session",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  () => {
    for (const baseline of ["member", "staff"] as const) {
      grantTest(
        `${baseline} grants Admin directly with fresh overview, all target Sessions revoked and grantor continuity`,
        async ({ accounts, browser, caseApp, extraHTTPHeaders }, testInfo) => {
          const { admin, target } = accounts;
          // Three logical devices keep distinct, stable client addresses.
          // The recipient's fresh sign-in reuses its original device/IP.
          const context = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.19.202.10",
            },
          });
          const [recipientContext, otherRecipientContext] = await Promise.all([
            browser.newContext({
              baseURL: caseApp.origin,
              extraHTTPHeaders: {
                ...extraHTTPHeaders,
                "cf-connecting-ip": "198.19.202.11",
              },
            }),
            browser.newContext({
              baseURL: caseApp.origin,
              extraHTTPHeaders: {
                ...extraHTTPHeaders,
                "cf-connecting-ip": "198.19.202.12",
              },
            }),
          ]);
          const targetContexts = [recipientContext, otherRecipientContext];
          try {
            await Promise.all(
              targetContexts.map(async (targetContext) => {
                const response = await targetContext.request.post(
                  "/api/auth/sign-in/username",
                  {
                    data: {
                      password: target.password,
                      username: target.username,
                    },
                  }
                );
                expect(response.status()).toBe(200);
                await expectSessionActor(
                  targetContext.request.get("/api/auth/get-session"),
                  target.userId
                );
              })
            );
            const page = await context.newPage();
            await login(page, admin);
            const proof = await context.request.post(
              "/api/v2/account/password-confirmation",
              { data: { operationKey: randomUUID(), password: admin.password } }
            );
            expect(proof.status()).toBe(201);
            if (baseline === "staff") {
              const staff = await context.request.post(
                "/api/v2/roles/global-roles",
                {
                  data: {
                    action: "granted",
                    operationKey: randomUUID(),
                    role: "staff",
                    targetUserId: target.userId,
                  },
                  headers: { "x-efcc-expected-actor-id": admin.userId },
                }
              );
              expect(staff.status()).toBe(201);
              const delegation = await context.request.post(
                "/api/v2/roles/role-assigners",
                {
                  data: {
                    action: "granted",
                    operationKey: randomUUID(),
                    targetUserId: target.userId,
                  },
                }
              );
              expect(delegation.status()).toBe(201);
            }
            const commands: Record<string, unknown>[] = [];
            page.on("request", (request) => {
              if (
                request.method() === "POST" &&
                new URL(request.url()).pathname === "/api/v2/roles/global-roles"
              ) {
                commands.push(request.postDataJSON());
              }
            });
            await openTask(page, target);
            await page.setViewportSize({ height: 480, width: 320 });
            await page.evaluate(() => {
              document.documentElement.style.fontSize = "200%";
            });
            const presentation = {
              criticalAction: page.getByRole("button", {
                exact: true,
                name: "儲存",
              }),
              drafts: page.getByRole("radio"),
              masks: [
                page.getByRole("heading", { name: target.fullName }),
                page.getByText(target.username, { exact: true }),
              ],
            };
            await qualifyPresentation(
              page,
              testInfo,
              `admin-grant-${baseline}-phone`,
              presentation
            );
            await qualifyPresentation(
              page,
              testInfo,
              `admin-grant-${baseline}-desktop`,
              presentation
            );
            await save(page);
            await expect(page).toHaveURL(
              new RegExp(`/roles/people\\?person=${target.userId}$`, "u")
            );
            const overview = page.getByRole("article", {
              name: target.fullName,
            });
            await expect(
              overview.getByText("管理員", { exact: true }).first()
            ).toBeVisible();
            await expect(
              overview
                .getByRole("status")
                .filter({ hasText: "此帳戶須重新登入" })
            ).toBeVisible();
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await expect(
              page.getByRole("link", { exact: true, name: "管理帳戶身份" })
            ).toHaveCount(0);
            expect(commands).toHaveLength(1);
            expect(commands[0]).toMatchObject({
              action: "granted",
              role: "admin",
              targetUserId: target.userId,
            });
            const current = await context.request.get(
              `/api/v2/roles/people/${target.userId}`
            );
            expect(current.status()).toBe(200);
            const currentBody = await current.json();
            expect(currentBody.data.person).toMatchObject({
              actorUserId: admin.userId,
              capabilities: { canManageAccountRole: false },
              identity: { role: "admin" },
            });
            await expectSessionActor(
              context.request.get("/api/auth/get-session"),
              admin.userId
            );
            await Promise.all(
              targetContexts.map((targetContext) =>
                expectSessionActor(
                  targetContext.request.get("/api/auth/get-session"),
                  null
                )
              )
            );
            const freshSignIn = await recipientContext.request.post(
              "/api/auth/sign-in/username",
              { data: { password: target.password, username: target.username } }
            );
            expect(freshSignIn.status()).toBe(200);
            await expectSessionActor(
              recipientContext.request.get("/api/auth/get-session"),
              target.userId
            );
            const inbox = await recipientContext.request.get("/api/v2/inbox");
            expect(inbox.status()).toBe(200);
            const inboxBody = await inbox.json();
            const events = inboxBody.data.roleChanges;
            expect(events).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  action: "granted",
                  resultingGlobalRole: "admin",
                  role: "admin",
                }),
              ])
            );
            expect(
              events.filter((event: { role: string }) => event.role === "admin")
            ).toHaveLength(1);
            if (baseline === "staff") {
              expect(events).toEqual(
                expect.arrayContaining([
                  expect.objectContaining({
                    action: "withdrawn",
                    role: "role_assigner",
                  }),
                ])
              );
              const cleanupRead = await context.request.get(
                `/api/v2/roles/people/${target.userId}`
              );
              const cleanupBody = await cleanupRead.json();
              expect(
                cleanupBody.data.person.global.roleAssignerAssignment
              ).toBeNull();
            }
          } finally {
            await Promise.all(
              targetContexts.map((targetContext) => targetContext.close())
            );
            await context.close();
          }
        }
      );
    }
    grantTest(
      "expired proof retains Admin choice for explicit second Save; authentication expiry is not proof recovery",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          const proof = await context.request.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password: admin.password } }
          );
          expect(proof.status()).toBe(201);
          await openTask(page, target);
          await caseApp.db
            .prepare(
              "UPDATE session SET password_confirmed_at = unixepoch() - 601 WHERE user_id = ?"
            )
            .bind(admin.userId)
            .run();
          await save(page);
          await confirmProof(page, admin.password);
          await expect(
            page.getByRole("radio", { name: /^管理員/u })
          ).toBeChecked();
          const unchanged = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          await expectPersonRole(unchanged, "member");
          await caseApp.db
            .prepare(
              "UPDATE session SET expires_at = unixepoch() - 1 WHERE user_id = ?"
            )
            .bind(admin.userId)
            .run();
          await save(page);
          await expect(page).toHaveURL(/\/sign-in/u);
          await expect(
            page.getByRole("dialog", { name: "確認目前密碼" })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );

    grantTest(
      "committed response loss keeps one original key through reload and reconciles to fresh Admin overview",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: admin.password,
              },
            }),
            201
          );
          await openTask(page, target);
          let originalKey = "";
          let dispatches = 0;
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            dispatches += 1;
            originalKey = route.request().postDataJSON().operationKey;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            await route.abort("failed");
          });
          await save(page);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          const storageKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
          expect(
            await page.evaluate(
              (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
              storageKey
            )
          ).toEqual({ actorUserId: admin.userId, operationKey: originalKey });
          // Admin is now protected from further identity edits; recovery needs only
          // current grantor authority, never continued target edit eligibility.
          await page.reload();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          await expect(page).toHaveURL(
            new RegExp(`/roles/people\\?person=${target.userId}$`, "u")
          );
          await expect(
            page
              .getByRole("article", { name: target.fullName })
              .getByText("管理員", { exact: true })
              .first()
          ).toBeVisible();
          expect(dispatches).toBe(1);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBeNull();
        } finally {
          await context.close();
        }
      }
    );

    grantTest(
      "current protected Admin and ineligible targets cannot receive crafted or visible Admin grants",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const peerContext = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: {
            ...extraHTTPHeaders,
            "cf-connecting-ip": "198.19.202.13",
          },
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: admin.password,
              },
            }),
            201
          );
          const peerAccount = {
            email: `${randomUUID()}@example.com`,
            fullName: "陳受保護管理員",
            membershipStatus: "active" as const,
            password: "Synthetic-protected-admin-password!",
            role: "admin" as const,
            username: `peer.${randomUUID().slice(0, 8)}`,
          };
          const peerId = await caseApp.provision.account(peerAccount);
          await expectHttpStatus(
            peerContext.request.post("/api/auth/sign-in/username", {
              data: {
                password: peerAccount.password,
                username: peerAccount.username,
              },
            }),
            200
          );
          await expectSessionActor(
            peerContext.request.get("/api/auth/get-session"),
            peerId
          );
          const beforeInbox = await peerContext.request.get("/api/v2/inbox");
          expect(beforeInbox.status()).toBe(200);
          const beforeInboxBody = await beforeInbox.json();
          const peerOperationKey = randomUUID();
          const peer = await context.request.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "withdrawn",
                operationKey: peerOperationKey,
                resultingGlobalRole: "member",
                role: "admin",
                targetUserId: peerId,
              },
              headers: { "x-efcc-expected-actor-id": admin.userId },
            }
          );
          // Peer withdrawal is outside the self-exit command contract. The
          // existing target/self guard rejects it before receipt/SQL effects.
          expect(peer.status()).toBe(409);
          const peerBody = await peer.json();
          expect(peerBody).toMatchObject({ error: { code: "conflict" } });
          await expectSessionActor(
            peerContext.request.get("/api/auth/get-session"),
            peerId
          );
          const afterInbox = await peerContext.request.get("/api/v2/inbox");
          expect(afterInbox.status()).toBe(200);
          const afterInboxBody = await afterInbox.json();
          expect(afterInboxBody.data.roleChanges).toEqual(
            beforeInboxBody.data.roleChanges
          );
          const receiptRead = await context.request.post(
            "/api/v2/roles/global-roles/reconcile",
            {
              data: { operationKey: peerOperationKey },
              headers: { "x-efcc-expected-actor-id": admin.userId },
            }
          );
          expect(receiptRead.status()).toBe(200);
          const receiptBody = await receiptRead.json();
          expect(receiptBody.data).toMatchObject({
            outcome: "unknown",
            receipt: null,
          });
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
            )
            .bind(target.userId)
            .run();
          const denied = await context.request.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                role: "admin",
                targetUserId: target.userId,
              },
              headers: { "x-efcc-expected-actor-id": admin.userId },
            }
          );
          expect(denied.ok()).toBe(false);
          const ineligibleRead = await context.request.get(
            `/api/v2/roles/global-roles/${target.userId}`
          );
          expect(ineligibleRead.status()).toBe(200);
          const ineligibleBody = await ineligibleRead.json();
          expect(ineligibleBody.data.person).toMatchObject({
            eligibleForAdmin: false,
            role: "member",
          });
          const current = await context.request.get(
            `/api/v2/roles/people/${admin.userId}`
          );
          const currentBody = await current.json();
          expect(
            currentBody.data.person.capabilities.canManageAccountRole
          ).toBe(false);
          const assigner = {
            email: `${randomUUID()}@example.com`,
            fullName: "陳授權職員",
            membershipStatus: "active" as const,
            password: "Synthetic-assigner-projection-password!",
            role: "staff" as const,
            username: `assigner.${randomUUID().slice(0, 8)}`,
          };
          const assignerId = await caseApp.provision.account(assigner);
          await expectHttpStatus(
            context.request.post("/api/v2/roles/role-assigners", {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId: assignerId,
              },
            }),
            201
          );
          const delegated = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
          });
          try {
            await expectHttpStatus(
              delegated.request.post("/api/auth/sign-in/username", {
                data: {
                  password: assigner.password,
                  username: assigner.username,
                },
              }),
              200
            );
            const protectedRead = await delegated.request.get(
              `/api/v2/roles/people/${peerId}`
            );
            expect(protectedRead.status()).toBe(404);
            const protectedText = await protectedRead.text();
            expect(protectedText).not.toContain("陳受保護管理員");
            expect(protectedText).not.toContain(peerId);
            const staffRead = await delegated.request.get(
              `/api/v2/roles/people/${assignerId}`
            );
            expect(staffRead.status()).toBe(404);
            const crafted = await delegated.request.post(
              "/api/v2/roles/global-roles",
              {
                data: {
                  action: "granted",
                  operationKey: randomUUID(),
                  role: "admin",
                  targetUserId: peerId,
                },
                headers: { "x-efcc-expected-actor-id": assignerId },
              }
            );
            expect(crafted.status()).toBe(403);
          } finally {
            await delegated.close();
          }
          const allowedAdmin = await context.request.get(
            `/api/v2/roles/people/${peerId}`
          );
          expect(allowedAdmin.status()).toBe(200);
          await expectPersonRole(allowedAdmin, "admin");
          await page.goto(`/roles/people?person=${peerId}`);
          await expect(
            page.getByRole("article", { name: peerAccount.fullName })
          ).toBeVisible();
          await expect(
            page.getByRole("link", { exact: true, name: "管理帳戶身份" })
          ).toHaveCount(0);
          await page.goto(`/roles/people/identity?person=${peerId}`);
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(page.getByRole("radio")).toHaveCount(0);
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
            )
            .bind(peerId)
            .run();
          const restrictedAdmin = await context.request.get(
            `/api/v2/roles/people/${peerId}`
          );
          expect(restrictedAdmin.status()).toBe(404);
          expect(await restrictedAdmin.text()).not.toContain("陳受保護管理員");
          await page.goto(`/roles/people/identity?person=${admin.userId}`);
          await expect(page.getByRole("radio")).toHaveCount(0);
        } finally {
          await peerContext.close();
          await context.close();
        }
      }
    );

    grantTest(
      "a late committed Admin grant cannot repopulate protected state after account replacement",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳新登入管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-replacement-admin-password!",
          role: "admin" as const,
          username: `replacement.${randomUUID().slice(0, 8)}`,
        };
        const replacementId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const settled = Promise.withResolvers<boolean>();
        let originalKey = "";
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: admin.password,
              },
            }),
            201
          );
          await openTask(page, target);
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            originalKey = route.request().postDataJSON().operationKey;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            arrived.resolve(true);
            try {
              await release.promise;
              await route.fulfill({ response });
            } finally {
              settled.resolve(true);
            }
          });
          await save(page);
          await arrived.promise;
          await expectHttpStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectHttpStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          await expectSessionActor(
            context.request.get("/api/auth/get-session"),
            replacementId
          );
          release.resolve(true);
          await settled.promise;
          // Delivering the real old response can restore its now-revoked A
          // cookie. This is authentication loss, not a healthy B actor mismatch.
          await expectSessionActor(
            context.request.get("/api/auth/get-session"),
            null
          );
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("radio")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          expect(
            await page.evaluate(
              (id) =>
                JSON.parse(
                  sessionStorage.getItem(
                    `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
                  ) ?? "null"
                ),
              admin.userId
            )
          ).toEqual({ actorUserId: admin.userId, operationKey: originalKey });
          const forbidden = await context.request.post(
            "/api/v2/roles/global-roles/reconcile",
            {
              data: { operationKey: originalKey },
              headers: { "x-efcc-expected-actor-id": admin.userId },
            }
          );
          expect(forbidden.status()).toBe(401);
          const unauthorizedBody = await forbidden.json();
          expect(unauthorizedBody).toMatchObject({
            error: { code: "unauthorized" },
          });
          await page.goto("/roles/people");
          await expect(page).toHaveURL(/\/sign-in/u);
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("radio")).toHaveCount(0);
          // Re-establish B through real sign-in before testing its actor fence.
          await login(page, replacement);
          await expectSessionActor(
            context.request.get("/api/auth/get-session"),
            replacementId
          );
          const fenced = await context.request.post(
            "/api/v2/roles/global-roles/reconcile",
            {
              data: { operationKey: originalKey },
              headers: { "x-efcc-expected-actor-id": admin.userId },
            }
          );
          expect(fenced.status()).toBe(409);
          const fencedBody = await fenced.json();
          expect(fencedBody).toMatchObject({
            error: { code: "actor_changed" },
          });
          const references = await page.evaluate(
            ({ originalActor, nextActor }) => ({
              original: JSON.parse(
                sessionStorage.getItem(
                  `efcc.global-role.operation.v1:${encodeURIComponent(originalActor)}`
                ) ?? "null"
              ),
              replacement: sessionStorage.getItem(
                `efcc.global-role.operation.v1:${encodeURIComponent(nextActor)}`
              ),
            }),
            { nextActor: replacementId, originalActor: admin.userId }
          );
          expect(references).toEqual({
            original: { actorUserId: admin.userId, operationKey: originalKey },
            replacement: null,
          });
        } finally {
          release.resolve(true);
          await context.close();
        }
      }
    );

    grantTest(
      "401 after a real committed grant retains ambiguous original operation rather than replacing it",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        let originalKey = "";
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: admin.password,
              },
            }),
            201
          );
          await openTask(page, target);
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            originalKey = route.request().postDataJSON().operationKey;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            // Presentation-only loss of authorized receipt response after a real write.
            await route.fulfill({
              body: JSON.stringify({
                error: { code: "unauthorized", message: "請重新登入。" },
              }),
              contentType: "application/json",
              status: 401,
            });
          });
          await save(page);
          await expect(page).toHaveURL(/\/sign-in/u);
          expect(
            await page.evaluate(
              (id) =>
                JSON.parse(
                  sessionStorage.getItem(
                    `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
                  ) ?? "null"
                ),
              admin.userId
            )
          ).toEqual({ actorUserId: admin.userId, operationKey: originalKey });
          const current = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          await expectPersonRole(current, "admin");
          await page.goto(`/roles/people/identity?person=${target.userId}`);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );

    grantTest(
      "fresh actor_changed dispatch is definite no-write and releases only its matching fresh key",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳派送前新管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-dispatch-replacement-password!",
          role: "admin" as const,
          username: `dispatch.${randomUUID().slice(0, 8)}`,
        };
        const replacementId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: admin.password,
              },
            }),
            201
          );
          await openTask(page, target);
          const dispatched = Promise.withResolvers<boolean>();
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            expect(route.request().headers()["x-efcc-expected-actor-id"]).toBe(
              admin.userId
            );
            await expectHttpStatus(
              context.request.post("/api/auth/sign-out", { data: {} }),
              200
            );
            await expectHttpStatus(
              context.request.post("/api/auth/sign-in/username", {
                data: {
                  password: replacement.password,
                  username: replacement.username,
                },
              }),
              200
            );
            await expectSessionActor(
              context.request.get("/api/auth/get-session"),
              replacementId
            );
            const currentCookies = await context.cookies(caseApp.origin);
            const cookie = currentCookies
              .map((value) => `${value.name}=${value.value}`)
              .join("; ");
            // Preserve the original body/actor header but dispatch with the verified
            // current browser Session, not the now-revoked captured old cookie.
            const response = await route.fetch({
              headers: { ...route.request().headers(), cookie },
            });
            expect(response.status()).toBe(409);
            const body = await response.json();
            expect(body.error.code).toBe("actor_changed");
            await route.fulfill({ response });
            dispatched.resolve(true);
          });
          await save(page);
          await dispatched.promise;
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await expect
            .poll(() =>
              page.evaluate(
                (id) =>
                  sessionStorage.getItem(
                    `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
                  ),
                admin.userId
              )
            )
            .toBeNull();
          const unchanged = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          await expectPersonRole(unchanged, "member");
        } finally {
          await context.close();
        }
      }
    );

    grantTest(
      "real eligibility no-write keeps Admin intent readably disabled and releases the original key",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
          )
          .bind(departmentId, "管理員資格保留職務部門")
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,department_id,user_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, target.userId)
          .run();
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: {
                operationKey: randomUUID(),
                password: admin.password,
              },
            }),
            201
          );
          await openTask(page, target);
          let dispatches = 0;
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            dispatches += 1;
            await caseApp.db
              .prepare(
                "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
              )
              .bind(target.userId)
              .run();
            const response = await route.fetch();
            expect(response.status()).toBe(409);
            const body = await response.json();
            expect(body.error.code).toBe("conflict");
            await route.fulfill({ response });
          });
          await save(page);
          const selected = page.getByRole("radio", { name: /^管理員/u });
          await expect(selected).toBeChecked();
          await expect(selected).toBeDisabled();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeDisabled();
          await expect(page.getByRole("alert")).toContainText("未有儲存");
          expect(
            await page.evaluate(
              (id) =>
                sessionStorage.getItem(
                  `efcc.global-role.operation.v1:${encodeURIComponent(id)}`
                ),
              admin.userId
            )
          ).toBeNull();
          const current = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          await expectPersonRole(current, "member");
          expect(dispatches).toBe(1);
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(
            page.getByRole("radio", { name: /^會友/u })
          ).toBeChecked();
          await expect(
            page.getByRole("contentinfo", { name: "任務操作" })
          ).toHaveCount(0);
        } finally {
          await context.close();
        }
      }
    );

    grantTest(
      "missing proof returns to the separately chosen Admin grant and only a second Save commits",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await openTask(page, target);
          let dispatches = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname === "/api/v2/roles/global-roles"
            ) {
              dispatches += 1;
            }
          });
          await save(page);
          await confirmProof(page, admin.password);
          await expect(
            page.getByRole("radio", { name: /^管理員/u })
          ).toBeChecked();
          expect(dispatches).toBe(1);
          const unchanged = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          await expectPersonRole(unchanged, "member");
          await save(page);
          await expect(page).toHaveURL(
            new RegExp(`/roles/people\\?person=${target.userId}$`, "u")
          );
          await expect(
            page
              .getByRole("article", { name: target.fullName })
              .getByText("管理員", { exact: true })
              .first()
          ).toBeVisible();
          expect(dispatches).toBe(2);
        } finally {
          await context.close();
        }
      }
    );
    for (const outage of ["network", "503"] as const) {
      grantTest(
        `${outage} read outages preserve unsent Admin intent and mounted original-key recovery without replacement Save`,
        async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
          const { admin, target } = accounts;
          const context = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
          });
          try {
            const page = await context.newPage();
            await login(page, admin);
            let readsUnavailable = true;
            const detailPattern = `**/api/v2/roles/people/${target.userId}**`;
            await page.route(detailPattern, async (route) => {
              if (!readsUnavailable) {
                await route.continue();
                return;
              }
              await (outage === "network"
                ? route.abort("failed")
                : route.fulfill({
                    body: JSON.stringify({
                      error: {
                        code: "service_error",
                        message: "暫時未能讀取。",
                      },
                    }),
                    contentType: "application/json",
                    status: 503,
                  }));
            });
            await page.goto(`/roles/people/identity?person=${target.userId}`);
            const retry = page.getByRole("button", {
              exact: true,
              name: "重新讀取目前狀態",
            });
            await expect(retry).toBeEnabled();
            await expect(
              page.getByRole("radio", { name: /^會友/u })
            ).toBeDisabled();
            readsUnavailable = false;
            await retry.click();
            await page.getByRole("radio", { name: /^管理員/u }).check();
            // A preflight outage performs no POST and preserves the draft.
            readsUnavailable = true;
            let dispatches = 0;
            page.on("request", (request) => {
              if (
                request.method() === "POST" &&
                new URL(request.url()).pathname === "/api/v2/roles/global-roles"
              ) {
                dispatches += 1;
              }
            });
            await save(page);
            await expect(retry).toBeEnabled();
            await expect(
              page.getByRole("radio", { name: /^管理員/u })
            ).toBeChecked();
            await expect(
              page.getByRole("button", { exact: true, name: "儲存" })
            ).toBeDisabled();
            expect(dispatches).toBe(0);
            readsUnavailable = false;
            await retry.click();
            // Now a real proof no-write is followed by an unavailable baseline.
            await page.route("**/api/v2/roles/global-roles", async (route) => {
              if (route.request().method() !== "POST") {
                await route.continue();
                return;
              }
              const response = await route.fetch();
              expect(response.status()).toBe(403);
              const body = await response.json();
              expect(body.error.code).toBe("password_confirmation_required");
              readsUnavailable = true;
              await route.fulfill({ response });
            });
            await save(page);
            await expect(retry).toBeEnabled();
            await expect(
              page.getByRole("radio", { name: /^管理員/u })
            ).toBeChecked();
            const storageKey = `efcc.global-role.operation.v1:${encodeURIComponent(admin.userId)}`;
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                storageKey
              )
            ).toBeNull();
            readsUnavailable = false;
            await retry.click();
            await page.unroute("**/api/v2/roles/global-roles");
            await save(page);
            await confirmProof(page, admin.password);
            let originalKey = "";
            await page.route("**/api/v2/roles/global-roles", async (route) => {
              if (route.request().method() !== "POST") {
                await route.continue();
                return;
              }
              originalKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              await route.abort("failed");
            });
            await save(page);
            await expect(
              page.getByRole("button", { exact: true, name: "查核原有操作" })
            ).toBeEnabled();
            // Restored recovery must load the opaque key before this actor read.
            await page.route(
              "**/api/v2/roles/global-roles?**",
              async (route) => {
                await (outage === "network"
                  ? route.abort("failed")
                  : route.fulfill({
                      body: JSON.stringify({
                        error: {
                          code: "service_error",
                          message: "暫時未能讀取。",
                        },
                      }),
                      contentType: "application/json",
                      status: 503,
                    }));
              }
            );
            await page.reload();
            await expect(
              page.getByRole("button", { exact: true, name: "查核原有操作" })
            ).toBeEnabled();
            await expect(
              page.getByRole("button", { exact: true, name: "儲存" })
            ).toHaveCount(0);
            await expect(page.getByRole("radio")).toHaveCount(0);
            expect(
              await page.evaluate(
                (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
                storageKey
              )
            ).toEqual({ actorUserId: admin.userId, operationKey: originalKey });
            await page.unroute("**/api/v2/roles/global-roles?**");
            await page
              .getByRole("button", { exact: true, name: "查核原有操作" })
              .click();
            await expect(page).toHaveURL(
              new RegExp(`/roles/people\\?person=${target.userId}$`, "u")
            );
            expect(dispatches).toBe(3);
          } finally {
            await context.close();
          }
        }
      );
    }
    grantTest(
      "aborted committed Admin response after real account replacement clears old presentation but retains only the original actor key",
      async ({ accounts, browser, caseApp, extraHTTPHeaders }) => {
        const { admin, target } = accounts;
        const replacement = {
          email: `${randomUUID()}@example.com`,
          fullName: "陳失聯後登入管理員",
          membershipStatus: "active" as const,
          password: "Synthetic-abort-replacement-password!",
          role: "admin" as const,
          username: `abort.${randomUUID().slice(0, 8)}`,
        };
        const replacementId = await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const recipientContext = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const arrived = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const settled = Promise.withResolvers<boolean>();
        let originalKey = "";
        let dispatches = 0;
        try {
          const page = await context.newPage();
          await login(page, admin);
          await expectHttpStatus(
            context.request.post("/api/v2/account/password-confirmation", {
              data: { operationKey: randomUUID(), password: admin.password },
            }),
            201
          );
          await openTask(page, target);
          await page.route("**/api/v2/roles/global-roles", async (route) => {
            if (route.request().method() !== "POST") {
              await route.continue();
              return;
            }
            dispatches += 1;
            originalKey = route.request().postDataJSON().operationKey;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            arrived.resolve(true);
            try {
              await release.promise;
              // Do not fulfill the old response or deliver its Set-Cookie.
              await route.abort("failed");
            } finally {
              settled.resolve(true);
            }
          });
          await save(page);
          await arrived.promise;
          await expectHttpStatus(
            context.request.post("/api/auth/sign-out", { data: {} }),
            200
          );
          await expectHttpStatus(
            context.request.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          await expectSessionActor(
            context.request.get("/api/auth/get-session"),
            replacementId
          );
          // Exercise the existing focus recheck while the real committed
          // response is still held, not merely error cleanup after release.
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.username, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("radio")).toHaveCount(0);
          expect(
            await page.evaluate(
              (actorId) =>
                JSON.parse(
                  sessionStorage.getItem(
                    `efcc.global-role.operation.v1:${encodeURIComponent(actorId)}`
                  ) ?? "null"
                ),
              admin.userId
            )
          ).toEqual({ actorUserId: admin.userId, operationKey: originalKey });
          release.resolve(true);
          await settled.promise;
          await expectSessionActor(
            context.request.get("/api/auth/get-session"),
            replacementId
          );
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.username, { exact: true })
          ).toHaveCount(0);
          await expect(page.getByRole("radio")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          const references = await page.evaluate(
            ({ originalActor, nextActor }) => ({
              original: JSON.parse(
                sessionStorage.getItem(
                  `efcc.global-role.operation.v1:${encodeURIComponent(originalActor)}`
                ) ?? "null"
              ),
              replacement: sessionStorage.getItem(
                `efcc.global-role.operation.v1:${encodeURIComponent(nextActor)}`
              ),
            }),
            { nextActor: replacementId, originalActor: admin.userId }
          );
          expect(references).toEqual({
            original: { actorUserId: admin.userId, operationKey: originalKey },
            replacement: null,
          });
          expect(dispatches).toBe(1);
          const targetRead = await context.request.get(
            `/api/v2/roles/people/${target.userId}`
          );
          await expectPersonRole(targetRead, "admin");
          await expectHttpStatus(
            recipientContext.request.post("/api/auth/sign-in/username", {
              data: { password: target.password, username: target.username },
            }),
            200
          );
          const inboxResponse =
            await recipientContext.request.get("/api/v2/inbox");
          expect(inboxResponse.status()).toBe(200);
          const inbox = await inboxResponse.json();
          const adminEvents = inbox.data.roleChanges.filter(
            (event: { role: string }) => event.role === "admin"
          );
          expect(adminEvents).toHaveLength(1);
          expect(adminEvents[0]).toMatchObject({
            action: "granted",
            resultingGlobalRole: "admin",
          });
        } finally {
          release.resolve(true);
          await recipientContext.close();
          await context.close();
        }
      }
    );
  }
);
