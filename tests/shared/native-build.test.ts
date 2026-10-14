import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { normalizeBuildConfig } from "../../scripts/portable-build";

const owned: string[] = [];
const fixture = () => {
  const parent = mkdtempSync(path.join(tmpdir(), "efcc-portable-build-"));
  owned.push(parent);
  const root = path.join(parent, "source");
  for (const directory of ["dist/server", "dist/client", "migrations"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  writeFileSync(path.join(root, "wrangler.jsonc"), "{}\n");
  const config = {
    assets: { binding: "ASSETS", directory: "../client" },
    configPath: path.join(root, "wrangler.jsonc"),
    d1_databases: [
      {
        binding: "DB",
        database_id: "00000000-0000-0000-0000-000000000000",
        database_name: "synthetic",
        migrations_dir: "../../migrations",
      },
    ] satisfies [unknown],
    main: "index.js",
    no_bundle: true,
    userConfigPath: path.join(root, "wrangler.jsonc"),
  };
  const file = path.join(root, "dist/server/wrangler.json");
  writeFileSync(file, JSON.stringify(config));
  return { config, file, parent, root };
};

afterEach(() => {
  for (const directory of owned.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("resolves the relocated source config, assets and original migrations without the old source directory", async () => {
  const { file, parent, root } = fixture();
  await normalizeBuildConfig(file, root);
  const relocated = path.join(parent, "relocated");
  renameSync(root, relocated);
  const directory = path.join(relocated, "dist/server");
  const config = JSON.parse(
    readFileSync(path.join(directory, "wrangler.json"), "utf-8")
  );
  for (const pointer of [config.configPath, config.userConfigPath]) {
    expect(readFileSync(path.resolve(directory, pointer), "utf-8")).toBe(
      "{}\n"
    );
    expect(path.resolve(directory, pointer)).toBe(
      path.join(relocated, "wrangler.jsonc")
    );
  }
  expect(path.resolve(directory, config.assets.directory)).toBe(
    path.join(relocated, "dist/client")
  );
  expect(path.resolve(directory, config.d1_databases[0].migrations_dir)).toBe(
    path.join(relocated, "migrations")
  );
});

it.each(["assets", "migrations", "source config"])(
  "rejects an external %s pointer without rewriting the build config",
  async (pointer) => {
    const { config, file, parent, root } = fixture();
    const outside = path.join(parent, "outside");
    mkdirSync(outside);
    if (pointer === "assets") {
      rmSync(path.join(root, "dist/client"), { recursive: true });
      symlinkSync(outside, path.join(root, "dist/client"), "dir");
    } else if (pointer === "migrations") {
      config.d1_databases[0].migrations_dir = path.relative(
        path.dirname(file),
        outside
      );
    } else {
      const outsideConfig = path.join(outside, "wrangler.jsonc");
      writeFileSync(outsideConfig, "{}\n");
      config.userConfigPath = outsideConfig;
    }
    const original = JSON.stringify(config);
    writeFileSync(file, original);
    await expect(normalizeBuildConfig(file, root)).rejects.toThrow();
    expect(readFileSync(file, "utf-8")).toBe(original);
  }
);
