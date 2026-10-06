import { setTimeout as delay } from "node:timers/promises";

import { POST as handleAuthPost } from "../../src/app/api/auth/[...all]/route";
import { getAuth } from "../../src/server/auth";

// Test-only barrier after the configured native password verifier succeeds.
// This Worker is never referenced by production configuration.
let paused = false;
let verified = false;
let armed = false;
let installed = false;

export default {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/health") {
      if (!installed) {
        const context = await getAuth().$context;
        const { verify } = context.password;
        context.password.verify = async (input) => {
          const valid = await verify(input);
          if (valid && armed) {
            armed = false;
            verified = true;
            paused = true;
            // Another request releases the test-only verification barrier.
            // eslint-disable-next-line no-unmodified-loop-condition
            while (paused) {
              // The real timer keeps workerd's stalled request live until release.
              // eslint-disable-next-line no-await-in-loop
              await delay(20);
            }
          }
          return valid;
        };
        installed = true;
      }
      return new Response("ready");
    }
    if (path === "/arm") {
      armed = true;
      verified = false;
      return new Response("armed");
    }
    if (path === "/verified") {
      return Response.json({ armed, paused, verified });
    }
    if (path === "/release") {
      paused = false;
      return new Response("released");
    }
    return handleAuthPost(request);
  },
};
