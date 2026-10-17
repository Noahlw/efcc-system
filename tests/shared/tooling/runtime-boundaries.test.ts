import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it, onTestFinished } from "vitest";

import { inspectRuntimeBoundaries } from "../../../scripts/runtime-boundaries";

const fixture = (files: Record<string, string>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "efcc-runtime-boundary-"));
  onTestFinished(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "bundler",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src"],
    })
  );
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
};

it("rejects a transitive aliased server runtime import from a client root", () => {
  const root = fixture({
    "src/components/client.ts":
      '"use client"; import { value } from "@/features/bridge"; export { value };',
    "src/features/bridge.ts": 'export { value } from "@/server/secret";',
    "src/server/secret.ts": "export const value = 1;",
  });
  expect(inspectRuntimeBoundaries(root).violations).toEqual([
    {
      reason: "server runtime",
      trace: [
        "src/components/client.ts",
        "src/features/bridge.ts",
        "src/server/secret.ts",
      ],
    },
  ]);
});

it("retains type-only server contracts, composition roots and inspected local cycles", () => {
  const root = fixture({
    "src/app/page.ts": 'export { server } from "@/server/api";',
    "src/components/client.ts":
      '"use client"; import type { AppType } from "@/server/api"; import { type OtherType } from "@/server/api"; export type { AppType } from "@/server/api"; export { value } from "@/features/a";',
    "src/features/a.ts":
      'export { other } from "@/features/b"; export const value = 1;',
    "src/features/b.ts":
      'export { value } from "@/features/a"; export const other = 2;',
    "src/server/api.ts":
      'import "node:fs"; export type AppType = {}; export type OtherType = {}; export const server = 1;',
  });
  const result = inspectRuntimeBoundaries(root);
  expect(result.violations).toEqual([]);
  expect(result.clientRoots).toEqual(["src/components/client.ts"]);
  expect(result.serverOwners).toEqual(["src/server/api.ts"]);
  expect(result.cycles).toHaveLength(1);
});

it.each([
  'import server, { type AppType } from "@/server/secret"; export { server };',
  'import * as server from "@/server/secret"; export { server };',
  'export * from "@/server/secret";',
  'export const load = () => import("@/server/secret");',
])("rejects other runtime alias forms: %s", (statement) => {
  const root = fixture({
    "src/components/client.ts": `"use client"; ${statement}`,
    "src/server/secret.ts": "export default 1; export type AppType = {};",
  });
  expect(inspectRuntimeBoundaries(root).violations).toEqual([
    {
      reason: "server runtime",
      trace: ["src/components/client.ts", "src/server/secret.ts"],
    },
  ]);
});

it("refreshes the boundary inventory after owners are added, renamed and removed", () => {
  const root = fixture({ "src/app/page.ts": "export {};" });
  expect(inspectRuntimeBoundaries(root).clientRoots).toEqual([]);
  mkdirSync(path.join(root, "src/components"));
  mkdirSync(path.join(root, "src/server"));
  writeFileSync(
    path.join(root, "src/components/new.ts"),
    '"use client"; import "node:fs";'
  );
  writeFileSync(
    path.join(root, "src/server/new.ts"),
    "export const server = 1;"
  );
  const added = inspectRuntimeBoundaries(root);
  expect(added.clientRoots).toEqual(["src/components/new.ts"]);
  expect(added.serverOwners).toEqual(["src/server/new.ts"]);
  expect(added.violations).toHaveLength(1);
  renameSync(
    path.join(root, "src/components/new.ts"),
    path.join(root, "src/components/renamed.ts")
  );
  renameSync(
    path.join(root, "src/server/new.ts"),
    path.join(root, "src/server/renamed.ts")
  );
  const renamed = inspectRuntimeBoundaries(root);
  expect(renamed.clientRoots).toEqual(["src/components/renamed.ts"]);
  expect(renamed.serverOwners).toEqual(["src/server/renamed.ts"]);
  expect(renamed.violations[0]?.trace).toEqual([
    "src/components/renamed.ts",
    "node:fs",
  ]);
  unlinkSync(path.join(root, "src/components/renamed.ts"));
  unlinkSync(path.join(root, "src/server/renamed.ts"));
  const removed = inspectRuntimeBoundaries(root);
  expect(removed.clientRoots).toEqual([]);
  expect(removed.serverOwners).toEqual([]);
  expect(removed.violations).toEqual([]);
});

it("fails the real check command on a forbidden client dependency", () => {
  const root = fixture({
    "src/components/client.ts": '"use client"; import "node:fs";',
  });
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(
        import.meta.dirname,
        "../../../scripts/runtime-boundaries.ts"
      ),
    ],
    { cwd: root, encoding: "utf-8" }
  );
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout).violations).toEqual([
    {
      reason: "server platform",
      trace: ["src/components/client.ts", "node:fs"],
    },
  ]);
});
