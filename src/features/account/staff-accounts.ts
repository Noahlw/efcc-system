import { createHmac, randomBytes } from "node:crypto";

import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import * as z from "zod";

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../server/db/required-receipt";
import { accountSecurityOperation } from "../../server/db/schema/account-security";
import {
  auditEvent,
  usernameReservation,
} from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import type {
  AccountRole,
  MembershipStatus,
} from "../../server/db/schema/identity";
import { personProfile } from "../../server/db/schema/identity";
import { staffAccountOperation } from "../../server/db/schema/staff-accounts";
import type { staffAccountActionValues } from "../../server/db/schema/staff-accounts";
import { canonicalNameKey } from "../identity/name-matching";
import { sensitiveStaffAssertion } from "./account-guards";
import {
  accountIdentitySchema,
  ApplicationRequestError,
  readBoundedJson,
} from "./applications";
import { requireStaff } from "./decisions";
import type { StaffActor } from "./decisions";
import { getCredentialActor } from "./security";
import type { CredentialActor } from "./security";
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
type SensitiveActor = StaffActor &
  CredentialActor & {
    confirmationOperationId: string;
  };

interface OperationRow extends StaffAccountReceipt {
  requestHash: string;
}
export interface ManagedAccount {
  userId: string;
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  phoneShared: number;
  verifiedRecoveryPhone: string | null;
  temporaryPasswordExpiresAt: number | null;
  membershipStatus: MembershipStatus;
  banned: number | null;
  role: AccountRole;
  credentialRevision: number;
}

const validationError = () =>
  new ApplicationRequestError(
    400,
    "validation_error",
    "請填妥帳戶資料及身分核實方式。"
  );
const conflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "帳戶狀態或操作資料已改變，請重新查核。"
  );
