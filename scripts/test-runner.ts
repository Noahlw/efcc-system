import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

// Type-only: mutable selector policy is loaded only from the exported source at runtime.
import type { TestSelection } from "./test-selection";

type Environment = Record<string, string | undefined>;

export interface GateOptions {
  base: string;
  baseIdentity?: string;
  format: boolean;
  full: boolean;
  mode: "affected" | "staged" | "e2e" | "qualify";
}

export interface NativeCase {
  expectedStatus: string;
  id: string;
  location: string;
  project: string;
  results: { retry: number; status: string }[];
  tags: string[];
  title: string;
}

export const parseGateOptions = (args: readonly string[]): GateOptions => {
  const [mode, ...flags] = args;
  if (
    mode !== "affected" &&
    mode !== "staged" &&
    mode !== "e2e" &&
    mode !== "qualify"
  ) {
    throw new Error("Expected affected, staged, e2e or qualify");
  }
  let base = "origin/main";
  let full = mode === "e2e" || mode === "qualify";
  let format = false;
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] === "--full") {
      full = true;
    } else if (flags[index] === "--format" && mode === "staged") {
      format = true;
    } else if (flags[index] === "--base" && mode === "affected") {
      const next = flags[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing affected base");
      }
      base = next;
      index += 1;
    } else {
      throw new Error(`Unsupported gate option: ${flags[index]}`);
    }
  }
  return { base, format, full, mode };
};

const reportObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid native report object");
  }
  return Object.fromEntries(Object.entries(value));
};
const reportList = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid native report list");
  }
  return value;
};
const reportString = (value: unknown): string => {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid native report identity");
  }
  return value;
};

