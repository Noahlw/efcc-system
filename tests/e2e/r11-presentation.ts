/* eslint-disable no-await-in-loop -- Viewport transitions share one live Page. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

const contexts = [
  { height: 844, width: 390 },
  { height: 1024, width: 1440 },
  { height: 568, width: 320 },
  { height: 1024, width: 768 },
  { height: 768, width: 1024 },
  { height: 390, width: 844 },
  { height: 568, textScale: 2, width: 320 },
  { height: 1024, textScale: 2, width: 1440 },
];

const source = {
  diffSha256: createHash("sha256")
    .update(
      execFileSync("git", [
        "diff",
        "HEAD",
        "--",
        "src",
        "tests",
        "playwright.config.ts",
      ])
    )
    .digest("hex"),
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).trim(),
};

/** Production DOM on the real Worker/D1 journey; root-font scaling is a fixture,
 * not evidence of browser zoom, a soft keyboard, or physical PWA behavior. */
export const qualifyPresentation = async (
  page: Page,
  info: TestInfo,
  screen: string
) => {
  // Capture the settled screen, rather than the server's pre-hydration markup.
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const originalViewport = page.viewportSize();
  const originalFont = await page.evaluate(() => ({
    inline: document.documentElement.style.fontSize,
    pixels: Number(
      getComputedStyle(document.documentElement).fontSize.slice(0, -2)
    ),
  }));
  // The person-list search is intentionally hidden on phones after selection.
  // Hidden editor fields still carry drafts and must survive the layout switch.
  const drafts = () =>
    page
      .locator("input[id]:not([type=hidden]):not([type=search]), textarea[id]")
      .evaluateAll((fields) =>
        fields.map((field) => ({
          checked:
            field instanceof HTMLInputElement &&
            (field.type === "checkbox" || field.type === "radio")
              ? field.checked
              : undefined,
          value: (field as HTMLInputElement | HTMLTextAreaElement).value,
        }))
      );
  const originalDraft = await drafts();
  const results: typeof contexts = [];
  const captures: {
    file: string;
    sha256: string;
    capturedAt: string;
    position: "start" | "final-control";
    viewport: { width: number; height: number };
    rootFontScale: number;
    dpr: number;
    url: string;
  }[] = [];
  const measurements: typeof contexts =
    info.project.name.startsWith("review-") && originalViewport
      ? [originalViewport, ...contexts]
      : contexts;
  try {
    for (const context of measurements) {
      await page.setViewportSize({
        height: context.height,
        width: context.width,
      });
      await page.evaluate(
        (size) => {
          document.documentElement.style.fontSize = `${size}px`;
        },
        originalFont.pixels * (context.textScale ?? 1)
      );
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        overflowing: [...document.querySelectorAll("body *")]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.width > 0 &&
              (box.right > window.innerWidth + 1 ||
                box.left < -1 ||
                element.scrollWidth > element.clientWidth + 1)
            );
          })
          .slice(0, 8)
          .map((element) => `${element.tagName}.${element.className}`),
      }));
      expect(
        geometry.overflow,
        `${screen} ${JSON.stringify(context)}: ${geometry.overflowing.join("; ")}`
      ).toBeLessThanOrEqual(1);
      if (screen === "phone") {
        const labelLines = await page
          .locator("dt")
          .filter({ hasText: /^Username$/u })
          .evaluate((label) => {
            const { height } = label.getBoundingClientRect();
            return (
              height / Number(getComputedStyle(label).lineHeight.slice(0, -2))
            );
          });
        expect(
          labelLines,
          "short metadata labels remain readable"
        ).toBeLessThanOrEqual(2);
      }
      const dialog = page.getByRole("dialog");
      const scope = (await dialog.count())
        ? dialog.last()
        : page.locator("body");
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        for (const region of document.querySelectorAll("[data-page-scroll]")) {
          region.scrollTop = 0;
        }
      });
      await scope.evaluate((container) => {
        container.scrollTop = 0;
        if (container.parentElement) {
          container.parentElement.scrollTop = 0;
        }
      });
      const password = page.getByLabel("新臨時密碼", { exact: true });
      const passwordInputs = page.locator(
        'input[autocomplete="current-password"], input[autocomplete="new-password"]'
      );
      const masks = [
        ...((await password.count()) ? [password] : []),
        ...((await passwordInputs.count()) ? [passwordInputs] : []),
      ];
      const captureOptions = {
        animations: "disabled" as const,
        fullPage: false,
        mask: masks,
        scale: "css" as const,
        timeout: 30_000,
      };
      const capture = `${screen}-${context.width}x${context.height}-${context.textScale ?? 1}x`;
      // Bound artifacts to the actual viewport, even with a long audit history.
      const start = await page.screenshot({
        ...captureOptions,
        path: info.outputPath(`${capture}.png`),
      });
      captures.push({
        capturedAt: new Date().toISOString(),
        dpr: await page.evaluate(() => window.devicePixelRatio),
        file: `${capture}.png`,
        position: "start",
        rootFontScale: context.textScale ?? 1,
        sha256: createHash("sha256").update(start).digest("hex"),
        url: page.url(),
        viewport: { height: context.height, width: context.width },
      });
      const controls = scope.locator(
        "button:visible:not(:disabled), a:visible[href], input:visible:not(:disabled), textarea:visible:not(:disabled), select:visible:not(:disabled)"
      );
      const finalControl = controls.last();
      await expect(
        finalControl,
        `${screen} has a reachable final control`
      ).toBeVisible();
      // Check the final endpoint, including when enlarged text makes a link
      // taller than its scrollport. Centering such a link measures clipped pixels.
      await finalControl.evaluate((control) =>
        control.scrollIntoView({ block: "end" })
      );
      await expect(finalControl).toBeInViewport();
      const target = await finalControl.boundingBox();
      const nav = page.getByRole("navigation", { name: "主要導覽" });
      if (context.width < 1024 && (await nav.isVisible()) && target) {
        const navBox = await nav.boundingBox();
        expect(
          target.y + target.height,
          `${screen}: final action is above fixed navigation`
        ).toBeLessThanOrEqual(navBox?.y ?? context.height);
      }
      const end = await page.screenshot({
        ...captureOptions,
        path: info.outputPath(`${capture}-end.png`),
      });
      captures.push({
        capturedAt: new Date().toISOString(),
        dpr: await page.evaluate(() => window.devicePixelRatio),
        file: `${capture}-end.png`,
        position: "final-control",
        rootFontScale: context.textScale ?? 1,
        sha256: createHash("sha256").update(end).digest("hex"),
        url: page.url(),
        viewport: { height: context.height, width: context.width },
      });
      expect(
        await drafts(),
        `${screen}: viewport/text changes preserve drafts`
      ).toEqual(originalDraft);
      results.push(context);
    }
    const metadataPath = info.outputPath(`${screen}-captures.json`);
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          captures,
          contexts: results,
          engine: info.project.use.browserName,
          project: info.project.name,
          screen,
          seam: "Worker/D1/browser",
          source,
          test: info.titlePath,
          textScale: "root-font fixture",
        },
        null,
        2
      )
    );
    await info.attach(`r11-${screen}`, {
      contentType: "application/json",
      path: metadataPath,
    });
  } finally {
    await page.evaluate((font) => {
      document.documentElement.style.fontSize = font;
    }, originalFont.inline);
    if (originalViewport) {
      await page.setViewportSize(originalViewport);
    }
  }
};
