import { drizzle } from "drizzle-orm/d1";

import {
  buildVisibleNoticeQuery,
  getVisibleNoticePage,
} from "../../src/features/home/notices";
import {
  buildHomeEventCalendarQuery,
  buildHomeEventPageQuery,
  buildHomeInvitationPageQuery,
  buildHomeParticipationPageQuery,
  getHomeView,
} from "../../src/features/home/queries";
import type { Database } from "../../src/server/db/client";
import * as activitySchema from "../../src/server/db/schema/activities";
import * as noticeSchema from "../../src/server/db/schema/notices";
import {
  getChurchDateKey,
  getChurchWeekDates,
} from "../../src/shared/time/church-time";
import { test as nativeTest } from "../support/fixtures";
/* eslint-disable no-await-in-loop -- Calendar navigation exercises sequential real week controls. */
import { dedicatedTest, expect, test } from "../support/home";

const highVolumeEventTitles = (firstNumber: number, count = 25) =>
  Array.from({ length: count }, (_, index) => {
    const suffix = String(firstNumber + index).padStart(3, "0");
    return `High-volume Event ${suffix}`;
  });

dedicatedTest(
  "Home Event list stays bounded across more than 100 authorized Programs",
  { tag: ["@native", "@browser", "@home", "@risk-compatibility"] },
  async ({ caseApp, home, homePages }) => {
    const account = home.accounts["wong.tai.ming"];
    const actor = await caseApp.db
      .prepare("select id from user where email = ?")
      .bind(account.email)
      .first<{ id: string }>();
    if (!actor) {
      throw new Error("Missing synthetic Home actor");
    }

    const now = new Date();
    const today = getChurchDateKey(now);
    const [monday, tuesday, eventDate] = getChurchWeekDates(today, 2);
    if (!(monday && tuesday && eventDate)) {
      throw new Error("Missing future Home event date");
    }
    const startsAt = Math.floor(
      Date.parse(`${eventDate}T02:30:00.000Z`) / 1000
    );
    const eventDateParts = eventDate.split("-").map(Number);
    const eventYear = eventDateParts[0] ?? 0;
    const eventMonth = eventDateParts[1] ?? 1;
    const laterDate = getChurchDateKey(
      new Date((startsAt + 24 * 60 * 60) * 1000)
    );
    const nextMonthDate = new Date(Date.UTC(eventYear, eventMonth, 15, 12))
      .toISOString()
      .slice(0, 10);
    const nextYearDate = new Date(Date.UTC(eventYear + 1, 0, 1, 12))
      .toISOString()
      .slice(0, 10);
    const futureEvents = [
      {
        date: laterDate,
        enrolmentId: `${home.namespace}later-day-enrolment`,
        eventId: `${home.namespace}later-day-event`,
        programId: `${home.namespace}later-day-program`,
        startsAt: startsAt + 24 * 60 * 60,
        title: "Later-only Event",
      },
      {
        date: nextMonthDate,
        enrolmentId: `${home.namespace}month-enrolment`,
        eventId: `${home.namespace}month-event`,
        programId: `${home.namespace}month-program`,
        startsAt: Math.floor(
          Date.parse(`${nextMonthDate}T02:30:00.000Z`) / 1000
        ),
        title: "Month-boundary Event",
      },
      {
        date: nextYearDate,
        enrolmentId: `${home.namespace}year-enrolment`,
        eventId: `${home.namespace}year-event`,
        programId: `${home.namespace}year-program`,
        startsAt: Math.floor(
          Date.parse(`${nextYearDate}T02:30:00.000Z`) / 1000
        ),
        title: "New-year Event",
      },
    ];
    const writes: D1PreparedStatement[] = [];
    const programIds: string[] = [];
    for (let index = 1; index <= 120; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const programId = `${home.namespace}many-program-${suffix}`;
      programIds.push(programId);
      writes.push(
        caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            programId,
            `${home.namespace}dept-worship`,
            `High-volume Program ${suffix}`
          ),
        caseApp.db
          .prepare(
            "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,'approved',unixepoch(),unixepoch())"
          )
          .bind(
            `${home.namespace}many-enrolment-${suffix}`,
            programId,
            actor.id
          ),
        caseApp.db
          .prepare(
            "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
          )
          .bind(
            `${home.namespace}many-event-${suffix}`,
            programId,
            `High-volume Event ${suffix}`,
            startsAt
          )
      );
    }
    for (const event of futureEvents) {
      writes.push(
        caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            event.programId,
            `${home.namespace}dept-worship`,
            `${event.title} Program`
          ),
        caseApp.db
          .prepare(
            "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,'approved',unixepoch(),unixepoch())"
          )
          .bind(event.enrolmentId, event.programId, actor.id),
        caseApp.db
          .prepare(
            "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
          )
          .bind(event.eventId, event.programId, event.title, event.startsAt)
      );
    }
    await caseApp.db.batch(writes);

    const noticeTime = Math.floor(now.getTime() / 1000) - 60;
    const outsideProgramId = `${home.namespace}outside-program`;
    await caseApp.db
      .prepare(
        "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
      )
      .bind(
        outsideProgramId,
        `${home.namespace}dept-care`,
        "Outside Home Program"
      )
      .run();
    await caseApp.db.batch([
      caseApp.db
        .prepare(
          "insert into notice (id,title,body,scope_type,scope_id,created_at,published_at) values (?,?,?,'program',?,?,?)"
        )
        .bind(
          `${home.namespace}many-scope-notice`,
          "Many-scope Program notice",
          "Visible to the current Program participant.",
          programIds[0],
          noticeTime,
          noticeTime
        ),
      caseApp.db
        .prepare(
          "insert into notice (id,title,body,scope_type,scope_id,created_at,published_at) values (?,?,?,'program',?,?,?)"
        )
        .bind(
          `${home.namespace}outside-scope-notice`,
          "Outside Program notice",
          "Not visible without enrolment or manager authority.",
          outsideProgramId,
          noticeTime,
          noticeTime
        ),
    ]);

    const queryDb = drizzle(caseApp.db, {
      schema: { ...activitySchema, ...noticeSchema },
    }) as unknown as Database;
    const [currentWeekStart] = getChurchWeekDates(today);
    const eventWeek = getChurchWeekDates(eventDate);
    const [weekStartDateKey] = eventWeek;
    if (!weekStartDateKey || !currentWeekStart) {
      throw new Error("Missing Home event week start");
    }
    const weekOffset =
      (Date.parse(`${weekStartDateKey}T00:00:00.000Z`) -
        Date.parse(`${currentWeekStart}T00:00:00.000Z`)) /
      (7 * 24 * 60 * 60 * 1000);

    const eventPageSql = buildHomeEventPageQuery(
      queryDb,
      actor.id,
      now,
      eventDate,
      null
    ).toSQL();
    const calendarSql = buildHomeEventCalendarQuery(
      queryDb,
      actor.id,
      now,
      weekStartDateKey
    ).toSQL();
    const noticeSql = buildVisibleNoticeQuery(
      queryDb,
      actor.id,
      now,
      null
    ).toSQL();
    expect(eventPageSql.params).toHaveLength(6);
    expect(eventPageSql.params.at(-1)).toBe(26);
    expect(calendarSql.params.length).toBeLessThan(100);
    expect(noticeSql.params.length).toBeLessThan(100);
    expect(
      programIds.some((programId) => eventPageSql.params.includes(programId))
    ).toBe(false);
    expect(
      programIds.some((programId) => noticeSql.params.includes(programId))
    ).toBe(false);

    const homeView = await getHomeView(queryDb, actor.id, now, {
      after: null,
      invitationAfter: null,
      participationAfter: null,
      selectedDate: eventDate,
      weekStartDateKey,
    });
    expect(homeView.eventPage.items).toHaveLength(25);
    expect(homeView.eventPage.nextCursor).toBe(
      `${home.namespace}many-event-025`
    );
    expect(homeView.eventCountsByDate[eventDate]).toBe(120);
    expect(homeView.eventCountsByDate[laterDate]).toBe(1);
    expect(homeView.hasApprovedParticipation).toBe(true);

    for (const event of futureEvents) {
      const [futureWeekStart] = getChurchWeekDates(event.date);
      if (!futureWeekStart) {
        throw new Error("Missing future Home event week start");
      }
      const futureView = await getHomeView(queryDb, actor.id, now, {
        after: null,
        invitationAfter: null,
        participationAfter: null,
        selectedDate: event.date,
        weekStartDateKey: futureWeekStart,
      });
      expect(futureView.eventPage.items.map((item) => item.title)).toContain(
        event.title
      );
      expect(futureView.eventCountsByDate[event.date]).toBe(1);
    }

    const noticePage = await getVisibleNoticePage(queryDb, actor.id, now, null);
    const visibleNotices = noticePage.items;
    expect(visibleNotices.map((notice) => notice.title)).toContain(
      "Many-scope Program notice"
    );
    expect(visibleNotices.map((notice) => notice.title)).not.toContain(
      "Outside Program notice"
    );

    const page = homePages["wong.tai.ming"];
    await page.goto(`/?week=${weekOffset}`);
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    const upcoming = page.getByRole("region", { name: "即將參與" });
    const eventTitles = upcoming.locator("li h4");
    await expect(upcoming.locator("ol > li")).toHaveCount(25);
    const dayButton = upcoming.locator(`[data-home-date="${eventDate}"]`);
    await expect(dayButton).toHaveAttribute("aria-label", /有 120 個聚會/u);
    await expect(
      upcoming.locator(`[data-home-date="${laterDate}"]`)
    ).toHaveAttribute("aria-label", /有 1 個聚會/u);
    const noticeRegion = page.getByRole("region", { name: "教會消息" });
    await expect(
      noticeRegion.getByText("Many-scope Program notice")
    ).toBeVisible();
    await expect(noticeRegion.getByText("Outside Program notice")).toHaveCount(
      0
    );

    await dayButton.click();
    await expect(page).toHaveURL(new RegExp(`[?&]date=${eventDate}`, "u"));
    await expect(eventTitles).toHaveText(highVolumeEventTitles(1));
    await upcoming.getByRole("button", { name: "載入下一批聚會" }).click();
    await expect(eventTitles).toHaveText(highVolumeEventTitles(26));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`[?&]date=${eventDate}`, "u"));
    await expect(eventTitles).toHaveText(highVolumeEventTitles(1));

    await page.goto(`/?week=${weekOffset}`);
    await upcoming.getByRole("button", { name: "載入下一批聚會" }).click();
    await expect(eventTitles).toHaveText(highVolumeEventTitles(24));
    for (const firstNumber of [49, 74]) {
      await upcoming.getByRole("button", { name: "載入下一批聚會" }).click();
      await expect(eventTitles).toHaveText(highVolumeEventTitles(firstNumber));
    }
    await upcoming.getByRole("button", { name: "載入下一批聚會" }).click();
    const finalBatchTitles = [
      ...highVolumeEventTitles(99, 22),
      ...futureEvents
        .toSorted((first, second) => first.startsAt - second.startsAt)
        .map((event) => event.title),
    ];
    await expect(eventTitles).toHaveText(finalBatchTitles);

    for (const event of futureEvents.slice(1)) {
      const [futureWeekStart] = getChurchWeekDates(event.date);
      if (!futureWeekStart) {
        throw new Error("Missing future Home event week start");
      }
      const futureWeekOffset =
        (Date.parse(`${futureWeekStart}T00:00:00.000Z`) -
          Date.parse(`${currentWeekStart}T00:00:00.000Z`)) /
        (7 * 24 * 60 * 60 * 1000);
      await page.goto(`/?week=${futureWeekOffset}`);
      const futureDateButton = upcoming.locator(
        `[data-home-date="${event.date}"]`
      );
      await expect(futureDateButton).toHaveAttribute(
        "aria-label",
        /有 1 個聚會/u
      );
      await futureDateButton.click();
      await expect(page).toHaveURL(new RegExp(`[?&]date=${event.date}`, "u"));
      await expect(upcoming.locator("ol > li")).toHaveCount(1);
      await expect(upcoming.locator("li h4")).toHaveText(event.title);
    }

    await page.goto(
      `/?week=${weekOffset}&date=${eventDate}&after=missing-event`
    );
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    await expect(upcoming.locator("ol > li")).toHaveCount(25);
    await expect(eventTitles).toHaveText(highVolumeEventTitles(1));

    await page.goto(
      `/?week=${weekOffset}&date=not-a-date&after=${encodeURIComponent(`${home.namespace}many-event-025`)}`
    );
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    await expect(eventTitles).toHaveText([
      "主日崇拜",
      "主日崇拜",
      ...highVolumeEventTitles(1, 23),
    ]);
  }
);

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

