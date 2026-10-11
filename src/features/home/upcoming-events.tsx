"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
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
  hasApprovedParticipation,
  today,
}: {
  events: UpcomingEventItem[];
  hasApprovedParticipation: boolean;
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
  let emptyTitle = "下一次相聚，從這裏開始";
  let emptyDescription = "當有即將參與的聚會，時間及安排會顯示在這裏。";
  if (selectedDate) {
    emptyTitle = "這一天沒有聚會";
    emptyDescription = "試試其他日期，或查看所有即將參與的聚會。";
  } else if (hasApprovedParticipation) {
    emptyTitle = "暫未有即將舉行的聚會";
    emptyDescription = "你已獲批准的 Program 會顯示在參與狀態。";
  }

  return (
    <section aria-label="即將參與" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
              "text-primary text-meta focus-visible:outline-primary inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2",
              selectedDate === null
                ? "font-bold underline underline-offset-4"
                : "",
            ].join(" ")}
            onClick={resetToAll}
            type="button"
          >
            全部
          </button>
          <button
            aria-label="上一週"
            className="text-primary focus-visible:outline-primary inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-50"
            disabled={weekOffset === 0}
            onClick={() => {
              setSelectedDate(null);
              setWeekOffset((current) => Math.max(0, current - 1));
            }}
            type="button"
          >
            <Icon name="chevron-left" />
          </button>
          <button
            aria-label="下一週"
            className="text-primary focus-visible:outline-primary inline-flex min-h-11 min-w-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => {
              setSelectedDate(null);
              setWeekOffset((current) => current + 1);
            }}
            type="button"
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>

      <div
        aria-label="選擇日期"
        className="bg-background mt-3 flex gap-0.5 overflow-x-auto overscroll-x-contain rounded-xl p-2"
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
          return (
            <button
              key={dateKey}
              aria-current={todayDate ? "date" : undefined}
              aria-label={dateAccessibleLabel}
              aria-pressed={selected}
              className="text-foreground focus-visible:outline-primary flex min-h-[4.25rem] min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-center focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-40"
              data-home-date={dateKey}
              disabled={dateKey < today}
              onClick={() => setSelectedDate(dateKey)}
              type="button"
            >
              <span className="text-muted-foreground text-[0.75rem]">
                {weekday}
              </span>
              <span
                className={`text-body flex size-9 items-center justify-center rounded-full leading-none ${todayDate ? "ring-primary text-primary ring-1 ring-inset" : ""} ${selected ? "bg-primary text-primary-foreground" : ""}`}
              >
                {dayNumber(dateKey)}
              </span>
              {count > 0 ? (
                <span
                  aria-hidden="true"
                  className="bg-primary h-1 w-1 rounded-full"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          aria-live="polite"
          className="text-section font-semibold"
          id="upcoming-heading"
        >
          {selectedDate
            ? `${dateLabelFormatter.format(dateFromKey(selectedDate))}的聚會`
            : "即將參與"}
        </h2>
        <span className="text-meta text-muted-foreground">香港時間</span>
      </div>
      {visibleEvents.length === 0 ? (
        <div className="bg-background mt-4 rounded-xl px-5 py-8 text-center">
          <span className="bg-muted text-primary mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
            <Icon className="size-7" name="calendar" />
          </span>
          <h3 className="text-section font-semibold">{emptyTitle}</h3>
          <p className="text-muted-foreground mt-2" role="status">
            {emptyDescription}
          </p>
          {selectedDate ? (
            <Button
              className="mt-4 w-full"
              variant="secondary"
              onClick={resetToAll}
            >
              查看全部即將聚會
            </Button>
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