export const nativeCases = (report: unknown): NativeCase[] => {
  const cases: NativeCase[] = [];
  const walk = (suites: unknown[]) => {
    for (const entry of suites) {
      const suite = reportObject(entry);
      for (const item of reportList(suite.specs ?? [])) {
        const spec = reportObject(item);
        for (const testEntry of reportList(spec.tests)) {
          const test = reportObject(testEntry);
          const results = reportList(test.results ?? []).map((result) => {
            const attempt = reportObject(result);
            if (typeof attempt.retry !== "number") {
              throw new TypeError("Invalid native attempt number");
            }
            return {
              retry: attempt.retry,
              status: reportString(attempt.status),
            };
          });
          const tags = reportList(spec.tags ?? []).map((tag) => {
            const normalized = reportString(tag);
            // Pinned Playwright 1.63 JSONReporter strips the leading '@'.
            return normalized.startsWith("@") ? normalized : `@${normalized}`;
          });
          if (
            typeof spec.line !== "number" ||
            typeof spec.column !== "number"
          ) {
            throw new TypeError("Invalid native case location");
          }
          cases.push({
            expectedStatus: reportString(test.expectedStatus),
            id: reportString(spec.id),
            location: `${reportString(spec.file)}:${spec.line}:${spec.column}:${reportString(spec.title)}`,
            project: reportString(test.projectName),
            results,
            tags,
            title: reportString(spec.title),
          });
        }
      }
      walk(reportList(suite.suites ?? []));
    }
  };
  const document = reportObject(report);
  if (reportList(document.errors).length) {
    throw new Error("Native reporter contains global errors");
  }
  walk(reportList(document.suites));
  const keys = cases.map((test) => `${test.project}:${test.id}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Duplicate native case identity");
  }
  return cases;
};

export const assertNativeExecution = (
  expected: readonly NativeCase[],
  actual: readonly NativeCase[]
): void => {
  const expectedKeys = new Set(
    expected.map((test) => `${test.project}:${test.id}`)
  );
  const actualKeys = new Set(
    actual.map((test) => `${test.project}:${test.id}`)
  );
  if (
    !expectedKeys.size ||
    expectedKeys.size !== actualKeys.size ||
    [...expectedKeys].some((key) => !actualKeys.has(key))
  ) {
    throw new Error("Native executed scope differs from discovery");
  }
  for (const test of actual) {
    const [attempt] = test.results;
    if (
      test.expectedStatus !== "passed" ||
      test.results.length !== 1 ||
      !attempt ||
      attempt.retry !== 0 ||
      attempt.status !== "passed"
    ) {
      throw new Error(
        `Native required case did not pass first attempt: ${test.project}:${test.id}`
      );
    }
  }
};

const definitionKey = (test: NativeCase): string =>
  JSON.stringify([test.location, [...test.tags].toSorted()]);

/** Compare definitions to the full native matrix before selecting an affected subset. */
export const assertNativeCoverage = (
  definitions: readonly NativeCase[],
  matrix: readonly NativeCase[],
  classify: (tags: readonly string[]) => void
): void => {
  const keys = new Set(definitions.map(definitionKey));
  if (!keys.size || keys.size !== definitions.length) {
    throw new Error("Empty or duplicate native definitions");
  }
  for (const test of matrix) {
    if (!keys.has(definitionKey(test))) {
      throw new Error(
        `Runtime case has no collected definition: ${test.location}`
      );
    }
  }
  for (const definition of definitions) {
    classify(definition.tags);
    if (definition.expectedStatus !== "passed") {
      throw new Error(
        `Skipped/expected-failure definition: ${definition.location}`
      );
    }
    const projects = matrix
      .filter((test) => definitionKey(test) === definitionKey(definition))
      .map((test) => test.project)
      .toSorted();
    const tags = new Set(definition.tags);
    let expected: string[];
    if (tags.has("@foundation")) {
      expected = [tags.has("@lifecycle") ? "lifecycle" : "native"];
    } else if (tags.has("@account-clock-matrix")) {
      expected = ["causal-http"];
    } else if (tags.has("@dev")) {
      expected = ["dev-chromium"];
    } else if (tags.has("@http")) {
      expected = ["features-http"];
    } else {
      expected = ["features-chromium"];
      if (tags.has("@mobile-critical")) {
        expected.push("features-iphone-webkit", "features-pixel-chromium");
      }
    }
    if (JSON.stringify(projects) !== JSON.stringify(expected.toSorted())) {
      throw new Error(
        `Incomplete or incorrect native matrix: ${definition.location}`
      );
    }
  }
};

const interruption = new AbortController();
let commandSignal = interruption.signal;

const collectOutput = async (
  stream: Readable | null,
  stop: () => void
): Promise<string> => {
  if (!stream) {
    return "";
  }
  stream.setEncoding("utf-8");
  let bytes = 0;
  let output = "";
  for await (const chunk of stream) {
    if (typeof chunk !== "string") {
      throw new TypeError("Invalid native command output encoding");
    }
    bytes += Buffer.byteLength(chunk);
    if (bytes > 128 * 1024 * 1024) {
      stop();
      throw new Error("Native command output exceeded limit");
    }
    output += chunk;
  }
  return output;
};

const awaitProcessGroupExit = async (pid: number): Promise<void> => {
  // macOS can report EPERM while orphaned group members are exiting.
  // Only a native ESRCH probe proves cleanup; permission alone never does.
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (groupError) {
      if (
        !groupError ||
        typeof groupError !== "object" ||
        !("code" in groupError)
      ) {
        throw groupError;
      }
      if (groupError.code === "ESRCH") {
        break;
      }
      if (groupError.code !== "EPERM") {
        throw groupError;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error("Owned command process group did not exit");
    }
    // eslint-disable-next-line no-await-in-loop -- observe actual process-group release before evidence cleanup.
    await delay(25);
  }
};

const run = async (
  command: string,
  args: string[],
  cwd: string,
  env: Environment,
  capture = false,
  timeout = 10_800_000,
  detached = true,
  signal = commandSignal
): Promise<string> => {
  signal.throwIfAborted();
  // App types require NODE_ENV globally; Node's native CLI environment may legitimately omit it.
  const child = spawn(command, args, {
    cwd,
    detached,
    env: env as NodeJS.ProcessEnv,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const completion = once(child, "close");
  let failure: Error | undefined;
  let forceTimer: NodeJS.Timeout | undefined;
  const signalCommand = (terminationSignal: NodeJS.Signals = "SIGINT") => {
    // Descendants can retain this group after the CLI leader exits.
    if (!child.pid) {
      return;
    }
    try {
      if (detached) {
        process.kill(-child.pid, terminationSignal);
      } else {
        child.kill(terminationSignal);
      }
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ESRCH"
        )
      ) {
        failure = new Error("Native command interruption failed", {
          cause: error,
        });
      }
    }
  };
  const stop = () => {
    failure = new Error(`Required command interrupted: ${command}`);
    signalCommand();
    forceTimer = setTimeout(() => signalCommand("SIGKILL"), 10_000);
  };
  const timer = setTimeout(() => {
    failure = new Error(`Required command timed out: ${command}`);
    signalCommand("SIGKILL");
  }, timeout);
  signal.addEventListener("abort", stop, { once: true });
  // Captured Git/version stderr may contain config secrets; never publish it.
  child.stderr?.resume();
  try {
    const [state, output] = await Promise.all([
      completion,
      collectOutput(child.stdout, () => signalCommand("SIGKILL")),
    ]);
    const [code] = state;
    if (failure || code !== 0) {
      throw failure ?? new Error(`Native command exited with status ${code}`);
    }
    if (detached && child.pid) {
      await awaitProcessGroupExit(child.pid);
    }
    return output;
  } catch (error) {
    const operationFailure = failure;
    signalCommand("SIGKILL");
    try {
      if (child.pid) {
        await Promise.allSettled([completion]);
        if (detached) {
          await awaitProcessGroupExit(child.pid);
        }
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Required command and cleanup failed: ${command} ${args.join(" ")}`,
        { cause: cleanupError }
      );
    }
    throw new Error(
      `Required command failed: ${command} ${args.join(" ")}${operationFailure ? ` (${operationFailure.message})` : ""}`,
      { cause: error }
    );
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    signal.removeEventListener("abort", stop);
  }
};

