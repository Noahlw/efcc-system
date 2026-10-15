import {
  getChurchDateKey,
  getChurchWeekDates,
} from "../../src/shared/time/church-time";
import { test as nativeTest } from "../support/fixtures";
/* eslint-disable no-await-in-loop -- Calendar navigation exercises sequential real week controls. */
import { dedicatedTest, expect, test } from "../support/home";

test(
  "approved participation lists ordered upcoming occurrences with context",
  {
    tag: [
      "@native",
      "@browser",
      "@home",
      "@risk-privacy",
      "@risk-compatibility",
    ],
  },
  async ({ homePages, home: { activities: fixtures } }) => {
    const page = homePages["wong.tai.ming"];
    await page.goto("/");

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
      fixtures.events.find((event) => event.id === "evt-sunday-later")
        ?.startsAt,
    ]);
    // 02:30 UTC on the first occurrence is 10:30 in Hong Kong.
    await expect(participation.getByText("10:30").first()).toBeVisible();
    await expect(participation.getByText("02:30")).toHaveCount(0);

    // Approved participation without an upcoming occurrence stays visible.
    const approvedWithoutEvents = page
      .getByRole("region", { name: "參與狀態" })
      .locator("li", { hasText: "探訪服侍" });
    await expect(approvedWithoutEvents.getByText("探訪服侍")).toBeVisible();
    await expect(
      approvedWithoutEvents.getByText("目前沒有即將舉行的聚會。")
    ).toBeVisible();
  }
);

test(
  "pending and waitlisted participation is labelled without events",
  { tag: ["@native", "@browser", "@home", "@risk-privacy"] },
  async ({ homePages }) => {
    let page = homePages["wong.tai.ming"];
    await page.goto("/");
    const participation = page.getByRole("region", {
      name: "參與狀態",
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

    page = homePages["Chan.Siu.Fong"];
    await page.goto("/");
    const waitlistedRow = page
      .getByRole("region", { name: "參與狀態" })
      .locator("li", { hasText: "詩班" })
      .first();
    await expect(waitlistedRow.getByText("候補中")).toBeVisible();
    await expect(
      waitlistedRow.getByText("候補尚未確認，暫不列入即將聚會。")
    ).toBeVisible();
  }
);

test(
  "excluded participation states and invalid invitations never appear",
  { tag: ["@native", "@browser", "@home", "@risk-privacy"] },
  async ({ homePages }) => {
    const page = homePages["Chan.Siu.Fong"];
    await page.goto("/");
    const participation = page.getByRole("region", { name: "即將參與" });
    const invitations = page.getByRole("region", { name: "有效邀請" });

    // Only the approved enrolment for this person is present.
    await expect(participation.getByText("週三祈禱會").first()).toBeVisible();
    await expect(participation.getByText("報名已批准").first()).toBeVisible();

    // Valid invitation shown; expired and revoked ones are excluded.
    await expect(invitations.getByText("探訪服侍")).toBeVisible();
    await expect(invitations.getByText("主日崇拜")).toHaveCount(0);
    await expect(invitations.getByText("青年小組")).toHaveCount(0);
  }
);

nativeTest(
  "a person with no eligible data gets a successful empty state",
  { tag: ["@native", "@browser", "@home", "@risk-privacy"] },
  async ({ signedInPage: page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "即將參與" }).locator("ol > li")
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "參與狀態" }).locator("li")
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "有效邀請" }).locator("li")
    ).toHaveCount(0);
  }
);

test(
  "Home date filtering starts with all upcoming Events and resets without hiding future weeks",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@home",
      "@risk-compatibility",
    ],
  },
  async ({ homePages, home: { activities: fixtures } }) => {
    const page = homePages["wong.tai.ming"];
    await page.goto("/");
    // Preserve the original built-client load observation before calendar input.
    await page.waitForLoadState("networkidle");
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
    await expect(
      upcoming.getByRole("button", { name: "上一週" })
    ).toBeDisabled();

    // Independent calendar oracle: next 1 January from today's Hong Kong year.
    const hongKongYear = Number(
      new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
      }).format(new Date())
    );
    const january = new Date(Date.UTC(hongKongYear + 1, 0, 1));
    const boundaryDate = january.toISOString().slice(0, 10);
    const januaryMonday = new Date(january);
    januaryMonday.setUTCDate(
      january.getUTCDate() - ((january.getUTCDay() + 6) % 7)
    );
    const dateButtons = upcoming.locator("[data-home-date]");
    const initialDates = await dateButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.dataset.homeDate)
    );
    const startsAtBoundary = initialDates.includes(boundaryDate);
    let advances = 0;
    while (
      (await upcoming.locator(`[data-home-date="${boundaryDate}"]`).count()) ===
        0 &&
      advances < 53
    ) {
      const firstBefore = await dateButtons
        .first()
        .getAttribute("data-home-date");
      await upcoming.getByRole("button", { name: "下一週" }).click();
      await expect(dateButtons.first()).not.toHaveAttribute(
        "data-home-date",
        firstBefore ?? ""
      );
      advances += 1;
    }
    await expect(
      upcoming.locator(`[data-home-date="${boundaryDate}"]`)
    ).toBeVisible();
    await upcoming.locator(`[data-home-date="${boundaryDate}"]`).click();
    await expect(
      upcoming.locator(`[data-home-date="${boundaryDate}"]`)
    ).toHaveAttribute("aria-pressed", "true");
    await expect(allButton).toHaveAttribute("aria-pressed", "false");
    if (startsAtBoundary) {
      await upcoming.getByRole("button", { name: "下一週" }).click();
      await expect(dateButtons.first()).toHaveAttribute(
        "data-home-date",
        new Date(januaryMonday.getTime() + 7 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      );
      januaryMonday.setUTCDate(januaryMonday.getUTCDate() + 7);
    }
    const expectedDates = Array.from({ length: 7 }, (_, offset) =>
      new Date(januaryMonday.getTime() + offset * 86_400_000)
        .toISOString()
        .slice(0, 10)
    );
    expect(
      await dateButtons.evaluateAll((buttons) =>
        buttons.map((button) => button.dataset.homeDate)
      )
    ).toEqual(expectedDates);
    const firstDay = new Date(`${expectedDates[0]}T00:00:00Z`);
    const lastDay = new Date(`${expectedDates[6]}T00:00:00Z`);
    const monthContext = upcoming.locator('p[aria-live="polite"]');
    const firstMonth = `${firstDay.getUTCFullYear()} 年 ${firstDay.getUTCMonth() + 1} 月`;
    const lastMonth = `${lastDay.getUTCFullYear()} 年 ${lastDay.getUTCMonth() + 1} 月`;
    await expect(monthContext).toHaveText(
      firstMonth === lastMonth ? firstMonth : `${firstMonth} – ${lastMonth}`
    );
    await allButton.click();
    await expect(allButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      upcoming.getByRole("button", { name: "上一週" })
    ).toBeDisabled();
    expect(
      await eventList
        .locator("time")
        .evaluateAll((times) =>
          times.map((time) => time.getAttribute("datetime"))
        )
    ).toEqual([firstEvent.startsAt, nextEvent.startsAt]);
  }
);

