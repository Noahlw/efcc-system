import { createHmac } from "node:crypto";

import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import * as z from "zod";

import { getAuth } from "../../server/auth";
import { getDb, schema } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../server/db/required-receipt";
import { ApplicationRequestError, readBoundedJson } from "./applications";
import { accountActor } from "./decisions";
import type { AccountActor } from "./decisions";
import type {
  AccountSecurityReceipt,
  securityActionSchema,
} from "./security-contract";

const { account, accountSecurityOperation, auditEvent, session } = schema;

export type AccountSecurityAction = z.infer<typeof securityActionSchema>;

interface CredentialActor extends AccountActor {
  accountId: string;
  credentialRevision: number;
  passwordHash: string;
  passwordConfirmedAt: number | null;
  temporaryPasswordExpiresAt: number | null;
  confirmationOperationId: string | null;
}

interface OperationRow extends AccountSecurityReceipt {
  requestHash: string;
  sessionId: string;
}

type SecurityBatchItem = Parameters<Database["batch"]>[0][number];

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const storedSeconds = (value: Date): number =>
  Math.floor(value.getTime() / 1000);
const asTimestamp = (seconds: number): Date => new Date(seconds * 1000);

/** Current native session with its credential revision and confirmation state. */
export const getCredentialActor = async (
  headers: Headers
): Promise<CredentialActor> => {
  const actor = accountActor(headers);
  const row = await getDb()
    .select({
      accountId: account.id,
      confirmationOperationId: session.confirmationOperationId,
      credentialRevision: account.credentialRevision,
      passwordConfirmedAt: session.passwordConfirmedAt,
      passwordHash: account.password,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
    })
    .from(session)
    .innerJoin(account, eq(account.userId, session.userId))
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, asTimestamp(nowSeconds())),
        eq(account.providerId, "credential"),
        eq(account.accountId, session.userId),
        isNotNull(account.password),
        eq(session.credentialRevision, account.credentialRevision)
      )
    )
    .limit(1)
    .get();
  if (!row?.passwordHash) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  return {
    ...actor,
    accountId: row.accountId,
    confirmationOperationId: row.confirmationOperationId,
    credentialRevision: row.credentialRevision,
    passwordConfirmedAt:
      row.passwordConfirmedAt === null
        ? null
        : storedSeconds(row.passwordConfirmedAt),
    passwordHash: row.passwordHash,
    temporaryPasswordExpiresAt:
      row.temporaryPasswordExpiresAt === null
        ? null
        : storedSeconds(row.temporaryPasswordExpiresAt),
  };
};

export const getAccountSecurityState = async (headers: Headers) => {
  const actor = await getCredentialActor(headers);
  const now = nowSeconds();
  const confirmedAt = actor.passwordConfirmedAt;
  return {
    passwordConfirmationExpiresAt:
      confirmedAt !== null &&
      confirmedAt <= now &&
      confirmedAt > now - 600 &&
      actor.confirmationOperationId !== null
        ? confirmedAt + 600
        : null,
    temporaryPasswordExpired:
      actor.temporaryPasswordExpiresAt !== null &&
      actor.temporaryPasswordExpiresAt <= now,
    temporaryPasswordExpiresAt: actor.temporaryPasswordExpiresAt,
  };
};

const operationKeySchema = z.uuid().transform((value) => value.toLowerCase());
const currentPassword = z.string().min(1).max(128);
const securityRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("password_changed"),
    input: z.strictObject({
      currentPassword,
      newPassword: z.string().min(8).max(128),
      operationKey: operationKeySchema,
    }),
  }),
  z.strictObject({
    action: z.literal("other_sessions_revoked"),
    input: z.strictObject({ operationKey: operationKeySchema }),
  }),
  z.strictObject({
    action: z.literal("password_confirmed"),
    input: z.strictObject({
      operationKey: operationKeySchema,
      password: currentPassword,
    }),
  }),
]);
const reconciliationSchema = z.strictObject({
  operationKey: operationKeySchema,
});