const cleanEnvironment = (): Environment => {
  const env: Environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /^(?:PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TZ|NODE_ENV|TERM|COLORTERM|CI|USER|LOGNAME|SHELL)$/u.test(
        key
      )
    ) {
      env[key] = value;
    }
  }
  if (process.env.EFCC_CAPTURE_SUCCESS === "1") {
    env.EFCC_CAPTURE_SUCCESS = "1";
  }
  return env;
};

const gitEnvironment = async (root: string): Promise<Environment> => {
  const env = cleanEnvironment();
  const namesOutput = await run(
    "git",
    ["rev-parse", "--local-env-vars"],
    root,
    env,
    true
  );
  for (const name of namesOutput.trim().split(/\r?\n/u)) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name)) {
      env[name] = value;
    }
  }
  if (env.GIT_INDEX_FILE) {
    env.GIT_INDEX_FILE = path.resolve(root, env.GIT_INDEX_FILE);
  }
  return env;
};

const changedPaths = async (
  root: string,
  options: GateOptions,
  env: Environment,
  identity: string
): Promise<string[]> => {
  if (options.mode === "staged") {
    const staged = await run(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", "HEAD", identity],
      root,
      env,
      true
    );
    return staged.split("\0").filter(Boolean);
  }
  if (options.mode !== "affected") {
    return [];
  }
  const baseOutput = await run(
    "git",
    ["merge-base", options.base, "HEAD"],
    root,
    env,
    true
  );
  const base = baseOutput.trim();
  options.baseIdentity = base;
  const working = await run(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", base, identity],
    root,
    env,
    true
  );
  const staged = await run(
    "git",
    ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"],
    root,
    env,
    true
  );
  return [
    ...new Set([...working.split("\0"), ...staged.split("\0")].filter(Boolean)),
  ];
};

const assertSelection = (selection: TestSelection, full: boolean): void => {
  if (full && (!selection.mobile || !selection.tags.includes("@native"))) {
    throw new Error("Incomplete full native qualification selection");
  }
  if (!selection.tags.length && !selection.configs.length && selection.mobile) {
    throw new Error("Inconsistent fast-only native selection");
  }
};

