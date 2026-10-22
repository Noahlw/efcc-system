/* eslint-disable no-await-in-loop -- Each reload must observe the prior storage mutation in the same isolated browser session. */
import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import {
  draftLifetime,
  draftStoragePrefix,
} from "../../src/features/account/session-draft";
import type { DraftFlow } from "../../src/features/account/session-draft";
import { dedicatedTest as test, expect } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import {
  applicationInput,
  submitApplication,
} from "./account-decisions/test-helpers";
import { originalIdentity, phone } from "./account-identity/test-helpers";
import { qualifyPresentation } from "./presentation-assertions";

const tags = [
  "@native",
  "@browser",
  "@mobile-critical",
  "@risk-draft",
  "@risk-recovery",
  "@risk-privacy",
  "@risk-freshness",
];
const flows: DraftFlow[] = ["creation", "identity", "applicant"];
const fixture = async (
  flow: DraftFlow,
  page: Page,
  app: NativeApp,
  targetId: string,
  expectSaved = true
) => {
  let actorTarget = targetId;
  if (flow === "applicant") {
    const input = applicationInput();
    await submitApplication(page.request, input);
    const login = await page.request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
      headers: { origin: app.origin },
    });
    expect(login.status()).toBe(200);
    const sessionResponse = await page.request.get("/api/auth/get-session");
    const session = await sessionResponse.json();
    actorTarget = session.user.id;
  }
  let route = "/application";
  if (flow === "creation") {
    route = "/staff/accounts?task=create";
  }
  if (flow === "identity") {
    route = `/staff/accounts?view=people&person=${targetId}&task=identity`;
  }
  await page.goto(route);
  if (flow === "applicant") {
    await page.getByRole("button", { name: /^修正申請資料/u }).click();
  }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const values = {
    email: `draft.${suffix}@example.com`,
    fullName: `陳暫存${suffix}`,
    phone: phone(),
    ...(flow === "applicant"
      ? {}
      : { sharedPhone: false, username: `draft.${suffix}` }),
  };
  const fields = {
    email: page.getByLabel(
      flow === "applicant" ? "電郵地址" : "電郵（沒有電郵可留空）",
      { exact: true }
    ),
    fullName: page.getByLabel("中文全名", { exact: true }),
    phone: page.getByLabel(flow === "identity" ? "修正電話" : "電話", {
      exact: true,
    }),
  };
  await fields.fullName.fill(values.fullName);
  await fields.email.fill(values.email);
  await fields.phone.fill(values.phone);
  if (flow !== "applicant") {
    await page
      .getByLabel("使用者名稱", { exact: true })
      .fill(values.username ?? "");
  }
  const key = `${draftStoragePrefix}${flow}`;
  if (expectSaved) {
    await expect
      .poll(() =>
        page.evaluate(
          (storageKey) =>
            JSON.parse(sessionStorage.getItem(storageKey) ?? "null")?.values,
          key
        )
      )
      .toEqual(values);
  }
  return { actorTarget, fields, key, route, values };
};

