import {
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const stages: Record<string, true> = {
  "base-comparison": true,
  build: true,
  check: true,
  cleanup: true,
  coverage: true,
  discovery: true,
  fast: true,
  format: true,
  mutation: true,
  native: true,
  setup: true,
  typecheck: true,
  unit: true,
};
const nativeProjects = [
  "native",
  "lifecycle",
  "features-http",
  "features-chromium",
  "features-iphone-webkit",
  "features-pixel-chromium",
  "causal-http",
  "dev-chromium",
];
const projects = ["unit", ...nativeProjects];
const maxCases = 1_000_000;
const maxBytes = 4 * 1024 * 1024;
const maxLine = 4096;
const updateMs = 2000;
const heartbeatMs = 10_000;
interface Counts {
  completed: number;
  failed: number;
  project: string;
}
interface ProgressEvent {
  kind: "running" | "finished" | "unavailable";
  projects: Counts[];
  seq: number;
  version: 1;
}
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) >= 0 &&
  Number(value) <= maxCases;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).toSorted().join(",") === expected.toSorted().join(",");

const parseCount = (value: unknown, expected: string[]): Counts => {
  if (
    !record(value) ||
    !keys(value, ["project", "completed", "failed"]) ||
    typeof value.project !== "string" ||
    !expected.includes(value.project) ||
    !integer(value.completed) ||
    !integer(value.failed) ||
    value.failed > value.completed
  ) {
    throw new Error("Invalid progress counts");
  }
  return {
    completed: value.completed,
    failed: value.failed,
    project: value.project,
  };
};

const parseCounts = (
  values: unknown[],
  expected: string[],
  previous: Counts[],
  totals?: Record<string, number>
): Counts[] => {
  if (values.length !== expected.length) {
    throw new Error("Invalid progress projects");
  }
  const next: Counts[] = [];
  for (const value of values) {
    const item = parseCount(value, expected);
    const before = previous.find((entry) => entry.project === item.project);
    if (
      next.some((entry) => entry.project === item.project) ||
      (totals && item.completed > (totals[item.project] ?? -1)) ||
      (before &&
        (item.completed < before.completed || item.failed < before.failed))
    ) {
      throw new Error("Invalid progress counts");
    }
    next.push(item);
  }
  return next;
};

const parseEvent = (line: string, previousSeq: number): ProgressEvent => {
  if (Buffer.byteLength(line) > maxLine) {
    throw new Error("Invalid progress size");
  }
  const value: unknown = JSON.parse(line);
  if (
    !record(value) ||
    !keys(value, ["version", "seq", "kind", "projects"]) ||
    value.version !== 1 ||
    !integer(value.seq) ||
    value.seq !== previousSeq + 1 ||
    (value.kind !== "running" && value.kind !== "finished") ||
    !Array.isArray(value.projects)
  ) {
    throw new Error("Invalid or unavailable progress event");
  }
  return {
    kind: value.kind,
    projects: value.projects,
    seq: value.seq,
    version: 1,
  };
};

// Internal reporter adapter: identities stay in memory; only bounded numeric snapshots leave it.
export class CaseProgress {
  private readonly file = process.env.EFCC_PROGRESS_FILE;
  private readonly cases = new Map<
    string,
    { failed: number; ids: Map<string, boolean> }
  >();
  private timer: NodeJS.Timeout | undefined;
  private seq = 0;
  private broken = false;

  begin(names: string[]): void {
    if (!this.file) {
      return;
    }
    if (
      this.timer ||
      this.seq ||
      !names.length ||
      names.length > projects.length ||
      new Set(names).size !== names.length ||
      names.some((name) => !projects.includes(name))
    ) {
      this.unavailable();
      return;
    }
    for (const name of names) {
      this.cases.set(name, { failed: 0, ids: new Map() });
    }
    this.send("running");
    if (!this.broken) {
      this.timer = setInterval(() => this.send("running"), updateMs);
      this.timer.unref();
    }
  }