const bootstrap = async (source: string, env: Environment): Promise<string> => {
  const manifest = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf-8")
  );
  const userConfig = path.join(path.dirname(source), "empty-user.npmrc");
  const globalConfig = path.join(path.dirname(source), "empty-global.npmrc");
  writeFileSync(userConfig, "", { mode: 0o600 });
  writeFileSync(globalConfig, "", { mode: 0o600 });
  env.npm_config_userconfig = userConfig;
  env.npm_config_globalconfig = globalConfig;
  const version = await run("pnpm", ["--version"], source, env, true);
  if (
    process.versions.node !== manifest.engines.node ||
    version.trim() !== manifest.engines.pnpm
  ) {
    throw new Error("Required indexed Node/pnpm toolchain is unavailable");
  }
  for (const key of ["ignore-scripts", "offline"]) {
    // eslint-disable-next-line no-await-in-loop -- prerequisite failures stop the bootstrap immediately.
    const output = await run("pnpm", ["config", "get", key], source, env, true);
    if (!["", "undefined", "null", "false"].includes(output.trim())) {
      throw new Error(
        `Indexed pnpm ${key} policy is incompatible with real store-first locked bootstrap`
      );
    }
  }
  console.log(
    "Native locked bootstrap: pnpm install --frozen-lockfile --prefer-offline (indexed package/scripts/lock/.npmrc; install scripts enabled)"
  );
  await run(
    "pnpm",
    ["install", "--frozen-lockfile", "--prefer-offline"],
    source,
    env,
    false,
    900_000
  );
  return version.trim();
};

const quotedArgument = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const formatIndex = async (
  source: string,
  root: string,
  env: Environment,
  gitContext: Environment
): Promise<void> => {
  const policy = JSON.parse(
    readFileSync(path.join(source, ".lintstagedrc.json"), "utf-8")
  );
  const config: Record<string, string[]> = {};
  for (const [glob, tasks] of Object.entries(policy)) {
    const commands = Array.isArray(tasks) ? tasks : [tasks];
    if (
      commands.some((task) => task !== "node scripts/test-runner.ts format")
    ) {
      throw new Error(
        "Unsupported indexed formatter policy; use the authoritative native format task"
      );
    }
    config[glob] = commands.map(
      () =>
        `${quotedArgument(process.execPath)} ${quotedArgument(path.join(source, "scripts/test-runner.ts"))} format --inherited-process-group`
    );
  }
  const configPath = path.join(path.dirname(source), "native-lint-staged.json");
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  // Native lint-staged alone owns partial hunks, backup, staging and revert.
  await run(
    "pnpm",
    [
      "exec",
      "lint-staged",
      "--cwd",
      root,
      "--config",
      configPath,
      "--concurrent=false",
    ],
    source,
    { ...env, ...gitContext }
  );
};

const assertDiscovery = (
  discovered: NativeCase[],
  selection: TestSelection,
  full: boolean,
  classify: (tags: readonly string[]) => void
): void => {
  if (!discovered.length) {
    throw new Error("Empty required native discovery");
  }
  for (const test of discovered) {
    classify(test.tags);
    if (
      !full &&
      !selection.configs.length &&
      !test.tags.some((tag) => selection.tags.includes(tag))
    ) {
      throw new Error(
        `Native case exceeds required selected tags: ${test.project}:${test.id}`
      );
    }
    if (test.expectedStatus !== "passed") {
      throw new Error(
        `Skipped/expected-failure required discovery: ${test.project}:${test.id}`
      );
    }
  }
  for (const tag of selection.tags) {
    if (!discovered.some((test) => test.tags.includes(tag))) {
      throw new Error(`Required native tag has no cases: ${tag}`);
    }
  }
  const http = discovered
    .filter((test) => test.tags.includes("@http"))
    .map((test) => test.location);
  if (new Set(http).size !== http.length) {
    throw new Error("HTTP cases duplicated across native projects");
  }
  const critical = discovered.filter(
    (test) =>
      test.tags.includes("@browser") && test.tags.includes("@mobile-critical")
  );
  if (
    !selection.mobile &&
    critical.some((test) => /iphone|pixel/u.test(test.project))
  ) {
    throw new Error("Native mobile execution exceeds selected scope");
  }
  if (selection.mobile) {
    if (!critical.length) {
      throw new Error("Missing required mobile-critical discovery");
    }
    for (const location of new Set(critical.map((test) => test.location))) {
      const projects = new Set(
        critical
          .filter((test) => test.location === location)
          .map((test) => test.project)
      );
      if (
        ![
          "features-chromium",
          "features-iphone-webkit",
          "features-pixel-chromium",
        ].every((project) => projects.has(project))
      ) {
        throw new Error(`Incomplete critical engine discovery: ${location}`);
      }
    }
  }
};