for (const flow of flows) {
  for (const savedBeforeFailure of [false, true]) {
    test(
      `${flow}: unavailable draft binding blocks transmission with ${savedBeforeFailure ? "an older" : "no"} saved draft`,
      { tag: tags },
      async ({ staffPage: page, caseApp, account }, testInfo) => {
        await page.addInitScript((blockInitially) => {
          if (blockInitially) {
            document.addEventListener("DOMContentLoaded", () => {
              document.documentElement.dataset.blockDraftWrite = "all";
            });
          }
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function setItem(storageKey, value) {
            if (
              this === sessionStorage &&
              storageKey.startsWith("efcc.draft.v1.") &&
              document.documentElement?.dataset.blockDraftWrite &&
              (document.documentElement.dataset.blockDraftWrite === "all" ||
                JSON.parse(value).values.fullName.endsWith("修改"))
            ) {
              throw new Error("Synthetic draft write failure");
            }
            return original.call(this, storageKey, value);
          };
        }, !savedBeforeFailure);
        const { fields, key, values } = await fixture(
          flow,
          page,
          caseApp,
          account.userId,
          savedBeforeFailure
        );
        if (savedBeforeFailure) {
          await page.evaluate(() => {
            document.documentElement.dataset.blockDraftWrite = "changed";
          });
          await fields.fullName.fill(`${values.fullName}修改`);
        }
        await expect(
          page.getByText(
            "未能暫存草稿；輸入仍在此頁，但重新整理後可能需要重新填寫。",
            { exact: true }
          )
        ).toBeVisible();
        const savedDraft = await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        );
        if (flow === "creation") {
          await page
            .getByLabel("已親身核實此人的身分", { exact: true })
            .check();
        }
        if (flow === "identity") {
          await page
            .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
              exact: true,
            })
            .check();
        }
        await page
          .getByRole("button", {
            exact: true,
            name: /^(?:檢查帳戶資料|檢查修正|檢查更改)$/u,
          })
          .click();
        const commandPath = {
          applicant: "/api/v2/applications/actions",
          creation: "/api/v2/staff/accounts",
          identity: "/api/v2/staff/accounts/identity",
        }[flow];
        let commands = 0;
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === commandPath
          ) {
            commands += 1;
          }
        });
        try {
          await page
            .getByRole("button", {
              exact: true,
              name: /^(?:確認並建立帳戶及發出臨時密碼|確認並提交修正|確認並提交更改)$/u,
            })
            .click();
          await expect(page.getByText(/未能安全/u).first()).toBeVisible();
          expect(commands).toBe(0);
          expect(
            await page.evaluate(
              (storageKey) => sessionStorage.getItem(storageKey),
              key
            )
          ).toBe(savedDraft);
          const operationStorage = {
            applicant: "efcc.applicant.operation.v1",
            creation: "efcc.staff-account.operation.v1",
            identity: "efcc.identity-change.operation.v1",
          }[flow];
          const operation = await page.evaluate(
            (storageKey) =>
              JSON.parse(localStorage.getItem(storageKey) ?? "null"),
            operationStorage
          );
          expect(operation?.key).toEqual(expect.any(String));
          const table = {
            applicant: "applicant_operation",
            creation: "staff_account_operation",
            identity: "account_change_operation",
          }[flow];
          const committed = await caseApp.db
            .prepare(
              `SELECT count(*) AS count FROM ${table} WHERE operation_key = ?`
            )
            .bind(operation.key)
            .first<{ count: number }>();
          expect(committed?.count).toBe(0);

          await page.evaluate(() => {
            delete document.documentElement.dataset.blockDraftWrite;
          });
          const reconcilePath = {
            applicant: "/api/v2/applications/actions/reconcile",
            creation: "/api/v2/staff/accounts/reconcile",
            identity: "/api/v2/account/changes/reconcile",
          }[flow];
          const reconciliation = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname === reconcilePath
          );
          await page
            .getByRole("button", {
              exact: true,
              name:
                flow === "creation"
                  ? "重新查詢"
                  : /^(?:查核之前的操作|重新檢查本機儲存)$/u,
            })
            .click();
          const checked = await reconciliation;
          expect(checked.status()).toBe(200);
          const checkedBody = await checked.json();
          expect(checkedBody.data.receipt).toBeNull();
          expect(commands).toBe(0);
          if (flow === "creation") {
            await page
              .getByRole("button", { exact: true, name: "檢查帳戶資料" })
              .click();
          }
          const confirm = page.getByRole("button", {
            exact: true,
            name: /^(?:確認並建立帳戶及發出臨時密碼|確認並提交修正|確認並提交更改)$/u,
          });
          await expect(confirm).toBeEnabled();
          const response = page.waitForResponse(
            (result) =>
              result.request().method() === "POST" &&
              new URL(result.url()).pathname === commandPath
          );
          await confirm.click();
          const completed = await response;
          expect(completed.status()).toBe(201);
          expect(completed.request().postDataJSON()).toMatchObject({
            fullName: savedBeforeFailure
              ? `${values.fullName}修改`
              : values.fullName,
            operationKey: operation.key,
            phone: values.phone,
          });
          expect(commands).toBe(1);
          const recovered = await caseApp.db
            .prepare(
              `SELECT count(*) AS count FROM ${table} WHERE operation_key = ?`
            )
            .bind(operation.key)
            .first<{ count: number }>();
          expect(recovered?.count).toBe(1);
        } finally {
          await testInfo.attach("command-transmission-observation", {
            body: JSON.stringify({ commands }),
            contentType: "application/json",
          });
        }
      }
    );
  }
}

