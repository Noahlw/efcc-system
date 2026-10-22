/* eslint-disable no-await-in-loop -- Each navigation consumes the preceding real Home cursor. */
import {
  getChurchDateKey,
  getChurchWeekDates,
} from "../../src/shared/time/church-time";
import { dedicatedTest as test, expect } from "../support/home";

test(
  "Home controls preserve all other section positions through history and cursor recovery",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@home",
      "@risk-compatibility",
    ],
  },
  async ({ caseApp, homePages }) => {
    const actor = await caseApp.db
      .prepare("select id from user where username = ?")
      .bind("ng.wing.yan")
      .first<{ id: string }>();
    if (!actor) {
      throw new Error("Missing synthetic Home actor");
    }
    const [monday, tuesday, date] = getChurchWeekDates(
      getChurchDateKey(new Date()),
      2
    );
    if (!(monday && tuesday && date)) {
      throw new Error("Missing future Home date");
    }
    const start = Math.floor(Date.parse(`${date}T10:00:00+08:00`) / 1000);
    const published = Math.floor(Date.now() / 1000) - 60;
    const writes: D1PreparedStatement[] = [];
    for (let index = 1; index <= 60; index += 1) {
      const id = `cross-${String(index).padStart(3, "0")}`;
      writes.push(
        caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,'dept-worship',?,unixepoch())"
          )
          .bind(id, id),
        caseApp.db
          .prepare(
            "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,'approved',unixepoch(),unixepoch())"
          )
          .bind(id, id, actor.id),
        caseApp.db
          .prepare(
            "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
          )
          .bind(id, id, id, start),
        caseApp.db
          .prepare(
            "insert into invitation (id,program_id,user_id,state,expires_at,created_at) values (?,?,?,'valid',?,unixepoch())"
          )
          .bind(id, id, actor.id, start),
        caseApp.db
          .prepare(
            "insert into notice (id,title,body,scope_type,published_at,created_at) values (?,?,?,'church',?,unixepoch())"
          )
          .bind(id, id, id, published - index)
      );
    }
    await caseApp.db.batch(writes);
    const page = homePages["ng.wing.yan"];
    await page.goto("/?week=2");
    const notices = page.getByRole("region", { name: "教會消息" });
    const participation = page.getByRole("region", { name: "參與狀態" });
    const invitations = page.getByRole("region", { name: "有效邀請" });
    const events = page.getByRole("region", { name: "即將參與" });
    await notices.getByRole("button", { name: "載入更多教會消息" }).click();
    await expect(notices.locator("summary").first()).toContainText("cross-026");
    const noticeCursor = new URL(page.url()).searchParams.get("noticeAfter");
    expect(noticeCursor).toBeTruthy();
    await participation
      .getByRole("button", { name: "載入更多參與狀態" })
      .click();
    await expect(participation.locator("li").first()).toContainText(
      "cross-026"
    );
    expect(new URL(page.url()).searchParams.get("noticeAfter")).toBe(
      noticeCursor
    );
    await expect(notices.locator("summary").first()).toContainText("cross-026");
    await invitations.getByRole("button", { name: "載入更多有效邀請" }).click();
    await expect(invitations.locator("li").first()).toContainText("cross-026");
    const positions = new URL(page.url()).searchParams;
    const expectOtherPositions = () => {
      const current = new URL(page.url()).searchParams;
      for (const key of [
        "noticeAfter",
        "participationAfter",
        "invitationAfter",
      ]) {
        expect(current.get(key)).toBe(positions.get(key));
      }
    };
    await events.getByRole("button", { name: "載入下一批聚會" }).click();
    await expect(events.locator("li h4").first()).toHaveText("cross-026");
    expectOtherPositions();
    const paged = page.url();
    await events.locator(`[data-home-date="${date}"]`).click();
    await expect(events.locator("li h4").first()).toHaveText("cross-001");
    expect(new URL(page.url()).searchParams.has("after")).toBe(false);
    expectOtherPositions();
    await expect(events.locator(`[data-home-date="${date}"]`)).toHaveAttribute(
      "aria-label",
      /有 60 個聚會/u
    );
    await page.goBack();
    await expect(page).toHaveURL(paged);
    await expect(events.locator("li h4").first()).toHaveText("cross-026");
    await page.goForward();
    await expect(events.locator("li h4").first()).toHaveText("cross-001");
    for (const label of ["下一週", "上一週", "全部"]) {
      await events.getByRole("button", { exact: true, name: label }).click();
      await expect(
        events.getByRole("button", { exact: true, name: label })
      ).toBeEnabled();
      expectOtherPositions();
      await expect(notices.locator("summary").first()).toContainText(
        "cross-026"
      );
    }
    await page.reload();
    await expect(notices.locator("summary").first()).toContainText("cross-026");
    expectOtherPositions();
    const invalid = new URL(page.url());
    invalid.searchParams.set("after", "missing-event");
    await page.goto(invalid.href);
    await expect
      .poll(() => new URL(page.url()).searchParams.has("after"))
      .toBe(false);
    expectOtherPositions();
    await notices.getByRole("button", { name: "載入更多教會消息" }).click();
    await expect(notices.locator("summary").first()).toContainText("cross-051");
    for (const key of ["participationAfter", "invitationAfter"]) {
      expect(new URL(page.url()).searchParams.get(key)).toBe(
        positions.get(key)
      );
    }
  }
);
