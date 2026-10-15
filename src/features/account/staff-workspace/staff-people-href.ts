import type { ProtectedPageHref } from "@/shared/protected-pages";

import type { StaffPersonTask } from "./staff-task-contract";

export const staffPeopleHref = (
  query?: string,
  personId?: string,
  task?: StaffPersonTask
): ProtectedPageHref => {
  const params = new URLSearchParams(
    Object.entries({ person: personId, q: query, task, view: "people" }).filter(
      (entry): entry is [string, string] => Boolean(entry[1])
    )
  ).toString();
  return `/staff/accounts?${params}`;
};
