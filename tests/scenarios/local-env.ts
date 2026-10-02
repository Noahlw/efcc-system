import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Local-only `.dev.vars` handling for the acceptance harness. The file is
 * gitignored; when it is missing, this creates it with random local values so
 * `pnpm test:e2e` works from a clean checkout without committing secrets.
 */
const projectRoot = path.resolve(import.meta.dirname, "../..");
const devVarsPath = path.join(projectRoot, ".dev.vars");

export const E2E_PORT = Number(process.env.E2E_PORT ?? 5199);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

const randomHex = (bytes: number): string => {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
};

const parse = (source: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const match = /^(?<key>[A-Z0-9_]+)=(?<value>.*)$/u.exec(line.trim());
    const { key, value } = match?.groups ?? {};
    if (key !== undefined && value !== undefined) {
      values[key] = value;
    }
  }
  return values;
};

export const ensureLocalEnv = (): Record<string, string> => {
  if (!existsSync(devVarsPath)) {
    writeFileSync(
      devVarsPath,
      [
        `BETTER_AUTH_SECRET=${randomHex(32)}`,
        `BETTER_AUTH_TRUSTED_ORIGINS=${E2E_BASE_URL},http://127.0.0.1:${E2E_PORT}`,
        `SEED_TOKEN=${randomHex(16)}`,
        "",
      ].join("\n")
    );
  }
  return parse(readFileSync(devVarsPath, "utf-8"));
};
