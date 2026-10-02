import { expect, test } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { buildActivityFixtures } from "../scenarios/activities";
import { waitForSignInWindow } from "../scenarios/limiter";
import { runLocalSql, seedActivities, seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const activityFixtures = buildActivityFixtures();

const restoreEventTable = async () => {
  runLocalSql(
    "create table program_event (created_at integer not null, ends_at integer, id text primary key not null, program_id text not null references program(id) on update no action on delete cascade, starts_at integer not null, title text not null)"
  );
  runLocalSql(
    "create index program_event_program_id_idx on program_event (program_id)"
  );
  runLocalSql(
    "create index program_event_starts_at_idx on program_event (starts_at)"
  );
  await seedActivities({ events: activityFixtures.events });
};

test.beforeAll(async () => {
  await seedSyntheticAccounts();
  await seedActivities(activityFixtures);
});

test("injected local D1 read failure shows generic unavailable recovery", async ({
  page,
}) => {
  await waitForSignInWindow("/sign-in/username");
  const signIn = await page.request.post("/api/auth/sign-in/username", {
    data: { password: wong.password, username: wong.username },
  });
  expect(signIn.status()).toBe(200);

  // Inject a local D1 schema failure at the actual Home query boundary. This
  // is a disposable test fixture fault, not evidence of a production outage.
  runLocalSql("drop table program_event");
  try {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "暫時未能載入主頁" })
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "系統暫時無法載入你的資料"
    );
    const bodyText = await page.locator("body").textContent();
    const body = bodyText ?? "";
    expect(body.toLowerCase()).not.toContain("no such table");
    expect(body).not.toContain("program_event");
  } finally {
    await restoreEventTable();
  }

  // Retry makes a new authoritative request; restored D1 data renders Home.
  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
});

test("a status read failure exposes no SQL and retry reloads current status", async ({
  page,
}) => {
  await waitForSignInWindow("/sign-in/username");
  const signIn = await page.request.post("/api/auth/sign-in/username", {
    data: { password: wong.password, username: wong.username },
  });
  expect(signIn.status()).toBe(200);

  // This local column fault reaches the qualified status identity query.
  runLocalSql(
    "alter table person_profile rename column membership_status to fault_membership_status"
  );
  try {
    const response = await page.request.get("/status");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("Failed query");
    expect(html).not.toContain("membership_status");
    expect(html).not.toContain("no such column");

    await page.goto("/status");
    await expect(
      page.getByRole("heading", { name: "暫時未能載入帳戶狀態" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
  } finally {
    runLocalSql(
      "alter table person_profile rename column fault_membership_status to membership_status"
    );
  }

  await page.getByRole("button", { name: "重試" }).click();
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "主要導覽" })
      .getByRole("link", { exact: true, name: "主頁" })
  ).toBeVisible();
});
