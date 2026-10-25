import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  assertNativeSourceIdentity,
  assertPresentationDiscovery,
  discoverNative,
  nativeCases,
  parseGateOptions,
  parsePresentationTestList,
} from "../../../scripts/test-runner";
import {
  assertNativeClassification,
  selectTests,
} from "../../../scripts/test-selection";
import {
  repository,
  fixtureGitEnvironment,
  fixture,
  commandWithEnvironment,
} from "./fixtures";

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
  it(
    "selects the real R11 creation handover on every browser engine when the assisted form changes",
    { timeout: 120_000 },
    async ({ signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-assisted-selection-")
      );
      const discovery = discoverNative(
        repository,
        { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH },
        evidence,
        selectTests([
          "src/features/account/assisted-accounts/staff-accounts-form.tsx",
        ]),
        false,
        assertNativeClassification,
        signal
      );
      onTestFinished(async () => {
        await Promise.allSettled([discovery]);
        rmSync(evidence, { force: true, recursive: true });
      }, 20_000);
      const lanes = await discovery;
      const projects = lanes
        .flatMap((lane) => lane.cases)
        .filter(
          (item) =>
            item.title ===
            "R11 Staff creation, four restriction actions, deletion and retained audit"
        )
        .map((item) => item.project)
        .toSorted();
      expect(projects).toEqual([
        "features-chromium",
        "features-iphone-webkit",
        "features-pixel-chromium",
      ]);
    }
  );
  it(
    "discovers all three session draft flows on every browser engine from their shared source mapping",
    { timeout: 120_000 },
    async ({ signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-draft-selection-")
      );
      const discovery = discoverNative(
        repository,
        { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH },
        evidence,
        selectTests([
          "src/features/account/session-draft.ts",
          "src/features/account/session-draft-recovery.tsx",
          "tests/e2e/session-draft-recovery.spec.ts",
        ]),
        false,
        assertNativeClassification,
        signal
      );
      onTestFinished(async () => {
        await Promise.allSettled([discovery]);
        rmSync(evidence, { force: true, recursive: true });
      }, 20_000);
      const lanes = await discovery;
      for (const flow of ["creation", "identity", "applicant"]) {
        expect(
          lanes
            .flatMap((lane) => lane.cases)
            .filter(
              (item) =>
                item.title ===
                `${flow}: unavailable draft binding blocks transmission with no saved draft`
            )
            .map((item) => item.project)
            .toSorted()
        ).toEqual([
          "features-chromium",
          "features-iphone-webkit",
          "features-pixel-chromium",
        ]);
      }
    }
  );
  it.for([
    ["security.ts", "password change"],
    ["account-changes.ts", "own phone change"],
    ["decisions.ts", "application decision"],
    ["applicant-actions.ts", "applicant correction"],
    ["restrictions.ts", "restriction change"],
    ["timestamps.ts", "own phone change"],
  ])(
    "resolves %s source claims across native configs without independently maintained lane flags",
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
      if (source === "timestamps.ts") {
        expect(causal?.cases.map((item) => item.title)).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              "causal composition retains production guards"
            ),
            expect.stringContaining("RPC refuses double arm"),
          ])
        );
      }
      expect(
        lanes
          .flatMap((lane) => lane.cases)
          .some((item) => /iphone|pixel/u.test(item.project))
      ).toBe(false);
    }
  );
  it(
    "routes Global Staff D1 races through causal-http and excludes them from feature-http",
    { timeout: 120_000 },
    async ({ signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-staff-delegation-selection-")
      );
      const spec = "tests/e2e/roles/staff-delegation-causal.spec.ts";
      const selection = selectTests([spec]);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@account-clock-matrix",
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-deadline",
          "@risk-session",
        ])
      );
      const discovery = discoverNative(
        repository,
        { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH },
        evidence,
        selection,
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
      const expectedTitles = [
        "a held Role Assigner grant rechecks that its target remains eligible Staff",
        "a held Staff promotion rechecks that its target is still an eligible Member",
        "a held Staff promotion rechecks the ten-minute Admin password proof",
        "a held Staff promotion cannot commit against a changed Admin credential revision",
        "a held Staff promotion rechecks the Admin Session at the D1 write",
      ];
      expect(causal?.cases.map((item) => item.title)).toEqual(
        expect.arrayContaining(expectedTitles)
      );
      expect(
        lanes
          .filter((lane) => lane.config === "playwright.features.config.ts")
          .flatMap((lane) => lane.cases)
          .map((item) => item.title)
      ).not.toEqual(expect.arrayContaining(expectedTitles));
    }
  );
  it(
    "routes Admin self-stepdown D1 races through causal-http and excludes them from feature-http",
    { timeout: 120_000 },
    async ({ signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-admin-stepdown-selection-")
      );
      const spec = "tests/e2e/roles/admin-stepdown-causal.spec.ts";
      const selection = selectTests([spec]);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@account-clock-matrix",
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-session",
        ])
      );
      const discovery = discoverNative(
        repository,
        { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH },
        evidence,
        selection,
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
      const title =
        "competing confirmed Admin self-step-downs leave one effective Admin and roll back the loser";
      expect(
        causal?.cases
          .filter((item) => item.file === "roles/admin-stepdown-causal.spec.ts")
          .map((item) => item.title)
      ).toEqual([title]);
      expect(
        lanes
          .filter((lane) => lane.config === "playwright.features.config.ts")
          .flatMap((lane) => lane.cases)
          .filter((item) => item.file === "roles/admin-stepdown-causal.spec.ts")
      ).toEqual([]);
    }
  );
  it(
    "routes Admin self-stepdown required-write fault controls through feature-http",
    { timeout: 120_000 },
    async ({ signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-admin-stepdown-atomicity-selection-")
      );
      const spec = "tests/e2e/roles/admin-stepdown-atomicity.spec.ts";
      const selection = selectTests([spec]);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-history",
          "@risk-session",
        ])
      );
      const discovery = discoverNative(
        repository,
        { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH },
        evidence,
        selection,
        false,
        assertNativeClassification,
        signal
      );
      onTestFinished(async () => {
        await Promise.allSettled([discovery]);
        rmSync(evidence, { force: true, recursive: true });
      }, 20_000);
      const lanes = await discovery;
      const featureTitles = lanes
        .filter((lane) => lane.config === "playwright.features.config.ts")
        .flatMap((lane) => lane.cases)
        .map((item) => item.title);
      expect(featureTitles).toEqual(
        expect.arrayContaining([
          "self-step-down session-delete RAISE(ABORT) rolls back and retries the same operation",
          "self-step-down session-delete RAISE(IGNORE) rolls back and retries the same operation",
          "self-step-down history-insert RAISE(ABORT) rolls back and retries the same operation",
          "self-step-down history-insert RAISE(IGNORE) rolls back and retries the same operation",
        ])
      );
      expect(
        lanes
          .filter((lane) => lane.config === "playwright.causal.config.ts")
          .flatMap((lane) => lane.cases)
          .filter(
            (item) => item.file === "roles/admin-stepdown-atomicity.spec.ts"
          )
      ).toEqual([]);
    }
  );
  it(
    "discovers each self-stepdown browser flow across Native desktop and mobile engines",
    { timeout: 120_000 },
    async ({ signal }) => {
      const evidence = mkdtempSync(
        path.join(tmpdir(), "efcc-admin-stepdown-ui-selection-")
      );
      const spec = "tests/e2e/roles/admin-stepdown-ui.spec.ts";
      const selection = selectTests([spec]);
      expect(selection.mobile).toBe(true);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-session",
          "@risk-resilience",
          "@risk-privacy",
          "@risk-presentation",
        ])
      );
      const discovery = discoverNative(
        repository,
        { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH },
        evidence,
        selection,
        false,
        assertNativeClassification,
        signal
      );
      onTestFinished(async () => {
        await Promise.allSettled([discovery]);
        rmSync(evidence, { force: true, recursive: true });
      }, 20_000);
      const lanes = await discovery;
      const featureCases = lanes
        .filter((lane) => lane.config === "playwright.features.config.ts")
        .flatMap((lane) => lane.cases)
        .filter((item) => item.file === "roles/admin-stepdown-ui.spec.ts");
      const titles = [
        "an Admin confirms the default Member step-down, sees acknowledgement and signs in with the resulting role",
        "an Admin can explicitly choose Staff for a confirmed self-step-down",
        "a committed self-step-down with an aborted response remains UNKNOWN without result lookup or retry",
        "a held successful self-step-down acknowledgement cannot restore actor A data after the cookie switches to Admin B",
      ];
      const expectedProjects = [
        "features-chromium",
        "features-iphone-webkit",
        "features-pixel-chromium",
      ];
      for (const title of titles) {
        const cases = featureCases.filter((item) => item.title === title);
        expect(cases.map((item) => item.project).toSorted()).toEqual(
          expectedProjects.toSorted()
        );
      }
      expect(
        lanes
          .filter((lane) => lane.config === "playwright.causal.config.ts")
          .flatMap((lane) => lane.cases)
          .filter((item) => item.file === "roles/admin-stepdown-ui.spec.ts")
      ).toEqual([]);
    }
  );
  it("discovers all mobile projects for the shared selection across five UI mutations", async ({
    signal,
  }) => {
    const evidence = mkdtempSync(path.join(tmpdir(), "efcc-native-selection-"));
    const env = { CI: "true", HOME: process.env.HOME, PATH: process.env.PATH };
    const original = "src/features/account/security/security-form.tsx";
    const created = "src/features/account/security/review-card.tsx";
    const extracted = "src/features/account/security/review/review-card.tsx";
    const scenarios: { name: string; paths: string[] }[] = [
      { name: "creation", paths: [created] },
      { name: "rename", paths: [original, created] },
      { name: "deletion", paths: [original] },
      { name: "extraction", paths: [original, extracted] },
      { name: "later extracted-file-only edit", paths: [extracted] },
    ];
    const expected = selectTests([original]);
    const selections = scenarios.map(({ name, paths }) => ({
      name,
      paths,
      selection: selectTests(paths),
    }));
    for (const { name, selection } of selections) {
      expect(selection, `full selection output for ${name}`).toEqual(expected);
    }
    const sharedSelection = selections.at(-1)?.selection;
    if (!sharedSelection) {
      throw new Error("Missing later extracted-file-only selection");
    }
    expect(sharedSelection).toEqual(expected);

    // discoverNative consumes the selector output, not the mutation paths. Since
    // all five full outputs above are equal, one real discovery of this shared
    // output exercises the same native input for every listed mutation.
    const discovery = discoverNative(
      repository,
      env,
      evidence,
      sharedSelection,
      false,
      assertNativeClassification,
      signal
    );
    onTestFinished(async () => {
      await Promise.allSettled([discovery]);
      rmSync(evidence, { force: true, recursive: true });
    }, 20_000);

    const lanes = await discovery;
    const features = lanes.find(
      (lane) => lane.config === "playwright.features.config.ts"
    );
    expect(sharedSelection.mobile).toBe(true);
    expect(features).toBeDefined();
    expect(
      new Set(
        features?.cases
          .filter((test) => test.tags.includes("@mobile-critical"))
          .map((test) => test.project)
      )
    ).toEqual(
      new Set([
        "features-chromium",
        "features-iphone-webkit",
        "features-pixel-chromium",
      ])
    );
  }, 120_000);
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
  it("accepts an explicitly bounded presentation test-list command", () => {
    expect(
      parseGateOptions([
        "presentation",
        "--test-list",
        "/tmp/presentation-test-list.txt",
      ])
    ).toMatchObject({
      ci: false,
      format: false,
      full: false,
      mode: "presentation",
      presentationTestList: "/tmp/presentation-test-list.txt",
    });
    expect(() => parseGateOptions(["presentation"])).toThrow(/--test-list/u);
    expect(() =>
      parseGateOptions([
        "presentation",
        "--test-list",
        "/tmp/presentation-test-list.txt",
        "--full",
      ])
    ).toThrow();
    expect(() =>
      parseGateOptions(["presentation", "--test-list", "--full"])
    ).toThrow();
  });
  it("requires every report-derived presentation identity to resolve exactly once", () => {
    const identity =
      "[features-chromium] › presentation.spec.ts:3:3 › role workspace › grant action › notification remains exact";
    const entries = parsePresentationTestList(`${identity}\n`);
    expect(entries).toEqual([
      {
        file: "presentation.spec.ts",
        project: "features-chromium",
        titles: [
          "role workspace",
          "grant action",
          "notification remains exact",
        ],
      },
    ]);
    const discovery = nativeCases({
      errors: [],
      suites: [
        {
          column: 0,
          file: "presentation.spec.ts",
          line: 0,
          specs: [],
          suites: [
            {
              column: 1,
              file: "presentation.spec.ts",
              line: 1,
              specs: [],
              suites: [
                {
                  column: 1,
                  file: "presentation.spec.ts",
                  line: 2,
                  specs: [
                    {
                      column: 1,
                      file: "presentation.spec.ts",
                      id: "presentation-case",
                      line: 3,
                      tags: ["native", "browser"],
                      tests: [
                        {
                          expectedStatus: "passed",
                          projectName: "features-chromium",
                          results: [],
                        },
                      ],
                      title: "notification remains exact",
                    },
                  ],
                  title: "grant action",
                },
              ],
              title: "role workspace",
            },
          ],
          title: "presentation.spec.ts",
        },
      ],
    });
    expect(discovery[0]?.suiteTitles).toEqual([
      "role workspace",
      "grant action",
    ]);
    expect(() => assertPresentationDiscovery(entries, discovery)).not.toThrow();
    expect(() => assertPresentationDiscovery(entries, [])).toThrow();
    expect(() => assertPresentationDiscovery([], discovery)).toThrow();
    expect(() =>
      assertPresentationDiscovery(
        parsePresentationTestList(
          "[features-chromium] › missing.spec.ts › missing"
        ),
        discovery
      )
    ).toThrow();
    expect(() =>
      assertPresentationDiscovery(
        parsePresentationTestList(
          "[features-chromium] › presentation.spec.ts › role workspace"
        ),
        discovery
      )
    ).toThrow();
    expect(() => parsePresentationTestList("")).toThrow();
    expect(() =>
      parsePresentationTestList(`${identity}\n${identity}\n`)
    ).toThrow();
  });
  it(
    "runs only the exact presentation list with runner-owned source metadata",
    { timeout: 120_000 },
    () => {
      const root = fixture();
      const parent = path.dirname(root);
      const listPath = path.join(parent, "presentation-test-list.txt");
      const bin = path.join(parent, "bin");
      mkdirSync(bin);
      writeFileSync(
        listPath,
        [
          "[features-chromium] › presentation.spec.ts:3:3 › role workspace › reports the presentation annotation",
          "[features-iphone-webkit] › presentation.spec.ts:3:3 › role workspace › reports the presentation annotation",
          "[features-pixel-chromium] › presentation.spec.ts:3:3 › role workspace › reports the presentation annotation",
        ].join("\n")
      );
      mkdirSync(path.join(root, "tests/e2e"), { recursive: true });
      writeFileSync(
        path.join(root, "playwright.features.config.ts"),
        readFileSync(
          path.join(repository, "playwright.features.config.ts"),
          "utf-8"
        )
      );
      writeFileSync(
        path.join(root, "tests/e2e/presentation.spec.ts"),
        [
          'import { test } from "@playwright/test";',
          'test.describe("role workspace", () => {',
          '  test("reports the presentation annotation", { tag: ["@native", "@browser", "@mobile-critical", "@risk-presentation", "@presentation", "@emulation", "@privacy"] }, async ({}, testInfo) => {',
          '    testInfo.annotations.push({ type: "presentation" });',
          "  });",
          "});",
        ].join("\n")
      );
      const fakePnpm = path.join(bin, "pnpm");
      writeFileSync(
        fakePnpm,
        [
          "#!/usr/bin/env node",
          'import { spawnSync } from "node:child_process";',
          'import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";',
          'import path from "node:path";',
          `const modules = ${JSON.stringify(path.join(repository, "node_modules"))};`,
          `const playwrightCli = ${JSON.stringify(path.join(repository, "node_modules/@playwright/test/cli.js"))};`,
          "const args = process.argv.slice(2);",
          'if (args[0] === "--version") { console.log("10.33.2"); process.exit(0); }',
          'if (args[0] === "config") { console.log("false"); process.exit(0); }',
          'if (args[0] === "install") { const modulesPath = path.join(process.cwd(), "node_modules"); if (!existsSync(modulesPath)) symlinkSync(modules, modulesPath, "dir"); process.exit(0); }',
          'if (args[0] === "exec" && args[1] === "turbo") { if (args.includes("--dry=json")) console.log(JSON.stringify({ tasks: [] })); process.exit(0); }',
          'if (args[0] === "exec" && args[1] === "playwright") { const root = process.env.EFCC_EVIDENCE_ROOT; if (!root || !process.env.EFCC_TEST_SOURCE) throw new Error("Runner source metadata is missing"); const log = path.join(root, "tooling-pnpm-calls.json"); const calls = existsSync(log) ? JSON.parse(readFileSync(log, "utf-8")) : []; calls.push({ args, evidence: root, source: process.env.EFCC_TEST_SOURCE }); writeFileSync(log, JSON.stringify(calls), { mode: 0o600 }); const child = spawnSync(process.execPath, [playwrightCli, ...args.slice(2)], { cwd: process.cwd(), env: process.env, stdio: "inherit" }); if (child.error) throw child.error; process.exitCode = child.status ?? 1; process.exit(); }',
          'console.error("Unexpected pnpm command in presentation tooling fixture");',
          "process.exit(64);",
          "",
        ].join("\n")
      );
      chmodSync(fakePnpm, 0o755);

      const result = commandWithEnvironment(
        root,
        {
          ...fixtureGitEnvironment,
          EFCC_CAPTURE_SUCCESS: "0",
          EFCC_EVIDENCE_ROOT: path.join(parent, "caller-forged-evidence"),
          EFCC_TEST_SOURCE: "caller-forged-source",
          HOME: parent,
          PATH: `${bin}:${fixtureGitEnvironment.PATH}`,
        },
        ["presentation", "--test-list", listPath]
      );
      const disposition = result.output
        .split(/\r?\n/u)
        .find((line) => line.startsWith('{"disposedSource":'));
      if (!disposition) {
        throw new Error("Missing presentation evidence location");
      }
      const evidence = (JSON.parse(disposition) as { privateEvidence: string })
        .privateEvidence;
      expect(
        result.status,
        `${result.output}\n${readFileSync(path.join(evidence, "presentation.discovery.json"), "utf-8")}`
      ).toBe(0);
      expect(result.output).toContain(
        '"qualificationScope":"presentation-subset-only"'
      );
      expect(result.output).toContain('"fullQualification":false');
      const snapshot = result.output
        .split(/\r?\n/u)
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return {};
          }
        })
        .find((item) => item.mode === "presentation");
      const source = snapshot?.source;
      expect(typeof source).toBe("string");
      const executionReport = JSON.parse(
        readFileSync(path.join(evidence, "presentation-results.json"), "utf-8")
      ) as {
        config: { projects: { metadata?: { source?: string } }[] };
        suites: unknown[];
      };
      expect(executionReport.config.projects.length).toBeGreaterThan(0);
      expect(
        executionReport.config.projects.every(
          (project) => project.metadata?.source === source
        )
      ).toBe(true);
      expect(() =>
        assertNativeSourceIdentity(executionReport, "different-source")
      ).toThrow();
      expect(
        existsSync(
          path.join(evidence, "native-features/capture-off/report/index.html")
        )
      ).toBe(true);
      expect(JSON.stringify(executionReport.suites)).toContain(
        "role workspace"
      );
      expect(JSON.stringify(executionReport.suites)).toContain(
        '"type":"presentation"'
      );
      const receipt = result.output
        .split(/\r?\n/u)
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return {};
          }
        })
        .find((item) => item.qualificationScope === "presentation-subset-only");
      expect(receipt).toBeDefined();
      expect(receipt).toMatchObject({
        executed: 3,
        expected: 3,
        failed: 0,
        fullQualification: false,
        qualificationScope: "presentation-subset-only",
        retries: 0,
        selected: 3,
        skipped: 0,
        sourceTree: source,
        status: "passed",
      });
      const calls = JSON.parse(
        readFileSync(path.join(evidence, "tooling-pnpm-calls.json"), "utf-8")
      ) as { args: string[]; evidence: string; source: string }[];
      expect(calls).toHaveLength(2);
      expect(calls.every((call) => call.source === source)).toBe(true);
      expect(
        calls.every((call) => call.source !== "caller-forged-source")
      ).toBe(true);
      expect(calls.every((call) => call.evidence === evidence)).toBe(true);
      expect(
        calls.every(
          (call) =>
            call.evidence !== path.join(parent, "caller-forged-evidence")
        )
      ).toBe(true);
      expect(calls[0]?.args).toContain("--list");
      expect(calls[0]?.args).toContain("--test-list");
      expect(calls[0]?.args).toContain(
        path.join(evidence, "presentation-test-list.txt")
      );
      expect(calls[1]?.args).toContain("--test-list");
      expect(calls[1]?.args).toContain("--retries=0");
      expect(result.output).toContain('"expected":3');
      expect(result.output).toContain('"executed":3');
      expect(result.output).toContain('"retries":0');
      expect(result.output).toContain('"skipped":0');
    }
  );
});
