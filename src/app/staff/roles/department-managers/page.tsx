import { redirect } from "next/navigation";

import { rolePeopleReturnHref } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function DepartmentManagersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(rolePeopleReturnHref(params.returnTo) ?? "/roles/people");
}
