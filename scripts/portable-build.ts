import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type Config = Record<string, unknown>;

const isConfig = (value: unknown): value is Config =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

export const normalizeBuildConfig = async (
  configPath: string,
  root: string
): Promise<void> => {
  const sourceRoot = await realpath(path.resolve(root));
  const configFile = await realpath(
    path.isAbsolute(configPath)
      ? path.resolve(configPath)
      : path.resolve(sourceRoot, configPath)
  );
  if (!isWithin(sourceRoot, configFile)) {
    throw new Error(`Build config escapes source root: ${configPath}`);
  }

  const configDirectory = path.dirname(configFile);
  const config = JSON.parse(await readFile(configFile, "utf-8")) as unknown;
  if (
    !isConfig(config) ||
    config.main !== "index.js" ||
    config.no_bundle !== true
  ) {
    throw new Error(
      "Unsupported native build config; expected unbundled index.js"
    );
  }

  const sourceConfig = await realpath(path.join(sourceRoot, "wrangler.jsonc"));
  const migrationsDirectory = await realpath(
    path.join(sourceRoot, "migrations")
  );
  const [sourceConfigStats, migrationsStats] = await Promise.all([
    stat(sourceConfig),
    stat(migrationsDirectory),
  ]);
  if (
    !isWithin(sourceRoot, sourceConfig) ||
    !isWithin(sourceRoot, migrationsDirectory) ||
    !sourceConfigStats.isFile() ||
    !migrationsStats.isDirectory()
  ) {
    throw new Error("Native source config or migrations escape source root");
  }
  const resolveOwnedDirectory = async (
    value: unknown,
    name: string
  ): Promise<string> => {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      path.isAbsolute(value)
    ) {
      throw new Error(`Unsupported ${name} path in native build config`);
    }
    const directory = await realpath(path.resolve(configDirectory, value));
    const info = await stat(directory);
    if (!isWithin(sourceRoot, directory) || !info.isDirectory()) {
      throw new Error(
        `${name} escapes source root or is not a directory: ${value}`
      );
    }
    return directory;
  };

  const { assets, d1_databases } = config;
  if (!isConfig(assets)) {
    throw new Error("Unsupported native build config; missing assets");
  }
  await resolveOwnedDirectory(assets.directory, "assets.directory");

  if (!Array.isArray(d1_databases) || d1_databases.length === 0) {
    throw new Error("Unsupported native build config; missing D1 bindings");
  }
  await Promise.all(
    d1_databases.map(async (binding) => {
      if (!isConfig(binding)) {
        throw new Error(
          "Unsupported native build config; malformed D1 binding"
        );
      }
      const migrations = await resolveOwnedDirectory(
        binding.migrations_dir,
        "d1_databases.migrations_dir"
      );
      if (migrations !== migrationsDirectory) {
        throw new Error(
          "Native D1 migrations must point to the source migrations directory"
        );
      }
    })
  );

  const metadata = await Promise.all(
    (["configPath", "userConfigPath"] as const).map(async (field) => {
      const original = config[field];
      if (typeof original !== "string" || original.length === 0) {
        throw new Error(`Unsupported native build config; missing ${field}`);
      }
      const resolved = await realpath(path.resolve(configDirectory, original));
      if (resolved !== sourceConfig) {
        throw new Error(
          `${field} escapes or does not identify the source Wrangler config`
        );
      }
      return [field, path.relative(configDirectory, sourceConfig)] as const;
    })
  );
  for (const [field, value] of metadata) {
    config[field] = value;
  }

  await writeFile(configFile, JSON.stringify(config));
};

if (import.meta.main) {
  const [configPath, ...extra] = process.argv.slice(2);
  if (!configPath || extra.length > 0) {
    throw new Error("Usage: node scripts/portable-build.ts <config-path>");
  }
  await normalizeBuildConfig(
    path.resolve(configPath),
    path.resolve(import.meta.dirname, "..")
  );
}
