import * as z from "zod";

import { applicationFieldSchemas } from "./application-contract";

export const staffAccountActionValues = [
  "assisted_account_created",
  "staff_password_reset",
  "temporary_password_reissued",
] as const;
export const staffAccountActionSchema = z.enum(staffAccountActionValues);
export type StaffAccountAction = z.infer<typeof staffAccountActionSchema>;

export const staffIdentityCheckValues = [
  "face_to_face",
  "verified_phone",
] as const;
export const staffIdentityCheckSchema = z.enum(staffIdentityCheckValues);
export type StaffIdentityCheck = z.infer<typeof staffIdentityCheckSchema>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const temporaryPasswordPattern = /^[\w-]{32}$/u;
const opaqueId = z.string().min(1).max(128);

/** Staff creation keeps the identity rules; email may be absent and is never `.invalid`. */
const optionalEmail = z.string().superRefine((value, context) => {
  const email = value.trim().toLowerCase();
  if (!email) {
    return;
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (
    email.length > 254 ||
    !emailPattern.test(email) ||
    domain.endsWith(".invalid")
  ) {
    context.addIssue({
      code: "custom",
      message: "請輸入有效的電郵地址；沒有電郵可留空，不可使用 .invalid 網域。",
    });
  }
});

/**
 * The creation task's live field rules. `verified` is the face-to-face
 * acknowledgement; it gates the review and never leaves the browser.
 */
export const staffCreationFieldSchemas = {
  email: optionalEmail,
  fullName: applicationFieldSchemas.fullName,
  phone: applicationFieldSchemas.phone,
  sharedPhone: z.boolean(),
  username: applicationFieldSchemas.username,
  verified: z.literal(true, {
    error: "請先確認已親身核實此人的身分。",
  }),
};

/** Explicit submission-boundary parse: values are normalized before review/request. */
export const staffCreationFormSchema = z
  .object(staffCreationFieldSchemas)
  .transform(({ email, username, verified: _verified, ...rest }) => ({
    ...rest,
    email: email.trim() === "" ? null : email.trim().toLowerCase(),
    username: username.trim(),
  }));
export type StaffCreationInput = z.output<typeof staffCreationFormSchema>;

/** Live form values; the acknowledgement is a plain checkbox until validated. */
export interface StaffCreationValues {
  email: string;
  fullName: string;
  phone: string;
  sharedPhone: boolean;
  username: string;
  verified: boolean;
}

/**
 * The recovery task's live fields. `verified` is the identity-evidence
 * acknowledgement; it gates the review and never leaves the browser.
 */
export const staffRecoveryFieldSchemas = {
  identityCheck: staffIdentityCheckSchema,
  targetUserId: opaqueId,
  verified: z.literal(true, {
    error: "請先確認已按以上方式核實身分。",
  }),
};

/** Explicit submission-boundary parse: the reviewed target/method are normalized before the request. */
export const staffRecoveryFormSchema = z
  .object(staffRecoveryFieldSchemas)
  .transform(({ identityCheck, targetUserId }) => ({
    identityCheck,
    targetUserId,
  }));
export type StaffRecoveryInput = z.output<typeof staffRecoveryFormSchema>;

/** Live recovery values; the acknowledgement is a plain checkbox until validated. */
export interface StaffRecoveryValues {
  identityCheck: StaffIdentityCheck;
  targetUserId: string;
  verified: boolean;
}

/** Session capability plus actor/target binding; no credential or plaintext is stored. */
export const storedStaffAccountOperationSchema = z
  .strictObject({
    action: staffAccountActionSchema,
    actorUserId: opaqueId,
    identityCheck: staffIdentityCheckSchema.optional(),
    key: z.uuid(),
    targetUserId: opaqueId.nullable(),
  })
  .refine((value) =>
    value.action === "assisted_account_created"
      ? value.targetUserId === null
      : value.targetUserId !== null
  );
export type StoredStaffAccountOperation = z.infer<
  typeof storedStaffAccountOperationSchema
>;

export const staffAccountReceiptSchema = z.object({
  action: staffAccountActionSchema,
  createdAt: z.int(),
  id: z.uuid(),
  targetUserId: opaqueId,
});
export type StaffAccountReceipt = z.infer<typeof staffAccountReceiptSchema>;

/** `receipt: null` is a confirmed "not found"; a credential is only ever optional. */
export const staffAccountResponseSchema = z.object({
  data: z.object({
    receipt: staffAccountReceiptSchema.nullable(),
    temporaryPassword: z.string().regex(temporaryPasswordPattern).optional(),
  }),
});

export const staffAccountErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const staffReceiptMatchesOperation = (
  receipt: StaffAccountReceipt,
  operation: StoredStaffAccountOperation
) =>
  receipt.action === operation.action &&
  (operation.targetUserId === null ||
    receipt.targetUserId === operation.targetUserId);
