import { getChurchWeekDates } from "@/shared/time/church-time";

const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;

export interface HomeCalendarState {
  weekOffset: number;
  selectedDate: string | null;
  after: string | null;
  participationAfter: string | null;
  invitationAfter: string | null;
}

export interface HomeCalendarSearchParams {
  week?: string | string[];
  date?: string | string[];
  after?: string | string[];
  participationAfter?: string | string[];
  invitationAfter?: string | string[];
}

const singleValue = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : null;

const validDateKey = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const instant = new Date(`${value}T12:00:00.000Z`);
  return (
    Number.isFinite(instant.getTime()) &&
    instant.toISOString().slice(0, 10) === value
  );
};

const weekOffsetForDate = (today: string, date: string) => {
  const [todayMonday] = getChurchWeekDates(today);
  const [dateMonday] = getChurchWeekDates(date);
  if (!todayMonday || !dateMonday) {
    return 0;
  }
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${dateMonday}T00:00:00.000Z`) -
        Date.parse(`${todayMonday}T00:00:00.000Z`)) /
        millisecondsPerWeek
    )
  );
};

const parseWeekOffset = (value: string | null, today: string) => {
  const match = value ? /^(?<offset>0|[1-9]\d*)$/u.exec(value) : null;
  const rawOffset = match?.groups?.offset;
  if (!rawOffset) {
    return 0;
  }
  const offset = Number(rawOffset);
  if (!Number.isSafeInteger(offset)) {
    return 0;
  }
  try {
    getChurchWeekDates(today, offset);
    return offset;
  } catch {
    return 0;
  }
};

const parseAfterCursor = (value: string | null) => value || null;

/** Invalid dates/cursors and past dates normalize to the authorized first page. */
export const parseHomeCalendarState = (
  params: HomeCalendarSearchParams,
  today: string
): HomeCalendarState => {
  const requestedDate = singleValue(params.date);
  const selectedDate =
    validDateKey(requestedDate) && requestedDate >= today
      ? requestedDate
      : null;
  const hasInvalidDate = params.date !== undefined && selectedDate === null;
  return {
    after: hasInvalidDate ? null : parseAfterCursor(singleValue(params.after)),
    invitationAfter: parseAfterCursor(singleValue(params.invitationAfter)),
    participationAfter: parseAfterCursor(
      singleValue(params.participationAfter)
    ),
    selectedDate,
    weekOffset: selectedDate
      ? weekOffsetForDate(today, selectedDate)
      : parseWeekOffset(singleValue(params.week), today),
  };
};

export const buildHomeCalendarHref = (state: HomeCalendarState) => {
  const params = new URLSearchParams();
  if (state.weekOffset > 0) {
    params.set("week", String(state.weekOffset));
  }
  if (state.selectedDate) {
    params.set("date", state.selectedDate);
  }
  if (state.after) {
    params.set("after", state.after);
  }
  if (state.participationAfter) {
    params.set("participationAfter", state.participationAfter);
  }
  if (state.invitationAfter) {
    params.set("invitationAfter", state.invitationAfter);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
};
