import type { Page, TestInfo } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { scanAccessibilityBaseline } from "../../../tests/e2e/accessibility-baseline";

vi.mock("@axe-core/playwright", () => ({
  AxeBuilder: class {
    result = {
      inapplicable: [],
      incomplete: [],
      passes: [],
      violations: [],
    };

    withTags() {
      return this;
    }

    analyze() {
      return this.result;
    }
  },
}));

const source = "a".repeat(40);
const page = {
  url: () => "http://127.0.0.1/sign-in",
  viewportSize: () => ({ height: 1024, width: 1440 }),
} as unknown as Page;

const testInfo = (
  projectSource: string | null = null,
  configSource: string | null = null
) => {
  const attach = vi.fn().mockResolvedValue(null);
  return {
    attach,
    config: { metadata: configSource ? { source: configSource } : {} },
    project: { metadata: projectSource ? { source: projectSource } : {} },
  } as unknown as TestInfo & { attach: ReturnType<typeof vi.fn> };
};

const scan = (info: ReturnType<typeof testInfo>) =>
  scanAccessibilityBaseline(page, info, {
    role: "anonymous",
    state: "sign-in",
  });

const attachedReport = (info: ReturnType<typeof testInfo>) => {
  const attachment = info.attach.mock.calls[0]?.[1] as { body: Buffer };
  const report = JSON.parse(attachment.body.toString("utf-8")) as {
    source: string;
    sourceBinding: string;
  };
  return { source: report.source, sourceBinding: report.sourceBinding };
};

describe("Axe baseline source identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("labels a direct command without runner identity as unbound", async () => {
    vi.stubEnv("EFCC_TEST_SOURCE", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const info = testInfo();

    await scan(info);

    expect(attachedReport(info)).toEqual({
      source: "UNBOUND",
      sourceBinding: "UNBOUND",
    });
  });

  it("uses the existing Playwright metadata when it matches the gate source", async () => {
    vi.stubEnv("EFCC_TEST_SOURCE", source);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const info = testInfo(null, source);

    await scan(info);

    expect(attachedReport(info)).toEqual({
      source,
      sourceBinding: "SOURCE_BOUND",
    });
  });

  it("fails closed when gate identity is missing from Playwright metadata", async () => {
    vi.stubEnv("EFCC_TEST_SOURCE", source);
    const info = testInfo();

    await expect(scan(info)).rejects.toThrow(
      "Axe baseline source metadata does not match EFCC_TEST_SOURCE."
    );
    expect(info.attach).not.toHaveBeenCalled();
  });

  it("fails closed when Playwright metadata differs from the gate source", async () => {
    vi.stubEnv("EFCC_TEST_SOURCE", source);
    const info = testInfo("b".repeat(40));

    await expect(scan(info)).rejects.toThrow(
      "Axe baseline source metadata does not match EFCC_TEST_SOURCE."
    );
    expect(info.attach).not.toHaveBeenCalled();
  });
});