dedicatedTest(
  "Home pages participation in 25-item batches and keeps calendar state",
  {
    tag: [
      "@native",
      "@browser",
      "@home",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-compatibility",
    ],
  },
  async ({ caseApp, home, homePages }) => {
    const account = home.accounts["ng.wing.yan"];
    const actor = await caseApp.db
      .prepare("select id from user where email = ?")
      .bind(account.email)
      .first<{ id: string }>();
    if (!actor) {
      throw new Error("Missing synthetic Home actor");
    }

    const now = new Date();
    const today = getChurchDateKey(now);
    const [monday, tuesday, eventDate] = getChurchWeekDates(today, 2);
    if (!(monday && tuesday && eventDate)) {
      throw new Error("Missing future Home event date");
    }
    const eventStartsAt = Math.floor(
      Date.parse(`${eventDate}T10:00:00+08:00`) / 1000
    );
    const writes: D1PreparedStatement[] = [];
    const statuses = ["approved", "pending", "waitlisted"] as const;
    for (let index = 1; index <= 30; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const programId = `${home.namespace}paging-program-${suffix}`;
      const status = statuses[(index - 1) % statuses.length];
      if (!status) {
        throw new Error(`Missing participation state for row ${suffix}`);
      }
      writes.push(
        caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            programId,
            `${home.namespace}dept-worship`,
            `Paging Participation ${suffix}`
          ),
        caseApp.db
          .prepare(
            "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,?,unixepoch(),unixepoch())"
          )
          .bind(
            `${home.namespace}paging-enrolment-${suffix}`,
            programId,
            actor.id,
            status
          )
      );
    }
    writes.push(
      caseApp.db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(
          `${home.namespace}paging-event-001`,
          `${home.namespace}paging-program-001`,
          "C02 calendar context event",
          eventStartsAt
        ),
      caseApp.db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(
          `${home.namespace}paging-event-002`,
          `${home.namespace}paging-program-001`,
          "C02 calendar context event after cursor",
          eventStartsAt + 60 * 60
        )
    );
    await caseApp.db.batch(writes);

    const queryDb = drizzle(caseApp.db) as unknown as Database;
    const participationQuery = buildHomeParticipationPageQuery(
      queryDb,
      actor.id,
      now,
      null
    );
    const participationSql = participationQuery.toSQL();
    expect(participationSql.params).toHaveLength(6);
    expect(participationSql.params.at(-1)).toBe(26);
    expect(await participationQuery.all()).toHaveLength(26);

    const eventCursor = `${home.namespace}paging-event-001`;
    const initialUrl = `/?week=2&date=${eventDate}&after=${encodeURIComponent(eventCursor)}`;
    const page = homePages["ng.wing.yan"];
    await page.goto(initialUrl);

    const participation = page.getByRole("region", { name: "參與狀態" });
    const rows = participation.locator("li");
    await expect(rows).toHaveCount(25);
    await expect(rows.locator("h3")).toHaveText(
      Array.from(
        { length: 25 },
        (_, index) =>
          `Paging Participation ${String(index + 1).padStart(3, "0")}`
      )
    );
    await expect(
      page.getByRole("button", { name: "載入更多參與狀態" })
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "即將參與" })
        .getByText("C02 calendar context event after cursor")
    ).toBeVisible();

    await page.getByRole("button", { name: "載入更多參與狀態" }).click();
    await expect(rows).toHaveCount(5);
    await expect(rows.locator("h3")).toHaveText([
      "Paging Participation 026",
      "Paging Participation 027",
      "Paging Participation 028",
      "Paging Participation 029",
      "Paging Participation 030",
    ]);
    await expect(rows.nth(0).getByText("待批核")).toBeVisible();
    await expect(rows.nth(1).getByText("候補中")).toBeVisible();
    await expect(rows.nth(2).getByText("報名已批准")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "載入更多參與狀態" })
    ).toHaveCount(0);

    const pageUrl = new URL(page.url());
    expect(pageUrl.hash).toBe("#participation");
    await expect(participation).toBeInViewport();
    expect(pageUrl.searchParams.get("week")).toBe("2");
    expect(pageUrl.searchParams.get("date")).toBe(eventDate);
    expect(pageUrl.searchParams.get("after")).toBe(eventCursor);
    expect(pageUrl.searchParams.get("participationAfter")).toBe(
      `${home.namespace}paging-enrolment-025`
    );
    await expect(
      page
        .getByRole("region", { name: "即將參與" })
        .getByText("C02 calendar context event after cursor")
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new URL(initialUrl, page.url()).toString());
    await expect(rows).toHaveCount(25);

    await page.goto(`${initialUrl}&participationAfter=enr-sunday-wong`);
    await expect(page).toHaveURL(new URL(initialUrl, page.url()).toString());
    await expect(rows).toHaveCount(25);
  }
);