test(
  "Home calendar targets reflow inside its strip at 320px and 200% text",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@home",
      "@risk-accessibility",
    ],
  },
  async ({ homePages }) => {
    const page = homePages["wong.tai.ming"];
    await page.goto("/");
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
  }
);

test(
  "Account owns personal details while Home stays focused on participation",
  {
    tag: ["@native", "@browser", "@mobile-critical", "@risk-privacy", "@home"],
  },
  async ({ homePages, home: { accounts } }) => {
    const wong = accounts["wong.tai.ming"];
    const page = homePages["wong.tai.ming"];
    await page.goto("/");
    await expect(page.getByText(wong.email, { exact: true })).toHaveCount(0);

    await page.getByRole("link", { exact: true, name: "帳戶" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "帳戶" })
    ).toBeVisible();
    const personalDetails = page.getByRole("region", { name: "個人資料" });
    await expect(
      personalDetails.getByText(wong.fullName, { exact: true })
    ).toBeVisible();
    await expect(
      personalDetails.getByText(wong.username, { exact: true })
    ).toBeVisible();
    await expect(
      personalDetails.getByText(wong.email, { exact: true })
    ).toBeVisible();
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
  }
);

test(
  "two people never see each other's participation or invitations",
  { tag: ["@native", "@browser", "@risk-privacy", "@home"] },
  async ({ homePages }) => {
    let page = homePages["wong.tai.ming"];
    await page.goto("/");
    await expect(page.getByText("週三祈禱會")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "有效邀請" }).getByText("探訪服侍")
    ).toHaveCount(0);

    page = homePages["Chan.Siu.Fong"];
    await page.goto("/");
    await expect(page.getByText("青年小組")).toHaveCount(0);
    await expect(page.getByText("羅待批")).toHaveCount(0);
  }
);

test(
  "client identifiers cannot select another person's data",
  { tag: ["@native", "@http", "@home", "@risk-privacy"] },
  async ({ homeRequests, home: { accounts } }) => {
    const wong = accounts["wong.tai.ming"];
    const response = await homeRequests["wong.tai.ming"].get(
      `/api/v2/me?userId=${encodeURIComponent("someone-else")}&username=${encodeURIComponent(accounts["Chan.Siu.Fong"].username)}`
    );
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        displayName: wong.fullName,
        membershipStatus: "active",
        username: wong.username,
      },
    });
  }
);

test(
  "a new occurrence appears on the next Home request",
  { tag: ["@native", "@browser", "@home", "@risk-freshness"] },
  async ({ homePages, caseApp, home: { namespace } }) => {
    const page = homePages["wong.tai.ming"];
    await page.goto("/");
    const participation = page.getByRole("region", { name: "即將參與" });
    await expect(participation.locator("time")).toHaveCount(2);

    const extraEvent = {
      id: "evt-sunday-new",
      programId: "prog-sunday-service",
      startsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      title: "主日崇拜",
    };
    await caseApp.db
      .prepare(
        "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
      )
      .bind(
        namespace + extraEvent.id,
        namespace + extraEvent.programId,
        extraEvent.title,
        Date.parse(extraEvent.startsAt) / 1000
      )
      .run();

    await page.reload();
    await expect(
      page.getByRole("region", { name: "即將參與" }).locator("time")
    ).toHaveCount(3);
  }
);

dedicatedTest(
  "upcoming occurrences are globally ordered across Programs",
  { tag: ["@native", "@browser", "@home", "@risk-compatibility"] },
  async ({ homePages, caseApp, home: { activities: fixtures } }) => {
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
    for (const event of [careSoon, careLater]) {
      await caseApp.db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(
          event.id,
          event.programId,
          event.title,
          Date.parse(event.startsAt) / 1000
        )
        .run();
    }
    const page = homePages["wong.tai.ming"];
    await page.goto("/");
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
  }
);
