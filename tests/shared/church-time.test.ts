import { expect, test } from "vitest";

import {
  getChurchDateKey,
  getChurchWeekDates,
} from "../../src/shared/time/church-time";

test("church date keys follow Hong Kong midnight rather than UTC midnight", () => {
  expect(getChurchDateKey(new Date("2026-10-05T15:59:00.000Z"))).toBe(
    "2026-10-05"
  );
  expect(getChurchDateKey(new Date("2026-10-05T16:00:00.000Z"))).toBe(
    "2026-10-06"
  );
});

test("church weeks run Monday to Sunday and roll across month and year", () => {
  expect(getChurchWeekDates("2026-12-31")).toEqual([
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
  expect(getChurchWeekDates("2026-12-31", 1)).toEqual([
    "2027-01-04",
    "2027-01-05",
    "2027-01-06",
    "2027-01-07",
    "2027-01-08",
    "2027-01-09",
    "2027-01-10",
  ]);
  expect(getChurchWeekDates("2026-12-31", -1)).toEqual(
    getChurchWeekDates("2026-12-31")
  );
});
