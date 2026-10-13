import type { BetterAuthOptions } from "better-auth";

/** Trusted construction input. Production retains Better Auth's native defaults. */
export const passwordVerification:
  | NonNullable<BetterAuthOptions["emailAndPassword"]>["password"]
  | undefined = undefined;
