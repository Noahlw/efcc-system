import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  accessSync,
  chmodSync,
  constants,
  cpSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
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
  candidate?: CiEventIdentity & { tree: string };
  ci: boolean;
  format: boolean;
  full: boolean;
  mode: "affected" | "staged" | "e2e" | "qualify" | "presentation";
  presentationTestList?: string;
}

type GateMode = GateOptions["mode"];

export interface CiEventIdentity {
  base: string;
  full: boolean;
  head: string;
  tested: string;
}

interface VerificationIdentity {
  base: string;
  head: string;
  tested: string | null;
  tree: string;
}

let currentStage = "candidate setup";

interface SafeCommandFailure {
  elapsedMs: number;
  exitCode: number | null;
  leaderAtDeadline: "exited" | "not-observed" | "running";
  outcome: "nonzero-exit" | "process-group-cleanup" | "timeout";
  processGroup: "confirmed-absent" | "not-checked" | "not-confirmed";
  signal: NodeJS.Signals | null;
  timeoutMs: number;
}

const safeCommandFailureKey = Symbol.for("efcc.safe-command-failure");
const attachSafeCommandFailure = <T extends Error>(
  error: T,
  failure: SafeCommandFailure
): T => {
  Object.defineProperty(error, safeCommandFailureKey, { value: failure });
  return error;
};
const readSafeCommandFailure = (
  error: unknown
): SafeCommandFailure | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const value = (error as unknown as Record<symbol, unknown>)[
    safeCommandFailureKey
  ];
  return value && typeof value === "object"
    ? (value as SafeCommandFailure)
    : undefined;
};

export interface NativeCase {
  expectedStatus: string;
  file: string;
  id: string;
  location: string;
  project: string;
  results: { retry: number; status: string }[];
  suiteTitles: string[];
  tags: string[];
  title: string;
}

export interface PresentationTestListEntry {
  file: string;
  project: string;
  titles: string[];
}

const presentationIdentity = (
  project: string,
  file: string,
  titles: readonly string[]
): string => JSON.stringify([project, file, ...titles]);

const isPresentationTestFile = (file: string): boolean =>
  Boolean(file) &&
  !path.posix.isAbsolute(file) &&
  file.endsWith(".spec.ts") &&
  !file.includes(":") &&
  path.posix.normalize(file) === file &&
  !file.split("/").some((part) => part === ".." || part === ".");

const parsePresentationTestListEntry = (
  line: string
): PresentationTestListEntry => {
  const delimiter = line.includes("›") ? "›" : ">";
  const tokens = line.split(delimiter).map((token) => token.trim());
  const project = /^\[(?<project>[^\]\r\n]+)\]$/u.exec(tokens.shift() ?? "")
    ?.groups?.project;
  const file = (tokens.shift() ?? "")
    .replace(/:\d+(?::\d+)?$/u, "")
    .replaceAll("\\", "/");
  const titles = tokens;
  if (!project?.startsWith("features-")) {
    throw new Error("Malformed presentation project identity");
  }
  if (!isPresentationTestFile(file)) {
    throw new Error("Malformed presentation test-file identity");
  }
  if (!titles.length || titles.some((title) => !title)) {
    throw new Error("Malformed presentation title identity");
  }
  return { file, project, titles };
};

export const parsePresentationTestList = (
  content: string
): PresentationTestListEntry[] => {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!lines.length) {
    throw new Error("Empty presentation test list");
  }
  const entries = lines.map(parsePresentationTestListEntry);
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = presentationIdentity(
      entry.project,
      entry.file,
      entry.titles
    );
    if (identities.has(identity)) {
      throw new Error("Duplicate presentation test-list identity");
    }
    identities.add(identity);
  }
  return entries;
};

const assertExactPresentationIdentities = (
  expected: readonly string[],
  discovered: readonly string[]
): void => {
  if (
    !expected.length ||
    expected.length !== discovered.length ||
    new Set(discovered).size !== discovered.length ||
    expected.some((identity) => !discovered.includes(identity))
  ) {
    throw new Error(
      "Presentation discovery differs from exact test-list identities"
    );
  }
};

export const assertPresentationDiscovery = (
  expected: readonly PresentationTestListEntry[],
  discovered: readonly NativeCase[]
): void => {
  assertExactPresentationIdentities(
    expected.map((entry) =>
      presentationIdentity(entry.project, entry.file, entry.titles)
    ),
    discovered.map((test) =>
      presentationIdentity(test.project, test.file, [
        ...test.suiteTitles,
        test.title,
      ])
    )
  );
  for (const test of discovered) {
    if (test.expectedStatus !== "passed") {
      throw new Error(
        `Skipped/expected-failure presentation discovery: ${test.project}:${test.id}`
      );
    }
  }
};

const isGateMode = (mode: string | undefined): mode is GateMode =>
  mode !== undefined &&
  ["affected", "staged", "e2e", "qualify", "presentation"].includes(mode);

const parsePresentationOptions = (flags: readonly string[]): GateOptions => {
  const [flag, testList] = flags;
  if (
    flags.length !== 2 ||
    flag !== "--test-list" ||
    !testList ||
    testList.startsWith("--")
  ) {
    throw new Error("Presentation mode requires --test-list <file> only");
  }
  return {
    base: "origin/main",
    ci: false,
    format: false,
    full: false,
    mode: "presentation",
    presentationTestList: testList,
  };
};

const parseStandardGateOptions = (
  mode: Exclude<GateMode, "presentation">,
  flags: readonly string[]
): GateOptions => {
  let base = "origin/main";
  let full = mode === "e2e" || mode === "qualify";
  let ci = false;
  let format = false;
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] === "--full") {
      full = true;
    } else if (flags[index] === "--ci" && mode === "affected") {
      ci = true;
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
  return { base, ci, format, full, mode };
};

