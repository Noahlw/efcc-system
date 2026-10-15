/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */

import type { APIResponse } from "@playwright/test";

import { storedStaffAccountOperationSchema } from "../../../src/features/account/assisted-accounts/staff-account-contract";
import { expect, test } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import {
  expectResponseStatus,
  staffData,
  issuedCredential,
  creation,
  credentialRow,
  creationEffects,
  creationDrafts,
  recoveryDrafts,
  dedicatedTest,
} from "./fixtures";

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
          if (routeStarted) {
            await settled.promise;
          }
          await page.unroute("**/api/v2/staff/accounts");
        }
        if (!response) {
          throw new Error(
            "Committed account creation response was not observed"
          );
        }
        const issuance = issuedCredential(await staffData(response));
        expect(requests).toBe(1);
        const output = page.getByLabel("新臨時密碼", { exact: true });
        await expect(output).toBeVisible();
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
