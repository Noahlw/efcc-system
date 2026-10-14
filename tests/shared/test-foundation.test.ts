import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNativeExecution,
  discoverNative,
  nativeCases,
  parseGateOptions,
} from "../../scripts/test-runner";
import {
  assertNativeClassification,
  selectTests,
} from "../../scripts/test-selection";
import * as snapshot from "../../scripts/test-snapshot";

const repository = path.resolve(import.meta.dirname, "../..");
const owned: string[] = [];
const sourcePath = "tests/shared/application-contract.test.ts";
const green = 'import assert from "node:assert/strict";\nassert.equal(1, 1);\n';
const red = 'import assert from "node:assert/strict";\nassert.equal(1, 2);\n';
const { assertIndexUnchanged, assertSourcePrivacy, indexIdentity } = snapshot;
// Fixtures are foreign repositories: never borrow the invoking hook's Git context.
const fixtureGitEnvironment: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("GIT_") && typeof value === "string") {
    fixtureGitEnvironment[key] = value;
  }
}
const git = (root: string, args: string[], env = fixtureGitEnvironment) =>
  snapshot.git(root, args, env);

const fixture = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "efcc-gate-regression-"));
  owned.push(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Synthetic Gate"]);
  git(root, ["config", "user.email", "gate@example.test"]);
  const put = (name: string, value: string | Buffer) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), value);
  };
  // These are the REAL implementation and pinned locked toolchain, never a fake selection/runner.
  for (const name of [
    "scripts/test-runner.ts",
    "scripts/test-snapshot.ts",
    "scripts/test-selection.ts",
    "pnpm-lock.yaml",
    "oxlint.config.ts",
    "oxfmt.config.ts",
    "tsconfig.json",
    ".lintstagedrc.json",
  ]) {
    if (!existsSync(path.join(repository, name))) {
      throw new Error(`N16 integration dependency missing: ${name}`);
    }
    put(name, readFileSync(path.join(repository, name)));
  }
  const manifest = JSON.parse(
    readFileSync(path.join(repository, "package.json"), "utf-8")
  );
  manifest.scripts = {
    check: `node --check ${sourcePath}`,
    test: `node ${sourcePath}`,
    typecheck: `node --check ${sourcePath}`,
  };
  put("package.json", JSON.stringify(manifest));
  put(".gitignore", "node_modules/\n");
  put(sourcePath, green);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "test: synthetic gate baseline"]);
  return root;
};

