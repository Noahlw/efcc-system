/**
 * Church Time: Hong Kong local time in 24-hour form. Presentation uses the
 * native formatter so the Worker and the browser agree.
 */
export const CHURCH_TIME_ZONE = "Asia/Hong_Kong";

const churchDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: CHURCH_TIME_ZONE,
  year: "numeric",
});

/** A date key follows the church's local calendar, not the server's UTC day. */
export const getChurchDateKey = (instant: Date): string => {
  const parts = churchDateKeyFormatter.formatToParts(instant);
  const part = (type: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** Monday-first date keys for the current or a future Hong Kong week. */
export const getChurchWeekDates = (dateKey: string, offset = 0): string[] => {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const reference = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (reference.getUTCDay() + 6) % 7;
  const start = new Date(
    Date.UTC(year, month - 1, day - mondayOffset + Math.max(0, offset) * 7)
  );

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-HK", {
  day: "numeric",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "long",
  timeZone: CHURCH_TIME_ZONE,
  weekday: "short",
});

/** e.g. "10月5日週一 19:30" */
export const formatChurchDateTime = (instant: Date): string =>
  dateTimeFormatter.format(instant);

const dateFormatter = new Intl.DateTimeFormat("zh-HK", {
  day: "numeric",
  month: "long",
  timeZone: CHURCH_TIME_ZONE,
  year: "numeric",
});

/** e.g. "2026年10月31日" */
export const formatChurchDate = (instant: Date): string =>
  dateFormatter.format(instant);

const timestampFormatter = new Intl.DateTimeFormat("zh-HK", {
  dateStyle: "medium",
  hour12: false,
  timeStyle: "short",
  timeZone: CHURCH_TIME_ZONE,
});

/** Retained history needs the year as well as Hong Kong 24-hour time. */
export const formatChurchTimestamp = (instant: Date | number): string =>
  timestampFormatter.format(instant);
