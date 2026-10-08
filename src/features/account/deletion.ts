import { and, eq, exists, isNull, not, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getDb } from "../../server/db/client";
import { enrolment, invitation } from "../../server/db/schema/activities";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import {
  departmentManagerAssignment,
  departmentMembership,
} from "../../server/db/schema/notices";
import type { AccountChangeReceipt } from "./account-guards";
import {
  findAccountChange,
  fingerprintAccountChange,
  matchingAccountChange,
  recordAccountChange,
  sensitiveStaffAssertion,
} from "./account-guards";
import { ApplicationRequestError, readBoundedJson } from "./applications";
import type { DeletionRequest } from "./deletion-contract";
import { deletionRequestSchema } from "./deletion-contract";
import { lastAdminError, otherEffectiveAdminExists } from "./restrictions";
import { requireManagedAccount, requireSensitiveStaff } from "./staff-accounts";

export const parseDeletionRequest = async (request: Request) => {
  const parsed = deletionRequestSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "刪除操作格式不正確。"
    );
  }
  return parsed.data;
};

const present = { present: sql`1` };

/**
 * The same four durable church records the union check read, as schema-bound
 * EXISTS fragments for the pre-read and the write-time snapshot.
 * `or()` is typed as possibly-undefined; every call site passes conditions.
 */
const historyBlocksDeletion = (id: string): SQL => {
  const db = getDb();
  const history = or(
    exists(db.select(present).from(enrolment).where(eq(enrolment.userId, id))),
    exists(
      db.select(present).from(invitation).where(eq(invitation.userId, id))
    ),
    exists(
      db
        .select(present)
        .from(departmentMembership)
        .where(eq(departmentMembership.userId, id))
    ),
    exists(
      db
        .select(present)
        .from(departmentManagerAssignment)
        .where(eq(departmentManagerAssignment.userId, id))
    )
  );
  return history ?? sql`0`;
};
const historyExists = async (id: string) =>
  (await getDb()
    .select(present)
    .from(user)
    .where(historyBlocksDeletion(id))
    .limit(1)
    .get()) !== undefined;
const historyError = () =>
  new ApplicationRequestError(
    409,
    "church_history_retained",
    "此帳戶有教會業務紀錄，不能永久刪除；請使用會籍停用。"
  );
const conflict = () =>
  new ApplicationRequestError(409, "conflict", "帳戶狀態已改變，請重新查核。");
export const deleteEligibleAccount = async (
  headers: Headers,
  input: DeletionRequest
) => {
  const actor = await requireSensitiveStaff(headers);
  const hash = await fingerprintAccountChange(
    actor.userId,
    "account_deleted",
    input
  );
  const existing = await findAccountChange(actor.userId, input.operationKey);
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  let target;
  try {
    target = await requireManagedAccount(actor, input.targetUserId);
  } catch (error) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    throw error;
  }
  if (await historyExists(target.userId)) {
    throw historyError();
  }
  const receipt: AccountChangeReceipt = {
    action: "account_deleted",
    createdAt: Math.floor(Date.now() / 1000),
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  try {
    const db = getDb();
    const stillEligible = exists(
      db
        .select(present)
        .from(personProfile)
        .innerJoin(
          account,
          and(
            eq(account.userId, personProfile.userId),
            eq(account.accountId, personProfile.userId),
            eq(account.providerId, "credential")
          )
        )
        .where(
          and(
            eq(personProfile.userId, target.userId),
            eq(personProfile.membershipStatus, target.membershipStatus),
            target.banned === null
              ? isNull(personProfile.bannedAt)
              : eq(personProfile.bannedAt, new Date(target.banned * 1000)),
            eq(account.credentialRevision, target.credentialRevision)
          )
        )
    );
    const snapshotHeld = or(
      exists(db.select(present).from(user).where(eq(user.id, target.userId))),
      exists(
        db
          .select(present)
          .from(account)
          .where(eq(account.userId, target.userId))
      ),
      exists(
        db
          .select(present)
          .from(session)
          .where(eq(session.userId, target.userId))
      ),
      exists(
        db
          .select(present)
          .from(personProfile)
          .where(eq(personProfile.userId, target.userId))
      )
    );
    await db.batch([
      sensitiveStaffAssertion(actor, target.userId),
      db
        .select({
          complete: sql`json(CASE WHEN NOT (${historyBlocksDeletion(target.userId)}) AND ${stillEligible} THEN 'null' ELSE 'Deletion eligibility changed' END)`,
        })
        .from(user)
        .limit(1),
      db.delete(user).where(eq(user.id, target.userId)),
      ...recordAccountChange(
        receipt,
        actor.userId,
        input.operationKey,
        hash,
        null
      ),
      db
        .select({
          complete: sql`json(CASE WHEN ${not(snapshotHeld ?? sql`0`)} THEN 'null' ELSE 'Incomplete account deletion' END)`,
        })
        .from(user)
        .limit(1),
    ]);
  } catch (error) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    const currentActor = await requireSensitiveStaff(headers);
    const current = await requireManagedAccount(currentActor, target.userId);
    if (await historyExists(target.userId)) {
      throw historyError();
    }
    if (
      current.membershipStatus !== target.membershipStatus ||
      current.banned !== target.banned ||
      current.credentialRevision !== target.credentialRevision
    ) {
      throw conflict();
    }
    if (
      target.role === "admin" &&
      !(await otherEffectiveAdminExists(target.userId))
    ) {
      throw lastAdminError();
    }
    throw error;
  }
  await requireSensitiveStaff(headers);
  return { created: true, receipt };
};