export const parseGateOptions = (args: readonly string[]): GateOptions => {
  const [mode, ...flags] = args;
  if (!isGateMode(mode)) {
    throw new Error("Expected affected, staged, e2e, qualify or presentation");
  }
  return mode === "presentation"
    ? parsePresentationOptions(flags)
    : parseStandardGateOptions(mode, flags);
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
export const assertNativeSourceIdentity = (
  report: unknown,
  identity: string
): void => {
  const config = reportObject(reportObject(report).config);
  const projects = reportList(config.projects);
  if (!projects.length) {
    throw new Error("Native source metadata has no configured projects");
  }
  for (const entry of projects) {
    const metadata = reportObject(reportObject(entry).metadata ?? {});
    if (metadata.source !== identity) {
      throw new Error(
        "Native report source metadata differs from immutable candidate identity"
      );
    }
  }
};
const reportString = (value: unknown): string => {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid native report identity");
  }
  return value;
};

const commitSha = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f\d]{40}$/iu.test(value)) {
    throw new Error("Invalid CI commit identity");
  }
  return value.toLowerCase();
};

const ZERO_SHA = "0".repeat(40);

export const assertCiEventIdentity = (
  eventName: string,
  event: unknown,
  testedInput: string,
  workflowShaInput: string,
  parentsInput: readonly string[]
): CiEventIdentity => {
  const tested = commitSha(testedInput);
  const workflowSha = commitSha(workflowShaInput);
  const parents = parentsInput.map(commitSha);
  if (tested !== workflowSha) {
    throw new Error("Checked out commit does not match workflow SHA");
  }

  const payload = reportObject(event);
  if (eventName === "pull_request") {
    const pullRequest = reportObject(payload.pull_request);
    const base = commitSha(reportObject(pullRequest.base).sha);
    const head = commitSha(reportObject(pullRequest.head).sha);
    if (parents.length !== 2 || parents[0] !== base || parents[1] !== head) {
      throw new Error("Tested merge commit does not match event base and head");
    }
    return { base, full: false, head, tested };
  }

  if (eventName === "push") {
    const { after, before } = payload;
    const base = before === ZERO_SHA ? ZERO_SHA : commitSha(before);
    const head = commitSha(after);
    if (head !== tested) {
      throw new Error("Checked out commit does not match event head");
    }
    return { base, full: base === ZERO_SHA, head, tested };
  }

  throw new Error("Unsupported CI event identity");
};

export const getCurrentStage = (): string => currentStage;

export const nativeCases = (report: unknown): NativeCase[] => {
  const cases: NativeCase[] = [];
  const walk = (suites: unknown[], parentSuiteTitles: string[] = []) => {
    for (const entry of suites) {
      const suite = reportObject(entry);
      const suiteTitle = typeof suite.title === "string" ? suite.title : "";
      const suiteTitles =
        typeof suite.line === "number" && suite.line > 0 && suiteTitle
          ? [...parentSuiteTitles, suiteTitle]
          : parentSuiteTitles;
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
            file: reportString(spec.file),
            id: reportString(spec.id),
            location: `${reportString(spec.file)}:${spec.line}:${spec.column}:${reportString(spec.title)}`,
            project: reportString(test.projectName),
            results,
            suiteTitles,
            tags,
            title: reportString(spec.title),
          });
        }
      }
      walk(reportList(suite.suites ?? []), suiteTitles);
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

const awaitCommandProcessGroupExit = async (
  pid: number,
  failed: () => void
): Promise<void> => {
  try {
    await awaitProcessGroupExit(pid);
  } catch (error) {
    failed();
    throw error;
  }
};

const commandLeaderAtDeadline = (
  child: ChildProcess
): SafeCommandFailure["leaderAtDeadline"] => {
  if (child.pid === undefined) {
    return "not-observed";
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    return "exited";
  }
  return "running";
};

const throwCommandFailure = (failure: Error | undefined): void => {
  if (failure) {
    throw failure;
  }
};

