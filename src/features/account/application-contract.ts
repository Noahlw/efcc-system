import * as z from "zod";

import { canonicalNameKey } from "../identity/name-matching";

const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const phonePattern = /^\+[1-9]\d{7,14}$/u;
export const storedApplicationOperationKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u);

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
  return /^\+[1-9]\d{7,14}$/u.test(compact) ? compact : null;
};

const isValidFullName = (value: string): boolean => {
  const { length } = [...value];
  return (
    length >= 1 &&
    length <= 100 &&
    canonicalNameKey(value).length > 0 &&
    !/\p{Cc}/u.test(value)
  );
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
    .pipe(z.email().max(254))
    .refine(
      (value) => !value.slice(value.lastIndexOf("@")).endsWith(".invalid")
    ),
  fullName: z.string().max(200).refine(isValidFullName),
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
  const compact = value.trim().replaceAll(/[ ().-]/gu, "");
  if (!compact) {
    return "請輸入電話號碼。";
  }
  const invalidHongKongPrefix =
    /^(?:\+?852)\d{8}$/u.test(compact) && !/^\+?852[2-9]\d{7}$/u.test(compact);
  const valid =
    /^[2-9]\d{7}$/u.test(compact) ||
    /^\+?852[2-9]\d{7}$/u.test(compact) ||
    (compact.startsWith("+") && phonePattern.test(compact));
  return valid && !invalidHongKongPrefix
    ? undefined
    : "請輸入有效的香港電話號碼，或 E.164 國際格式（+ 國家碼及 8 至 15 位數字）。";
};

const validateEmail = (value: string): string | undefined => {
  const email = value.trim().toLowerCase();
  if (!email) {
    return "請輸入電郵地址。";
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return email.length <= 254 &&
    emailPattern.test(email) &&
    !domain.endsWith(".invalid")
    ? undefined
    : "請輸入有效的電郵地址；不可使用 .invalid 網域。";
};

const validateFullName = (value: string): string | undefined => {
  if (!canonicalNameKey(value)) {
    return "請輸入中文全名。";
  }
  let codePointCount = 0;
  for (const _ of value) {
    codePointCount += 1;
    if (codePointCount > 100) {
      return "中文全名不可多於 100 個字元。";
    }
  }
  return /\p{Cc}/u.test(value) ? "中文全名不可包含控制字元。" : undefined;
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

const canonicalPhone = (value: string): string => {
  const compact = value.trim().replaceAll(/[ ().-]/gu, "");
  if (/^[2-9]\d{7}$/u.test(compact)) {
    return `+852${compact}`;
  }
  if (/^852[2-9]\d{7}$/u.test(compact)) {
    return `+${compact}`;
  }
  return compact;
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
    phone: canonicalPhone(input.phone),
    username: input.username.trim(),
  }));

export const applicationCreatedResponseSchema = z.object({
  data: z.object({ outcome: z.literal("pending") }),
});

export const applicationReconciliationResponseSchema = z.object({
  data: z.object({ outcome: z.enum(["pending", "not_found"]) }),
});
