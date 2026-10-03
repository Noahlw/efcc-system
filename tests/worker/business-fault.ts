import { env } from "cloudflare:workers";

import { POST as handleAuthPost } from "../../src/app/api/auth/[...all]/route";
import { handleBusinessRequest } from "../../src/server/api/app";
import { resolveAccess } from "../../src/server/auth/access";

/** Focused local Worker: fault the real business query after the real guard. */
export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/health") {
      return new Response("ready");
    }
    if (new URL(request.url).pathname.startsWith("/api/auth/")) {
      return handleAuthPost(request);
    }
    const { decision } = await resolveAccess(request);
    if (decision.level !== "full" || !decision.userId) {
      return new Response("forbidden", { status: 403 });
    }
    const headers = new Headers(request.headers);
    headers.set("x-efcc-user-id", decision.userId);
    headers.set("x-efcc-access", decision.level);
    await env.DB.exec(
      "alter table user rename column display_username to fault_display_username"
    );
    try {
      return await handleBusinessRequest(new Request(request, { headers }));
    } finally {
      await env.DB.exec(
        "alter table user rename column fault_display_username to display_username"
      );
    }
  },
};
