import { randomUUID } from "node:crypto";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import { confirmRoleTaskPassword, openRoleTask } from "./role-navigation";

interface Candidate {
  fullName: string;
  userId: string;
  username: string;
}
interface BatchScope {
  actor: {
    fullName: string;
    password: string;
    username: string;
    userId: string;
  };
  departmentId: string;
  authorityAssignmentId: string;
  programId: string;
  programName: string;
  candidates: Candidate[];
}

const seedCandidates = async (
  app: NativeApp,
  departmentId: string,
  suffix: string,
  index = 0
): Promise<Candidate[]> => {
  if (index === 27) {
    return [];
  }
  const candidate = {
    email: `batch.person.${suffix}.${index}@example.com`,
    fullName: `陳批次候選人${String(index).padStart(2, "0")}${suffix}`,
    membershipStatus: "active" as const,
    password: "Synthetic-batch-person-password!",
    role: "member" as const,
    username: `batch.person.${suffix}.${index}`,
  };
  const userId = await app.provision.account(candidate);
  await app.db
    .prepare(
      "INSERT INTO department_membership(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(randomUUID(), departmentId, userId)
    .run();
  return [
    { fullName: candidate.fullName, userId, username: candidate.username },
    ...(await seedCandidates(app, departmentId, suffix, index + 1)),
  ];
};

const batchTest = dedicatedTest.extend<{
  scope: BatchScope;
  actorRole: "admin" | "member" | "staff";
}>({
  actorRole: ["member", { option: true }],
  scope: async ({ caseApp, actorRole }, use) => {
    const suffix = randomUUID().slice(0, 8);
    const actor = {
      email: `batch.manager.${suffix}@example.com`,
      fullName: `陳批次部門主管${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-batch-manager-password!",
      role: actorRole,
      username: `batch.manager.${suffix}`,
    };
    const userId = await caseApp.provision.account(actor);
    const departmentId = randomUUID();
    const programId = randomUUID();
    const authorityAssignmentId = randomUUID();
    const programName = `很長的聚會名稱批次選取及放大文字${suffix}`;
    await caseApp.db
      .prepare(
        "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
      )
      .bind(departmentId, `批次部門${suffix}`)
      .run();
    await caseApp.db
      .prepare(
        "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(programId, departmentId, programName)
      .run();
    await caseApp.db
      .prepare(
        "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(authorityAssignmentId, departmentId, userId)
      .run();
    const candidates = await seedCandidates(caseApp, departmentId, suffix);
    await use({
      actor: { ...actor, userId },
      authorityAssignmentId,
      candidates,
      departmentId,
      programId,
      programName,
    });
  },
});

const openPicker = async (
  browser: Browser,
  app: NativeApp,
  scope: BatchScope,
  extraHTTPHeaders: Record<string, string> | undefined,
  authorityKind:
    | "admin"
    | "role_assigner"
    | "department_manager" = "department_manager"
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({
    baseURL: app.origin,
    extraHTTPHeaders,
  });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page
    .getByRole("textbox", { name: "Username" })
    .fill(scope.actor.username);
  await page
    .getByRole("textbox", { exact: true, name: "密碼" })
    .fill(scope.actor.password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
  if (authorityKind === "department_manager") {
    await page.goto(
      `/roles/program-leaders?department=${scope.departmentId}&program=${scope.programId}`
    );
  } else {
    await page.goto("/roles/people");
    await page
      .getByRole("button", { exact: true, name: "按聚會指派負責人" })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/roles/program-leaders" &&
        url.searchParams.get("authority") === authorityKind
    );
    await page
      .getByRole("button", {
        exact: true,
        name: `管理${scope.programName}的負責人`,
      })
      .click();
    await expect(
      page.getByRole("heading", { exact: true, name: scope.programName })
    ).toBeVisible();
  }
  await page.getByRole("button", { exact: true, name: "指派負責人" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "指派負責人" })
  ).toBeVisible();
  return { context, page };
};

const search = async (page: Page, query: string) => {
  await page.getByRole("textbox", { name: "搜尋會友" }).fill(query);
  await page.getByRole("button", { exact: true, name: "搜尋會友" }).click();
};
const toggle = (page: Page, person: Candidate) =>
  page.getByRole("button", {
    exact: true,
    name: `選取${person.fullName} · ${person.username}`,
  });

const personAt = (scope: BatchScope, index: number): Candidate => {
  const person = scope.candidates.at(index);
  if (!person) {
    throw new Error("Expected a synthetic candidate");
  }
  return person;
};
const selectPair = async (page: Page, scope: BatchScope) => {
  const first = personAt(scope, 0);
  const second = personAt(scope, 1);
  await search(page, first.username);
  await toggle(page, first).click();
  await search(page, second.username);
  await toggle(page, second).click();
  await page.getByRole("button", { exact: true, name: "已選 2 位" }).click();
  return { first, second };
};
const confirmProof = async (context: BrowserContext, scope: BatchScope) => {
  const response = await context.request.post(
    "/api/v2/account/password-confirmation",
    {
      data: { operationKey: randomUUID(), password: scope.actor.password },
    }
  );
  expect(response.status()).toBe(201);
};

const addIndependentManagedProgram = async (
  app: NativeApp,
  scope: BatchScope
) => {
  const departmentId = randomUUID();
  const authorityAssignmentId = randomUUID();
  const programId = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
    )
    .bind(departmentId, "另一個獨立部門")
    .run();
  await app.db
    .prepare(
      "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(authorityAssignmentId, departmentId, scope.actor.userId)
    .run();
  await app.db
    .prepare(
      "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(programId, departmentId, "另一聚會不應假裝已指派")
    .run();
  return { authorityAssignmentId, departmentId, programId };
};

batchTest.describe(
  "same-Program grant picker",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-privacy",
      "@risk-session",
      "@risk-recovery",
      "@risk-resilience",
      "@risk-presentation",
    ],
  },
  () => {
    batchTest(
      "cross-page and query selections survive Reset and conditional proof before one atomic Save and a fresh roster",
      async ({ browser, caseApp, scope, extraHTTPHeaders }, info) => {
        const first = personAt(scope, 0);
        const second = { ...personAt(scope, 1), fullName: first.fullName };
        const last = personAt(scope, scope.candidates.length - 1);
        await caseApp.db
          .prepare("UPDATE user SET name = ? WHERE id = ?")
          .bind(second.fullName, second.userId)
          .run();
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await search(page, "陳批次候選人");
          await toggle(page, first).click();
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await expect(toggle(page, second)).toHaveAttribute(
            "aria-pressed",
            "false"
          );
          await toggle(page, second).click();
          await expect(toggle(page, second)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await toggle(page, second).click();
          await expect(toggle(page, second)).toHaveAttribute(
            "aria-pressed",
            "false"
          );
          await page
            .getByRole("button", { exact: true, name: "下一頁會友" })
            .click();
          await toggle(page, last).click();
          await search(page, first.username);
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await page
            .getByRole("button", { exact: true, name: "已選 2 位" })
            .click();
          await expect(
            page.getByRole("list", { name: "候選會友" }).getByRole("listitem")
          ).toHaveCount(2);
          await page.getByRole("button", { exact: true, name: "重設" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "已選 2 位" })
          ).toHaveCount(0);
          await search(page, first.username);
          await toggle(page, first).click();
          await search(page, last.username);
          await toggle(page, last).click();
          await page
            .getByRole("button", { exact: true, name: "已選 2 位" })
            .click();
          await qualifyPresentation(page, info, "program-leader-grant-picker", {
            criticalAction: page.getByRole("button", {
              exact: true,
              name: "儲存變更",
            }),
            drafts: page.locator("input"),
            focus: toggle(page, last),
            masks: [
              page.getByRole("list", { name: "候選會友" }),
              page.getByRole("textbox", { name: "搜尋會友" }),
            ],
          });
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const dialog = page.getByRole("dialog");
          await dialog
            .getByRole("textbox", { exact: true, name: "目前密碼" })
            .fill(scope.actor.password);
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(
            dialog.getByText("伺服器已確認「確認目前密碼」完成。", {
              exact: true,
            })
          ).toBeVisible();
          const refreshed = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/roles/program-leaders" &&
              response.request().headers().rsc === "1"
          );
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          const refreshedResponse = await refreshed;
          expect(refreshedResponse.status()).toBe(200);
          const refreshedError = await refreshedResponse.finished();
          expect(refreshedError).toBeNull();
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "已選 2 位" })
          ).toHaveAttribute("aria-pressed", "true");
          const before = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?page=1`
          );
          const beforeBody = await before.json();
          expect(beforeBody.data.leaders).toEqual([]);
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const result = await saved;
          expect(result.status()).toBe(201);
          const resultBody = await result.json();
          expect(resultBody.data.receipt.targetUserIds).toEqual(
            [first.userId, last.userId].toSorted()
          );
          await expect(
            page.getByRole("heading", { exact: true, name: scope.programName })
          ).toBeVisible();
          const roster = page.getByRole("region", { name: "現任負責人" });
          await expect(
            roster.getByText(first.fullName, { exact: true })
          ).toBeVisible();
          await expect(
            roster.getByText(last.fullName, { exact: true })
          ).toBeVisible();
        } finally {
          await context.close();
        }
      }
    );
    batchTest(
      "a stale selected membership conflicts before dispatch and requires fresh explicit reselection of the whole batch",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await confirmProof(context, scope);
          const { first, second } = await selectPair(page, scope);
          let commands = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
            ) {
              commands += 1;
            }
          });
          await caseApp.db
            .prepare(
              "DELETE FROM department_membership WHERE department_id=? AND user_id=?"
            )
            .bind(scope.departmentId, second.userId)
            .run();
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const reference = page.getByRole("region", { name: "上次原定選取" });
          await expect(
            reference.getByText(`${first.fullName} · ${first.username}`, {
              exact: true,
            })
          ).toBeVisible();
          await expect(
            reference.getByText(`${second.fullName} · ${second.username}`, {
              exact: true,
            })
          ).toBeVisible();
          expect(commands).toBe(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "按最新資格重新選擇" })
            .click();
          await search(page, second.username);
          await expect(toggle(page, second)).toHaveCount(0);
          await search(page, first.username);
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "false"
          );
          await toggle(page, first).click();
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByText(first.fullName, { exact: true })
          ).toBeVisible();
          const roster = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?page=1`
          );
          const body = await roster.json();
          expect(
            body.data.leaders.map((entry: { userId: string }) => entry.userId)
          ).toEqual([first.userId]);
          expect(commands).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "a committed lost response restores only original Program A after unreadable storage and unrelated mounted Program B loses DM authority",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await confirmProof(context, scope);
          const { first, second } = await selectPair(page, scope);
          let originalKey = "";
          let commands = 0;
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              commands += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              await route.abort("failed");
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toHaveCount(0);
          await page.addInitScript(() => {
            const read = Storage.prototype.getItem;
            Storage.prototype.getItem = function getItem(
              this: Storage,
              key: string
            ) {
              if (
                this === sessionStorage &&
                key.startsWith(
                  "efcc.program-leader-grant-batch.operation.v1:"
                ) &&
                window.name === "batch-read-blocked"
              ) {
                throw new DOMException(
                  "Synthetic original-key read outage",
                  "SecurityError"
                );
              }
              return read.call(this, key);
            };
          });
          await page.evaluate(() => {
            window.name = "batch-read-blocked";
          });
          await page.reload();
          await expect(
            page.getByRole("button", { exact: true, name: "重新載入聚會資料" })
          ).toBeVisible();
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveCount(0);
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          await page.evaluate(() => {
            window.name = "";
          });
          const stored = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            scope.actor.userId
          );
          expect(JSON.parse(stored ?? "null")).toEqual({
            actorUserId: scope.actor.userId,
            operationKey: originalKey,
          });
          expect(stored).not.toContain(first.userId);
          expect(stored).not.toContain(second.fullName);
          await page.reload();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const other = await addIndependentManagedProgram(caseApp, scope);
          await page.goto(
            `/roles/program-leaders?picker=grant&department=${other.departmentId}&program=${other.programId}`
          );
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveCount(0);
          await expect(
            page.getByText("另一聚會不應假裝已指派", { exact: true })
          ).toHaveCount(0);
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id=?")
            .bind(other.authorityAssignmentId)
            .run();
          const deniedOther = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${other.programId}/leaders?page=1`,
            {
              headers: { "x-efcc-expected-actor-id": scope.actor.userId },
            }
          );
          expect(deniedOther.status()).toBe(403);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const reconciled = page.waitForRequest(
            (request) =>
              new URL(request.url()).pathname ===
              "/api/v2/roles/program-leader-grant-batches/reconcile"
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const request = await reconciled;
          expect(request.postDataJSON().operationKey).toBe(originalKey);
          const roster = page.getByRole("region", { name: "現任負責人" });
          await expect(
            roster.getByText(first.fullName, { exact: true })
          ).toBeVisible();
          await expect(
            roster.getByText(second.fullName, { exact: true })
          ).toBeVisible();
          expect(new URL(page.url()).searchParams.get("program")).toBe(
            scope.programId
          );
          expect(commands).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "verified storage readback must succeed before dispatch and retry preserves the same prepared batch key",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await confirmProof(context, scope);
          await selectPair(page, scope);
          await page.evaluate(() => {
            const write = Storage.prototype.setItem;
            const read = Storage.prototype.getItem;
            const attempts: string[] = [];
            let written = false;
            Reflect.set(window, "batchStorageAttempts", attempts);
            window.name = "batch-readback-blocked";
            Storage.prototype.setItem = function setItem(
              this: Storage,
              key: string,
              value: string
            ) {
              write.call(this, key, value);
              if (
                this === sessionStorage &&
                key.startsWith("efcc.program-leader-grant-batch.operation.v1:")
              ) {
                written = true;
                attempts.push(value);
              }
            };
            Storage.prototype.getItem = function getItem(
              this: Storage,
              key: string
            ) {
              if (
                this === sessionStorage &&
                key.startsWith(
                  "efcc.program-leader-grant-batch.operation.v1:"
                ) &&
                written &&
                window.name === "batch-readback-blocked"
              ) {
                throw new DOMException(
                  "Synthetic readback failure after successful write",
                  "SecurityError"
                );
              }
              return read.call(this, key);
            };
          });
          let commands = 0;
          let dispatchedKey = "";
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              commands += 1;
              dispatchedKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              await route.abort("failed");
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(page.getByRole("alert")).toContainText("未有提交");
          expect(commands).toBe(0);
          await expect(
            page.getByRole("button", { exact: true, name: "已選 2 位" })
          ).toBeDisabled();
          await page.evaluate(() => {
            window.name = "";
          });
          await page
            .getByRole("button", { exact: true, name: "重試保留並儲存" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const attempts: string[] = await page.evaluate(() =>
            Reflect.get(window, "batchStorageAttempts")
          );
          expect(attempts).toHaveLength(2);
          expect(attempts[0]).toBe(attempts[1]);
          expect(JSON.parse(attempts[0] ?? "null").operationKey).toBe(
            dispatchedKey
          );
          expect(commands).toBe(1);
          await page.reload();
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          await expect(
            page.getByRole("heading", { exact: true, name: scope.programName })
          ).toBeVisible();
          expect(commands).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "a dispatched eligibility conflict stays UNKNOWN and cannot replace the original batch after membership returns",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await confirmProof(context, scope);
          const { first, second } = await selectPair(page, scope);
          let originalKey = "";
          let commands = 0;
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              commands += 1;
              originalKey = route.request().postDataJSON().operationKey;
              await caseApp.db
                .prepare(
                  "DELETE FROM department_membership WHERE department_id=? AND user_id=?"
                )
                .bind(scope.departmentId, second.userId)
                .run();
              const response = await route.fetch();
              expect(response.status()).toBe(409);
              await route.fulfill({ response });
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toHaveCount(0);
          await caseApp.db
            .prepare(
              "INSERT INTO department_membership(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
            )
            .bind(randomUUID(), scope.departmentId, second.userId)
            .run();
          await page.reload();
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          await expect(page.getByRole("status")).toContainText("仍未能確認");
          const stored = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            scope.actor.userId
          );
          expect(JSON.parse(stored ?? "null").operationKey).toBe(originalKey);
          const roster = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?page=1`
          );
          const body = await roster.json();
          expect(body.data.leaders).toEqual([]);
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          expect(commands).toBe(1);
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "an actual account replacement hides a held batch immediately and its late lost response cannot expose old choices",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        const committed = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        const delivered = Promise.withResolvers<null>();
        try {
          await confirmProof(context, scope);
          const { first } = await selectPair(page, scope);
          let originalKey = "";
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              originalKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              committed.resolve(null);
              await release.promise;
              try {
                await route.abort("failed");
              } finally {
                delivered.resolve(null);
              }
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await committed.promise;
          const suffix = randomUUID().slice(0, 8);
          const next = {
            email: `batch.next.${suffix}@example.com`,
            fullName: `陳新帳戶${suffix}`,
            membershipStatus: "active" as const,
            password: "Synthetic-batch-next-password!",
            role: "member" as const,
            username: `batch.next.${suffix}`,
          };
          const nextId = await caseApp.provision.account(next);
          const signOut = await context.request.post("/api/auth/sign-out", {
            data: {},
          });
          expect(signOut.status()).toBe(200);
          const signIn = await context.request.post(
            "/api/auth/sign-in/username",
            { data: { password: next.password, username: next.username } }
          );
          expect(signIn.status()).toBe(200);
          const session = await context.request.get("/api/auth/get-session");
          const identity = await session.json();
          expect(identity.user.id).toBe(nextId);
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "已選 2 位" })
          ).toHaveCount(0);
          release.resolve(null);
          await delivered.promise;
          const retained = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            scope.actor.userId
          );
          expect(JSON.parse(retained ?? "null")).toEqual({
            actorUserId: scope.actor.userId,
            operationKey: originalKey,
          });
          const nextKey = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            nextId
          );
          expect(nextKey).toBeNull();
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );
    batchTest(
      "the seven-person cap, quiet toggles and Keep/Discard preserve one-scroller actions without granting before Save",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        const first = personAt(scope, 0);
        const eighth = personAt(scope, 7);
        const selectSeven = async () => {
          await search(page, "陳批次候選人");
          await toggle(page, personAt(scope, 0)).click();
          await toggle(page, personAt(scope, 1)).click();
          await toggle(page, personAt(scope, 2)).click();
          await toggle(page, personAt(scope, 3)).click();
          await toggle(page, personAt(scope, 4)).click();
          await toggle(page, personAt(scope, 5)).click();
          await toggle(page, personAt(scope, 6)).click();
        };
        try {
          await confirmProof(context, scope);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await selectSeven();
          await expect(toggle(page, eighth)).toBeDisabled();
          await expect(
            page.getByRole("button", { exact: true, name: "已選 7 位" })
          ).toBeVisible();
          const box = await toggle(page, first).boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
          expect(
            await page.evaluate(
              () => matchMedia("(prefers-reduced-motion: reduce)").matches
            )
          ).toBe(true);
          await toggle(page, first).click();
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "false"
          );
          expect(
            await toggle(page, first)
              .locator("span")
              .evaluate((icon) => icon.getAnimations({ subtree: true }).length)
          ).toBe(0);
          await expect(toggle(page, eighth)).toBeEnabled();
          const before = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?page=1`
          );
          const beforeBody = await before.json();
          expect(beforeBody.data.leaders).toEqual([]);
          await toggle(page, first).click();
          await page
            .getByRole("link", { exact: true, name: "返回聚會" })
            .click();
          await page
            .getByRole("button", { exact: true, name: "繼續編輯" })
            .click();
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await page.setViewportSize({ height: 480, width: 320 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "200%";
          });
          await toggle(page, first).focus();
          const footer = page.getByRole("contentinfo", { name: "任務操作" });
          await expect
            .poll(async () => {
              const choice = await toggle(page, first).boundingBox();
              const actions = await footer.boundingBox();
              return choice && actions
                ? choice.y + choice.height - actions.y
                : Number.POSITIVE_INFINITY;
            })
            .toBeLessThanOrEqual(1);
          await expect(page.locator("[data-page-scroll]")).toHaveCount(1);
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "";
          });
          await page
            .getByRole("link", { exact: true, name: "返回聚會" })
            .click();
          await page
            .getByRole("button", { exact: true, name: "放棄變更" })
            .click();
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByRole("listitem")
          ).toHaveCount(0);
          await page
            .getByRole("button", { exact: true, name: "指派負責人" })
            .click();
          await selectSeven();
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          const roster = page.getByRole("region", { name: "現任負責人" });
          await expect(roster.getByRole("listitem")).toHaveCount(7);
          await expect(
            roster.getByText(first.fullName, { exact: true })
          ).toBeVisible();
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "expired proof and a failed no-write refresh retain the same choices for recovery and a second explicit Save after confirmation",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await confirmProof(context, scope);
          const { first, second } = await selectPair(page, scope);
          await caseApp.db
            .prepare(
              "UPDATE session SET password_confirmed_at=unixepoch()-601 WHERE user_id=?"
            )
            .bind(scope.actor.userId)
            .run();
          let failBaseline = false;
          let failureUsed = false;
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              const response = await route.fetch();
              if (!failureUsed && response.status() === 403) {
                failBaseline = true;
                failureUsed = true;
              }
              await route.fulfill({ response });
            }
          );
          await page.route(
            `**/programs/${scope.programId}/leaders?**`,
            async (route) => {
              if (failBaseline) {
                failBaseline = false;
                await route.abort("failed");
                return;
              }
              await route.continue();
            }
          );
          const rejected = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const rejection = await rejected;
          expect(rejection.status()).toBe(403);
          const rejectionBody = await rejection.json();
          expect(rejectionBody.error.code).toBe(
            "password_confirmation_required"
          );
          await expect(
            page.getByRole("button", { exact: true, name: "重新讀取聚會資料" })
          ).toBeVisible();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toBeDisabled();
          const cleared = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            scope.actor.userId
          );
          expect(cleared).toBeNull();
          await page
            .getByRole("button", { exact: true, name: "重新讀取聚會資料" })
            .click();
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await expect(toggle(page, second)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const dialog = page.getByRole("dialog");
          await dialog
            .getByRole("textbox", { exact: true, name: "目前密碼" })
            .fill(scope.actor.password);
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          await expect(
            dialog.getByText("伺服器已確認「確認目前密碼」完成。", {
              exact: true,
            })
          ).toBeVisible();
          const refreshed = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/roles/program-leaders" &&
              response.request().headers().rsc === "1"
          );
          await dialog
            .getByRole("button", { exact: true, name: "確認並返回檢查" })
            .click();
          const refreshedResponse = await refreshed;
          expect(refreshedResponse.status()).toBe(200);
          const refreshedError = await refreshedResponse.finished();
          expect(refreshedError).toBeNull();
          await expect(dialog).toHaveCount(0);
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await expect(toggle(page, second)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          const before = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?page=1`
          );
          const body = await before.json();
          expect(body.data.leaders).toEqual([]);
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(
            page
              .getByRole("region", { name: "現任負責人" })
              .getByRole("listitem")
          ).toHaveCount(2);
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "search validation focuses the real field and an unavailable page cannot erase authorized unsent selections",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          const input = page.getByRole("textbox", { name: "搜尋會友" });
          await page
            .getByRole("button", { exact: true, name: "搜尋會友" })
            .click();
          await expect(input).toBeFocused();
          await expect(input).toHaveAttribute("aria-invalid", "true");
          await expect(page.getByRole("alert")).toContainText(
            "請輸入姓名或用戶名稱"
          );
          const first = personAt(scope, 0);
          await search(page, `  ${first.username}  `);
          await toggle(page, first).click();
          await expect(input).toHaveAttribute("aria-invalid", "false");
          await page.route("**/candidates?**", (route) =>
            route.abort("failed")
          );
          await search(page, "另一次搜尋");
          await expect(page.getByRole("alert")).toContainText(
            "暫時無法讀取候選會友"
          );
          await page
            .getByRole("button", { exact: true, name: "已選 1 位" })
            .click();
          await expect(toggle(page, first)).toHaveAttribute(
            "aria-pressed",
            "true"
          );
          await page.unroute("**/candidates?**");
          await page
            .getByRole("button", { exact: true, name: "重新讀取候選會友" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "搜尋會友" })
          ).toBeEnabled();
        } finally {
          await context.close();
        }
      }
    );
    batchTest(
      "replacing the DM witness disposes unsent choices and cancels a held candidate page without dispatch",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        const arrived = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        const delivered = Promise.withResolvers<null>();
        try {
          const { first } = await selectPair(page, scope);
          let commands = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
            ) {
              commands += 1;
            }
          });
          await page.route("**/candidates?**", async (route) => {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            arrived.resolve(null);
            await release.promise;
            try {
              await route.fulfill({ response });
            } finally {
              delivered.resolve(null);
            }
          });
          await search(page, first.username);
          await arrived.promise;
          const cancelled = page.waitForEvent("requestfailed", (request) =>
            new URL(request.url()).pathname.endsWith("/candidates")
          );
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id=?")
            .bind(scope.authorityAssignmentId)
            .run();
          await caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
            )
            .bind(randomUUID(), scope.departmentId, scope.actor.userId)
            .run();
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveCount(0);
          await cancelled;
          release.resolve(null);
          await delivered.promise;
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          const original = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            scope.actor.userId
          );
          expect(original).toBeNull();
          expect(commands).toBe(0);
        } finally {
          release.resolve(null);
          await context.close();
        }
      }
    );
    batchTest(
      "restored original Program A authority loss denies reconciliation despite independently authorized Program B and retains the original key",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        try {
          await confirmProof(context, scope);
          const { first } = await selectPair(page, scope);
          let originalKey = "";
          let commands = 0;
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              commands += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const response = await route.fetch();
              expect(response.status()).toBe(201);
              await route.abort("failed");
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const other = await addIndependentManagedProgram(caseApp, scope);
          await page.goto(
            `/roles/program-leaders?picker=grant&department=${other.departmentId}&program=${other.programId}`
          );
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id=?")
            .bind(scope.authorityAssignmentId)
            .run();
          const originalRoster = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?page=1`,
            {
              headers: { "x-efcc-expected-actor-id": scope.actor.userId },
            }
          );
          expect(originalRoster.status()).toBe(403);
          const otherRoster = await context.request.get(
            `/api/v2/roles/program-leaders/programs/${other.programId}/leaders?page=1`,
            {
              headers: { "x-efcc-expected-actor-id": scope.actor.userId },
            }
          );
          expect(otherRoster.status()).toBe(200);
          const session = await context.request.get("/api/auth/get-session");
          const identity = await session.json();
          expect(identity.user.id).toBe(scope.actor.userId);
          const reconciled = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches/reconcile"
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const denied = await reconciled;
          expect(denied.status()).toBe(403);
          expect(denied.request().postDataJSON()).toEqual({
            operationKey: originalKey,
          });
          await expect(page.getByRole("alert")).toContainText("權限已改變");
          await expect(
            page.getByRole("textbox", { name: "搜尋會友" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toHaveCount(0);
          await expect(
            page.getByText(first.fullName, { exact: true })
          ).toHaveCount(0);
          const retained = await page.evaluate(
            (actor) =>
              sessionStorage.getItem(
                `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
              ),
            scope.actor.userId
          );
          expect(JSON.parse(retained ?? "null")).toEqual({
            actorUserId: scope.actor.userId,
            operationKey: originalKey,
          });
          expect(commands).toBe(1);
        } finally {
          await context.close();
        }
      }
    );
  }
);

batchTest.describe(
  "cross-family scoped command fence",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-actor-target-key",
      "@risk-privacy",
      "@risk-recovery",
      "@risk-resilience",
    ],
  },
  () => {
    batchTest.use({ actorRole: "admin" });

    batchTest(
      "a committed lost batch fences person and local scoped tasks until its original receipt settles",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        const target = personAt(scope, 0);
        let commands = 0;
        let originalKey = "";
        let replacementCommands = 0;
        try {
          page.on("request", (request) => {
            const path = new URL(request.url()).pathname;
            if (
              request.method() === "POST" &&
              (path === "/api/v2/roles/scoped-department-managers" ||
                path === "/api/v2/roles/program-leaders")
            ) {
              replacementCommands += 1;
            }
          });
          await confirmProof(context, scope);
          await search(page, target.username);
          await toggle(page, target).click();
          await page.route(
            "**/api/v2/roles/program-leader-grant-batches",
            async (route) => {
              commands += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const result = await route.fetch();
              expect(result.status()).toBe(201);
              await route.abort("failed");
            }
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const storageKey = `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(scope.actor.userId)}`;
          const original = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey
          );
          expect(JSON.parse(original ?? "null")).toEqual({
            actorUserId: scope.actor.userId,
            operationKey: originalKey,
          });
          await page.goto(`/roles/people/duties?person=${target.userId}`);
          await expect(page).toHaveURL(
            /\/roles\/program-leaders\?picker=grant&authority=admin$/u
          );
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const assignment = await caseApp.db
            .prepare(
              "SELECT id FROM program_leader_assignment WHERE program_id=? AND user_id=?"
            )
            .bind(scope.programId, target.userId)
            .first<{ id: string }>();
          if (!assignment) {
            throw new Error("Expected committed Program Leader assignment");
          }
          const local = new URLSearchParams({
            assignment: assignment.id,
            authority: scope.authorityAssignmentId,
            department: scope.departmentId,
            origin: "program",
            person: target.userId,
            program: scope.programId,
          });
          await page.goto(`/roles/people/duties?${local}`);
          await expect(page).toHaveURL(
            /\/roles\/program-leaders\?picker=grant$/u
          );
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBe(original);
          expect(
            await page.evaluate(
              (actor) =>
                sessionStorage.getItem(
                  `efcc.scoped-role.operation.v1:${encodeURIComponent(actor)}`
                ),
              scope.actor.userId
            )
          ).toBeNull();
          expect(
            await page.evaluate(
              (actor) =>
                sessionStorage.getItem(
                  `efcc.program-leader.operation.v1:${encodeURIComponent(actor)}`
                ),
              scope.actor.userId
            )
          ).toBeNull();
          expect(commands).toBe(1);
          expect(replacementCommands).toBe(0);
          const receipt = page.waitForRequest(
            (request) =>
              new URL(request.url()).pathname ===
              "/api/v2/roles/program-leader-grant-batches/reconcile"
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const receiptRequest = await receipt;
          expect(receiptRequest.postDataJSON().operationKey).toBe(originalKey);
          await expect(
            page.getByRole("heading", { exact: true, name: scope.programName })
          ).toBeVisible();
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBeNull();
          await page
            .getByRole("button", { exact: true, name: "指派負責人" })
            .click();
          const next = personAt(scope, 1);
          await search(page, next.username);
          await toggle(page, next).click();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toBeEnabled();
          expect(commands).toBe(1);
          await page.unroute("**/api/v2/roles/program-leader-grant-batches");
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const savedResponse = await saved;
          expect(savedResponse.status()).toBe(201);
          await expect(
            page.getByRole("heading", { exact: true, name: scope.programName })
          ).toBeVisible();
          expect(
            await caseApp.db
              .prepare(
                "SELECT user_id FROM program_leader_assignment WHERE program_id=? AND user_id=?"
              )
              .bind(scope.programId, next.userId)
              .first()
          ).not.toBeNull();
        } finally {
          await context.close();
        }
      }
    );

    batchTest(
      "a committed lost scoped command fences a new batch and restores neutrally before explicit fresh selection",
      async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
        const { context, page } = await openPicker(
          browser,
          caseApp,
          scope,
          extraHTTPHeaders
        );
        const target = personAt(scope, 0);
        let originalKey = "";
        let scopedCommands = 0;
        let batchCommands = 0;
        try {
          await confirmProof(context, scope);
          await openRoleTask(page, target, "program-leaders");
          const department = await caseApp.db
            .prepare("SELECT name FROM department WHERE id=?")
            .bind(scope.departmentId)
            .first<{ name: string }>();
          if (!department) {
            throw new Error("Expected synthetic Department");
          }
          await page
            .getByRole("button", {
              exact: true,
              name: `讀取${department.name}的聚會職務`,
            })
            .click();
          await page
            .getByRole("checkbox", {
              exact: true,
              name: `聚會負責人：${scope.programName}`,
            })
            .check();
          await page.route(
            "**/api/v2/roles/scoped-department-managers",
            async (route) => {
              scopedCommands += 1;
              originalKey = route.request().postDataJSON().operationKey;
              const result = await route.fetch();
              expect(result.status()).toBe(201);
              await route.abort("failed");
            }
          );
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
            ) {
              batchCommands += 1;
            }
          });
          await page.getByRole("button", { exact: true, name: "儲存" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          const storageKey = `efcc.scoped-role.operation.v1:${encodeURIComponent(scope.actor.userId)}`;
          const original = await page.evaluate(
            (key) => sessionStorage.getItem(key),
            storageKey
          );
          await page.goto(
            `/roles/program-leaders?picker=grant&department=${scope.departmentId}&program=${scope.programId}`
          );
          await expect(page).toHaveURL(/\/roles\/people\/duties$/u);
          await expect(
            page.getByRole("button", { exact: true, name: "查核原有操作" })
          ).toBeEnabled();
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBe(original);
          expect(
            await page.evaluate(
              (actor) =>
                sessionStorage.getItem(
                  `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
                ),
              scope.actor.userId
            )
          ).toBeNull();
          expect(scopedCommands).toBe(1);
          expect(batchCommands).toBe(0);
          const receipt = page.waitForRequest(
            (request) =>
              new URL(request.url()).pathname ===
              "/api/v2/roles/scoped-department-managers/reconcile"
          );
          await page
            .getByRole("button", { exact: true, name: "查核原有操作" })
            .click();
          const receiptRequest = await receipt;
          expect(receiptRequest.postDataJSON().operationKey).toBe(originalKey);
          await expect(
            page.getByRole("article", { exact: true, name: target.fullName })
          ).toBeVisible();
          expect(
            await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            )
          ).toBeNull();
          await page.goto(
            `/roles/program-leaders?department=${scope.departmentId}&program=${scope.programId}`
          );
          await page
            .getByRole("button", { exact: true, name: "指派負責人" })
            .click();
          const next = personAt(scope, 1);
          await search(page, next.username);
          await toggle(page, next).click();
          await expect(
            page.getByRole("button", { exact: true, name: "儲存變更" })
          ).toBeEnabled();
          expect(batchCommands).toBe(0);
          expect(scopedCommands).toBe(1);
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches"
          );
          await page
            .getByRole("button", { exact: true, name: "儲存變更" })
            .click();
          const savedResponse = await saved;
          expect(savedResponse.status()).toBe(201);
          await expect(
            page.getByRole("heading", { exact: true, name: scope.programName })
          ).toBeVisible();
          expect(batchCommands).toBe(1);
          expect(
            await caseApp.db
              .prepare(
                "SELECT user_id FROM program_leader_assignment WHERE program_id=? AND user_id=?"
              )
              .bind(scope.programId, next.userId)
              .first()
          ).not.toBeNull();
        } finally {
          await context.close();
        }
      }
    );
  }
);