const denied = () =>
  new ApplicationRequestError(
    403,
    "business_access_denied",
    "你沒有管理此帳戶的權限。"
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

export const requireSensitiveStaff = async (
  headers: Headers
): Promise<SensitiveActor> => {
  const staff = await requireStaff(headers);
  const actor = await getCredentialActor(headers);
  const now = Math.floor(Date.now() / 1000);
  const confirmed = await getDb()
    .select({ confirmationOperationId: accountSecurityOperation.id })
    .from(session)
    .innerJoin(
      accountSecurityOperation,
      and(
        eq(accountSecurityOperation.id, session.confirmationOperationId),
        eq(accountSecurityOperation.userId, session.userId),
        eq(accountSecurityOperation.sessionId, session.id),
        eq(accountSecurityOperation.action, "password_confirmed"),
        eq(
          accountSecurityOperation.credentialRevision,
          session.credentialRevision
        ),
        eq(session.passwordConfirmedAt, accountSecurityOperation.createdAt)
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        lte(session.passwordConfirmedAt, new Date(now * 1000)),
        gt(session.passwordConfirmedAt, new Date((now - 600) * 1000))
      )
    )
    .limit(1)
    .get();
  if (!confirmed || actor.temporaryPasswordExpiresAt !== null) {
    throw new ApplicationRequestError(
      403,
      "password_confirmation_required",
      "請先在帳戶安全頁確認目前密碼，確認只在此登入內有效十分鐘。"
    );
  }
  return {
    ...actor,
    ...staff,
    confirmationOperationId: confirmed.confirmationOperationId,
  };
};

const storedSeconds = (value: Date | null): number | null =>
  value === null ? null : Math.floor(value.getTime() / 1000);

export const getStaffAccounts = async (
  headers: Headers
): Promise<ManagedAccount[]> => {
  const actor = await requireStaff(headers);
  const db = getDb();
  const currentStaffSession = db
    .select({ id: session.id })
    .from(session)
    .innerJoin(personProfile, eq(personProfile.userId, session.userId))
    .innerJoin(
      account,
      and(
        eq(account.userId, session.userId),
        eq(account.accountId, session.userId),
        eq(account.providerId, "credential")
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, sql`CAST(strftime('%s','now') AS INTEGER)`),
        eq(session.credentialRevision, account.credentialRevision),
        isNull(account.temporaryPasswordExpiresAt),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt),
        inArray(personProfile.accountRole, ["staff", "admin"])
      )
    );
  const discoverableRole =
    actor.role === "admin"
      ? undefined
      : eq(personProfile.accountRole, "member");

  const rows = await db
    .select({
      banned: personProfile.bannedAt,
      credentialRevision: account.credentialRevision,
      email: user.email,
      fullName: user.name,
      membershipStatus: personProfile.membershipStatus,
      phone: personProfile.phone,
      phoneShared: personProfile.phoneShared,
      role: personProfile.accountRole,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
      userId: user.id,
      username: user.displayUsername,
      verifiedRecoveryPhone: personProfile.verifiedRecoveryPhone,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .innerJoin(
      account,
      and(
        eq(account.userId, user.id),
        eq(account.accountId, user.id),
        eq(account.providerId, "credential")
      )
    )
    .where(
      and(
        ne(user.id, actor.userId),
        discoverableRole,
        exists(currentStaffSession)
      )
    )
    .orderBy(asc(user.name), asc(user.id));
  await requireStaff(headers);
  return rows.map((row) => ({
    ...row,
    banned: storedSeconds(row.banned),
    phoneShared: row.phoneShared ? 1 : 0,
    temporaryPasswordExpiresAt: storedSeconds(row.temporaryPasswordExpiresAt),
  }));
};

export const requireManagedAccount = async (
  actor: StaffActor,
  id: string
): Promise<ManagedAccount> => {
  const row = await getDb()
    .select({
      banned: personProfile.bannedAt,
      credentialRevision: account.credentialRevision,
      email: user.email,
      fullName: user.name,
      membershipStatus: personProfile.membershipStatus,
      phone: personProfile.phone,
      phoneShared: personProfile.phoneShared,
      role: personProfile.accountRole,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
      userId: user.id,
      username: user.displayUsername,
      verifiedRecoveryPhone: personProfile.verifiedRecoveryPhone,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .innerJoin(
      account,
      and(
        eq(account.userId, user.id),
        eq(account.accountId, user.id),
        eq(account.providerId, "credential")
      )
    )
    .where(eq(user.id, id))
    .limit(1)
    .get();
  if (
    !row ||
    id === actor.userId ||
    (actor.role === "staff" && row.role !== "member")
  ) {
    throw denied();
  }
  return {
    ...row,
    banned: storedSeconds(row.banned),
    phoneShared: row.phoneShared ? 1 : 0,
    temporaryPasswordExpiresAt: storedSeconds(row.temporaryPasswordExpiresAt),
  };
};

const findOperation = async (
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
  return row
    ? { ...row, createdAt: Math.floor(row.createdAt.getTime() / 1000) }
    : null;
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

export const createAssistedAccount = async (
  headers: Headers,
  input: CreateInput
) => {
  const actor = await requireSensitiveStaff(headers);
  const authContext = await getAuth().$context;
  const requestHash = fingerprint(
    actor,
    "assisted_account_created",
    input,
    authContext.secret
  );
  const previous = await findOperation(actor, input.operationKey);
  if (previous) {
    return { created: false, receipt: matching(previous, requestHash) };
  }
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
  try {
    await database.batch([
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
      database.insert(account).values({
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
      }),
      database.insert(personProfile).values({
        bannedAt: null,
        createdAt,
        membershipStatus: "active",
        nameLookupKey: canonicalNameKey(input.fullName),
        phone: input.phone,
        phoneShared: input.sharedPhone,
        updatedAt: createdAt,
        userId,
      }),
      database.insert(auditEvent).values({
        action: "assisted_account_created",
        actorUserId: actor.userId,
        createdAt,
        id: receipt.id,
        targetUserId: userId,
      }),
      database.insert(staffAccountOperation).values({
        action: receipt.action,
        actorCredentialRevision: actor.credentialRevision,
        actorSessionId: actor.sessionId,
        actorUserId: actor.userId,
        confirmationOperationId: actor.confirmationOperationId,
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
  } catch (error) {
    const committed = await findOperation(actor, input.operationKey);
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
  const committed = await findOperation(actor, input.operationKey);
  if (!committed) {
    await requireStaff(headers);
    throw new Error("Missing assisted creation receipt");
  }
  await requireStaff(headers);
  return {
    created: true,
    receipt: matching(committed, requestHash),
    temporaryPassword,
  };
};

export const resetStaffPassword = async (
  headers: Headers,
  input: ResetInput,
  reissue: boolean
) => {
  const actor = await requireSensitiveStaff(headers);
  const action = reissue
    ? "temporary_password_reissued"
    : "staff_password_reset";
  const authContext = await getAuth().$context;
  const requestHash = fingerprint(actor, action, input, authContext.secret);
  const previous = await findOperation(actor, input.operationKey);
  if (previous) {
    return { created: false, receipt: matching(previous, requestHash) };
  }
  const target = await requireManagedAccount(actor, input.targetUserId);
  if (reissue && target.temporaryPasswordExpiresAt === null) {
    throw conflict();
  }
  if (
    input.identityCheck === "verified_phone" &&
    target.verifiedRecoveryPhone === null
  ) {
    throw new ApplicationRequestError(
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
  try {
    await database.batch([
      sensitiveStaffAssertion(actor, target.userId),
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
        ),
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
        actorCredentialRevision: actor.credentialRevision,
        actorSessionId: actor.sessionId,
        actorUserId: actor.userId,
        confirmationOperationId: actor.confirmationOperationId,
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
  } catch (error) {
    const committed = await findOperation(actor, input.operationKey);
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
  const committed = await findOperation(actor, input.operationKey);
  if (!committed) {
    await requireStaff(headers);
    throw new Error("Missing Staff credential receipt");
  }
  await requireStaff(headers);
  return {
    created: true,
    receipt: matching(committed, requestHash),
    temporaryPassword,
  };
};

export const reconcileStaffAccount = async (
  headers: Headers,
  operationKey: string
) => {
  const actor = await requireStaff(headers);
  const row = await findOperation(actor, operationKey);
  await requireStaff(headers);
  return row ? projection(row) : null;
};
