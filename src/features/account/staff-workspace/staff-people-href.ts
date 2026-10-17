import type { ProtectedPageHref } from "@/shared/protected-pages";

import type { StaffPersonTask } from "./staff-task-contract";

export const staffPeopleHref = (
  query?: string,
  personId?: string,
  task?: StaffPersonTask,
  page = 1
): ProtectedPageHref => {
  const params = new URLSearchParams(
    Object.entries({
      page: page > 1 ? String(page) : undefined,
      person: personId,
      q: query,
      task,
      view: "people",
    }).filter((entry): entry is [string, string] => Boolean(entry[1]))
  ).toString();
  return `/staff/accounts?${params}`;
};
