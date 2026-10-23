import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { onTestFinished, describe, expect, it } from "vitest";

import * as snapshot from "../../../scripts/test-snapshot";
import {
  sourcePath,
  green,
  fixtureEnvironment,
  fixtureGitEnvironment,
  git,
  fixture,
  command,
  commandWithEnvironment,
} from "./fixtures";

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
const { indexIdentity } = snapshot;
describe("owned process lifecycle", () => {
  it("skips CI browser installation for a fast-only documentation selection", () => {
    const root = fixture();
    const fakeBin = path.join(root, "fake-bin");
    const calls = path.join(root, "pnpm-calls.txt");
    mkdirSync(fakeBin);
    const gitExecutable = fixtureGitEnvironment.PATH?.split(path.delimiter)
      .map((directory) => path.join(directory, "git"))
      .find(existsSync);
    if (!gitExecutable) {
      throw new Error("Could not locate git for the CI setup fixture");
    }
    symlinkSync(gitExecutable, path.join(fakeBin, "git"));
    writeFileSync(
      path.join(fakeBin, "pnpm"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nif [ "$1" = "--version" ]; then printf '10.33.2\\n'; elif [ "$1" = "config" ]; then printf 'false\\n'; fi\nexit 0\n`,
      { mode: 0o755 }
    );

    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.scripts["test:coverage"] =
      "vitest run --config vitest.coverage.config.ts";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-m", "test: fixture CI coverage script"]);
    mkdirSync(path.join(root, "docs"));
    writeFileSync(
      path.join(root, "docs/testing.md"),
      "# Synthetic documentation-only change\n"
    );
    git(root, ["add", "docs/testing.md"]);

    const result = spawnSync(
      process.execPath,
      ["scripts/test-runner.ts", "staged"],
      {
        cwd: root,
        encoding: "utf-8",
        env: fixtureEnvironment(root, {
          ...fixtureGitEnvironment,
          CI: "true",
          GITHUB_ACTIONS: "true",
          PATH: fakeBin,
        }) as unknown as NodeJS.ProcessEnv,
        timeout: 60_000,
      }
    );
    if (result.error) {
      throw result.error;
    }
    const callsMade = readFileSync(calls, "utf-8");
    const output = `${result.stdout}\n${result.stderr}`;
    expect({
      didInstallBrowsers: callsMade.includes("exec playwright install"),
      didRunCoverageUnitCommand: callsMade.includes("run test:coverage"),
      didRunQualityCommands:
        callsMade.includes("run check") && callsMade.includes("run typecheck"),
      expectedMissingIdentityFailure: output.includes(
        "failed during unit tests; command output is suppressed"
      ),
      status: result.status,
    }).toEqual({
      didInstallBrowsers: false,
      didRunCoverageUnitCommand: true,
      didRunQualityCommands: true,
      expectedMissingIdentityFailure: true,
      status: 1,
    });
  }, 60_000);

  it("gives fixed source-mapping guidance without printing unknown paths in CI", () => {
    const root = fixture();
    const unknownPath = "do-not-print-this-unknown-path.md";
    writeFileSync(path.join(root, unknownPath), "synthetic unknown path\n");
    git(root, ["add", unknownPath]);

    const result = spawnSync(
      process.execPath,
      ["scripts/test-runner.ts", "staged"],
      {
        cwd: root,
        encoding: "utf-8",
        env: fixtureEnvironment(root, {
          ...fixtureGitEnvironment,
          CI: "true",
          GITHUB_ACTIONS: "true",
        }) as unknown as NodeJS.ProcessEnv,
        timeout: 60_000,
      }
    );
    if (result.error) {
      throw result.error;
    }
    const output = `${result.stdout}\n${result.stderr}`;
    expect({
      givesMappingGuidance: output.includes(
        "Add a source mapping in scripts/test-selection.ts or request explicit full qualification."
      ),
      printsUnknownPath: output.includes(unknownPath),
      reportsSelectionStage: output.includes(
        "failed during source selection; command output is suppressed"
      ),
      status: result.status,
    }).toEqual({
      givesMappingGuidance: true,
      printsUnknownPath: false,
      reportsSelectionStage: true,
      status: 1,
    });
  });

  it("returns success after an ordinary owned command group has exited", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, sourcePath),
      `${green}// ordinary owned command completion\n`
    );
    git(root, ["add", sourcePath]);
    const identity = indexIdentity(root, fixtureEnvironment(root));
    const result = command(root, "staged");
    expect({
      indexUnchanged:
        indexIdentity(root, fixtureEnvironment(root)) === identity,
      noNativeSelection: result.output.includes('"mobile":false'),
      status: result.status,
    }).toEqual({
      indexUnchanged: true,
      noNativeSelection: true,
      status: 0,
    });
  }, 240_000);

  it("reports an unavailable native command without probing or killing another process", async () => {
    const root = fixture();
    const emptyPath = path.join(root, "empty-path");
    mkdirSync(emptyPath);
    const gitExecutable = fixtureGitEnvironment.PATH?.split(path.delimiter)
      .map((directory) => path.join(directory, "git"))
      .find(existsSync);
    if (!gitExecutable) {
      throw new Error("Could not locate git for the missing-pnpm fixture");
    }
    symlinkSync(gitExecutable, path.join(emptyPath, "git"));
    writeFileSync(path.join(root, sourcePath), `${green}// missing command\n`);
    git(root, ["add", sourcePath]);
    const unrelated = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" }
    );
    await once(unrelated, "spawn");
    if (!unrelated.pid) {
      throw new Error("Could not start the unrelated process sentinel");
    }
    try {
      const result = commandWithEnvironment(
        root,
        { ...fixtureGitEnvironment, PATH: emptyPath },
        ["staged"]
      );

      expect({
        missingCommand: result.output.includes("Required command failed: pnpm"),
        status: result.status,
        unrelatedProcessAlive: processExists(unrelated.pid),
      }).toEqual({
        missingCommand: true,
        status: 1,
        unrelatedProcessAlive: true,
      });
    } finally {
      if (!unrelated.killed) {
        unrelated.kill("SIGTERM");
        await once(unrelated, "exit");
      }
    }
  }, 240_000);

  it("kills the owned command group when a native command times out", async () => {
    const root = fixture();
    const runnerPath = path.join(root, "scripts/test-runner.ts");
    const runner = readFileSync(runnerPath, "utf-8");
    const shortenedRunner = runner.replace(
      'await run("pnpm", ["run", script], source, env);',
      'await run("pnpm", ["run", script], source, env, false, script === "check" ? 1500 : 10_800_000);'
    );
    if (shortenedRunner === runner) {
      throw new Error("Could not target the synthetic check-command timeout");
    }
    writeFileSync(runnerPath, shortenedRunner);

    const marker = path.join(root, "timed-out-listener.json");
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.scripts.check = `node ${sourcePath} ${JSON.stringify(marker)}`;
    manifest.scripts.test = `node --check ${sourcePath}`;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    const source = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const server = createServer((_request, response) => response.end("owned timeout"));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, port: address.port }));
});
await new Promise(() => {});
`;
    writeFileSync(path.join(root, sourcePath), source);
    git(root, ["add", "package.json", sourcePath, "scripts/test-runner.ts"]);
    const identity = indexIdentity(root, fixtureEnvironment(root));
    let ownedPid: number | undefined;
    try {
      const result = command(root, "staged");
      if (!existsSync(marker)) {
        throw new Error(
          `The owned check did not start before the gate exited:\n${result.output}`
        );
      }
      const owned = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
      };
      ownedPid = owned.pid;
      const listenerAfter = await fetch(`http://127.0.0.1:${owned.port}`, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => response.text())
        .catch(() => null);
      expect({
        indexUnchanged:
          indexIdentity(root, fixtureEnvironment(root)) === identity,
        listenerAfter,
        status: result.status,
        timedOutAtOwnedCommand: result.output.includes(
          "Required command failed: pnpm run check (Required command timed out: pnpm)"
        ),
      }).toEqual({
        indexUnchanged: true,
        listenerAfter: null,
        status: 1,
        timedOutAtOwnedCommand: true,
      });
      expect(processExists(owned.pid)).toBe(false);
    } finally {
      if (ownedPid && processExists(ownedPid)) {
        process.kill(ownedPid, "SIGKILL");
      }
    }
  }, 240_000);

  it("waits after EPERM and only accepts ESRCH as owned-group absence", async () => {
    const root = fixture();
    const marker = path.join(root, "eperm-listener.json");
    const probes = path.join(root, "eperm-group-probe.txt");
    const preload = path.join(root, "owned-group-eperm.cjs");
    writeFileSync(
      preload,
      `const { appendFileSync, existsSync } = require("node:fs");
if (process.env.EFCC_GROUP_PROBE_MARKER && process.argv[1]?.endsWith("scripts/test-runner.ts")) {
  const nativeKill = process.kill.bind(process);
  let injected = false;
  process.kill = (pid, signal) => {
    if (!injected && pid < 0 && signal === 0 && existsSync(process.env.EFCC_GROUP_TARGET_FILE)) {
      injected = true;
      appendFileSync(process.env.EFCC_GROUP_PROBE_MARKER, String(pid));
      const error = new Error("Synthetic EPERM for the owned process group");
      error.code = "EPERM";
      throw error;
    }
    return nativeKill(pid, signal);
  };
}
`
    );
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.scripts.check = `node ${sourcePath} ${JSON.stringify(marker)}`;
    manifest.scripts.test = `node --check ${sourcePath}`;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    git(root, ["add", "package.json"]);
    git(root, ["commit", "--amend", "--no-edit"]);
    const source = `
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

if (process.argv[2] === "listener") {
  const server = createServer((_request, response) => response.end("owned EPERM descendant"));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    writeFileSync(process.argv[3], JSON.stringify({ pid: process.pid, port: address.port, startedAt: Date.now() }));
    process.send?.({ listening: true });
    setTimeout(() => server.close(() => process.exit(0)), 1200);
  });
} else {
  const listener = spawn(
    process.execPath,
    [process.argv[1], "listener", process.argv[2]],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] }
  );
  await once(listener, "message");
  listener.disconnect();
  listener.unref();
}
`;
    writeFileSync(path.join(root, sourcePath), source);
    git(root, ["add", "package.json", sourcePath]);
    const identity = indexIdentity(root, fixtureEnvironment(root));
    let ownedPid: number | undefined;
    try {
      const result = commandWithEnvironment(
        root,
        {
          EFCC_GROUP_TARGET_FILE: marker,
          ...fixtureGitEnvironment,
          EFCC_GROUP_PROBE_MARKER: probes,
          NODE_OPTIONS: `--require=${preload}`,
        },
        ["staged"]
      );
      expect(existsSync(marker)).toBe(true);
      const owned = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
        startedAt: number;
      };
      ownedPid = owned.pid;
      const listenerAfter = await fetch(`http://127.0.0.1:${owned.port}`, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => response.text())
        .catch(() => null);
      expect({
        elapsedAfterOwnedListener: Date.now() - owned.startedAt,
        indexUnchanged:
          indexIdentity(root, fixtureEnvironment(root)) === identity,
        injectedOwnedGroupProbe: readFileSync(probes, "utf-8"),
        listenerAfter,
        status: result.status,
      }).toMatchObject({
        indexUnchanged: true,
        injectedOwnedGroupProbe: expect.stringMatching(/^-[1-9]\d*$/u),
        listenerAfter: null,
        status: 0,
      });
      expect(Date.now() - owned.startedAt).toBeGreaterThanOrEqual(1000);
      expect(processExists(owned.pid)).toBe(false);
    } finally {
      if (ownedPid && processExists(ownedPid)) {
        process.kill(ownedPid, "SIGKILL");
      }
    }
  }, 240_000);

  it("does not report success while a listener survives its successful CLI leader", async () => {
    const root = fixture();
    const marker = path.join(root, "successful-descendant.json");
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    manifest.scripts.check = `node ${sourcePath} ${JSON.stringify(marker)}`;
    manifest.scripts.test = `node --check ${sourcePath}`;
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    const source = `
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

if (process.argv[2] === "listener") {
  const server = createServer((_request, response) => response.end("owned descendant"));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    process.send?.({ pid: process.pid, port: address.port });
  });
} else {
  const listener = spawn(
    process.execPath,
    [process.argv[1], "listener"],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] }
  );
  const [message] = await once(listener, "message");
  listener.disconnect();
  listener.unref();
  writeFileSync(
    process.argv[2],
    JSON.stringify({ ...(message as { pid: number; port: number }), launcherPid: process.pid })
  );
}
`;
    writeFileSync(path.join(root, sourcePath), source);
    git(root, ["add", "package.json", sourcePath]);
    const identity = indexIdentity(root, fixtureEnvironment(root));
    let ownedPid: number | undefined;
    try {
      const result = command(root, "staged");
      expect(existsSync(marker)).toBe(true);
      const owned = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
      };
      ownedPid = owned.pid;
      const listenerAfter = await fetch(`http://127.0.0.1:${owned.port}`, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => response.text())
        .catch(() => null);
      expect({
        failsAtOwnedCommand: result.output.includes(
          "Required command failed: pnpm run check"
        ),
        indexUnchanged:
          indexIdentity(root, fixtureEnvironment(root)) === identity,
        listenerAfter,
      }).toEqual({
        failsAtOwnedCommand: true,
        indexUnchanged: true,
        listenerAfter: null,
      });
      expect(processExists(owned.pid)).toBe(false);
    } finally {
      if (ownedPid && processExists(ownedPid)) {
        process.kill(ownedPid, "SIGKILL");
      }
    }
  }, 240_000);

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

