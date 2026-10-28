import type { Page } from "@playwright/test";

import { expect } from "../../support/fixtures";

/** Follow the delivered person finder to the still-operable role command page. */
export const openRoleTask = async (
  page: Page,
  target: { fullName: string; username: string },
  task: "department-managers" | "program-leaders" | "global-roles"
) => {
  await expect(page).toHaveURL(/\/roles\/people$/u);
  await page
    .getByRole("searchbox", { name: "姓名或 Username" })
    .fill(target.username);
  await page
    .getByRole("button", { name: new RegExp(target.fullName, "u") })
    .click();
  const label = {
    "department-managers": "管理部門主管",
    "global-roles": "管理帳戶身份與委派（需重新搜尋對象）",
    "program-leaders": "管理聚會負責人",
  }[task];
  await page.getByRole("link", { name: label }).click();
  await expect(page).toHaveURL(
    new RegExp(`/staff/roles/${task}\\?returnTo=`, "u")
  );
};
