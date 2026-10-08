import * as z from "zod";

import { canonicalNameKey } from "../identity/name-matching";

const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;
const phonePattern = /^\+[1-9]\d{7,14}$/u;
export const storedApplicationOperationKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u);

/**
 * One client-safe account email rule shared by the field rules and both write
 * contracts: at most 254 characters, the Zod email shape and no `.invalid`
 * domain. Input is already trimmed and lowercased.
 */
const accountEmailShape = z
  .string()
  .max(254)
  .pipe(z.email())
  .refine(
    (value) => !value.slice(value.lastIndexOf("@") + 1).endsWith(".invalid")
  );

const phoneToCanonical = (value: string): string | null => {
  const compact = value
    .normalize("NFKC")
    .trim()
    .replaceAll(/[ .()-]/gu, "");
  const local = /^[2-9]\d{7}$/u.exec(compact)?.[0];
  if (local) {
    return `+852${local}`;
  }
  const hongKong = /^\+?852(?<subscriber>[2-9]\d{7})$/u.exec(compact)?.groups
    ?.subscriber;
  if (hongKong) {
    return `+852${hongKong}`;
  }
  if (/^\+?852/u.test(compact)) {
    return null;
  }
  return phonePattern.test(compact) ? compact : null;
};

type FullNameViolation = "canonical" | "control" | "length";

/** Canonical non-empty name, at most 100 Unicode code points, no control characters. */
const fullNameViolation = (value: string): FullNameViolation | null => {
  if (canonicalNameKey(value).length === 0) {
    return "canonical";
  }
  if ([...value].length > 100) {
    return "length";
  }
  return /\p{Cc}/u.test(value) ? "control" : null;
};

const fullNameViolationMessages: Record<FullNameViolation, string> = {
  canonical: "請輸入中文全名。",
  control: "中文全名不可包含控制字元。",
  length: "中文全名不可多於 100 個字元。",
};

const boundedNote = z
  .string()
  .max(1000)
  .refine((value) => [...value].length <= 500);

export const applicationBodySchema = z.strictObject({
  email: z
    .string()
    .max(512)
    .transform((value) => value.trim().toLowerCase())
    .pipe(accountEmailShape),
  fullName: z
    .string()
    .max(200)
    .refine((value) => fullNameViolation(value) === null),
  group: boundedNote.optional(),
  intent: boundedNote.optional(),
  operationKey: z
    .string()
    .regex(/^[\da-f]{64}$/iu)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  phone: z
    .string()
    .max(40)
    .refine((value) => phoneToCanonical(value) !== null)
    .transform((value) => phoneToCanonical(value) ?? ""),
  referral: boundedNote.optional(),
  username: z.string().regex(usernamePattern),
});

export const reconciliationBodySchema = z.strictObject({
  operationKey: z
    .string()
    .regex(/^[\da-f]{64}$/iu)
    .transform((value) => value.toLowerCase()),
});

export const accountIdentitySchema = applicationBodySchema.pick({
  email: true,
  fullName: true,
  phone: true,
  username: true,
});

const validatePhone = (value: string): string | undefined => {
  if (value.trim() === "") {
    return "請輸入電話號碼。";
  }
  return phoneToCanonical(value) === null
    ? "請輸入有效的香港電話號碼，或 E.164 國際格式（+ 國家碼及 8 至 15 位數字）。"
    : undefined;
};

/** The shared account email shape rule; `email` is already trimmed and lowercased. */
export const isValidAccountEmail = (email: string): boolean =>
  accountEmailShape.safeParse(email).success;

const validateEmail = (value: string): string | undefined => {
  const email = value.trim().toLowerCase();
  if (!email) {
    return "請輸入電郵地址。";
  }
  return isValidAccountEmail(email)
    ? undefined
    : "請輸入有效的電郵地址；不可使用 .invalid 網域。";
};

const validateFullName = (value: string): string | undefined => {
  const violation = fullNameViolation(value);
  return violation ? fullNameViolationMessages[violation] : undefined;
};

const validateUsername = (value: string): string | undefined => {
  const username = value.trim();
  if (!username) {
    return "請設定使用者名稱。";
  }
  return usernamePattern.test(username)
    ? undefined
    : "使用者名稱需為 3–30 個英文字母、數字、底線或點。";
};

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
  email: fieldSchema(validateEmail),
  fullName: fieldSchema(validateFullName),
  group: fieldSchema(validateOptionalNote),
  intent: fieldSchema(validateOptionalNote),
  password: fieldSchema(validatePassword),
  phone: fieldSchema(validatePhone),
  referral: fieldSchema(validateOptionalNote),
  username: fieldSchema(validateUsername),
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
