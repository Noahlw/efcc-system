import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { dedicatedTest as test, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

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
const confirm = async (page: Page, password: string) => {
  const dialog = page.getByRole("dialog", { name: "確認目前密碼" });
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

const changeIdentity = async (page: Page, role: "會友" | "職員") => {
  await page
    .getByRole("region", { name: "帳戶身份與委派" })
    .getByRole("link", { exact: true, name: "管理帳戶身份" })
    .click();
  await page.getByRole("radio", { name: new RegExp(`^${role}`, "u") }).check();
  await page.getByRole("button", { exact: true, name: "儲存" }).click();
  await expect(page).toHaveURL(/\/roles\/people\?/u);
};

/** Fault only the existing delegation-reference Storage boundary, never auth or HTTP. */
const installDelegationStorageFaults = async (page: Page) => {
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const prefix = "efcc.role-assigner.operation.v1:";
    Storage.prototype.getItem = function getItem(key: string) {
      const state = JSON.parse(window.name || "{}");
      if (
        this === sessionStorage &&
        key.startsWith(prefix) &&
        state.fault === "read"
      ) {
        throw new DOMException(
          "Synthetic delegation reference read failure",
          "SecurityError"
        );
      }
      return originalGet.call(this, key);
    };
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (this === sessionStorage && key.startsWith(prefix)) {
        const state = JSON.parse(window.name || "{}");
        const reference = JSON.parse(value);
        state.attemptedKeys = [
          ...(state.attemptedKeys ?? []),
          reference.operationKey,
        ];
        window.name = JSON.stringify(state);
        if (state.fault === "write") {
          throw new DOMException(
            "Synthetic delegation reference write failure",
            "QuotaExceededError"
          );
        }
      }
      originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key: string) {
      if (this === sessionStorage && key.startsWith(prefix)) {
        const state = JSON.parse(window.name || "{}");
        state.removeCalls = (state.removeCalls ?? 0) + 1;
        window.name = JSON.stringify(state);
      }
      originalRemove.call(this, key);
    };
  });
};

