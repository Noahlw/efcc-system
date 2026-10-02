import { betterAuth } from "better-auth";
import type { Auth, BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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
  advanced: {
    ipAddress: {
      // Cloudflare supplies the real address first; the local harness may add XFF.
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
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
  emailAndPassword: {
    enabled: true,
    // Email verification never blocks Username/name sign-in in this slice.
    requireEmailVerification: false,
  },
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