  complete(project: string, id: string, failed: boolean): void {
    if (!this.file || this.broken) {
      return;
    }
    const cases = this.cases.get(project);
    if (
      !cases ||
      typeof id !== "string" ||
      !id ||
      id.length > 65_536 ||
      (cases.ids.size >= maxCases && !cases.ids.has(id))
    ) {
      this.unavailable();
      return;
    }
    if (failed && cases.ids.get(id) !== true) {
      cases.failed += 1;
    }
    cases.ids.set(id, failed || cases.ids.get(id) === true);
  }

  finish(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.broken) {
      this.send("finished");
    }
    this.cases.clear();
  }

  unavailable(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!this.broken) {
      this.send("unavailable");
    }
    this.broken = true;
    this.cases.clear();
  }

  private send(kind: ProgressEvent["kind"]): void {
    if (!this.file || this.broken) {
      return;
    }
    let fd: number | undefined;
    try {
      const counts = [...this.cases].map(([project, cases]) => ({
        completed: cases.ids.size,
        failed: cases.failed,
        project,
      }));
      this.seq += 1;
      const line = `${JSON.stringify({ kind, projects: counts, seq: this.seq, version: 1 })}\n`;
      fd = openSync(
        this.file,
        // oxlint-disable-next-line no-bitwise -- POSIX open flags must combine append and no-symlink protections.
        constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW
      );
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size + Buffer.byteLength(line) > maxBytes ||
        Buffer.byteLength(line) > maxLine
      ) {
        throw new Error("Progress channel unavailable");
      }
      writeSync(fd, line);
    } catch {
      this.broken = true;
      clearInterval(this.timer);
      this.timer = undefined;
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          this.broken = true;
          clearInterval(this.timer);
          this.timer = undefined;
        }
      }
    }
  }
}

const failureStatus = (
  error: unknown
): "failed" | "interrupted" | "timedout" => {
  try {
    if (!record(error)) {
      return "failed";
    }
    const metadata: unknown = Reflect.get(
      error,
      Symbol.for("efcc.safe-command-failure")
    );
    if (record(metadata) && metadata.outcome === "timeout") {
      return "timedout";
    }
    if (
      error.name === "AbortError" ||
      (record(metadata) &&
        (metadata.signal === "SIGINT" || metadata.signal === "SIGTERM"))
    ) {
      return "interrupted";
    }
  } catch {
    // Exception getters are untrusted; neither inspect messages nor replace the error.
  }
  return "failed";
};