const prepareGlobalAuthority = async (
  app: NativeApp,
  scope: BatchScope,
  authorityKind: "admin" | "role_assigner"
) => {
  await app.db
    .prepare(
      "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
    )
    .bind(randomUUID(), "不應出現在聚會工作中的其他部門")
    .run();
  await app.db
    .prepare(
      "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
    )
    .bind(randomUUID(), scope.departmentId, "同部門但不應改動的另一聚會")
    .run();
  await app.db
    .prepare("DELETE FROM department_manager_assignment WHERE user_id = ?")
    .bind(scope.actor.userId)
    .run();
  await app.db
    .prepare("DELETE FROM department_membership WHERE department_id = ?")
    .bind(scope.departmentId)
    .run();
  if (authorityKind === "role_assigner") {
    await app.db
      .prepare(
        "INSERT INTO role_assigner_assignment(id,user_id,created_at) VALUES(?,?,unixepoch())"
      )
      .bind(scope.authorityAssignmentId, scope.actor.userId)
      .run();
  }
  const localAuthority = await app.db
    .prepare(
      "SELECT count(*) AS count FROM department_manager_assignment WHERE user_id = ?"
    )
    .bind(scope.actor.userId)
    .first<{ count: number }>();
  expect(localAuthority?.count).toBe(0);
  const memberships = await app.db
    .prepare(
      "SELECT count(*) AS count FROM department_membership WHERE department_id = ?"
    )
    .bind(scope.departmentId)
    .first<{ count: number }>();
  expect(memberships?.count).toBe(0);
};