test.describe(
  "Independent Staff delegation task",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-session",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-presentation",
    ],
  },
  () => {
    test("Member promotion and delegation are two deliberate saves; Staff exit and regrant do not resurrect delegation", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `delegation.admin.${suffix}@example.com`,
        fullName: `陳委派管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `ra.admin.${suffix}`,
      };
      const target = {
        ...admin,
        email: `delegation.member.${suffix}@example.com`,
        fullName: `陳委派測試長名字${suffix}`,
        role: "member" as const,
        username: `ra.member.${suffix}`,
      };
      await caseApp.provision.account(admin);
      const targetId = await caseApp.provision.account(target);
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
        viewport: { height: 844, width: 390 },
      });
      try {
        const page = await context.newPage();
        await login(page, admin);
        const overview = `/roles/people?person=${targetId}`;
        await page.goto(overview);
        const group = page.getByRole("region", { name: "帳戶身份與委派" });
        await expect(group.getByText("會友", { exact: true })).toBeVisible();
        await expect(
          group.getByRole("link", { name: "管理職務指派權" })
        ).toHaveCount(0);
        await group
          .getByRole("link", { exact: true, name: "管理帳戶身份" })
          .click();
        await page.getByRole("radio", { name: /^職員/u }).check();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await confirm(page, admin.password);
        const crafted = await context.request.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: targetId,
            },
          }
        );
        expect(crafted.status()).toBe(409);
        await expect(page.getByRole("radio", { name: /^職員/u })).toBeChecked();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
        await expect(group.getByText("未委派", { exact: true })).toBeVisible();
        await group
          .getByRole("link", { exact: true, name: "管理職務指派權" })
          .click();
        await expect(page).toHaveURL(/\/roles\/people\/delegation\?/u);
        await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
        await expect(
          group.getByText("現任 Role Assigner", { exact: true })
        ).toBeVisible();
        await group
          .getByRole("link", { exact: true, name: "管理職務指派權" })
          .click();
        await page.getByRole("radio", { name: /^未委派/u }).check();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
        await expect(group.getByText("未委派", { exact: true })).toBeVisible();
        await group
          .getByRole("link", { exact: true, name: "管理職務指派權" })
          .click();
        await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
        await expect(
          group.getByText("現任 Role Assigner", { exact: true })
        ).toBeVisible();
        await changeIdentity(page, "會友");
        await changeIdentity(page, "職員");
        await expect(group.getByText("未委派", { exact: true })).toBeVisible();
        const current = await context.request.get(
          `/api/v2/roles/global-roles/${targetId}`
        );
        const currentBody = await current.json();
        expect(currentBody.data.person.roleAssignerAssignment).toBeNull();
      } finally {
        await context.close();
      }
    });

    test("Reset and Keep/Discard retain one unsent delegation task at reduced height", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }, testInfo) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `delegation.reset.admin.${suffix}@example.com`,
        fullName: `陳管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `ra.reset.a.${suffix}`,
      };
      await caseApp.provision.account(admin);
      const targetId = await caseApp.provision.account({
        ...admin,
        email: `delegation.reset.staff.${suffix}@example.com`,
        role: "staff",
        username: `ra.reset.s.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
        viewport: { height: 480, width: 320 },
      });
      try {
        const page = await context.newPage();
        await login(page, admin);
        await page.goto(`/roles/people/delegation?person=${targetId}`);
        const grant = page.getByRole("radio", { name: /^委派職務指派權/u });
        await grant.check();
        await page.getByRole("button", { exact: true, name: "重設" }).click();
        await expect(
          page.getByRole("radio", { name: /^未委派/u })
        ).toBeChecked();
        await expect(
          page.getByRole("contentinfo", { name: "任務操作" })
        ).toHaveCount(0);
        await grant.check();
        await page
          .getByRole("link", { exact: true, name: "返回人員權責" })
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page
          .getByRole("button", { exact: true, name: "繼續編輯" })
          .click();
        await expect(grant).toBeChecked();
        await qualifyPresentation(page, testInfo, "delegation-task", {
          criticalAction: page.getByRole("button", {
            exact: true,
            name: "儲存",
          }),
          drafts: page.locator("input"),
          focus: grant,
        });
        await page.setViewportSize({ height: 480, width: 320 });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await grant.focus();
        const footer = page.getByRole("contentinfo", { name: "任務操作" });
        await expect
          .poll(async () => {
            const box = await footer.boundingBox();
            return box ? Math.abs(box.y + box.height - 480) : Infinity;
          })
          .toBeLessThanOrEqual(1);
        await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
        await page
          .getByRole("link", { exact: true, name: "返回人員權責" })
          .click();
        await page
          .getByRole("button", { exact: true, name: "放棄變更" })
          .click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
      } finally {
        await context.close();
      }
    });
    test("lost committed response retains only the original key and restored target B resolves target A", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `delegation.unknown.admin.${suffix}@example.com`,
        fullName: `陳復核管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `ra.unknown.a.${suffix}`,
      };
      await caseApp.provision.account(admin);
      const targetA = await caseApp.provision.account({
        ...admin,
        email: `delegation.unknown.a.${suffix}@example.com`,
        role: "staff",
        username: `ra.unknown.s1.${suffix}`,
      });
      const targetB = await caseApp.provision.account({
        ...admin,
        email: `delegation.unknown.b.${suffix}@example.com`,
        role: "staff",
        username: `ra.unknown.s2.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await login(page, admin);
        await page.goto(`/roles/people/delegation?person=${targetA}`);
        await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await confirm(page, admin.password);
        let writes = 0;
        await page.route("**/api/v2/roles/role-assigners", async (route) => {
          writes += 1;
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          await response.dispose();
          await route.abort("failed");
        });
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(
          page.getByRole("button", { exact: true, name: "查核原有操作" })
        ).toBeVisible();
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toHaveCount(0);
        const stored = await page.evaluate(() =>
          Object.entries(sessionStorage).filter(([key]) =>
            key.startsWith("efcc.role-assigner.operation.v1:")
          )
        );
        expect(stored).toHaveLength(1);
        const [saved] = stored;
        if (!saved) {
          throw new Error("Missing original delegation operation");
        }
        expect(Object.keys(JSON.parse(saved[1])).toSorted()).toEqual([
          "actorUserId",
          "operationKey",
        ]);
        await page.goto(`/roles/people/delegation?person=${targetB}`);
        await expect(page.getByRole("radio")).toHaveCount(0);
        await page
          .getByRole("button", { exact: true, name: "查核原有操作" })
          .click();
        await expect(page).toHaveURL(
          new RegExp(`/roles/people\\?person=${targetA}$`, "u")
        );
        expect(writes).toBe(1);
        const currentB = await context.request.get(
          `/api/v2/roles/global-roles/${targetB}`
        );
        const currentBBody = await currentB.json();
        expect(currentBBody.data.person.roleAssignerAssignment).toBeNull();
      } finally {
        await context.close();
      }
    });
    test("crafted protected and replaced-actor requests are rejected without delegation effects", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `delegation.guard.admin.${suffix}@example.com`,
        fullName: `陳權限管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `ra.guard.a.${suffix}`,
      };
      const actorId = await caseApp.provision.account(admin);
      const peerId = await caseApp.provision.account({
        ...admin,
        email: `delegation.guard.peer.${suffix}@example.com`,
        username: `ra.guard.b.${suffix}`,
      });
      const staffId = await caseApp.provision.account({
        ...admin,
        email: `delegation.guard.staff.${suffix}@example.com`,
        role: "staff",
        username: `ra.guard.s.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await login(page, admin);
        await page.goto(`/roles/people/delegation?person=${staffId}`);
        await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await confirm(page, admin.password);
        const protectedRequest = await context.request.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: peerId,
            },
          }
        );
        expect([403, 409]).toContain(protectedRequest.status());
        const changedActor = await context.request.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: staffId,
            },
            headers: { "x-efcc-expected-actor-id": peerId },
          }
        );
        expect(changedActor.status()).toBe(409);
        const changedActorBody = await changedActor.json();
        expect(changedActorBody.error.code).toBe("actor_changed");
        const current = await context.request.get(
          `/api/v2/roles/global-roles/${staffId}`
        );
        const currentBody = await current.json();
        expect(currentBody.data.person.roleAssignerAssignment).toBeNull();
        const valid = await context.request.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: staffId,
            },
            headers: { "x-efcc-expected-actor-id": actorId },
          }
        );
        expect(valid.ok()).toBe(true);
      } finally {
        await context.close();
      }
    });
    test("read outages preserve choices until fresh retry; a real revoked Session read instead disposes the task", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `delegation.read.admin.${suffix}@example.com`,
        fullName: `陳讀取管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `ra.read.a.${suffix}`,
      };
      await caseApp.provision.account(admin);
      const targetId = await caseApp.provision.account({
        ...admin,
        email: `delegation.read.staff.${suffix}@example.com`,
        role: "staff",
        username: `ra.read.s.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await login(page, admin);
        const readPattern = `**/api/v2/roles/people/${targetId}?*`;
        await page.route(readPattern, (route) => route.abort("failed"));
        await page.goto(`/roles/people/delegation?person=${targetId}`);
        const retry = page.getByRole("button", {
          exact: true,
          name: "重新讀取最新狀態",
        });
        await expect(retry).toBeVisible();
        await expect(page).toHaveURL(/\/roles\/people\/delegation\?/u);
        await expect(
          page.getByRole("radio", { name: /^委派職務指派權/u })
        ).toBeDisabled();
        await page.unroute(readPattern);
        await retry.click();
        const grant = page.getByRole("radio", { name: /^委派職務指派權/u });
        await expect(grant).toBeEnabled();
        await grant.check();
        let writes = 0;
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/v2/roles/role-assigners"
          ) {
            writes += 1;
          }
        });
        // Inject only an unavailable read response, never authorization or success.
        await page.route(readPattern, (route) =>
          route.fulfill({
            body: JSON.stringify({
              error: {
                code: "service_error",
                message: "Synthetic unavailable read",
              },
            }),
            contentType: "application/json",
            status: 503,
          })
        );
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(retry).toBeVisible();
        await expect(grant).toBeChecked();
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toBeDisabled();
        await expect(page).toHaveURL(/\/roles\/people\/delegation\?/u);
        expect(writes).toBe(0);
        await page.unroute(readPattern);
        await retry.click();
        await expect(grant).toBeChecked();
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toBeEnabled();
        expect(writes).toBe(0);
        const arrived = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const settled = Promise.withResolvers<boolean>();
        await page.route(readPattern, async (route) => {
          arrived.resolve(true);
          try {
            await release.promise;
            const response = await route.fetch();
            await route.fulfill({ response });
          } finally {
            settled.resolve(true);
          }
        });
        const failedRead = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
            `/api/v2/roles/people/${targetId}`
        );
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await arrived.promise;
        try {
          const signOut = await context.request.post("/api/auth/sign-out", {
            data: {},
          });
          expect(signOut.status()).toBe(200);
        } finally {
          release.resolve(true);
          await settled.promise;
        }
        const expiredResponse = await failedRead;
        expect(expiredResponse.status()).toBe(401);
        await expect(page).toHaveURL(/\/sign-in(?:[?].*)?$/u);
        await expect(
          page.getByRole("heading", { exact: true, name: "管理職務指派權" })
        ).toHaveCount(0);
        await expect(page.getByRole("radio")).toHaveCount(0);
        expect(writes).toBe(0);
      } finally {
        await context.close();
      }
    });
    test("freshly ineligible Staff retains the selected grant but disables it and Save while Reset remains usable", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `delegation.eligible.admin.${suffix}@example.com`,
        fullName: `陳資格管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `ra.eligible.a.${suffix}`,
      };
      await caseApp.provision.account(admin);
      const targetId = await caseApp.provision.account({
        ...admin,
        email: `delegation.eligible.staff.${suffix}@example.com`,
        role: "staff",
        username: `ra.eligible.s.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await login(page, admin);
        await page.goto(`/roles/people/delegation?person=${targetId}`);
        const grant = page.getByRole("radio", { name: /^委派職務指派權/u });
        await grant.check();
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
          )
          .bind(targetId)
          .run();
        let writes = 0;
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/v2/roles/role-assigners"
          ) {
            writes += 1;
          }
        });
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(
          page.getByText(
            "目前委派或資格已改變，未有儲存。請返回人員權責重新查閱。",
            { exact: true }
          )
        ).toBeVisible();
        await expect(grant).toBeChecked();
        await expect(grant).toBeDisabled();
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { exact: true, name: "重設" })
        ).toBeEnabled();
        expect(writes).toBe(0);
        await page.getByRole("button", { exact: true, name: "重設" }).click();
        await expect(
          page.getByRole("radio", { name: /^未委派/u })
        ).toBeChecked();
        await expect(
          page.getByRole("contentinfo", { name: "任務操作" })
        ).toHaveCount(0);
        const current = await context.request.get(
          `/api/v2/roles/global-roles/${targetId}`
        );
        const body = await current.json();
        expect(body.data.person.eligibleForRoleAssigner).toBe(false);
        expect(body.data.person.roleAssignerAssignment).toBeNull();
      } finally {
        await context.close();
      }
    });
    for (const resultingRole of ["member", "admin"] as const) {
      test(`original delegation receipt settles after target becomes ${resultingRole} and the task reloads`, async ({
        browser,
        caseApp,
        extraHTTPHeaders,
      }) => {
        const suffix = randomUUID().slice(0, 8);
        const admin = {
          email: `delegation.transition.admin.${suffix}@example.com`,
          fullName: `陳原操作管理員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-delegation-password!",
          role: "admin" as const,
          username: `ra.transition.a.${suffix}`,
        };
        await caseApp.provision.account(admin);
        const targetId = await caseApp.provision.account({
          ...admin,
          email: `delegation.transition.staff.${suffix}@example.com`,
          fullName: `陳已變更對象${suffix}`,
          role: "staff",
          username: `ra.transition.s.${suffix}`,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await login(page, admin);
          await page.goto(`/roles/people/delegation?person=${targetId}`);
          await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await confirm(page, admin.password);
          let originalKey = "";
          let writes = 0;
          await page.route("**/api/v2/roles/role-assigners", async (route) => {
            writes += 1;
            const input = route.request().postDataJSON();
            originalKey = input.operationKey;
            const response = await route.fetch();
            expect(response.status()).toBe(201);
            await response.dispose();
            await route.abort("failed");
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeVisible();
          expect(originalKey).toMatch(/^[0-9a-f-]{36}$/u);
          const transition = await context.request.post(
            "/api/v2/roles/global-roles",
            {
              data:
                resultingRole === "member"
                  ? {
                      action: "withdrawn",
                      operationKey: randomUUID(),
                      role: "staff",
                      targetUserId: targetId,
                    }
                  : {
                      action: "granted",
                      operationKey: randomUUID(),
                      role: "admin",
                      targetUserId: targetId,
                    },
            }
          );
          expect(transition.status()).toBe(201);
          await page.reload();
          await expect(page).toHaveURL(/\/roles\/people\/delegation\?/u);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeVisible();
          await expect(page.getByRole("radio")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await expect(
            page.getByText(`陳已變更對象${suffix}`, { exact: true })
          ).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          await expect(page).toHaveURL(
            new RegExp(`/roles/people[?]person=${targetId}$`, "u")
          );
          expect(writes).toBe(1);
          const reconciliation = await context.request.post(
            "/api/v2/roles/role-assigners/reconcile",
            { data: { operationKey: originalKey } }
          );
          expect(reconciliation.status()).toBe(200);
          const body = await reconciliation.json();
          expect(body.data).toMatchObject({
            outcome: "committed",
            receipt: {
              action: "granted",
              role: "role_assigner",
              targetUserId: targetId,
            },
          });
          const stored = await page.evaluate(() =>
            Object.keys(sessionStorage).filter((key) =>
              key.startsWith("efcc.role-assigner.operation.v1:")
            )
          );
          expect(stored).toEqual([]);
        } finally {
          await context.close();
        }
      });
    }
    for (const reviewedAssignment of ["absent", "replaced"] as const) {
      test(`a concurrently ${reviewedAssignment === "absent" ? "granted" : "replaced"} delegation freezes stale intent until explicit reload and reselection`, async ({
        browser,
        caseApp,
        extraHTTPHeaders,
      }) => {
        const suffix = randomUUID().slice(0, 8);
        const admin = {
          email: `delegation.stale.admin.${suffix}@example.com`,
          fullName: `陳委派衝突管理員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-delegation-password!",
          role: "admin" as const,
          username: `ra.stale.a.${suffix}`,
        };
        await caseApp.provision.account(admin);
        const targetId = await caseApp.provision.account({
          ...admin,
          email: `delegation.stale.staff.${suffix}@example.com`,
          role: "staff",
          username: `ra.stale.s.${suffix}`,
        });
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
          if (reviewedAssignment === "replaced") {
            const originalGrant = await context.request.post(
              "/api/v2/roles/role-assigners",
              {
                data: {
                  action: "granted",
                  operationKey: randomUUID(),
                  targetUserId: targetId,
                },
              }
            );
            expect(originalGrant.status()).toBe(201);
          }
          await page.goto(`/roles/people/delegation?person=${targetId}`);
          const intendedChoice = page.getByRole("radio", {
            name:
              reviewedAssignment === "absent" ? /^委派職務指派權/u : /^未委派/u,
          });
          await intendedChoice.check();
          if (reviewedAssignment === "replaced") {
            const reviewedRead = await context.request.get(
              `/api/v2/roles/global-roles/${targetId}`
            );
            const reviewedBody = await reviewedRead.json();
            const withdrawal = await context.request.post(
              "/api/v2/roles/role-assigners",
              {
                data: {
                  action: "withdrawn",
                  expectedAssignmentId:
                    reviewedBody.data.person.roleAssignerAssignment
                      .assignmentId,
                  operationKey: randomUUID(),
                  targetUserId: targetId,
                },
              }
            );
            expect(withdrawal.status()).toBe(201);
          }
          const concurrentGrant = await context.request.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId: targetId,
              },
            }
          );
          expect(concurrentGrant.status()).toBe(201);
          const replacementRead = await context.request.get(
            `/api/v2/roles/global-roles/${targetId}`
          );
          const replacementBody = await replacementRead.json();
          const replacementId =
            replacementBody.data.person.roleAssignerAssignment.assignmentId;
          const dispatches: Record<string, unknown>[] = [];
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname === "/api/v2/roles/role-assigners"
            ) {
              dispatches.push(request.postDataJSON());
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByText(
              "委派已更新；原有選擇只供參考。請重新載入最新委派，再重新選擇。",
              { exact: true }
            )
          ).toBeVisible();
          await expect(intendedChoice).toBeChecked();
          await expect(intendedChoice).toBeDisabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toBeDisabled();
          await expect(
            page.getByRole("button", { exact: true, name: "重設" })
          ).toBeDisabled();
          expect(dispatches).toEqual([]);
          const preservedRead = await context.request.get(
            `/api/v2/roles/global-roles/${targetId}`
          );
          const preservedBody = await preservedRead.json();
          expect(
            preservedBody.data.person.roleAssignerAssignment.assignmentId
          ).toBe(replacementId);
          await page
            .getByRole("button", { exact: true, name: "重新載入最新委派" })
            .click();
          await expect(
            page.getByRole("radio", { name: /^委派職務指派權/u })
          ).toBeChecked();
          await expect(
            page.getByRole("contentinfo", { name: "任務操作" })
          ).toHaveCount(0);
          expect(dispatches).toEqual([]);
          await page.getByRole("radio", { name: /^未委派/u }).check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(page).toHaveURL(/\/roles\/people\?/u);
          expect(dispatches).toHaveLength(1);
          expect(dispatches[0]).toMatchObject({
            action: "withdrawn",
            expectedAssignmentId: replacementId,
            targetUserId: targetId,
          });
          const finalRead = await context.request.get(
            `/api/v2/roles/global-roles/${targetId}`
          );
          const finalBody = await finalRead.json();
          expect(finalBody.data.person.roleAssignerAssignment).toBeNull();
        } finally {
          await context.close();
        }
      });
    }
    for (const delivery of ["fulfilled", "aborted"] as const) {
      test(`a late ${delivery} committed delegation response cannot restore actor A presentation into actor B and retains A's unresolved opaque key`, async ({
        browser,
        caseApp,
        extraHTTPHeaders,
      }) => {
        const suffix = randomUUID().slice(0, 8);
        const admin = {
          email: `delegation.late.admin.${suffix}@example.com`,
          fullName: `陳原操作管理員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-delegation-password!",
          role: "admin" as const,
          username: `ra.late.a.${suffix}`,
        };
        const actorA = await caseApp.provision.account(admin);
        const replacement = {
          ...admin,
          email: `delegation.late.replacement.${suffix}@example.com`,
          fullName: `陳接替管理員${suffix}`,
          username: `ra.late.b.${suffix}`,
        };
        const actorB = await caseApp.provision.account(replacement);
        const fullName = `陳舊委派對象${suffix}`;
        const targetId = await caseApp.provision.account({
          ...admin,
          email: `delegation.late.staff.${suffix}@example.com`,
          fullName,
          role: "staff",
          username: `ra.late.s.${suffix}`,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const committed = Promise.withResolvers<boolean>();
        const release = Promise.withResolvers<boolean>();
        const settled = Promise.withResolvers<boolean>();
        let originalKey = "";
        let writes = 0;
        try {
          const page = await context.newPage();
          await login(page, admin);
          await page.goto(`/roles/people/delegation?person=${targetId}`);
          await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await confirm(page, admin.password);
          await page.route("**/api/v2/roles/role-assigners", async (route) => {
            writes += 1;
            originalKey = route.request().postDataJSON().operationKey;
            const response = await route.fetch();
            try {
              expect(response.status()).toBe(201);
              committed.resolve(true);
              await release.promise;
              await (delivery === "aborted"
                ? route.abort("failed")
                : route.fulfill({ response }));
            } finally {
              await response.dispose();
              settled.resolve(true);
            }
          });
          const deliveredResponse =
            delivery === "fulfilled"
              ? page.waitForResponse(
                  (response) =>
                    new URL(response.url()).pathname ===
                      "/api/v2/roles/role-assigners" &&
                    response.status() === 201
                )
              : null;
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await committed.promise;
          try {
            const signOut = await context.request.post("/api/auth/sign-out", {
              data: {},
            });
            expect(signOut.status()).toBe(200);
            const signIn = await context.request.post(
              "/api/auth/sign-in/username",
              {
                data: {
                  password: replacement.password,
                  username: replacement.username,
                },
              }
            );
            expect(signIn.status()).toBe(200);
            const sessionResponse = await context.request.get(
              "/api/auth/get-session"
            );
            const session = await sessionResponse.json();
            expect(session.user.id).toBe(actorB);
            if (delivery === "aborted") {
              // Use actual browser-page focus while the real command is still held.
              const replacementPage = await context.newPage();
              try {
                await replacementPage.goto("/");
                await page.bringToFront();
                await expect(page).toHaveURL(/\/roles\/people$/u);
                await expect(
                  page.getByText(fullName, { exact: true })
                ).toHaveCount(0);
                await expect(page.getByRole("radio")).toHaveCount(0);
                await expect(
                  page.getByRole("button", { exact: true, name: "儲存" })
                ).toHaveCount(0);
                await expect(
                  page.getByRole("button", {
                    exact: true,
                    name: "查核原有操作",
                  })
                ).toHaveCount(0);
                const beforeRelease = await page.evaluate(
                  (key) => sessionStorage.getItem(key),
                  `efcc.role-assigner.operation.v1:${encodeURIComponent(actorA)}`
                );
                expect(beforeRelease).not.toBeNull();
                if (!beforeRelease) {
                  throw new Error(
                    "Lost actor A's original key before response release"
                  );
                }
                expect(JSON.parse(beforeRelease)).toEqual({
                  actorUserId: actorA,
                  operationKey: originalKey,
                });
                expect(writes).toBe(1);
              } finally {
                await replacementPage.close();
              }
            }
          } finally {
            release.resolve(true);
            await settled.promise;
          }
          if (delivery === "fulfilled") {
            // Full real headers renew A's revoked cookie: require actual auth loss,
            // not an either-URL oracle or a stripped cookie that makes B look healthy.
            if (deliveredResponse) {
              const response = await deliveredResponse;
              await response.finished();
            }
            const expiredSessionResponse = await context.request.get(
              "/api/auth/get-session"
            );
            expect(expiredSessionResponse.status()).toBe(200);
            const expiredSession = await expiredSessionResponse.json();
            expect(expiredSession).toBeNull();
            await page.reload();
            await expect(page).toHaveURL(/\/sign-in(?:[?].*)?$/u);
          } else {
            // Aborting delivery never replays A's Set-Cookie; B must remain healthy.
            await expect(page).toHaveURL(/\/roles\/people$/u);
            const healthySessionResponse = await context.request.get(
              "/api/auth/get-session"
            );
            expect(healthySessionResponse.status()).toBe(200);
            const healthySession = await healthySessionResponse.json();
            expect(healthySession.user.id).toBe(actorB);
          }
          await expect(page.getByText(fullName, { exact: true })).toHaveCount(
            0
          );
          await expect(page.getByRole("radio")).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toHaveCount(0);
          expect(writes).toBe(1);
          const originalStorageKey = `efcc.role-assigner.operation.v1:${encodeURIComponent(actorA)}`;
          const stored = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            originalStorageKey
          );
          expect(stored).not.toBeNull();
          if (!stored) {
            throw new Error("Lost actor A's unresolved original key");
          }
          expect(JSON.parse(stored)).toEqual({
            actorUserId: actorA,
            operationKey: originalKey,
          });
          const replacementStorageKey = `efcc.role-assigner.operation.v1:${encodeURIComponent(actorB)}`;
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              replacementStorageKey
            )
          ).toBeNull();
          if (delivery === "fulfilled") {
            // Recover through the real sign-in surface before any protected B read.
            await login(page, replacement);
          }
          const recoveredSessionResponse = await context.request.get(
            "/api/auth/get-session"
          );
          expect(recoveredSessionResponse.status()).toBe(200);
          const recoveredSession = await recoveredSessionResponse.json();
          expect(recoveredSession.user.id).toBe(actorB);
          const currentRead = await context.request.get(
            `/api/v2/roles/global-roles/${targetId}`
          );
          expect(currentRead.status()).toBe(200);
          const current = await currentRead.json();
          expect(
            current.data.person.roleAssignerAssignment.assignmentId
          ).toEqual(expect.any(String));
          const replacementReceipt = await context.request.post(
            "/api/v2/roles/role-assigners/reconcile",
            { data: { operationKey: originalKey } }
          );
          expect(replacementReceipt.status()).toBe(200);
          const replacementBody = await replacementReceipt.json();
          expect(replacementBody.data).toEqual({
            outcome: "unknown",
            receipt: null,
          });
          expect(writes).toBe(1);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              originalStorageKey
            )
          ).toBe(stored);
        } finally {
          release.resolve(true);
          await context.close();
        }
      });
    }
    test("a failed reference write sends no delegation command and retries the same prepared key before real lost-response settlement", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `rp.write.a.${suffix}@example.com`,
        fullName: `陳記錄寫入管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `rp.write.a.${suffix}`,
      };
      await caseApp.provision.account(admin);
      const targetId = await caseApp.provision.account({
        ...admin,
        email: `rp.write.s.${suffix}@example.com`,
        fullName: `陳記錄寫入對象${suffix}`,
        role: "staff",
        username: `rp.write.s.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const page = await context.newPage();
        await installDelegationStorageFaults(page);
        await login(page, admin);
        const proof = await context.request.post(
          "/api/v2/account/password-confirmation",
          { data: { operationKey: randomUUID(), password: admin.password } }
        );
        expect(proof.status()).toBe(201);
        await page.goto(`/roles/people/delegation?person=${targetId}`);
        const grant = page.getByRole("radio", { name: /^委派職務指派權/u });
        await grant.check();
        const posts: Record<string, unknown>[] = [];
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/v2/roles/role-assigners"
          ) {
            posts.push(request.postDataJSON());
          }
        });
        await page.evaluate(() => {
          window.name = JSON.stringify({
            attemptedKeys: [],
            fault: "write",
            removeCalls: 0,
          });
        });
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect
          .poll(async () => {
            const state = await page.evaluate(() => JSON.parse(window.name));
            return state.attemptedKeys.length;
          })
          .toBeGreaterThan(0);
        await expect(grant).toBeChecked();
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toBeEnabled();
        expect(posts).toEqual([]);
        const failedState = await page.evaluate(() => JSON.parse(window.name));
        const [preparedKey] = failedState.attemptedKeys;
        expect(preparedKey).toMatch(/^[0-9a-f-]{36}$/u);
        expect(failedState.removeCalls).toBe(0);
        await page.evaluate(() => {
          const state = JSON.parse(window.name);
          state.fault = "";
          window.name = JSON.stringify(state);
        });
        await page.route("**/api/v2/roles/role-assigners", async (route) => {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          await response.dispose();
          await route.abort("failed");
        });
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(
          page.getByRole("button", { exact: true, name: "查核原有操作" })
        ).toBeVisible();
        expect(posts).toHaveLength(1);
        expect(posts[0]).toMatchObject({
          action: "granted",
          operationKey: preparedKey,
          targetUserId: targetId,
        });
        const retriedState = await page.evaluate(() => JSON.parse(window.name));
        expect(new Set(retriedState.attemptedKeys)).toEqual(
          new Set([preparedKey])
        );
        expect(retriedState.removeCalls).toBe(0);
        await page
          .getByRole("button", { exact: true, name: "查核原有操作" })
          .click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
        await expect(
          page
            .getByRole("region", { name: "帳戶身份與委派" })
            .getByText("現任 Role Assigner", { exact: true })
        ).toBeVisible();
        expect(posts).toHaveLength(1);
        const reconciliation = await context.request.post(
          "/api/v2/roles/role-assigners/reconcile",
          { data: { operationKey: preparedKey } }
        );
        expect(reconciliation.status()).toBe(200);
        const result = await reconciliation.json();
        expect(result.data).toMatchObject({
          outcome: "committed",
          receipt: {
            action: "granted",
            role: "role_assigner",
            targetUserId: targetId,
          },
        });
      } finally {
        await context.close();
      }
    });
    test("an unreadable restored delegation reference is neutral and reload-only without deletion, then the real original receipt settles without replay", async ({
      browser,
      caseApp,
      extraHTTPHeaders,
    }) => {
      const suffix = randomUUID().slice(0, 8);
      const admin = {
        email: `rp.read.a.${suffix}@example.com`,
        fullName: `陳記錄讀取管理員${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-delegation-password!",
        role: "admin" as const,
        username: `rp.read.a.${suffix}`,
      };
      const actorId = await caseApp.provision.account(admin);
      const fullName = `陳記錄讀取對象${suffix}`;
      const targetId = await caseApp.provision.account({
        ...admin,
        email: `rp.read.s.${suffix}@example.com`,
        fullName,
        role: "staff",
        username: `rp.read.s.${suffix}`,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      let originalKey = "";
      let posts = 0;
      let committedReceipt: unknown = null;
      try {
        const page = await context.newPage();
        await installDelegationStorageFaults(page);
        await login(page, admin);
        const proof = await context.request.post(
          "/api/v2/account/password-confirmation",
          { data: { operationKey: randomUUID(), password: admin.password } }
        );
        expect(proof.status()).toBe(201);
        await page.goto(`/roles/people/delegation?person=${targetId}`);
        await page.getByRole("radio", { name: /^委派職務指派權/u }).check();
        await page.route("**/api/v2/roles/role-assigners", async (route) => {
          posts += 1;
          originalKey = route.request().postDataJSON().operationKey;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          const body = await response.json();
          committedReceipt = body.data.receipt;
          await response.dispose();
          await route.abort("failed");
        });
        await page.getByRole("button", { exact: true, name: "儲存" }).click();
        await expect(
          page.getByRole("button", { exact: true, name: "查核原有操作" })
        ).toBeVisible();
        expect(originalKey).toMatch(/^[0-9a-f-]{36}$/u);
        expect(committedReceipt).not.toBeNull();
        await page.evaluate(() => {
          const state = JSON.parse(window.name);
          state.fault = "read";
          state.removeCalls = 0;
          window.name = JSON.stringify(state);
        });
        await page.reload();
        const reload = page.getByRole("button", {
          exact: true,
          name: "重新載入查核記錄",
        });
        await expect(reload).toBeVisible();
        await expect(page.getByText(fullName, { exact: true })).toHaveCount(0);
        await expect(page.getByRole("radio")).toHaveCount(0);
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { exact: true, name: "查核原有操作" })
        ).toHaveCount(0);
        expect(posts).toBe(1);
        const failedState = await page.evaluate(() => JSON.parse(window.name));
        expect(failedState.removeCalls).toBe(0);
        const preserved = await page.evaluate(
          (key) => {
            const state = JSON.parse(window.name);
            state.fault = "";
            window.name = JSON.stringify(state);
            return sessionStorage.getItem(key);
          },
          `efcc.role-assigner.operation.v1:${encodeURIComponent(actorId)}`
        );
        expect(preserved).not.toBeNull();
        if (!preserved) {
          throw new Error("Unreadable storage lost the original operation");
        }
        expect(JSON.parse(preserved)).toEqual({
          actorUserId: actorId,
          operationKey: originalKey,
        });
        await reload.click();
        await expect(
          page.getByRole("button", { exact: true, name: "查核原有操作" })
        ).toBeVisible();
        await expect(page.getByRole("radio")).toHaveCount(0);
        await expect(
          page.getByRole("button", { exact: true, name: "儲存" })
        ).toHaveCount(0);
        expect(posts).toBe(1);
        await page
          .getByRole("button", { exact: true, name: "查核原有操作" })
          .click();
        await expect(page).toHaveURL(/\/roles\/people\?/u);
        expect(posts).toBe(1);
        const reconciliation = await context.request.post(
          "/api/v2/roles/role-assigners/reconcile",
          { data: { operationKey: originalKey } }
        );
        expect(reconciliation.status()).toBe(200);
        const result = await reconciliation.json();
        expect(result.data).toEqual({
          outcome: "committed",
          receipt: committedReceipt,
        });
      } finally {
        await context.close();
      }
    });
  }
);
