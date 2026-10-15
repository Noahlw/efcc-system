import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as snapshot from "../../../scripts/test-snapshot";
import {
  repository,
  sourcePath,
  green,
  red,
  fixtureGitEnvironment,
  git,
  fixture,
  commandWithEnvironment,
  command,
} from "./fixtures";

const { assertIndexUnchanged, assertSourcePrivacy, indexIdentity } = snapshot;
describe("source snapshots and privacy", () => {
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
});
