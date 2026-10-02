import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import type { AppAuth } from "@/server/auth";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema/auth";
import type { MembershipStatus } from "@/server/db/schema/identity";
import { personProfile } from "@/server/db/schema/identity";

/**
 * Local synthetic setup for the browser/Worker harness. This is not part of
 * the delivered member surface: without the `SEED_TOKEN` value from the
 * gitignored `.dev.vars` it returns 404 like any other unknown route, and it
 * never appears in committed Worker configuration. Credentials are created
 * through Better Auth's trusted server API, never a public signup route.
 */
interface SeedAccount {
  username: string;
  password: string;
  fullName: string;
  email: string;
  membershipStatus: MembershipStatus;
  banned?: boolean;
}

interface SeedRequest {
  accounts: SeedAccount[];
}

const notFound = (): Response =>
  Response.json(
    { error: { code: "not_found", message: "找不到這個路徑。" } },
    { status: 404 }
  );

const createAccount = async (
  auth: AppAuth,
  account: SeedAccount
): Promise<string> => {
  const signUp = await auth.api.signUpEmail({
    body: {
      // The plugin lower-cases `username`; `displayUsername` preserves the form.
      displayUsername: account.username,
      email: account.email,
      name: account.fullName,
      password: account.password,
      username: account.username,
    },
  });
  return signUp.user.id;
};

const isSeedRequest = (value: unknown): value is SeedRequest => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("accounts" in value)) {
    return false;
  }
  const { accounts } = value;
  return Array.isArray(accounts) && accounts.length > 0;
};

export const POST = async (request: Request): Promise<Response> => {
  const token = env.SEED_TOKEN;
  if (!token || request.headers.get("x-seed-token") !== token) {
    return notFound();
  }

  const payload: unknown = await request.json().catch(() => null);
  if (!isSeedRequest(payload)) {
    return Response.json(
      { error: { code: "invalid_seed", message: "accounts 必須是非空陣列。" } },
      { status: 400 }
    );
  }

  const auth = getAuth();
  const db = getDb();
  const now = new Date();

  const created = await Promise.all(
    payload.accounts.map(async (account) => {
      // Better Auth stores the canonical lower-case username; match that form.
      const [existing] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.username, account.username.toLowerCase()))
        .limit(1);

      const userId = existing
        ? existing.id
        : await createAccount(auth, account);

      if (existing) {
        // Converge the disposable fixture: the display form and name may predate
        // the current canonical fixture values.
        await db
          .update(user)
          .set({ displayUsername: account.username, name: account.fullName })
          .where(eq(user.id, userId));
      }

      const values = {
        bannedAt: account.banned ? now : null,
        membershipStatus: account.membershipStatus,
        updatedAt: now,
      };

      await (existing
        ? db
            .update(personProfile)
            .set(values)
            .where(eq(personProfile.userId, userId))
        : db
            .insert(personProfile)
            .values({ ...values, createdAt: now, userId }));

      return { userId, username: account.username };
    })
  );

  return Response.json({ data: { created } });
};
