import { setTimeout as delay } from "node:timers/promises";

import { WorkerEntrypoint } from "cloudflare:workers";

export interface CredentialControl {
  arm: () => Promise<void>;
  verified: () => Promise<{
    armed: boolean;
    held: boolean;
    verified: number;
    completed: number;
  }>;
  release: () => Promise<void>;
}

let armed = false;
let held = false;
let released = false;
let verified = 0;
let completed = 0;
let production:
  | Promise<{ default: ExportedHandler<Cloudflare.Env> }>
  | undefined;

const loadProduction = () => {
  if (!production) {
    Object.defineProperty(
      globalThis,
      Symbol.for("efcc.test.verified-password"),
      {
        value: async () => {
          if (!armed) {
            return;
          }
          armed = false;
          held = true;
          verified += 1;
          try {
            // A live native timer keeps the effect request alive for concurrent RPC release.
            // eslint-disable-next-line no-unmodified-loop-condition -- A concurrent RPC owns release.
            while (!released) {
              // eslint-disable-next-line no-await-in-loop -- The causal request remains parked until release.
              await delay(20);
            }
          } finally {
            held = false;
            released = false;
            completed += 1;
          }
        },
      }
    );
    // Trusted verifier construction is bundled into this actual emitted app, not a sidecar.
    // @ts-expect-error -- Artifact assembly places the emitted production module beside this entry.
    production = import("./index.js");
  }
  return production;
};

/* eslint-disable class-methods-use-this -- Native default RPC shares the production effect isolate. */
export default class CredentialApp extends WorkerEntrypoint<Cloudflare.Env> {
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
    if (armed || held) {
      throw new Error("A credential verifier is already armed or held");
    }
    released = false;
    armed = true;
  }

  verified() {
    return { armed, completed, held, verified };
  }

  release(): void {
    armed = false;
    released = true;
  }
}
