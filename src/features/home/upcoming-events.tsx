"use client";

import { useMemo, useState } from "react";

import {
  CHURCH_TIME_ZONE,
  getChurchDateKey,
  getChurchWeekDates,
} from "@/shared/time/church-time";

export interface UpcomingEventItem {
  departmentName: string;
  id: string;
  programName: string;
  startsAt: string;
  title: string;
}

const dayLabels = ["一", "二", "三", "四", "五", "六", "日"] as const;

const dateFromKey = (dateKey: string) => {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

const dayNumber = (dateKey: string) => Number(dateKey.slice(8));

const dateLabelFormatter = new Intl.DateTimeFormat("zh-HK", {
  day: "numeric",
  month: "numeric",
  timeZone: CHURCH_TIME_ZONE,
});

const weekdayFormatter = new Intl.DateTimeFormat("zh-HK", {
  timeZone: CHURCH_TIME_ZONE,
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("zh-HK", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: CHURCH_TIME_ZONE,
});

const monthLabel = (dates: string[]) => {
  const formatter = new Intl.DateTimeFormat("zh-HK", {
    month: "numeric",
    timeZone: CHURCH_TIME_ZONE,
    year: "numeric",
  });
  const parts = (dateKey: string) => {
    const entries = formatter.formatToParts(dateFromKey(dateKey));
    return {
      month: entries.find((entry) => entry.type === "month")?.value ?? "",
      year: entries.find((entry) => entry.type === "year")?.value ?? "",
    };
  };
  const [firstDate] = dates;
  if (!firstDate) {
    return "";
  }
  const first = parts(firstDate);
  const last = parts(dates.at(-1) ?? firstDate);

  if (first.year === last.year && first.month === last.month) {
    return `${first.year} 年 ${first.month} 月`;
  }
  if (first.year === last.year) {
    return `${first.year} 年 ${first.month}–${last.month} 月`;
  }
  return `${first.year} 年 ${first.month} 月 – ${last.year} 年 ${last.month} 月`;
};

export const UpcomingEvents = ({
  events,
  today,
}: {
  events: UpcomingEventItem[];
  today: string;
}) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dates = getChurchWeekDates(today, weekOffset);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, UpcomingEventItem[]>();
    for (const event of events) {
      const key = getChurchDateKey(new Date(event.startsAt));
      const sameDay = grouped.get(key) ?? [];
      sameDay.push(event);
      grouped.set(key, sameDay);
    }
    return grouped;
  }, [events]);
  const visibleEvents = selectedDate
    ? (eventsByDate.get(selectedDate) ?? [])
    : events;
  const resetToAll = () => {
    setSelectedDate(null);
    setWeekOffset(0);
  };

  return (
    <section aria-labelledby="upcoming-heading" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-section font-semibold" id="upcoming-heading">
          即將參與
        </h2>
        <span className="text-meta text-muted-foreground">香港時間</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="font-medium">
          {monthLabel(dates)}
        </p>
        <div
          aria-label="聚會日期控制"
          className="flex items-center gap-1"
          role="group"
        >
          <button
            aria-pressed={selectedDate === null}
            className={[
              "focus-visible:outline-primary inline-flex min-h-12 min-w-[44px] items-center justify-center rounded-md px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2",
              selectedDate === null
                ? "bg-primary text-primary-foreground"
                : "text-primary hover:bg-muted",
            ].join(" ")}
            onClick={resetToAll}
            type="button"
          >
            全部
          </button>
          <button
            aria-label="上一週"
            className="text-primary focus-visible:outline-primary inline-flex min-h-12 min-w-[44px] items-center justify-center rounded-md text-2xl focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={weekOffset === 0}
            onClick={() => {
              setSelectedDate(null);
              setWeekOffset((current) => Math.max(0, current - 1));
            }}
            type="button"
          >
            ‹
          </button>
          <button
            aria-label="下一週"
            className="text-primary focus-visible:outline-primary inline-flex min-h-12 min-w-[44px] items-center justify-center rounded-md text-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              setSelectedDate(null);
              setWeekOffset((current) => current + 1);
            }}
            type="button"
          >
            ›
          </button>
        </div>
      </div>

      <div
        aria-label="選擇日期"
        className="bg-muted mt-3 flex gap-1 overflow-x-auto overscroll-x-contain rounded-xl p-2"
        role="group"
        tabIndex={0}
      >
        {dates.map((dateKey, index) => {
          const count = eventsByDate.get(dateKey)?.length ?? 0;
          const selected = selectedDate === dateKey;
          const todayDate = dateKey === today;
          const weekday = dayLabels[index];
          const eventCountLabel =
            count > 0 ? `，有 ${count} 個聚會` : "，沒有聚會";
          const dateAccessibleLabel = `星期${weekday}，${dateLabelFormatter.format(
            dateFromKey(dateKey)
          )}${eventCountLabel}`;
          let dateClass = "text-foreground hover:bg-surface";
          if (todayDate) {
            dateClass = "text-primary ring-primary ring-1 ring-inset";
          }
          if (selected) {
            dateClass = "bg-primary text-primary-foreground";
          }
          return (
            <button
              key={dateKey}
              aria-current={todayDate ? "date" : undefined}
              aria-label={dateAccessibleLabel}
              aria-pressed={selected}
              className={[
                "focus-visible:outline-primary flex min-h-[4.25rem] w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-center focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
                dateClass,
              ].join(" ")}
              data-home-date={dateKey}
              disabled={dateKey < today}
              onClick={() => setSelectedDate(dateKey)}
              type="button"
            >
              <span className="text-meta">{weekday}</span>
              <span className="text-body leading-none">
                {dayNumber(dateKey)}
              </span>
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className="h-1 w-1 rounded-full bg-current"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <h3 aria-live="polite" className="text-section mt-5 font-medium">
        {selectedDate
          ? `${dateLabelFormatter.format(dateFromKey(selectedDate))}的聚會`
          : "全部即將參與的聚會"}
      </h3>
      {visibleEvents.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed p-5">
          <p className="text-muted-foreground" role="status">
            {selectedDate ? "這一天沒有聚會。" : "目前沒有即將舉行的聚會。"}
          </p>
          {selectedDate ? (
            <button
              className="text-primary focus-visible:outline-primary mt-3 min-h-12 rounded-md px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={resetToAll}
              type="button"
            >
              查看全部即將聚會
            </button>
          ) : null}
        </div>
      ) : (
        <ol className="divide-border mt-2 divide-y">
          {visibleEvents.map((event) => {
            const instant = new Date(event.startsAt);
            const eventDate = getChurchDateKey(instant);
            return (
              <li key={event.id} className="flex gap-4 py-4">
                <time
                  className="flex w-12 shrink-0 flex-col items-center pt-1"
                  dateTime={event.startsAt}
                >
                  <span className="text-task font-semibold">
                    {dayNumber(eventDate)}
                  </span>
                  <span className="text-meta text-muted-foreground">
                    {weekdayFormatter.format(dateFromKey(eventDate))}
                  </span>
                </time>
                <div className="border-border min-w-0 flex-1 border-l pl-4">
                  <h4 className="text-label font-semibold">
                    {event.title || event.programName}
                  </h4>
                  {event.title === event.programName ? null : (
                    <p className="text-meta text-muted-foreground mt-1 break-words">
                      {event.programName}
                    </p>
                  )}
                  <p className="text-body mt-2 break-words">
                    {timeFormatter.format(instant)}
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-muted-foreground">
                      {event.departmentName}
                    </span>
                  </p>
                  <span className="bg-muted text-primary text-meta mt-3 inline-flex min-h-8 items-center rounded-full px-3 font-medium">
                    報名已批准
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
