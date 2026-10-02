import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";

import { resolveUsernameByFullName } from "../../../features/identity/name-lookup";
import { getDb } from "../../db/client";

/** Matches the native sign-in rule: three attempts per ten-second window. */
const NAME_SIGN_IN_WINDOW_SECONDS = 10;
const NAME_SIGN_IN_MAX_ATTEMPTS = 3;

const credentialError = (): APIError =>
  new APIError("UNAUTHORIZED", {
    code: "INVALID_NAME_OR_PASSWORD",
    message: "中文姓名或密碼不正確。",
  });

/**
 * The narrow slice of the auth instance this plugin needs. Declaring it here
 * keeps the plugin from depending on the instance type that contains it.
 */
export interface UsernameSignInCaller {
  api: {
    signInUsername: (input: {
      body: { password: string; rememberMe?: boolean; username: string };
      headers: Headers;
      returnHeaders: true;
    }) => Promise<{
      headers: Headers;
      response: Record<string, unknown> | null;
    }>;
  };
}

/**
 * Namespaced native entry for full-Chinese-name sign-in. It resolves exactly
 * one canonical Username through the EFCC identity schema and then delegates to
 * the public Username sign-in API, so password verification, session creation
 * and cookie semantics stay owned by the Username plugin.
 */
export const createNameSignInPlugin = (
  resolveAuth: () => UsernameSignInCaller
): BetterAuthPlugin => ({
  endpoints: {
    signInName: createAuthEndpoint(
      "/sign-in/name",
      {
        body: z.object({
          fullName: z.string(),
          password: z.string(),
          rememberMe: z.boolean().optional(),
        }),
        method: "POST",
      },
      async (ctx) => {
        const lookup = await resolveUsernameByFullName(
          getDb(),
          ctx.body.fullName
        );

        if (lookup.status === "ambiguous") {
          throw new APIError("CONFLICT", {
            code: "NAME_AMBIGUOUS",
            message: "此中文姓名對應多個帳戶，請改用使用者名稱登入。",
          });
        }
        if (lookup.status === "not_found") {
          throw credentialError();
        }

        const result = await resolveAuth().api.signInUsername({
          body: {
            password: ctx.body.password,
            rememberMe: ctx.body.rememberMe,
            username: lookup.username,
          },
          headers: ctx.headers ?? new Headers(),
          returnHeaders: true,
        });

        if (!result.response) {
          throw credentialError();
        }

        // The Username plugin owns the cookies; forward them unchanged.
        for (const cookie of result.headers.getSetCookie()) {
          ctx.responseHeaders.append("set-cookie", cookie);
        }
        return ctx.json(result.response, { status: 200 });
      }
    ),
  },
  id: "efcc-name-sign-in",
  rateLimit: [
    {
      max: NAME_SIGN_IN_MAX_ATTEMPTS,
      pathMatcher: (path: string) => path === "/sign-in/name",
      window: NAME_SIGN_IN_WINDOW_SECONDS,
    },
  ],
  version: "1.0.0",
});