for (const authorityKind of ["admin", "role_assigner"] as const) {
  batchTest.describe(
    `churchwide ${authorityKind} Program context`,
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-actor-target-key",
        "@risk-privacy",
        "@risk-session",
        "@risk-recovery",
        "@risk-resilience",
        "@risk-presentation",
      ],
    },
    () => {
      batchTest.use({
        actorRole: authorityKind === "admin" ? "admin" : "staff",
      });
      batchTest(
        authorityKind === "admin"
          ? "an Admin without DM grants non-Department candidates through Program context and recovers only the original batch"
          : "a Role Assigner without DM grants non-Department candidates through Program context and recovers only the original batch",
        async ({ browser, caseApp, scope, extraHTTPHeaders }, info) => {
          await prepareGlobalAuthority(caseApp, scope, authorityKind);
          const { context, page } = await openPicker(
            browser,
            caseApp,
            scope,
            extraHTTPHeaders,
            authorityKind
          );
          const storageKey = `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(scope.actor.userId)}`;
          let committedKey = "";
          let committedCommands = 0;
          const attemptedKeys: string[] = [];
          try {
            const { first, second } = await selectPair(page, scope);
            const save = page.getByRole("button", {
              exact: true,
              name: "儲存變更",
            });
            await qualifyPresentation(
              page,
              info,
              `global-${authorityKind}-program-grant`,
              {
                criticalAction: save,
                drafts: page.locator("input"),
                focus: save,
                masks: [
                  page.getByText(first.fullName, { exact: true }),
                  page.getByText(second.fullName, { exact: true }),
                ],
              }
            );
            await page.route(
              "**/api/v2/roles/program-leader-grant-batches",
              async (route) => {
                const input = route.request().postDataJSON();
                attemptedKeys.push(input.operationKey);
                expect(input).toMatchObject({
                  authorityAssignmentId:
                    authorityKind === "admin"
                      ? null
                      : scope.authorityAssignmentId,
                  authorityKind,
                  expectedDepartmentId: scope.departmentId,
                  scopeId: scope.programId,
                  targetUserIds: [first.userId, second.userId].toSorted(),
                });
                const response = await route.fetch();
                if (response.status() === 403) {
                  expect(await response.json()).toMatchObject({
                    error: { code: "password_confirmation_required" },
                  });
                  await route.fulfill({ response });
                  return;
                }
                expect(response.status()).toBe(201);
                committedKey = input.operationKey;
                committedCommands += 1;
                await route.abort("failed");
              }
            );
            await page
              .getByRole("button", { exact: true, name: "儲存變更" })
              .click();
            await expect(page.getByRole("dialog")).toBeVisible();
            expect(attemptedKeys).toHaveLength(1);
            const [deniedKey] = attemptedKeys;
            if (!deniedKey) {
              throw new Error("Expected the actual proof-denied operation key");
            }
            const beforeProof = await caseApp.db
              .prepare(
                "SELECT (SELECT count(*) FROM program_leader_assignment WHERE program_id=?) AS assignments, (SELECT count(*) FROM role_assignment_history WHERE actor_user_id=? AND target_user_id IN (?,?) AND role='program_leader') AS history, (SELECT count(*) FROM audit_event WHERE actor_user_id=? AND target_user_id IN (?,?) AND action='program_leader_granted') AS audits, (SELECT count(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=?) AS receipts"
              )
              .bind(
                scope.programId,
                scope.actor.userId,
                first.userId,
                second.userId,
                scope.actor.userId,
                first.userId,
                second.userId,
                scope.actor.userId,
                deniedKey
              )
              .first();
            expect(beforeProof).toEqual({
              assignments: 0,
              audits: 0,
              history: 0,
              receipts: 0,
            });
            await confirmRoleTaskPassword(page, scope.actor.password);
            expect(committedCommands).toBe(0);
            expect(attemptedKeys).toHaveLength(1);
            await page
              .getByRole("button", { exact: true, name: "儲存變更" })
              .click();
            const originalAction = page.getByRole("button", {
              exact: true,
              name: "查核原有操作",
            });
            await expect(originalAction).toBeEnabled();
            expect(committedCommands).toBe(1);
            expect(attemptedKeys).toHaveLength(2);
            const original = await page.evaluate(
              (key) => sessionStorage.getItem(key),
              storageKey
            );
            expect(JSON.parse(original ?? "null")).toEqual({
              actorUserId: scope.actor.userId,
              operationKey: committedKey,
            });
            await page.reload();
            await expect(originalAction).toBeEnabled();
            await expect(
              page.getByText(first.fullName, { exact: true })
            ).toHaveCount(0);
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                storageKey
              )
            ).toBe(original);
            const reconciliation = page.waitForRequest(
              (request) =>
                new URL(request.url()).pathname ===
                "/api/v2/roles/program-leader-grant-batches/reconcile"
            );
            await originalAction.click();
            const originalRequest = await reconciliation;
            expect(originalRequest.postDataJSON()).toEqual({
              operationKey: committedKey,
            });
            await expect(
              page.getByRole("heading", {
                exact: true,
                name: scope.programName,
              })
            ).toBeVisible();
            expect(new URL(page.url()).searchParams.get("authority")).toBe(
              authorityKind
            );
            const roster = page.getByRole("region", {
              exact: true,
              name: "現任負責人",
            });
            await expect(roster).toContainText(first.fullName);
            await expect(roster).toContainText(second.fullName);
            const storedReceipt = await caseApp.db
              .prepare(
                "SELECT authority_kind AS authorityKind FROM role_change_operation WHERE actor_user_id=? AND operation_key=?"
              )
              .bind(scope.actor.userId, committedKey)
              .first();
            expect(storedReceipt).toEqual({ authorityKind });
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                storageKey
              )
            ).toBeNull();
            const programReturn = page.url();
            const firstAssignment = await caseApp.db
              .prepare(
                "SELECT id FROM program_leader_assignment WHERE program_id=? AND user_id=?"
              )
              .bind(scope.programId, first.userId)
              .first<{ id: string }>();
            if (!firstAssignment) {
              throw new Error(
                "Expected the original committed leader assignment"
              );
            }
            await roster
              .getByRole("link", {
                exact: true,
                name: `編輯${first.fullName}的聚會職務`,
              })
              .click();
            await expect(page).toHaveURL(
              (url) =>
                url.pathname === "/roles/people/duties" &&
                url.searchParams.get("department") === scope.departmentId &&
                url.searchParams.get("program") === scope.programId
            );
            await expect(
              page.getByRole("link", { exact: true, name: "返回聚會" })
            ).toHaveAttribute(
              "href",
              new URL(programReturn).pathname + new URL(programReturn).search
            );
            const assignmentChoice = page.getByRole("checkbox", {
              exact: true,
              name: `聚會負責人：${scope.programName}`,
            });
            await expect(assignmentChoice).toBeChecked();
            await expect(page.getByRole("checkbox")).toHaveCount(1);
            await expect(
              page.getByRole("checkbox", { name: /^部門主管：/u })
            ).toHaveCount(0);
            await expect(
              page.getByRole("checkbox", {
                exact: true,
                name: "聚會負責人：同部門但不應改動的另一聚會",
              })
            ).toHaveCount(0);
            const scopedRequests: {
              changes: unknown[];
              operationKey: string;
              targetUserId: string;
            }[] = [];
            let lostScopedResponse = false;
            await page.route(
              "**/api/v2/roles/scoped-department-managers",
              async (route) => {
                if (route.request().method() !== "POST") {
                  await route.continue();
                  return;
                }
                scopedRequests.push(route.request().postDataJSON());
                const response = await route.fetch();
                expect(response.status()).toBe(201);
                lostScopedResponse = true;
                await route.abort("failed");
              }
            );
            await assignmentChoice.uncheck();
            await page
              .getByRole("button", { exact: true, name: "儲存" })
              .click();
            await expect(originalAction).toBeEnabled();
            expect(lostScopedResponse).toBe(true);
            expect(scopedRequests).toHaveLength(1);
            const [reviewed] = scopedRequests;
            if (!reviewed) {
              throw new Error("Expected the original scoped withdrawal");
            }
            expect(reviewed.targetUserId).toBe(first.userId);
            expect(reviewed.changes).toEqual([
              {
                action: "withdrawn",
                expectedAssignmentId: firstAssignment.id,
                expectedDepartmentId: scope.departmentId,
                role: "program_leader",
                scopeId: scope.programId,
              },
            ]);
            const scopedStorageKey = `efcc.scoped-role.operation.v1:${encodeURIComponent(scope.actor.userId)}`;
            const originalScopedReference = await page.evaluate(
              (key) => sessionStorage.getItem(key),
              scopedStorageKey
            );
            if (!originalScopedReference) {
              throw new Error("Expected the persisted original scoped key");
            }
            expect(JSON.parse(originalScopedReference ?? "null")).toEqual({
              actorUserId: scope.actor.userId,
              operationKey: reviewed.operationKey,
            });
            await page.reload();
            await expect(originalAction).toBeEnabled();
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                scopedStorageKey
              )
            ).toBe(originalScopedReference);
            const scopedReconciliation = page.waitForRequest(
              (request) =>
                new URL(request.url()).pathname ===
                "/api/v2/roles/scoped-department-managers/reconcile"
            );
            await originalAction.click();
            const restoredScopedRequest = await scopedReconciliation;
            expect(restoredScopedRequest.postDataJSON().operationKey).toBe(
              reviewed.operationKey
            );
            expect(scopedRequests).toHaveLength(1);
            await expect(page.getByRole("dialog")).toHaveCount(0);
            await expect(page).toHaveURL(programReturn);
            await expect(
              page.getByRole("heading", {
                exact: true,
                name: scope.programName,
              })
            ).toBeVisible();
            await expect(
              roster.getByText(first.fullName, { exact: true })
            ).toHaveCount(0);
            await expect(
              roster.getByText(second.fullName, { exact: true })
            ).toBeVisible();
            const currentLeaders = await page.request.get(
              `/api/v2/roles/program-leaders/programs/${scope.programId}/leaders?authority=${authorityKind}&page=1`
            );
            expect(currentLeaders.status()).toBe(200);
            const currentRoster = await currentLeaders.json();
            expect(
              currentRoster.data.leaders.map(
                (leader: { userId: string }) => leader.userId
              )
            ).toEqual([second.userId]);
            const otherProgram = await caseApp.db
              .prepare(
                "SELECT id FROM program WHERE department_id=? AND name=?"
              )
              .bind(scope.departmentId, "同部門但不應改動的另一聚會")
              .first<{ id: string }>();
            if (!otherProgram) {
              throw new Error("Expected the unrelated Program fixture");
            }
            await caseApp.db
              .prepare(
                "INSERT INTO program_leader_assignment(id,program_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
              )
              .bind(randomUUID(), otherProgram.id, second.userId)
              .run();
            // Simulate an uncleared opaque reference to the real committed
            // withdrawal, then enter a different authorized roster task.
            await page.evaluate(
              ({ key, reference }) => sessionStorage.setItem(key, reference),
              { key: scopedStorageKey, reference: originalScopedReference }
            );
            const unrelatedRoster = new URL(programReturn);
            unrelatedRoster.searchParams.set("program", otherProgram.id);
            unrelatedRoster.searchParams.delete("q");
            await page.goto(unrelatedRoster.href);
            await page
              .getByRole("link", {
                exact: true,
                name: `編輯${second.fullName}的聚會職務`,
              })
              .click();
            await expect(page).toHaveURL(
              (url) =>
                url.pathname === "/roles/people/duties" &&
                url.searchParams.get("person") === second.userId &&
                url.searchParams.get("program") === otherProgram.id
            );
            await expect(originalAction).toBeEnabled();
            const mismatchedReconciliation = page.waitForRequest(
              (request) =>
                new URL(request.url()).pathname ===
                "/api/v2/roles/scoped-department-managers/reconcile"
            );
            await originalAction.click();
            const originalReceiptRequest = await mismatchedReconciliation;
            expect(originalReceiptRequest.postDataJSON().operationKey).toBe(
              reviewed.operationKey
            );
            await expect(page).toHaveURL(
              (url) =>
                url.pathname === "/roles/people" &&
                url.searchParams.get("person") === first.userId
            );
            await expect(
              page.getByRole("article", { exact: true, name: first.fullName })
            ).toBeVisible();
            expect(scopedRequests).toHaveLength(1);
            await page.goto(programReturn);
            await expect(
              roster.getByText(second.fullName, { exact: true })
            ).toBeVisible();
            const third = personAt(scope, 2);
            await page
              .getByRole("button", { exact: true, name: "指派負責人" })
              .click();
            await search(page, third.username);
            await toggle(page, third).click();
            expect(new URL(page.url()).searchParams.get("q")).toBe(
              third.username
            );
            await expect(
              page.getByText(scope.actor.fullName, { exact: true })
            ).toHaveCount(1);
            const suffix = randomUUID().slice(0, 8);
            const replacement = {
              email: `global.batch.next.${suffix}@example.com`,
              fullName: `下一位批次管理員${suffix}`,
              membershipStatus: "active" as const,
              password: "Synthetic-next-global-manager!",
              role: "admin" as const,
              username: `global.batch.next.${suffix}`,
            };
            const replacementId = await caseApp.provision.account(replacement);
            const signedOut = await context.request.post("/api/auth/sign-out", {
              data: {},
            });
            expect(signedOut.status()).toBe(200);
            const signedIn = await context.request.post(
              "/api/auth/sign-in/username",
              {
                data: {
                  password: replacement.password,
                  username: replacement.username,
                },
              }
            );
            expect(signedIn.status()).toBe(200);
            const currentSession = await context.request.get(
              "/api/auth/get-session"
            );
            const sessionBody = await currentSession.json();
            expect(sessionBody.user.id).toBe(replacementId);
            await page.evaluate(() => window.dispatchEvent(new Event("focus")));
            await expect(
              page.getByText(third.fullName, { exact: true })
            ).toHaveCount(0);
            await expect(
              page.getByText(scope.actor.fullName, { exact: true })
            ).toHaveCount(0);
            expect(new URL(page.url()).searchParams.get("q")).toBeNull();
            await expect(
              page.getByRole("button", { exact: true, name: "儲存變更" })
            ).toHaveCount(0);
            expect(
              await page.evaluate(
                (key) => sessionStorage.getItem(key),
                storageKey
              )
            ).toBeNull();
            expect(
              await page.evaluate(
                (actor) =>
                  sessionStorage.getItem(
                    `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
                  ),
                replacementId
              )
            ).toBeNull();
            expect(committedCommands).toBe(1);
            if (authorityKind === "admin") {
              await page.reload();
              await expect(
                page.getByRole("textbox", { name: "搜尋會友" })
              ).toHaveValue("");
              await expect(
                page.getByText(scope.actor.fullName, { exact: true })
              ).toHaveCount(0);
              expect(new URL(page.url()).searchParams.get("q")).toBeNull();
              expect(committedCommands).toBe(1);
            }
          } finally {
            await context.close();
          }
        }
      );
    }
  );
}

for (const authorityKind of ["role_assigner", "department_manager"] as const) {
  batchTest.describe(
    `${authorityKind} scope replacement`,
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-actor-target-key",
        "@risk-privacy",
        "@risk-session",
        "@risk-recovery",
        "@risk-resilience",
        "@risk-presentation",
      ],
    },
    () => {
      batchTest.use({
        actorRole: authorityKind === "role_assigner" ? "staff" : "admin",
      });
      batchTest(
        authorityKind === "role_assigner"
          ? "Role Assigner witness replacement clears the global picker before dispatch"
          : "an Admin using explicit DM mode cannot fall back after its DM assignment is withdrawn",
        async ({ browser, caseApp, scope, extraHTTPHeaders }) => {
          if (authorityKind === "role_assigner") {
            await prepareGlobalAuthority(caseApp, scope, authorityKind);
          }
          const { context, page } = await openPicker(
            browser,
            caseApp,
            scope,
            extraHTTPHeaders,
            authorityKind
          );
          let submissions = 0;
          let authorityChanged = false;
          const replacementWitness = randomUUID();
          try {
            if (authorityKind === "department_manager") {
              await page.goto(
                `/roles/program-leaders?authority=department_manager&department=${scope.departmentId}&program=${scope.programId}&picker=grant`
              );
            }
            const { first, second } = await selectPair(page, scope);
            await confirmProof(context, scope);
            page.on("request", (request) => {
              if (
                request.method() === "POST" &&
                new URL(request.url()).pathname ===
                  "/api/v2/roles/program-leader-grant-batches"
              ) {
                submissions += 1;
              }
            });
            await page.route(
              "**/api/v2/roles/program-leader-grant-batches/validate",
              async (route) => {
                const response = await route.fetch();
                expect(response.status()).toBe(200);
                expect(route.request().postDataJSON()).toMatchObject({
                  authorityAssignmentId: scope.authorityAssignmentId,
                  authorityKind,
                });
                if (authorityKind === "role_assigner") {
                  await caseApp.db
                    .prepare("DELETE FROM role_assigner_assignment WHERE id=?")
                    .bind(scope.authorityAssignmentId)
                    .run();
                  await caseApp.db
                    .prepare(
                      "INSERT INTO role_assigner_assignment(id,user_id,created_at) VALUES(?,?,unixepoch())"
                    )
                    .bind(replacementWitness, scope.actor.userId)
                    .run();
                } else {
                  await caseApp.db
                    .prepare(
                      "DELETE FROM department_manager_assignment WHERE id=?"
                    )
                    .bind(scope.authorityAssignmentId)
                    .run();
                }
                authorityChanged = true;
                await route.fulfill({ response });
              }
            );
            const scopeRecheck = page.waitForResponse((response) => {
              const url = new URL(response.url());
              return (
                authorityChanged &&
                url.pathname.endsWith(`/programs/${scope.programId}/leaders`) &&
                url.searchParams.get("authority") === authorityKind
              );
            });
            await page
              .getByRole("button", { exact: true, name: "儲存變更" })
              .click();
            const current = await scopeRecheck;
            if (authorityKind === "department_manager") {
              expect(current.status()).toBe(403);
            } else {
              expect(current.status()).toBe(200);
              expect(await current.json()).toMatchObject({
                data: {
                  authorityAssignmentId: replacementWitness,
                  authorityKind,
                },
              });
            }
            await expect(page.getByRole("alert")).toContainText("權限已改變");
            await expect(
              page.getByText(first.fullName, { exact: true })
            ).toHaveCount(0);
            await expect(
              page.getByText(second.fullName, { exact: true })
            ).toHaveCount(0);
            await expect(
              page.getByRole("button", { exact: true, name: "儲存變更" })
            ).toHaveCount(0);
            expect(submissions).toBe(0);
            expect(
              await page.evaluate(
                (actor) =>
                  sessionStorage.getItem(
                    `efcc.program-leader-grant-batch.operation.v1:${encodeURIComponent(actor)}`
                  ),
                scope.actor.userId
              )
            ).toBeNull();
            const effects = await caseApp.db
              .prepare(
                "SELECT (SELECT count(*) FROM program_leader_assignment WHERE program_id=?) AS assignments, (SELECT count(*) FROM role_change_operation WHERE actor_user_id=? AND command_family='program_grants') AS receipts"
              )
              .bind(scope.programId, scope.actor.userId)
              .first();
            expect(effects).toEqual({ assignments: 0, receipts: 0 });
          } finally {
            await context.close();
          }
        }
      );
    }
  );
}