export const discoverNative = async (
  source: string,
  env: Environment,
  evidence: string,
  selection: TestSelection,
  full: boolean,
  classify: (tags: readonly string[]) => void,
  signal = commandSignal
): Promise<
  { cases: NativeCase[]; config: string; report: string; args: string[] }[]
> => {
  const lanes = [
    "playwright.native.config.ts",
    "playwright.features.config.ts",
    "playwright.causal.config.ts",
    "playwright.dev.config.ts",
  ];
  const { selectedGrep } = await import(
    pathToFileURL(path.join(source, "scripts/test-selection.ts")).href
  );
  const list = async (config: string, args: string[], name: string) => {
    const output = path.join(evidence, `${name}.discovery.json`);
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = output;
    await run(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config",
        config,
        ...args,
        "--list",
        "--reporter=json",
        "--pass-with-no-tests",
      ],
      source,
      env,
      false,
      undefined,
      true,
      AbortSignal.any([commandSignal, signal])
    );
    return nativeCases(JSON.parse(readFileSync(output, "utf-8")));
  };
  const definitions = await list(
    "playwright.discovery.config.ts",
    [],
    "definitions"
  );
  const complete = new Map<string, NativeCase[]>();
  for (const config of lanes) {
    // Native list mode does not start runtime fixtures or webServer.
    // eslint-disable-next-line no-await-in-loop -- each collector owns the reporter environment.
    complete.set(config, await list(config, [], `${config}.full`));
  }
  assertNativeCoverage(definitions, [...complete.values()].flat(), classify);
  const discovered: NativeCase[] = [];
  const required: {
    cases: NativeCase[];
    config: string;
    report: string;
    args: string[];
  }[] = [];
  for (const config of lanes) {
    const configScope = selection.configs.includes(config);
    if (!full && !configScope && !selection.tags.length) {
      continue;
    }
    const args = [
      "--config",
      config,
      ...(!full && !configScope
        ? ["--grep", selectedGrep(selection.tags)]
        : []),
      ...(config === "playwright.features.config.ts" && !selection.mobile
        ? ["--project", "features-http", "features-chromium"]
        : []),
    ];
    // Reuse full discovery only within this invocation; tests always execute anew.
    const cases =
      args.length === 2
        ? (complete.get(config) ?? [])
        : // eslint-disable-next-line no-await-in-loop -- one native reporter environment per lane.
          await list(config, args.slice(2), config);
    if (!cases.length && (full || configScope)) {
      throw new Error(`Empty required native lane: ${config}`);
    }
    discovered.push(...cases);
    if (cases.length) {
      required.push({
        args,
        cases,
        config,
        report: path.join(evidence, `${config}.results.json`),
      });
    }
  }
  assertDiscovery(discovered, selection, full, classify);
  console.log(
    JSON.stringify({
      nativeDiscovery: discovered.map(({ id, project, tags }) => ({
        id,
        project,
        tags,
      })),
    })
  );
  return required;
};

