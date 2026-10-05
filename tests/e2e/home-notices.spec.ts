import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { buildActivityFixtures } from "../scenarios/activities";
import { waitForSignInWindow } from "../scenarios/limiter";
import { buildNoticeFixtures } from "../scenarios/notices";
import {
  postSeed,
  queryLocalSql,
  runLocalSql,
  seedSyntheticAccounts,
} from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");
const enrolledOnly = findAccount(approvedAccounts, "chen.simplified");
const unrelated = findAccount(approvedAccounts, "ng.wing.yan");

const activities = buildActivityFixtures();
const notices = buildNoticeFixtures();

const enrolmentFixture = (id: string) => {
  const row = activities.enrolments.find((entry) => entry.id === id);
  if (!row) {
    throw new Error(`Missing enrolment fixture ${id}`);
  }
  return row;
};

const openHome = async (
  page: Page,
  account: { password: string; username: string }
) => {
  await waitForSignInWindow();
  const response = await page.request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
};

/** The raw first document response, so a leak cannot be polled away later. */
const reloadHomeHtml = async (page: Page): Promise<string> => {
  const response = await page.reload();
  if (!response) {
    throw new Error("Home reload produced no document response");
  }
  return response.text();
};

const noticesRegion = (page: Page) =>
  page.getByRole("region", { name: "通告" });

interface RowCounts {
  enrolments: number;
  invitations: number;
  notices: number;
}

const readRowCounts = (): RowCounts | undefined =>
  queryLocalSql<RowCounts>(
    "select (select count(*) from enrolment) as enrolments, (select count(*) from invitation) as invitations, (select count(*) from notice) as notices"
  ).at(0);

test.beforeAll(async () => {
  await seedSyntheticAccounts();
  await postSeed({
    ...activities,
    ...notices,
    resetActivities: true,
  });
});

test("church notices reach everyone while unpublished and expired ones stay out", async ({
  page,
}) => {
  await openHome(page, unrelated);
  const region = noticesRegion(page);

  await expect(region.getByText("教會週報")).toBeVisible();
  await expect(region.getByText("未發佈通告")).toHaveCount(0);
  await expect(region.getByText("已過期通告")).toHaveCount(0);
  // No scope this person is not part of.
  await expect(region.getByText("敬拜部消息")).toHaveCount(0);
  await expect(region.getByText("關顧部消息")).toHaveCount(0);
  await expect(region.getByText("主日崇拜消息")).toHaveCount(0);
});

test("an assigned Department Manager sees the notice without membership", async ({
  page,
}) => {
  await openHome(page, wong);
  const region = noticesRegion(page);

  await expect(region.getByText("教會週報")).toBeVisible();
  await expect(region.getByText("敬拜部消息")).toBeVisible();
  // The Program notice is in scope through the managed Department.
  await expect(region.getByText("主日崇拜消息")).toBeVisible();
  // A Department this person has no scope in stays excluded.
  await expect(region.getByText("關顧部消息")).toHaveCount(0);
});

test("a Department member and a Program enrolee each see their own scope", async ({
  page,
}) => {
  await openHome(page, chan);
  await expect(noticesRegion(page).getByText("敬拜部消息")).toBeVisible();
  // Ordinary Department membership does not grant another Program's notices.
  await expect(noticesRegion(page).getByText("主日崇拜消息")).toHaveCount(0);
  expect(await reloadHomeHtml(page)).not.toContain("主日崇拜消息");
  await expect(noticesRegion(page).getByText("關顧部消息")).toHaveCount(0);

  await openHome(page, enrolledOnly);
  const region = noticesRegion(page);
  await expect(region.getByText("主日崇拜消息")).toBeVisible();
  await expect(region.getByText("敬拜部消息")).toHaveCount(0);
  await expect(region.getByText("關顧部消息")).toHaveCount(0);
});

test("withdrawing the assignment removes only that notice scope", async ({
  page,
}) => {
  await openHome(page, wong);
  await expect(noticesRegion(page).getByText("敬拜部消息")).toBeVisible();
  await expect(page.getByRole("region", { name: "即將參與" })).toContainText(
    "主日崇拜"
  );

  // Withdraw only the manager assignment in the disposable fixture.
  runLocalSql(
    "delete from department_manager_assignment where id = 'mgr-worship-wong'"
  );

  await page.reload();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  // The Department notice was granted by the assignment and is gone.
  await expect(noticesRegion(page).getByText("敬拜部消息")).toHaveCount(0);
  await expect(noticesRegion(page).getByText("教會週報")).toBeVisible();
  // The Program notice stays: this person is enrolled in that Program.
  await expect(noticesRegion(page).getByText("主日崇拜消息")).toBeVisible();
  // Unrelated participation and access remain valid.
  await expect(page.getByRole("region", { name: "即將參與" })).toContainText(
    "主日崇拜"
  );

  // Restore the assignment for later runs.
  await postSeed({
    departmentManagerAssignments: notices.departmentManagerAssignments,
  });
});

