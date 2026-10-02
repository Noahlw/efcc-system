import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { buildActivityFixtures } from "../scenarios/activities";
import { waitForSignInWindow } from "../scenarios/limiter";
import { postSeed, seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");
const emptyPerson = findAccount(approvedAccounts, "ng.wing.yan");

const fixtures = buildActivityFixtures();

const signIn = async (
  api: APIRequestContext,
  username: string,
  password: string
) => {
  await waitForSignInWindow();
  return api.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
};

const openHome = async (
  page: Page,
  account: { password: string; username: string }
) => {
  const response = await signIn(
    page.request,
    account.username,
    account.password
  );
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
};

test.beforeAll(async () => {
  await seedSyntheticAccounts();
  await postSeed({ resetActivities: true, ...fixtures });
});

test("approved participation lists ordered upcoming occurrences with context", async ({
  page,
}) => {
  await openHome(page, wong);

  const participation = page.getByRole("region", { name: "我的參與" });
  await expect(participation.getByText("主日崇拜").first()).toBeVisible();
  await expect(participation.getByText("敬拜部").first()).toBeVisible();
  await expect(participation.getByText("已確認").first()).toBeVisible();

  // Two upcoming occurrences, ordered by start time, in Hong Kong 24-hour form.
  const times = participation.locator("time");
  await expect(times).toHaveCount(2);
  const rendered = await times.allTextContents();
  expect(rendered[0]).toMatch(/^\d{1,2}月\d{1,2}日週. \d{2}:\d{2}$/u);
  // 02:30 UTC on the first occurrence is 10:30 in Hong Kong.
  expect(rendered[0]).toContain("10:30");
  expect(rendered[0]).not.toContain("02:30");
  expect(rendered[1]).not.toBe(rendered[0]);

  // Approved participation without an upcoming occurrence stays visible.
  await expect(participation.getByText("探訪服侍")).toBeVisible();
  await expect(
    participation.getByText("目前沒有即將舉行的聚會。")
  ).toBeVisible();
});

test("pending and waitlisted participation is labelled without events", async ({
  page,
}) => {
  await openHome(page, wong);
  const participation = page.getByRole("region", { name: "我的參與" });

  const pendingRow = participation
    .locator("li", { hasText: "青年小組" })
    .first();
  await expect(pendingRow.getByText("待批核")).toBeVisible();
  await expect(
    pendingRow.getByText("此狀態未代表已確認出席聚會。")
  ).toBeVisible();
  // The Program's occurrence must not read as confirmed attendance.
  await expect(pendingRow.locator("time")).toHaveCount(0);

  await signIn(page.request, chan.username, chan.password);
  await page.goto("/");
  const waitlistedRow = page
    .getByRole("region", { name: "我的參與" })
    .locator("li", { hasText: "詩班" })
    .first();
  await expect(waitlistedRow.getByText("候補中")).toBeVisible();
  await expect(waitlistedRow.locator("time")).toHaveCount(0);
});

test("excluded participation states and invalid invitations never appear", async ({
  page,
}) => {
  await openHome(page, chan);
  const participation = page.getByRole("region", { name: "我的參與" });
  const invitations = page.getByRole("region", { name: "我的邀請" });

  // Only the approved enrolment for this person is present.
  await expect(participation.getByText("週三祈禱會").first()).toBeVisible();
  await expect(participation.getByText("已確認").first()).toBeVisible();

  // Valid invitation shown; expired and revoked ones are excluded.
  await expect(invitations.getByText("探訪服侍")).toBeVisible();
  await expect(invitations.getByText("主日崇拜")).toHaveCount(0);
  await expect(invitations.getByText("青年小組")).toHaveCount(0);
});

test("a person with no eligible data gets a successful empty state", async ({
  page,
}) => {
  await openHome(page, emptyPerson);
  await expect(
    page.getByText("你目前沒有即將舉行的活動或邀請。")
  ).toBeVisible();
  await expect(page.getByText("目前沒有參與的節目。")).toBeVisible();
  await expect(page.getByText("目前沒有有效的邀請。")).toBeVisible();
});

test("two people never see each other's participation or invitations", async ({
  page,
}) => {
  await openHome(page, wong);
  await expect(page.getByText("週三祈禱會")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "我的邀請" }).getByText("探訪服侍")
  ).toHaveCount(0);

  await signIn(page.request, chan.username, chan.password);
  await page.goto("/");
  await expect(page.getByText("青年小組")).toHaveCount(0);
  await expect(page.getByText("羅待批")).toHaveCount(0);
});

test("client identifiers cannot select another person's data", async ({
  page,
}) => {
  await openHome(page, wong);
  const response = await page.request.get(
    `/api/v2/me?userId=${encodeURIComponent("someone-else")}&username=chan.siu.fong`
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      displayName: wong.fullName,
      membershipStatus: "active",
      username: wong.username,
    },
  });
});

test("a new occurrence appears on the next Home request", async ({ page }) => {
  await openHome(page, wong);
  const participation = page.getByRole("region", { name: "我的參與" });
  await expect(participation.locator("time")).toHaveCount(2);

  const extraEvent = {
    id: "evt-sunday-new",
    programId: "prog-sunday-service",
    startsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    title: "主日崇拜",
  };
  await postSeed({ events: [extraEvent] });

  await page.reload();
  await expect(
    page.getByRole("region", { name: "我的參與" }).locator("time")
  ).toHaveCount(3);
});
