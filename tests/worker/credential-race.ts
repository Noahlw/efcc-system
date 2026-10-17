import { setTimeout as delay } from "node:timers/promises";

import { WorkerEntrypoint } from "cloudflare:workers";

export interface CredentialControl {
  accountSecurityProof: () => Promise<{
    armed: boolean;
    completed: number;
    held: boolean;
    started: number;
  }>;
  armAccountSecurityProof: () => Promise<void>;
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
let accountSecurityProofArmed = false;
let accountSecurityProofHeld = false;
let accountSecurityProofReleased = false;
let accountSecurityProofStarted = 0;
let accountSecurityProofCompleted = 0;
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
    Object.defineProperty(
      globalThis,
      Symbol.for("efcc.test.account-security-proof"),
      {
        value: async () => {
          if (!accountSecurityProofArmed) {
            return;
          }
          accountSecurityProofArmed = false;
          accountSecurityProofHeld = true;
          accountSecurityProofStarted += 1;
          try {
            // Hold the real HTTP request after actor proof while another request changes credentials.
            // eslint-disable-next-line no-unmodified-loop-condition -- A concurrent RPC owns release.
            while (!accountSecurityProofReleased) {
              // eslint-disable-next-line no-await-in-loop -- The causal request remains parked until release.
              await delay(20);
            }
          } finally {
            accountSecurityProofHeld = false;
            accountSecurityProofReleased = false;
            accountSecurityProofCompleted += 1;
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

  async armAccountSecurityProof(): Promise<void> {
    await loadProduction();
    if (accountSecurityProofArmed || accountSecurityProofHeld) {
      throw new Error("An account security proof is already armed or held");
    }
    accountSecurityProofReleased = false;
    accountSecurityProofArmed = true;
  }

  accountSecurityProof() {
    return {
      armed: accountSecurityProofArmed,
      completed: accountSecurityProofCompleted,
      held: accountSecurityProofHeld,
      started: accountSecurityProofStarted,
    };
  }

  verified() {
    return { armed, completed, held, verified };
  }

  release(): void {
    armed = false;
    released = true;
    accountSecurityProofArmed = false;
    accountSecurityProofReleased = true;
  }
}
