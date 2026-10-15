import * as z from "zod";

import { canonicalNameKey } from "../identity/name-matching";

const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;
const phonePattern = /^\+[1-9]\d{7,14}$/u;
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

export const phoneToCanonical = (value: string): string | null => {
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

export const accountIdentitySchema = z.strictObject({
  email: z
    .string()
    .max(512)
    .transform((value) => value.trim().toLowerCase())
    .pipe(accountEmailShape),
  fullName: z
    .string()
    .max(200)
    .refine((value) => fullNameViolation(value) === null),
  phone: z
    .string()
    .max(40)
    .refine((value) => phoneToCanonical(value) !== null)
    .transform((value) => phoneToCanonical(value) ?? ""),
  username: z.string().regex(usernamePattern),
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

const fieldSchema = (validate: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = validate(value);
    if (message) {
      context.addIssue({ code: "custom", message });
    }
  });

export const identityFieldSchemas = {
  email: fieldSchema(validateEmail),
  fullName: fieldSchema(validateFullName),
  phone: fieldSchema(validatePhone),
  username: fieldSchema(validateUsername),
};
