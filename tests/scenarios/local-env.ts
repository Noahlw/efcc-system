import { randomBytes } from "node:crypto";
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

const randomHex = (bytes: number): string => randomBytes(bytes).toString("hex");

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

/**
 * Close every API-request-context connection instead of pooling it. Fixture
 * SQL runs synchronously (execFileSync wrangler) and blocks the worker event
 * loop; across such a block the dev server can close its idle keep-alive
 * socket, leaving a pooled socket that the next request can select before its
 * close is processed (dead-socket reuse -> RST). The acceptance run's single
 * `read ECONNRESET` matches this class (7.9s idle across a blocked loop,
 * immediate reset; the exact selection race was not reproduced locally), and
 * removing the idle-pool path removes the class. Browser transport keeps its
 * own pooling.
 */
export const apiTransportHeaders = { connection: "close" } as const;