for (const flow of ["identity", "applicant", "own"] as const) {
  test(
    `${flow}: failed operation metadata readback preserves the original request for explicit retry`,
    { tag: tags },
    async ({ staffPage, signedInPage, caseApp, account }) => {
      const page = flow === "own" ? signedInPage : staffPage;
      let expectedPhone: string;
      if (flow === "own") {
        await page.goto("/account?task=phone");
        expectedPhone = phone();
        await page.getByLabel("新電話", { exact: true }).fill(expectedPhone);
      } else {
        const { values } = await fixture(flow, page, caseApp, account.userId);
        expectedPhone = values.phone;
      }
      if (flow === "identity") {
        await page
          .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
            exact: true,
          })
          .check();
      }
      await page
        .getByRole("button", {
          exact: true,
          name: /^(?:檢查修正|檢查更改|檢查電話)$/u,
        })
        .click();
      const metadataKey =
        flow === "applicant"
          ? "efcc.applicant.operation.v1"
          : "efcc.identity-change.operation.v1";
      await page.evaluate((operationKey) => {
        const originalSet = Storage.prototype.setItem;
        const originalGet = Storage.prototype.getItem;
        document.documentElement.dataset.blockMetadataReadback = "armed";
        Storage.prototype.setItem = function setItem(key, value) {
          originalSet.call(this, key, value);
          if (
            this === localStorage &&
            key === operationKey &&
            document.documentElement.dataset.blockMetadataReadback === "armed"
          ) {
            document.documentElement.dataset.blockMetadataReadback = "written";
          }
        };
        Storage.prototype.getItem = function getItem(key) {
          if (
            this === localStorage &&
            key === operationKey &&
            document.documentElement.dataset.blockMetadataReadback === "written"
          ) {
            throw new Error("Synthetic operation metadata readback failure");
          }
          return originalGet.call(this, key);
        };
      }, metadataKey);
      const commandPath = {
        applicant: "/api/v2/applications/actions",
        identity: "/api/v2/staff/accounts/identity",
        own: "/api/v2/account/phone",
      }[flow];
      let commands = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === commandPath
        ) {
          commands += 1;
        }
      });
      const confirm = page.getByRole("button", {
        exact: true,
        name: /^(?:確認並提交修正|確認並提交更改|確認並儲存電話)$/u,
      });
      await confirm.click();
      await expect(page.getByText(/未能安全/u).first()).toBeVisible();
      expect(commands).toBe(0);
      await page.evaluate(() => {
        delete document.documentElement.dataset.blockMetadataReadback;
      });
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
        metadataKey
      );
      expect(saved?.key).toEqual(expect.any(String));
      const reconciliation = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            (flow === "applicant"
              ? "/api/v2/applications/actions/reconcile"
              : "/api/v2/account/changes/reconcile")
      );
      await page
        .getByRole("button", {
          exact: true,
          name: /^(?:查核之前的操作|查詢上次提交結果|重新檢查本機儲存)$/u,
        })
        .click();
      const checked = await reconciliation;
      expect(checked.status()).toBe(200);
      const checkedBody = await checked.json();
      expect(checkedBody.data.receipt).toBeNull();
      expect(commands).toBe(0);
      await expect(confirm).toBeEnabled();
      const response = page.waitForResponse(
        (result) =>
          result.request().method() === "POST" &&
          new URL(result.url()).pathname === commandPath
      );
      await confirm.click();
      const completed = await response;
      expect(completed.status()).toBe(201);
      expect(completed.request().postDataJSON()).toMatchObject({
        operationKey: saved.key,
        phone: expectedPhone,
      });
      expect(commands).toBe(1);
      const table =
        flow === "applicant"
          ? "applicant_operation"
          : "account_change_operation";
      const committed = await caseApp.db
        .prepare(
          `SELECT count(*) AS count FROM ${table} WHERE operation_key = ?`
        )
        .bind(saved.key)
        .first<{ count: number }>();
      expect(committed?.count).toBe(1);
    }
  );
}

for (const flow of flows) {
  test(
    `${flow}: failed draft removal keeps input and stays on the task until discard can succeed`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account }, testInfo) => {
      const { fields, key, values } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      const taskUrl = page.url();
      const savedDraft = await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        key
      );
      await page.evaluate(() => {
        document.documentElement.dataset.blockDraftClear = "true";
        const original = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function removeItem(storageKey) {
          if (
            this === sessionStorage &&
            storageKey.startsWith("efcc.draft.v1.") &&
            document.documentElement.dataset.blockDraftClear
          ) {
            throw new Error("Synthetic draft removal failure");
          }
          return original.call(this, storageKey);
        };
      });
      const back = page.getByRole("link", {
        exact: true,
        name: {
          applicant: "返回我的申請",
          creation: "返回管理",
          identity: "返回帳戶詳情",
        }[flow],
      });
      await back.click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await expect(
        page.getByText(
          "未能清除暫存草稿；輸入仍在此頁。請恢復瀏覽器儲存後再試。",
          { exact: true }
        )
      ).toBeVisible();
      await expect(page).toHaveURL(taskUrl);
      await expect(fields.fullName).toHaveValue(values.fullName);
      await expect(fields.email).toHaveValue(values.email);
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).toBe(savedDraft);
      await qualifyPresentation(
        page,
        testInfo,
        `${flow}-failed-draft-discard`,
        {
          criticalAction: back,
          drafts: page.locator("input:not([type='password'])"),
          focus: fields.fullName,
        }
      );
      await page.evaluate(() => {
        delete document.documentElement.dataset.blockDraftClear;
      });
      await back.click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await expect(fields.fullName).toHaveCount(0);
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).toBeNull();
    }
  );
}

