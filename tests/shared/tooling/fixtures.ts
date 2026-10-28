import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { onTestFinished, expect } from "vitest";

import * as snapshot from "../../../scripts/test-snapshot";

const repository = path.resolve(import.meta.dirname, "../../..");
const sourcePath = "tests/shared/account/decision-contract.test.ts";
const green = 'import assert from "node:assert/strict";\nassert.equal(1, 1);\n';
const red = 'import assert from "node:assert/strict";\nassert.equal(1, 2);\n';
// Foreign repositories must not borrow the invoking hook's Git context.
const fixtureGitEnvironment: Record<string, string> = {};
const hostRunnerContext = new Set(["CI", "GITHUB_ACTIONS", "RUNNER_TEMP"]);
for (const [key, value] of Object.entries(process.env)) {
  if (
    !key.startsWith("GIT_") &&
    !hostRunnerContext.has(key) &&
    typeof value === "string"
  ) {
    fixtureGitEnvironment[key] = value;
  }
}
const git = (root: string, args: string[], env = fixtureGitEnvironment) =>
  snapshot.git(root, args, env);
const fixture = (): string => {
  const parent = mkdtempSync(path.join(tmpdir(), "efcc-gate-regression-"));
  onTestFinished(() => rmSync(parent, { force: true, recursive: true }));
  const root = path.join(parent, "repository");
  mkdirSync(root);
  mkdirSync(path.join(parent, "temp"));
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
    "scripts/test-progress.ts",
    "scripts/vitest-progress-reporter.ts",
    "scripts/playwright-progress-reporter.ts",
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
    "test:coverage": `node ${sourcePath}`,
    "test:fast": `node ${sourcePath}`,
    typecheck: `node --check ${sourcePath}`,
  };
  put("package.json", JSON.stringify(manifest));
  put(".gitignore", "node_modules/\n");
  put(sourcePath, green);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "test: synthetic gate baseline"]);
  return root;
};
const fixtureEnvironment = (
  root: string,
  env: Record<string, string | undefined> = fixtureGitEnvironment
): Record<string, string | undefined> & { TMPDIR: string } => ({
  ...env,
  TMPDIR: path.join(path.dirname(root), "temp"),
});

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
      env: fixtureEnvironment(root, env) as unknown as NodeJS.ProcessEnv,
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
  expect(
    readdirSync(fixtureEnvironment(root).TMPDIR).filter((name) =>
      name.startsWith("efcc-gate-source-")
    )
  ).toEqual([]);
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
    expect(path.dirname(metadata.privateEvidence)).toBe(
      fixtureEnvironment(root).TMPDIR
    );
    expect(path.basename(metadata.privateEvidence)).toMatch(
      /^efcc-gate-evidence-/u
    );
    expect(path.basename(metadata.disposedSource)).toMatch(
      /^efcc-gate-source-/u
    );
    expect(existsSync(metadata.disposedSource)).toBe(false);
  }
  return { output, status: result.status };
};
const command = (root: string, ...args: string[]) =>
  commandWithEnvironment(root, fixtureGitEnvironment, args);
export {
  repository,
  sourcePath,
  green,
  red,
  fixtureGitEnvironment,
  fixtureEnvironment,
  git,
  fixture,
  commandWithEnvironment,
  command,
};
