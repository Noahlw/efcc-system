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
  // Department membership also covers that Department's Program notices,
  // although this person is not enrolled in that Program.
  await expect(noticesRegion(page).getByText("主日崇拜消息")).toBeVisible();
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
  await expect(page.getByRole("region", { name: "我的參與" })).toContainText(
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
  await expect(page.getByRole("region", { name: "我的參與" })).toContainText(
    "主日崇拜"
  );

  // Restore the assignment for later runs.
  await postSeed({
    departmentManagerAssignments: notices.departmentManagerAssignments,
  });
});

test("reading notices never mutates business rows", async ({ page }) => {
  await openHome(page, wong);
  const before = readRowCounts();

  await page.reload();
  await expect(noticesRegion(page).getByText("教會週報")).toBeVisible();

  expect(readRowCounts()).toEqual(before);
});
