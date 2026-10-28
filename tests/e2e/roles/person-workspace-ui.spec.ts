/* eslint-disable no-await-in-loop -- Viewport transitions share one live Page. */
import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";

const personWorkspaceTest = dedicatedTest.extend<{
  admin: {
    password: string;
    userId: string;
    username: string;
  };
}>({
  admin: async ({ caseApp }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const admin = {
      email: `${suffix}@example.com`,
      fullName: `陳人員權責管理員${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-person-workspace-admin!",
      role: "admin" as const,
      username: `people.admin.${suffix}`,
    };
    const userId = await caseApp.provision.account(admin);
    await use({ ...admin, userId });
  },
});

const signIn = async (page: Page, username: string, password: string) => {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByRole("textbox", { name: "密碼" }).fill(password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page).toHaveURL(/\/$/u);
};

const seedDuty = async ({
  caseApp,
  departmentName,
  programName,
  targetUserId,
}: {
  caseApp: {
    db: D1Database;
  };
  departmentName: string;
  programName: string;
  targetUserId: string;
}) => {
  const departmentId = randomUUID();
  const programId = randomUUID();
  await caseApp.db
    .prepare(
      "insert into department (id,name,created_at) values (?,?,unixepoch())"
    )
    .bind(departmentId, departmentName)
    .run();
  await caseApp.db
    .prepare(
      "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
    )
    .bind(programId, departmentId, programName)
    .run();
  await caseApp.db
    .prepare(
      "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
    )
    .bind(randomUUID(), departmentId, targetUserId)
    .run();
  await caseApp.db
    .prepare(
      "insert into program_leader_assignment (id,program_id,user_id,created_at) values (?,?,?,unixepoch())"
    )
    .bind(randomUUID(), programId, targetUserId)
    .run();
  return { departmentId, programId };
};

personWorkspaceTest.describe(
  "person-first responsibilities overview",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-presentation",
      "@risk-accessibility",
    ],
  },
  () => {
    personWorkspaceTest(
      "an Admin reads independent duty groups, pages the pair and changes target on compact layouts",
      async (
        { admin, browser, browserName, caseApp, extraHTTPHeaders },
        testInfo
      ) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `王美華嘉恩志明麗芬慧玲${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-member!",
          role: "member" as const,
          username: `people.member.${suffix}`,
        };
        const targetUserId = await caseApp.provision.account(target);
        await seedDuty({
          caseApp,
          departmentName: `敬拜部${suffix}`,
          programName: `主日敬拜${suffix}`,
          targetUserId,
        });
        await seedDuty({
          caseApp,
          departmentName: `青年部${suffix}`,
          programName: `週六青年團契${suffix}`,
          targetUserId,
        });
        await seedDuty({
          caseApp,
          departmentName: `關顧部${suffix}`,
          programName: `家庭關顧${suffix}`,
          targetUserId,
        });

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          hasTouch: true,
        });
        try {
          const page = await context.newPage();
          await signIn(page, admin.username, admin.password);
          await page.goto("/staff/accounts");
          const entry = page.getByRole("link", { name: /人員權責/u });
          await expect(entry).toHaveAttribute("href", "/roles/people");
          for (const name of [/^部門主管/u, /^Program Leader/u, /^全域角色/u]) {
            await expect(page.getByRole("link", { name })).toHaveAttribute(
              "href",
              "/roles/people"
            );
          }
          await entry.click();
          await expect(page).toHaveURL(/\/roles\/people$/u);

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          const candidate = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(candidate).toBeVisible();

          await qualifyPresentation(page, testInfo, "person-search", {
            criticalAction: page.getByRole("button", {
              exact: true,
              name: "搜尋",
            }),
            drafts: page.locator("input"),
            focus: search,
            masks: [search, candidate],
          });

          await candidate.click();
          const personArticle = page.getByRole("article", {
            name: target.fullName,
          });
          await expect(
            personArticle.getByRole("heading", {
              exact: true,
              name: target.fullName,
            })
          ).toBeVisible();
          await expect(
            personArticle.getByText(target.username, { exact: true })
          ).toBeVisible();
          await expect(
            personArticle.getByRole("link", { name: "管理部門主管" })
          ).toHaveAttribute(
            "href",
            /^\/staff\/roles\/department-managers\?returnTo=/u
          );
          await expect(
            personArticle.getByRole("link", { name: "管理聚會負責人" })
          ).toHaveAttribute(
            "href",
            /^\/staff\/roles\/program-leaders\?returnTo=/u
          );
          await expect(
            personArticle.getByRole("link", { name: /管理帳戶身份與委派/u })
          ).toHaveAttribute(
            "href",
            /^\/staff\/roles\/global-roles\?returnTo=/u
          );
          await expect(
            personArticle.getByText("會友", { exact: true })
          ).toHaveCount(2);
          await expect(
            page.getByText(target.email, { exact: true })
          ).toHaveCount(0);

          await page.setViewportSize({ height: 1024, width: 1440 });
          await expect(search).toBeVisible();
          await expect(
            personArticle.getByRole("button", {
              exact: true,
              name: "更換對象",
            })
          ).toBeHidden();
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth
              )
            )
            .toBeLessThanOrEqual(1);
          await page.setViewportSize({ height: 900, width: 1023 });
          await expect(search).toBeHidden();
          await expect(
            personArticle.getByRole("button", { name: "更換對象" })
          ).toBeVisible();
          await page.setViewportSize({ height: 900, width: 1440 });
          await page.locator('div[class*="@container"]').evaluate((element) => {
            (element as HTMLElement).style.maxWidth = "50rem";
          });
          await expect(search).toBeHidden();
          await expect(
            personArticle.getByRole("button", { name: "更換對象" })
          ).toBeVisible();
          await page.locator('div[class*="@container"]').evaluate((element) => {
            (element as HTMLElement).style.maxWidth = "";
          });
          await expect(search).toBeVisible();
          await expect(personArticle).toBeVisible();

          await expect(
            personArticle.getByText(`敬拜部${suffix}`, { exact: true })
          ).toBeVisible();
          await expect(
            personArticle.getByText(`青年部${suffix}`, { exact: true })
          ).not.toBeInViewport();
          await expect(
            personArticle.getByText(`關顧部${suffix}`, { exact: true })
          ).toBeVisible();
          await expect(page.getByText(/1\s*[/／]\s*2/u)).toHaveCount(0);
          await expect(
            personArticle.getByRole("button", { name: "部門第 1 組" })
          ).toHaveAttribute("aria-current", "true");

          const dutyRegion = personArticle.getByRole("region", {
            name: "部門職務內容",
          });
          await personArticle
            .getByRole("button", { name: "下一組部門" })
            .click();
          await expect(
            personArticle.getByText(`青年部${suffix}`, { exact: true })
          ).toBeInViewport();
          await expect(
            personArticle.getByText(`敬拜部${suffix}`, { exact: true })
          ).not.toBeInViewport();
          await expect(
            personArticle.getByRole("button", { name: "部門第 2 組" })
          ).toHaveAttribute("aria-current", "true");
          await dutyRegion.focus();
          await expect(dutyRegion).toBeFocused();
          await page.keyboard.press("ArrowLeft");
          await expect(
            personArticle.getByText(`敬拜部${suffix}`, { exact: true })
          ).toBeInViewport();
          await personArticle
            .getByRole("button", { name: "部門第 2 組" })
            .click();
          await expect(
            personArticle.getByText(`青年部${suffix}`, { exact: true })
          ).toBeInViewport();

          await page.setViewportSize({ height: 844, width: 390 });
          await expect(search).toBeHidden();
          await expect(
            personArticle.getByRole("button", { name: "部門第 2 組" })
          ).toHaveAttribute("aria-current", "true");
          await page.emulateMedia({ reducedMotion: "reduce" });
          await personArticle.getByRole("button", { name: "上一組部門" }).tap();
          await expect(
            personArticle.getByText(`敬拜部${suffix}`, { exact: true })
          ).toBeInViewport();
          if (browserName === "chromium") {
            // CDP injects a native touch gesture; WebKit has no CDP gesture API.
            await dutyRegion.scrollIntoViewIfNeeded();
            const bounds = await dutyRegion.boundingBox();
            if (!bounds) {
              throw new Error("Visible duty region has no touch target");
            }
            const touch = await context.newCDPSession(page);
            try {
              await touch.send("Input.synthesizeScrollGesture", {
                gestureSourceType: "touch",
                preventFling: true,
                speed: 500,
                x: bounds.x + bounds.width * 0.8,
                xDistance: -bounds.width * 0.8,
                y: bounds.y + bounds.height / 2,
                yDistance: 0,
              });
              await expect(
                personArticle.getByRole("button", { name: "部門第 2 組" })
              ).toHaveAttribute("aria-current", "true");
              await expect(
                personArticle.getByText(`青年部${suffix}`, { exact: true })
              ).toBeInViewport();
            } finally {
              await touch.detach();
            }
            await personArticle
              .getByRole("button", { name: "上一組部門" })
              .tap();
            await expect(
              personArticle.getByRole("button", { name: "部門第 1 組" })
            ).toHaveAttribute("aria-current", "true");
          }
          await page.setViewportSize({ height: 568, width: 320 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "32px";
          });
          await expect(personArticle).toBeVisible();
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth - window.innerWidth
              )
            )
            .toBeLessThanOrEqual(1);
          await personArticle
            .getByRole("button", { name: "部門第 2 組" })
            .focus();
          await page.keyboard.press("Enter");
          await expect(
            personArticle.getByRole("button", { name: "部門第 2 組" })
          ).toHaveAttribute("aria-current", "true");
          await personArticle
            .getByText(`青年部${suffix}`, { exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            personArticle.getByText(`青年部${suffix}`, { exact: true })
          ).toBeInViewport();
          const changeTarget = personArticle.getByRole("button", {
            exact: true,
            name: "更換對象",
          });
          await expect(changeTarget).toBeVisible();
          await changeTarget.click();
          await expect(search).toBeVisible();
          await expect(search).toBeFocused();
          await page.setViewportSize({ height: 568, width: 320 });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "32px";
          });
          const title = page.getByRole("heading", {
            level: 1,
            name: "人員權責",
          });
          await title.evaluate((element) => {
            element.textContent = "人員權責與部門聚會職務管理的長標題";
          });
          const titleBox = await title.boundingBox();
          const backBox = await page
            .getByRole("link", { name: "返回管理" })
            .boundingBox();
          expect(titleBox).not.toBeNull();
          expect(backBox).not.toBeNull();
          if (titleBox && backBox) {
            expect(backBox.x + backBox.width).toBeLessThanOrEqual(titleBox.x);
            expect(backBox.y).toBeLessThan(titleBox.y + titleBox.height);
            expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(320);
          }
          await title.evaluate((element) => {
            element.textContent = "人員權責";
          });

          for (const viewport of [
            { height: 568, textScale: 2, width: 320 },
            { height: 1024, textScale: 2, width: 1440 },
            { height: 1024, width: 768 },
          ]) {
            await page.setViewportSize({
              height: viewport.height,
              width: viewport.width,
            });
            await page.evaluate((scale) => {
              document.documentElement.style.fontSize = `${16 * scale}px`;
            }, viewport.textScale ?? 1);
            await expect
              .poll(() =>
                page.evaluate(
                  () => document.documentElement.scrollWidth - window.innerWidth
                )
              )
              .toBeLessThanOrEqual(1);
          }
          await page.evaluate(() => {
            document.documentElement.style.fontSize = "";
          });

          const denied = await page.request.get(
            `/api/v2/roles/people/${encodeURIComponent("missing-user")}`
          );
          expect(denied.status()).toBe(404);
          const body = (await denied.json()) as {
            error?: { code?: string };
          };
          expect(body.error?.code).toBe("not_found");
        } finally {
          await context.close();
        }
      }
    );

    personWorkspaceTest(
      "all 201 Program assignments in one Department remain reachable",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const target = {
          email: `${suffix}@example.com`,
          fullName: `陳多聚會${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-many!",
          role: "member" as const,
          username: `people.many.${suffix}`,
        };
        const targetId = await caseApp.provision.account(target);
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `大型部門${suffix}`)
          .run();
        for (let index = 0; index < 201; index += 1) {
          const programId = randomUUID();
          await caseApp.db
            .prepare(
              "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
            )
            .bind(
              programId,
              departmentId,
              `聚會${String(index).padStart(3, "0")}`
            )
            .run();
          await caseApp.db
            .prepare(
              "insert into program_leader_assignment (id,program_id,user_id,created_at) values (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), programId, targetId)
            .run();
        }
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, admin.username, admin.password);
          await page.goto("/roles/people");
          await page
            .getByRole("searchbox", { name: "姓名或 Username" })
            .fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          const firstPage = await page.request.get(
            `/api/v2/roles/people/${targetId}`
          );
          expect(firstPage.status()).toBe(200);
          expect(await firstPage.json()).toMatchObject({
            data: {
              person: {
                duties: {
                  groups: [{ hasNextProgramsPage: true, programsPage: 1 }],
                  hasNextPage: false,
                  status: "partial",
                },
              },
            },
          });
          const programs = page
            .getByRole("heading", { name: `大型部門${suffix}` })
            .locator("..")
            .locator("dt");
          for (let batch = 0; batch < 9; batch += 1) {
            const expected = Array.from(
              { length: Math.min(25, 201 - batch * 25) },
              (_, index) => `聚會${String(batch * 25 + index).padStart(3, "0")}`
            );
            await expect(programs).toHaveText(expected);
            if (batch < 8) {
              await page.getByRole("button", { name: "下一頁聚會" }).click();
            }
          }
          await expect(
            page.getByRole("button", { name: "下一頁聚會" })
          ).toBeDisabled();
          await expect(
            page.getByText("此人士目前沒有部門或聚會職務。")
          ).toHaveCount(0);
          const finalPage = await page.request.get(
            `/api/v2/roles/people/${targetId}?programDepartment=${departmentId}&programPage=9`
          );
          expect(finalPage.status()).toBe(200);
          expect(await finalPage.json()).toMatchObject({
            data: {
              person: {
                duties: {
                  groups: [
                    {
                      hasNextProgramsPage: false,
                      programs: [{ programName: "聚會200" }],
                      programsPage: 9,
                    },
                  ],
                  status: "partial",
                },
              },
            },
          });
        } finally {
          await context.close();
        }
      }
    );

    personWorkspaceTest(
      "live search and selected detail survive navigation and legacy task return",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const target = {
          email: `${suffix}.navigation@example.com`,
          fullName: `返回對象${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-navigation!",
          role: "member" as const,
          username: `people.navigation.${suffix}`,
        };
        const targetId = await caseApp.provision.account(target);
        for (let index = 0; index < 7; index += 1) {
          await seedDuty({
            caseApp,
            departmentName: `測試分頁部門${index}${suffix}`,
            programName: `分頁聚會${index}${suffix}`,
            targetUserId: targetId,
          });
        }
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          viewport: { height: 900, width: 1440 },
        });
        try {
          const page = await context.newPage();
          await signIn(page, admin.username, admin.password);
          await page.goto("/roles/people");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.dispatchEvent("compositionstart");
          await search.fill(target.username);
          await page.waitForTimeout(350);
          expect(new URL(page.url()).searchParams.get("q")).toBeNull();
          await search.dispatchEvent("compositionend");
          const candidate = page.getByRole("button", {
            name: new RegExp(target.fullName, "u"),
          });
          await expect(candidate).toBeVisible();
          await expect(page).toHaveURL(
            new RegExp(`q=${encodeURIComponent(target.username)}`, "u")
          );
          await candidate.click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await expect(page).toHaveURL(new RegExp(`person=${targetId}`, "u"));
          await page.getByRole("button", { name: "下一批部門" }).click();
          await expect(page).toHaveURL(/assignmentPage=2/u);
          await expect(
            page.getByText(`測試分頁部門6${suffix}`, { exact: true })
          ).toBeVisible();
          await search.fill("no-matching-person");
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await expect(page.getByText(/找不到符合/u)).toBeVisible();
          await page.goBack();
          await expect(search).toHaveValue(target.username);
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await page.goForward();
          await expect(search).toHaveValue("no-matching-person");
          await page.reload();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await expect(search).toHaveValue("no-matching-person");
          await page.getByRole("link", { name: "管理部門主管" }).click();
          await expect(page).toHaveURL(/\/staff\/roles\/department-managers/u);
          await page.getByRole("link", { name: "返回人員權責" }).click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await expect(search).toHaveValue("no-matching-person");
          expect(new URL(page.url()).searchParams.get("person")).toBe(targetId);
          expect(new URL(page.url()).searchParams.get("assignmentPage")).toBe(
            "2"
          );
          await page.goto(
            `/roles/people?q=${encodeURIComponent(target.username)}&page=0&person=${targetId}&assignmentPage=invalid`
          );
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await expect(
            page.getByText(`測試分頁部門0${suffix}`, { exact: true })
          ).toBeVisible();
          await page.goto(
            `/staff/roles/department-managers?returnTo=${encodeURIComponent("https://example.com/roles/people")}`
          );
          await expect(
            page.getByRole("link", { name: "返回管理" })
          ).toHaveAttribute("href", "/staff/accounts");
        } finally {
          await context.close();
        }
      }
    );

    personWorkspaceTest(
      "compact target switching remains available during loading, missing and unavailable detail",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const target = {
          email: `${suffix}.compact@example.com`,
          fullName: `緊湊查閱${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-compact!",
          role: "member" as const,
          username: `people.compact.${suffix}`,
        };
        const targetId = await caseApp.provision.account(target);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          viewport: { height: 844, width: 390 },
        });
        const received = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        let completion: Promise<void> | undefined;
        try {
          const page = await context.newPage();
          await signIn(page, admin.username, admin.password);
          await page.goto("/roles/people");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { name: target.fullName }).click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await page.getByRole("button", { name: "更換對象" }).click();
          await page.route(
            `**/api/v2/roles/people/${targetId}**`,
            async (route) => {
              const response = await route.fetch();
              completion = (async () => {
                await release.promise;
                await route.fulfill({ response });
              })();
              received.resolve(null);
              await completion;
            },
            { times: 1 }
          );
          await page.getByRole("button", { name: target.fullName }).click();
          await received.promise;
          await expect(
            page.getByText("正在載入此人士的職務，請稍候。")
          ).toBeVisible();
          const cancelled = page.waitForEvent(
            "requestfailed",
            (request) =>
              new URL(request.url()).pathname ===
              `/api/v2/roles/people/${targetId}`
          );
          await page.getByRole("button", { name: "更換對象" }).click();
          await expect(search).toBeFocused();
          await cancelled;
          release.resolve(null);
          await completion;
          await page.goto("/roles/people?person=missing-user");
          await expect(page.getByRole("alert")).toContainText(
            "此人士目前不在可管理的範圍內"
          );
          await page.getByRole("button", { name: "更換對象" }).click();
          await expect(search).toBeFocused();
          await page.route(
            `**/api/v2/roles/people/${targetId}**`,
            async (route) => {
              await route.fetch();
              await route.fulfill({
                body: '{"error":{"message":"暫時未能載入"}}',
                contentType: "application/json",
                status: 503,
              });
            },
            { times: 1 }
          );
          await page.goto(`/roles/people?person=${targetId}`);
          await expect(page.getByRole("alert")).toContainText("暫時未能載入");
          await page.getByRole("button", { name: "更換對象" }).click();
          await expect(search).toBeFocused();
        } finally {
          release.resolve(null);
          try {
            await completion;
          } finally {
            await context.close();
          }
        }
      }
    );

    personWorkspaceTest(
      "search stays independent while target replacement cancels the pending detail",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const target = {
          email: `${suffix}.parallel@example.com`,
          fullName: `並行讀取${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-parallel!",
          role: "member" as const,
          username: `people.parallel.${suffix}`,
        };
        const targetId = await caseApp.provision.account(target);
        const replacement = {
          ...target,
          email: `${suffix}.replacement@example.com`,
          fullName: `新選對象${suffix}`,
          username: `people.replacement.${suffix}`,
        };
        await caseApp.provision.account(replacement);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          viewport: { height: 900, width: 1440 },
        });
        const received = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        const replacementReceived = Promise.withResolvers<null>();
        const replacementRelease = Promise.withResolvers<null>();
        let detailCompletion: Promise<void> | undefined;
        let replacementCompletion: Promise<void> | undefined;
        const finishReads = async () => {
          const results = await Promise.allSettled([
            detailCompletion,
            replacementCompletion,
          ]);
          const failures = results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason);
          if (failures.length > 0) {
            throw new AggregateError(
              failures,
              "Held detail handlers could not complete"
            );
          }
        };
        try {
          const page = await context.newPage();
          await signIn(page, admin.username, admin.password);
          await page.goto("/roles/people");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page.route(
            `**/api/v2/roles/people/${targetId}**`,
            async (route) => {
              const response = await route.fetch();
              detailCompletion = (async () => {
                await release.promise;
                await route.fulfill({ response });
              })();
              received.resolve(null);
              await detailCompletion;
            },
            { times: 1 }
          );
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await received.promise;
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await expect(
            page.getByRole("button", { exact: true, name: "搜尋" })
          ).toBeEnabled();
          release.resolve(null);
          await detailCompletion;
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await page.route(
            `**/api/v2/roles/people/${targetId}**`,
            async (route) => {
              const response = await route.fetch();
              replacementCompletion = (async () => {
                await replacementRelease.promise;
                await route.fulfill({ response });
              })();
              replacementReceived.resolve(null);
              await replacementCompletion;
            },
            { times: 1 }
          );
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await replacementReceived.promise;
          await search.fill(replacement.username);
          const replacementCandidate = page.getByRole("button", {
            name: new RegExp(replacement.fullName, "u"),
          });
          await expect(replacementCandidate).toBeEnabled();
          const cancelled = page.waitForEvent(
            "requestfailed",
            (request) =>
              new URL(request.url()).pathname ===
              `/api/v2/roles/people/${targetId}`
          );
          await replacementCandidate.click();
          await cancelled;
          await expect(
            page.getByRole("article", { name: replacement.fullName })
          ).toBeVisible();
          replacementRelease.resolve(null);
          await replacementCompletion;
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByRole("article", { name: replacement.fullName })
          ).toBeVisible();
        } finally {
          release.resolve(null);
          replacementRelease.resolve(null);
          try {
            await finishReads();
          } finally {
            await context.close();
          }
        }
      }
    );

    personWorkspaceTest(
      "an in-flight detail cannot restore data after authority kind changes",
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const target = {
          email: `${suffix}.kind@example.com`,
          fullName: `權限切換${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-kind!",
          role: "member" as const,
          username: `people.kind.${suffix}`,
        };
        const targetId = await caseApp.provision.account(target);
        await caseApp.provision.account({
          email: `${suffix}.backup@example.com`,
          fullName: `後備管理員${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-person-workspace-backup!",
          role: "admin",
          username: `people.backup.${suffix}`,
        });
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          viewport: { height: 900, width: 1440 },
        });
        const received = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        let completion: Promise<void> | undefined;
        try {
          const page = await context.newPage();
          await signIn(page, admin.username, admin.password);
          await page.goto("/roles/people");
          await page
            .getByRole("searchbox", { name: "姓名或 Username" })
            .fill(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page.route(
            `**/api/v2/roles/people/${targetId}**`,
            async (route) => {
              const response = await route.fetch();
              completion = (async () => {
                await release.promise;
                await route.fulfill({ response });
              })();
              received.resolve(null);
              await completion;
            }
          );
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await received.promise;
          await caseApp.db
            .prepare(
              "update person_profile set account_role = 'staff' where user_id = ?"
            )
            .bind(admin.userId)
            .run();
          await caseApp.db
            .prepare(
              "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
            )
            .bind(randomUUID(), admin.userId)
            .run();
          release.resolve(null);
          await completion;
          await expect(page.getByRole("alert")).toContainText("管理權限已改變");
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
        } finally {
          release.resolve(null);
          try {
            await completion;
          } finally {
            await context.close();
          }
        }
      }
    );

    personWorkspaceTest(
      "replacement delegation or denied reads discard the selected person's protected data",
      async ({ browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const assigner = {
          email: `${suffix}.assigner@example.com`,
          fullName: `指派職員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-assigner!",
          role: "staff" as const,
          username: `people.replaced.${suffix}`,
        };
        const assignerId = await caseApp.provision.account(assigner);
        await caseApp.db
          .prepare(
            "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
          )
          .bind(randomUUID(), assignerId)
          .run();
        const target = {
          email: `${suffix}.target@example.com`,
          fullName: `受管理會友${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-target!",
          role: "member" as const,
          username: `people.selected.${suffix}`,
        };
        await caseApp.provision.account(target);
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          viewport: { height: 900, width: 1440 },
        });
        const received = Promise.withResolvers<null>();
        const release = Promise.withResolvers<null>();
        let delivery: Promise<void> | undefined;
        try {
          const page = await context.newPage();
          await signIn(page, assigner.username, assigner.password);
          await page.goto("/roles/people");
          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(target.username);
          await expect(search).toHaveValue(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await page.route(
            "**/api/v2/roles/people?*",
            async (route) => {
              const response = await route.fetch();
              delivery = (async () => {
                await release.promise;
                await route.fulfill({ response });
              })();
              received.resolve(null);
              await delivery;
            },
            { times: 1 }
          );
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await received.promise;
          await caseApp.db
            .prepare("delete from role_assigner_assignment where user_id = ?")
            .bind(assignerId)
            .run();
          await caseApp.db
            .prepare(
              "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
            )
            .bind(randomUUID(), assignerId)
            .run();
          release.resolve(null);
          await delivery;
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
          await page.reload();
          await search.fill(target.username);
          await expect(search).toHaveValue(target.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(target.fullName, "u") })
            .click();
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toBeVisible();
          await caseApp.db
            .prepare("delete from role_assigner_assignment where user_id = ?")
            .bind(assignerId)
            .run();
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await expect(
            page.getByRole("article", { name: target.fullName })
          ).toHaveCount(0);
          await expect(
            page.getByText(target.fullName, { exact: true })
          ).toHaveCount(0);
        } finally {
          release.resolve(null);
          try {
            await delivery;
          } finally {
            await context.close();
          }
        }
      }
    );

    personWorkspaceTest(
      "a Role Assigner reads permitted Members only and cannot open protected Staff",
      async ({ browser, caseApp, extraHTTPHeaders }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
        const assigner = {
          email: `${suffix}@example.com`,
          fullName: `李職務指派${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-assigner!",
          role: "staff" as const,
          username: `people.assigner.${suffix}`,
        };
        await caseApp.provision.account(assigner);
        const assignerId = await caseApp.db
          .prepare("select id from user where display_username = ?")
          .bind(assigner.username)
          .first<{ id: string }>();
        expect(assignerId?.id).toBeTruthy();
        await caseApp.db
          .prepare(
            "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
          )
          .bind(randomUUID(), assignerId?.id)
          .run();

        const member = {
          email: `${suffix}.member@example.com`,
          fullName: `陳受管理會友${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-target!",
          role: "member" as const,
          username: `people.target.${suffix}`,
        };
        const memberId = await caseApp.provision.account(member);
        await seedDuty({
          caseApp,
          departmentName: `教育部${suffix}`,
          programName: `主日學${suffix}`,
          targetUserId: memberId,
        });
        await seedDuty({
          caseApp,
          departmentName: `靈修部${suffix}`,
          programName: `靈修${suffix}`,
          targetUserId: memberId,
        });
        await seedDuty({
          caseApp,
          departmentName: `靈命部${suffix}`,
          programName: `靈命${suffix}`,
          targetUserId: memberId,
        });
        for (const name of ["靈光", "靈恩", "靈樂", "靈福"]) {
          await seedDuty({
            caseApp,
            departmentName: `${name}部${suffix}`,
            programName: `${name}聚會${suffix}`,
            targetUserId: memberId,
          });
        }
        const staff = {
          email: `${suffix}.staff@example.com`,
          fullName: `黃受保護職員${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-person-workspace-protected!",
          role: "staff" as const,
          username: `people.protected.${suffix}`,
        };
        const staffId = await caseApp.provision.account(staff);

        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const page = await context.newPage();
          await signIn(page, assigner.username, assigner.password);
          await page.goto("/staff/accounts");
          await page.getByRole("link", { name: /人員權責/u }).click();
          await expect(page).toHaveURL(/\/roles\/people$/u);
          await expect(
            page.getByRole("link", { name: "返回管理" })
          ).toHaveAttribute("href", "/staff/accounts");

          const search = page.getByRole("searchbox", {
            name: "姓名或 Username",
          });
          await search.fill(member.username);
          await page.getByRole("button", { exact: true, name: "搜尋" }).click();
          await page
            .getByRole("button", { name: new RegExp(member.fullName, "u") })
            .click();
          await expect(
            page.getByRole("heading", {
              level: 4,
              name: `教育部${suffix}`,
            })
          ).toBeVisible();
          await expect(
            page.getByText(`主日學${suffix}`, { exact: true })
          ).toBeVisible();
          await expect(page.getByText("帳戶身份與委派")).toHaveCount(0);
          await expect(
            page.getByText(staff.email, { exact: true })
          ).toHaveCount(0);

          const protectedDetail = await page.request.get(
            `/api/v2/roles/people/${encodeURIComponent(staffId)}`
          );
          expect(protectedDetail.status()).toBe(404);
          const protectedBody = (await protectedDetail.json()) as {
            data?: unknown;
          };
          expect(protectedBody.data).toBeUndefined();

          const protectedSearch = await page.request.get(
            `/api/v2/roles/people?q=${encodeURIComponent(staff.username)}&page=1`
          );
          expect(protectedSearch.status()).toBe(200);
          const protectedSearchBody = (await protectedSearch.json()) as {
            data: { candidates: unknown[] };
          };
          expect(protectedSearchBody.data.candidates).toHaveLength(0);

          const memberDetail = await page.request.get(
            `/api/v2/roles/people/${encodeURIComponent(memberId)}`
          );
          expect(memberDetail.status()).toBe(200);
          const memberBody = (await memberDetail.json()) as {
            data: { person: { actorKind: string; global: unknown } };
          };
          expect(memberBody.data.person.actorKind).toBe("role_assigner");
          expect(memberBody.data.person.global).toBeNull();
          await caseApp.db
            .prepare(
              "update person_profile set account_role = 'staff' where user_id = ?"
            )
            .bind(memberId)
            .run();
          await page.getByRole("button", { name: "下一批部門" }).click();
          await expect(
            page.getByRole("article", { name: member.fullName })
          ).toHaveCount(0);
          await expect(page.getByRole("alert")).toContainText(
            "此人士目前不在可管理的範圍內"
          );
        } finally {
          await context.close();
        }
      }
    );
  }
);

personWorkspaceTest(
  "desktop native horizontal wheel scroll reaches the next Department pair",
  { tag: ["@native", "@browser", "@risk-presentation", "@risk-accessibility"] },
  async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const target = {
      email: `${suffix}.wheel@example.com`,
      fullName: `橫向瀏覽${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-person-workspace-wheel!",
      role: "member" as const,
      username: `people.wheel.${suffix}`,
    };
    const targetId = await caseApp.provision.account(target);
    for (const name of ["A", "B", "C"]) {
      await seedDuty({
        caseApp,
        departmentName: `${name}部${suffix}`,
        programName: `${name}聚會${suffix}`,
        targetUserId: targetId,
      });
    }
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      viewport: { height: 900, width: 1440 },
    });
    try {
      const page = await context.newPage();
      await signIn(page, admin.username, admin.password);
      await page.goto("/roles/people");
      await page
        .getByRole("searchbox", { name: "姓名或 Username" })
        .fill(target.username);
      await page.getByRole("button", { name: target.fullName }).click();
      const article = page.getByRole("article", { name: target.fullName });
      const region = article.getByRole("region", { name: "部門職務內容" });
      await expect(
        article.getByText(`C部${suffix}`, { exact: true })
      ).not.toBeInViewport();
      await region.hover();
      await page.mouse.wheel(900, 0);
      await expect
        .poll(() => region.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await expect(
        article.getByText(`C部${suffix}`, { exact: true })
      ).toBeInViewport();
      await expect(
        article.getByRole("button", { name: "部門第 2 組" })
      ).toHaveAttribute("aria-current", "true");
    } finally {
      await context.close();
    }
  }
);

personWorkspaceTest(
  "bounded literal search distinguishes same-name people and keeps independent detail through invalid search",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-accessibility",
    ],
  },
  async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const people: { userId: string; username: string }[] = [];
    for (let index = 0; index < 26; index += 1) {
      const username = `bounded.${suffix}.${String(index).padStart(2, "0")}`;
      const userId = await caseApp.provision.account({
        email: `${username}@example.com`,
        fullName: `同名會友${suffix}`,
        membershipStatus: "active",
        password: "Synthetic-bounded-person!",
        role: "member",
        username,
      });
      people.push({ userId, username });
    }
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      viewport: { height: 900, width: 1440 },
    });
    try {
      const page = await context.newPage();
      await signIn(page, admin.username, admin.password);
      await page.goto(`/roles/people?q=bounded.${suffix}`);
      const results = page.getByRole("list", { name: "搜尋結果" });
      await expect(results.getByRole("button")).toHaveCount(25);
      const first = await results.getByRole("button").first().textContent();
      const selected = people.find((person) =>
        first?.includes(person.username)
      );
      expect(selected).toBeDefined();
      if (!selected) {
        throw new Error("Bounded search did not identify its displayed person");
      }
      await results.getByRole("button").first().click();
      const article = page.getByRole("article", { name: `同名會友${suffix}` });
      await expect(
        article.getByText(selected.username, { exact: true })
      ).toBeVisible();
      await page.getByRole("button", { exact: true, name: "下一頁" }).click();
      await expect(results.getByRole("button")).toHaveCount(1);
      await expect(article).toBeVisible();
      await expect(results).not.toContainText(selected.username);
      const detail = await page.request.get(
        `/api/v2/roles/people/${selected.userId}`
      );
      expect(detail.status()).toBe(200);
      const body = await detail.text();
      expect(body).not.toContain("@example.com");
      expect(body).not.toContain("password");
      const search = page.getByRole("searchbox", { name: "姓名或 Username" });
      for (const literal of ["%", "_"]) {
        await search.fill(literal);
        await page.getByRole("button", { exact: true, name: "搜尋" }).click();
        await expect(page.getByText(/找不到符合/u)).toBeVisible();
        await expect(results).toHaveCount(0);
        await expect(article).toBeVisible();
      }
      await page.route(
        "**/api/v2/roles/people?*",
        async (route) => {
          await route.fetch();
          await route.fulfill({
            body: '{"error":{"message":"暫時未能搜尋，請再試。"}}',
            contentType: "application/json",
            status: 503,
          });
        },
        { times: 1 }
      );
      await search.fill(`bounded.${suffix}`);
      await page.getByRole("button", { exact: true, name: "搜尋" }).click();
      await expect(page.getByRole("alert")).toContainText("暫時未能搜尋");
      await expect(page.getByText(/找不到符合/u)).toHaveCount(0);
      await expect(article).toBeVisible();
      await page.getByRole("button", { exact: true, name: "搜尋" }).click();
      await expect(results.getByRole("button")).toHaveCount(25);
      await search.fill("王".repeat(101));
      await page.getByRole("button", { exact: true, name: "搜尋" }).click();
      await expect(search).toBeFocused();
      await expect(search).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByRole("alert")).toContainText(
        "最多可輸入 100 個字"
      );
      await expect(
        article.getByText(selected.username, { exact: true })
      ).toBeVisible();
      const invalid = await page.request.get(
        `/api/v2/roles/people?q=${encodeURIComponent("王".repeat(101))}`
      );
      expect(invalid.status()).toBe(400);
    } finally {
      await context.close();
    }
  }
);

