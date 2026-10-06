import { setTimeout as delay } from "node:timers/promises";

import { env } from "cloudflare:workers";

import { POST as handleAuthPost } from "../../src/app/api/auth/[...all]/route";
import { handleBusinessRequest } from "../../src/server/api/app";
import { resolveAccess } from "../../src/server/auth/access";

/**
 * Test-only clock harness. Never referenced by production configuration.
 *
 * It mirrors the production proxy bridge for the business API and additionally
 * parks the next D1 `batch` on demand, so the acceptance suite can move a
 * persisted authority deadline past the instant an already-built ordered batch
 * actually executes. The parked statements are the unchanged production SQL
 * against real local D1; only the batch start is gated.
 */
let armed = false;
let held = false;
let released = false;

const gateBatch = async (): Promise<void> => {
  if (!armed) {
    return;
  }
  armed = false;
  held = true;
  // Another test request releases the park; the real timer keeps workerd's
  // stalled request alive while it waits.
  // eslint-disable-next-line no-unmodified-loop-condition
  while (!released) {
    // eslint-disable-next-line no-await-in-loop
    await delay(20);
  }
  held = false;
  released = false;
};

let gateInstalled = false;
const installGate = (): void => {
  if (gateInstalled) {
    return;
  }
  gateInstalled = true;
  const original = env.DB;
  Object.defineProperty(env, "DB", {
    configurable: true,
    value: {
      batch: async (statements: unknown[]) => {
        await gateBatch();
        return original.batch(statements as never);
      },
      dump: () => original.dump(),
      exec: (query: string) => original.exec(query),
      prepare: (query: string) => original.prepare(query),
    },
    writable: true,
  });
};

/** The business API paths the real proxy still allows while a password change is required. */
const passwordChangePaths: Record<string, true> = {
  "/api/v2/account/password": true,
  "/api/v2/account/security": true,
  "/api/v2/account/security/reconcile": true,
};

export default {
  async fetch(request: Request) {
    installGate();
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      return new Response("ready");
    }
    if (pathname === "/arm") {
      armed = true;
      held = false;
      released = false;
      return new Response("armed");
    }
    if (pathname === "/held") {
      return Response.json({ held });
    }
    if (pathname === "/release") {
      released = true;
      return new Response("released");
    }
    if (pathname.startsWith("/api/auth/")) {
      return handleAuthPost(request);
    }
    const { decision } = await resolveAccess(request);
    if (
      decision.level === "password-change-required" &&
      passwordChangePaths[pathname] === undefined
    ) {
      return Response.json(
        {
          error: {
            code: "password_change_required",
            message: "請先更改臨時密碼；到期時請聯絡職員重新發出。",
          },
        },
        { status: 403 }
      );
    }
    const headers = new Headers(request.headers);
    // Never trust client-supplied decision headers.
    headers.delete("x-efcc-user-id");
    headers.delete("x-efcc-access");
    headers.delete("x-efcc-session-id");
    if (decision.userId) {
      headers.set("x-efcc-user-id", decision.userId);
      if (decision.sessionId) {
        headers.set("x-efcc-session-id", decision.sessionId);
      }
    }
    headers.set("x-efcc-access", decision.level);
    return handleBusinessRequest(new Request(request, { headers }));
  },
};
