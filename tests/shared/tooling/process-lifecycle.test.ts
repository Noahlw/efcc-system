import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { onTestFinished, describe, expect, it } from "vitest";

import * as snapshot from "../../../scripts/test-snapshot";
import {
  sourcePath,
  green,
  fixtureEnvironment,
  git,
  fixture,
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