const attachCommandFailureMetadata = <T extends Error>(
  error: T,
  outcome: SafeCommandFailure["outcome"] | undefined,
  startedAt: number,
  child: ChildProcess,
  leaderAtDeadline: SafeCommandFailure["leaderAtDeadline"],
  processGroup: SafeCommandFailure["processGroup"],
  timeout: number
): T => {
  if (!outcome) {
    return error;
  }
  return attachSafeCommandFailure(error, {
    elapsedMs: Math.max(0, Date.now() - startedAt),
    exitCode: child.exitCode,
    leaderAtDeadline,
    outcome,
    processGroup,
    signal: child.signalCode,
    timeoutMs: Math.max(0, Math.trunc(timeout)),
  });
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
  const startedAt = Date.now();
  let stdout: "pipe" | "ignore" | "inherit" = capture ? "pipe" : "inherit";
  let stderr: "pipe" | "ignore" | "inherit" = capture ? "pipe" : "inherit";
  if (env.CI === "true") {
    stderr = "ignore";
    if (!capture) {
      stdout = "ignore";
    }
  }
  // App types require NODE_ENV globally; Node's native CLI environment may legitimately omit it.
  const child = spawn(command, args, {
    cwd,
    detached,
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", stdout, stderr],
  });
  const completion = once(child, "close");
  let outcome: SafeCommandFailure["outcome"] | undefined;
  let leaderAtDeadline: SafeCommandFailure["leaderAtDeadline"] = "not-observed";
  let processGroup: SafeCommandFailure["processGroup"] = "not-checked";
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
    outcome = "timeout";
    leaderAtDeadline = commandLeaderAtDeadline(child);
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
    if (failure) {
      clearTimeout(timer);
      throw failure;
    }
    if (code !== 0) {
      clearTimeout(timer);
      outcome = "nonzero-exit";
      throw new Error(`Native command exited with status ${code}`);
    }
    if (detached && child.pid) {
      await awaitCommandProcessGroupExit(child.pid, () => {
        processGroup = "not-confirmed";
        outcome ??= "process-group-cleanup";
      });
      processGroup = "confirmed-absent";
    }
    clearTimeout(timer);
    throwCommandFailure(failure);
    return output;
  } catch (error) {
    const operationFailure = failure;
    clearTimeout(timer);
    signalCommand("SIGKILL");
    try {
      if (child.pid) {
        await Promise.allSettled([completion]);
        if (detached) {
          await awaitCommandProcessGroupExit(child.pid, () => {
            processGroup = "not-confirmed";
            outcome ??= "process-group-cleanup";
          });
          processGroup = "confirmed-absent";
        }
      }
    } catch (cleanupError) {
      processGroup = "not-confirmed";
      outcome ??= "process-group-cleanup";
      throw attachCommandFailureMetadata(
        new AggregateError(
          [error, cleanupError],
          `Required command and cleanup failed: ${command} ${args.join(" ")}`,
          { cause: cleanupError }
        ),
        outcome,
        startedAt,
        child,
        leaderAtDeadline,
        processGroup,
        timeout
      );
    }
    throw attachCommandFailureMetadata(
      new Error(
        `Required command failed: ${command} ${args.join(" ")}${operationFailure ? ` (${operationFailure.message})` : ""}`,
        { cause: error }
      ),
      outcome,
      startedAt,
      child,
      leaderAtDeadline,
      processGroup,
      timeout
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

const resolveCiCandidate = async (
  root: string,
  gitContext: Environment
): Promise<CiEventIdentity & { tree: string }> => {
  currentStage = "CI source identity";
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    !process.env.GITHUB_EVENT_NAME ||
    !process.env.GITHUB_EVENT_PATH ||
    !process.env.GITHUB_SHA
  ) {
    throw new Error("CI source identity is unavailable");
  }
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, "utf-8")
  );
  const testedOutput = await run(
    "git",
    ["rev-parse", "HEAD"],
    root,
    gitContext,
    true
  );
  const tested = testedOutput.trim();
  const treeOutput = await run(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    root,
    gitContext,
    true
  );
  const tree = treeOutput.trim();
  const status = await run(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    root,
    gitContext,
    true
  );
  if (status.trim()) {
    throw new Error("CI checkout contains uncommitted source changes");
  }
  const commitOutput = await run(
    "git",
    ["rev-list", "--parents", "-n", "1", "HEAD"],
    root,
    gitContext,
    true
  );
  const commitLine = commitOutput.trim().split(/\s+/u);
  if (commitLine[0] !== tested) {
    throw new Error("Unable to read the tested commit parents");
  }
  const identity = assertCiEventIdentity(
    process.env.GITHUB_EVENT_NAME,
    event,
    tested,
    process.env.GITHUB_SHA,
    commitLine.slice(1)
  );
  const revisions = [identity.base, identity.head].filter(
    (revision) => revision !== ZERO_SHA
  );
  await Promise.all(
    revisions.map((revision) =>
      run(
        "git",
        ["cat-file", "-e", `${revision}^{commit}`],
        root,
        gitContext,
        true
      )
    )
  );
  const { full: initiallyFull } = identity;
  let full = initiallyFull;
  if (process.env.GITHUB_EVENT_NAME === "push" && !full) {
    try {
      const mergeBase = await run(
        "git",
        ["merge-base", identity.base, identity.head],
        root,
        gitContext,
        true
      );
      full = mergeBase.trim() !== identity.base;
    } catch {
      full = true;
    }
  }
  return { ...identity, full, tree };
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
  if (options.full) {
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
  currentStage = "locked dependency install";
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

const coverageDirectory = "coverage/production-source-unit";
const mutationDirectory = "coverage/mutation";
const mutationSource = "src/features/account/identity-validation.ts";
const mutationTest = "tests/shared/account/application-contract.test.ts";
const mutationStatuses = [
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "RuntimeError",
  "CompileError",
  "Ignored",
  "Pending",
] as const;

export interface MutationSummary {
  counts: Record<(typeof mutationStatuses)[number], number>;
  mutationScore: number | null;
  mutationScoreBasedOnCoveredCode: number | null;
  totalMutants: number;
}

/** Return only safe aggregate metrics from Stryker's source-bearing JSON report. */
export const summarizeMutationReport = (input: unknown): MutationSummary => {
  const report = reportObject(input);
  const {
    schemaVersion,
    files: sourceFiles,
    testFiles: reportTestFiles,
  } = report;
  if (schemaVersion !== "1.0") {
    throw new Error("Incompatible mutation report schema");
  }

  const files = reportObject(sourceFiles);
  if (Object.keys(files).length !== 1 || !(mutationSource in files)) {
    throw new Error("Mutation report has unexpected source scope");
  }
  const testFiles = reportObject(reportTestFiles);
  if (Object.keys(testFiles).length !== 1 || !(mutationTest in testFiles)) {
    throw new Error("Mutation report has unexpected test scope");
  }

  const file = reportObject(files[mutationSource]);
  const mutants = reportList(file.mutants);
  if (mutants.length === 0) {
    throw new Error("Mutation report contains no mutants");
  }
  const counts = Object.fromEntries(
    mutationStatuses.map((status) => [status, 0])
  ) as MutationSummary["counts"];
  for (const mutant of mutants) {
    const { status } = reportObject(mutant);
    if (
      typeof status !== "string" ||
      !mutationStatuses.includes(status as (typeof mutationStatuses)[number])
    ) {
      throw new Error("Mutation report has an unknown mutant status");
    }
    counts[status as keyof typeof counts] += 1;
  }

  const detected = counts.Killed + counts.Timeout;
  const valid = detected + counts.Survived + counts.NoCoverage;
  const covered = detected + counts.Survived;
  const score = valid > 0 ? (detected / valid) * 100 : null;
  const coveredScore =
    valid > 0 && covered > 0 ? (detected / covered) * 100 : null;
  return {
    counts,
    mutationScore: score,
    mutationScoreBasedOnCoveredCode: coveredScore,
    totalMutants: mutants.length,
  };
};

export const assertCoverageConfigMatches = (
  candidateConfig: Buffer,
  baseConfig: Buffer
): void => {
  if (!candidateConfig.equals(baseConfig)) {
    throw new Error("Base Vitest config differs from the candidate");
  }
};

export const productionCoverageSources = (root: string): string[] => {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file);
      } else if (
        entry.isFile() &&
        /\.tsx?$/u.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(path.relative(root, file).split(path.sep).join("/"));
      }
    }
  };
  visit(path.join(root, "src"));
  return files.toSorted();
};

