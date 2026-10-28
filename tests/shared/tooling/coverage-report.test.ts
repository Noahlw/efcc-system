import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertCoverageConfigMatches,
  assertCoverageFileInventory,
  productionCoverageSources,
} from "../../../scripts/test-runner";

const temporaryRoots: string[] = [];
const fixtureRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), "efcc-coverage-report-"));
  temporaryRoots.push(root);
  return root;
};

describe("production-source coverage report", () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("allows base comparison only when the ordinary Vitest config is identical", () => {
    const candidate = Buffer.from("export default { include: ['src'] };\n");
    const sameBase = Buffer.from(candidate);
    const changedBase = Buffer.from("export default { include: ['tests'] };\n");

    expect(() =>
      assertCoverageConfigMatches(candidate, sameBase)
    ).not.toThrow();
    expect(() => assertCoverageConfigMatches(candidate, changedBase)).toThrow(
      "Base Vitest config differs from the candidate"
    );
  });

  it("includes executable src TypeScript and TSX files but excludes declarations", () => {
    const root = fixtureRoot();
    const src = path.join(root, "src");
    mkdirSync(path.join(src, "nested"), { recursive: true });
    for (const file of [
      "src/app.tsx",
      "src/nested/domain.ts",
      "src/nested/types.d.ts",
      "src/readme.js",
    ]) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "export {};\n");
    }

    expect(productionCoverageSources(root)).toEqual([
      "src/app.tsx",
      "src/nested/domain.ts",
    ]);
  });

  it("matches coverage reported through the physical path of a symlinked checkout", () => {
    const parent = fixtureRoot();
    const root = path.join(parent, "source");
    const alias = path.join(parent, "alias");
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src/app.tsx"), "export {};\n");
    symlinkSync(root, alias, "dir");
    expect(() =>
      assertCoverageFileInventory(
        [path.join(realpathSync(root), "src/app.tsx")],
        ["src/app.tsx"],
        alias
      )
    ).not.toThrow();
    expect(() =>
      assertCoverageFileInventory(
        [path.join(root, "src/app.tsx"), path.join(alias, "src/app.tsx")],
        ["src/app.tsx"],
        alias
      )
    ).toThrow(
      "Coverage summary does not include every executable src TypeScript file"
    );
  });

  it("rejects a summary that omits an executable source module", () => {
    const root = fixtureRoot();
    const expected = ["src/app.tsx", "src/domain.ts"];
    mkdirSync(path.join(root, "src"));
    for (const file of expected) {
      writeFileSync(path.join(root, file), "export {};\n");
    }
    const reported = [path.join(root, "src/app.tsx")];

    expect(() => assertCoverageFileInventory(reported, expected, root)).toThrow(
      "Coverage summary does not include every executable src TypeScript file"
    );
  });
});