const commandWithEnvironment = (
  root: string,
  env: Record<string, string | undefined>,
  args: string[]
) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/test-runner.ts", ...args],
    {
      cwd: root,
      encoding: "utf-8",
      env: env as NodeJS.ProcessEnv,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 180_000,
    }
  );
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout}\n${result.stderr}`;
  const dispositions = output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('{"disposedSource":'));
  expect(dispositions.length).toBeGreaterThan(0);
  for (const line of dispositions) {
    const metadata: unknown = JSON.parse(line);
    if (
      !metadata ||
      typeof metadata !== "object" ||
      !("disposedSource" in metadata) ||
      !("privateEvidence" in metadata) ||
      typeof metadata.disposedSource !== "string" ||
      typeof metadata.privateEvidence !== "string"
    ) {
      throw new Error("Invalid native source disposition");
    }
    expect(path.basename(metadata.disposedSource)).toMatch(
      /^efcc-gate-source-/u
    );
    expect(existsSync(metadata.disposedSource)).toBe(false);
    expect(path.basename(metadata.privateEvidence)).toMatch(
      /^efcc-gate-evidence-/u
    );
    owned.push(metadata.privateEvidence);
  }
  return { output, status: result.status };
};
const command = (root: string, ...args: string[]) =>
  commandWithEnvironment(root, fixtureGitEnvironment, args);

const waitForFile = (file: string) => {
  const { promise, resolve, reject } = Promise.withResolvers<null>();
  const watcher = watch(path.dirname(file), (_event, name) => {
    if (name?.toString() === path.basename(file) || existsSync(file)) {
      watcher.close();
      resolve(null);
    }
  });
  watcher.once("error", (error) => {
    watcher.close();
    reject(error);
  });
  if (existsSync(file)) {
    watcher.close();
    resolve(null);
  }
  return { promise, watcher };
};
const processExists = (pid: number) => {
  try {
    process.kill(pid, 0);
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
};

afterEach(() => {
  for (const root of owned.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});
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

describe("native source snapshots", () => {
  it("runs staged red despite unstaged green, while working export sees green and preserves both", () => {
    const root = fixture();
    writeFileSync(path.join(root, sourcePath), red);
    git(root, ["add", sourcePath]);
    writeFileSync(path.join(root, sourcePath), green);
    const before = indexIdentity(root, fixtureGitEnvironment);
    const result = command(root, "staged");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Native locked bootstrap");
    expect(result.output).toContain("AssertionError");
    expect(indexIdentity(root, fixtureGitEnvironment)).toBe(before);
    expect(readFileSync(path.join(root, sourcePath), "utf-8")).toBe(green);
    const affected = command(root, "affected", "--base", "main");
    expect(affected.status).toBe(0);
    expect(affected.output).toContain(sourcePath);
    expect(indexIdentity(root, fixtureGitEnvironment)).toBe(before);
  }, 240_000);

  it("qualifies Git's native hook index instead of a different ordinary index", () => {
    const root = fixture();
    const ordinary = indexIdentity(root, fixtureGitEnvironment);
    const hookEnvironment = {
      ...fixtureGitEnvironment,
      GIT_INDEX_FILE: path.join(root, "hook-index"),
    };
    git(root, ["read-tree", "HEAD"], hookEnvironment);
    writeFileSync(path.join(root, sourcePath), red);
    git(root, ["add", sourcePath], hookEnvironment);
    writeFileSync(path.join(root, sourcePath), green);
    const hookIdentity = indexIdentity(root, hookEnvironment);
    const result = commandWithEnvironment(root, hookEnvironment, ["staged"]);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("AssertionError");
    expect(indexIdentity(root, fixtureGitEnvironment)).toBe(ordinary);
    expect(indexIdentity(root, hookEnvironment)).toBe(hookIdentity);
    expect(readFileSync(path.join(root, sourcePath), "utf-8")).toBe(green);
  }, 240_000);

  it("native lint-staged formats indexed hunks using indexed config without staging the unstaged hunk", () => {
    const root = fixture();
    const baseline =
      "export const first = 1;\n\n// Separate hunks preserve the developer edit.\n\nexport const second = 2;\n";
    writeFileSync(path.join(root, sourcePath), baseline);
    git(root, ["add", sourcePath]);
    git(root, ["commit", "-m", "test: separated synthetic hunks"]);
    writeFileSync(
      path.join(root, sourcePath),
      baseline.replace("first = 1", "first=3")
    );
    git(root, ["add", sourcePath]);
    writeFileSync(
      path.join(root, sourcePath),
      readFileSync(path.join(root, sourcePath), "utf-8").replace(
        "second = 2",
        "second = 4"
      )
    );
    // Unstaged formatter policy is deliberately invalid; only indexed policy may load.
    writeFileSync(
      path.join(root, "oxfmt.config.ts"),
      "throw new Error('unstaged-formatter-policy');\n"
    );
    const result = command(root, "staged", "--format");
    expect(result.status).toBe(0);
    const staged = git(root, ["show", `:${sourcePath}`]).toString();
    expect(staged).toContain("first = 3");
    expect(staged).toContain("second = 2");
    expect(readFileSync(path.join(root, sourcePath), "utf-8")).toContain(
      "second = 4"
    );
    expect(readFileSync(path.join(root, "oxfmt.config.ts"), "utf-8")).toContain(
      "unstaged-formatter-policy"
    );
    expect(git(root, ["stash", "list"]).toString()).toBe("");
  }, 240_000);

  it("blocks staged scripts and lockfile failures instead of borrowing unstaged repairs", () => {
    const root = fixture();
    const original = readFileSync(path.join(root, "package.json"), "utf-8");
    const manifest = JSON.parse(original);
    manifest.scripts.check = "node -e 'process.exit(17)'";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    git(root, ["add", "package.json"]);
    writeFileSync(path.join(root, "package.json"), original);
    const scriptResult = command(root, "staged");
    expect(scriptResult.status).not.toBe(0);
    expect(scriptResult.output).toContain(
      "Required command failed: pnpm run check"
    );
    git(root, ["restore", "--staged", "package.json"]);
    const lock = readFileSync(path.join(root, "pnpm-lock.yaml"));
    writeFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '0.0'\n"
    );
    git(root, ["add", "pnpm-lock.yaml"]);
    writeFileSync(path.join(root, "pnpm-lock.yaml"), lock);
    const lockResult = command(root, "staged");
    expect(lockResult.status).not.toBe(0);
    expect(lockResult.output).toContain(
      "Required command failed: pnpm install --frozen-lockfile --prefer-offline"
    );
    expect(readFileSync(path.join(root, "pnpm-lock.yaml"))).toEqual(lock);
  }, 240_000);

  it("uses staged .npmrc and fails real install scripts without reading unstaged registry policy", () => {
    const root = fixture();
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.scripts.prepare =
      "pnpm config get registry && node -e 'process.exit(19)'";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(
      path.join(root, ".npmrc"),
      "registry=https://registry.npmjs.org/\n"
    );
    git(root, ["add", "package.json", ".npmrc"]);
    delete manifest.scripts.prepare;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(
      path.join(root, ".npmrc"),
      "registry=https://unstaged-registry.invalid/\n"
    );
    const identity = indexIdentity(root, fixtureGitEnvironment);
    const result = command(root, "staged");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("https://registry.npmjs.org/");
    expect(result.output).not.toContain("https://unstaged-registry.invalid/");
    expect(result.output).toContain(
      "Required command failed: pnpm install --frozen-lockfile --prefer-offline"
    );
    expect(indexIdentity(root, fixtureGitEnvironment)).toBe(identity);
  }, 240_000);

  it.each(["ignore-scripts", "offline"])(
    "blocks indexed %s policy rather than silently weakening bootstrap",
    (key: string) => {
      const root = fixture();
      writeFileSync(path.join(root, ".npmrc"), `${key}=true\n`);
      git(root, ["add", ".npmrc"]);
      writeFileSync(path.join(root, ".npmrc"), `${key}=false\n`);
      const identity = indexIdentity(root, fixtureGitEnvironment);
      const result = command(root, "staged");
      expect(result.status).not.toBe(0);
      expect(result.output).not.toContain("Native locked bootstrap");
      expect(indexIdentity(root, fixtureGitEnvironment)).toBe(identity);
      expect(readFileSync(path.join(root, ".npmrc"), "utf-8")).toBe(
        `${key}=false\n`
      );
    }
  );

  it("blocks unknown rename targets before execution rather than automatically qualifying everything", () => {
    const root = fixture();
    git(root, ["mv", sourcePath, "unmapped-change.xyz"]);
    const result = command(root, "staged");
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain("Native locked bootstrap");
  });

  it("blocks actual index drift caused during a required indexed command without reverting the new index", () => {
    const root = fixture();
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    const program = `require("node:fs").appendFileSync(${JSON.stringify(path.join(root, sourcePath))}, "\\n// concurrent-stage-change\\n"); require("node:child_process").execFileSync("git", ["-C", ${JSON.stringify(root)}, "add", ${JSON.stringify(sourcePath)}]);`;
    manifest.scripts.check = `node -e ${JSON.stringify(program)}`;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    git(root, ["add", "package.json"]);
    const identity = indexIdentity(root, fixtureGitEnvironment);
    const result = command(root, "staged");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Git index drifted");
    expect(indexIdentity(root, fixtureGitEnvironment)).not.toBe(identity);
    expect(git(root, ["show", `:${sourcePath}`]).toString()).toContain(
      "concurrent-stage-change"
    );
  }, 240_000);

  it("blocks unavailable indexed toolchain prerequisites before dependency execution", () => {
    const root = fixture();
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.engines.node = "99.0.0";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    git(root, ["add", "package.json"]);
    const result = command(root, "staged");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      "Required indexed Node/pnpm toolchain is unavailable"
    );
    expect(result.output).not.toContain("Native locked bootstrap");
  });

  it.each(["scripts/test-selection.ts", "scripts/test-runner.ts"])(
    "loads indexed %s instead of an unstaged policy/script repair",
    (name: string) => {
      const root = fixture();
      const original = readFileSync(path.join(root, name), "utf-8");
      writeFileSync(
        path.join(root, name),
        `${original}\nthrow new Error("synthetic-indexed-policy-red");\n`
      );
      git(root, ["add", name]);
      writeFileSync(path.join(root, name), original);
      const identity = indexIdentity(root, fixtureGitEnvironment);
      const result = command(root, "staged");
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("synthetic-indexed-policy-red");
      expect(result.output).not.toContain("Native locked bootstrap");
      expect(indexIdentity(root, fixtureGitEnvironment)).toBe(identity);
      expect(readFileSync(path.join(root, name), "utf-8")).toBe(original);
    }
  );

  it("blocks a missing real selection integration dependency rather than installing a stub or full fallback", () => {
    const root = fixture();
    git(root, ["rm", "scripts/test-selection.ts"]);
    const result = command(root, "staged", "--full");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      "N16 integration dependency missing: authoritative scripts/test-selection.ts"
    );
    expect(result.output).not.toContain("Native locked bootstrap");
  });

  it("exports rename/delete without borrowing unstaged restored files and reports index drift", () => {
    const root = fixture();
    const identity = indexIdentity(root, fixtureGitEnvironment);
    git(root, ["mv", sourcePath, "tests/shared/renamed.test.ts"]);
    writeFileSync(path.join(root, sourcePath), green);
    expect(() =>
      assertIndexUnchanged(root, identity, fixtureGitEnvironment)
    ).toThrow(/drift/iu);
    expect(
      git(root, ["show", ":tests/shared/renamed.test.ts"]).toString()
    ).toBe(green);
    const renamed = command(root, "staged", "--full");
    expect(renamed.status).not.toBe(0);
    expect(renamed.output).toContain("Required command failed: pnpm run check");
    expect(readFileSync(path.join(root, sourcePath), "utf-8")).toBe(green);
    // The renamed fixture is newly staged relative to HEAD; remove only this owned fixture.
    git(root, ["rm", "-f", "tests/shared/renamed.test.ts"]);
    const deleted = command(root, "staged");
    expect(deleted.status).not.toBe(0);
    expect(deleted.output).toContain("Required command failed: pnpm run check");
    expect(readFileSync(path.join(root, sourcePath), "utf-8")).toBe(green);
  }, 240_000);

  it("blocks native indexed symlinks before checkout or dependency execution", () => {
    const root = fixture();
    writeFileSync(path.join(root, "pointer"), "../private");
    const hash = git(root, ["hash-object", "-w", "pointer"]).toString().trim();
    git(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${hash},docs/private-link`,
    ]);
    const identity = indexIdentity(root, fixtureGitEnvironment);
    const result = command(root, "staged", "--full");
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain("Native locked bootstrap");
    expect(indexIdentity(root, fixtureGitEnvironment)).toBe(identity);
  });

  it.each([
    ["arbitrary.txt", '{"cookies":[],"origins":[]}'],
    ["innocent.bin", "SQLite format 3\0private synthetic bytes"],
    [
      "members.data",
      '{"records":[{"fullName":"Synthetic Person","email":"synthetic@example.test"}]}',
    ],
    ["test-results/raw.txt", "synthetic diagnostic"],
    [".scratch/native-state/arbitrary.data", "synthetic diagnostic"],
    ["playwright/.auth/arbitrary.data", "synthetic diagnostic"],
    [".dev.vars", "BETTER_AUTH_SECRET=synthetic-private-value"],
    [".env.example", "TOKEN=not-a-placeholder"],
    ["random.data", '{"token":"synthetic-private-value","userId":"synthetic"}'],
    ["random-report.txt", '{"suites":[],"stats":{},"config":{}}'],
    [
      "ordinary.csv",
      "fullName,email\nSynthetic Person,synthetic@example.test\n",
    ],
    ["innocent.archive", "PK\u0003\u0004synthetic trace"],
    [
      "docs/private-data.md",
      '\uFEFF/* synthetic comment */\n{"cookies":[],"origins":[],}',
    ],
  ])(
    "blocks private staged content %s before bootstrap, including explicit full",
    (name: string, value: string) => {
      const root = fixture();
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), value);
      git(root, ["add", name]);
      const result = command(root, "staged", "--full");
      expect(result.status).not.toBe(0);
      expect(result.output).not.toContain("Native locked bootstrap");
      expect(result.output).not.toContain("synthetic-private-value");
      expect(readFileSync(path.join(root, name), "utf-8")).toBe(value);
    }
  );
  it("kills a listener left behind when an owned CLI exits on SIGINT", async () => {
    const root = fixture();
    const marker = path.join(root, "native-listener.json");
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.scripts.check = `node ${sourcePath} ${JSON.stringify(marker)}`;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    const source = `
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv[2] === "listener") {
  process.on("SIGINT", () => {});
  const server = createServer((_request, response) => response.end("alive"));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    process.stdout.write(
      JSON.stringify({ pid: process.pid, port: address.port }) + "\\n"
    );
  });
} else {
  process.on("SIGINT", () => process.exit(0));
  const listener = spawn(
    process.execPath,
    [process.argv[1], "listener"],
    { stdio: ["ignore", "pipe", "inherit"] }
  );
  if (!listener.stdout) throw new Error("Listener fixture has no stdout");
  const lines = createInterface({ input: listener.stdout });
  const [line] = await Promise.race([
    once(lines, "line"),
    once(listener, "exit").then(([code, signal]) => {
      throw new Error(\`Listener exited before readiness: \${code}/\${signal}\`);
    }),
  ]);
  lines.close();
  const owned = JSON.parse(String(line)) as { pid: number; port: number };
  writeFileSync(
    process.argv[2],
    JSON.stringify({ ...owned, launcherPid: process.pid })
  );
  await Promise.withResolvers<null>().promise;
}
`;
    writeFileSync(path.join(root, sourcePath), source);
    git(root, ["add", "package.json", sourcePath]);
    const identity = indexIdentity(root, fixtureGitEnvironment);
    const gate = spawn(process.execPath, ["scripts/test-runner.ts", "staged"], {
      cwd: root,
      env: fixtureGitEnvironment as NodeJS.ProcessEnv,
      killSignal: "SIGINT",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });
    let output = "";
    gate.stdout?.setEncoding("utf-8");
    gate.stderr?.setEncoding("utf-8");
    gate.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    gate.stderr?.on("data", (chunk: string) => {
      output += chunk;
    });
    const completion = once(gate, "close");
    let ownedPids: number[] = [];
    try {
      const readiness = waitForFile(marker);
      try {
        await Promise.race([
          readiness.promise,
          completion.then(() => {
            throw new Error(
              `The native gate exited before its listener started:\n${output}`
            );
          }),
        ]);
      } finally {
        readiness.watcher.close();
      }
      const observed = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
        launcherPid: number;
      };
      ownedPids = [observed.launcherPid, observed.pid];
      expect(
        await fetch(`http://127.0.0.1:${observed.port}`).then((response) =>
          response.text()
        )
      ).toBe("alive");
      expect(gate.kill("SIGINT")).toBe(true);
      const [status] = await completion;
      const disposition = output
        .split(/\r?\n/u)
        .find((line) => line.startsWith('{"disposedSource":'));
      if (!disposition) {
        throw new Error("Missing native source disposition");
      }
      const metadata = JSON.parse(disposition) as {
        disposedSource?: unknown;
        privateEvidence?: unknown;
      };
      if (
        typeof metadata.disposedSource !== "string" ||
        typeof metadata.privateEvidence !== "string"
      ) {
        throw new TypeError("Invalid native source disposition");
      }
      const listenerAfter = await fetch(`http://127.0.0.1:${observed.port}`)
        .then((response) => response.text())
        .catch(() => null);
      const result = {
        evidenceIsPrivate:
          path
            .basename(metadata.privateEvidence)
            .startsWith("efcc-gate-evidence-") &&
          statSync(metadata.privateEvidence).mode.toString(8).endsWith("700"),
        indexUnchanged: indexIdentity(root, fixtureGitEnvironment) === identity,
        listenerAfter,
        liveOwnedPids: ownedPids.filter(processExists),
        noFabricatedSuccess: !output.includes('"nativeExecution":'),
        requiredCommandFailed: output.includes(
          "Required command failed: pnpm run check"
        ),
        sourceDisposed: !existsSync(metadata.disposedSource),
        status,
      };
      expect(result).toEqual({
        evidenceIsPrivate: true,
        indexUnchanged: true,
        listenerAfter: null,
        liveOwnedPids: [],
        noFabricatedSuccess: true,
        requiredCommandFailed: true,
        sourceDisposed: true,
        status: 130,
      });
      owned.push(metadata.privateEvidence);
    } finally {
      if (gate.exitCode === null && gate.signalCode === null) {
        gate.kill("SIGINT");
        await completion;
      }
      for (const pid of ownedPids) {
        if (processExists(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
    }
  }, 240_000);
  it("cleans the formatter subprocess group on staged --format interruption", async () => {
    const root = fixture();
    const marker = path.join(root, "native-formatter.json");
    const exitMarker = path.join(root, "native-formatter-exit");
    const preload = path.join(root, "native-formatter-preload.mjs");
    const logPath = path.join(root, "native-formatter-output.txt");
    const preloadSource = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

if (/(?:^|\\/)oxlint\\/bin\\/oxlint$/u.test(process.argv[1] ?? "")) {
  process.on("SIGINT", () => {});
  const marker = ${JSON.stringify(marker)};
  const exitMarker = ${JSON.stringify(exitMarker)};
  const server = createServer((request, response) => {
    if (request.url === "/shutdown") {
      response.end("stopping", () => server.close(() => process.exit(0)));
      return;
    }
    response.end("formatter alive");
  });
  process.on("exit", () => writeFileSync(exitMarker, "closed"));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No formatter listener");
    writeFileSync(
      marker,
      JSON.stringify({ pid: process.pid, port: address.port, argv: process.argv })
    );
  });
}
`;
    writeFileSync(preload, preloadSource);
    writeFileSync(
      path.join(root, ".npmrc"),
      `node-options=--import=${preload}\n`
    );
    writeFileSync(
      path.join(root, sourcePath),
      `${green}export const formatProbe = "synthetic";\n`
    );
    git(root, ["add", ".npmrc", sourcePath]);
    const identity = indexIdentity(root, fixtureGitEnvironment);
    const log = openSync(logPath, "w");
    const gate = spawn(
      process.execPath,
      ["scripts/test-runner.ts", "staged", "--format"],
      {
        cwd: root,
        env: fixtureGitEnvironment as NodeJS.ProcessEnv,
        killSignal: "SIGINT",
        stdio: ["ignore", log, log],
        timeout: 180_000,
      }
    );
    closeSync(log);
    const exited = once(gate, "exit");
    const completion = once(gate, "close");
    let formatter: { pid: number; port: number; argv: string[] } | undefined;
    try {
      const readiness = waitForFile(marker);
      try {
        await Promise.race([
          readiness.promise,
          exited.then(([status, signal]) => {
            const diagnosticOutput = readFileSync(logPath, "utf-8")
              .split(/\r?\n/u)
              .slice(-30)
              .join("\n");
            throw new Error(
              `The staged format gate exited before the real formatter started (${status}, ${signal}):\n${diagnosticOutput}`
            );
          }),
        ]);
      } finally {
        readiness.watcher.close();
      }
      formatter = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
        argv: string[];
      };
      expect(formatter.argv.join(" ")).toMatch(/oxlint\/bin\/oxlint/u);
      const url = `http://127.0.0.1:${formatter.port}`;
      expect(
        await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
          (response) => response.text()
        )
      ).toBe("formatter alive");
      expect(process.kill(formatter.pid, "SIGSTOP")).toBe(true);
      expect(gate.kill("SIGINT")).toBe(true);
      const [status] = await exited;
      const output = readFileSync(logPath, "utf-8");
      const disposition = output
        .split(/\r?\n/u)
        .find((line) => line.startsWith('{"disposedSource":'));
      if (!disposition) {
        throw new Error("Missing staged format source disposition");
      }
      const metadata = JSON.parse(disposition) as {
        disposedSource?: unknown;
        privateEvidence?: unknown;
      };
      if (
        typeof metadata.disposedSource !== "string" ||
        typeof metadata.privateEvidence !== "string"
      ) {
        throw new TypeError("Invalid staged format source disposition");
      }
      owned.push(metadata.privateEvidence);
      const formatterAlive = processExists(formatter.pid);
      if (formatterAlive) {
        process.kill(formatter.pid, "SIGCONT");
      }
      const listenerAfter = await fetch(url, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => response.text())
        .catch(() => null);
      expect({
        evidenceIsPrivate:
          path
            .basename(metadata.privateEvidence)
            .startsWith("efcc-gate-evidence-") &&
          statSync(metadata.privateEvidence).mode.toString(8).endsWith("700"),
        formatterAlive: processExists(formatter.pid),
        indexUnchanged: indexIdentity(root, fixtureGitEnvironment) === identity,
        listenerAfter,
        noFabricatedSuccess: !output.includes('"nativeExecution":'),
        requiredCommandFailed: output.includes(
          "Required command failed: pnpm exec lint-staged"
        ),
        sourceDisposed: !existsSync(metadata.disposedSource),
        status,
      }).toEqual({
        evidenceIsPrivate: true,
        formatterAlive: false,
        indexUnchanged: true,
        listenerAfter: null,
        noFabricatedSuccess: true,
        requiredCommandFailed: true,
        sourceDisposed: true,
        status: 130,
      });
    } finally {
      if (gate.exitCode === null && gate.signalCode === null) {
        gate.kill("SIGINT");
        await exited;
      }
      await completion;
      if (formatter && processExists(formatter.pid)) {
        process.kill(formatter.pid, "SIGCONT");
        const url = `http://127.0.0.1:${formatter.port}`;
        const alive = await fetch(url, {
          signal: AbortSignal.timeout(2000),
        })
          .then((response) => response.text())
          .catch(() => null);
        if (alive === "formatter alive") {
          const stopped = waitForFile(exitMarker);
          try {
            const shutdown = await fetch(`${url}/shutdown`, {
              method: "POST",
              signal: AbortSignal.timeout(2000),
            }).catch(() => null);
            if (shutdown) {
              await stopped.promise;
            } else if (processExists(formatter.pid)) {
              process.kill(formatter.pid, "SIGKILL");
            }
          } finally {
            stopped.watcher.close();
          }
        } else if (processExists(formatter.pid)) {
          process.kill(formatter.pid, "SIGKILL");
        }
      }
    }
  }, 240_000);
});

