/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */

import { randomUUID } from "node:crypto";

import type { APIResponse, Page } from "@playwright/test";

import { storedStaffAccountOperationSchema } from "../../../src/features/account/assisted-accounts/staff-account-contract";
import { expect, test } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import {
  expectResponseStatus,
  staffData,
  issuedCredential,
  creation,
  syntheticAccount,
  credentialRow,
  creationEffects,
  creationDrafts,
  recoveryDrafts,
  dedicatedTest,
} from "./fixtures";
import { openVisibilityStaffPage } from "./visibility-browser";

const readAuthContextMarker = (page: Page) =>
  page
    .context()
    .cookies()
    .then(
      (cookies) =>
        cookies.find((cookie) => cookie.name === "efcc-auth-context")?.value ??
        null
    );

interface AuthContextCookieStoreProbe {
  apiAvailable: boolean;
  baselineMarkerPresent: boolean;
  changedEventCount: number;
  deletedEventCount: number;
  generationChanged: boolean;
  secureContext: boolean;
}

const requestIncludesAuthContextMarker = (cookie: string | undefined) =>
  cookie
    ?.split(";")
    .some((part) => part.trim().startsWith("efcc-auth-context=")) ?? false;

interface StaffCreationIngressObservation {
  cookieHeaderPresent: boolean;
  markerPresent: boolean;
}

const observeStaffCreationIngress = (app: NativeApp) => {
  let observation: StaffCreationIngressObservation | null = null;
  const originalFetch = app.fetch;
  app.fetch = (input, init) => {
    if (typeof input !== "string" || !(init instanceof Request)) {
      return originalFetch(input, init);
    }
    const requestUrl = new URL(input, app.origin);
    if (
      init.method !== "POST" ||
      requestUrl.pathname !== "/api/v2/staff/accounts"
    ) {
      return originalFetch(input, init);
    }

    const cookie = init.headers.get("cookie");
    observation = {
      cookieHeaderPresent: cookie !== null,
      markerPresent: requestIncludesAuthContextMarker(cookie ?? undefined),
    };
    return originalFetch(input, init);
  };
  return {
    read: () => observation,
    restore: () => {
      app.fetch = originalFetch;
    },
  };
};

const hasAuthContextCookieContract = (
  headers: { name: string; value: string }[]
) => {
  const marker = headers.find(
    (header) =>
      header.name.toLowerCase() === "set-cookie" &&
      header.value.startsWith("efcc-auth-context=")
  );
  if (!marker) {
    return false;
  }
  const attributes = marker.value
    .split(";")
    .slice(1)
    .map((attribute) => attribute.trim().toLowerCase());
  return (
    attributes.includes("path=/") &&
    attributes.includes("max-age=7776000") &&
    attributes.includes("samesite=lax") &&
    !attributes.includes("httponly") &&
    !attributes.some((attribute) => attribute.startsWith("domain="))
  );
};

const ninetyDaysSeconds = 90 * 24 * 60 * 60;

