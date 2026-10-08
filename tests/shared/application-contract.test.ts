import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  accountIdentitySchema,
  applicantActionSchema,
  applicationBodySchema,
  applicationFieldSchemas,
} from "@/features/account/application-contract";

const serverInput = (fullName: string) => ({
  email: "full-name.boundary@example.test",
  fullName,
  operationKey: "a".repeat(64),
  password: "Synthetic-boundary-password!",
  phone: "60000000",
  username: "full.name.boundary",
});

const fieldMessage = (value: string): string | undefined => {
  const result = applicationFieldSchemas.fullName.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
};

const fieldPhoneMessage = (value: string): string | undefined => {
  const result = applicationFieldSchemas.phone.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
};

const serverPhone = (value: string): string | null => {
  const result = applicationBodySchema.shape.phone.safeParse(value);
  return result.success ? result.data : null;
};

const invalidPhoneMessage =
  "請輸入有效的香港電話號碼，或 E.164 國際格式（+ 國家碼及 8 至 15 位數字）。";

const fieldEmailMessage = (value: string): string | undefined => {
  const result = applicationFieldSchemas.email.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
};

const serverEmail = (value: string): string | null => {
  const result = applicationBodySchema.shape.email.safeParse(value);
  return result.success ? result.data : null;
};

const applicantCorrection = (email: string) => ({
  action: "application_corrected" as const,
  applicationId: randomUUID(),
  email,
  fullName: "陳測試",
  operationKey: randomUUID(),
  phone: "60000000",
});

const invalidEmailMessage = "請輸入有效的電郵地址；不可使用 .invalid 網域。";

describe("full-name boundary", () => {
  it("accepts exactly 100 code points and rejects 101 on both schemas", () => {
    const hundred = "陳".repeat(100);
    expect(fieldMessage(hundred)).toBeUndefined();
    expect(applicationBodySchema.safeParse(serverInput(hundred)).success).toBe(
      true
    );

    const hundredAndOne = "陳".repeat(101);
    expect(fieldMessage(hundredAndOne)).toBe("中文全名不可多於 100 個字元。");
    expect(
      applicationBodySchema.safeParse(serverInput(hundredAndOne)).success
    ).toBe(false);
  });

  it("counts code points, not UTF-16 units", () => {
    const astral = "𠀀".repeat(100);
    expect([...astral].length).toBe(100);
    expect(astral.length).toBe(200);
    expect(fieldMessage(astral)).toBeUndefined();
    expect(applicationBodySchema.safeParse(serverInput(astral)).success).toBe(
      true
    );
  });

  it("rejects empty canonical names and control characters with their messages", () => {
    expect(fieldMessage("")).toBe("請輸入中文全名。");
    expect(fieldMessage("　 　")).toBe("請輸入中文全名。");
    expect(fieldMessage("陳\u0000名")).toBe("中文全名不可包含控制字元。");
  });
});

describe("phone boundary", () => {
  it("accepts full-width digits through the same NFKC rule as the server", () => {
    for (const [input, canonical] of [
      ["６０００００００", "+85260000000"],
      ["＋８５２６０００００００", "+85260000000"],
    ] as const) {
      expect(fieldPhoneMessage(input)).toBeUndefined();
      expect(serverPhone(input)).toBe(canonical);
    }
  });

  it("canonicalizes the accepted local and international forms on the server", () => {
    for (const [input, canonical] of [
      ["60000000", "+85260000000"],
      ["6000 0000", "+85260000000"],
      ["85260000000", "+85260000000"],
      ["+85260000000", "+85260000000"],
      ["+8613800138000", "+8613800138000"],
    ] as const) {
      expect(fieldPhoneMessage(input)).toBeUndefined();
      expect(serverPhone(input)).toBe(canonical);
    }
  });

  it("keeps the required message distinct and rejects malformed Hong Kong numbers", () => {
    expect(fieldPhoneMessage("")).toBe("請輸入電話號碼。");
    expect(fieldPhoneMessage("  ")).toBe("請輸入電話號碼。");
    expect(fieldPhoneMessage("123")).toBe(invalidPhoneMessage);
    expect(fieldPhoneMessage("+85201234567")).toBe(invalidPhoneMessage);
    expect(serverPhone("+85201234567")).toBeNull();
    expect(fieldPhoneMessage("+852600000000")).toBe(invalidPhoneMessage);
    expect(serverPhone("+852600000000")).toBeNull();
  });
});

describe("account email boundary", () => {
  it("rejects a one-character TLD on the field and both write contracts", () => {
    expect(fieldEmailMessage("a@b.c")).toBe(invalidEmailMessage);
    expect(serverEmail("a@b.c")).toBeNull();
    expect(accountIdentitySchema.shape.email.safeParse("a@b.c").success).toBe(
      false
    );
    expect(
      applicantActionSchema.safeParse(applicantCorrection("a@b.c")).success
    ).toBe(false);
    expect(
      applicantActionSchema.safeParse(applicantCorrection("member@example.com"))
        .success
    ).toBe(true);
  });

  it("keeps the required message, normalization, the 254 bound and .invalid rejection", () => {
    expect(fieldEmailMessage("   ")).toBe("請輸入電郵地址。");
    expect(fieldEmailMessage("  Member@Example.COM ")).toBeUndefined();
    expect(serverEmail("  Member@Example.COM ")).toBe("member@example.com");
    expect(fieldEmailMessage("member@example.invalid")).toBe(
      invalidEmailMessage
    );
    expect(serverEmail("member@example.invalid")).toBeNull();

    const at254 = `${"a".repeat(64)}@${"b".repeat(185)}.com`;
    expect(at254).toHaveLength(254);
    expect(fieldEmailMessage(at254)).toBeUndefined();
    expect(serverEmail(at254)).toBe(at254);

    const over254 = `${at254}m`;
    expect(fieldEmailMessage(over254)).toBe(invalidEmailMessage);
    expect(serverEmail(over254)).toBeNull();
  });
});

describe("applicant action fingerprint order", () => {
  it("parses every action in the pre-cutover persisted key order", () => {
    const applicationId = randomUUID();
    const operationKey = randomUUID();
    const corrected = applicantActionSchema.parse({
      action: "application_corrected",
      applicationId,
      email: " Member@Example.COM ",
      fullName: "陳測試",
      operationKey,
      phone: "60000000",
    });
    expect(Object.keys(corrected)).toEqual([
      "operationKey",
      "action",
      "applicationId",
      "email",
      "fullName",
      "phone",
    ]);
    expect(corrected).toEqual({
      action: "application_corrected",
      applicationId,
      email: "member@example.com",
      fullName: "陳測試",
      operationKey,
      phone: "+85260000000",
    });
    const withdrawn = applicantActionSchema.parse({
      action: "application_withdrawn",
      applicationId,
      operationKey,
    });
    expect(Object.keys(withdrawn)).toEqual([
      "operationKey",
      "action",
      "applicationId",
    ]);
    const resubmitted = applicantActionSchema.parse({
      action: "application_resubmitted",
      applicationId,
      operationKey,
    });
    expect(Object.keys(resubmitted)).toEqual([
      "operationKey",
      "action",
      "applicationId",
    ]);
  });
});