test("an inactive enrolment removes Program-notice scope on the next response", async ({
  page,
}) => {
  const chenEnrolment = enrolmentFixture("enr-sunday-chen");

  // Assert on the first document response after each committed change:
  // locator retries could otherwise poll past an earlier leak.
  const expectHiddenAfter = async (
    status: "cancelled" | "rejected" | "withdrawn"
  ) => {
    await postSeed({ enrolments: [{ ...chenEnrolment, status }] });
    const html = await reloadHomeHtml(page);
    expect(html).not.toContain("主日崇拜消息");
    // The church notice and the rest of Home stay unaffected.
    expect(html).toContain("教會週報");
  };

  try {
    await openHome(page, enrolledOnly);
    // The current enrolment supplies the Program notice on the first response.
    await expect(noticesRegion(page).getByText("主日崇拜消息")).toBeVisible();
    await expect(noticesRegion(page).getByText("教會週報")).toBeVisible();

    await expectHiddenAfter("withdrawn");
    await expectHiddenAfter("rejected");
    await expectHiddenAfter("cancelled");
  } finally {
    await postSeed({ enrolments: [chenEnrolment] });
  }
});

test("a Department manager keeps Program-notice scope despite an inactive enrolment", async ({
  page,
}) => {
  const wongEnrolment = enrolmentFixture("enr-sunday-wong");

  try {
    await openHome(page, wong);
    await expect(noticesRegion(page).getByText("主日崇拜消息")).toBeVisible();

    // Deactivate the manager's own enrolment in that Program.
    await postSeed({ enrolments: [{ ...wongEnrolment, status: "withdrawn" }] });

    // Scope still comes from the current manager assignment of the owning
    // Department, and unrelated participation remains on the same response.
    const html = await reloadHomeHtml(page);
    expect(html).toContain("主日崇拜消息");
    expect(html).toContain("教會週報");
    expect(html).toContain("青年小組");
  } finally {
    await postSeed({ enrolments: [wongEnrolment] });
  }
});

test("reading notices never mutates business rows", async ({ page }) => {
  await openHome(page, wong);
  const before = readRowCounts();

  await page.reload();
  await expect(noticesRegion(page).getByText("教會週報")).toBeVisible();

  expect(readRowCounts()).toEqual(before);
});

test("a Program notice keeps its own label when a Department shares its ID", async ({
  page,
}) => {
  await postSeed({
    enrolments: [
      {
        id: "enr-colliding-scope-chen",
        programId: "dept-worship",
        status: "approved",
        username: enrolledOnly.username,
      },
    ],
    notices: [
      {
        body: "僅此節目參與者可讀。",
        id: "notice-colliding-program-scope",
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        scopeId: "dept-worship",
        scopeType: "program",
        title: "同 ID 範圍通告",
      },
    ],
    programs: [
      { departmentId: "dept-care", id: "dept-worship", name: "跨資料表節目" },
    ],
  });
  await openHome(page, enrolledOnly);
  const entry = noticesRegion(page).locator("li", {
    hasText: "同 ID 範圍通告",
  });
  await expect(entry).toContainText("跨資料表節目");
  await expect(entry).not.toContainText("敬拜部");
});

test("a malformed church target stays hidden even when SQL checks are bypassed", async ({
  page,
}) => {
  runLocalSql(
    "PRAGMA ignore_check_constraints = ON; insert into notice (id, title, body, scope_type, scope_id, created_at, published_at) values ('notice-invalid-church-target', '不完整範圍通告', '不應顯示的內容', 'church', 'dept-care', unixepoch(), unixepoch() - 60)"
  );
  try {
    await openHome(page, unrelated);
    await expect(noticesRegion(page).getByText("不完整範圍通告")).toHaveCount(
      0
    );
    expect(await reloadHomeHtml(page)).not.toContain("不應顯示的內容");
  } finally {
    runLocalSql("delete from notice where id = 'notice-invalid-church-target'");
  }
});
