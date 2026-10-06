import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

import {
  getChurchDateKey,
  getChurchWeekDates,
} from "../../src/shared/time/church-time";
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

  const participation = page.getByRole("region", { name: "即將參與" });
  await expect(participation.getByText("主日崇拜").first()).toBeVisible();
  await expect(participation.getByText("敬拜部").first()).toBeVisible();
  await expect(participation.getByText("報名已批准").first()).toBeVisible();

  // Two upcoming occurrences, ordered by start time, in Hong Kong 24-hour form.
  const times = participation.locator("time");
  await expect(times).toHaveCount(2);
  const rendered = await times.evaluateAll((items) =>
    items.map((time) => time.getAttribute("datetime"))
  );
  expect(rendered).toEqual([
    fixtures.events.find((event) => event.id === "evt-sunday-soon")?.startsAt,
    fixtures.events.find((event) => event.id === "evt-sunday-later")?.startsAt,
  ]);
  // 02:30 UTC on the first occurrence is 10:30 in Hong Kong.
  await expect(participation.getByText("10:30").first()).toBeVisible();
  await expect(participation.getByText("02:30")).toHaveCount(0);

  // Approved participation without an upcoming occurrence stays visible.
  const approvedWithoutEvents = page.getByRole("region", {
    name: "已批准，但目前沒有即將舉行的聚會",
  });
  await expect(approvedWithoutEvents.getByText("探訪服侍")).toBeVisible();
  await expect(
    approvedWithoutEvents.getByText("目前沒有即將舉行的聚會。")
  ).toBeVisible();
});

test("pending and waitlisted participation is labelled without events", async ({
  page,
}) => {
  await openHome(page, wong);
  const participation = page.getByRole("region", {
    name: "其他報名狀態",
  });

  const pendingRow = participation
    .locator("li", { hasText: "青年小組" })
    .first();
  await expect(pendingRow.getByText("待批核")).toBeVisible();
  await expect(
    pendingRow.getByText("尚未獲批核，暫不列入即將聚會。")
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "即將參與" }).getByText("青年小組")
  ).toHaveCount(0);

  await signIn(page.request, chan.username, chan.password);
  await page.goto("/");
  const waitlistedRow = page
    .getByRole("region", { name: "其他報名狀態" })
    .locator("li", { hasText: "詩班" })
    .first();
  await expect(waitlistedRow.getByText("候補中")).toBeVisible();
  await expect(
    waitlistedRow.getByText("候補尚未確認，暫不列入即將聚會。")
  ).toBeVisible();
});

test("excluded participation states and invalid invitations never appear", async ({
  page,
}) => {
  await openHome(page, chan);
  const participation = page.getByRole("region", { name: "即將參與" });
  const invitations = page.getByRole("region", { name: "我的邀請" });

  // Only the approved enrolment for this person is present.
  await expect(participation.getByText("週三祈禱會").first()).toBeVisible();
  await expect(participation.getByText("報名已批准").first()).toBeVisible();

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
  await expect(
    page
      .getByRole("region", { name: "即將參與" })
      .getByText("目前沒有即將舉行的聚會。")
  ).toBeVisible();
  await expect(page.getByText("目前沒有有效的邀請。")).toBeVisible();
});

test("Home date filtering starts with all upcoming Events and resets without hiding future weeks", async ({
  page,
}) => {
  await openHome(page, wong);
  const upcoming = page.getByRole("region", { name: "即將參與" });
  const eventList = upcoming.locator("ol > li");
  const allButton = upcoming.getByRole("button", {
    exact: true,
    name: "全部",
  });
  await expect(allButton).toHaveAttribute("aria-pressed", "true");
  await expect(eventList).toHaveCount(2);

  const firstEvent = fixtures.events.find(
    (event) => event.id === "evt-sunday-soon"
  );
  const nextEvent = fixtures.events.find(
    (event) => event.id === "evt-sunday-later"
  );
  if (!(firstEvent && nextEvent)) {
    throw new Error("Missing upcoming event fixtures");
  }
  const today = getChurchDateKey(new Date());
  const firstDate = getChurchDateKey(new Date(firstEvent.startsAt));
  const nextDate = getChurchDateKey(new Date(nextEvent.startsAt));
  const currentWeek = getChurchWeekDates(today);
  const firstWeek = getChurchWeekDates(firstDate);
  const weekOffset =
    (Date.parse(`${firstWeek[0]}T00:00:00.000Z`) -
      Date.parse(`${currentWeek[0]}T00:00:00.000Z`)) /
    (7 * 86_400_000);
  expect(weekOffset).toBeGreaterThanOrEqual(0);

  if (weekOffset === 1) {
    await upcoming.getByRole("button", { name: "下一週" }).click();
  }
  expect(weekOffset).toBeLessThanOrEqual(1);
  const firstDateButton = page.locator(`[data-home-date="${firstDate}"]`);
  await expect(firstDateButton).toBeEnabled();
  await firstDateButton.click();
  await expect(eventList).toHaveCount(1);
  await expect(eventList.locator("time")).toHaveAttribute(
    "datetime",
    firstEvent.startsAt
  );

  await upcoming.getByRole("button", { name: "下一週" }).click();
  const nextDateButton = page.locator(`[data-home-date="${nextDate}"]`);
  await expect(nextDateButton).toBeVisible();
  await nextDateButton.click();
  await expect(eventList).toHaveCount(1);
  await expect(eventList.locator("time")).toHaveAttribute(
    "datetime",
    nextEvent.startsAt
  );

  await allButton.click();
  await expect(allButton).toHaveAttribute("aria-pressed", "true");
  await expect(eventList).toHaveCount(2);
  await expect(upcoming.getByRole("button", { name: "上一週" })).toBeDisabled();
});

