import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect } from "../../support/fixtures";

export const openPersonOverview = async (
  page: Page,
  target: { fullName: string; username: string }
) => {
  if (new URL(page.url()).pathname !== "/roles/people") {
    await page.goto("/roles/people");
  }
  const finder = page.getByRole("searchbox", { name: "姓名或 Username" });
  if (!(await finder.isVisible())) {
    await page.getByRole("button", { exact: true, name: "更換對象" }).click();
  }
  await finder.fill(target.username);
  await page
    .getByRole("button", { name: new RegExp(target.fullName, "u") })
    .click();
  await expect(
    page.getByRole("article", { name: target.fullName })
  ).toBeVisible();
};

/** Follow the same person overview links used by the delivered task UI. */
export const openRoleTask = async (
  page: Page,
  target: { fullName: string; username: string },
  task:
    | "department-managers"
    | "program-leaders"
    | "global-roles"
    | "role-assigners"
) => {
  await openPersonOverview(page, target);
  const destination = {
    "department-managers": { label: "編輯職務", path: "/roles/people/duties" },
    "global-roles": { label: "管理帳戶身份", path: "/roles/people/identity" },
    "program-leaders": { label: "編輯職務", path: "/roles/people/duties" },
    "role-assigners": {
      label: "管理職務指派權",
      path: "/roles/people/delegation",
    },
  }[task];
  await page
    .getByRole("link", { exact: true, name: destination.label })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === destination.path);
};

/** Confirm only; the caller must perform the second explicit Save. */
export const confirmRoleTaskPassword = async (page: Page, password: string) => {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { exact: true, name: "目前密碼" })
    .fill(password);
  const confirm = dialog.getByRole("button", {
    exact: true,
    name: "確認並返回檢查",
  });
  await confirm.click();
  await expect(
    dialog.getByText("伺服器已確認「確認目前密碼」完成。", { exact: true })
  ).toBeVisible();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/^密碼已確認，/u)).toBeVisible();
};

/** Real pre-cutover public command and its opaque browser reference, not a fabricated receipt. */
export const dispatchOriginalRole = async (
  page: Page,
  actor: { userId: string; password: string },
  family: "department-manager" | "program-leader",
  input: Record<string, unknown>
) => {
  const proofStatus = await page.evaluate(
    async ({ password, operationKey }) => {
      const response = await fetch("/api/v2/account/password-confirmation", {
        body: JSON.stringify({ operationKey, password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return response.status;
    },
    { operationKey: randomUUID(), password: actor.password }
  );
  expect(proofStatus).toBe(201);
  return page.evaluate(
    async ({ actorUserId, endpoint, storageKey, command }) => {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          actorUserId,
          operationKey: command.operationKey,
        })
      );
      try {
        const response = await fetch(endpoint, {
          body: JSON.stringify(command),
          headers: {
            "content-type": "application/json",
            "x-efcc-expected-actor-id": actorUserId,
          },
          method: "POST",
        });
        return response.status;
      } catch {
        return null;
      }
    },
    {
      actorUserId: actor.userId,
      command: { ...input, operationKey: randomUUID() },
      endpoint: `/api/v2/roles/${family === "department-manager" ? "department-managers" : "program-leaders"}`,
      storageKey: `efcc.${family}.operation.v1:${encodeURIComponent(actor.userId)}`,
    }
  );
};
