import { randomUUID } from "node:crypto";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

interface Candidate {
  fullName: string;
  userId: string;
  username: string;
}
interface BatchScope {
  actor: { password: string; username: string; userId: string };
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

const batchTest = dedicatedTest.extend<{ scope: BatchScope }>({
  scope: async ({ caseApp }, use) => {
    const suffix = randomUUID().slice(0, 8);
    const actor = {
      email: `batch.manager.${suffix}@example.com`,
      fullName: `陳批次部門主管${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-batch-manager-password!",
      role: "member" as const,
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
  extraHTTPHeaders: Record<string, string> | undefined
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
  await page.goto(
    `/roles/program-leaders?department=${scope.departmentId}&program=${scope.programId}`
  );
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