test("Home calendar targets reflow inside its strip at 320px and 200% text", async ({
  page,
}) => {
  await openHome(page, wong);
  await page.setViewportSize({ height: 740, width: 320 });

  const dateStrip = page.getByRole("group", { name: "選擇日期" });
  const firstDay = dateStrip.getByRole("button").first();
  const targetSize = await firstDay.boundingBox();
  expect(targetSize?.width).toBeGreaterThanOrEqual(44);
  expect(targetSize?.height).toBeGreaterThanOrEqual(44);
  const stripSize = await dateStrip.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(stripSize.scrollWidth).toBeGreaterThan(stripSize.clientWidth);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const pageWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );
  expect(pageWidth).toBeLessThanOrEqual(320);
});

test("Account owns personal details while Home stays focused on participation", async ({
  page,
}) => {
  await openHome(page, wong);
  await expect(page.getByText(wong.username, { exact: true })).toHaveCount(0);
  await expect(page.getByText(wong.email, { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "帳戶" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "帳戶" })
  ).toBeVisible();
  await expect(
    page.getByText(wong.fullName, { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText(wong.username, { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText(wong.email, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "帳戶狀態" })).toBeVisible();
  await expect(page.getByRole("link", { name: "我的申請" })).toBeVisible();

  await page.setViewportSize({ height: 740, width: 320 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const pageWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );
  expect(pageWidth).toBeLessThanOrEqual(320);
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
  const participation = page.getByRole("region", { name: "即將參與" });
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
    page.getByRole("region", { name: "即將參與" }).locator("time")
  ).toHaveCount(3);
});

test("upcoming occurrences are globally ordered across Programs", async ({
  page,
}) => {
  const sundaySoon = fixtures.events.find(
    (event) => event.id === "evt-sunday-soon"
  );
  const sundayLater = fixtures.events.find(
    (event) => event.id === "evt-sunday-later"
  );
  if (!(sundaySoon && sundayLater)) {
    throw new Error("Missing Sunday fixtures");
  }
  const careSoon = {
    id: "evt-care-first",
    programId: "prog-care-visit",
    startsAt: new Date(
      Date.parse(sundaySoon.startsAt) - 86_400_000
    ).toISOString(),
    title: "早場探訪",
  };
  const careLater = {
    ...careSoon,
    id: "evt-care-middle",
    startsAt: new Date(
      Date.parse(sundaySoon.startsAt) + 3 * 86_400_000
    ).toISOString(),
    title: "午場探訪",
  };
  await postSeed({
    resetActivities: true,
    ...fixtures,
    events: [...fixtures.events, careSoon, careLater],
  });
  try {
    await openHome(page, wong);
    const participation = page.getByRole("region", { name: "即將參與" });
    expect(
      await participation
        .locator("time")
        .evaluateAll((times) =>
          times.map((time) => time.getAttribute("datetime"))
        )
    ).toEqual([
      careSoon.startsAt,
      sundaySoon.startsAt,
      careLater.startsAt,
      sundayLater.startsAt,
    ]);
    const firstEvent = participation.getByRole("listitem").first();
    await expect(
      firstEvent.getByText("探訪服侍", { exact: true })
    ).toBeVisible();
    await expect(firstEvent.getByText("關顧部", { exact: true })).toBeVisible();
    await expect(
      firstEvent.getByText("報名已批准", { exact: true })
    ).toBeVisible();
  } finally {
    await postSeed({ resetActivities: true, ...fixtures });
  }
});
