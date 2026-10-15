import { spawnSync } from "node:child_process";
import {
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
  it("compares actual pinned Playwright discovery and execution, including first failures and skips", () => {
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
  }, 240_000);
  it("resolves real writer claims across native configs without independently maintained lane flags", async () => {
    const evidence = mkdtempSync(path.join(tmpdir(), "efcc-native-selection-"));
    onTestFinished(() => rmSync(evidence, { force: true, recursive: true }));
    const env = { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH };
    for (const [source, recipe] of [
      ["security.ts", "password change"],
      ["account-changes.ts", "own phone change"],
      ["decisions.ts", "application decision"],
      ["applicant-actions.ts", "applicant correction"],
      ["restrictions.ts", "restriction change"],
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each actual source policy gets its own native discovery proof.
      const lanes = await discoverNative(
        repository,
        env,
        evidence,
        selectTests([`src/features/account/${source}`]),
        false,
        assertNativeClassification
      );
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
    const features = await discoverNative(
      repository,
      env,
      evidence,
      selectTests(["playwright.features.config.ts"]),
      false,
      assertNativeClassification
    );
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
