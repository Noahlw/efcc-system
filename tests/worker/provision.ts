import { WorkerEntrypoint } from "cloudflare:workers";

import { canonicalNameKey } from "../../src/features/identity/name-matching";
import { getAuth } from "../../src/server/auth";
import { getDb } from "../../src/server/db/client";
import type { AccountRole, MembershipStatus } from "../../src/server/db/schema/identity";
import { personProfile } from "../../src/server/db/schema/identity";

export interface ProvisionAccount {
  username: string;
  password: string;
  fullName: string;
  email: string;
  membershipStatus: MembershipStatus;
  role?: AccountRole;
  banned?: boolean;
  phone?: string;
}

export interface Provisioning {
  account: (input: ProvisionAccount) => Promise<string>;
}

/** Trusted prerequisites only. Never included in the production Worker. */
/* eslint-disable class-methods-use-this -- Native RPC entrypoints require instance methods. */
export default class Provision extends WorkerEntrypoint<Cloudflare.Env> {
  async account(input: ProvisionAccount): Promise<string> {
    const result = await getAuth().api.signUpEmail({
      body: {
        displayUsername: input.username,
        email: input.email,
        name: input.fullName,
        password: input.password,
        username: input.username,
      },
    });
    const now = new Date();
    await getDb().insert(personProfile).values({
      accountRole: input.role ?? "member",
      bannedAt: input.banned ? now : null,
      createdAt: now,
      membershipStatus: input.membershipStatus,
      nameLookupKey: canonicalNameKey(input.fullName),
      phone: input.phone ?? null,
      updatedAt: now,
      userId: result.user.id,
    });
    return result.user.id;
  }

  fetch(): Response {
    return new Response(null, { status: 404 });
  }
}
