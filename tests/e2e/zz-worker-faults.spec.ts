import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { buildActivityFixtures } from "../scenarios/activities";
import { waitForSignInWindow } from "../scenarios/limiter";
import { E2E_BASE_URL } from "../scenarios/local-env";
import {
  queryLocalSql,
  runLocalSql,
  seedActivities,
  seedSyntheticAccounts,
} from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");
const activityFixtures = buildActivityFixtures();

test("native auth origins and Hono post-guard failures stay contained", async ({
  page,
}) => {
  await waitForSignInWindow();
  const signedIn = await page.request.post("/api/auth/sign-in/username", {
    data: { password: wong.password, username: wong.username },
  });
  expect(signedIn.status()).toBe(200);
  const sessions = queryLocalSql<{ token: string }>(
    "select token from session"
  );
  expect(sessions.length).toBeGreaterThan(0);
  // This API-only Worker needs no production build or application assets.
  const assetsDirectory = mkdtempSync(
    path.join(tmpdir(), "efcc-fault-assets-")
  );
  const worker = spawn(
    path.resolve("node_modules/.bin/wrangler"),
    [
      "dev",
      "tests/worker/business-fault.ts",
      "--config",
      "wrangler.jsonc",
      "--assets",
      assetsDirectory,
      "--local",
      "--port",
      "5200",
      "--inspector-port",
      "0",
    ],
    {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const workerClosed = once(worker, "close");
  let workerOutput = "";
  const recordOutput = (chunk: string) => {
    workerOutput += chunk;
  };
  worker.stdout?.setEncoding("utf-8").on("data", recordOutput);
  worker.stderr?.setEncoding("utf-8").on("data", recordOutput);
  try {
    await expect
      .poll(
        async () => {
          try {
            const ready = await page.request.get(
              "http://localhost:5200/health"
            );
            return ready.status();
          } catch {
            return 0;
          }
        },
        { timeout: 20_000 }
      )
      .toBe(200);
    // Native fetch has no cookie jar: Vite and existing-session CSRF cannot
    // conceal a first-login bypass in either public credential entry.
    const freshOrigins = await Promise.all(
      [
        {
          body: { password: chan.password, username: chan.username },
          path: "/sign-in/username",
        },
        {
          body: { fullName: chan.fullName, password: chan.password },
          path: "/sign-in/name",
        },
        {
          body: { password: chan.password, username: chan.username },
          path: "/sign-in/username/",
        },
        {
          body: { fullName: chan.fullName, password: chan.password },
          path: "/sign-in/name/",
        },
      ].map(async (entry) => {
        const response = await fetch(
          `http://localhost:5200/api/auth${entry.path}`,
          {
            body: JSON.stringify(entry.body),
            headers: {
              "content-type": "application/json",
              origin: "https://evil.example",
            },
            method: "POST",
          }
        );
        return {
          hasSessionCookie: response.headers.has("set-cookie"),
          status: response.status,
        };
      })
    );
    expect(freshOrigins).toEqual([
      { hasSessionCookie: false, status: 403 },
      { hasSessionCookie: false, status: 403 },
      // The native router rejects trailing-slash variants before middleware.
      { hasSessionCookie: false, status: 404 },
      { hasSessionCookie: false, status: 404 },
    ]);

    const sameOrigin = await fetch(
      "http://localhost:5200/api/auth/sign-in/name",
      {
        body: JSON.stringify({
          fullName: chan.fullName,
          password: chan.password,
        }),
        headers: {
          "content-type": "application/json",
          origin: E2E_BASE_URL,
        },
        method: "POST",
      }
    );
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get("set-cookie")).toContain(
      "better-auth.session_token"
    );
    // Exercise the real auth handler without the Vite dev-origin filter.
    const crossOrigin = await page.request.post(
      "http://localhost:5200/api/auth/sign-out",
      {
        data: {},
        headers: { origin: "https://evil.example" },
      }
    );
    expect(crossOrigin.status()).toBe(403);
    const stillSignedIn = await page.request.get("/api/v2/me");
    expect(stillSignedIn.status()).toBe(200);
    const failed = await page.request.get("http://localhost:5200/api/v2/me");
    expect(failed.status()).toBe(500);
    expect(await failed.json()).toEqual({
      error: {
        code: "internal_error",
        message: "系統暫時無法完成請求，請稍後再試。",
      },
    });
    runLocalSql("alter table session rename to session_log_fault");
    try {
      const authFailure = await page.request.get(
        "http://localhost:5200/api/auth/get-session"
      );
      expect(authFailure.status()).toBe(500);
    } finally {
      runLocalSql("alter table session_log_fault rename to session");
    }
    const recovered = await page.request.get("/api/v2/me");
    expect(recovered.status()).toBe(200);
  } finally {
    worker.kill("SIGTERM");
    try {
      await workerClosed;
    } finally {
      rmSync(assetsDirectory, { force: true, recursive: true });
    }
  }
  // Boolean assertions keep even a failing regression from printing secrets.
  expect(sessions.some(({ token }) => workerOutput.includes(token))).toBe(
    false
  );
  expect(workerOutput.includes("Failed query")).toBe(false);
  expect(workerOutput).toContain("Authentication library event");
  expect(workerOutput).toContain("Unexpected business API failure");
});

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

  // Fault a status-only identity field; membership is read by the access
  // guard too, so breaking it would correctly stop at global unavailability.
  runLocalSql(
    "alter table person_profile rename column account_role to fault_account_role"
  );
  try {
    const response = await page.request.get("/status");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("Failed query");
    expect(html).not.toContain("account_role");
    expect(html).not.toContain("no such column");

    await page.goto("/status");
    await expect(
      page.getByRole("heading", { name: "暫時未能載入帳戶狀態" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "重試" })).toBeVisible();
  } finally {
    runLocalSql(
      "alter table person_profile rename column fault_account_role to account_role"
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