export const assertCoverageFileInventory = (
  summaryFiles: readonly string[],
  expectedFiles: readonly string[],
  root: string
): void => {
  const relative = (file: string): string => {
    const absolute = path.isAbsolute(file)
      ? path.normalize(file)
      : path.resolve(root, file);
    return path.relative(root, absolute).split(path.sep).join("/");
  };
  const actual = new Set(summaryFiles.map(relative));
  const expected = new Set(expectedFiles.map(relative));
  if (
    actual.size !== summaryFiles.length ||
    expected.size !== expectedFiles.length ||
    actual.size !== expected.size ||
    [...expected].some((file) => !actual.has(file))
  ) {
    throw new Error(
      "Coverage summary does not include every executable src TypeScript file"
    );
  }
};

const assertCoverageSummary = (file: string, sourceRoot: string): void => {
  const report = reportObject(JSON.parse(readFileSync(file, "utf-8")));
  const total = reportObject(report.total);
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    const result = reportObject(total[metric]);
    if (
      !["covered", "total", "skipped", "pct"].every(
        (key) => typeof result[key] === "number" && Number.isFinite(result[key])
      )
    ) {
      throw new Error("Coverage summary is incomplete");
    }
  }
  assertCoverageFileInventory(
    Object.keys(report).filter((entry) => entry !== "total"),
    productionCoverageSources(sourceRoot),
    sourceRoot
  );
};

const installedPackageVersion = (root: string, packageName: string): string => {
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        root,
        "node_modules",
        ...packageName.split("/"),
        "package.json"
      ),
      "utf-8"
    )
  );
  if (typeof manifest.version !== "string") {
    throw new TypeError("Installed measurement package has no version");
  }
  return manifest.version;
};

const coverageTotals = (directory: string) => {
  const total = reportObject(
    reportObject(
      JSON.parse(
        readFileSync(path.join(directory, "coverage-summary.json"), "utf-8")
      )
    ).total
  );
  return Object.fromEntries(
    ["statements", "branches", "functions", "lines"].map((metric) => {
      const result = reportObject(total[metric]);
      return [
        metric,
        Object.fromEntries(
          ["covered", "total", "skipped", "pct"].map((key) => [
            key,
            result[key],
          ])
        ),
      ];
    })
  );
};

const writeCoverageReceipt = (
  candidate: VerificationIdentity,
  source: string,
  root: string,
  evidence: string,
  status: "comparable" | "incomparable" | "not-run-in-ci",
  ci: boolean
): void => {
  const receipt = {
    ...candidate,
    baseComparison: status,
    baseCoverage:
      status === "comparable"
        ? coverageTotals(
            path.join(root, "coverage/base/production-source-unit")
          )
        : null,
    candidate: coverageTotals(path.join(source, coverageDirectory)),
  };
  writeFileSync(
    path.join(evidence, "coverage-summary.json"),
    JSON.stringify(receipt),
    {
      mode: 0o600,
    }
  );
  console.log(`EFCC unit coverage: ${JSON.stringify(receipt)}`);
  if (!ci) {
    return;
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) {
    throw new TypeError(
      "Required GitHub coverage receipt destination is unavailable"
    );
  }
  appendFileSync(
    summary,
    [
      "## Production-source unit coverage",
      "",
      `- Tested commit: \`${candidate.tested}\` (tree \`${candidate.tree}\`)`,
      `- Event head: \`${candidate.head}\``,
      `- Actual base: \`${candidate.base}\``,
      "- Base comparison and Native qualification run in the applicable strong local gate; neither ran in this light CI job.",
      "- This measures production-source unit coverage; it does not represent Native HTTP, D1, browser, or acceptance coverage.",
      "",
    ].join("\n"),
    { mode: 0o600 }
  );
};

const writeMutationReceipt = (
  candidate: VerificationIdentity,
  summary: MutationSummary,
  elapsedMs: number,
  evidence: string
): void => {
  const receipt = { ...candidate, ...summary, runtimeMs: elapsedMs };
  writeFileSync(
    path.join(evidence, "mutation-summary.json"),
    JSON.stringify(receipt),
    {
      mode: 0o600,
    }
  );
  console.log(
    `EFCC mutation pilot: ${JSON.stringify({
      base: candidate.base,
      counts: summary.counts,
      head: candidate.head,
      mutationScore: summary.mutationScore,
      mutationScoreBasedOnCoveredCode: summary.mutationScoreBasedOnCoveredCode,
      runtimeMs: elapsedMs,
      tested: candidate.tested,
      totalMutants: summary.totalMutants,
      tree: candidate.tree,
    })}`
  );
};

