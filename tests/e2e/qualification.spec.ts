import { setTimeout as delay } from "node:timers/promises";

import { expect, test } from "@playwright/test";

import {
  approvedAccounts,
  findAccount,
  restrictedAccounts,
} from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");
const pendingName = findAccount(restrictedAccounts, "law.pending");

type RGB = readonly [number, number, number];

const luminance = (color: RGB): number => {
  const [red, green, blue] = color.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

const contrastRatio = (foreground: RGB, background: RGB): number => {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

test("desktop sign-in meets typography, target, contrast and keyboard baselines", async ({
  page,
}) => {
  await page.goto("/sign-in");

  const measurements = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D is unavailable for color measurement.");
    }
    const rgb = (color: string): [number, number, number] => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const { data } = context.getImageData(0, 0, 1, 1);
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    };
    const controls = [...document.querySelectorAll("button, input")].map(
      (element) => {
        const { height, width } = element.getBoundingClientRect();
        return { height, width };
      }
    );
    const primary = document.querySelector("button[type='submit']");
    const primaryStyle = primary ? getComputedStyle(primary) : null;
    const muted = document.querySelector(".text-muted-foreground");
    const mutedStyle = muted ? getComputedStyle(muted) : null;
    return {
      bodyColor: rgb(body.color),
      bodyFontSize: Number(body.fontSize.slice(0, -2)),
      controls,
      mutedBackground: rgb(root.backgroundColor),
      mutedColor: rgb(mutedStyle?.color ?? "rgb(0, 0, 0)"),
      pageColor: rgb(root.backgroundColor),
      primaryBackground: rgb(
        primaryStyle?.backgroundColor ?? "rgb(255, 255, 255)"
      ),
      primaryColor: rgb(primaryStyle?.color ?? "rgb(0, 0, 0)"),
    };
  });

  expect(measurements.bodyFontSize).toBeGreaterThanOrEqual(17);
  expect(measurements.controls.length).toBeGreaterThan(0);
  expect(measurements.controls.every((control) => control.height >= 44)).toBe(
    true
  );
  expect(measurements.controls.every((control) => control.width >= 44)).toBe(
    true
  );
  await expect(page.getByLabel("使用者名稱")).toHaveAttribute(
    "autocomplete",
    "username"
  );
  await expect(page.getByLabel("密碼")).toHaveAttribute(
    "autocomplete",
    "current-password"
  );
  expect(
    contrastRatio(measurements.bodyColor, measurements.pageColor)
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(measurements.mutedColor, measurements.mutedBackground)
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(measurements.primaryColor, measurements.primaryBackground)
  ).toBeGreaterThanOrEqual(4.5);

  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(active);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number(style.outlineWidth.slice(0, -2)),
    };
  });
  expect(focus?.outlineStyle).not.toBe("none");
  expect(focus?.outlineWidth).toBeGreaterThanOrEqual(2);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(
    (text) => navigator.clipboard.writeText(text),
    wong.username
  );
  await page.getByLabel("使用者名稱").focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+V" : "Control+V"
  );
  await expect(page.getByLabel("使用者名稱")).toHaveValue(wong.username);
  await page.getByLabel("密碼").fill("invalid");
  await page.route("**/api/auth/sign-in/username", (route) =>
    route.abort("failed")
  );
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("alert")).toContainText("無法連接系統");
  const errorColors = await page.getByRole("alert").evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D is unavailable for color measurement.");
    }
    const rgb = (value: string): [number, number, number] => {
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const { data } = context.getImageData(0, 0, 1, 1);
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    };
    return {
      background: rgb(style.backgroundColor),
      foreground: rgb(style.color),
    };
  });
  expect(
    contrastRatio(errorColors.foreground, errorColors.background)
  ).toBeGreaterThanOrEqual(4.5);
  await page.unroute("**/api/auth/sign-in/username");

  await waitForSignInWindow("/sign-in/username");
  await page.getByLabel("密碼").fill("");
  await page.getByLabel("密碼").focus();
  await page.keyboard.type(wong.password);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);

  await waitForSignInWindow("/sign-in/name");
  await page.getByRole("button", { name: "中文全名" }).click();
  await page.getByLabel("中文全名").fill(pendingName.fullName);
  await page.getByLabel("密碼").fill(pendingName.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
});

test("loading and rate-limit feedback are visible and recover after the window", async ({
  page,
}) => {
  await waitForSignInWindow("/sign-in/username");
  await page.goto("/sign-in");
  const attempts = await Promise.all([
    page.request.post("/api/auth/sign-in/username", {
      data: { password: "wrong-1", username: wong.username },
    }),
    page.request.post("/api/auth/sign-in/username", {
      data: { password: "wrong-2", username: wong.username },
    }),
    page.request.post("/api/auth/sign-in/username", {
      data: { password: "wrong-3", username: wong.username },
    }),
  ]);
  expect(attempts.map((response) => response.status())).toEqual([
    401, 401, 401,
  ]);

  await page.getByLabel("使用者名稱").fill(wong.username);
  await page.getByLabel("密碼").fill(wong.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("alert")).toContainText("嘗試次數過多");

  await waitForSignInWindow("/sign-in/username");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
});

test("unavailable sign-in gives a safe recoverable message", async ({
  page,
}) => {
  await waitForSignInWindow("/sign-in/username");
  await page.goto("/sign-in");
  await page.getByLabel("使用者名稱").fill(wong.username);
  await page.getByLabel("密碼").fill(wong.password);
  await page.route("**/api/auth/sign-in/username", (route) =>
    route.abort("failed")
  );
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("alert")).toContainText("無法連接系統");
  await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
});

test("a slow real response exposes submitting state and prevents duplicates", async ({
  page,
}) => {
  await waitForSignInWindow("/sign-in/username");
  await page.goto("/sign-in");
  await page.getByLabel("使用者名稱").fill(wong.username);
  await page.getByLabel("密碼").fill(wong.password);
  await page.route("**/api/auth/sign-in/username", async (route) => {
    const response = await route.fetch();
    await delay(500);
    await route.fulfill({ response });
  });

  await page.getByRole("button", { name: "登入" }).click();
  const busyButton = page.getByRole("button", { name: "登入中…" });
  await expect(busyButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "登入" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
});

test.describe("emulated Android viewport", () => {
  test.use({
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
    viewport: { height: 915, width: 412 },
  });

  test("both login modes reach Home/status and sign out on phone layout", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page).toHaveTitle(/登入/u);
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

    await waitForSignInWindow("/sign-in/username");
    await page.getByLabel("使用者名稱").fill(wong.username);
    await page.getByLabel("密碼").fill(wong.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);

    await waitForSignInWindow("/sign-in/name");
    await page.getByRole("button", { name: "中文全名" }).click();
    await page.getByLabel("中文全名").fill(chan.fullName);
    await page.getByLabel("密碼").fill(chan.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);

    await waitForSignInWindow("/sign-in/name");
    await page.getByRole("button", { name: "中文全名" }).click();
    await page.getByLabel("中文全名").fill(pendingName.fullName);
    await page.getByLabel("密碼").fill(pendingName.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
  });
});
