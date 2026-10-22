import { randomUUID } from "node:crypto";

import {
  deletionReceiptResponseSchema,
  deletionRequestSchema,
  storedDeletionOperationSchema,
} from "../../../src/features/account/deletion/deletion-contract";
import type {
  DeletionReceipt,
  DeletionRequest,
} from "../../../src/features/account/deletion/deletion-contract";
import { expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import {
  expectStatus,
  deletionReceipt,
  deletionTest,
  dedicatedDeletionTest,
} from "./fixtures";

deletionTest.describe(
  "eligible account deletion",
  { tag: ["@native", "@deletion"] },
  () => {
    dedicatedDeletionTest(
      "browser deletion keeps drafts and focus through UNKNOWN, retries the same key, then reconciles the disappeared target",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-recovery",
          "@risk-privacy",
          "@risk-actor-target-key",
        ],
      },
      async ({ caseApp, staffPage: page, approvedMember, staff }, testInfo) => {
        await page.goto(
          `/staff/accounts?view=people&person=${approvedMember.userId}&task=deletion`
        );
        const region = page.getByRole("region", { name: "永久刪除帳戶" });
        const acknowledgement = region.getByRole("checkbox");
        const review = region.getByRole("region", {
          exact: true,
          name: "核對永久刪除",
        });
        const finalSubmit = region.getByRole("button", {
          name: "確認並永久刪除",
        });
        await expect(
          region.getByRole("button", { exact: true, name: "檢查刪除資料" })
        ).toBeEnabled();
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await acknowledgement.check();
        await page
          .getByRole("link", { exact: true, name: "返回帳戶詳情" })
          .click();
        const leaveDialog = page.getByRole("dialog");
        await expect(leaveDialog).toBeVisible();
        await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
        await expect(acknowledgement).toBeChecked();
        await page
          .getByRole("link", { exact: true, name: "返回帳戶詳情" })
          .click();
        await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
        await expect(
          page.getByRole("link", { name: /永久刪除帳戶/u })
        ).toBeHidden();
        await page.getByText("其他操作", { exact: true }).click();
        await page.getByRole("link", { name: /永久刪除帳戶/u }).click();
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await expect(acknowledgement).not.toBeChecked();
        await acknowledgement.check();
        await expect(review).toBeVisible();
        await expect(finalSubmit).toBeEnabled();
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth
          )
        ).toBe(true);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await qualifyPresentation(page, testInfo, "deletion-review", {
          criticalAction: finalSubmit,
          drafts: acknowledgement,
          focus: acknowledgement,
        });

        let reconciliationChecks = 0;
        let requests = 0;
        let serverDeletions = 0;
        const committedReceipts: DeletionReceipt[] = [];
        const submittedInputs: DeletionRequest[] = [];
        await page.route("**/api/v2/staff/accounts/delete", async (route) => {
          requests += 1;
          const input = deletionRequestSchema.parse(
            route.request().postDataJSON()
          );
          submittedInputs.push(input);
          if (requests === 1) {
            await route.abort("failed");
            return;
          }
          serverDeletions += 1;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          committedReceipts.push(await deletionReceipt(response));
          await route.abort("failed");
        });
        await page.route(
          "**/api/v2/account/changes/reconcile",
          async (route) => {
            reconciliationChecks += 1;
            if (reconciliationChecks === 1) {
              await route.abort("failed");
              return;
            }
            await route.continue();
          }
        );
        await finalSubmit.click();
        await expect(region.getByRole("status")).toContainText("結果仍未確認");
        expect(reconciliationChecks).toBe(1);
        expect(requests).toBe(1);
        expect(serverDeletions).toBe(0);
        await expectStatus(approvedMember.context.get("/api/v2/me"), 200);
        const accountBeforeRetry = await caseApp.db
          .prepare("SELECT id FROM user WHERE id = ?")
          .bind(approvedMember.userId)
          .all<{ id: string }>();
        expect(accountBeforeRetry.results).toHaveLength(1);
        const rawSaved = await page.evaluate(() =>
          localStorage.getItem("efcc.deletion.operation.v1")
        );
        if (!rawSaved) {
          throw new Error("UNKNOWN deletion did not preserve its original key");
        }
        const savedOperation = storedDeletionOperationSchema.safeParse(
          JSON.parse(rawSaved)
        );
        if (!savedOperation.success) {
          throw new Error("UNKNOWN deletion stored invalid operation metadata");
        }
        const saved = savedOperation.data;
        expect(Object.keys(saved).toSorted()).toEqual([
          "action",
          "actorUserId",
          "key",
          "targetUserId",
        ]);
        expect(saved).toEqual({
          action: "account_deleted",
          actorUserId: staff.userId,
          key: saved.key,
          targetUserId: approvedMember.userId,
        });
        await region.getByRole("button", { name: "查核之前的操作" }).click();
        await expect(region.getByRole("status")).toContainText(
          "尚未找到完成紀錄"
        );
        expect(reconciliationChecks).toBe(2);
        await expect(
          region.getByRole("button", { name: "重試同一刪除操作" })
        ).toBeEnabled();
        await region.getByRole("button", { name: "重試同一刪除操作" }).click();
        await expect(region.getByRole("status")).toContainText("伺服器已確認");
        await expect(region.getByRole("status")).toContainText(
          approvedMember.userId
        );
        expect(reconciliationChecks).toBe(3);
        expect(requests).toBe(2);
        expect(serverDeletions).toBe(1);
        expect(submittedInputs).toEqual([
          { operationKey: saved.key, targetUserId: approvedMember.userId },
          { operationKey: saved.key, targetUserId: approvedMember.userId },
        ]);
        expect(committedReceipts).toHaveLength(1);
        const [committedReceipt] = committedReceipts;
        if (!committedReceipt) {
          throw new Error(
            "The actual deletion response did not contain its receipt"
          );
        }
        expect(committedReceipt).toMatchObject({
          action: "account_deleted",
          targetUserId: approvedMember.userId,
        });
        await expectStatus(approvedMember.context.get("/api/v2/me"), 401);
        const durableReceipt = await caseApp.db
          .prepare(
            "SELECT id, action, target_user_id, created_at FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, saved.key)
          .first<{
            action: string;
            created_at: number;
            id: string;
            target_user_id: string;
          }>();
        expect(durableReceipt).toEqual({
          action: committedReceipt.action,
          created_at: committedReceipt.createdAt,
          id: committedReceipt.id,
          target_user_id: approvedMember.userId,
        });
        const reconciled = await expectStatus(
          staff.context.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: saved.key },
          }),
          200
        );
        expect(
          deletionReceiptResponseSchema.parse(await reconciled.json()).data
            .receipt
        ).toEqual(committedReceipt);
        await page.reload();
        await expect(region.getByRole("status")).toContainText("伺服器已確認");
        await expect(region.getByRole("status")).toContainText(
          approvedMember.userId
        );
        await page.unrouteAll();
        await page.goto("/staff/account-audit");
        const auditRow = page
          .getByRole("listitem")
          .filter({
            has: page.locator(`span[title="${approvedMember.userId}"]`),
          })
          .filter({ hasText: "永久刪除帳戶" });
        await expect(
          auditRow.getByRole("link", { name: /^永久刪除帳戶/u })
        ).toBeVisible();
        await auditRow.getByRole("link").click();
        const auditDetail = page.getByRole("region", { name: "帳戶紀錄詳情" });
        await expect(
          auditDetail.getByText(approvedMember.userId, { exact: true })
        ).toBeVisible();
        await expect(page.getByRole("main").locator("time")).toContainText(
          "香港"
        );
        await expect(
          page.getByRole("link", { name: "返回帳戶紀錄" })
        ).toBeVisible();
        const deletionAudit = await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
          )
          .bind(approvedMember.userId)
          .all<{ id: string }>();
        expect(deletionAudit.results).toHaveLength(1);
      }
    );

    deletionTest(
      "browser deletion requires in-task password confirmation and a separate explicit final submit",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-security",
          "@risk-privacy",
        ],
      },
      async (
        { caseApp, account, staffPage: page, signedInRequest, staff },
        testInfo
      ) => {
        await caseApp.db
          .prepare(
            "UPDATE session SET password_confirmed_at = 0 WHERE user_id = ?"
          )
          .bind(staff.userId)
          .run();

        await page.goto(
          `/staff/accounts?view=people&person=${account.userId}&task=deletion`
        );
        const region = page.getByRole("region", { name: "永久刪除帳戶" });
        const acknowledgement = region.getByRole("checkbox");
        const finalSubmit = region.getByRole("button", {
          name: "確認並永久刪除",
        });
        let deletionPosts = 0;
        const submittedInputs: DeletionRequest[] = [];
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            request.url().endsWith("/api/v2/staff/accounts/delete")
          ) {
            deletionPosts += 1;
            submittedInputs.push(
              deletionRequestSchema.parse(request.postDataJSON())
            );
          }
        });
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await acknowledgement.check();
        await expect(
          region.getByRole("region", { exact: true, name: "核對永久刪除" })
        ).toBeVisible();
        expect(deletionPosts).toBe(0);
        await finalSubmit.click();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByRole("heading", { exact: true, name: "確認目前密碼" })
        ).toBeVisible();
        expect(deletionPosts).toBe(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await dialog
          .getByLabel("目前密碼", { exact: true })
          .fill(staff.account.password);
        await dialog
          .getByRole("button", { exact: true, name: "確認並返回檢查" })
          .click();
        await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
        await dialog
          .getByRole("button", { exact: true, name: "確認並返回檢查" })
          .click();
        await expect(
          region.getByRole("region", { exact: true, name: "核對永久刪除" })
        ).toBeVisible();
        expect(deletionPosts).toBe(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await expect(acknowledgement).toBeChecked();
        await qualifyPresentation(page, testInfo, "deletion-confirmation", {
          criticalAction: finalSubmit,
          drafts: acknowledgement,
          focus: acknowledgement,
        });
        await finalSubmit.click();
        await expect(region.getByRole("status")).toContainText("伺服器已確認");
        await expect(region.getByRole("status")).toContainText(account.userId);
        expect(deletionPosts).toBe(1);
        expect(submittedInputs).toHaveLength(1);
        expect(submittedInputs[0]?.targetUserId).toBe(account.userId);
        expect(
          await caseApp.db
            .prepare("SELECT id FROM user WHERE id = ?")
            .bind(account.userId)
            .first<{ id: string }>()
        ).toBeNull();
        expect(
          await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
            )
            .bind(account.userId)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });
        await expectStatus(signedInRequest.get("/api/v2/me"), 401);
      }
    );

    dedicatedDeletionTest(
      "history denial keeps the member active and links the same target to deactivation",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-atomicity",
          "@risk-privacy",
        ],
      },
      async (
        { caseApp, account, staffPage: page, signedInRequest },
        testInfo
      ) => {
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id, name, created_at) VALUES(?, ?, CAST(strftime('%s', 'now') AS INTEGER))"
          )
          .bind(departmentId, "Synthetic history")
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department_membership(id, department_id, user_id, created_at) VALUES(?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))"
          )
          .bind(randomUUID(), departmentId, account.userId)
          .run();

        await page.goto(
          `/staff/accounts?view=people&person=${account.userId}&task=deletion`
        );
        const region = page.getByRole("region", { name: "永久刪除帳戶" });
        const acknowledgement = region.getByRole("checkbox");
        const deactivation = page.getByRole("link", {
          name: "改為停用會籍",
        });
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await acknowledgement.check();
        await expect(
          region.getByRole("region", { exact: true, name: "核對永久刪除" })
        ).toBeVisible();
        await region.getByRole("button", { name: "確認並永久刪除" }).click();
        await expect(region.getByRole("status")).toContainText(
          "有教會業務紀錄，不能永久刪除"
        );
        await expect(
          region.getByRole("button", { name: "確認並永久刪除" })
        ).toBeDisabled();
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await expectStatus(signedInRequest.get("/api/v2/me"), 200);
        await qualifyPresentation(page, testInfo, "deletion-history", {
          criticalAction: deactivation,
          drafts: acknowledgement,
          focus: deactivation,
        });
        await deactivation.click();
        const leaveDialog = page.getByRole("dialog");
        await expect(leaveDialog).toBeVisible();
        await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
        await expect(page).toHaveURL(/task=restrictions/u);
        await expect(
          page.getByRole("region", { name: "會籍與安全限制" })
        ).toBeVisible();
        expect(
          await caseApp.db
            .prepare(
              "SELECT membership_status FROM person_profile WHERE user_id = ?"
            )
            .bind(account.userId)
            .first<{ membership_status: string }>()
        ).toEqual({ membership_status: "active" });
      }
    );
  }
);