const runMutationPilot = async (
  source: string,
  env: Environment,
  candidate: VerificationIdentity,
  evidence: string
): Promise<void> => {
  currentStage = "bounded Identity-validation mutation pilot";
  const manifest = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf-8")
  );
  if (typeof manifest.scripts?.["test:mutation"] !== "string") {
    throw new TypeError("Required mutation pilot script is unavailable");
  }
  const reportDirectory = path.join(source, mutationDirectory);
  rmSync(reportDirectory, { force: true, recursive: true });
  const started = process.hrtime.bigint();
  await run("pnpm", ["run", "test:mutation"], source, env, false, 600_000);
  const reportPath = path.join(reportDirectory, "mutation.json");
  if (!lstatSync(reportPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Required mutation report is missing");
  }
  const summary = summarizeMutationReport(
    JSON.parse(readFileSync(reportPath, "utf-8"))
  );
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  writeMutationReceipt(candidate, summary, elapsedMs, evidence);
};

const installCoverageMeasurementOverlay = async (
  source: string,
  candidateSource: string,
  env: Environment
): Promise<void> => {
  assertCoverageConfigMatches(
    readFileSync(path.join(candidateSource, "vitest.config.ts")),
    readFileSync(path.join(source, "vitest.config.ts"))
  );
  const candidateManifest = JSON.parse(
    readFileSync(path.join(candidateSource, "package.json"), "utf-8")
  );
  const baseManifest = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf-8")
  );
  if (
    candidateManifest.engines?.node !== process.versions.node ||
    baseManifest.engines?.node !== candidateManifest.engines?.node ||
    baseManifest.packageManager !== candidateManifest.packageManager
  ) {
    throw new Error("Base runtime toolchain differs from the candidate");
  }
  await run(
    "pnpm",
    ["install", "--frozen-lockfile", "--prefer-offline"],
    source,
    env,
    false,
    900_000
  );

  const candidateVitest = installedPackageVersion(candidateSource, "vitest");
  const baseVitest = installedPackageVersion(source, "vitest");
  if (candidateVitest !== baseVitest) {
    throw new Error("Base Vitest version differs from the candidate");
  }
  const candidateCoverageProvider = path.join(
    candidateSource,
    "node_modules/@vitest/coverage-v8"
  );
  const providerManifest = JSON.parse(
    readFileSync(path.join(candidateCoverageProvider, "package.json"), "utf-8")
  );
  if (
    typeof providerManifest.version !== "string" ||
    (typeof providerManifest.peerDependencies?.vitest === "string" &&
      providerManifest.peerDependencies.vitest !== candidateVitest)
  ) {
    throw new TypeError(
      "Pinned coverage provider is incompatible with base Vitest"
    );
  }
  copyFileSync(
    path.join(candidateSource, "vitest.coverage.config.ts"),
    path.join(source, "vitest.coverage.config.ts")
  );
  const baseCoverageProvider = path.join(
    source,
    "node_modules/@vitest/coverage-v8"
  );
  if (existsSync(baseCoverageProvider)) {
    if (
      installedPackageVersion(source, "@vitest/coverage-v8") !==
      providerManifest.version
    ) {
      throw new Error(
        "Base coverage provider differs from the candidate overlay"
      );
    }
  } else {
    mkdirSync(path.dirname(baseCoverageProvider), { recursive: true });
    symlinkSync(
      realpathSync(candidateCoverageProvider),
      baseCoverageProvider,
      "dir"
    );
  }
};

