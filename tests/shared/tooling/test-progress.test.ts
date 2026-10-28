import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";

import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase as NativeCase,
  TestResult,
} from "@playwright/test/reporter";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestCase } from "vitest/node";

import PlaywrightProgressReporter from "../../../scripts/playwright-progress-reporter";
import { runWithProgress } from "../../../scripts/test-progress";
import VitestProgressReporter from "../../../scripts/vitest-progress-reporter";

const secret =
  "password=synthetic-secret cookie=session-private /private/test-name";
const unitCase = (id: string, state: "passed" | "failed" | "skipped") =>
  ({
    id,
    name: secret,
    result: () => ({
      errors: state === "failed" ? [{ message: secret }] : undefined,
      state,
    }),
  }) as TestCase;
const nativeCase = (id: string, project: string) =>
  ({
    id,
    parent: { project: () => ({ name: project }) },
    title: secret,
  }) as NativeCase;
const nativeResult = (status: TestResult["status"], retry = 0) =>
  ({
    errors: [{ message: secret }],
    retry,
    status,
    stderr: [secret],
    stdout: [secret],
  }) as TestResult;
const nativeSuite = (tests: NativeCase[]) =>
  ({ allTests: () => tests }) as Suite;
const progressFile = (env: Record<string, string | undefined>): string => {
  if (!env.EFCC_PROGRESS_FILE) {
    throw new Error("Expected a private progress channel");
  }
  return env.EFCC_PROGRESS_FILE;
};

const capture = () => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
};

