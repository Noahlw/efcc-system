import { setTimeout as delay } from "node:timers/promises";

import { env, WorkerEntrypoint } from "cloudflare:workers";

export interface BatchControl {
  arm: () => Promise<void>;
  held: () => Promise<{ held: boolean; entered: number; completed: number }>;
  release: () => Promise<void>;
}

// Dedicated causal store: exactly one sensitive writer may be armed at a time.
let armed = false;
let parked = false;
let released = false;
let entered = 0;
let completed = 0;
let production:
  | Promise<{ default: ExportedHandler<Cloudflare.Env> }>
  | undefined;

const loadProduction = () => {
  if (!production) {
    const original = env.DB;
    Object.defineProperty(env, "DB", {
      configurable: true,
      value: {
        async batch<T>(
          statements: D1PreparedStatement[]
        ): Promise<D1Result<T>[]> {
          if (armed) {
            armed = false;
            parked = true;
            entered += 1;
            // Causal keepalive, not readiness polling: RPC from another request releases it.
            // eslint-disable-next-line no-unmodified-loop-condition -- A concurrent RPC owns release.
            while (!released) {
              // eslint-disable-next-line no-await-in-loop -- Keep the held effect request alive until RPC release.
              await delay(20);
            }
            parked = false;
            released = false;
          }
          const result = await original.batch<T>(statements);
          completed += 1;
          return result;
        },
        dump: () => original.dump(),
        exec: (sql: string) => original.exec(sql),
        prepare: (sql: string) => original.prepare(sql),
      },
    });
    // Artifact assembly places this module beside the unchanged emitted app entry.
    // Install before import: authOptions captures its Drizzle adapter at evaluation.
    // @ts-expect-error -- emitted production module exists only in dist/server.
    production = import("./index.js");
  }
  return production;
};

/** Test-only default RPC service AND production fetch in the same effect isolate. */
/* eslint-disable class-methods-use-this -- Default native RPC requires instance methods sharing effect-isolate state. */
export default class ClockApp extends WorkerEntrypoint<Cloudflare.Env> {
  async fetch(
    request: Request<unknown, IncomingRequestCfProperties>
  ): Promise<Response> {
    const app = await loadProduction();
    if (!app.default.fetch) {
      throw new Error("Emitted production Worker has no fetch entrypoint");
    }
    return app.default.fetch(request, this.env, this.ctx);
  }

  async arm(): Promise<void> {
    await loadProduction();
    if (armed || parked) {
      throw new Error("A sensitive batch is already armed or held");
    }
    released = false;
    armed = true;
  }

  held() {
    return { completed, entered, held: parked };
  }

  release(): void {
    armed = false;
    released = true;
  }
}