if (process.argv[2] === "listener") {
  process.on("SIGINT", () => {});
  const server = createServer((_request, response) => response.end("alive"));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    process.send?.({ pid: process.pid, port: address.port });
  });
} else {
  process.on("SIGINT", () => process.exit(0));
  const listener = spawn(
    process.execPath,
    [process.argv[1], "listener"],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] }
  );
  const [message] = await Promise.race([
    once(listener, "message"),
    once(listener, "exit").then(([code, signal]) => {
      throw new Error(\`Listener exited before readiness: \${code}/\${signal}\`);
    }),
  ]);
  const owned = message as { pid: number; port: number };
  writeFileSync(
    process.argv[2],
    JSON.stringify({ ...owned, launcherPid: process.pid })
  );
  await Promise.withResolvers<null>().promise;
}
`;
    writeFileSync(path.join(root, sourcePath), source);
    git(root, ["add", "package.json", sourcePath]);
    const identity = indexIdentity(root, fixtureEnvironment(root));
    const gate = spawn(process.execPath, ["scripts/test-runner.ts", "staged"], {
      cwd: root,
      env: fixtureEnvironment(root) as unknown as NodeJS.ProcessEnv,
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
      await expect
        .poll(
          () =>
            existsSync(marker) ||
            gate.exitCode !== null ||
            gate.signalCode !== null,
          { timeout: 180_000 }
        )
        .toBe(true);
      if (!existsSync(marker)) {
        await completion;
        throw new Error(
          `The native gate exited before its listener started:\n${output}`
        );
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
      expect(path.dirname(metadata.privateEvidence)).toBe(
        fixtureEnvironment(root).TMPDIR
      );
      expect(path.basename(metadata.privateEvidence)).toMatch(
        /^efcc-gate-evidence-/u
      );
      const listenerAfter = await fetch(`http://127.0.0.1:${observed.port}`)
        .then((response) => response.text())
        .catch(() => null);
      const result = {
        evidenceIsPrivate:
          path
            .basename(metadata.privateEvidence)
            .startsWith("efcc-gate-evidence-") &&
          statSync(metadata.privateEvidence).mode.toString(8).endsWith("700"),
        indexUnchanged:
          indexIdentity(root, fixtureEnvironment(root)) === identity,
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
    const preload = path.join(root, "native-formatter-preload.mjs");
    const logPath = path.join(root, "native-formatter-output.txt");
    const preloadSource = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

if (/(?:^|\\/)oxlint\\/bin\\/oxlint$/u.test(process.argv[1] ?? "")) {
  process.on("SIGINT", () => {});
  const marker = ${JSON.stringify(marker)};
  const server = createServer((_request, response) => response.end("formatter alive"));
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
    const identity = indexIdentity(root, fixtureEnvironment(root));
    const log = openSync(logPath, "w");
    const gate = spawn(
      process.execPath,
      ["scripts/test-runner.ts", "staged", "--format"],
      {
        cwd: root,
        env: fixtureEnvironment(root) as unknown as NodeJS.ProcessEnv,
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
      await expect
        .poll(
          () =>
            existsSync(marker) ||
            gate.exitCode !== null ||
            gate.signalCode !== null,
          { timeout: 180_000 }
        )
        .toBe(true);
      if (!existsSync(marker)) {
        const [status, signal] = await exited;
        const diagnosticOutput = readFileSync(logPath, "utf-8")
          .split(/\r?\n/u)
          .slice(-30)
          .join("\n");
        throw new Error(
          `The staged format gate exited before the real formatter started (${status}, ${signal}):\n${diagnosticOutput}`
        );
      }
      formatter = JSON.parse(readFileSync(marker, "utf-8")) as {
        pid: number;
        port: number;
        argv: string[];
      };
      const ownedFormatterPid = formatter.pid;
      onTestFinished(() => {
        try {
          process.kill(ownedFormatterPid, "SIGKILL");
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ESRCH"
            )
          ) {
            throw error;
          }
        }
      });
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
      expect(path.dirname(metadata.privateEvidence)).toBe(
        fixtureEnvironment(root).TMPDIR
      );
      expect(path.basename(metadata.privateEvidence)).toMatch(
        /^efcc-gate-evidence-/u
      );
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
        indexUnchanged:
          indexIdentity(root, fixtureEnvironment(root)) === identity,
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
    }
  }, 240_000);
});