type SecurityInput = z.infer<typeof securityRequestSchema>;

export const parseAccountSecurityRequest = async (
  request: Request,
  action: AccountSecurityAction
): Promise<SecurityInput> => {
  const parsed = securityRequestSchema.safeParse({
    action,
    input: await readBoundedJson(request),
  });
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "請填妥密碼資料；新密碼必須為 8 至 128 個字元。"
    );
  }
  return parsed.data;
};

export const parseSecurityReconciliationRequest = async (request: Request) => {
  const parsed = reconciliationSchema.safeParse(await readBoundedJson(request));
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "操作代碼格式不正確。"
    );
  }
  return parsed.data;
};

/** The caller's session must still be credentialed for its receipt to surface. */
const currentCredentialSession = (database: Database, actor: AccountActor) =>
  exists(
    database
      .select({ present: sql`1` })
      .from(session)
      .innerJoin(account, eq(account.userId, session.userId))
      .where(
        and(
          eq(session.id, actor.sessionId),
          eq(session.userId, actor.userId),
          gt(session.expiresAt, asTimestamp(nowSeconds())),
          eq(account.providerId, "credential"),
          eq(account.accountId, session.userId),
          isNotNull(account.password),
          eq(session.credentialRevision, account.credentialRevision)
        )
      )
  );

const findOperation = async (
  actor: AccountActor,
  key: string
): Promise<OperationRow | null> => {
  const database = getDb();
  const row = await database
    .select({
      action: accountSecurityOperation.action,
      createdAt: accountSecurityOperation.createdAt,
      id: accountSecurityOperation.id,
      requestHash: accountSecurityOperation.requestHash,
      sessionId: accountSecurityOperation.sessionId,
    })
    .from(accountSecurityOperation)
    .where(
      and(
        eq(accountSecurityOperation.userId, actor.userId),
        eq(accountSecurityOperation.operationKey, key),
        currentCredentialSession(database, actor)
      )
    )
    .limit(1)
    .get();
  return row ? { ...row, createdAt: storedSeconds(row.createdAt) } : null;
};

const receiptProjection = (row: OperationRow): AccountSecurityReceipt => ({
  action: row.action,
  createdAt: row.createdAt,
  id: row.id,
});

const operationConflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "帳戶或登入狀態已改變，或操作代碼已用於其他資料。請重新查核。"
  );

const payloadHash = (
  input: SecurityInput,
  actor: AccountActor,
  sessionId: string,
  secret: string
) =>
  createHmac("sha256", secret)
    .update(
      JSON.stringify([
        actor.userId,
        sessionId,
        input.action,
        input.input.operationKey,
        "currentPassword" in input.input ? input.input.currentPassword : null,
        "newPassword" in input.input ? input.input.newPassword : null,
        "password" in input.input ? input.input.password : null,
      ])
    )
    .digest("hex");

const matchingReceipt = (
  row: OperationRow,
  input: SecurityInput,
  actor: AccountActor,
  secret: string
): AccountSecurityReceipt => {
  if (
    row.action !== input.action ||
    row.requestHash !== payloadHash(input, actor, row.sessionId, secret)
  ) {
    throw operationConflict();
  }
  return receiptProjection(row);
};

