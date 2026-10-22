import { expect } from "../../support/credential-fixtures";
import { securityTest } from "./fixtures";

securityTest(
  "Security-only Account exposes a real Status return and sign-out without contact fields",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ holder, caseApp, signedInPage: page }, testInfo) => {
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = (SELECT id FROM user WHERE username = ?)"
      )
      .bind(holder.username)
      .run();
    await page.goto("/account?task=phone");
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶安全" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "返回帳戶狀態" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "登出" })
    ).toBeVisible();
    await expect(page.getByText(holder.email, { exact: true })).toHaveCount(0);
    await expect(page.getByText(holder.username, { exact: true })).toHaveCount(
      0
    );
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("security-only-hub.png"),
    });
    await page.getByRole("link", { exact: true, name: "返回帳戶狀態" }).click();
    await expect(page).toHaveURL(/\/status$/u);
    await page.goBack();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶安全" })
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("link", { exact: true, name: "返回帳戶狀態" })
    ).toBeVisible();
    await expect(page.getByText(holder.email, { exact: true })).toHaveCount(0);
    await page.setViewportSize({ height: 852, width: 320 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("security-only-hub-320-text200.png"),
    });
    await page.getByRole("button", { exact: true, name: "登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    const native = await page.request.get("/api/auth/get-session");
    expect(native.status()).toBe(200);
    expect(await native.json()).toBeNull();
  }
);