const runRuntime = async (
  source: string,
  env: Environment,
  evidence: string,
  selection: TestSelection,
  full: boolean,
  classify: (tags: readonly string[]) => void
): Promise<void> => {
  const required = await discoverNative(
    source,
    env,
    evidence,
    selection,
    full,
    classify
  );
  const executed: NativeCase[] = [];
  for (const lane of required) {
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = lane.report;
    // eslint-disable-next-line no-await-in-loop -- preserve first failure and exclusive runtime fixture ownership.
    await run(
      "pnpm",
      ["exec", "playwright", "test", ...lane.args, "--retries=0"],
      source,
      env
    );
    const actual = nativeCases(JSON.parse(readFileSync(lane.report, "utf-8")));
    assertNativeExecution(lane.cases, actual);
    executed.push(...actual);
  }
  console.log(
    JSON.stringify({
      executed: executed.length,
      expected: required.reduce((count, lane) => count + lane.cases.length, 0),
      failed: 0,
      nativeExecution: executed.map(({ id, project }) => ({ id, project })),
      retries: 0,
      skipped: 0,
    })
  );
};

const validateSourceTree = async (
  source: string,
  root: string,
  identity: string,
  gitContext: Environment
) => {
  const snapshot = await import(
    pathToFileURL(path.join(source, "scripts/test-snapshot.ts")).href
  );
  const tree = await run(
    "git",
    ["ls-tree", "-r", "-z", identity],
    root,
    gitContext,
    true
  );
  for (const entry of tree.split("\0").filter(Boolean)) {
    const match = /^(?<mode>\d+) blob [a-f\d]+\t(?<name>[\s\S]+)$/u.exec(entry);
    const mode = match?.groups?.mode;
    const name = match?.groups?.name;
    if (!mode || !name) {
      throw new Error("Unsupported source tree entry");
    }
    snapshot.assertSourcePrivacy(
      name,
      readFileSync(path.join(source, name)),
      mode
    );
  }
  return snapshot;
};