export const createAccountSecurityOperation = async (
  headers: Headers,
  input: SecurityInput
): Promise<{ receipt: AccountSecurityReceipt; created: boolean }> => {
  const actor = await getCredentialActor(headers);
  if (actor.temporaryPasswordExpiresAt !== null) {
    if (input.action !== "password_changed") {
      throw new ApplicationRequestError(
        403,
        "password_change_required",
        "請先更改臨時密碼。"
      );
    }
    if (actor.temporaryPasswordExpiresAt <= nowSeconds()) {
      throw new ApplicationRequestError(
        403,
        "temporary_password_expired",
        "臨時密碼已到期，請聯絡職員重新發出。"
      );
    }
    if (input.input.newPassword === input.input.currentPassword) {
      throw new ApplicationRequestError(
        400,
        "validation_error",
        "請選擇另一個新密碼，不可繼續使用職員發出的臨時密碼。"
      );
    }
  }
  const authContext = await getAuth().$context;
  const previous = await findOperation(actor, input.input.operationKey);
  if (previous) {
    return {
      created: false,
      receipt: matchingReceipt(previous, input, actor, authContext.secret),
    };
  }
  if (input.action !== "other_sessions_revoked") {
    const password =
      input.action === "password_changed"
        ? input.input.currentPassword
        : input.input.password;
    if (
      !(await authContext.password.verify({
        hash: actor.passwordHash,
        password,
      }))
    ) {
      throw new ApplicationRequestError(
        400,
        "invalid_password",
        "目前密碼不正確，未有作出變更或確認。"
      );
    }
  }
  const database = getDb();
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const requestHash = payloadHash(
    input,
    actor,
    actor.sessionId,
    authContext.secret
  );
  const credentialIsCurrent = (password: string, revision: number) =>
    exists(
      database
        .select({ present: sql`1` })
        .from(account)
        .where(
          and(
            eq(account.id, actor.accountId),
            eq(account.password, password),
            eq(account.credentialRevision, revision)
          )
        )
    );
  let statements: [SecurityBatchItem, ...SecurityBatchItem[]];
  if (input.action === "password_changed") {
    const { minPasswordLength, maxPasswordLength } =
      authContext.password.config;
    if (
      input.input.newPassword.length < minPasswordLength ||
      input.input.newPassword.length > maxPasswordLength
    ) {
      throw new ApplicationRequestError(
        400,
        "validation_error",
        "新密碼長度不符合密碼規則。"
      );
    }
    const passwordHash = await authContext.password.hash(
      input.input.newPassword
    );
    const revision = actor.credentialRevision + 1;
    statements = [
      database
        .update(account)
        .set({
          credentialRevision: revision,
          password: passwordHash,
          temporaryPasswordExpiresAt: null,
          updatedAt: asTimestamp(now),
        })
        .where(
          and(
            eq(account.id, actor.accountId),
            eq(account.userId, actor.userId),
            eq(account.providerId, "credential"),
            eq(account.accountId, account.userId),
            eq(account.password, actor.passwordHash),
            eq(account.credentialRevision, actor.credentialRevision),
            or(
              isNull(account.temporaryPasswordExpiresAt),
              gt(account.temporaryPasswordExpiresAt, asTimestamp(now))
            ),
            exists(
              database
                .select({ present: sql`1` })
                .from(session)
                .where(
                  and(
                    eq(session.id, actor.sessionId),
                    eq(session.userId, account.userId),
                    gt(session.expiresAt, asTimestamp(now)),
                    eq(session.credentialRevision, account.credentialRevision)
                  )
                )
            )
          )
        ),
      database
        .update(session)
        .set({
          confirmationOperationId: null,
          credentialRevision: revision,
          passwordConfirmedAt: null,
          updatedAt: asTimestamp(now),
        })
        .where(
          and(
            eq(session.id, actor.sessionId),
            eq(session.userId, actor.userId),
            credentialIsCurrent(passwordHash, revision)
          )
        ),
      database
        .delete(session)
        .where(
          and(
            eq(session.userId, actor.userId),
            ne(session.id, actor.sessionId),
            credentialIsCurrent(passwordHash, revision)
          )
        ),
      database.insert(auditEvent).select(
        database
          .select({
            action: sql<string>`'password_changed'`.as("action"),
            actorUserId: account.userId,
            createdAt: sql`${now}`.as("created_at"),
            id: sql<string>`${id}`.as("id"),
            targetUserId: account.userId,
          })
          .from(account)
          .where(
            and(
              eq(account.id, actor.accountId),
              eq(account.password, passwordHash),
              eq(account.credentialRevision, revision)
            )
          )
      ),
    ];
  } else if (input.action === "other_sessions_revoked") {
    statements = [
      database.insert(auditEvent).select(
        database
          .select({
            action: sql<string>`'other_sessions_revoked'`.as("action"),
            actorUserId: session.userId,
            createdAt: sql`${now}`.as("created_at"),
            id: sql<string>`${id}`.as("id"),
            targetUserId: session.userId,
          })
          .from(session)
          .innerJoin(account, eq(account.userId, session.userId))
          .where(
            and(
              eq(session.id, actor.sessionId),
              eq(session.userId, actor.userId),
              gt(session.expiresAt, asTimestamp(now)),
              eq(account.id, actor.accountId),
              eq(account.password, actor.passwordHash),
              eq(account.credentialRevision, actor.credentialRevision),
              eq(session.credentialRevision, account.credentialRevision)
            )
          )
      ),
      database.delete(session).where(
        and(
          eq(session.userId, actor.userId),
          ne(session.id, actor.sessionId),
          exists(
            database
              .select({ present: sql`1` })
              .from(auditEvent)
              .where(
                and(
                  eq(auditEvent.id, id),
                  eq(auditEvent.actorUserId, actor.userId)
                )
              )
          )
        )
      ),
    ];
  } else {
    statements = [
      database
        .update(session)
        .set({
          confirmationOperationId: id,
          passwordConfirmedAt: asTimestamp(now),
          updatedAt: asTimestamp(now),
        })
        .where(
          and(
            eq(session.id, actor.sessionId),
            eq(session.userId, actor.userId),
            gt(session.expiresAt, asTimestamp(now)),
            eq(session.credentialRevision, actor.credentialRevision),
            credentialIsCurrent(actor.passwordHash, actor.credentialRevision)
          )
        ),
      database.insert(auditEvent).select(
        database
          .select({
            action: sql<string>`'password_confirmed'`.as("action"),
            actorUserId: session.userId,
            createdAt: session.passwordConfirmedAt,
            id: sql<string>`${id}`.as("id"),
            targetUserId: session.userId,
          })
          .from(session)
          .where(
            and(
              eq(session.id, actor.sessionId),
              eq(session.userId, actor.userId),
              eq(session.confirmationOperationId, id)
            )
          )
      ),
    ];
  }
  // Always attempt the final receipt: a skipped SELECT must not bypass its
  // completeness trigger and commit an ignored required write.
  statements.push(
    database.insert(accountSecurityOperation).values({
      action: input.action,
      createdAt: asTimestamp(now),
      credentialRevision:
        actor.credentialRevision +
        (input.action === "password_changed" ? 1 : 0),
      id,
      operationKey: input.input.operationKey,
      requestHash,
      sessionId: actor.sessionId,
      userId: actor.userId,
    }),
    requireDrizzleWrittenReceipt(database, {
      id,
      table: "account_security_operation",
    })
  );
  try {
    await database.batch(statements);
  } catch (error) {
    const committed = await findOperation(actor, input.input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingReceipt(committed, input, actor, authContext.secret),
      };
    }
    const current = await getCredentialActor(headers);
    if (current.credentialRevision !== actor.credentialRevision) {
      throw operationConflict();
    }
    throw error;
  }
  const committed = await findOperation(actor, input.input.operationKey);
  if (!committed) {
    await getCredentialActor(headers);
    throw operationConflict();
  }
  return {
    created: committed.id === id,
    receipt: matchingReceipt(committed, input, actor, authContext.secret),
  };
};

export const reconcileAccountSecurityOperation = async (
  headers: Headers,
  operationKey: string
): Promise<AccountSecurityReceipt | null> => {
  const actor = await getCredentialActor(headers);
  const committed = await findOperation(actor, operationKey);
  await getCredentialActor(headers);
  return committed ? receiptProjection(committed) : null;
};
