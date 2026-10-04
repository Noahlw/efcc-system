import { betterAuth } from "better-auth";
import type { Auth, BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { env } from "cloudflare:workers";

import { getDb, schema } from "../db/client";
import type { UsernameSignInCaller } from "./plugins/name-sign-in";
import { createNameSignInPlugin } from "./plugins/name-sign-in";

/** Session idle window: exactly 90 days from the last valid session use. */
export const SESSION_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60;

/** 3–30 ASCII letters, digits, underscore and dot; the canonical form is lower-case. */
const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;

const requireSecret = (): string => {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET is required for local acceptance; copy .dev.vars.example to .dev.vars."
    );
  }
  return secret;
};

const trustedOrigins = (): string[] => {
  const configured = env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (!configured) {
    return [];
  }
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

/**
 * Late-bound reference to the auth instance for plugins that must call the
 * public API. Binding it after construction keeps the options' inferred type
 * from referring to the instance type it produces.
 */
const authRef: { current: UsernameSignInCaller | undefined } = {
  current: undefined,
};

const resolveAuthForPlugins = (): UsernameSignInCaller => {
  if (!authRef.current) {
    throw new Error("Better Auth was used before it finished initialising.");
  }
  return authRef.current;
};

const authOptions = {
  account: {
    additionalFields: {
      credentialRevision: {
        defaultValue: 0,
        input: false,
        required: true,
        returned: false,
        type: "number",
      },
    },
  },
  advanced: {
    ipAddress: {
      // Only Cloudflare's own client-address header counts: caller-supplied
      // forwarding headers must never influence rate limits or session records.
      ipAddressHeaders: ["cf-connecting-ip"],
    },
  },
  basePath: "/api/auth",
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema: {
      account: schema.account,
      rateLimit: schema.rateLimit,
      session: schema.session,
      user: schema.user,
      verification: schema.verification,
    },
    transaction: false,
  }),
  databaseHooks: {
    session: {
      create: {
        async before(session, context) {
          const proof =
            context?.context && "efccCredentialProof" in context.context
              ? context.context.efccCredentialProof
              : null;
          if (
            context?.path !== "/sign-in/username" ||
            typeof proof !== "object" ||
            proof === null ||
            !("userId" in proof) ||
            proof.userId !== session.userId ||
            !("credentialRevision" in proof) ||
            typeof proof.credentialRevision !== "number" ||
            !Number.isSafeInteger(proof.credentialRevision) ||
            proof.credentialRevision < 0
          ) {
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_USERNAME_OR_PASSWORD",
              message: "使用者名稱或密碼不正確。",
            });
          }
          const current = await env.DB.prepare(
            `SELECT credential_revision AS revision FROM account
       WHERE user_id = ? AND account_id = ? AND provider_id = 'credential'`
          )
            .bind(session.userId, session.userId)
            .first<{ revision: number }>();
          if (current?.revision !== proof.credentialRevision) {
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_USERNAME_OR_PASSWORD",
              message: "使用者名稱或密碼不正確。",
            });
          }
          return {
            data: {
              ...session,
              credentialRevision: proof.credentialRevision,
            },
          };
        },
      },
    },
  },
  emailAndPassword: {
    // Public creation is canonical and session-free; trusted fixture signup
    // must not introduce a second session-creation path without password proof.
    autoSignIn: false,
    enabled: true,
    // Email verification never blocks Username/name sign-in in this slice.
    requireEmailVerification: false,
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (
        context.path !== "/sign-in/username" ||
        typeof context.body?.username !== "string"
      ) {
        return;
      }
      // Capture before native verification, never the newest revision afterwards.
      // dispatchAuthEndpoint clones this context for each native request.
      const proof = await env.DB.prepare(
        `SELECT u.id AS userId, a.credential_revision AS credentialRevision
         FROM user u INNER JOIN account a ON a.user_id = u.id
         WHERE u.username = ? AND a.provider_id = 'credential' AND a.account_id = u.id`
      )
        .bind(context.body.username.toLowerCase())
        .first<{ userId: string; credentialRevision: number }>();
      return { context: { context: { efccCredentialProof: proof } } };
    }),
  },
  logger: {
    log(level) {
      // Adapter messages/arguments can contain credentials and query values.
      console[level]("Authentication library event");
    },
  },
  // Native APIErrors still use Better Call's protocol. Unexpected adapter
  // errors escape to our route instead of Better Call logging raw SQL/binds.
  onAPIError: { throw: true },
  plugins: [
    username({
      displayUsernameValidator: (value: string) => usernamePattern.test(value),
      maxUsernameLength: 30,
      minUsernameLength: 3,
      usernameValidator: (value: string) => usernamePattern.test(value),
    }),
    createNameSignInPlugin(resolveAuthForPlugins),
  ],
  rateLimit: {
    enabled: true,
    max: 100,
    modelName: "rateLimit",
    storage: "database",
    window: 60,
  },
  secret: requireSecret(),
  session: {
    additionalFields: {
      confirmationOperationId: {
        input: false,
        required: false,
        returned: false,
        type: "string",
      },
      credentialRevision: {
        defaultValue: 0,
        input: false,
        required: true,
        returned: false,
        type: "number",
      },
      passwordConfirmedAt: {
        input: false,
        required: false,
        returned: false,
        type: "date",
      },
    },
    // Authoritative D1 checks on each request; no cookie authorisation snapshot.
    cookieCache: { enabled: false },
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    // Renew the exact 90-day idle window on every valid use.
    updateAge: 0,
  },
  trustedOrigins: trustedOrigins(),
} satisfies BetterAuthOptions;

export type AppAuth = Auth<typeof authOptions>;

let cachedAuth: AppAuth | undefined;

/** Lazily created per-isolate Better Auth instance. */
export const getAuth = (): AppAuth => {
  cachedAuth ??= betterAuth(authOptions);
  authRef.current = cachedAuth;
  return cachedAuth;
};