test(
  "identity: a late original receipt preserves different retry input and saves it after completion",
  { tag: tags },
  async ({ staffPage: page, caseApp, account }) => {
    const { fields, key, values } = await fixture(
      "identity",
      page,
      caseApp,
      account.userId
    );
    await page
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await page.getByRole("button", { exact: true, name: "檢查修正" }).click();
    let commands = 0;
    let checks = 0;
    await page.route("**/api/v2/staff/accounts/identity", async (route) => {
      commands += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/account/changes/reconcile", async (route) => {
      checks += 1;
      if (checks === 1) {
        await route.fulfill({ json: { data: { receipt: null } } });
        return;
      }
      await route.continue();
    });
    await page
      .getByRole("button", { exact: true, name: "確認並提交修正" })
      .click();
    await page.getByRole("button", { exact: true, name: "返回修改" }).click();
    await expect(fields.fullName).toBeEditable();
    const changedName = `${values.fullName}新草稿`;
    await fields.fullName.fill(changedName);
    await page
      .getByRole("button", { exact: true, name: "查核之前的操作" })
      .click();
    await page
      .getByRole("button", { exact: true, name: "保留草稿，繼續核對" })
      .click();
    await expect(fields.fullName).toHaveValue(changedName);
    await expect
      .poll(() =>
        page.evaluate(
          (storageKey) =>
            JSON.parse(sessionStorage.getItem(storageKey) ?? "null")?.values
              .fullName,
          key
        )
      )
      .toBe(changedName);
    expect(commands).toBe(1);
    const committedIdentity = await originalIdentity(caseApp, account.userId);
    expect(committedIdentity.fullName).toBe(values.fullName);
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page
      .getByRole("button", { exact: true, name: "恢復未提交草稿" })
      .click();
    await expect(fields.fullName).toHaveValue(changedName);
    expect(commands).toBe(1);
  }
);