personWorkspaceTest(
  "account replacement clears both protected panes and cancels pending search and duty reads",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-session",
      "@risk-authorization",
      "@risk-privacy",
    ],
  },
  async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const nextActor = {
      email: `${suffix}.next@example.com`,
      fullName: `下一位管理員${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-next-person-admin!",
      role: "admin" as const,
      username: `people.next.${suffix}`,
    };
    await caseApp.provision.account(nextActor);
    const target = {
      ...nextActor,
      email: `${suffix}.old-person@example.com`,
      fullName: `舊帳戶所見人士${suffix}`,
      role: "member" as const,
      username: `people.old_person.${suffix}`,
    };
    const targetId = await caseApp.provision.account(target);
    for (let index = 0; index < 7; index += 1) {
      await seedDuty({
        caseApp,
        departmentName: `舊帳戶部門${index}${suffix}`,
        programName: `舊帳戶聚會${index}${suffix}`,
        targetUserId: targetId,
      });
    }
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      viewport: { height: 900, width: 1440 },
    });
    const detailReceived = Promise.withResolvers<null>();
    const searchReceived = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    let detailDelivery: Promise<void> | undefined;
    let searchDelivery: Promise<void> | undefined;
    const finishDeliveries = async () => {
      const results = await Promise.allSettled([
        detailDelivery,
        searchDelivery,
      ]);
      const failures = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Held person read handlers could not complete"
        );
      }
    };
    try {
      const page = await context.newPage();
      await signIn(page, admin.username, admin.password);
      await page.goto(`/roles/people?q=${target.username}&person=${targetId}`);
      await expect(
        page.getByRole("article", { name: target.fullName })
      ).toBeVisible();
      await expect(page.getByRole("list", { name: "搜尋結果" })).toContainText(
        target.username
      );
      await page.route(
        `**/api/v2/roles/people/${targetId}**`,
        async (route) => {
          const response = await route.fetch();
          detailDelivery = (async () => {
            await release.promise;
            await route.fulfill({ response });
          })();
          detailReceived.resolve(null);
          await detailDelivery;
        },
        { times: 1 }
      );
      await page.route(
        "**/api/v2/roles/people?*",
        async (route) => {
          const response = await route.fetch();
          searchDelivery = (async () => {
            await release.promise;
            await route.fulfill({ response });
          })();
          searchReceived.resolve(null);
          await searchDelivery;
        },
        { times: 1 }
      );
      await page.getByRole("button", { name: "下一批部門" }).click();
      await detailReceived.promise;
      await page.getByRole("button", { exact: true, name: "搜尋" }).click();
      await searchReceived.promise;
      const detailCancelled = page.waitForEvent(
        "requestfailed",
        (request) =>
          new URL(request.url()).pathname === `/api/v2/roles/people/${targetId}`
      );
      const searchCancelled = page.waitForEvent("requestfailed", (request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v2/roles/people" &&
          url.searchParams.get("q") === target.username
        );
      });
      const signOut = await context.request.post("/api/auth/sign-out", {
        data: {},
      });
      expect(signOut.status()).toBe(200);
      const otherTab = await context.newPage();
      await signIn(otherTab, nextActor.username, nextActor.password);
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page.getByRole("article", { name: target.fullName })
      ).toHaveCount(0);
      await expect(page.getByRole("list", { name: "搜尋結果" })).toHaveCount(0);
      await expect(
        page.getByRole("searchbox", { name: "姓名或 Username" })
      ).toHaveValue("");
      await Promise.all([detailCancelled, searchCancelled]);
      release.resolve(null);
      await finishDeliveries();
      await expect(
        page.getByText(target.fullName, { exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByText(`舊帳戶部門0${suffix}`, { exact: true })
      ).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get("person")).toBeNull();
    } finally {
      release.resolve(null);
      try {
        await finishDeliveries();
      } finally {
        await context.close();
      }
    }
  }
);

for (const restriction of ["banned", "deactivated"] as const) {
  personWorkspaceTest(
    `an Admin reaches delegation withdrawal and Staff demotion for a ${restriction} Staff target without scoped duties`,
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@risk-authorization",
        "@risk-privacy",
      ],
    },
    async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const target = {
        email: `${suffix}.cleanup@example.com`,
        fullName: `受限職員清理${suffix}`,
        membershipStatus: "active" as const,
        password: "Synthetic-restricted-staff!",
        role: "staff" as const,
        username: `people.cleanup.${suffix}`,
      };
      const targetId = await caseApp.provision.account(target);
      await caseApp.db
        .prepare(
          "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
        )
        .bind(randomUUID(), targetId)
        .run();
      await caseApp.db
        .prepare(
          restriction === "banned"
            ? "update person_profile set banned_at = unixepoch() where user_id = ?"
            : "update person_profile set membership_status = 'deactivated' where user_id = ?"
        )
        .bind(targetId)
        .run();
      const assigner = {
        ...target,
        email: `${suffix}.reader@example.com`,
        fullName: `職務指派讀者${suffix}`,
        username: `people.reader.${suffix}`,
      };
      const assignerId = await caseApp.provision.account(assigner);
      await caseApp.db
        .prepare(
          "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
        )
        .bind(randomUUID(), assignerId)
        .run();
      const delegated = await playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      const context = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      });
      try {
        const login = await delegated.post("/api/auth/sign-in/username", {
          data: { password: assigner.password, username: assigner.username },
        });
        expect(login.status()).toBe(200);
        const hiddenSearch = await delegated.get(
          `/api/v2/roles/people?q=${target.username}`
        );
        expect(hiddenSearch.status()).toBe(200);
        expect(await hiddenSearch.json()).toMatchObject({
          data: { candidates: [] },
        });
        const hiddenDetail = await delegated.get(
          `/api/v2/roles/people/${targetId}`
        );
        expect(hiddenDetail.status()).toBe(404);
        expect(await hiddenDetail.text()).not.toContain(target.fullName);

        const page = await context.newPage();
        await signIn(page, admin.username, admin.password);
        const before = await page.request.get(
          `/api/v2/roles/people/${targetId}`
        );
        expect(before.status()).toBe(200);
        const beforeBody = await before.json();
        expect(beforeBody).toMatchObject({
          data: {
            person: {
              duties: { groups: [] },
              global: {
                eligibleForRoleAssigner: false,
                role: "staff",
                roleAssignerAssignment: { assignmentId: expect.any(String) },
              },
            },
          },
        });
        expect(JSON.stringify(beforeBody)).not.toContain(target.email);
        await page.goto("/roles/people");
        const search = page.getByRole("searchbox", { name: "姓名或 Username" });
        await search.fill(target.username);
        await page.getByRole("button", { name: target.fullName }).click();
        await expect(
          page.getByRole("article", { name: target.fullName })
        ).toBeVisible();
        const taskLink = page.getByRole("link", {
          name: /管理帳戶身份與委派/u,
        });
        await taskLink.click();
        await expect(page).toHaveURL(
          /\/staff\/roles\/global-roles\?returnTo=/u
        );
        await expect(
          page.getByRole("heading", { level: 1, name: "全域角色管理" })
        ).toBeVisible();
        const taskSearch = page.getByRole("searchbox", {
          name: "姓名或 Username",
        });
        await taskSearch.fill(target.username);
        await page.getByRole("button", { exact: true, name: "搜尋" }).click();
        await page.getByRole("button", { name: target.fullName }).click();
        await page
          .getByRole("button", { exact: true, name: "撤回 Role Assigner" })
          .click();
        await page.getByLabel("目前密碼", { exact: true }).fill(admin.password);
        const withdrawalResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/v2/roles/role-assigners"
        );
        await page
          .getByRole("button", { exact: true, name: "確認並撤回" })
          .click();
        const withdrawal = await withdrawalResponse;
        expect(withdrawal.status()).toBe(201);
        expect(await withdrawal.json()).toMatchObject({
          data: { receipt: { action: "withdrawn", targetUserId: targetId } },
        });
        await expect(
          page
            .getByRole("region", { name: target.fullName })
            .getByText("未委派", { exact: true })
        ).toBeVisible();

        await page.getByRole("link", { name: "返回人員權責" }).click();
        await expect(
          page.getByRole("article", { name: target.fullName })
        ).toBeVisible();
        const withoutDelegation = await page.request.get(
          `/api/v2/roles/people/${targetId}`
        );
        expect(withoutDelegation.status()).toBe(200);
        expect(await withoutDelegation.json()).toMatchObject({
          data: {
            person: { global: { role: "staff", roleAssignerAssignment: null } },
          },
        });
        await taskLink.click();
        await expect(page).toHaveURL(
          /\/staff\/roles\/global-roles\?returnTo=/u
        );
        await expect(
          page.getByRole("heading", { level: 1, name: "全域角色管理" })
        ).toBeVisible();
        await taskSearch.fill(target.username);
        await page.getByRole("button", { exact: true, name: "搜尋" }).click();
        await page.getByRole("button", { name: target.fullName }).click();
        await page
          .getByRole("button", { exact: true, name: "改為會員" })
          .click();
        await page.getByLabel("目前密碼", { exact: true }).fill(admin.password);
        const demotionResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/v2/roles/global-roles"
        );
        await page
          .getByRole("button", { exact: true, name: "確認並改為會員" })
          .click();
        const demotion = await demotionResponse;
        expect(demotion.status()).toBe(201);
        expect(await demotion.json()).toMatchObject({
          data: {
            receipt: {
              action: "withdrawn",
              resultingGlobalRole: "member",
              role: "staff",
              targetUserId: targetId,
            },
          },
        });
        await expect(
          page
            .getByRole("region", { name: target.fullName })
            .getByText("會員", { exact: true })
        ).toBeVisible();
      } finally {
        await context.close();
        await delegated.dispose();
      }
    }
  );
}
