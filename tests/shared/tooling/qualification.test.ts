import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  fixture,
  fixtureEnvironment,
  fixtureGitEnvironment,
  git,
} from "./fixtures";

it("binds full qualification to current source, base and complete actual reports", () => {
  const root = fixture();
  const parent = path.dirname(root);
  const bin = path.join(parent, "bin");
  mkdirSync(bin);
  const source = "src/features/account/identity-validation.ts";
  mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
  writeFileSync(path.join(root, source), "export const identity = 1;\n");
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\ncoverage/\n");
  const manifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf-8")
  );
  manifest.scripts["test:mutation"] = "synthetic mutation";
  writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "test: qualify fixture"]);
  git(root, ["branch", "base"]);
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
if (a[0] === '--version') console.log('10.33.2');
else if (a[0] === 'config') console.log('false');
else if (a.includes('--dry=json')) console.log(JSON.stringify({tasks:[]}));
else if (a[0] === 'run' && a[1] === 'test:coverage') {
  const m = {covered:1,total:1,skipped:0,pct:100};
  const total = Object.fromEntries(['statements','branches','functions','lines'].map(k => [k,m]));
  fs.mkdirSync('coverage/production-source-unit',{recursive:true});
  fs.writeFileSync('coverage/production-source-unit/coverage-summary.json',JSON.stringify({total,[path.resolve('${source}')]:total}));
  fs.writeFileSync('coverage/production-source-unit/coverage-final.json',JSON.stringify({[path.resolve('${source}')]:{}}));
} else if (a[0] === 'run' && a[1] === 'test:mutation') {
  fs.mkdirSync('coverage/mutation',{recursive:true});
  fs.writeFileSync('coverage/mutation/mutation.json',JSON.stringify({schemaVersion:'1.0',files:{'${source}':{mutants:[{status:'Killed'}]}},testFiles:{'tests/shared/account/application-contract.test.ts':{}}}));
} else if (a[0] === 'exec' && a[1] === 'playwright') {
  const cases = [
    ['foundation',['native','http','foundation','risk-csrf'],['native']],
    ['browser',['native','browser','mobile-critical','risk-auth'],['features-chromium','features-iphone-webkit','features-pixel-chromium']],
    ['clock',['native','http','account-clock-matrix','risk-auth'],['causal-http']],
    ['dev',['native','browser','dev','risk-auth'],['dev-chromium']],
  ];
  const config = a[a.indexOf('--config')+1];
  const names = config.includes('discovery') ? cases : cases.filter(c => config.includes(c[0] === 'foundation' ? 'native' : c[0] === 'browser' ? 'features' : c[0] === 'clock' ? 'causal' : 'dev'));
  const specs = names.map(([name,tags,projects]) => ({id:name,file:name+'.spec.ts',line:1,column:1,title:name,tags,tests:(config.includes('discovery') ? ['definition'] : projects).map(projectName => ({projectName,expectedStatus:'passed',results:a.includes('--list') ? [] : [{retry:0,status:'passed'}]}))}));
  fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,JSON.stringify({errors:[],suites:[{specs}]}));
}
`;
  writeFileSync(path.join(bin, "pnpm"), fake, { mode: 0o755 });
  const env = fixtureEnvironment(root, {
    ...fixtureGitEnvironment,
    PATH: `${bin}${path.delimiter}${fixtureGitEnvironment.PATH}`,
  });
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, ["scripts/test-runner.ts", ...args], {
      cwd: root,
      encoding: "utf-8",
      env: env as unknown as NodeJS.ProcessEnv,
      timeout: 180_000,
    });
  const qualified = invoke("qualify", "--base", "base");
  expect(qualified.status, qualified.stdout + qualified.stderr).toBe(0);
  const line = qualified.stdout
    .split(/\r?\n/u)
    .find((item) => item.startsWith('{"disposedSource":'));
  if (!line) {
    throw new Error("Qualification evidence location is missing");
  }
  const evidence = JSON.parse(line).privateEvidence as string;
  const ready = () => invoke("ready", "--base", "base", "--evidence", evidence);
  expect(ready().status).toBe(0);
  writeFileSync(path.join(root, source), "export const identity = 2;\n");
  expect(ready().status).not.toBe(0);
  writeFileSync(path.join(root, source), "export const identity = 1;\n");
  const tip = git(root, ["rev-parse", "base"]).toString().trim();
  const tree = git(root, ["rev-parse", "base^{tree}"]).toString().trim();
  const moved = git(root, [
    "commit-tree",
    tree,
    "-p",
    tip,
    "-m",
    "synthetic base move",
  ])
    .toString()
    .trim();
  git(root, ["update-ref", "refs/heads/base", moved]);
  expect(ready().status).not.toBe(0);
  git(root, ["update-ref", "refs/heads/base", tip]);
  const report = path.join(
    evidence,
    "playwright.native.config.ts.results.json"
  );
  const original = readFileSync(report);
  const reportBytes = '{"errors":[{"message":"failure"}],"suites":[]}';
  writeFileSync(report, reportBytes);
  const summaryPath = path.join(evidence, "qualification-summary.json");
  const originalSummary = readFileSync(summaryPath, "utf-8");
  const altered = JSON.parse(originalSummary);
  altered.reports["playwright.native.config.ts.results.json"] = createHash(
    "sha256"
  )
    .update(reportBytes)
    .digest("hex");
  writeFileSync(summaryPath, JSON.stringify(altered));
  expect(ready().status).not.toBe(0);
  rmSync(report);
  expect(ready().status).not.toBe(0);
  writeFileSync(report, original);
  writeFileSync(summaryPath, originalSummary);
  const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
  summary.stages.pop();
  writeFileSync(summaryPath, JSON.stringify(summary));
  expect(ready().status).not.toBe(0);
}, 240_000);