for (const flow of flows) {
  test(
    `${flow}: refresh restores allowlisted input, requires new verification, and clears on confirmed discard`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account }, testInfo) => {
      const { fields, key, values } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      if (flow === "creation") {
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
        await page
          .getByRole("button", { exact: true, name: "檢查帳戶資料" })
          .click();
      } else if (flow === "identity") {
        await page
          .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
            exact: true,
          })
          .check();
        await page
          .getByRole("button", { exact: true, name: "檢查修正" })
          .click();
      } else {
        await page
          .getByRole("button", { exact: true, name: "檢查更改" })
          .click();
      }
      const stored = await page.evaluate(
        (storageKey) =>
          JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
        key
      );
      expect(stored.values).toEqual(values);
      expect(Object.keys(stored)).toEqual([
        "actorUserId",
        "authContext",
        "baseline",
        "savedAt",
        "submittedOperationKey",
        "targetId",
        "version",
        "flow",
        "values",
      ]);
      page.on("dialog", (dialog) => dialog.accept());
      await page.reload();
      await page
        .getByRole("button", { exact: true, name: "恢復未提交草稿" })
        .click();
      await expect(fields.fullName).toHaveValue(values.fullName);
      await expect(fields.email).toHaveValue(values.email);
      await expect(fields.phone).toHaveValue(values.phone);
      if (flow === "creation") {
        await expect(
          page.getByLabel("已親身核實此人的身分", { exact: true })
        ).not.toBeChecked();
      } else if (flow === "identity") {
        await expect(
          page.getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
            exact: true,
          })
        ).not.toBeChecked();
        await expect(
          page.getByRole("radio", { exact: true, name: "親身核實" })
        ).not.toBeChecked();
      }
      await qualifyPresentation(page, testInfo, `${flow}-restored-draft`, {
        criticalAction: page.getByRole("button", {
          exact: true,
          name: /^(?:檢查帳戶資料|檢查修正|檢查更改)$/u,
        }),
        drafts: fields.fullName,
      });
      expect(
        await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
      ).not.toContain(values.fullName);
      await page.reload();
      await page.getByRole("button", { exact: true, name: "放棄草稿" }).click();
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).toBeNull();
      await expect(
        page.getByRole("button", { exact: true, name: "恢復未提交草稿" })
      ).toHaveCount(0);
    }
  );

  test(
    `${flow}: expired, malformed and different-target drafts never restore`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account }) => {
      const { key } = await fixture(flow, page, caseApp, account.userId);
      page.on("dialog", (dialog) => dialog.accept());
      const saved = await page.evaluate(
        (storageKey) =>
          JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
        key
      );
      for (const bad of [
        { ...saved, savedAt: Date.now() - draftLifetime },
        { ...saved, targetId: "another-target" },
        { ...saved, actorUserId: "another-actor" },
        { ...saved, authContext: "another-login" },
        { ...saved, values: { ...saved.values, password: "must-not-restore" } },
      ]) {
        await page.evaluate(
          ({ storageKey, record }) =>
            sessionStorage.setItem(storageKey, JSON.stringify(record)),
          { record: bad, storageKey: key }
        );
        await page.reload();
        await expect(
          page.locator(`[data-draft-recovery="${flow}"]`)
        ).toHaveCount(1);
        await expect
          .poll(() =>
            page.evaluate(
              (storageKey) => sessionStorage.getItem(storageKey),
              key
            )
          )
          .toBeNull();
        await expect(
          page.getByRole("button", { exact: true, name: "恢復未提交草稿" })
        ).toHaveCount(0);
      }
    }
  );

  test(
    `${flow}: storage failure retains live input; logout clears draft without deleting operation metadata`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account }) => {
      const { fields, key, values } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItem(storageKey, value) {
          if (storageKey.startsWith("efcc.draft.v1.")) {
            throw new Error("Synthetic draft storage failure");
          }
          return original.call(this, storageKey, value);
        };
      });
      await fields.fullName.fill(`${values.fullName}修改`);
      await expect(
        page.getByText(
          "未能暫存草稿；輸入仍在此頁，但重新整理後可能需要重新填寫。",
          { exact: true }
        )
      ).toBeVisible();
      await expect(fields.fullName).toHaveValue(`${values.fullName}修改`);
      await page.evaluate(() =>
        localStorage.setItem(
          "efcc.synthetic.operation.sentinel",
          "original-key"
        )
      );
      // Exercise the actual sign-out control, without navigating away through a discard shortcut.
      page.on("dialog", (dialog) => dialog.accept());
      await page.goto("/account");
      await page.route("**/api/auth/sign-out", (route) =>
        route.abort("failed")
      );
      await page.getByRole("button", { exact: true, name: "登出" }).click();
      await expect(
        page.getByRole("button", { exact: true, name: "重試登出" })
      ).toBeVisible();
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).not.toBeNull();
      await page.unroute("**/api/auth/sign-out");
      await page.getByRole("button", { exact: true, name: "重試登出" }).click();
      await expect(page).toHaveURL(/\/sign-in/u);
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).toBeNull();
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.synthetic.operation.sentinel")
        )
      ).toBe("original-key");
    }
  );

  for (const markerUnavailable of [false, true]) {
    test(
      markerUnavailable
        ? `${flow}: confirmed logout clears its own draft when the auth marker is unavailable`
        : `${flow}: committed logout with a lost response clears another tab's draft after session recheck`,
      { tag: tags },
      async ({ staffPage: pageA, caseApp, account }) => {
        const { key } = await fixture(flow, pageA, caseApp, account.userId);
        const operationMetadata = `logout-${randomUUID()}`;
        await pageA.evaluate((value) => {
          localStorage.setItem("efcc.synthetic.operation.sentinel", value);
        }, operationMetadata);

        const pageB = markerUnavailable
          ? pageA
          : await pageA.context().newPage();
        expect(pageB.context()).toBe(pageA.context());
        await pageB.goto("/account");
        if (markerUnavailable) {
          expect(
            await pageB.evaluate(
              (storageKey) => sessionStorage.getItem(storageKey),
              key
            )
          ).not.toBeNull();
          await pageB.evaluate(() => {
            const descriptor = Object.getOwnPropertyDescriptor(
              Document.prototype,
              "cookie"
            );
            if (!descriptor?.get || !descriptor.set) {
              throw new Error(
                "The native document.cookie accessor is unavailable"
              );
            }
            const getCookie = descriptor.get;
            Object.defineProperty(document, "cookie", {
              configurable: true,
              get: () => getCookie.call(document),
              set: () => {
                throw new Error("Synthetic auth marker write failure");
              },
            });
          });
        }

        let logoutStatus = 0;
        let logoutSetCookie = false;
        await pageB.route("**/api/auth/sign-out", async (route) => {
          try {
            const original = route.request();
            const url = original.url();
            const headers = new Headers(await original.allHeaders());
            if (!headers.has("cookie")) {
              const cookies = await pageB.context().cookies(url);
              headers.set(
                "cookie",
                cookies.map(({ name, value }) => `${name}=${value}`).join("; ")
              );
            }
            expect(headers.get("cookie")).toBeTruthy();
            const response = await caseApp.fetch(
              url,
              new Request(url, {
                body: original.postData() ?? undefined,
                headers,
                method: original.method(),
              })
            );
            logoutStatus = response.status;
            logoutSetCookie = response.headers.has("set-cookie");
            await response.arrayBuffer();
          } finally {
            // Keep the committed response and its Set-Cookie out of the browser jar.
            await route.abort("failed");
          }
        });

        let fallbackSession: { body: unknown; status: number } | null = null;
        await pageB.route("**/api/auth/get-session", async (route) => {
          const response = await route.fetch();
          fallbackSession = {
            body: await response.json(),
            status: response.status(),
          };
          await route.fulfill({ response });
        });
        await pageB.getByRole("button", { exact: true, name: "登出" }).click();
        await expect
          .poll(() => fallbackSession)
          .toEqual({ body: null, status: 200 });
        expect(logoutStatus).toBe(200);
        expect(logoutSetCookie).toBe(true);
        await expect(pageB).toHaveURL(/\/sign-in/u);

        if (markerUnavailable) {
          await expect
            .poll(() =>
              pageB.evaluate(
                (storageKey) => sessionStorage.getItem(storageKey),
                key
              )
            )
            .toBeNull();
        } else {
          await pageA.bringToFront();
          if (
            (await pageA.evaluate(
              (storageKey) => sessionStorage.getItem(storageKey),
              key
            )) !== null
          ) {
            await pageA.evaluate(() =>
              window.dispatchEvent(new Event("focus"))
            );
          }
          await expect
            .poll(() =>
              pageA.evaluate(
                (storageKey) => sessionStorage.getItem(storageKey),
                key
              )
            )
            .toBeNull();
        }
        expect(
          await pageB.evaluate(() =>
            localStorage.getItem("efcc.synthetic.operation.sentinel")
          )
        ).toBe(operationMetadata);
      }
    );
  }
}

