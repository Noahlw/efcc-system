import { WorkerEntrypoint } from "cloudflare:workers";

import type { StaffActor } from "../../src/features/account/account-actors";
import { staffAccountPageQuery } from "../../src/features/account/managed-accounts";
import {
  backfillStaffSearchProjectionBatch,
  staffSearchBackfillUpdate,
  staffSearchWrittenAssertion,
} from "../../src/features/account/staff-search";
import { staffSearchKey } from "../../src/features/account/staff-search-contract";
import { canonicalNameKey } from "../../src/features/identity/name-matching";
import { getAuth } from "../../src/server/auth";
import { getDb } from "../../src/server/db/client";
import type {
  AccountRole,
  MembershipStatus,
} from "../../src/server/db/schema/identity";
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
  backfillStaffSearch: () => Promise<{ attempted: number; complete: boolean }>;
  legacyAccount: (input: ProvisionAccount) => Promise<string>;
  inspectStaffSearchQuery: (
    actor: StaffActor,
    query: string
  ) => Promise<{
    writeBindCounts: number[];
    bindCount: number;
    queryBound: boolean;
    sql: string;
    queryPlan: unknown[];
  }>;
  account: (input: ProvisionAccount) => Promise<string>;
  setMembershipStatus: (
    userId: string,
    membershipStatus: MembershipStatus
  ) => Promise<void>;
}

/** Trusted prerequisites only. Never included in the production Worker. */
/* eslint-disable class-methods-use-this -- Native RPC entrypoints require instance methods. */
export default class Provision extends WorkerEntrypoint<Cloudflare.Env> {
  /** Observe the real production ORM query; authority is proved over HTTP. */
  async inspectStaffSearchQuery(actor: StaffActor, query: string) {
    const compiled = staffAccountPageQuery(getDb(), actor, 1, query).toSQL();
    const plan = await this.env.DB.prepare(`EXPLAIN QUERY PLAN ${compiled.sql}`)
      .bind(...compiled.params)
      .all();
    return {
      bindCount: compiled.params.length,
      queryBound: compiled.params.includes(query),
      queryPlan: plan.results,
      sql: compiled.sql,
      writeBindCounts: [
        staffSearchBackfillUpdate(getDb(), {
          fullName: query,
          userId: actor.userId,
          username: null,
        }).toSQL().params.length,
        staffSearchWrittenAssertion(getDb(), actor.userId, query, null).toSQL()
          .params.length,
      ],
    };
  }
  backfillStaffSearch(): Promise<{ attempted: number; complete: boolean }> {
    return backfillStaffSearchProjectionBatch();
  }

  /** Native auth plus original profile columns, for populated upgrade fixtures. */
  async legacyAccount(input: ProvisionAccount): Promise<string> {
    const result = await getAuth().api.signUpEmail({
      body: {
        displayUsername: input.username,
        email: input.email,
        name: input.fullName,
        password: input.password,
        username: input.username,
      },
    });
    await this.env.DB.prepare(
      "INSERT INTO person_profile (user_id, account_role, membership_status, name_lookup_key, phone, phone_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, unixepoch(), unixepoch())"
    )
      .bind(
        result.user.id,
        input.role ?? "member",
        input.membershipStatus,
        canonicalNameKey(input.fullName),
        input.phone ?? null
      )
      .run();
    return result.user.id;
  }
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
    await getDb()
      .insert(personProfile)
      .values({
        accountRole: input.role ?? "member",
        bannedAt: input.banned ? now : null,
        createdAt: now,
        membershipStatus: input.membershipStatus,
        nameLookupKey: canonicalNameKey(input.fullName),
        phone: input.phone ?? null,
        staffSearchKey: staffSearchKey(input.fullName, input.username),
        updatedAt: now,
        userId: result.user.id,
      });
    return result.user.id;
  }

  async setMembershipStatus(
    userId: string,
    membershipStatus: MembershipStatus
  ): Promise<void> {
    const result = await this.env.DB.prepare(
      "UPDATE person_profile SET membership_status=?, updated_at=unixepoch() WHERE user_id=?"
    )
      .bind(membershipStatus, userId)
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("Missing test-owned membership prerequisite");
    }
  }

  fetch(): Response {
    return new Response(null, { status: 404 });
  }
}
