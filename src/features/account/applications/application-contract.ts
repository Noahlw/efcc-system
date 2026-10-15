import * as z from "zod";

import {
  accountIdentitySchema,
  identityFieldSchemas,
  phoneToCanonical,
} from "../identity-validation";

export const storedApplicationOperationKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u);

const boundedNote = z
  .string()
  .max(1000)
  .refine((value) => [...value].length <= 500);

export const applicationBodySchema = z.strictObject({
  email: accountIdentitySchema.shape.email,
  fullName: accountIdentitySchema.shape.fullName,
  group: boundedNote.optional(),
  intent: boundedNote.optional(),
  operationKey: z
    .string()
    .regex(/^[\da-f]{64}$/iu)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  phone: accountIdentitySchema.shape.phone,
  referral: boundedNote.optional(),
  username: accountIdentitySchema.shape.username,
});

export const reconciliationBodySchema = z.strictObject({
  operationKey: z
    .string()
    .regex(/^[\da-f]{64}$/iu)
    .transform((value) => value.toLowerCase()),
});

const validatePassword = (value: string): string | undefined => {
  if (value.length < 8) {
    return "密碼最少需要 8 個字元。";
  }
  return value.length <= 128 ? undefined : "密碼不可多於 128 個字元。";
};

const validateOptionalNote = (value: string): string | undefined =>
  value.length <= 500 ? undefined : "選填資料不可多於 500 個字元。";

const fieldSchema = (validate: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = validate(value);
    if (message) {
      context.addIssue({ code: "custom", message });
    }
  });

export const applicationFieldSchemas = {
  email: identityFieldSchemas.email,
  fullName: identityFieldSchemas.fullName,
  group: fieldSchema(validateOptionalNote),
  intent: fieldSchema(validateOptionalNote),
  password: fieldSchema(validatePassword),
  phone: identityFieldSchemas.phone,
  referral: fieldSchema(validateOptionalNote),
  username: identityFieldSchemas.username,
};

export const applicationFormSchema = z
  .object({
    email: applicationFieldSchemas.email,
    fullName: applicationFieldSchemas.fullName,
    group: applicationFieldSchemas.group,
    intent: applicationFieldSchemas.intent,
    password: applicationFieldSchemas.password,
    phone: applicationFieldSchemas.phone,
    referral: applicationFieldSchemas.referral,
    username: applicationFieldSchemas.username,
  })
  .transform(({ group, intent, referral, ...input }) => ({
    ...input,
    ...(referral ? { referral } : {}),
    ...(group ? { group } : {}),
    ...(intent ? { intent } : {}),
    email: input.email.trim().toLowerCase(),
    phone: phoneToCanonical(input.phone) ?? input.phone,
    username: input.username.trim(),
  }));

export const applicationCreatedResponseSchema = z.object({
  data: z.object({ outcome: z.literal("pending") }),
});

export const applicationReconciliationResponseSchema = z.object({
  data: z.object({ outcome: z.enum(["pending", "not_found"]) }),
});

export const applicantActionValues = [
  "application_corrected",
  "application_withdrawn",
  "application_resubmitted",
] as const;

const applicantOperationKey = z
  .uuid()
  .transform((value) => value.toLowerCase());

/**
 * Self-service applicant maintenance reuses the contact rules, never the
 * account-creation fields. Declaration order is the persisted replay
 * fingerprint: `createApplicantAction` hashes `JSON.stringify` of the parsed
 * value against `applicant_operation.request_hash`, so operationKey stays
 * first and the corrected contact fields stay in email, fullName, phone order.
 */
export const applicantActionSchema = z.discriminatedUnion("action", [
  // eslint-disable-next-line sort-keys -- Declaration order is the persisted replay fingerprint.
  z.strictObject({
    operationKey: applicantOperationKey,
    action: z.literal("application_corrected"),
    applicationId: z.uuid(),
    ...accountIdentitySchema.pick({ email: true, fullName: true, phone: true })
      .shape,
  }),
  // eslint-disable-next-line sort-keys -- Declaration order is the persisted replay fingerprint.
  z.strictObject({
    operationKey: applicantOperationKey,
    action: z.literal("application_withdrawn"),
    applicationId: z.uuid(),
  }),
  // eslint-disable-next-line sort-keys -- Declaration order is the persisted replay fingerprint.
  z.strictObject({
    operationKey: applicantOperationKey,
    action: z.literal("application_resubmitted"),
    applicationId: z.uuid(),
  }),
]);

export const applicantReconciliationBodySchema = z.strictObject({
  operationKey: applicantOperationKey,
});

export const applicantReceiptSchema = z.object({
  action: z.enum(applicantActionValues),
  applicationId: z.uuid(),
  createdAt: z.number().int(),
  id: z.uuid(),
});

export const applicantActionResponseSchema = z.object({
  data: z.object({ receipt: applicantReceiptSchema.nullable() }),
});