dedicatedTest(
  "Home pages valid invitations in 25-item batches and preserves context",
  {
    tag: [
      "@native",
      "@browser",
      "@home",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-compatibility",
    ],
  },
  async ({ caseApp, home, homePages }) => {
    const account = home.accounts["ng.wing.yan"];
    const actor = await caseApp.db
      .prepare("select id from user where email = ?")
      .bind(account.email)
      .first<{ id: string }>();
    if (!actor) {
      throw new Error("Missing synthetic Home actor");
    }

    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const today = getChurchDateKey(now);
    const [monday, tuesday, eventDate] = getChurchWeekDates(today, 2);
    if (!(monday && tuesday && eventDate)) {
      throw new Error("Missing future Home event date");
    }
    const eventStartsAt = Math.floor(
      Date.parse(`${eventDate}T10:00:00+08:00`) / 1000
    );
    const writes: D1PreparedStatement[] = [];
    const participationStates = ["approved", "pending", "waitlisted"] as const;
    for (let index = 1; index <= 26; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const programId = `${home.namespace}invitation-participation-program-${suffix}`;
      const status =
        participationStates[(index - 1) % participationStates.length];
      if (!status) {
        throw new Error(`Missing participation state for row ${suffix}`);
      }
      writes.push(
        caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            programId,
            `${home.namespace}dept-worship`,
            `Invitation Context Participation ${suffix}`
          ),
        caseApp.db
          .prepare(
            "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,?,unixepoch(),unixepoch())"
          )
          .bind(
            `${home.namespace}invitation-participation-${suffix}`,
            programId,
            actor.id,
            status
          )
      );
    }
    writes.push(
      caseApp.db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(
          `${home.namespace}invitation-context-event-001`,
          `${home.namespace}invitation-participation-program-001`,
          "C02 invitation context event",
          eventStartsAt
        ),
      caseApp.db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(
          `${home.namespace}invitation-context-event-002`,
          `${home.namespace}invitation-participation-program-001`,
          "C02 invitation context event after cursor",
          eventStartsAt + 60 * 60
        )
    );
    for (let index = 1; index <= 30; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const programId = `${home.namespace}invitation-program-${suffix}`;
      writes.push(
        caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            programId,
            `${home.namespace}dept-worship`,
            `Paging Invitation ${suffix}`
          ),
        caseApp.db
          .prepare(
            "insert into invitation (id,program_id,user_id,state,expires_at,created_at) values (?,?,?,'valid',?,unixepoch())"
          )
          .bind(
            `${home.namespace}paging-invitation-${suffix}`,
            programId,
            actor.id,
            nowSeconds + index * 24 * 60 * 60
          )
      );
    }
    const boundaryProgramId = `${home.namespace}invitation-boundary-program`;
    const revokedProgramId = `${home.namespace}invitation-revoked-program`;
    writes.push(
      caseApp.db
        .prepare(
          "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
        )
        .bind(
          boundaryProgramId,
          `${home.namespace}dept-worship`,
          "Expired-at-boundary Invitation"
        ),
      caseApp.db
        .prepare(
          "insert into invitation (id,program_id,user_id,state,expires_at,created_at) values (?,?,?,'valid',?,unixepoch())"
        )
        .bind(
          `${home.namespace}paging-invitation-boundary`,
          boundaryProgramId,
          actor.id,
          nowSeconds
        ),
      caseApp.db
        .prepare(
          "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
        )
        .bind(
          revokedProgramId,
          `${home.namespace}dept-worship`,
          "Revoked Paging Invitation"
        ),
      caseApp.db
        .prepare(
          "insert into invitation (id,program_id,user_id,state,expires_at,created_at) values (?,?,?,'revoked',?,unixepoch())"
        )
        .bind(
          `${home.namespace}paging-invitation-revoked`,
          revokedProgramId,
          actor.id,
          nowSeconds + 60 * 24 * 60 * 60
        )
    );
    await caseApp.db.batch(writes);

    const queryDb = drizzle(caseApp.db) as unknown as Database;
    const invitationQuery = buildHomeInvitationPageQuery(
      queryDb,
      actor.id,
      now,
      null
    );
    const invitationSql = invitationQuery.toSQL();
    expect(invitationSql.params.length).toBeLessThan(100);
    expect(invitationSql.params.at(-1)).toBe(26);
    expect(await invitationQuery.all()).toHaveLength(26);

    const eventCursor = `${home.namespace}invitation-context-event-001`;
    const participationCursor = `${home.namespace}invitation-participation-025`;
    const initialUrl = `/?week=2&date=${eventDate}&after=${encodeURIComponent(eventCursor)}&participationAfter=${encodeURIComponent(participationCursor)}`;
    const page = homePages["ng.wing.yan"];
    await page.goto(initialUrl);

    const invitations = page.getByRole("region", { name: "有效邀請" });
    const rows = invitations.locator("li");
    await expect(rows).toHaveCount(25);
    await expect(rows.locator("h3")).toHaveText(
      Array.from(
        { length: 25 },
        (_, index) => `Paging Invitation ${String(index + 1).padStart(3, "0")}`
      )
    );
    await expect(
      invitations.getByText("Expired-at-boundary Invitation")
    ).toHaveCount(0);
    await expect(
      invitations.getByText("Revoked Paging Invitation")
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("region", { name: "參與狀態" })
        .getByText("Invitation Context Participation 026")
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "即將參與" })
        .getByText("C02 invitation context event after cursor")
    ).toBeVisible();

    await page.getByRole("button", { name: "載入更多有效邀請" }).click();
    await expect(rows).toHaveCount(5);
    await expect(rows.locator("h3")).toHaveText([
      "Paging Invitation 026",
      "Paging Invitation 027",
      "Paging Invitation 028",
      "Paging Invitation 029",
      "Paging Invitation 030",
    ]);
    const pageUrl = new URL(page.url());
    expect(pageUrl.hash).toBe("#invitations");
    await expect(invitations).toBeInViewport();
    expect(pageUrl.searchParams.get("week")).toBe("2");
    expect(pageUrl.searchParams.get("date")).toBe(eventDate);
    expect(pageUrl.searchParams.get("after")).toBe(eventCursor);
    expect(pageUrl.searchParams.get("participationAfter")).toBe(
      participationCursor
    );
    expect(pageUrl.searchParams.get("invitationAfter")).toBe(
      `${home.namespace}paging-invitation-025`
    );
    await expect(
      page
        .getByRole("region", { name: "參與狀態" })
        .getByText("Invitation Context Participation 026")
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "即將參與" })
        .getByText("C02 invitation context event after cursor")
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new URL(initialUrl, page.url()).toString());
    await expect(rows).toHaveCount(25);

    await page.goto(
      `${initialUrl}&invitationAfter=${encodeURIComponent(`${home.namespace}paging-invitation-revoked`)}`
    );
    await expect(page).toHaveURL(new URL(initialUrl, page.url()).toString());
    await expect(rows).toHaveCount(25);
    await expect(
      page
        .getByRole("region", { name: "參與狀態" })
        .getByText("Invitation Context Participation 026")
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "即將參與" })
        .getByText("C02 invitation context event after cursor")
    ).toBeVisible();

    await page.goto(
      `${initialUrl}&invitationAfter=${encodeURIComponent(`${home.namespace}paging-invitation-boundary`)}`
    );
    await expect(page).toHaveURL(new URL(initialUrl, page.url()).toString());
    await expect(rows).toHaveCount(25);
    await expect(
      page
        .getByRole("region", { name: "參與狀態" })
        .getByText("Invitation Context Participation 026")
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "即將參與" })
        .getByText("C02 invitation context event after cursor")
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
    await expect(firstDateButton).toHaveAttribute("aria-label", /有 1 個聚會/u);
    await firstDateButton.click();
    await expect(page).toHaveURL(new RegExp(`[?&]date=${firstDate}`, "u"));
    await expect(eventList).toHaveCount(1);
    await expect(eventList.locator("time")).toHaveAttribute(
      "datetime",
      firstEvent.startsAt
    );

    await upcoming.getByRole("button", { name: "下一週" }).click();
    const nextDateButton = page.locator(`[data-home-date="${nextDate}"]`);
    await expect(nextDateButton).toBeVisible();
    await expect(nextDateButton).toHaveAttribute("aria-label", /有 1 個聚會/u);
    await nextDateButton.click();
    await expect(page).toHaveURL(new RegExp(`[?&]date=${nextDate}`, "u"));
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
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`[?&]date=${nextDate}`, "u"));
    await expect(nextDateButton).toHaveAttribute("aria-pressed", "true");
    await expect(eventList).toHaveCount(1);
    await allButton.click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(eventList).toHaveCount(2);

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
  "Home canonicalizes an invalid date while preserving the valid week context",
  {
    tag: [
      "@native",
      "@browser",
      "@home",
      "@risk-compatibility",
      "@risk-authorization",
    ],
  },
  async ({ homePages }) => {
    const page = homePages["wong.tai.ming"];
    await page.goto("/?week=1&date=2026-02-30");
    await expect(page).toHaveURL(/\/\?week=1$/u);
    await expect(page.getByRole("main")).toBeVisible();
  }
);

test(
  "Home removes an unauthorized Event cursor while preserving a valid date and week",
  {
    tag: [
      "@native",
      "@browser",
      "@home",
      "@risk-authorization",
      "@risk-compatibility",
    ],
  },
  async ({ homePages }) => {
    const page = homePages["wong.tai.ming"];
    const today = getChurchDateKey(new Date());
    const [weekStart, weekTuesday, selectedDate] = getChurchWeekDates(today, 2);
    if (!(weekStart && weekTuesday && selectedDate)) {
      throw new Error("Missing future Home calendar date");
    }
    await page.goto(`/?week=2&date=${selectedDate}&after=missing-home-event`);
    await expect(page).toHaveURL(
      new RegExp(`\\/\\?week=2&date=${selectedDate}$`, "u")
    );
    await expect(page.getByRole("main")).toBeVisible();
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
    await expect(participation.locator("time")).toHaveCount(4);
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
