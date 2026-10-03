/**
 * Church Time: Hong Kong local time in 24-hour form. Presentation uses the
 * native formatter so the Worker and the browser agree.
 */
export const CHURCH_TIME_ZONE = "Asia/Hong_Kong";

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
