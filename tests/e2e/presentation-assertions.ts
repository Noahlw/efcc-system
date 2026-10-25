/* eslint-disable no-await-in-loop -- Viewport transitions and captures share one live Page. */
import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";

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

export interface PresentationAssertions {
  drafts: Locator;
  criticalAction: Locator;
  masks?: Locator[];
  focus?: Locator;
}

/** Root-font scaling and device profiles are emulation, not physical-device/zoom proof. */
export const qualifyPresentation = async (
  page: Page,
  info: TestInfo,
  screen: string,
  assertions: PresentationAssertions
) => {
  const { drafts, criticalAction, focus } = assertions;
  info.annotations.push({ description: screen, type: "presentation" });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const originalViewport = page.viewportSize();
  const originalFont = await page.evaluate(() => ({
    inline: document.documentElement.style.fontSize,
    pixels: Number(
      getComputedStyle(document.documentElement).fontSize.slice(0, -2)
    ),
  }));
  const readDrafts = () =>
    drafts.evaluateAll((fields) =>
      fields.map((field) => {
        const input = field as HTMLInputElement;
        return { checked: input.checked, id: input.id, value: input.value };
      })
    );
  const originalDraft = await readDrafts();
  const measurements = originalViewport
    ? [originalViewport, ...contexts]
    : contexts;
  const resize = async (context: {
    width: number;
    height: number;
    textScale?: number;
  }) => {
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
  };
  const scrollStart = async () => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const region of document.querySelectorAll("[data-page-scroll]")) {
        region.scrollTop = 0;
      }
      // Closing dialogs can detach between measurements; scroll only live surfaces.
      for (const surface of document.querySelectorAll('[role="dialog"]')) {
        surface.scrollTop = 0;
        if (surface.parentElement) {
          surface.parentElement.scrollTop = 0;
        }
      }
    });
  };
  try {
    // Complete every behavioral assertion before optional screenshots can affect animations/scrolling.
    for (const context of measurements) {
      await resize(context);
      await scrollStart();
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth - window.innerWidth
            ),
          `${screen} ${JSON.stringify(context)} overflow`
        )
        .toBeLessThanOrEqual(1);
      if (screen === "phone") {
        const lines = await page
          .locator("dt")
          .filter({ hasText: /^Username$/u })
          .evaluate(
            (label) =>
              label.getBoundingClientRect().height /
              Number(getComputedStyle(label).lineHeight.slice(0, -2))
          );
        expect(
          lines,
          "short metadata labels remain readable"
        ).toBeLessThanOrEqual(2);
      }
      await expect(
        criticalAction,
        `${screen}: critical action remains reachable`
      ).toBeVisible();
      await criticalAction.scrollIntoViewIfNeeded();
      // Native stability first; end alignment respects the scrolling frame's bottom padding.
      await criticalAction.evaluate((control) =>
        control.scrollIntoView({ block: "end" })
      );
      await expect(criticalAction).toBeInViewport();
      const target = await criticalAction.boundingBox();
      const nav = page.getByRole("navigation", { name: "主要導覽" });
      if (context.width < 1024 && (await nav.isVisible()) && target) {
        const navBox = await nav.boundingBox();
        expect(
          target.y + target.height,
          `${screen}: action above fixed navigation`
        ).toBeLessThanOrEqual(navBox?.y ?? context.height);
      }
      if (focus) {
        await focus.focus();
        await expect(focus).toBeFocused();
      }
      expect(
        await readDrafts(),
        `${screen}: viewport/text changes preserve drafts`
      ).toEqual(originalDraft);
    }
    if (process.env.EFCC_CAPTURE_SUCCESS === "1") {
      const masks = [
        page.getByLabel("新臨時密碼", { exact: true }),
        page.locator(
          'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"]'
        ),
        ...(assertions.masks ?? []),
      ];
      let captureIndex = 0;
      const captureId = randomUUID();
      const attachScreenshot = async (
        name: string,
        captureKind: "viewport" | "action"
      ) => {
        const outputPath = info.outputPath(
          `presentation-${captureId}-${captureIndex}-${captureKind}.png`
        );
        captureIndex += 1;
        await page.screenshot({
          fullPage: false,
          mask: masks,
          path: outputPath,
          scale: "css",
        });
        await info.attach(name, {
          contentType: "image/png",
          path: outputPath,
        });
      };
      for (const context of measurements) {
        await resize(context);
        await scrollStart();
        const name = `${screen}-${context.width}x${context.height}-${"textScale" in context ? context.textScale : 1}x`;
        await attachScreenshot(name, "viewport");
        await criticalAction.scrollIntoViewIfNeeded();
        await criticalAction.evaluate((control) =>
          control.scrollIntoView({ block: "end" })
        );
        await attachScreenshot(`${name}-action`, "action");
      }
    }
  } finally {
    await page.evaluate((font) => {
      document.documentElement.style.fontSize = font;
    }, originalFont.inline);
    if (originalViewport) {
      await page.setViewportSize(originalViewport);
    }
  }
};