dedicatedDeletionTest(
  "deletion review outside the bounded directory preserves frozen target and dirty return page",
  {
    tag: [
      "@native",
      "@deletion",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-recovery",
      "@risk-actor-target-key",
    ],
  },
  async ({ caseApp, staff, staffPage: page, approvedMember }) => {
    const suffix = randomUUID().slice(0, 8);
    const query = `一刪除返回${suffix}`;
    await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        caseApp.provision.account({
          email: `bounded.delete.${suffix}.${index}@example.invalid`,
          fullName: `${query}${String(index).padStart(2, "0")}`,
          membershipStatus: "active",
          password: "Synthetic-bounded-deletion-password!",
          username: `bounded.delete.${suffix}.${index}`,
        })
      )
    );
    const listed = await expectStatus(
      staff.context.get(
        `/api/v2/staff/accounts?${new URLSearchParams({ q: query })}`
      ),
      200
    );
    const directory = await listed.json();
    expect(directory.data.accounts).toHaveLength(25);
    expect(
      directory.data.accounts.some(
        (entry: { userId: string }) => entry.userId === approvedMember.userId
      )
    ).toBe(false);
    const params = new URLSearchParams({
      page: "2",
      person: approvedMember.userId,
      q: query,
      task: "deletion",
      view: "people",
    });
    await page.goto(`/staff/accounts?${params}`);
    const region = page.getByRole("region", { name: "永久刪除帳戶" });
    await region
      .getByRole("button", { exact: true, name: "檢查刪除資料" })
      .click();
    const review = region.getByRole("region", {
      exact: true,
      name: "核對永久刪除",
    });
    await expect(review).toContainText(approvedMember.fullName);
    const acknowledgement = region.getByRole("checkbox");
    await acknowledgement.check();
    const frozen = await review.textContent();
    const back = page.getByRole("link", { exact: true, name: "返回帳戶詳情" });
    await back.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(acknowledgement).toBeChecked();
    expect(await review.textContent()).toBe(frozen);
    await back.click();
    await dialog.getByRole("button", { name: "放棄變更" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("page") === "2" &&
        url.searchParams.get("q") === query &&
        url.searchParams.get("person") === approvedMember.userId &&
        !url.searchParams.has("task")
    );
    await expect(page.getByRole("region", { name: "操作對象" })).toContainText(
      approvedMember.fullName
    );
    await page.getByRole("link", { exact: true, name: "返回帳戶列表" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("page") === "2" &&
        url.searchParams.get("q") === query &&
        !url.searchParams.has("person")
    );
    await expect(page.locator("main a[href*='person=']")).toHaveCount(1);
    expect(
      await caseApp.db
        .prepare(
          "SELECT count(*) AS count FROM account_change_operation WHERE target_user_id = ? AND action = 'account_deleted'"
        )
        .bind(approvedMember.userId)
        .first<{ count: number }>()
    ).toEqual({ count: 0 });
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.deletion.operation.v1")
      )
    ).toBeNull();
  }
);