const runBaseCoverageReport = async (
  source: string,
  baseOutput: string,
  env: Environment
): Promise<void> => {
  await run(
    "pnpm",
    ["exec", "vitest", "run", "--config", "vitest.coverage.config.ts"],
    source,
    env,
    false,
    1_800_000
  );
  const summary = path.join(source, coverageDirectory, "coverage-summary.json");
  const final = path.join(source, coverageDirectory, "coverage-final.json");
  assertCoverageSummary(summary, source);
  if (!lstatSync(final, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Base coverage final report is missing");
  }
  mkdirSync(baseOutput, { recursive: true });
  copyFileSync(summary, path.join(baseOutput, "coverage-summary.json"));
  copyFileSync(final, path.join(baseOutput, "coverage-final.json"));
};

const removeBaseWorktree = async (
  source: string,
  root: string,
  env: Environment
): Promise<boolean> => {
  try {
    await run(
      "git",
      ["worktree", "remove", "--force", source],
      root,
      env,
      false,
      60_000
    );
    return false;
  } catch {
    rmSync(source, { force: true, recursive: true });
    try {
      await run("git", ["worktree", "prune"], root, env, false);
    } catch {
      // The caller restores the candidate before failing the gate.
    }
    return true;
  }
};

const compareBaseCoverage = async (
  source: string,
  root: string,
  owned: string,
  env: Environment,
  candidate: VerificationIdentity
): Promise<boolean> => {
  const baseOutput = path.join(root, "coverage/base/production-source-unit");
  rmSync(baseOutput, { force: true, recursive: true });
  if (candidate.base === ZERO_SHA) {
    return false;
  }

  const candidateBackup = path.join(owned, "candidate-source");
  let candidateMoved = false;
  let worktreeAdded = false;
  let comparable = false;
  currentStage = "base coverage comparison";
  try {
    renameSync(source, candidateBackup);
    candidateMoved = true;
    // A foreign worktree must not inherit the native hook index/repository context.
    await run(
      "git",
      ["worktree", "add", "--detach", source, candidate.base],
      root,
      env,
      false,
      900_000
    );
    worktreeAdded = true;
    await installCoverageMeasurementOverlay(source, candidateBackup, env);
    await runBaseCoverageReport(source, baseOutput, env);
    comparable = true;
  } catch {
    // The base report is advisory: keep candidate coverage required and expose no false delta.
    rmSync(baseOutput, { force: true, recursive: true });
  }

  const cleanupFailed = worktreeAdded
    ? await removeBaseWorktree(source, root, env)
    : false;
  if (candidateMoved) {
    if (!worktreeAdded) {
      rmSync(source, { force: true, recursive: true });
    }
    renameSync(candidateBackup, source);
  }
  if (cleanupFailed) {
    throw new Error("Base coverage worktree cleanup failed");
  }
  return comparable;
};

const logSnapshotIdentity = (
  identity: string,
  paths: string[],
  options: GateOptions,
  selection: TestSelection,
  evidence: string,
  pnpm: string
): void => {
  if (process.env.CI === "true") {
    console.log(
      JSON.stringify({
        base: options.candidate?.base ?? options.baseIdentity ?? null,
        changedPathCount: paths.length,
        head: options.candidate?.head ?? null,
        mergeBase: options.baseIdentity ?? null,
        mode: options.mode,
        node: process.versions.node,
        pnpm,
        selection,
        sourceTree: identity,
        tested: options.candidate?.tested ?? null,
      })
    );
    return;
  }
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
};

interface PresentationTestList {
  entries: PresentationTestListEntry[];
  path: string;
  sha256: string;
}

interface PresentationScope extends PresentationTestList {
  sourceTree: string;
}

const preparePresentationTestList = (
  root: string,
  requestedPath: string | undefined,
  evidence: string
): PresentationTestList => {
  if (!requestedPath) {
    throw new Error("Presentation mode requires --test-list <file>");
  }
  const input = path.resolve(root, requestedPath);
  const stat = lstatSync(input, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error("Presentation test list must be a regular file");
  }
  const resolved = realpathSync(input);
  const relative = path.relative(realpathSync(root), resolved);
  const outsideRepository =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (!outsideRepository) {
    throw new Error(
      "Presentation test list must be outside the candidate repository"
    );
  }
  const bytes = readFileSync(resolved);
  const content = bytes.toString("utf-8");
  if (!Buffer.from(content, "utf-8").equals(bytes)) {
    throw new Error("Presentation test list must be UTF-8");
  }
  const entries = parsePresentationTestList(content);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const copiedPath = path.join(evidence, "presentation-test-list.txt");
  writeFileSync(copiedPath, bytes, { flag: "wx", mode: 0o600 });
  return { entries, path: copiedPath, sha256 };
};

const requirePresentationTestList = (
  testList: PresentationTestList | undefined
): PresentationTestList => {
  if (!testList) {
    throw new Error("Presentation test list is unavailable");
  }
  return testList;
};

const runUnitQualityStages = async (
  source: string,
  root: string,
  options: GateOptions,
  snapshot: Awaited<ReturnType<typeof validateSourceTree>>,
  identity: string,
  env: Environment,
  gitContext: Environment,
  unitScript: "test" | "test:coverage"
): Promise<void> => {
  const manifest = JSON.parse(
    readFileSync(path.join(source, "package.json"), "utf-8")
  );
  if (typeof manifest.scripts?.[unitScript] !== "string") {
    throw new TypeError("Required unit measurement script is unavailable");
  }
  for (const script of ["check", "typecheck", unitScript]) {
    currentStage = script === unitScript ? "unit tests" : script;
    if (env.CI === "true") {
      console.log(`EFCC required check: ${currentStage} started.`);
    }
    // eslint-disable-next-line no-await-in-loop -- check, types, then tests are ordered fail-fast prerequisites.
    await run("pnpm", ["run", script], source, env);
    if (env.CI === "true") {
      console.log(`EFCC required check: ${currentStage} passed.`);
    }
    if (options.mode === "staged") {
      snapshot.assertIndexUnchanged(root, identity, gitContext);
    }
  }
};

const publishCandidateCoverage = async (
  source: string,
  root: string,
  env: Environment,
  candidate: VerificationIdentity,
  evidence: string,
  ci: boolean
): Promise<void> => {
  currentStage = "candidate coverage report validation";
  const candidateDirectory = path.join(source, coverageDirectory);
  const candidateSummary = path.join(
    candidateDirectory,
    "coverage-summary.json"
  );
  const candidateFinal = path.join(candidateDirectory, "coverage-final.json");
  assertCoverageSummary(candidateSummary, source);
  if (!lstatSync(candidateFinal, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Candidate coverage final report is missing");
  }
  const reportDirectory = path.join(root, coverageDirectory);
  rmSync(reportDirectory, { force: true, recursive: true });
  mkdirSync(reportDirectory, { recursive: true });
  copyFileSync(
    candidateSummary,
    path.join(reportDirectory, "coverage-summary.json")
  );
  copyFileSync(
    candidateFinal,
    path.join(reportDirectory, "coverage-final.json")
  );
  const comparable =
    !ci &&
    (await compareBaseCoverage(
      source,
      root,
      path.dirname(source),
      env,
      candidate
    ));
  let status: "comparable" | "incomparable" | "not-run-in-ci" = comparable
    ? "comparable"
    : "incomparable";
  if (ci) {
    status = "not-run-in-ci";
  }
  writeCoverageReceipt(candidate, source, root, evidence, status, ci);
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
  signal = commandSignal,
  presentation?: PresentationScope
): Promise<
  { cases: NativeCase[]; config: string; report: string; args: string[] }[]
> => {
  currentStage = "Native discovery";
  const lanes = [
    "playwright.native.config.ts",
    "playwright.features.config.ts",
    "playwright.causal.config.ts",
    "playwright.dev.config.ts",
  ];
  const { selectedGrep } = await import(
    pathToFileURL(path.join(source, "scripts/test-selection.ts")).href
  );
  const list = async (
    config: string,
    args: string[],
    name: string,
    sourceTree?: string
  ) => {
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
    const report = JSON.parse(readFileSync(output, "utf-8"));
    if (sourceTree) {
      assertNativeSourceIdentity(report, sourceTree);
    }
    return nativeCases(report);
  };
  if (presentation) {
    const config = "playwright.features.config.ts";
    const scopedArgs = ["--test-list", presentation.path];
    const cases = await list(
      config,
      scopedArgs,
      "presentation",
      presentation.sourceTree
    );
    assertPresentationDiscovery(presentation.entries, cases);
    for (const test of cases) {
      classify(test.tags);
    }
    return [
      {
        args: ["--config", config, ...scopedArgs],
        cases,
        config,
        report: path.join(evidence, "presentation-results.json"),
      },
    ];
  }
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
  const projectCounts = Object.fromEntries(
    [...new Set(discovered.map(({ project }) => project))]
      .toSorted()
      .map((project) => [
        project,
        discovered.filter((test) => test.project === project).length,
      ])
  );
  console.log(
    JSON.stringify({
      nativeDiscovery: { cases: discovered.length, projects: projectCounts },
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
  classify: (tags: readonly string[]) => void,
  presentation?: PresentationScope
): Promise<void> => {
  const required = await discoverNative(
    source,
    env,
    evidence,
    selection,
    full,
    classify,
    commandSignal,
    presentation
  );
  const executed: NativeCase[] = [];
  for (const lane of required) {
    currentStage = `Native execution (${lane.config})`;
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = lane.report;
    // eslint-disable-next-line no-await-in-loop -- preserve first failure and exclusive runtime fixture ownership.
    await run(
      "pnpm",
      ["exec", "playwright", "test", ...lane.args, "--retries=0"],
      source,
      env
    );
    const report = JSON.parse(readFileSync(lane.report, "utf-8"));
    if (presentation) {
      assertNativeSourceIdentity(report, presentation.sourceTree);
    }
    const actual = nativeCases(report);
    assertNativeExecution(lane.cases, actual);
    executed.push(...actual);
  }
  const projectCounts = Object.fromEntries(
    [...new Set(executed.map(({ project }) => project))]
      .toSorted()
      .map((project) => [
        project,
        executed.filter((test) => test.project === project).length,
      ])
  );
  const expected = required.reduce(
    (count, lane) => count + lane.cases.length,
    0
  );
  console.log(
    JSON.stringify({
      executed: executed.length,
      expected,
      failed: 0,
      nativeExecution: { cases: executed.length, projects: projectCounts },
      ...(presentation
        ? {
            fullQualification: false,
            presentationTestList: {
              entries: presentation.entries.length,
              sha256: presentation.sha256,
            },
            qualificationScope: "presentation-subset-only",
            selected: expected,
            sourceTree: presentation.sourceTree,
            status: "passed",
          }
        : {}),
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
  currentStage = "immutable Native build";
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
  } catch {
    console.error(
      JSON.stringify({
        category: "unavailable",
        outcome: "uncached",
        stage: "native-build-cache",
      })
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

const runBuildAndNativeStages = async (
  source: string,
  root: string,
  evidence: string,
  selection: TestSelection,
  full: boolean,
  options: GateOptions,
  env: Environment,
  gitContext: Environment,
  classify: (tags: readonly string[]) => void
): Promise<void> => {
  currentStage = "production build and Native qualification";
  if (
    selection.productionBuild === true ||
    options.mode === "qualify" ||
    (options.mode === "staged" && full)
  ) {
    currentStage = "production build";
    await run("pnpm", ["run", "build"], source, env);
  }
  if (!selection.tags.length && !selection.configs.length) {
    return;
  }
  await buildNative(source, root, env, gitContext);
  await runRuntime(source, env, evidence, selection, full, classify);
};

interface NativeSelectionModule {
  assertNativeClassification: (tags: readonly string[]) => void;
  selectTests: (paths: readonly string[], fullRun?: boolean) => TestSelection;
}

const loadNativeSelection = async (
  source: string
): Promise<NativeSelectionModule> => {
  const selectionPath = path.join(source, "scripts/test-selection.ts");
  if (!existsSync(selectionPath)) {
    throw new Error(
      "N16 integration dependency missing: authoritative scripts/test-selection.ts"
    );
  }
  const selection = await import(pathToFileURL(selectionPath).href);
  if (
    typeof selection.selectTests !== "function" ||
    typeof selection.assertNativeClassification !== "function"
  ) {
    throw new TypeError(
      "N16 integration dependency missing: authoritative selector/classifier exports"
    );
  }
  return selection as NativeSelectionModule;
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
  signal = interruption.signal,
  presentationTestList?: PresentationTestList
): Promise<void> => {
  commandSignal = signal;
  // Runtime-selected source paths cannot use static imports from the working checkout.
  const snapshot = await validateSourceTree(source, root, identity, gitContext);
  const { selectTests, assertNativeClassification } =
    await loadNativeSelection(source);
  currentStage = "source selection";
  const selection: TestSelection = selectTests(paths, options.full);
  const full = options.full || selection.full === true;
  currentStage = "selection validation";
  assertSelection(selection, full);
  const pnpm = await bootstrap(source, env);
  env.EFCC_TEST_SOURCE = identity;
  env.EFCC_EVIDENCE_ROOT = evidence;
  logSnapshotIdentity(identity, paths, options, selection, evidence, pnpm);
  if (options.mode === "staged") {
    snapshot.assertIndexUnchanged(root, identity, gitContext);
  }
  if (options.mode === "presentation") {
    await buildNative(source, root, env, gitContext);
    await runRuntime(
      source,
      env,
      evidence,
      selection,
      full,
      assertNativeClassification,
      {
        ...requirePresentationTestList(presentationTestList),
        sourceTree: identity,
      }
    );
    return;
  }
  if (options.format) {
    await formatIndex(source, root, env, gitContext);
    return;
  }
  const coverage =
    options.ci ||
    full ||
    paths.includes("vitest.config.ts") ||
    selection.productionBuild === true ||
    selection.mutation === true;
  const unitScript = coverage ? "test:coverage" : "test";
  await runUnitQualityStages(
    source,
    root,
    options,
    snapshot,
    identity,
    env,
    gitContext,
    unitScript
  );
  if (coverage) {
    let candidate: VerificationIdentity | undefined = options.candidate;
    if (!candidate) {
      const baseOutput =
        options.baseIdentity ??
        (await run(
          "git",
          ["merge-base", options.base, "HEAD"],
          root,
          gitContext,
          true
        ));
      const headOutput = await run(
        "git",
        ["rev-parse", "HEAD"],
        root,
        gitContext,
        true
      );
      candidate = {
        base: baseOutput.trim(),
        head: headOutput.trim(),
        tested: null,
        tree: identity,
      };
    }
    await publishCandidateCoverage(
      source,
      root,
      env,
      candidate,
      evidence,
      options.ci
    );
    if (selection.mutation === true && !options.ci) {
      await runMutationPilot(source, env, candidate, evidence);
    }
  }
  if (!options.ci) {
    await runBuildAndNativeStages(
      source,
      root,
      evidence,
      selection,
      full,
      options,
      env,
      gitContext,
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

const launchFormat = async (args: string[]): Promise<void> => {
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
};

const launchBuildCached = async (): Promise<void> => {
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
};

const launchGate = async (options: GateOptions): Promise<void> => {
  const root = process.cwd();
  const gitContext = await gitEnvironment(root);
  const env = { ...gitContext };
  const fixedOwned =
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_TEMP
      ? path.join(process.env.RUNNER_TEMP, "efcc-gate-source")
      : undefined;
  const owned =
    fixedOwned ?? mkdtempSync(path.join(tmpdir(), "efcc-gate-source-"));
  if (fixedOwned) {
    if (existsSync(owned)) {
      throw new Error("Owned CI source directory already exists");
    }
    mkdirSync(owned, { mode: 0o700 });
  }
  const evidence = mkdtempSync(path.join(tmpdir(), "efcc-gate-evidence-"));
  chmodSync(owned, 0o700);
  chmodSync(evidence, 0o700);
  const source = path.join(owned, "source");
  let runOptions = options;
  let presentationTestList: PresentationTestList | undefined;
  try {
    if (runOptions.mode === "presentation") {
      presentationTestList = preparePresentationTestList(
        root,
        runOptions.presentationTestList,
        evidence
      );
    }
    if (runOptions.ci) {
      const candidate = await resolveCiCandidate(root, gitContext);
      runOptions = {
        ...runOptions,
        base: candidate.base,
        candidate,
        full: runOptions.full || candidate.full,
      };
    }
    if (runOptions.mode !== "staged") {
      env.GIT_INDEX_FILE = path.join(owned, "index");
      await run("git", ["read-tree", "HEAD"], root, env, true);
      await run("git", ["add", "-A", "--", "."], root, env, true);
    }
    const tree = await run("git", ["write-tree"], root, env, true);
    const identity = tree.trim();
    if (runOptions.candidate && identity !== runOptions.candidate.tree) {
      throw new Error("Exported source tree does not match the tested commit");
    }
    const paths = await changedPaths(root, runOptions, gitContext, identity);
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
    try {
      await authoritative.executeSnapshot(
        source,
        root,
        identity,
        paths,
        runOptions,
        evidence,
        cleanEnvironment(),
        gitContext,
        interruption.signal,
        presentationTestList
      );
    } catch (error) {
      if (typeof authoritative.getCurrentStage === "function") {
        currentStage = authoritative.getCurrentStage();
      }
      throw error;
    }
    if (runOptions.format) {
      await launchGate(
        parseGateOptions(["staged", ...(runOptions.full ? ["--full"] : [])])
      );
    } else if (runOptions.mode === "staged") {
      const current = await run("git", ["write-tree"], root, gitContext, true);
      if (current.trim() !== identity) {
        throw new Error(
          "Git index drifted during qualification; rerun the staged gate"
        );
      }
    }
  } finally {
    rmSync(owned, { force: true, recursive: true });
    if (process.env.CI === "true") {
      console.log(
        "EFCC owned source snapshot disposed; private evidence remains local to the runner."
      );
    } else {
      console.log(
        JSON.stringify({ disposedSource: owned, privateEvidence: evidence })
      );
    }
  }
};

const launch = async (args: string[]): Promise<void> => {
  if (args[0] === "format") {
    await launchFormat(args);
    return;
  }
  if (args[0] === "build-cached" && args.length === 1) {
    await launchBuildCached();
    return;
  }
  await launchGate(parseGateOptions(args));
};

if (import.meta.main) {
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await launch(process.argv.slice(2));
  } catch (error: unknown) {
    if (process.env.CI === "true") {
      const selectionHint =
        currentStage === "source selection"
          ? " Add a source mapping in scripts/test-selection.ts or request explicit full qualification."
          : "";
      const commandFailure = readSafeCommandFailure(error);
      const commandFailureHint = commandFailure
        ? ` Safe command metadata: ${JSON.stringify(commandFailure)}.`
        : "";
      console.error(
        `::error::EFCC required check failed during ${currentStage}; command output is suppressed.${selectionHint}${commandFailureHint}`
      );
    } else {
      console.error(
        error instanceof Error ? error.message : "Native gate failed"
      );
    }
    process.exitCode ||= 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