describe("privacy and native reporting boundaries", () => {
  it("allows immutable TS scenarios, public design documents and actual variable placeholders", () => {
    expect(() =>
      assertSourcePrivacy(
        "tests/scenarios/accounts.ts",
        Buffer.from(
          'export const account = { password: "Synthetic-password!" };'
        )
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        "docs/design/book.html",
        Buffer.from("<!doctype html><h1>Public Design Book</h1>")
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        ".dev.vars.example",
        Buffer.from(
          "SECRET=replace-with-local-secret\nORIGIN=http://localhost:5199\n"
        )
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        "wrangler.jsonc",
        readFileSync(path.join(repository, "wrangler.jsonc"))
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        "migrations/meta/0009_snapshot.json",
        readFileSync(
          path.join(repository, "migrations/meta/0009_snapshot.json")
        )
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        "schema.json",
        Buffer.from(
          '{"columns":{"token":{"type":"text"},"userId":{"type":"text"},"email":{"type":"text"},"fullName":{"type":"text"}}}'
        )
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        "public.jsonc",
        Buffer.from(
          '/* source */ {"url":"https://example.test/a//b","label":",}",}'
        )
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        "docs/link.md",
        Buffer.from("[Public link](https://example.test/)")
      )
    ).not.toThrow();
    expect(() =>
      assertSourcePrivacy(
        ".npmrc",
        Buffer.from(
          "//registry.example.test/:_authToken=synthetic-private-value"
        )
      )
    ).toThrow();
    expect(() =>
      assertSourcePrivacy("docs/link", Buffer.from("../private"), "120000")
    ).toThrow();
    expect(() =>
      assertSourcePrivacy("../escape", Buffer.from("safe"))
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
    const spec = path.join(root, "reporting.spec.ts");
    const config = path.join(root, "reporting.config.ts");
    const output = path.join(root, "native-results.json");
    writeFileSync(
      config,
      'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: ".", testMatch: "reporting.spec.ts", retries: 0, projects: [{ name: "native-http" }], reporter: [["json"]] });\n'
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
    owned.push(evidence);
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