/** Informational only: command outcomes and final JSON receipts remain authoritative. */
export const runWithProgress = async <T>(
  stage: string,
  env: Record<string, string | undefined>,
  work: (childEnv: Record<string, string | undefined>) => T | Promise<T>,
  options?: { nativeProjects?: Record<string, number> }
): Promise<T> => {
  if (!Object.hasOwn(stages, stage)) {
    throw new Error("Unknown progress stage");
  }
  const totals = options?.nativeProjects;
  if (
    totals &&
    (stage !== "native" ||
      !Object.keys(totals).length ||
      Object.entries(totals).some(
        ([name, total]) => !nativeProjects.includes(name) || !integer(total)
      ) ||
      Object.values(totals).reduce((sum, total) => sum + total, 0) > maxCases)
  ) {
    throw new Error("Invalid progress project totals");
  }
  const expectsReporter = ["fast", "unit", "coverage", "native"].includes(
    stage
  );
  const expected = stage === "native" ? Object.keys(totals ?? {}) : ["unit"];
  const started = Date.now();
  let elapsed = 0;
  let root: string | undefined;
  let fd: number | undefined;
  let offset = 0;
  let partial = "";
  let lastSeq = 0;
  let lastEvent = started;
  let ended = false;
  let invalid = false;
  let counts: Counts[] = [];
  let lastPrinted = "";
  let lastPrint = started;
  // Bootstrap/build intentionally mutate this shared environment for later stages.
  const hadProgressFile = Object.hasOwn(env, "EFCC_PROGRESS_FILE");
  const previousProgressFile = env.EFCC_PROGRESS_FILE;
  env.EFCC_PROGRESS_FILE = undefined;
  try {
    root = mkdtempSync(path.join(tmpdir(), "efcc-progress-"));
    env.EFCC_PROGRESS_FILE = path.join(root, "events");
    fd = openSync(env.EFCC_PROGRESS_FILE, "wx+", 0o600);
  } catch {
    invalid = true;
    env.EFCC_PROGRESS_FILE = undefined;
  }

  const readEvents = () => {
    if (fd === undefined || invalid) {
      return;
    }
    try {
      const { size } = fstatSync(fd);
      if (size > maxBytes || size < offset) {
        throw new Error("Invalid progress size");
      }
      if (size === offset) {
        return;
      }
      // ponytail: bounded per-scope journal; no persistence, rotation or telemetry service.
      const bytes = Buffer.alloc(size - offset);
      const length = readSync(fd, bytes, 0, bytes.length, offset);
      offset += length;
      partial += bytes.toString("utf-8", 0, length);
      let newline: number;
      while ((newline = partial.indexOf("\n")) >= 0) {
        if (ended) {
          throw new Error("Progress event after terminal status");
        }
        const event = parseEvent(partial.slice(0, newline), lastSeq);
        partial = partial.slice(newline + 1);
        counts = parseCounts(event.projects, expected, counts, totals);
        lastSeq = event.seq;
        lastEvent = Date.now();
        ended = event.kind === "finished";
      }
      if (Buffer.byteLength(partial) > maxLine) {
        throw new Error("Invalid progress size");
      }
    } catch {
      invalid = true;
    }
  };
  const health = (terminal: boolean): string => {
    if (!expectsReporter) {
      return "not-applicable";
    }
    if (invalid || !lastSeq) {
      return "unavailable";
    }
    if (!ended && Date.now() - lastEvent >= heartbeatMs) {
      return "stale";
    }
    if (terminal && (!ended || partial.length > 0)) {
      return "unavailable";
    }
    return "available";
  };
  const print = (status: string, terminal = false) => {
    readEvents();
    elapsed = Math.max(elapsed, Date.now() - started);
    const availability = health(terminal);
    let numeric = "";
    if (expectsReporter && counts.length > 0 && availability === "available") {
      numeric = ` completed=${counts.reduce((sum, entry) => sum + entry.completed, 0)}`;
      if (totals) {
        numeric += ` total=${Object.values(totals).reduce((sum, total) => sum + total, 0)}`;
      }
      numeric += ` failed=${counts.reduce((sum, entry) => sum + entry.failed, 0)}`;
      if (totals) {
        numeric += ` projects=${counts.map((entry) => `${entry.project}:${entry.completed}/${totals[entry.project]}:${entry.failed}`).join(",")}`;
      }
    }
    const content = `EFCC progress stage=${stage} status=${status} progress=${availability}${numeric}`;
    if (
      !terminal &&
      status === "running" &&
      content === lastPrinted &&
      Date.now() - lastPrint < heartbeatMs
    ) {
      return;
    }
    try {
      process.stdout.write(`${content} elapsedMs=${Math.trunc(elapsed)}\n`);
    } catch {
      // Progress output must not replace the command's outcome.
    }
    lastPrinted = content;
    lastPrint = Date.now();
  };
  print("started");
  const timer = setInterval(() => print("running"), updateMs);
  timer.unref();
  let outcome: { value: T } | { error: unknown };
  let cleanupFailed = false;
  try {
    outcome = { value: await work(env) };
    print("command-passed", true);
  } catch (error) {
    outcome = { error };
    print(failureStatus(error), true);
  } finally {
    clearInterval(timer);
    if (hadProgressFile) {
      env.EFCC_PROGRESS_FILE = previousProgressFile;
    } else {
      delete env.EFCC_PROGRESS_FILE;
    }
    try {
      if (fd !== undefined) {
        closeSync(fd);
      }
    } catch {
      cleanupFailed = true;
    }
    try {
      if (root) {
        rmSync(root, { force: true, recursive: true });
      }
    } catch {
      cleanupFailed = true;
    }
  }
  if ("error" in outcome) {
    throw outcome.error;
  }
  if (cleanupFailed) {
    throw new Error("Private progress cleanup failed");
  }
  return outcome.value;
};
