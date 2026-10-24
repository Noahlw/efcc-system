import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import type * as NodeOs from "node:os";
import path from "node:path";

import { afterEach, expect, it, onTestFinished, vi } from "vitest";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const configuration = async (localWorkers?: string, ci = false) => {
  const homeDirectory = mkdtempSync(path.join(tmpdir(), "efcc-workers-"));
  onTestFinished(() => rmSync(homeDirectory, { force: true, recursive: true }));
  vi.mocked(homedir).mockReturnValue(homeDirectory);
  vi.stubEnv("CI", ci ? "true" : "");
  // eslint-disable-next-line unicorn/no-useless-undefined -- Vitest requires an explicit value to unset a variable.
  vi.stubEnv("PLAYWRIGHT_WORKERS", undefined);
  if (localWorkers !== undefined) {
    const directory = path.join(homeDirectory, ".config", "efcc");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "feature-workers"), localWorkers);
  }
  const { default: config } =
    await import("../../../playwright.features.config");
  return config;
};

it("uses the shared two-worker default without a machine setting", async () => {
  const config = await configuration();
  expect(config.workers).toBe(2);
});

it("uses the machine's four-worker setting without shell setup", async () => {
  const config = await configuration("4\n");
  expect(config.workers).toBe(4);
});

it("keeps CI at two workers even when the machine setting is four", async () => {
  const config = await configuration("4\n", true);
  expect(config.workers).toBe(2);
});

it("rejects an invalid machine setting instead of silently choosing workers", async () => {
  await expect(configuration("invalid\n")).rejects.toThrow(
    "Feature worker count must be a positive integer."
  );
});