const buildNative = async (
  source: string,
  root: string,
  env: Environment,
  gitContext: Environment
): Promise<void> => {
  const common = await run(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    root,
    gitContext,
    true
  );
  const pnpmOutput = await run("pnpm", ["--version"], source, env, true);
  const pnpm = pnpmOutput.trim();
  const manifest = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf-8")
  );
  if (
    process.versions.node !== manifest.engines.node ||
    pnpm !== manifest.engines.pnpm
  ) {
    throw new Error("Required native build Node/pnpm toolchain is unavailable");
  }
  const cache = path.join(common.trim(), "efcc-native-build-cache");
  let cacheMode = "--cache=local:rw";
  try {
    mkdirSync(cache, { mode: 0o700, recursive: true });
    // eslint-disable-next-line no-bitwise -- fs.access accepts a native permission bitmask.
    accessSync(cache, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (error) {
    console.error(
      "Native build cache unavailable; executing without cache",
      error
    );
    cacheMode = "--cache=";
  }
  env.EFCC_BUILD_TOOLCHAIN = JSON.stringify({
    arch: process.arch,
    node: process.versions,
    platform: process.platform,
    pnpm,
  });
  env.TURBO_TELEMETRY_DISABLED = "1";
  env.WRANGLER_SEND_METRICS = "false";
  const args = [
    "exec",
    "turbo",
    "run",
    "build:testing",
    "--env-mode=strict",
    cacheMode,
    ...(cacheMode === "--cache=" ? [] : [`--cache-dir=${cache}`]),
  ];
  const plan = reportObject(
    JSON.parse(await run("pnpm", [...args, "--dry=json"], source, env, true))
  );
  // Explicit Turbo inputs can include ignored files that Git's source listing omits.
  const { assertSourcePrivacy } = await import(
    pathToFileURL(path.join(source, "scripts/test-snapshot.ts")).href
  );
  const empty = Buffer.alloc(0);
  for (const task of reportList(plan.tasks)) {
    for (const name of Object.keys(reportObject(reportObject(task).inputs))) {
      assertSourcePrivacy(name, empty);
      const input = path.join(source, name);
      if (!lstatSync(input).isFile()) {
        throw new Error(`Unsafe source path: ${name}`);
      }
      assertSourcePrivacy(name, readFileSync(input));
    }
  }
  // Turbo's restore manifest checks metadata, not content. Always restore owned immutable outputs.
  rmSync(path.join(source, "dist"), { force: true, recursive: true });
  try {
    await run("pnpm", [...args, "--summarize"], source, env);
  } finally {
    const summaries = path.join(source, ".turbo/runs");
    if (env.EFCC_EVIDENCE_ROOT && existsSync(summaries)) {
      cpSync(summaries, path.join(env.EFCC_EVIDENCE_ROOT, "native-build"), {
        recursive: true,
      });
    }
  }
};

export const executeSnapshot = async (
  source: string,
  root: string,
  identity: string,
  paths: string[],
  options: GateOptions,
  evidence: string,
  env: Environment,
  gitContext: Environment,
  signal = interruption.signal
): Promise<void> => {
  commandSignal = signal;
  // Runtime-selected source paths cannot use static imports from the working checkout.
  const snapshot = await validateSourceTree(source, root, identity, gitContext);
  const selectionPath = path.join(source, "scripts/test-selection.ts");
  if (!existsSync(selectionPath)) {
    throw new Error(
      "N16 integration dependency missing: authoritative scripts/test-selection.ts"
    );
  }
  const { selectTests, assertNativeClassification } = await import(
    pathToFileURL(selectionPath).href
  );
  if (
    typeof selectTests !== "function" ||
    typeof assertNativeClassification !== "function"
  ) {
    throw new TypeError(
      "N16 integration dependency missing: authoritative selector/classifier exports"
    );
  }
  const selection: TestSelection = selectTests(paths, options.full);
  assertSelection(selection, options.full);
  const pnpm = await bootstrap(source, env);
  env.EFCC_TEST_SOURCE = identity;
  env.EFCC_EVIDENCE_ROOT = evidence;
  console.log(
    JSON.stringify({
      base:
        options.mode === "affected"
          ? { identity: options.baseIdentity, ref: options.base }
          : null,
      evidence,
      mode: options.mode,
      node: process.versions.node,
      paths,
      pnpm,
      selection,
      source: identity,
    })
  );
  if (options.mode === "staged") {
    snapshot.assertIndexUnchanged(root, identity, gitContext);
  }
  if (options.format) {
    await formatIndex(source, root, env, gitContext);
    return;
  }
  for (const script of ["check", "typecheck", "test"]) {
    // eslint-disable-next-line no-await-in-loop -- check, types, then tests are ordered fail-fast prerequisites.
    await run("pnpm", ["run", script], source, env);
    if (options.mode === "staged") {
      snapshot.assertIndexUnchanged(root, identity, gitContext);
    }
  }
  if (
    options.mode === "qualify" ||
    (options.mode === "staged" && options.full)
  ) {
    await run("pnpm", ["run", "build"], source, env);
  }
  if (selection.tags.length || selection.configs.length) {
    await buildNative(source, root, env, gitContext);
    await runRuntime(
      source,
      env,
      evidence,
      selection,
      options.full,
      assertNativeClassification
    );
  }
  if (options.mode === "staged") {
    snapshot.assertIndexUnchanged(root, identity, gitContext);
  }
};

const interrupt = () => {
  interruption.abort();
  process.exitCode = 130;
};

const launch = async (args: string[]): Promise<void> => {
  if (args[0] === "format") {
    const inheritedProcessGroup = args[1] === "--inherited-process-group";
    const source = path.resolve(import.meta.dirname, "..");
    const env = cleanEnvironment();
    for (const key of ["npm_config_userconfig", "npm_config_globalconfig"]) {
      if (process.env[key]) {
        env[key] = process.env[key];
      }
    }
    const formatFiles = args.slice(inheritedProcessGroup ? 2 : 1);
    const detached = !inheritedProcessGroup;
    await run(
      "pnpm",
      [
        "exec",
        "oxlint",
        "--fix",
        "--no-error-on-unmatched-pattern",
        "--config",
        path.join(source, "oxlint.config.ts"),
        "--tsconfig",
        path.join(source, "tsconfig.json"),
        ...formatFiles,
      ],
      source,
      env,
      false,
      undefined,
      detached
    );
    await run(
      "pnpm",
      [
        "exec",
        "oxfmt",
        "--write",
        "--no-error-on-unmatched-pattern",
        "--config",
        path.join(source, "oxfmt.config.ts"),
        "--disable-nested-config",
        ...formatFiles,
      ],
      source,
      env,
      false,
      undefined,
      detached
    );
    return;
  }
  if (args[0] === "build-cached" && args.length === 1) {
    const root = process.cwd();
    const gitContext = await gitEnvironment(root);
    // Resolve public source policy from the actual CLI workspace, not a different launching checkout.
    const { assertNativeSource } = await import(
      pathToFileURL(path.join(root, "tests/support/native-source.ts")).href
    );
    const { assertSourcePrivacy } = await import(
      pathToFileURL(path.join(root, "scripts/test-snapshot.ts")).href
    );
    assertNativeSource(root);
    const names = await run(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      root,
      gitContext,
      true
    );
    const empty = Buffer.alloc(0);
    for (const name of new Set(names.split("\0").filter(Boolean))) {
      const file = path.join(root, name);
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (!stat) {
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Unsafe source path: ${name}`);
      }
      assertSourcePrivacy(name, empty);
      assertSourcePrivacy(name, readFileSync(file));
    }
    const env = cleanEnvironment();
    const owned = mkdtempSync(path.join(tmpdir(), "efcc-build-config-"));
    chmodSync(owned, 0o700);
    try {
      for (const name of ["userconfig", "globalconfig"]) {
        const file = path.join(owned, `${name}.npmrc`);
        writeFileSync(file, "", { mode: 0o600 });
        env[`npm_config_${name}`] = file;
      }
      await buildNative(root, root, env, gitContext);
    } finally {
      rmSync(owned, { force: true, recursive: true });
    }
    return;
  }
  const options = parseGateOptions(args);
  const root = process.cwd();
  const gitContext = await gitEnvironment(root);
  const env = { ...gitContext };
  const owned = mkdtempSync(path.join(tmpdir(), "efcc-gate-source-"));
  const evidence = mkdtempSync(path.join(tmpdir(), "efcc-gate-evidence-"));
  chmodSync(owned, 0o700);
  chmodSync(evidence, 0o700);
  const source = path.join(owned, "source");
  try {
    if (options.mode !== "staged") {
      env.GIT_INDEX_FILE = path.join(owned, "index");
      await run("git", ["read-tree", "HEAD"], root, env, true);
      await run("git", ["add", "-A", "--", "."], root, env, true);
    }
    const tree = await run("git", ["write-tree"], root, env, true);
    const identity = tree.trim();
    const paths = await changedPaths(root, options, gitContext, identity);
    // Pin export to the immutable tree, not a concurrently mutable commit index.
    env.GIT_INDEX_FILE = path.join(owned, "index");
    await run("git", ["read-tree", identity], root, env, true);
    const entries = await run(
      "git",
      ["ls-files", "--stage", "-z"],
      root,
      env,
      true
    );
    if (
      entries
        .split("\0")
        .filter(Boolean)
        .some((entry) => !/^(?:100644|100755) [a-f\d]+ 0\t/u.test(entry))
    ) {
      throw new Error("Unsupported or unmerged source entry");
    }
    mkdirSync(source);
    // Export before importing ANY mutable source, selector or privacy policy.
    await run(
      "git",
      ["checkout-index", "--all", `--prefix=${source}/`],
      root,
      env,
      true
    );
    const authoritative = await import(
      pathToFileURL(path.join(source, "scripts/test-runner.ts")).href
    );
    await authoritative.executeSnapshot(
      source,
      root,
      identity,
      paths,
      options,
      evidence,
      cleanEnvironment(),
      gitContext,
      interruption.signal
    );
    if (options.format) {
      await launch(["staged", ...(options.full ? ["--full"] : [])]);
    } else if (options.mode === "staged") {
      const current = await run("git", ["write-tree"], root, gitContext, true);
      if (current.trim() !== identity) {
        throw new Error(
          "Git index drifted during qualification; rerun the staged gate"
        );
      }
    }
  } finally {
    rmSync(owned, { force: true, recursive: true });
    console.log(
      JSON.stringify({ disposedSource: owned, privateEvidence: evidence })
    );
  }
};

if (import.meta.main) {
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await launch(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(
      error instanceof Error ? error.message : "Native gate failed"
    );
    process.exitCode ||= 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