for (const flow of flows) {
  test(
    `${flow}: operation-metadata failure preserves a recoverable draft and sends no command`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account }) => {
      const { fields, key, values } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      if (flow === "creation") {
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
      }
      if (flow === "identity") {
        await page
          .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
            exact: true,
          })
          .check();
      }
      await page
        .getByRole("button", {
          exact: true,
          name: /^(?:檢查帳戶資料|檢查修正|檢查更改)$/u,
        })
        .click();
      const commandPath = {
        applicant: "/api/v2/applications/actions",
        creation: "/api/v2/staff/accounts",
        identity: "/api/v2/staff/accounts/identity",
      }[flow];
      let commands = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === commandPath
        ) {
          commands += 1;
        }
      });
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function setItem(storageKey, value) {
          if (this === localStorage && storageKey.startsWith("efcc.")) {
            throw new Error("Synthetic operation metadata failure");
          }
          return original.call(this, storageKey, value);
        };
      });
      await page
        .getByRole("button", {
          exact: true,
          name: /^(?:確認並建立帳戶及發出臨時密碼|確認並提交修正|確認並提交更改)$/u,
        })
        .click();
      await expect(page.getByText(/未能安全/u).first()).toBeVisible();
      expect(commands).toBe(0);
      const stored = await page.evaluate(
        (storageKey) =>
          JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
        key
      );
      expect(stored.values).toEqual(values);
      expect(stored.submittedOperationKey).toBeNull();
      page.on("dialog", (dialog) => dialog.accept());
      await page.reload();
      await page
        .getByRole("button", { exact: true, name: "恢復未提交草稿" })
        .click();
      await expect(fields.fullName).toHaveValue(values.fullName);
    }
  );
}

