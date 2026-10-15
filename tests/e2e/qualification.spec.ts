import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { expect, test as nativeTest } from "../support/fixtures";
import { qualifyPresentation } from "./r11-presentation";

const test = nativeTest.extend<{
  pendingName: { fullName: string; password: string };
  chan: { fullName: string; password: string };
}>({
  chan: async ({ app }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const account = {
      email: `${suffix}@example.com`,
      fullName: `陳測試${suffix}`,
      membershipStatus: "active" as const,
      password: "Synthetic-chan-password!",
      username: `chan.${suffix}`,
    };
    await app.provision.account(account);
    await use(account);
  },
  pendingName: async ({ app }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const account = {
      email: `${suffix}@example.com`,
      fullName: `羅待批${suffix}`,
      membershipStatus: "pending" as const,
      password: "Synthetic-pending-password!",
      username: `pending.${suffix}`,
    };
    await app.provision.account(account);
    await use(account);
  },
});

test.describe(
  "qualification",
  {
    tag: [
      "@native",
      "@qualification",
      "@browser",
      "@risk-accessibility",
      "@risk-presentation",
    ],
  },
  () => {
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
      return (
        (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
      );
    };

    test("desktop sign-in meets typography, target, contrast and keyboard baselines", async ({
      page,
      account: wong,
      pendingName,
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
      expect(
        measurements.controls.every((control) => control.height >= 44)
      ).toBe(true);
      expect(
        measurements.controls.every((control) => control.width >= 44)
      ).toBe(true);
      await expect(page.getByLabel("Username")).toHaveAttribute(
        "autocomplete",
        "username"
      );
      await expect(page.getByLabel("密碼", { exact: true })).toHaveAttribute(
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

      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.evaluate(
        (text) => navigator.clipboard.writeText(text),
        wong.username
      );
      await page.getByLabel("Username").focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+V" : "Control+V"
      );
      await expect(page.getByLabel("Username")).toHaveValue(wong.username);
      await page.getByLabel("密碼", { exact: true }).fill("invalid");
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

      await page.getByLabel("密碼", { exact: true }).fill("");
      await page.getByLabel("密碼", { exact: true }).focus();
      await page.keyboard.type(wong.password);
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { exact: true, name: "顯示密碼" })
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { exact: true, name: "登入" })
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "我的主頁" })
      ).toBeVisible();
      await page.goto("/account");
      await page.getByRole("button", { name: "登出" }).click();
      await expect(page).toHaveURL(/\/sign-in$/u);

      await page.getByRole("button", { name: "中文全名" }).click();
      await page.getByLabel("中文全名").fill(pendingName.fullName);
      await page.getByLabel("密碼", { exact: true }).fill(pendingName.password);
      await page.getByRole("button", { name: "登入" }).click();
      await expect(
        page.getByRole("heading", { name: "帳戶狀態" })
      ).toBeVisible();
      await page.getByRole("button", { name: "登出" }).click();
      await expect(page).toHaveURL(/\/sign-in$/u);
    });

    test(
      "loading and rate-limit feedback are visible and recover after the window",
      { tag: ["@mobile-critical", "@resilience", "@real-limiter"] },
      async ({ page, account: wong, app, extraHTTPHeaders }) => {
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

        await page.getByLabel("Username").fill(wong.username);
        await page.getByLabel("密碼", { exact: true }).fill(wong.password);
        const denied = page.waitForResponse("**/api/auth/sign-in/username");
        await page.getByRole("button", { name: "登入" }).click();
        const deniedResponse = await denied;
        expect(deniedResponse.status()).toBe(429);
        await expect(page.getByRole("alert")).toBeVisible();
        // Native auth normalizes this fixture's IPv6 address to its expanded /64 subnet.
        const ip = extraHTTPHeaders?.["cf-connecting-ip"];
        if (!ip) {
          throw new Error(
            "Native fixture omitted the actual request identity."
          );
        }
        const [prefix] = ip.split("::");
        if (!prefix) {
          throw new Error("Native fixture supplied an invalid IPv6 identity.");
        }
        const subnet = `${prefix
          .split(":")
          .map((group) => group.padStart(4, "0"))
          .join(":")}:0000:0000:0000:0000`;
        const key = `${subnet}|/sign-in/username`;
        const bucket = await app.db
          .prepare("SELECT count, last_request FROM rate_limit WHERE key = ?")
          .bind(key)
          .first<{ count: number; last_request: number }>();
        expect(bucket).not.toBeNull();
        expect(bucket?.count).toBe(3);
        // The actual shared request bucket opens naturally; no state reset or ordinary pacing.
        await delay(
          Math.max(0, (bucket?.last_request ?? 0) + 10_350 - Date.now())
        );
        await page.getByRole("button", { name: "登入" }).click();
        await expect(
          page.getByRole("heading", { name: "我的主頁" })
        ).toBeVisible();
      }
    );

    test(
      "unavailable sign-in gives a safe recoverable message",
      { tag: ["@mobile-critical", "@resilience", "@injected-network"] },
      async ({ page, account: wong }) => {
        await page.goto("/sign-in");
        await page.getByLabel("Username").fill(wong.username);
        await page.getByLabel("密碼", { exact: true }).fill(wong.password);
        await page.route("**/api/auth/sign-in/username", (route) =>
          route.abort("failed")
        );
        await page.getByRole("button", { name: "登入" }).click();
        await expect(page.getByRole("alert")).toContainText("無法連接系統");
        await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
      }
    );

    test(
      "a slow real response exposes submitting state and prevents duplicates",
      { tag: ["@mobile-critical", "@resilience", "@injected-delay"] },
      async ({ page, account: wong }) => {
        await page.goto("/sign-in");
        await page.getByLabel("Username").fill(wong.username);
        await page.getByLabel("密碼", { exact: true }).fill(wong.password);
        let posts = 0;
        await page.route("**/api/auth/sign-in/username", async (route) => {
          posts += 1;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await delay(500);
          await route.fulfill({ response });
        });

        const submitButton = page.locator('button[type="submit"]');
        await submitButton.click();
        await expect(submitButton).toBeDisabled();
        await expect(
          page.getByRole("heading", { name: "我的主頁" })
        ).toBeVisible();
        expect(posts).toBe(1);
      }
    );

    test.describe("emulated phone viewport", () => {
      test(
        "both login modes reach Home/status and sign out on phone layout",
        { tag: ["@mobile-critical", "@emulation"] },
        async ({ page, account: wong, chan, pendingName }, info) => {
          if (info.project.name === "features-chromium") {
            await page.setViewportSize({ height: 915, width: 412 });
          }
          await page.goto("/sign-in");
          await expect(page).toHaveTitle(/登入/u);
          const layout = await page.evaluate(() => ({
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

          await page.getByLabel("Username").fill(wong.username);
          await page.getByLabel("密碼", { exact: true }).fill(wong.password);
          await page.getByRole("button", { name: "登入" }).click();
          await expect(
            page.getByRole("heading", { name: "我的主頁" })
          ).toBeVisible();
          await page.goto("/account");
          await page.getByRole("button", { name: "登出" }).click();
          await expect(page).toHaveURL(/\/sign-in$/u);

          await page.getByRole("button", { name: "中文全名" }).click();
          await page.getByLabel("中文全名").fill(chan.fullName);
          await page.getByLabel("密碼", { exact: true }).fill(chan.password);
          await page.getByRole("button", { name: "登入" }).click();
          await expect(
            page.getByRole("heading", { name: "我的主頁" })
          ).toBeVisible();
          await page.goto("/account");
          await page.getByRole("button", { name: "登出" }).click();
          await expect(page).toHaveURL(/\/sign-in$/u);

          await page.getByRole("button", { name: "中文全名" }).click();
          await page.getByLabel("中文全名").fill(pendingName.fullName);
          await page
            .getByLabel("密碼", { exact: true })
            .fill(pendingName.password);
          await page.getByRole("button", { name: "登入" }).click();
          await expect(
            page.getByRole("heading", { name: "帳戶狀態" })
          ).toBeVisible();
          await page.getByRole("button", { name: "登出" }).click();
          await expect(page).toHaveURL(/\/sign-in$/u);
        }
      );
    });

    test(
      "responsive drafts, focus and explicit action survive every text context",
      { tag: ["@mobile-critical", "@presentation", "@emulation", "@privacy"] },
      async ({ page, account }, info) => {
        await page.goto("/sign-in");
        const username = page.getByLabel("Username");
        const password = page.getByLabel("密碼", { exact: true });
        const submit = page.getByRole("button", { exact: true, name: "登入" });
        await username.fill(account.username);
        await password.fill(account.password);
        await page
          .getByRole("button", { exact: true, name: "顯示密碼" })
          .click();
        await qualifyPresentation(page, info, "signin-draft", {
          criticalAction: submit,
          drafts: page.locator(
            'input[autocomplete="username"], input[autocomplete="current-password"]'
          ),
          focus: username,
          masks: [password],
        });
        await expect(username).toHaveValue(account.username);
        await expect(password).toHaveValue(account.password);
        // Compare original native PNG bytes: changing a visible secret cannot change its masked pixels.
        await password.scrollIntoViewIfNeeded();
        await submit.focus();
        const clip = await password.boundingBox();
        if (!clip) {
          throw new Error("Visible password has no screenshot geometry.");
        }
        const first = await page.screenshot({
          caret: "hide",
          clip,
          mask: [password],
        });
        await password.fill("Different-original-secret!");
        await submit.focus();
        await password.scrollIntoViewIfNeeded();
        const second = await page.screenshot({
          caret: "hide",
          clip,
          mask: [password],
        });
        expect(second.equals(first)).toBe(true);
        await password.fill(account.password);
        await submit.click();
        await expect(
          page.getByRole("heading", { name: "我的主頁" })
        ).toBeVisible();
      }
    );
  }
);
