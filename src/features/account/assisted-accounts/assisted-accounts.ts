import { createHmac, randomBytes } from "node:crypto";

import { and, eq, exists, or, sql } from "drizzle-orm";
import * as z from "zod";

import { getAuth } from "../../../server/auth";
import { getDb } from "../../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../../server/db/required-receipt";
import {
  auditEvent,
  usernameReservation,
} from "../../../server/db/schema/applications";
import { account, session, user } from "../../../server/db/schema/auth";
import { personProfile } from "../../../server/db/schema/identity";
import { staffAccountOperation } from "../../../server/db/schema/staff-accounts";
import type { staffAccountActionValues } from "../../../server/db/schema/staff-accounts";
import { canonicalNameKey } from "../../identity/name-matching";
import { requireStaff } from "../account-actors";
import type { StaffActor } from "../account-actors";
import {
  requireSensitiveStaff,
  sensitiveStaffAssertion,
} from "../account-change-operations";
import { BusinessApiError, readBoundedJson } from "../business-request";
import { accountIdentitySchema } from "../identity-validation";
import {
  requireManagedAccount,
  requireManagedReceiptAccess,
} from "../managed-accounts";
import { staffSearchWrittenAssertion } from "../staff-search";
import { staffSearchKey } from "../staff-search-contract";
import { dateToUnixSeconds } from "../timestamps";
import type { StaffAccountReceipt } from "./staff-account-contract";

const TEMPORARY_PASSWORD_SECONDS = 7 * 24 * 60 * 60;
const keySchema = z.uuid().transform((value) => value.toLowerCase());
const createSchema = accountIdentitySchema
  .extend({
    email: accountIdentitySchema.shape.email.nullable(),
    identityCheck: z.literal("face_to_face"),
    operationKey: keySchema,
    sharedPhone: z.boolean(),
  })
  .strict();
const resetSchema = z.strictObject({
  identityCheck: z.enum(["face_to_face", "verified_phone"]),
  operationKey: keySchema,
  targetUserId: z.string().min(1).max(128),
});
const reconcileSchema = z.strictObject({ operationKey: keySchema });
type CreateInput = z.infer<typeof createSchema>;
type ResetInput = z.infer<typeof resetSchema>;
type StaffAction = (typeof staffAccountActionValues)[number];
interface OperationRow extends StaffAccountReceipt {
  requestHash: string;
}
const validationError = () =>
  new BusinessApiError(
    400,
    "validation_error",
    "請填妥帳戶資料及身分核實方式。"
  );
const conflict = () =>
  new BusinessApiError(
    409,
    "conflict",
    "帳戶狀態或操作資料已改變，請重新查核。"
  );
export const parseStaffCreationRequest = async (
  request: Request
): Promise<CreateInput> => {
  const result = createSchema.safeParse(await readBoundedJson(request));
  if (!result.success) {
    throw validationError();
  }
  return result.data;
};
export const parseStaffPasswordRequest = async (
  request: Request
): Promise<ResetInput> => {
  const result = resetSchema.safeParse(await readBoundedJson(request));
  if (!result.success) {
    throw validationError();
  }
  return result.data;
};
export const parseStaffAccountReconciliation = async (request: Request) => {
  const result = reconcileSchema.safeParse(await readBoundedJson(request));
  if (!result.success) {
    throw validationError();
  }
  return result.data;
};

const findOperation = async (
  headers: Headers,
  actor: StaffActor,
  key: string
): Promise<OperationRow | null> => {
  const row = await getDb()
    .select({
      action: staffAccountOperation.action,
      createdAt: staffAccountOperation.createdAt,
      id: staffAccountOperation.id,
      requestHash: staffAccountOperation.requestHash,
      targetUserId: staffAccountOperation.targetUserId,
    })
    .from(staffAccountOperation)
    .where(
      and(
        eq(staffAccountOperation.actorUserId, actor.userId),
        eq(staffAccountOperation.operationKey, key)
      )
    )
    .get();
  if (row) {
    await requireManagedReceiptAccess(headers, row.targetUserId);
  }
  return row ? { ...row, createdAt: dateToUnixSeconds(row.createdAt) } : null;
};
const projection = (row: OperationRow): StaffAccountReceipt => ({
  action: row.action,
  createdAt: row.createdAt,
  id: row.id,
  targetUserId: row.targetUserId,
});
const matching = (row: OperationRow, hash: string) => {
  if (row.requestHash !== hash) {
    throw conflict();
  }
  return projection(row);
};
const fingerprint = (
  actor: StaffActor,
  action: StaffAction,
  input: CreateInput | ResetInput,
  secret: string
) =>
  createHmac("sha256", secret)
    .update(JSON.stringify([actor.userId, action, input]))
    .digest("hex");

type StaffCredentialResult =
  | { created: false; receipt: StaffAccountReceipt }
  | {
      created: true;
      receipt: StaffAccountReceipt;
      temporaryPassword: string;
      temporaryPasswordExpiresAt: number;
    };

