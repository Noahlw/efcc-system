import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { onTestFinished, describe, expect, it } from "vitest";

import {
  assertNativeCoverage,
  assertNativeExecution,
  discoverNative,
  nativeCases,
  parseGateOptions,
} from "../../../scripts/test-runner";
import {
  assertNativeClassification,
  selectTests,
} from "../../../scripts/test-selection";
import { repository, fixtureGitEnvironment, fixture } from "./fixtures";

const report = (
  results: { retry: number; status: string }[],
  expectedStatus = "passed"
) => ({
  errors: [],
  suites: [
    {
      specs: [
        {
          column: 1,
          file: "case.spec.ts",
          id: "real-native-id",
          line: 1,
          tags: ["native", "http", "risk-csrf"],
          tests: [{ expectedStatus, projectName: "native-http", results }],
          title: "synthetic ingress",
        },
      ],
    },
  ],
});
const testSource = (body: string) =>
  `import { test, expect } from "@playwright/test";\ntest("native reporting boundary", { tag: ["@native", "@http", "@risk-csrf"] }, async () => { ${body} });\n`;
describe("native selection and execution", () => {
  it("requires every unfiltered definition in its exact runtime and engine matrix, regardless of project IDs", () => {
    const [definition] = nativeCases(report([]));
    if (!definition) {
      throw new Error("Missing native definition");
    }
    const http = {
      ...definition,
      id: "different-project-id",
      project: "features-http",
    };
    expect(() =>
      assertNativeCoverage([definition], [http], assertNativeClassification)
    ).not.toThrow();
    for (const matrix of [
      [],
      [http, http],
      [{ ...http, project: "features-chromium" }],
      [{ ...http, location: "uncollected" }],
    ]) {
      expect(() =>
        assertNativeCoverage([definition], matrix, assertNativeClassification)
      ).toThrow();
    }
    const lifecycle = {
      ...definition,
      tags: ["@native", "@http", "@foundation", "@lifecycle"],
      title: "renamed cleanup proof",
    };
    expect(() =>
      assertNativeCoverage(
        [lifecycle],
        [{ ...lifecycle, project: "lifecycle" }],
        assertNativeClassification
      )
    ).not.toThrow();
    expect(() =>
      assertNativeCoverage(
        [lifecycle],
        [{ ...lifecycle, project: "native" }],
        assertNativeClassification
      )
    ).toThrow();
    const browser = {
      ...definition,
      tags: ["@native", "@browser", "@mobile-critical", "@risk-auth"],
    };
    const engines = [
      "features-chromium",
      "features-iphone-webkit",
      "features-pixel-chromium",
    ].map((project) => ({ ...browser, project }));
    expect(() =>
      assertNativeCoverage([browser], engines, assertNativeClassification)
    ).not.toThrow();
    expect(() =>
      assertNativeCoverage(
        [browser],
        engines.slice(0, 2),
        assertNativeClassification
      )
    ).toThrow();
    expect(() =>
      assertNativeCoverage(
        [{ ...definition, expectedStatus: "skipped" }],
        [http],
        assertNativeClassification
      )
    ).toThrow();
  });

  it("validates native discovery identities, normalized tags and first-attempt execution, not wiring", () => {
    const discovery = nativeCases(report([]));
    expect(discovery[0]?.tags).toEqual(["@native", "@http", "@risk-csrf"]);
    expect(() =>
      assertNativeExecution(
        discovery,
        nativeCases(report([{ retry: 0, status: "passed" }]))
      )
    ).not.toThrow();
    for (const results of [
      [],
      [{ retry: 0, status: "skipped" }],
      [
        { retry: 0, status: "failed" },
        { retry: 1, status: "passed" },
      ],
      [{ retry: 1, status: "passed" }],
    ]) {
      expect(() =>
        assertNativeExecution(discovery, nativeCases(report(results)))
      ).toThrow();
    }
    expect(() => assertNativeExecution(discovery, [])).toThrow();
    expect(() =>
      assertNativeExecution(
        discovery,
        nativeCases(report([{ retry: 0, status: "passed" }], "failed"))
      )
    ).toThrow();
    expect(() =>
      nativeCases({ suites: [{ specs: [{ id: "missing-native-fields" }] }] })
    ).toThrow();
  });
  it("compares actual pinned Playwright discovery and execution, including first failures and skips", async ({
    signal,
  }) => {
    const root = fixture();
    const install = spawnSync(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline"],
      {
        cwd: root,
        encoding: "utf-8",
        env: fixtureGitEnvironment as NodeJS.ProcessEnv,
        timeout: 180_000,
      }
    );
    if (install.error) {
      throw install.error;
    }
    expect(install.status).toBe(0);
    const spec = path.join(root, "tests/e2e/new-family/new.spec.ts");
    mkdirSync(path.dirname(spec), { recursive: true });
    for (const name of [
      "playwright.discovery.config.ts",
      "playwright.features.config.ts",
    ]) {
      writeFileSync(
        path.join(root, name),
        readFileSync(path.join(repository, name))
      );
    }
    const config = path.join(root, "reporting.config.ts");
    const output = path.join(root, "native-results.json");
    writeFileSync(
      config,
      'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: ".", testMatch: "**/*.spec.ts", retries: 0, projects: [{ name: "native-http" }], reporter: [["json"]] });\n'
    );
    const native = (...args: string[]) => {
      // Node accepts an unset NODE_ENV; the app's global ProcessEnv augmentation does not.
      const result = spawnSync(
        "pnpm",
        ["exec", "playwright", "test", "--config", config, ...args],
        {
          cwd: root,
          encoding: "utf-8",
          env: {
            ...fixtureGitEnvironment,
            PLAYWRIGHT_JSON_OUTPUT_FILE: output,
          } as unknown as NodeJS.ProcessEnv,
          timeout: 60_000,
        }
      );
      if (result.error) {
        throw result.error;
      }
      return {
        cases: nativeCases(JSON.parse(readFileSync(output, "utf-8"))),
        status: result.status,
      };
    };
    writeFileSync(spec, testSource("expect(1).toBe(1);"));
    const collect = (configName: string) => {
      const result = spawnSync(
        "pnpm",
        [
          "exec",
          "playwright",
          "test",
          "--config",
          configName,
          "--list",
          "--reporter=json",
          "--pass-with-no-tests",
        ],
        {
          cwd: root,
          encoding: "utf-8",
          env: {
            ...fixtureGitEnvironment,
            PLAYWRIGHT_JSON_OUTPUT_FILE: output,
          } as unknown as NodeJS.ProcessEnv,
          timeout: 60_000,
        }
      );
      if (result.error) {
        throw result.error;
      }
      expect(result.status).toBe(0);
      return nativeCases(JSON.parse(readFileSync(output, "utf-8")));
    };
    const definitions = collect("playwright.discovery.config.ts");
    expect(definitions).toHaveLength(1);
    expect(() =>
      assertNativeCoverage(
        definitions,
        collect("playwright.features.config.ts"),
        assertNativeClassification
      )
    ).not.toThrow();
    for (const tags of [
      "@http",
      "@native @http",
      "@native @risk-auth",
      "@native @http @risk-unknown",
    ]) {
      writeFileSync(
        spec,
        `import {test} from "@playwright/test"; test("unclassified", {tag:${JSON.stringify(tags.split(" "))}}, () => {});`
      );
      expect(() =>
        assertNativeCoverage(
          collect("playwright.discovery.config.ts"),
          collect("playwright.features.config.ts"),
          assertNativeClassification
        )
      ).toThrow();
    }
    writeFileSync(spec, testSource("expect(1).toBe(1);"));
    const discovery = native("--list");
    expect(discovery.status).toBe(0);
    expect(discovery.cases[0]?.tags).toContain("@native");
    const pass = native();
    expect(pass.status).toBe(0);
    expect(() =>
      assertNativeExecution(discovery.cases, pass.cases)
    ).not.toThrow();
    writeFileSync(spec, testSource("expect(1).toBe(2);"));
    const failure = native();
    expect(failure.status).not.toBe(0);
    expect(() => assertNativeExecution(discovery.cases, failure.cases)).toThrow(
      /first attempt/iu
    );
    writeFileSync(spec, testSource("test.skip();"));
    const skip = native();
    expect(() => assertNativeExecution(discovery.cases, skip.cases)).toThrow();
    const marker = path.join(root, "collection-listener.json");
    writeFileSync(
      path.join(root, "playwright.discovery.config.ts"),
      `import { createServer } from "node:http";
import { renameSync, writeFileSync } from "node:fs";
const server = createServer((_request, response) => response.end("alive"));
server.listen(0, "127.0.0.1", () => {
  const marker = ${JSON.stringify(marker)};
  writeFileSync(marker + ".tmp", JSON.stringify({ pid: process.pid, port: server.address().port }));
  renameSync(marker + ".tmp", marker);
});
await new Promise(() => {});
export default {};
`
    );
    const controller = new AbortController();
    const pending = discoverNative(
      root,
      { ...fixtureGitEnvironment },
      root,
      selectTests(["playwright.features.config.ts"]),
      false,
      assertNativeClassification,
      AbortSignal.any([signal, controller.signal])
    );
    const settled = Promise.allSettled([pending]);
    onTestFinished(async () => {
      controller.abort();
      await settled;
      if (!existsSync(marker)) {
        return;
      }
      const owned = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
      };
      await expect
        .poll(
          () => {
            try {
              process.kill(owned.pid, 0);
              return true;
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "ESRCH"
              ) {
                return false;
              }
              throw error;
            }
          },
          { timeout: 5000 }
        )
        .toBe(false);
      await expect(fetch(`http://127.0.0.1:${owned.port}`)).rejects.toThrow();
    }, 20_000);
    await expect.poll(() => existsSync(marker), { timeout: 30_000 }).toBe(true);
    const listener = JSON.parse(readFileSync(marker, "utf-8")) as {
      pid: number;
      port: number;
    };
    expect(
      await fetch(`http://127.0.0.1:${listener.port}`).then((r) => r.text())
    ).toBe("alive");
    controller.abort();
    expect(await settled).toMatchObject([
      {
        reason: {
          cause: {
            message: "Required command interrupted: pnpm",
          },
          message: expect.stringContaining(
            "Required command interrupted: pnpm"
          ),
          name: "Error",
        },
        status: "rejected",
      },
    ]);
  }, 240_000);
  it.for([
    ["security.ts", "password change"],
    ["account-changes.ts", "own phone change"],
    ["decisions.ts", "application decision"],
    ["applicant-actions.ts", "applicant correction"],
    ["restrictions.ts", "restriction change"],
  ])(
    "resolves %s writer claims across native configs without independently maintained lane flags",
    { timeout: 120_000 },
    async ([source, recipe], { signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-native-selection-")
      );
      const env = {
        CI: "true",
        HOME: process.env.HOME,
        PATH: process.env.PATH,
      };
      const discovery = discoverNative(
        repository,
        env,
        evidence,
        selectTests([`src/features/account/${source}`]),
        false,
        assertNativeClassification,
        signal
      );
      onTestFinished(async () => {
        await Promise.allSettled([discovery]);
        rmSync(evidence, { force: true, recursive: true });
      }, 20_000);
      const lanes = await discovery;
      const causal = lanes.find(
        (lane) => lane.config === "playwright.causal.config.ts"
      );
      expect(causal).toBeDefined();
      expect(causal?.cases.map((item) => item.title)).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`${recipe}: session expired`),
          expect.stringContaining(`${recipe}: session fresh`),
          expect.stringContaining(`${recipe}: real ABORT`),
          expect.stringContaining(`${recipe}: real IGNORE`),
        ])
      );
      expect(
        lanes
          .flatMap((lane) => lane.cases)
          .some((item) => /iphone|pixel/u.test(item.project))
      ).toBe(false);
    }
  );
  it("resolves feature config changes across the complete native engine matrix", async ({
    signal,
  }) => {
    const evidence = mkdtempSync(path.join(tmpdir(), "efcc-native-selection-"));
    const env = { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH };
    const discovery = discoverNative(
      repository,
      env,
      evidence,
      selectTests(["playwright.features.config.ts"]),
      false,
      assertNativeClassification,
      signal
    );
    onTestFinished(async () => {
      await Promise.allSettled([discovery]);
      rmSync(evidence, { force: true, recursive: true });
    }, 20_000);
    const features = await discovery;
    expect(features.map((lane) => lane.config)).toEqual([
      "playwright.features.config.ts",
    ]);
    expect(
      new Set(
        features.flatMap((lane) => lane.cases).map((item) => item.project)
      )
    ).toEqual(
      new Set([
        "features-http",
        "features-chromium",
        "features-iphone-webkit",
        "features-pixel-chromium",
      ])
    );
  }, 120_000);
  it("rejects unsupported CLI options rather than silently broadening or dropping source scope", () => {
    expect(
      parseGateOptions(["affected", "--base", "feature-base", "--full"]).base
    ).toBe("feature-base");
    expect(parseGateOptions(["staged", "--format"]).format).toBe(true);
    expect(() => parseGateOptions(["staged", "--base", "main"])).toThrow();
    expect(() => parseGateOptions(["affected", "--base"])).toThrow();
    expect(() => parseGateOptions(["staged", "--unknown"])).toThrow();
  });
});