for (const flow of ["identity", "applicant"] as const) {
  test(
    `${flow}: refresh recovery detects an actual competing D1 update and preserves the old draft until authorised refresh succeeds`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account, staff }) => {
      const { actorTarget, fields, key, values } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      const original = await originalIdentity(caseApp, actorTarget);
      const changed = await staff.context.post(
        "/api/v2/staff/accounts/identity",
        {
          data: {
            email: original.email,
            fullName: "陳其他職員更新",
            identityCheck: "face_to_face",
            operationKey: randomUUID(),
            original,
            phone: phone(),
            sharedPhone: false,
            targetUserId: actorTarget,
            username: original.username,
          },
        }
      );
      expect(changed.status()).toBe(201);
      page.on("dialog", (dialog) => dialog.accept());
      await page.reload();
      await page
        .getByRole("button", { exact: true, name: "恢復未提交草稿" })
        .click();
      await expect(fields.fullName).toHaveValue(values.fullName);
      await expect(
        page.getByText("資料已更新，請重新載入", { exact: true })
      ).toBeVisible();
      await page
        .getByRole("button", { exact: true, name: "重新載入最新資料" })
        .click();
      await page.getByRole("button", { exact: true, name: "繼續編輯" }).click();
      await expect(fields.fullName).toHaveValue(values.fullName);
      await page.route(
        flow === "identity"
          ? "**/api/v2/staff/accounts/identity?**"
          : "**/api/v2/applications/mine",
        (route) => route.abort("failed")
      );
      await page
        .getByRole("button", { exact: true, name: "重新載入最新資料" })
        .click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await expect(
        page.getByText("未能載入最新資料，原草稿已保留；請稍後再次重新載入。", {
          exact: true,
        })
      ).toBeVisible();
      await expect(fields.fullName).toHaveValue(values.fullName);
      await page.unrouteAll({ behavior: "wait" });
      const savedDraft = await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        key
      );
      await page.evaluate(() => {
        document.documentElement.dataset.blockDraftClear = "true";
        const originalRemove = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function removeItem(storageKey) {
          if (
            this === sessionStorage &&
            storageKey.startsWith("efcc.draft.v1.") &&
            document.documentElement.dataset.blockDraftClear
          ) {
            throw new Error("Synthetic draft removal failure");
          }
          return originalRemove.call(this, storageKey);
        };
      });
      await page
        .getByRole("button", { exact: true, name: "重新載入最新資料" })
        .click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await expect(
        page.getByText(
          "未能清除暫存草稿；輸入仍在此頁。請恢復瀏覽器儲存後再試。",
          { exact: true }
        )
      ).toBeVisible();
      await expect(fields.fullName).toHaveValue(values.fullName);
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).toBe(savedDraft);
      await page.evaluate(() => {
        delete document.documentElement.dataset.blockDraftClear;
      });
      await page
        .getByRole("button", { exact: true, name: "重新載入最新資料" })
        .click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await expect(fields.fullName).toHaveValue("陳其他職員更新");
      expect(
        await page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key
        )
      ).toBeNull();
      const finalIdentity = await originalIdentity(caseApp, actorTarget);
      expect(finalIdentity.fullName).toBe("陳其他職員更新");
    }
  );
}