export const createAssistedAccount = async (
  headers: Headers,
  input: CreateInput
): Promise<StaffCredentialResult> => {
  const actor = await requireStaff(headers);
  const authContext = await getAuth().$context;
  const requestHash = fingerprint(
    actor,
    "assisted_account_created",
    input,
    authContext.secret
  );
  const previous = await findOperation(headers, actor, input.operationKey);
  if (previous) {
    return { created: false, receipt: matching(previous, requestHash) };
  }
  const sensitiveActor = await requireSensitiveStaff(headers);
  const userId = crypto.randomUUID();
  const temporaryPassword = randomBytes(24).toString("base64url");
  const passwordHash = await authContext.password.hash(temporaryPassword);
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date(now * 1000);
  const email = input.email ?? `${userId}@accounts.efcc.invalid`;
  const receipt: StaffAccountReceipt = {
    action: "assisted_account_created",
    createdAt: now,
    id: crypto.randomUUID(),
    targetUserId: userId,
  };
  const database = getDb();
  let temporaryPasswordExpiresAt: Date | null = null;
  try {
    const [, [credential]] = await database.batch([
      database.insert(user).values({
        createdAt,
        displayUsername: input.username,
        email,
        emailVerified: false,
        id: userId,
        name: input.fullName,
        updatedAt: createdAt,
        username: input.username.toLowerCase(),
      }),
      database
        .insert(account)
        .values({
          accountId: userId,
          createdAt,
          id: crypto.randomUUID(),
          password: passwordHash,
          providerId: "credential",
          temporaryPasswordExpiresAt: new Date(
            (now + TEMPORARY_PASSWORD_SECONDS) * 1000
          ),
          updatedAt: createdAt,
          userId,
        })
        .returning({
          temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
        }),
      database.insert(personProfile).values({
        bannedAt: null,
        createdAt,
        membershipStatus: "active",
        nameLookupKey: canonicalNameKey(input.fullName),
        phone: input.phone,
        phoneShared: input.sharedPhone,
        staffSearchKey: staffSearchKey(input.fullName, input.username),
        updatedAt: createdAt,
        userId,
      }),
      staffSearchWrittenAssertion(
        database,
        userId,
        input.fullName,
        input.username
      ),
      database.insert(auditEvent).values({
        action: "assisted_account_created",
        actorUserId: actor.userId,
        createdAt,
        id: receipt.id,
        targetUserId: userId,
      }),
      database.insert(staffAccountOperation).values({
        action: receipt.action,
        actorCredentialRevision: sensitiveActor.credentialRevision,
        actorSessionId: actor.sessionId,
        actorUserId: actor.userId,
        confirmationOperationId: sensitiveActor.confirmationOperationId,
        createdAt,
        id: receipt.id,
        identityCheck: input.identityCheck,
        operationKey: input.operationKey,
        requestHash,
        targetCredentialRevision: 0,
        targetUserId: userId,
      }),
      requireDrizzleWrittenReceipt(database, {
        id: receipt.id,
        table: "staff_account_operation",
      }),
    ]);
    temporaryPasswordExpiresAt = credential?.temporaryPasswordExpiresAt ?? null;
  } catch (error) {
    const committed = await findOperation(headers, actor, input.operationKey);
    if (committed) {
      return { created: false, receipt: matching(committed, requestHash) };
    }
    await requireSensitiveStaff(headers);
    const duplicate = await database.get<{ present: number }>(sql`
    SELECT ${or(
      exists(
        database
          .select({ usernameKey: usernameReservation.usernameKey })
          .from(usernameReservation)
          .where(
            eq(usernameReservation.usernameKey, input.username.toLowerCase())
          )
      ),
      exists(
        database
          .select({ id: user.id })
          .from(user)
          .where(eq(sql`lower(trim(${user.email}))`, email))
      ),
      input.sharedPhone
        ? undefined
        : exists(
            database
              .select({ userId: personProfile.userId })
              .from(personProfile)
              .where(eq(personProfile.phone, input.phone))
          )
    )} AS present`);
    if (duplicate?.present) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findOperation(headers, actor, input.operationKey);
  if (!committed) {
    await requireStaff(headers);
    throw new Error("Missing assisted creation receipt");
  }
  await requireStaff(headers);
  if (temporaryPasswordExpiresAt === null) {
    throw new Error("Missing assisted creation credential expiry");
  }
  return {
    created: true,
    receipt: matching(committed, requestHash),
    temporaryPassword,
    temporaryPasswordExpiresAt: Math.floor(
      temporaryPasswordExpiresAt.getTime() / 1000
    ),
  };
};

export const resetStaffPassword = async (
  headers: Headers,
  input: ResetInput,
  reissue: boolean
): Promise<StaffCredentialResult> => {
  const actor = await requireStaff(headers);
  const action = reissue
    ? "temporary_password_reissued"
    : "staff_password_reset";
  const authContext = await getAuth().$context;
  const requestHash = fingerprint(actor, action, input, authContext.secret);
  const previous = await findOperation(headers, actor, input.operationKey);
  if (previous) {
    return { created: false, receipt: matching(previous, requestHash) };
  }
  const sensitiveActor = await requireSensitiveStaff(headers);
  const target = await requireManagedAccount(actor, input.targetUserId);
  if (reissue && target.temporaryPasswordExpiresAt === null) {
    throw conflict();
  }
  if (
    input.identityCheck === "verified_phone" &&
    target.verifiedRecoveryPhone === null
  ) {
    throw new BusinessApiError(
      403,
      "identity_verification_required",
      "必須親身核實身分，或由職員透過教會原有已核實電話主動聯絡。新聯絡資料不能作復原憑證。"
    );
  }
  const temporaryPassword = randomBytes(24).toString("base64url");
  const passwordHash = await authContext.password.hash(temporaryPassword);
  const now = Math.floor(Date.now() / 1000);
  const receipt: StaffAccountReceipt = {
    action,
    createdAt: now,
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  const revision = target.credentialRevision + 1;
  const database = getDb();
  const createdAt = new Date(now * 1000);
  let temporaryPasswordExpiresAt: Date | null = null;
  try {
    const [, [credential]] = await database.batch([
      sensitiveStaffAssertion(sensitiveActor, target.userId),
      database
        .update(account)
        .set({
          credentialRevision: revision,
          password: passwordHash,
          temporaryPasswordExpiresAt: new Date(
            (now + TEMPORARY_PASSWORD_SECONDS) * 1000
          ),
          updatedAt: createdAt,
        })
        .where(
          and(
            eq(account.userId, target.userId),
            eq(account.accountId, account.userId),
            eq(account.providerId, "credential"),
            eq(account.credentialRevision, target.credentialRevision),
            exists(
              database
                .select({ present: sql`1` })
                .from(personProfile)
                .where(
                  and(
                    eq(personProfile.userId, account.userId),
                    or(
                      sql`${input.identityCheck} = 'face_to_face'`,
                      sql`${personProfile.verifiedRecoveryPhone} = ${target.verifiedRecoveryPhone}`
                    )
                  )
                )
            )
          )
        )
        .returning({
          temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
        }),
      database.delete(session).where(
        and(
          eq(session.userId, target.userId),
          exists(
            database
              .select({ present: sql`1` })
              .from(account)
              .where(
                and(
                  eq(account.userId, target.userId),
                  eq(account.accountId, account.userId),
                  eq(account.providerId, "credential"),
                  eq(account.password, passwordHash),
                  eq(account.credentialRevision, revision)
                )
              )
          )
        )
      ),
      database.insert(auditEvent).select(
        database
          .select({
            action: sql<string>`${action}`.as("action"),
            actorUserId: sql<string>`${actor.userId}`.as("actor_user_id"),
            createdAt: sql`${now}`.as("created_at"),
            id: sql<string>`${receipt.id}`.as("id"),
            targetUserId: account.userId,
          })
          .from(account)
          .where(
            and(
              eq(account.userId, target.userId),
              eq(account.accountId, account.userId),
              eq(account.providerId, "credential"),
              eq(account.password, passwordHash),
              eq(account.credentialRevision, revision)
            )
          )
      ),
      database.insert(staffAccountOperation).values({
        action: receipt.action,
        actorCredentialRevision: sensitiveActor.credentialRevision,
        actorSessionId: actor.sessionId,
        actorUserId: actor.userId,
        confirmationOperationId: sensitiveActor.confirmationOperationId,
        createdAt,
        id: receipt.id,
        identityCheck: input.identityCheck,
        operationKey: input.operationKey,
        requestHash,
        targetCredentialRevision: revision,
        targetUserId: target.userId,
      }),
      requireDrizzleWrittenReceipt(database, {
        id: receipt.id,
        table: "staff_account_operation",
      }),
    ]);
    temporaryPasswordExpiresAt = credential?.temporaryPasswordExpiresAt ?? null;
  } catch (error) {
    const committed = await findOperation(headers, actor, input.operationKey);
    if (committed) {
      return { created: false, receipt: matching(committed, requestHash) };
    }
    const currentActor = await requireSensitiveStaff(headers);
    const current = await requireManagedAccount(currentActor, target.userId);
    if (
      current.credentialRevision !== target.credentialRevision ||
      (input.identityCheck === "verified_phone" &&
        current.verifiedRecoveryPhone !== target.verifiedRecoveryPhone)
    ) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findOperation(headers, actor, input.operationKey);
  if (!committed) {
    await requireStaff(headers);
    throw new Error("Missing Staff credential receipt");
  }
  await requireStaff(headers);
  if (temporaryPasswordExpiresAt === null) {
    throw new Error("Missing Staff credential expiry");
  }
  return {
    created: true,
    receipt: matching(committed, requestHash),
    temporaryPassword,
    temporaryPasswordExpiresAt: Math.floor(
      temporaryPasswordExpiresAt.getTime() / 1000
    ),
  };
};

export const reconcileStaffAccount = async (
  headers: Headers,
  operationKey: string
) => {
  const actor = await requireStaff(headers);
  const row = await findOperation(headers, actor, operationKey);
  await requireStaff(headers);
  return row ? projection(row) : null;
};