const shortenSessionExpiry = async (caseApp: NativeApp, page: Page) => {
  const cookie = (await page.context().cookies()).find(
    (entry) => entry.name === "better-auth.session_token"
  );
  if (!cookie) {
    throw new Error("Missing native session cookie");
  }
  const [token] = decodeURIComponent(cookie.value).split(".");
  if (!token) {
    throw new Error("Missing native session token");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ninetyDaysSeconds - 3600;
  const updated = await caseApp.db
    .prepare("UPDATE session SET expires_at = ? WHERE token = ?")
    .bind(expiresAt, token)
    .run();
  expect(updated.meta.changes).toBe(1);
  await page.context().addCookies([{ ...cookie, expires: expiresAt }]);
  return { expiresAt, token };
};

test.describe("staff-ui", { tag: ["@native", "@account-assisted"] }, () => {
  test.describe("Browser journeys", { tag: ["@browser"] }, () => {
    test(
      "Staff creation reviews immutable fields and hands over a credential once",
      {
        tag: [
          "@risk-privacy",
          "@risk-recovery",
          "@risk-security",
          "@risk-non-replay",
          "@mobile-critical",
        ],
      },
      async ({ caseApp, staffPage: page, staff }, testInfo) => {
        await page.goto("/staff/accounts");
        await page.context().clearCookies({ name: "efcc-auth-context" });
        expect(await readAuthContextMarker(page)).toBeNull();
        await page.getByRole("link", { name: /建立帳戶/u }).click();
        await expect(
          page.getByRole("button", { name: "檢查帳戶資料" })
        ).toBeEnabled();
        const input = creation();
        await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
        await page
          .getByLabel("使用者名稱", { exact: true })
          .fill(input.username);
        await page.getByLabel("電話", { exact: true }).fill(input.phone);
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
        let requests = 0;
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            request.url().endsWith("/api/v2/staff/accounts")
          ) {
            requests += 1;
          }
        });
        await page.getByRole("button", { name: "檢查帳戶資料" }).click();
        await expect(
          page.getByRole("heading", {
            exact: true,
            level: 1,
            name: "檢查新帳戶",
          })
        ).toBeVisible();
        expect(requests).toBe(0);
        for (const value of [
          input.fullName,
          input.username,
          input.phone,
          "已親身核實",
          "未提供",
          "否",
        ]) {
          await expect(page.getByText(value, { exact: true })).toBeVisible();
        }
        await page.getByRole("button", { name: "返回修改" }).click();
        await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
          input.fullName
        );
        await expect(
          page.getByLabel("使用者名稱", { exact: true })
        ).toHaveValue(input.username);
        await expect(page.getByLabel("電話", { exact: true })).toHaveValue(
          input.phone
        );
        await expect(
          page.getByLabel("已親身核實此人的身分", { exact: true })
        ).toBeChecked();
        await page.getByRole("button", { name: "檢查帳戶資料" }).click();
        await expect(
          page.getByRole("heading", {
            exact: true,
            level: 1,
            name: "檢查新帳戶",
          })
        ).toBeVisible();
        const submit = page.getByRole("button", {
          name: "確認並建立帳戶及發出臨時密碼",
        });
        await expect(submit).toBeEnabled();
        await qualifyPresentation(page, testInfo, "create-review", {
          criticalAction: submit,
          drafts: creationDrafts(page),
          focus: submit,
        });

        const shortenedSession = await shortenSessionExpiry(caseApp, page);
        expect(
          await caseApp.db
            .prepare("SELECT expires_at FROM session WHERE token = ?")
            .bind(shortenedSession.token)
            .first<{ expires_at: number }>()
        ).toEqual({ expires_at: shortenedSession.expiresAt });

        let creationPersistedExpires: number | undefined;
        let creationRenewalObservedAt = 0;
        let creationResponseRenewedSessionCookie = false;

        const committed = Promise.withResolvers<APIResponse>();
        const release = Promise.withResolvers<null>();
        const settled = Promise.withResolvers<null>();
        let submittedKey = "";
        let submittedBody: Record<string, unknown> | null = null;
        let submittedActor: string | undefined;
        let routeStarted = false;
        let response: APIResponse | undefined;
        await page.route("**/api/v2/staff/accounts", async (route) => {
          routeStarted = true;
          try {
            const body = route.request().postDataJSON() as Record<
              string,
              unknown
            >;
            submittedKey = String(body.operationKey);
            submittedBody = body;
            submittedActor = route.request().headers()[
              "x-efcc-expected-actor-id"
            ];
            let fetched: APIResponse;
            try {
              fetched = await route.fetch();
            } catch (error) {
              committed.reject(error);
              await route.abort("failed");
              return;
            }
            creationRenewalObservedAt = Math.floor(Date.now() / 1000);
            const session = await caseApp.db
              .prepare("SELECT expires_at FROM session WHERE token = ?")
              .bind(shortenedSession.token)
              .first<{ expires_at: number }>();
            creationPersistedExpires = session?.expires_at;
            creationResponseRenewedSessionCookie = (
              await fetched.headersArray()
            )
              .filter((header) => header.name.toLowerCase() === "set-cookie")
              .some((header) =>
                header.value.startsWith("better-auth.session_token=")
              );
            committed.resolve(fetched);
            await release.promise;
            await route.fulfill({
              body: await fetched.body(),
              headers: fetched.headers(),
              status: fetched.status(),
            });
          } finally {
            settled.resolve(null);
          }
        });
        const creationIngress = observeStaffCreationIngress(caseApp);
        try {
          const [, committedResponse] = await Promise.all([
            submit.click(),
            committed.promise,
          ]);
          response = committedResponse;
          expect(committedResponse.status()).toBe(201);
          expect(submittedKey).toEqual(expect.any(String));
          expect(submittedKey).not.toBe(input.operationKey);
          expect(submittedBody).toEqual({
            ...input,
            operationKey: submittedKey,
          });
          expect(submittedActor).toBe(staff.userId);
          await expect(page.getByRole("status").first()).toContainText(
            "正在提交"
          );
          await expect(submit).toHaveCount(0);
          await page.keyboard.press("Enter");
          await expect(submit).toHaveCount(0);
          expect(requests).toBe(1);
        } finally {
          release.resolve(null);
          try {
            if (routeStarted) {
              await settled.promise;
            }
            await page.unroute("**/api/v2/staff/accounts");
          } finally {
            creationIngress.restore();
          }
        }
        if (!response) {
          throw new Error(
            "Committed account creation response was not observed"
          );
        }
        const issuance = issuedCredential(await staffData(response));
        expect(creationIngress.read()).toEqual({
          cookieHeaderPresent: true,
          markerPresent: true,
        });
        expect(await readAuthContextMarker(page)).not.toBeNull();
        expect(requests).toBe(1);
        const output = page.getByLabel("新臨時密碼", { exact: true });
        await expect(output).toBeVisible();
        const browserSessionObservationAt = Math.floor(Date.now() / 1000);
        const browserSessionCookie = (await page.context().cookies()).find(
          (cookie) => cookie.name === "better-auth.session_token"
        );
        const browserSession = await caseApp.db
          .prepare("SELECT expires_at FROM session WHERE token = ?")
          .bind(shortenedSession.token)
          .first<{ expires_at: number }>();
        await expect(page.getByLabel("中文全名", { exact: true })).toHaveCount(
          0
        );
        const acknowledgement = page.getByRole("checkbox");
        const finish = page.getByRole("button", {
          name: "完成，開始另一項操作",
        });
        const copy = page.getByRole("button", { name: "複製臨時密碼" });
        await expect(finish).toBeDisabled();
        await acknowledgement.check();
        await expect(finish).toBeEnabled();
        await acknowledgement.uncheck();
        await expect(finish).toBeDisabled();
        const secret = await output.textContent();
        expect(secret).toBe(issuance.temporaryPassword);
        expect(secret).toHaveLength(32);
        const targetUserId = issuance.receipt?.targetUserId;
        if (!targetUserId) {
          throw new Error("Staff creation receipt did not identify its target");
        }
        expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
          credential_revision: 0,
          temporary_password_expires_at: issuance.temporaryPasswordExpiresAt,
        });
        expect(await creationEffects(caseApp, input.username, secret)).toEqual({
          audits: 1,
          credentials: 1,
          plaintext: 0,
          profiles: 1,
          receipts: 1,
          reservations: 1,
          users: 1,
        });
        const raw = await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        );
        if (!raw) {
          throw new Error(
            "Staff handover did not retain its operation reference"
          );
        }
        const operation = storedStaffAccountOperationSchema.parse(
          JSON.parse(raw)
        );
        expect(operation).toEqual({
          action: "assisted_account_created",
          actorUserId: staff.userId,
          key: submittedKey,
          targetUserId: null,
        });
        expect(raw).not.toContain(secret ?? "");
        expect(
          await caseApp.db
            .prepare(
              "SELECT action, actor_user_id, identity_check, operation_key, target_credential_revision, target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(staff.userId, submittedKey)
            .first()
        ).toEqual({
          action: "assisted_account_created",
          actor_user_id: staff.userId,
          identity_check: "face_to_face",
          operation_key: submittedKey,
          target_credential_revision: 0,
          target_user_id: targetUserId,
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM staff_account_operation WHERE operation_key = ? AND actor_user_id = ? AND target_user_id = ?"
            )
            .bind(submittedKey, staff.userId, targetUserId)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });
        await expect(
          page.getByRole("region", { name: "操作對象" })
        ).toContainText(input.fullName);
        await expect(
          page.getByRole("region", { name: "操作對象" })
        ).toContainText(input.username);
        await qualifyPresentation(page, testInfo, "create-handover", {
          criticalAction: copy,
          drafts: acknowledgement,
          focus: copy,
        });

        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: () =>
                Promise.reject(
                  new DOMException("Clipboard unavailable", "NotAllowedError")
                ),
            },
          });
        });
        await copy.click();
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "未能複製，請手動選取臨時密碼" })
        ).toContainText("未能複製，請手動選取臨時密碼");
        await expect(output).toHaveText(secret ?? "");
        await output.selectText();
        expect(
          await page.evaluate(() => window.getSelection()?.toString() ?? "")
        ).toBe(secret);
        await qualifyPresentation(page, testInfo, "handover-copy-failure", {
          criticalAction: copy,
          drafts: acknowledgement,
          focus: copy,
          masks: [output],
        });
        const saved = await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        );
        expect(saved).not.toContain(secret ?? "");
        expect(Object.keys(JSON.parse(saved ?? "{}")).toSorted()).toEqual([
          "action",
          "actorUserId",
          "key",
          "targetUserId",
        ]);
        expect(
          await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM staff_account_operation WHERE instr(id || operation_key || request_hash || actor_session_id || confirmation_operation_id, ?) > 0"
            )
            .bind(secret)
            .first<{ count: number }>()
        ).toEqual({ count: 0 });

        await page.evaluate(() => {
          const remove = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function removeItem(key: string) {
            if (key === "efcc.staff-account.operation.v1") {
              throw new DOMException("Local storage denied", "SecurityError");
            }
            return remove.call(this, key);
          };
          document.addEventListener(
            "vf-restore-storage",
            () => {
              Storage.prototype.removeItem = remove;
            },
            { once: true }
          );
        });
        try {
          await acknowledgement.check();
          await finish.click();
          await expect(page.getByRole("alert")).toContainText(
            "未能清除操作代碼"
          );
          await expect(output).toHaveText(secret ?? "");
          expect(
            await page.evaluate(() =>
              localStorage.getItem("efcc.staff-account.operation.v1")
            )
          ).toBe(saved);
          expect(requests).toBe(1);
          await acknowledgement.uncheck();
        } finally {
          await page.evaluate(() =>
            document.dispatchEvent(new Event("vf-restore-storage"))
          );
        }
        await page.reload();
        await expect(page.getByRole("status").first()).toContainText(
          "原臨時密碼不能再次讀取"
        );
        await expect(
          page.getByLabel("新臨時密碼", { exact: true })
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "重新核實並發出新臨時密碼" })
          .click();
        await expect(page).toHaveURL(
          (url) =>
            url.pathname === "/staff/accounts" &&
            url.searchParams.get("person") === targetUserId &&
            url.searchParams.get("task") === "recovery" &&
            url.searchParams.get("view") === "people"
        );
        await expect(
          page.getByRole("heading", { exact: true, name: "帳戶復原" })
        ).toBeVisible();
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.staff-account.operation.v1")
          )
        ).toBeNull();

        await testInfo.attach("creation-session-renewal-observation.json", {
          body: JSON.stringify(
            {
              afterCreationResponse: {
                observedAt: creationRenewalObservedAt,
                persistedExpiresAt: creationPersistedExpires,
                sessionCookiePresent: creationResponseRenewedSessionCookie,
              },
              afterHandoverVisible: {
                browserCookieExpiresAt: browserSessionCookie?.expires,
                observedAt: browserSessionObservationAt,
                persistedExpiresAt: browserSession?.expires_at,
              },
              beforeCreation: {
                persistedExpiresAt: shortenedSession.expiresAt,
              },
              expectedIdleWindowSeconds: ninetyDaysSeconds,
            },
            null,
            2
          ),
          contentType: "application/json",
        });

        expect(creationResponseRenewedSessionCookie).toBe(true);
        expect(creationPersistedExpires).toBeGreaterThan(
          shortenedSession.expiresAt
        );
        expect(creationRenewalObservedAt).toBeGreaterThan(0);
        const expectedCreationExpiry =
          creationRenewalObservedAt + ninetyDaysSeconds;
        expect(creationPersistedExpires).toBeGreaterThanOrEqual(
          expectedCreationExpiry - 2
        );
        expect(creationPersistedExpires).toBeLessThanOrEqual(
          expectedCreationExpiry + 2
        );
        expect(browserSession?.expires_at).toBeGreaterThan(
          shortenedSession.expiresAt
        );
        expect(browserSession?.expires_at).toBeGreaterThanOrEqual(
          browserSessionObservationAt + ninetyDaysSeconds - 2
        );
        expect(browserSession?.expires_at).toBeLessThanOrEqual(
          browserSessionObservationAt + ninetyDaysSeconds + 2
        );
        expect(browserSessionCookie?.expires).toBeGreaterThan(
          shortenedSession.expiresAt
        );
        expect(browserSessionCookie?.expires).toBeGreaterThanOrEqual(
          browserSessionObservationAt + ninetyDaysSeconds - 2
        );
        expect(browserSessionCookie?.expires).toBeLessThanOrEqual(
          browserSessionObservationAt + ninetyDaysSeconds + 2
        );
      }
    );

    test(
      "a visible creation handover is discarded after another tab signs in as a different actor",
      {
        tag: ["@risk-privacy", "@risk-security", "@mobile-critical"],
      },
      async ({ caseApp, staffPage: page, staff }, testInfo) => {
        const secondAccount = syntheticAccount(
          "visible-handover-actor",
          "staff"
        );
        const secondActorUserId =
          await caseApp.provision.account(secondAccount);
        const input = creation();
        await page.goto("/staff/accounts?task=create");
        await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
        await page
          .getByLabel("使用者名稱", { exact: true })
          .fill(input.username);
        await page.getByLabel("電話", { exact: true }).fill(input.phone);
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
        await page.getByRole("button", { name: "檢查帳戶資料" }).click();

        const createdResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/v2/staff/accounts")
        );
        await page
          .getByRole("button", {
            name: "確認並建立帳戶及發出臨時密碼",
          })
          .click();
        const response = await createdResponse;
        expect(response.status()).toBe(201);
        const issued = issuedCredential(await staffData(response));
        const output = page.getByLabel("新臨時密碼", { exact: true });
        const copy = page.getByRole("button", { name: "複製臨時密碼" });
        await expect(output).toHaveText(issued.temporaryPassword);
        await expect(copy).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => document.visibilityState))
          .toBe("visible");

        const savedBeforeSwitch = await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        );
        if (!savedBeforeSwitch) {
          throw new Error("Visible handover did not retain its operation key");
        }
        const operation = storedStaffAccountOperationSchema.parse(
          JSON.parse(savedBeforeSwitch)
        );
        expect(operation).toMatchObject({
          action: "assisted_account_created",
          actorUserId: staff.userId,
          targetUserId: null,
        });
        expect(savedBeforeSwitch).not.toContain(issued.temporaryPassword);
        const targetUserId = issued.receipt?.targetUserId;
        if (!targetUserId) {
          throw new Error("Creation receipt did not identify its target");
        }
        expect(
          await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?"
            )
            .bind(staff.userId, operation.key, targetUserId)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });

        const markerBeforeSwitch = await readAuthContextMarker(page);

        await page.evaluate(() => {
          const visibilityWindow = window as Window & {
            __w12ActorSwitchVisibilityObservations?: {
              state: DocumentVisibilityState;
              timestamp: number;
            }[];
          };
          const observations = [
            {
              state: document.visibilityState,
              timestamp: performance.now(),
            },
          ];
          visibilityWindow.__w12ActorSwitchVisibilityObservations =
            observations;
          document.addEventListener("visibilitychange", () => {
            observations.push({
              state: document.visibilityState,
              timestamp: performance.now(),
            });
          });
        });
        const cookieStoreSetup = await page.evaluate((baselineMarker) => {
          const candidate = Reflect.get(window, "cookieStore");
          const store =
            candidate !== null &&
            typeof candidate === "object" &&
            "addEventListener" in candidate &&
            typeof candidate.addEventListener === "function"
              ? (candidate as EventTarget)
              : null;
          const probe: AuthContextCookieStoreProbe = {
            apiAvailable: store !== null,
            baselineMarkerPresent: baselineMarker !== null,
            changedEventCount: 0,
            deletedEventCount: 0,
            generationChanged: false,
            secureContext: window.isSecureContext,
          };
          (
            window as Window & {
              __w12CookieStoreProbe?: AuthContextCookieStoreProbe;
            }
          ).__w12CookieStoreProbe = probe;
          if (store) {
            store.addEventListener("change", (event) => {
              const cookieEvent = event as Event & {
                changed?: { name?: string; value?: string }[];
                deleted?: { name?: string }[];
              };
              const marker = cookieEvent.changed?.find(
                (cookie) => cookie.name === "efcc-auth-context"
              );
              const markerDeleted = cookieEvent.deleted?.some(
                (cookie) => cookie.name === "efcc-auth-context"
              );
              if (marker) {
                probe.changedEventCount += 1;
                probe.generationChanged ||=
                  typeof marker.value === "string" &&
                  marker.value !== baselineMarker;
              }
              if (markerDeleted) {
                probe.deletedEventCount += 1;
              }
            });
          }
          return {
            apiAvailable: probe.apiAvailable,
            baselineMarkerPresent: probe.baselineMarkerPresent,
            secureContext: probe.secureContext,
          };
        }, markerBeforeSwitch);

        const secondPage = await page.context().newPage();
        try {
          await secondPage.goto("/sign-in");
          await secondPage.bringToFront();
          await expect
            .poll(() => page.evaluate(() => document.visibilityState))
            .toBe("visible");
          await expect(output).toHaveText(issued.temporaryPassword);
          await expect(copy).toBeVisible();
          expect(
            await page.evaluate(() =>
              localStorage.getItem("efcc.staff-account.operation.v1")
            )
          ).toBe(savedBeforeSwitch);

          await secondPage
            .getByLabel("Username", { exact: true })
            .fill(secondAccount.username);
          await secondPage
            .getByLabel("密碼", { exact: true })
            .fill(secondAccount.password);
          const signInResponse = secondPage.waitForResponse(
            (candidateResponse) =>
              candidateResponse.request().method() === "POST" &&
              new URL(candidateResponse.url()).pathname ===
                "/api/auth/sign-in/username"
          );
          await secondPage.getByRole("button", { name: "登入" }).click();
          const signIn = await signInResponse;
          const signInSetCookieHasMarker = (await signIn.headersArray()).some(
            (header) =>
              header.name.toLowerCase() === "set-cookie" &&
              header.value.startsWith("efcc-auth-context=")
          );
          await expect(secondPage).toHaveURL(/\/$/u);
          const signedInActor = await secondPage.evaluate(async () => {
            const sessionResponse = await fetch("/api/auth/get-session", {
              cache: "no-store",
              credentials: "same-origin",
            });
            const session: unknown = await sessionResponse.json();
            return session !== null &&
              typeof session === "object" &&
              "user" in session &&
              session.user !== null &&
              typeof session.user === "object" &&
              "id" in session.user &&
              typeof session.user.id === "string"
              ? session.user.id
              : null;
          });
          expect(signedInActor).toBe(secondActorUserId);
          let cookieStoreWaitError: string | null = null;
          if (cookieStoreSetup.apiAvailable) {
            try {
              await page.waitForFunction(
                () => {
                  const probe = (
                    window as Window & {
                      __w12CookieStoreProbe?: AuthContextCookieStoreProbe;
                    }
                  ).__w12CookieStoreProbe;
                  return (
                    probe !== undefined &&
                    (probe.changedEventCount > 0 || probe.deletedEventCount > 0)
                  );
                },
                undefined,
                { timeout: 5000 }
              );
            } catch (error) {
              cookieStoreWaitError =
                error instanceof Error ? error.name : "UnknownError";
            }
          } else {
            cookieStoreWaitError = "CookieStoreUnavailable";
          }
          const cookieStoreProbe = await page.evaluate(() => {
            const probe = (
              window as Window & {
                __w12CookieStoreProbe?: AuthContextCookieStoreProbe;
              }
            ).__w12CookieStoreProbe;
            return probe ?? null;
          });
          const markerAfterSignIn = await readAuthContextMarker(page);
          const browserCookieGenerationChanged =
            markerBeforeSwitch !== null &&
            markerAfterSignIn !== null &&
            markerBeforeSwitch !== markerAfterSignIn;
          await testInfo.attach("auth-context-cookie-store-probe.json", {
            body: JSON.stringify(
              {
                browserCookieGenerationChanged,
                cookieStoreProbe,
                cookieStoreSetup,
                cookieStoreWaitError,
                signInSetCookieHasMarker,
              },
              null,
              2
            ),
            contentType: "application/json",
          });
          expect(cookieStoreWaitError).toBeNull();
          expect(cookieStoreSetup).toEqual({
            apiAvailable: true,
            baselineMarkerPresent: true,
            secureContext: true,
          });
          expect(cookieStoreProbe).toMatchObject({
            apiAvailable: true,
            baselineMarkerPresent: true,
            changedEventCount: expect.any(Number),
            deletedEventCount: 0,
            generationChanged: true,
            secureContext: true,
          });
          expect(cookieStoreProbe?.changedEventCount).toBeGreaterThan(0);
          expect(signInSetCookieHasMarker).toBe(true);
          expect(browserCookieGenerationChanged).toBe(true);
          await expect
            .poll(() => page.evaluate(() => document.visibilityState))
            .toBe("visible");
          const visibilityBeforeReturn = await page.evaluate(() => {
            const visibilityWindow = window as Window & {
              __w12ActorSwitchVisibilityObservations?: {
                state: DocumentVisibilityState;
                timestamp: number;
              }[];
            };
            return {
              current: document.visibilityState,
              observations:
                visibilityWindow.__w12ActorSwitchVisibilityObservations ?? [],
            };
          });
          await testInfo.attach("visible-actor-switch-visibility.json", {
            body: JSON.stringify(visibilityBeforeReturn, null, 2),
            contentType: "application/json",
          });
          expect(visibilityBeforeReturn.current).toBe("visible");
          expect(visibilityBeforeReturn.observations.length).toBeGreaterThan(0);
          expect(visibilityBeforeReturn.observations[0]?.state).toBe("visible");
          expect(
            visibilityBeforeReturn.observations.some(
              ({ state }) => state === "hidden"
            )
          ).toBe(false);
          await expect(output).toHaveCount(0);
          await expect(copy).toHaveCount(0);
          await expect(
            page.getByText(issued.temporaryPassword, { exact: true })
          ).toHaveCount(0);

          await page.bringToFront();
          await expect
            .poll(() => page.evaluate(() => document.visibilityState))
            .toBe("visible");
          await expect(output).toHaveCount(0);
          await expect(copy).toHaveCount(0);
          await expect(
            page.getByText(issued.temporaryPassword, { exact: true })
          ).toHaveCount(0);
          const savedAfterActorSwitch = await page.evaluate(() =>
            localStorage.getItem("efcc.staff-account.operation.v1")
          );
          expect(savedAfterActorSwitch).toBe(savedBeforeSwitch);
          expect(savedAfterActorSwitch).not.toContain(issued.temporaryPassword);
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?"
              )
              .bind(staff.userId, operation.key, targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 1 });
        } finally {
          await secondPage.close();
        }
      }
    );

    test(
      "a visible creation handover is cleared when its document becomes hidden during navigation",
      {
        tag: ["@risk-privacy", "@risk-security", "@mobile-critical"],
      },
      async ({ caseApp, staffPage: fixturePage }, testInfo) => {
        const visibility = await openVisibilityStaffPage({
          fixturePage,
          origin: caseApp.origin,
          projectName: testInfo.project.name,
          projectOptions: {
            deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
            hasTouch: testInfo.project.use.hasTouch,
            isMobile: testInfo.project.use.isMobile,
            screen: Reflect.get(testInfo.project.use, "screen") as
              | { height: number; width: number }
              | undefined,
            userAgent: testInfo.project.use.userAgent,
            viewport: testInfo.project.use.viewport,
          },
        });
        const { page } = visibility;
        const observationToken = randomUUID();
        let observation: {
          copyCount: string | null;
          hidden: string | null;
          outputCount: string | null;
        } | null = null;
        const originalFetch = caseApp.fetch;
        const recordHideRequest = (input: string, method: string) => {
          const requestUrl = new URL(input, caseApp.origin);
          if (
            method !== "GET" ||
            requestUrl.pathname !== "/api/v2/me" ||
            requestUrl.searchParams.get("__w12HideObservation") !==
              observationToken
          ) {
            return;
          }
          observation = {
            copyCount: requestUrl.searchParams.get("copyCount"),
            hidden: requestUrl.searchParams.get("hidden"),
            outputCount: requestUrl.searchParams.get("outputCount"),
          };
        };
        try {
          if (visibility.profileReadback) {
            await testInfo.attach("visibility-browser-profile.json", {
              body: JSON.stringify(
                {
                  project: testInfo.project.name,
                  readback: visibility.profileReadback,
                },
                null,
                2
              ),
              contentType: "application/json",
            });
            expect(visibility.profileReadback).toEqual({
              clientHintMobileMatches: true,
              coarsePointerMatches: true,
              devicePixelRatioMatches: true,
              maxTouchPointsMatches: true,
              screenMatches: true,
              touchEventSupportMatches: true,
              userAgentMatches: testInfo.project.use.userAgent ? true : null,
              viewportMatches: true,
            });
          }
          const input = creation();
          await page
            .getByLabel("中文全名", { exact: true })
            .fill(input.fullName);
          await page
            .getByLabel("使用者名稱", { exact: true })
            .fill(input.username);
          await page.getByLabel("電話", { exact: true }).fill(input.phone);
          await page
            .getByLabel("已親身核實此人的身分", { exact: true })
            .check();
          await page.getByRole("button", { name: "檢查帳戶資料" }).click();

          const createdResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              response.url().endsWith("/api/v2/staff/accounts")
          );
          await page
            .getByRole("button", {
              name: "確認並建立帳戶及發出臨時密碼",
            })
            .click();
          const response = await createdResponse;
          expect(response.status()).toBe(201);
          const issued = issuedCredential(await staffData(response));
          const output = page.getByLabel("新臨時密碼", { exact: true });
          const copy = page.getByRole("button", {
            name: "複製臨時密碼",
          });
          const initialCredentialIsVisible =
            (await output.textContent()) === issued.temporaryPassword;
          expect(initialCredentialIsVisible).toBe(true);
          await expect(copy).toBeVisible();
          await expect
            .poll(() => page.evaluate(() => document.visibilityState))
            .toBe("visible");

          caseApp.fetch = (requestInput, init) => {
            if (typeof requestInput === "string" && init instanceof Request) {
              recordHideRequest(requestInput, init.method);
            }
            return originalFetch(requestInput, init);
          };
          await page.evaluate((token) => {
            document.addEventListener("visibilitychange", () => {
              if (!document.hidden) {
                return;
              }
              const query = new URLSearchParams({
                __w12HideObservation: token,
                copyCount: String(
                  [...document.querySelectorAll("button")].filter(
                    (button) => button.textContent?.trim() === "複製臨時密碼"
                  ).length
                ),
                hidden: String(document.hidden),
                outputCount: String(
                  document.querySelectorAll('[aria-label="新臨時密碼"]').length
                ),
              });
              void fetch(`/api/v2/me?${query}`, {
                cache: "no-store",
                credentials: "same-origin",
                keepalive: true,
              }).catch(() => null);
            });
          }, observationToken);

          expect(await page.evaluate(() => document.visibilityState)).toBe(
            "visible"
          );
          expect(observation).toBeNull();
          const navigationResponse = await page.goto(
            new URL("/staff/accounts?view=people", caseApp.origin).toString()
          );
          expect(navigationResponse?.status()).toBe(200);
          await expect(page).toHaveURL(
            (url) =>
              url.pathname === "/staff/accounts" &&
              url.searchParams.get("view") === "people"
          );
          await expect.poll(() => observation !== null).toBe(true);
          expect(observation).toEqual({
            copyCount: "0",
            hidden: "true",
            outputCount: "0",
          });
        } finally {
          caseApp.fetch = originalFetch;
          try {
            await testInfo.attach("real-navigation-hide-observation.json", {
              body: JSON.stringify(observation, null, 2),
              contentType: "application/json",
            });
          } finally {
            await visibility.close?.();
          }
        }
      }
    );

    test(
      "a late creation response may restore its native session but must discard its credential after an actor switch",
      {
        tag: [
          "@risk-privacy",
          "@risk-recovery",
          "@risk-security",
          "@mobile-critical",
        ],
      },
      async ({ caseApp, staffPage: page, staff }) => {
        const secondAccount = syntheticAccount(
          "second-handover-actor",
          "staff"
        );
        const secondActorUserId =
          await caseApp.provision.account(secondAccount);
        const input = creation();
        await page.goto("/staff/accounts?task=create");
        await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
        await page
          .getByLabel("使用者名稱", { exact: true })
          .fill(input.username);
        await page.getByLabel("電話", { exact: true }).fill(input.phone);
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
        await page.getByRole("button", { name: "檢查帳戶資料" }).click();
        const shortenedSession = await shortenSessionExpiry(caseApp, page);

        const submit = page.getByRole("button", {
          name: "確認並建立帳戶及發出臨時密碼",
        });
        const committed = Promise.withResolvers<APIResponse>();
        const release = Promise.withResolvers<null>();
        const settled = Promise.withResolvers<null>();
        let routeStarted = false;
        await page.route("**/api/v2/staff/accounts", async (route) => {
          routeStarted = true;
          try {
            const response = await route.fetch();
            committed.resolve(response);
            await release.promise;
            await route.fulfill({ response });
          } catch (error) {
            committed.reject(error);
            await route.abort("failed");
          } finally {
            settled.resolve(null);
          }
        });
        const creationIngress = observeStaffCreationIngress(caseApp);
        try {
          const [, response] = await Promise.all([
            submit.click(),
            committed.promise,
          ]);
          expect(response.status()).toBe(201);
          const issuanceCookieNames = (await response.headersArray())
            .filter((header) => header.name.toLowerCase() === "set-cookie")
            .map((header) => header.value.split("=", 1)[0]);
          expect(issuanceCookieNames).toContain("better-auth.session_token");
          expect(creationIngress.read()).toEqual({
            cookieHeaderPresent: true,
            markerPresent: true,
          });
          const renewedSession = await caseApp.db
            .prepare("SELECT expires_at FROM session WHERE token = ?")
            .bind(shortenedSession.token)
            .first<{ expires_at: number }>();
          expect(renewedSession?.expires_at).toBeGreaterThan(
            shortenedSession.expiresAt
          );
          const issued = issuedCredential(await staffData(response));
          const switched = await page.request.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: secondAccount.password,
                username: secondAccount.username,
              },
            }
          );
          expect(switched.status()).toBe(200);
          expect(
            await page.request
              .get("/api/auth/get-session")
              .then((session) => session.json())
          ).toMatchObject({
            user: { id: secondActorUserId },
          });
          const browserSession = await page.evaluate(async () => {
            const sessionResponse = await fetch("/api/auth/get-session", {
              cache: "no-store",
              credentials: "same-origin",
            });
            return sessionResponse.json();
          });
          expect(browserSession).toMatchObject({
            user: { id: secondActorUserId },
          });
          expect(await page.evaluate(() => document.hidden)).toBe(false);

          release.resolve(null);
          await settled.promise;
          const browserSessionAfterResponse = await page.evaluate(async () => {
            const sessionResponse = await fetch("/api/auth/get-session", {
              cache: "no-store",
              credentials: "same-origin",
            });
            return sessionResponse.json();
          });
          expect(browserSessionAfterResponse).toMatchObject({
            user: { id: staff.userId },
          });
          await expect(
            page.getByRole("heading", { exact: true, name: "帳戶已建立" })
          ).toBeVisible();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "臨時密碼不能再次顯示",
            })
          ).toBeVisible();
          await page.getByText("操作詳情", { exact: true }).click();
          await expect(
            page.getByRole("status").filter({ hasText: "伺服器已確認操作完成" })
          ).toContainText("伺服器已確認操作完成");
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByText(issued.temporaryPassword, { exact: true })
          ).toHaveCount(0);
          const ordinaryBusinessResponse = await page.request.get(
            "/api/v2/staff/accounts"
          );
          expect(ordinaryBusinessResponse.status()).toBe(200);
          const ordinaryCookieNames = (
            await ordinaryBusinessResponse.headersArray()
          )
            .filter((header) => header.name.toLowerCase() === "set-cookie")
            .map((header) => header.value.split("=", 1)[0]);
          expect(ordinaryCookieNames).toContain("better-auth.session_token");
          const saved = await page.evaluate(() =>
            localStorage.getItem("efcc.staff-account.operation.v1")
          );
          expect(saved).not.toContain(issued.temporaryPassword);
          expect(JSON.parse(saved ?? "{}")).toMatchObject({
            action: "assisted_account_created",
            actorUserId: staff.userId,
          });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND action = 'assisted_account_created'"
              )
              .bind(staff.userId)
              .first<{ count: number }>()
          ).toEqual({ count: 1 });
        } finally {
          release.resolve(null);
          try {
            if (routeStarted) {
              await settled.promise;
            }
            await page.unroute("**/api/v2/staff/accounts");
          } finally {
            creationIngress.restore();
          }
        }
      }
    );

    test(
      "a held creation session read may restore its native session but must not disclose the credential after an actor switch",
      {
        tag: [
          "@risk-privacy",
          "@risk-security",
          "@risk-recovery",
          "@mobile-critical",
        ],
      },
      async ({ caseApp, staffPage: page, staff }, testInfo) => {
        const secondAccount = syntheticAccount(
          "held-session-handover-actor",
          "staff"
        );
        const secondActorUserId =
          await caseApp.provision.account(secondAccount);
        const input = creation();
        await page.goto("/staff/accounts?task=create");
        await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
        await page
          .getByLabel("使用者名稱", { exact: true })
          .fill(input.username);
        await page.getByLabel("電話", { exact: true }).fill(input.phone);
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
        await page.getByRole("button", { name: "檢查帳戶資料" }).click();

        const submit = page.getByRole("button", {
          name: "確認並建立帳戶及發出臨時密碼",
        });
        const createdResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/v2/staff/accounts") &&
            response.status() === 201
        );
        const heldSession = Promise.withResolvers<{
          actorUserId: string | null;
          cookieNames: string[];
          refreshDisabled: boolean;
        }>();
        const releaseSession = Promise.withResolvers<null>();
        const sessionSettled = Promise.withResolvers<null>();
        let creationCommitted = false;
        let sessionRouteStarted = false;
        const markCreationCommitted = (response: {
          request: () => { method: () => string };
          status: () => number;
          url: () => string;
        }) => {
          if (
            response.request().method() === "POST" &&
            response.url().endsWith("/api/v2/staff/accounts") &&
            response.status() === 201
          ) {
            creationCommitted = true;
          }
        };
        await page.route("**/api/auth/get-session**", async (route) => {
          if (!creationCommitted || sessionRouteStarted) {
            await route.continue();
            return;
          }
          sessionRouteStarted = true;
          try {
            const response = await route.fetch();
            const session: unknown = await response.json();
            const actorUserId =
              session !== null &&
              typeof session === "object" &&
              "user" in session &&
              session.user !== null &&
              typeof session.user === "object" &&
              "id" in session.user &&
              typeof session.user.id === "string"
                ? session.user.id
                : null;
            const cookieNames = (await response.headersArray())
              .filter((header) => header.name.toLowerCase() === "set-cookie")
              .map((header) => header.value.split("=", 1)[0] ?? "");
            heldSession.resolve({
              actorUserId,
              cookieNames,
              refreshDisabled:
                new URL(route.request().url()).searchParams.get(
                  "disableRefresh"
                ) === "true",
            });
            await releaseSession.promise;
            await route.fulfill({ response });
          } catch (error) {
            heldSession.reject(error);
            await route.abort("failed");
          } finally {
            sessionSettled.resolve(null);
          }
        });
        const creationIngress = observeStaffCreationIngress(caseApp);
        page.on("response", markCreationCommitted);
        try {
          const [, response] = await Promise.all([
            submit.click(),
            createdResponse,
          ]);
          const markerBeforeSwitch = await readAuthContextMarker(page);
          const creationIngressObservation = creationIngress.read();
          const markerIncludedWithCreation =
            creationIngressObservation?.markerPresent === true;
          const issued = issuedCredential(await staffData(response));
          const held = await heldSession.promise;
          const markerInDocumentCookie = await page.evaluate(() =>
            document.cookie
              .split(";")
              .some((part) => part.trim().startsWith("efcc-auth-context="))
          );
          await testInfo.attach(
            "auth-context-request-cookie-observation.json",
            {
              body: JSON.stringify(
                {
                  browserCookieJarHasMarker:
                    (await readAuthContextMarker(page)) !== null,
                  browserDocumentCookieHasMarker: markerInDocumentCookie,
                  nativeIngressObservation: creationIngressObservation,
                },
                null,
                2
              ),
              contentType: "application/json",
            }
          );

          const switched = await page.request.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: secondAccount.password,
                username: secondAccount.username,
              },
            }
          );
          expect(switched.status()).toBe(200);
          const switchedHeaders = await switched.headersArray();
          const markerAfterSwitch = await readAuthContextMarker(page);
          const markerChanged =
            markerBeforeSwitch !== null &&
            markerAfterSwitch !== null &&
            markerAfterSwitch !== markerBeforeSwitch;
          const actorBeforeRelease = await page.evaluate(async () => {
            const sessionResponse = await fetch("/api/auth/get-session", {
              cache: "no-store",
              credentials: "same-origin",
            });
            const session: unknown = await sessionResponse.json();
            return session !== null &&
              typeof session === "object" &&
              "user" in session &&
              session.user !== null &&
              typeof session.user === "object" &&
              "id" in session.user &&
              typeof session.user.id === "string"
              ? session.user.id
              : null;
          });
          expect(actorBeforeRelease).toBe(secondActorUserId);

          releaseSession.resolve(null);
          await sessionSettled.promise;
          const actorAfterRelease = await page.evaluate(async () => {
            const sessionResponse = await fetch("/api/auth/get-session", {
              cache: "no-store",
              credentials: "same-origin",
            });
            const session: unknown = await sessionResponse.json();
            return session !== null &&
              typeof session === "object" &&
              "user" in session &&
              session.user !== null &&
              typeof session.user === "object" &&
              "id" in session.user &&
              typeof session.user.id === "string"
              ? session.user.id
              : null;
          });
          await expect(
            page.getByRole("heading", { exact: true, name: "帳戶已建立" })
          ).toBeVisible();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "臨時密碼不能再次顯示",
            })
          ).toBeVisible();
          await page.getByText("操作詳情", { exact: true }).click();
          await expect(
            page.getByRole("status").filter({ hasText: "伺服器已確認操作完成" })
          ).toContainText("伺服器已確認操作完成");
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "複製臨時密碼" })
          ).toHaveCount(0);
          const savedOperationRaw = await page.evaluate(() =>
            localStorage.getItem("efcc.staff-account.operation.v1")
          );
          if (!savedOperationRaw) {
            throw new Error("Late session check lost its operation reference");
          }
          const savedOperation = storedStaffAccountOperationSchema.parse(
            JSON.parse(savedOperationRaw)
          );
          expect(savedOperation).toMatchObject({
            action: "assisted_account_created",
            actorUserId: staff.userId,
            targetUserId: null,
          });
          expect(savedOperationRaw).not.toContain(issued.temporaryPassword);
          const targetUserId = issued.receipt?.targetUserId;
          if (!targetUserId) {
            throw new Error("Creation receipt did not identify its target");
          }
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?"
              )
              .bind(staff.userId, savedOperation.key, targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 1 });
          const credentialVisible =
            (await page
              .getByText(issued.temporaryPassword, { exact: true })
              .count()) > 0;
          expect({
            actorAfterRelease,
            authContextAtCommand: markerIncludedWithCreation,
            authContextChanged: markerChanged,
            authContextCookieContract:
              hasAuthContextCookieContract(switchedHeaders),
            credentialVisible,
            heldActorUserId: held.actorUserId,
            heldResponseRefreshesSession: held.cookieNames.includes(
              "better-auth.session_token"
            ),
            sessionRefreshDisabled: held.refreshDisabled,
          }).toEqual({
            actorAfterRelease: staff.userId,
            authContextAtCommand: true,
            authContextChanged: true,
            authContextCookieContract: true,
            credentialVisible: false,
            heldActorUserId: staff.userId,
            heldResponseRefreshesSession: true,
            sessionRefreshDisabled: false,
          });
          const markerBeforeSignOut = await readAuthContextMarker(page);
          const signedOut = await page.request.post("/api/auth/sign-out", {
            data: {},
          });
          expect(signedOut.status()).toBe(200);
          const markerAfterSignOut = await readAuthContextMarker(page);
          expect({
            changed:
              markerAfterSignOut !== null &&
              markerAfterSignOut !== markerBeforeSignOut,
            cookieContract: hasAuthContextCookieContract(
              await signedOut.headersArray()
            ),
          }).toEqual({ changed: true, cookieContract: true });
        } finally {
          releaseSession.resolve(null);
          try {
            if (sessionRouteStarted) {
              await sessionSettled.promise;
            }
            page.off("response", markCreationCommitted);
            await page.unroute("**/api/auth/get-session**");
          } finally {
            creationIngress.restore();
          }
        }
      }
    );

    test(
      "Staff creation copies the one-time credential to the real desktop clipboard",
      {
        tag: ["@risk-privacy", "@risk-security"],
      },
      async ({ staffPage: page }, testInfo) => {
        await page.goto("/staff/accounts?task=create");
        const input = creation();
        await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
        await page
          .getByLabel("使用者名稱", { exact: true })
          .fill(input.username);
        await page.getByLabel("電話", { exact: true }).fill(input.phone);
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
        await page.getByRole("button", { name: "檢查帳戶資料" }).click();
        const finalSubmit = page.getByRole("button", {
          name: "確認並建立帳戶及發出臨時密碼",
        });
        await expect(finalSubmit).toBeEnabled();
        await qualifyPresentation(page, testInfo, "clipboard-create-review", {
          criticalAction: finalSubmit,
          drafts: creationDrafts(page),
          focus: finalSubmit,
        });
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"]);
        const committed = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/v2/staff/accounts")
        );
        await finalSubmit.click();
        const response = await committed;
        expect(response.status()).toBe(201);
        const issuance = issuedCredential(await staffData(response));
        const password = page.getByLabel("新臨時密碼", { exact: true });
        await expect(password).toHaveText(issuance.temporaryPassword);
        await page.getByRole("button", { name: "複製臨時密碼" }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          issuance.temporaryPassword
        );
      }
    );

    dedicatedTest(
      "Staff task recovery retains the selected person and task while security context is unavailable",
      {
        tag: ["@risk-resilience", "@risk-privacy", "@mobile-critical"],
      },
      async ({ caseApp, staffPage: page, staff }) => {
        const input = creation();
        const created = issuedCredential(
          await staffData(
            await expectResponseStatus(
              staff.context.post("/api/v2/staff/accounts", { data: input }),
              201
            )
          )
        );
        const targetUserId = created.receipt?.targetUserId;
        if (!targetUserId) {
          throw new Error("Staff creation did not identify its target");
        }
        for (const task of ["identity", "restrictions"] as const) {
          await caseApp.db
            .prepare(
              "ALTER TABLE session RENAME COLUMN password_confirmed_at TO fault_password_confirmed_at"
            )
            .run();
          try {
            await page.goto(
              `/staff/accounts?view=people&person=${targetUserId}&task=${task}`
            );
            await expect(
              page.getByRole("heading", {
                name: "暫時未能載入目前登入資料",
              })
            ).toBeVisible();
            await expect(
              page.getByRole("main").getByRole("link", {
                name: /返回帳戶詳情/u,
              })
            ).toHaveAttribute(
              "href",
              new RegExp(`person=${targetUserId}.*view=people`, "u")
            );
            const retryParams = await page
              .getByRole("button", { exact: true, name: "重新載入" })
              .evaluate((button) => {
                const { form } = button as HTMLButtonElement;
                return form
                  ? Object.fromEntries(new FormData(form).entries())
                  : {};
              });
            expect(retryParams).toMatchObject({
              person: targetUserId,
              task,
              view: "people",
            });
          } finally {
            await caseApp.db
              .prepare(
                "ALTER TABLE session RENAME COLUMN fault_password_confirmed_at TO password_confirmed_at"
              )
              .run();
          }
          await page
            .getByRole("button", { exact: true, name: "重新載入" })
            .click();
          await expect(page).toHaveURL(
            new RegExp(`person=${targetUserId}.*task=${task}`, "u")
          );
          await expect(
            task === "identity"
              ? page.getByRole("heading", { name: "修正身份資料" })
              : page.getByRole("region", { name: "會籍與安全限制" })
          ).toBeVisible();
        }
      }
    );

    dedicatedTest(
      "selected Staff details read authorized records outside the API page without serializing the whole directory",
      {
        tag: ["@risk-authorization", "@risk-privacy", "@mobile-critical"],
      },
      async ({ caseApp, staffPage: page, staff }) => {
        const members: {
          fullName: string;
          userId: string;
          username: string;
        }[] = [];
        for (let index = 0; index < 26; index += 1) {
          const generatedAccount = syntheticAccount(`directory-page-${index}`);
          const fullName = `陳頁外目標${String(index).padStart(2, "0")}`;
          const account = {
            ...generatedAccount,
            fullName,
            username: `pagedetail${String(index).padStart(2, "0")}`,
          };
          const userId = await caseApp.provision.account(account);
          members.push({ fullName, userId, username: account.username });
        }

        const firstPage = await expectResponseStatus(
          staff.context.get("/api/v2/staff/accounts"),
          200
        );
        const firstPageBody = (await firstPage.json()) as {
          data: { accounts: { userId: string }[] };
        };
        const secondPage = await expectResponseStatus(
          staff.context.get("/api/v2/staff/accounts?page=2"),
          200
        );
        const secondPageBody = (await secondPage.json()) as {
          data: { accounts: { userId: string }[] };
        };
        const firstPageIds = firstPageBody.data.accounts.map(
          ({ userId }) => userId
        );
        const targetId = secondPageBody.data.accounts.find(({ userId }) =>
          members.some((member) => member.userId === userId)
        )?.userId;
        if (!targetId || firstPageIds.includes(targetId)) {
          throw new Error(
            "The selected synthetic target is not outside page one"
          );
        }
        const target = members.find((member) => member.userId === targetId);
        if (!target) {
          throw new Error("The selected synthetic target was not provisioned");
        }

        await page.goto(
          `/staff/accounts?view=people&person=${targetId}&task=identity`
        );
        await expect(
          page.getByRole("heading", { name: "修正身份資料" })
        ).toBeVisible();
        await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
          target.fullName
        );
        const taskPayload = await page.content();
        for (const member of members) {
          if (member.userId !== targetId) {
            expect(taskPayload).not.toContain(member.username);
          }
        }

        await page.goto(`/staff/accounts?view=people&person=${targetId}`);
        await expect(
          page.getByRole("heading", { exact: true, name: "帳戶詳情" })
        ).toBeVisible();
        await expect(
          page
            .getByRole("region", { name: "操作對象" })
            .getByText(target.fullName, { exact: true })
        ).toBeVisible();
        const detailPayload = await page.content();
        for (const member of members) {
          if (member.userId !== targetId) {
            expect(detailPayload).not.toContain(member.username);
          }
        }

        const missingTargetId = "missingstaffaccountdetail00000000000";
        await page.goto(
          `/staff/accounts?view=people&person=${missingTargetId}`
        );
        await expect(
          page.getByRole("heading", { name: "帳戶管理" })
        ).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: "主要導覽" })
        ).toBeVisible();
        await expect(
          page.getByRole("searchbox", { name: "搜尋帳戶" })
        ).toBeVisible();
        await expect(
          page.getByText(missingTargetId, { exact: true })
        ).toHaveCount(0);

        await caseApp.db
          .prepare(
            "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
          )
          .bind(staff.userId)
          .run();
        await page.goto(`/staff/accounts?view=people&person=${targetId}`);
        await expect(
          page.getByRole("heading", { name: "你沒有帳戶管理權限" })
        ).toBeVisible();
        await expect(
          page.getByText(target.fullName, { exact: true })
        ).toHaveCount(0);
        await page.goto(
          `/staff/accounts?view=people&person=${targetId}&task=identity`
        );
        await expect(
          page.getByRole("heading", { name: "你沒有帳戶管理權限" })
        ).toBeVisible();
        await expect(
          page.getByText(target.fullName, { exact: true })
        ).toHaveCount(0);
      }
    );

    test(
      "checkbox rows preserve 44px touch targets and visible keyboard focus at phone and desktop widths",
      {
        tag: ["@risk-accessibility", "@mobile-critical"],
      },
      async ({ staffPage: page }) => {
        await page.goto("/staff/accounts?task=create");
        const sharedPhone = page.getByLabel("已親身核實共用電話例外", {
          exact: true,
        });
        await expect(sharedPhone).toBeEnabled();
        await expect(
          page.getByRole("checkbox", {
            exact: true,
            name: "已親身核實共用電話例外",
          })
        ).toHaveCount(1);
        for (const viewport of [
          { height: 915, width: 412 },
          { height: 1024, width: 1440 },
        ]) {
          await page.setViewportSize(viewport);
          const row = page.locator("label", { has: sharedPhone });
          const box = await row.boundingBox();
          expect(box, JSON.stringify(viewport)).not.toBeNull();
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(box?.width).toBeGreaterThanOrEqual(44);
          const edge = { x: (box?.width ?? 0) - 8, y: (box?.height ?? 0) / 2 };
          await row.click({ position: edge });
          await expect(sharedPhone).toBeChecked();
          await row.click({ position: edge });
          await expect(sharedPhone).not.toBeChecked();
          await page.getByLabel("電話", { exact: true }).focus();
          await page.keyboard.press("Tab");
          await expect(sharedPhone).toBeFocused();
          const focus = await sharedPhone.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              outlineStyle: style.outlineStyle,
              outlineWidth: Number(style.outlineWidth.slice(0, -2)),
            };
          });
          expect(focus.outlineStyle).not.toBe("none");
          expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
          await page.keyboard.press("Space");
          await expect(sharedPhone).toBeChecked();
          await page.keyboard.press("Space");
          await expect(sharedPhone).not.toBeChecked();
        }
      }
    );

    for (const { mode, check, confirm } of [
      {
        check: "檢查帳戶資料",
        confirm: "確認並建立帳戶及發出臨時密碼",
        mode: "create",
      },
      {
        check: "檢查資料",
        confirm: "確認並重設密碼及登出全部裝置",
        mode: "reset",
      },
      {
        check: "檢查資料",
        confirm: "確認並重新發出臨時密碼",
        mode: "reissue",
      },
    ] as const) {
      for (const returnBeforeResponse of [false, true]) {
        test(
          `late ${mode} handover stays discarded after hiding${returnBeforeResponse ? " and returning before settlement" : " until settlement"}`,
          {
            tag: ["@risk-privacy", "@risk-recovery", "@mobile-critical"],
          },
          async ({ caseApp, staffPage: page, staff }, testInfo) => {
            const input = creation();
            let targetUserId = "";
            if (mode !== "create") {
              const created = issuedCredential(
                await staffData(
                  await expectResponseStatus(
                    staff.context.post("/api/v2/staff/accounts", {
                      data: input,
                    }),
                    201
                  )
                )
              );
              targetUserId = created.receipt?.targetUserId ?? "";
              if (!targetUserId) {
                throw new Error("Staff creation did not identify its target");
              }
            }
            await page.goto(
              mode === "create"
                ? "/staff/accounts?task=create"
                : `/staff/accounts?person=${targetUserId}&task=recovery&view=people`
            );
            if (mode === "create") {
              await page
                .getByLabel("中文全名", { exact: true })
                .fill(input.fullName);
              await page
                .getByLabel("使用者名稱", { exact: true })
                .fill(input.username);
              await page.getByLabel("電話", { exact: true }).fill(input.phone);
              await page
                .getByLabel("已親身核實此人的身分", { exact: true })
                .check();
            } else {
              await page
                .getByLabel("已按以上方式核實身分", { exact: false })
                .check();
            }
            if (mode === "reissue") {
              await page
                .getByRole("radio", { name: /重新發出臨時密碼/u })
                .check();
            }
            const path =
              mode === "create"
                ? "/api/v2/staff/accounts"
                : `/api/v2/staff/accounts/password-${mode}`;
            const committed = Promise.withResolvers<APIResponse>();
            const release = Promise.withResolvers<null>();
            const settled = Promise.withResolvers<null>();
            let requests = 0;
            let submittedKey = "";
            let routeStarted = false;
            page.on("request", (request) => {
              if (
                request.method() === "POST" &&
                new URL(request.url()).pathname === path
              ) {
                requests += 1;
              }
            });
            await page.route(`**${path}`, async (route) => {
              routeStarted = true;
              try {
                submittedKey = String(
                  (route.request().postDataJSON() as Record<string, unknown>)
                    .operationKey
                );
                let response: APIResponse;
                try {
                  response = await route.fetch();
                } catch (error) {
                  committed.reject(error);
                  await route.abort("failed");
                  return;
                }
                committed.resolve(response);
                await release.promise;
                await route.fulfill({
                  body: await response.body(),
                  headers: response.headers(),
                  status: response.status(),
                });
              } finally {
                settled.resolve(null);
              }
            });
            try {
              await page
                .getByRole("button", { exact: true, name: check })
                .click();
              const finalSubmit = page.getByRole("button", {
                exact: true,
                name: confirm,
              });
              await expect(finalSubmit).toBeEnabled();
              await qualifyPresentation(page, testInfo, `${mode}-late-review`, {
                criticalAction: finalSubmit,
                drafts:
                  mode === "create"
                    ? creationDrafts(page)
                    : recoveryDrafts(page),
                focus: finalSubmit,
              });
              const [, response] = await Promise.all([
                finalSubmit.click(),
                committed.promise,
              ]);
              const issued = issuedCredential(await staffData(response));
              await expect(page.getByRole("status")).toContainText("正在提交");
              await page.evaluate(() => {
                Object.defineProperty(document, "hidden", {
                  configurable: true,
                  value: true,
                });
                document.dispatchEvent(new Event("visibilitychange"));
              });
              if (returnBeforeResponse) {
                await page.evaluate(() => {
                  Object.defineProperty(document, "hidden", {
                    configurable: true,
                    value: false,
                  });
                  document.dispatchEvent(new Event("visibilitychange"));
                });
              }
              release.resolve(null);
              await settled.promise;
              await expect(
                page.getByRole("heading", {
                  exact: true,
                  name: "臨時密碼不能再次顯示",
                })
              ).toBeVisible();
              await page.getByText("操作詳情", { exact: true }).click();
              await expect(
                page
                  .getByRole("status")
                  .filter({ hasText: "伺服器已確認操作完成" })
              ).toContainText("伺服器已確認操作完成");
              await page.evaluate(() => {
                Object.defineProperty(document, "hidden", {
                  configurable: true,
                  value: false,
                });
                document.dispatchEvent(new Event("visibilitychange"));
              });
              await expect(
                page.getByLabel("新臨時密碼", { exact: true })
              ).toHaveCount(0);
              const raw = await page.evaluate(() =>
                localStorage.getItem("efcc.staff-account.operation.v1")
              );
              if (!raw) {
                throw new Error(
                  "Late handover did not retain its operation reference"
                );
              }
              const saved = storedStaffAccountOperationSchema.parse(
                JSON.parse(raw)
              );
              expect(saved).toMatchObject({
                action: {
                  create: "assisted_account_created",
                  reissue: "temporary_password_reissued",
                  reset: "staff_password_reset",
                }[mode],
                actorUserId: staff.userId,
                key: submittedKey,
              });
              expect(raw).not.toContain(issued.temporaryPassword);
              const target = issued.receipt?.targetUserId;
              if (!target) {
                throw new Error(
                  "The committed late response lacked its target"
                );
              }
              expect(
                await caseApp.db
                  .prepare(
                    "SELECT (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = ?) AS audits, (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?) AS receipts"
                  )
                  .bind(
                    target,
                    issued.receipt.action,
                    staff.userId,
                    submittedKey,
                    target
                  )
                  .first<{ audits: number; receipts: number }>()
              ).toEqual({ audits: 1, receipts: 1 });
              await page.reload();
              await expect(page.getByRole("status").first()).toContainText(
                "原臨時密碼不能再次讀取"
              );
              await expect(
                page.getByLabel("新臨時密碼", { exact: true })
              ).toHaveCount(0);
              expect(requests).toBe(1);
            } finally {
              release.resolve(null);
              if (routeStarted) {
                await settled.promise;
              }
              await page.unroute(`**${path}`);
            }
          }
        );
      }
    }
  });
});