describe("safe test progress", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("counts unique cases without leaking identities, errors or private channel paths", async () => {
    const lines = capture();
    let channel = "";
    await runWithProgress("unit", {}, (env) => {
      channel = progressFile(env);
      expect(statSync(channel).mode.toString(8).slice(-3)).toBe("600");
      vi.stubEnv("EFCC_PROGRESS_FILE", channel);
      const reporter = new VitestProgressReporter();
      reporter.onTestRunStart();
      reporter.onTestCaseResult(unitCase(secret, "failed"));
      reporter.onTestCaseResult(unitCase(secret, "passed"));
      reporter.onTestCaseResult(unitCase("second", "passed"));
      reporter.onTestCaseResult(unitCase("skip", "skipped"));
      reporter.onTestRunEnd();
      expect(readFileSync(channel, "utf-8")).not.toContain(secret);
    });
    expect(existsSync(channel)).toBe(false);
    expect(lines.join("")).toContain("completed=2 failed=1");
    expect(lines.join("")).not.toContain(secret);
    expect(lines.join("")).not.toContain(channel);
    expect(lines.join("")).not.toContain("\r");
  });
  it("aggregates parallel projects and retries without counting attempts or skipped cases", async () => {
    const lines = capture();
    await runWithProgress(
      "native",
      {},
      (env) => {
        vi.stubEnv("EFCC_PROGRESS_FILE", env.EFCC_PROGRESS_FILE);
        const reporter = new PlaywrightProgressReporter();
        const http = nativeCase(secret, "features-http");
        const browser = nativeCase(secret, "features-chromium");
        const another = nativeCase("another", "features-http");
        reporter.onBegin(
          {} as FullConfig,
          nativeSuite([http, browser, another])
        );
        reporter.onTestEnd(http, nativeResult("failed"));
        reporter.onTestEnd(browser, nativeResult("passed"));
        reporter.onTestEnd(http, nativeResult("passed", 1));
        reporter.onTestEnd(another, nativeResult("skipped"));
        reporter.onEnd({ status: "failed" } as FullResult);
        expect(readFileSync(progressFile(env), "utf-8")).not.toContain(secret);
      },
      { nativeProjects: { "features-chromium": 1, "features-http": 2 } }
    );
    expect(lines.join("")).toContain("completed=2 total=3 failed=1");
    expect(lines.join("")).toContain("features-http:1/2:1");
    expect(lines.join("")).toContain("features-chromium:1/1:0");
    expect(lines.join("")).not.toContain(secret);
  });

  it("throttles changing counters and emits bounded no-progress heartbeats without a TTY", async () => {
    vi.useFakeTimers();
    const lines = capture();
    await runWithProgress("unit", {}, async (env) => {
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("status=started");
      vi.stubEnv("EFCC_PROGRESS_FILE", env.EFCC_PROGRESS_FILE);
      const reporter = new VitestProgressReporter();
      reporter.onTestRunStart();
      reporter.onTestCaseResult(unitCase("one", "passed"));
      reporter.onTestCaseResult(unitCase("two", "failed"));
      await vi.advanceTimersByTimeAsync(1999);
      expect(lines).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2001);
      expect(lines.at(-1)).toContain("completed=2 failed=1");
      const beforeHeartbeat = lines.length;
      await vi.advanceTimersByTimeAsync(8000);
      expect(lines).toHaveLength(beforeHeartbeat);
      await vi.advanceTimersByTimeAsync(2000);
      expect(lines).toHaveLength(beforeHeartbeat + 1);
      expect(lines.at(-1)).toContain("elapsedMs=14000");
      reporter.onTestRunEnd();
    });
    expect(lines.at(-1)).toContain(
      "status=command-passed progress=available completed=2 failed=1"
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["invalid-json", secret],
    [
      "unknown-project",
      JSON.stringify({
        kind: "running",
        projects: [{ completed: 1, failed: 0, project: secret }],
        seq: 1,
        version: 1,
      }),
    ],
    [
      "unexpected-fields",
      JSON.stringify({
        kind: "running",
        projects: [{ completed: 1, failed: 0, project: "unit" }],
        secret,
        seq: 1,
        version: 1,
      }),
    ],
    [
      "negative-count",
      JSON.stringify({
        kind: "running",
        projects: [{ completed: -1, failed: 0, project: "unit" }],
        seq: 1,
        version: 1,
      }),
    ],
    [
      "unsafe-integer",
      JSON.stringify({
        kind: "running",
        projects: [
          {
            completed: Number.MAX_SAFE_INTEGER + 1,
            failed: 0,
            project: "unit",
          },
        ],
        seq: 1,
        version: 1,
      }),
    ],
    [
      "failed-exceeds-completed",
      JSON.stringify({
        kind: "running",
        projects: [{ completed: 1, failed: 2, project: "unit" }],
        seq: 1,
        version: 1,
      }),
    ],
    ["oversized-line", "x".repeat(4097)],
    ["oversized-channel", "x".repeat(4 * 1024 * 1024 + 1)],
    ["partial-event", '{"version":1'],
  ])(
    "reports %s as unavailable without echoing it or inventing a final count",
    async (label, event) => {
      const lines = capture();
      await runWithProgress("unit", {}, (env) => {
        writeFileSync(
          progressFile(env),
          event + (label === "partial-event" ? "" : "\n")
        );
      });
      expect(lines.at(-1)).toContain("progress=unavailable");
      expect(lines.at(-1)).not.toContain("completed=");
      expect(lines.join("")).not.toContain(secret);
    }
  );

  it("rejects decreasing counters after printing only the last safe monotonic snapshot", async () => {
    vi.useFakeTimers();
    const lines = capture();
    await runWithProgress("unit", {}, async (env) => {
      appendFileSync(
        progressFile(env),
        `${JSON.stringify({ kind: "running", projects: [{ completed: 2, failed: 1, project: "unit" }], seq: 1, version: 1 })}\n`
      );
      await vi.advanceTimersByTimeAsync(2000);
      appendFileSync(
        progressFile(env),
        `${JSON.stringify({ kind: "finished", projects: [{ completed: 1, failed: 0, project: "unit" }], seq: 2, version: 1 })}\n`
      );
    });
    expect(lines.join("")).toContain("completed=2 failed=1");
    expect(lines.join("")).not.toContain("completed=1");
    expect(lines.at(-1)).toContain("progress=unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes missing and stale reporter observations from a command outcome", async () => {
    vi.useFakeTimers();
    const lines = capture();
    await runWithProgress("coverage", {}, () => 7);
    expect(lines.at(-1)).toContain(
      "status=command-passed progress=unavailable"
    );
    expect(lines.at(-1)).not.toContain("completed=");
    await runWithProgress("unit", {}, async (env) => {
      appendFileSync(
        progressFile(env),
        `${JSON.stringify({ kind: "running", projects: [{ completed: 0, failed: 0, project: "unit" }], seq: 1, version: 1 })}\n`
      );
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(lines.at(-1)).toContain("progress=stale");
    expect(lines.at(-1)).not.toContain("completed=");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["failed", "timedout", "interrupted"])(
    "preserves the original %s work failure and disposes private resources",
    async (status) => {
      vi.useFakeTimers();
      const lines = capture();
      const error = new Error(secret);
      if (status === "timedout") {
        Object.defineProperty(error, Symbol.for("efcc.safe-command-failure"), {
          value: { outcome: "timeout" },
        });
      } else if (status === "interrupted") {
        error.name = "AbortError";
      }
      let channel = "";
      const originalEnv = { EFCC_PROGRESS_FILE: secret };
      await expect(
        runWithProgress("build", originalEnv, (env) => {
          channel = progressFile(env);
          throw error;
        })
      ).rejects.toBe(error);
      expect(lines.at(-1)).toContain(`status=${status}`);
      expect(lines.join("")).not.toContain(secret);
      expect(originalEnv.EFCC_PROGRESS_FILE).toBe(secret);
      expect(existsSync(channel)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("publishes reporter health failures instead of allowing swallowed lifecycle exceptions to look healthy", async () => {
    const lines = capture();
    await runWithProgress(
      "native",
      {},
      (env) => {
        vi.stubEnv("EFCC_PROGRESS_FILE", env.EFCC_PROGRESS_FILE);
        const reporter = new PlaywrightProgressReporter();
        const test = nativeCase(secret, "features-http");
        reporter.onBegin({} as FullConfig, nativeSuite([test]));
        Object.defineProperty(test, "id", {
          get: () => {
            throw new Error(secret);
          },
        });
        reporter.onTestEnd(test, nativeResult("passed"));
        expect(
          reporter.onEnd({ status: "passed" } as FullResult)
        ).toBeUndefined();
      },
      { nativeProjects: { "features-http": 1 } }
    );
    expect(lines.at(-1)).toContain("progress=unavailable");
    expect(lines.at(-1)).not.toContain("completed=");
    expect(lines.join("")).not.toContain(secret);
  });

  it("rejects an unknown project at the reporter boundary without disclosing its name", async () => {
    const lines = capture();
    await runWithProgress(
      "native",
      {},
      (env) => {
        vi.stubEnv("EFCC_PROGRESS_FILE", env.EFCC_PROGRESS_FILE);
        const reporter = new PlaywrightProgressReporter();
        reporter.onBegin(
          {} as FullConfig,
          nativeSuite([nativeCase("id", secret)])
        );
        reporter.onEnd({ status: "passed" } as FullResult);
      },
      { nativeProjects: { "features-http": 1 } }
    );
    expect(lines.at(-1)).toContain("progress=unavailable");
    expect(lines.join("")).not.toContain(secret);
  });

  it("does not let invalid stage labels or unknown native totals enter public output", async () => {
    const lines = capture();
    const work = vi.fn(() => 1);
    await expect(runWithProgress(secret, {}, work)).rejects.toThrow(
      "Unknown progress stage"
    );
    await expect(
      runWithProgress("native", {}, work, { nativeProjects: { [secret]: 1 } })
    ).rejects.toThrow("Invalid progress project totals");
    expect(work).not.toHaveBeenCalled();
    expect(lines).toHaveLength(0);
  });

  it("does not count a Native completion beyond actual selected project-case totals", async () => {
    const lines = capture();
    await runWithProgress(
      "native",
      {},
      (env) => {
        vi.stubEnv("EFCC_PROGRESS_FILE", env.EFCC_PROGRESS_FILE);
        const reporter = new PlaywrightProgressReporter();
        const first = nativeCase("first", "features-http");
        const second = nativeCase("second", "features-http");
        reporter.onBegin({} as FullConfig, nativeSuite([first, second]));
        reporter.onTestEnd(first, nativeResult("passed"));
        reporter.onTestEnd(second, nativeResult("passed"));
        reporter.onEnd({ status: "passed" } as FullResult);
      },
      { nativeProjects: { "features-http": 1 } }
    );
    expect(lines.at(-1)).toContain("progress=unavailable");
    expect(lines.at(-1)).not.toContain("completed=");
  });

  it("preserves even an opaque thrown object rather than reading an unsafe exception field", async () => {
    const lines = capture();
    const error = Object.defineProperty({}, "name", {
      get: () => {
        throw new Error(secret);
      },
    });
    await expect(
      runWithProgress("check", {}, () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(lines.at(-1)).toContain("status=failed");
    expect(lines.join("")).not.toContain(secret);
  });

  it.each([false, true])(
    "preserves bootstrap environment mutations and restores only the scoped progress property on failure=%s",
    async (fail) => {
      capture();
      const env: Record<string, string | undefined> = {
        EFCC_PROGRESS_FILE: secret,
      };
      const error = new Error("Required setup failed");
      const run = runWithProgress("setup", env, (childEnv) => {
        expect(childEnv).toBe(env);
        expect(childEnv.EFCC_PROGRESS_FILE).not.toBe(secret);
        childEnv.npm_config_userconfig = "/private/synthetic-empty-npmrc";
        childEnv.npm_config_globalconfig =
          "/private/synthetic-empty-global-npmrc";
        childEnv.TURBO_ENV_MODE = "strict";
        if (fail) {
          throw error;
        }
        return 7;
      });
      await (fail
        ? expect(run).rejects.toBe(error)
        : expect(run).resolves.toBe(7));
      expect(env).toEqual({
        EFCC_PROGRESS_FILE: secret,
        TURBO_ENV_MODE: "strict",
        npm_config_globalconfig: "/private/synthetic-empty-global-npmrc",
        npm_config_userconfig: "/private/synthetic-empty-npmrc",
      });
      const fresh: Record<string, string | undefined> = {};
      await runWithProgress("check", fresh, (childEnv) => {
        childEnv.CI = "true";
      });
      expect(fresh).toEqual({ CI: "true" });
      expect(Object.hasOwn(fresh, "EFCC_PROGRESS_FILE")).toBe(false);
    }
  );
});