for (const flow of flows) {
  test(
    `${flow}: a lost response and refresh recover the original receipt without replaying a saved draft`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account }) => {
      const { fields, key, values } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      if (flow === "creation") {
        await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
      }
      if (flow === "identity") {
        await page
          .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
            exact: true,
          })
          .check();
      }
      await expect(fields.fullName).toHaveValue(values.fullName);
      await page
        .getByRole("button", {
          exact: true,
          name: /^(?:檢查帳戶資料|檢查修正|檢查更改)$/u,
        })
        .click();
      const commandPaths = {
        applicant: "/api/v2/applications/actions",
        creation: "/api/v2/staff/accounts",
        identity: "/api/v2/staff/accounts/identity",
      };
      const reconcilePaths = {
        applicant: "/api/v2/applications/actions/reconcile",
        creation: "/api/v2/staff/accounts/reconcile",
        identity: "/api/v2/account/changes/reconcile",
      };
      const arrived = Promise.withResolvers<boolean>();
      const release = Promise.withResolvers<boolean>();
      let commands = 0;
      let operationKey = "";
      await page.route(
        (url) => url.pathname === commandPaths[flow],
        async (route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          commands += 1;
          ({ operationKey } = route.request().postDataJSON());
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          await route.abort("failed");
        }
      );
      await page.route(
        (url) => url.pathname === reconcilePaths[flow],
        async (route) => {
          arrived.resolve(true);
          await release.promise;
          try {
            await route.continue();
          } catch {
            // Reload intentionally cancels the old document's reconciliation.
          }
        }
      );
      try {
        await page
          .getByRole("button", {
            exact: true,
            name: /^(?:確認並建立帳戶及發出臨時密碼|確認並提交修正|確認並提交更改)$/u,
          })
          .click();
        await arrived.promise;
        const linked = await page.evaluate(
          (storageKey) =>
            JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
          key
        );
        expect(linked.submittedOperationKey).toBe(operationKey);
        expect(linked.values).toEqual(values);
        page.on("dialog", (dialog) => dialog.accept());
        await page.reload();
        await expect(
          page.getByRole("button", { exact: true, name: "恢復未提交草稿" })
        ).toHaveCount(0);
        expect(commands).toBe(1);
        release.resolve(true);
        await expect
          .poll(() =>
            page.evaluate(
              (storageKey) => sessionStorage.getItem(storageKey),
              key
            )
          )
          .toBeNull();
        expect(commands).toBe(1);
        const table = {
          applicant: "applicant_operation",
          creation: "staff_account_operation",
          identity: "account_change_operation",
        }[flow];
        const committed = await caseApp.db
          .prepare(
            `SELECT count(*) AS count FROM ${table} WHERE operation_key = ?`
          )
          .bind(operationKey)
          .first<{ count: number }>();
        expect(committed?.count).toBe(1);
        await expect(
          page.getByRole("button", { exact: true, name: "恢復未提交草稿" })
        ).toHaveCount(0);
        if (flow === "creation") {
          await page.evaluate(() => {
            const { removeItem: originalRemoveItem } = Storage.prototype;
            document.documentElement.dataset.blockDraftClear = "true";
            Storage.prototype.removeItem = function removeItem(storageKey) {
              if (
                this === sessionStorage &&
                storageKey.startsWith("efcc.draft.v1.") &&
                document.documentElement.dataset.blockDraftClear
              ) {
                throw new Error("Synthetic draft cleanup failure");
              }
              return originalRemoveItem.call(this, storageKey);
            };
          });
          await page
            .getByRole("button", { exact: true, name: "建立下一位會友" })
            .click();
          await expect(page.getByRole("alert")).toHaveText(
            "未能清除暫存草稿；請恢復瀏覽器儲存後重試。"
          );
          expect(
            await page.evaluate(
              () =>
                JSON.parse(
                  localStorage.getItem("efcc.staff-account.operation.v1") ??
                    "null"
                )?.key
            )
          ).toBe(operationKey);
          await page.evaluate(() => {
            delete document.documentElement.dataset.blockDraftClear;
          });
          await page
            .getByRole("button", { exact: true, name: "建立下一位會友" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "檢查帳戶資料" })
          ).toBeEnabled();
          await fields.fullName.fill("陳下一位草稿");
          await expect
            .poll(() =>
              page.evaluate(
                (storageKey) =>
                  JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
                    ?.values.fullName,
                key
              )
            )
            .toBe("陳下一位草稿");
          expect(commands).toBe(1);
        }
      } finally {
        release.resolve(true);
        await page.unrouteAll({ behavior: "wait" });
      }
    }
  );
}

for (const flow of flows) {
  test(
    `${flow}: actual authority loss on reload clears stored draft and withholds its fields`,
    { tag: tags },
    async ({ staffPage: page, caseApp, account, staff }) => {
      const { actorTarget, fields, key } = await fixture(
        flow,
        page,
        caseApp,
        account.userId
      );
      await (flow === "applicant"
        ? caseApp.db
            .prepare(
              "UPDATE person_profile SET banned_at=unixepoch() WHERE user_id=?"
            )
            .bind(actorTarget)
            .run()
        : caseApp.db
            .prepare(
              "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
            )
            .bind(staff.userId)
            .run());
      page.on("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(fields.fullName).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key)
        )
        .toBeNull();
      await expect(
        page.getByRole("button", { exact: true, name: "恢復未提交草稿" })
      ).toHaveCount(0);
    }
  );
}

test(
  "the active thirty-minute expiry removes persistence without erasing live form input",
  { tag: tags },
  async ({ staffPage: page, caseApp, account }) => {
    await page.clock.install();
    const { fields, key, values } = await fixture(
      "creation",
      page,
      caseApp,
      account.userId
    );
    await page.clock.fastForward(draftLifetime);
    expect(
      await page.evaluate(
        (storageKey) => sessionStorage.getItem(storageKey),
        key
      )
    ).toBeNull();
    await expect(fields.fullName).toHaveValue(values.fullName);
    await expect(
      page.getByText("暫存草稿已到期；此頁現有輸入仍會保留。", { exact: true })
    ).toBeVisible();
  }
);
