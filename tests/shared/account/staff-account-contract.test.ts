import { describe, expect, it } from "vitest";

import {
  staffAccountResponseSchema,
  staffCreationFormSchema,
  staffReceiptMatchesOperation,
  staffRecoveryFormSchema,
  storedStaffAccountOperationSchema,
} from "@/features/account/assisted-accounts/staff-account-contract";
import type { StaffAccountReceipt } from "@/features/account/assisted-accounts/staff-account-contract";

const draft = {
  email: "  Member@Example.ORG ",
  fullName: "陳新會員",
  phone: "61234567",
  sharedPhone: false,
  username: " new.member ",
  verified: true as const,
};

describe("assisted creation form boundary", () => {
  it("normalizes the reviewed payload and drops the acknowledgement", () => {
    const parsed = staffCreationFormSchema.parse(draft);
    expect(parsed).toEqual({
      email: "member@example.org",
      fullName: "陳新會員",
      phone: "61234567",
      sharedPhone: false,
      username: "new.member",
    });
    expect("verified" in parsed).toBe(false);
  });

  it("keeps an absent email nullable and rejects unresolvable identity", () => {
    expect(staffCreationFormSchema.parse({ ...draft, email: "  " }).email).toBe(
      null
    );
    for (const invalid of [
      { ...draft, verified: false },
      { ...draft, username: "ab" },
      { ...draft, phone: "1234567" },
      { ...draft, email: "member@example.invalid" },
      { ...draft, email: "a@b.c" },
      { ...draft, fullName: "   " },
    ]) {
      expect(staffCreationFormSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("staff recovery form boundary", () => {
  const review = {
    identityCheck: "verified_phone",
    targetUserId: "member-2",
    verified: true as const,
  };

  it("keeps the reviewed target and method and drops the acknowledgement", () => {
    const parsed = staffRecoveryFormSchema.parse(review);
    expect(parsed).toEqual({
      identityCheck: "verified_phone",
      targetUserId: "member-2",
    });
    expect("verified" in parsed).toBe(false);
  });

  it("rejects an unchecked acknowledgement, a missing target or an unknown method", () => {
    for (const invalid of [
      { ...review, verified: false },
      { ...review, targetUserId: "" },
      { ...review, identityCheck: "sms" },
    ]) {
      expect(staffRecoveryFormSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("staff operation metadata", () => {
  const created = {
    action: "assisted_account_created",
    actorUserId: "staff-1",
    key: "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071",
    targetUserId: null,
  };

  it("binds the creation reference to the actor without a plaintext field", () => {
    const parsed = storedStaffAccountOperationSchema.parse(created);
    expect(parsed).toEqual(created);
    expect("password" in parsed).toBe(false);
  });

  it("requires a target for recovery and rejects unbound metadata", () => {
    expect(
      storedStaffAccountOperationSchema.safeParse({
        ...created,
        action: "staff_password_reset",
      }).success
    ).toBe(false);
    expect(
      storedStaffAccountOperationSchema.safeParse({
        ...created,
        action: "staff_password_reset",
        identityCheck: "face_to_face",
        targetUserId: "member-1",
      }).success
    ).toBe(true);
    expect(
      storedStaffAccountOperationSchema.safeParse({ ...created, key: "key" })
        .success
    ).toBe(false);
    expect(
      storedStaffAccountOperationSchema.safeParse({
        ...created,
        password: "plaintext",
      }).success
    ).toBe(false);
  });
});

describe("staff receipt decoding", () => {
  const receipt: StaffAccountReceipt = {
    action: "assisted_account_created",
    createdAt: 1_700_000_000,
    id: "9e2b7c41-5d3a-4f8b-9c1d-2e3f4a5b6c7d",
    targetUserId: "member-1",
  };

  it("accepts a one-time credential and an explicit not-found", () => {
    const oneTime = staffAccountResponseSchema.safeParse({
      data: {
        receipt,
        temporaryPassword: "a".repeat(32),
        temporaryPasswordExpiresAt: 1_700_604_800,
      },
    });
    expect(oneTime.success && oneTime.data.data).toEqual({
      receipt,
      temporaryPassword: "a".repeat(32),
      temporaryPasswordExpiresAt: 1_700_604_800,
    });
    expect(
      staffAccountResponseSchema.safeParse({ data: { receipt: null } }).success
    ).toBe(true);
    expect(
      staffAccountResponseSchema.safeParse({ data: { receipt } }).success
    ).toBe(true);
  });

  it("rejects incomplete credentials, malformed receipts and mismatched operations", () => {
    expect(
      staffAccountResponseSchema.safeParse({
        data: { receipt, temporaryPassword: "too-short" },
      }).success
    ).toBe(false);
    for (const data of [
      { receipt, temporaryPassword: "a".repeat(32) },
      { receipt, temporaryPasswordExpiresAt: 1_700_604_800 },
      {
        receipt: null,
        temporaryPassword: "a".repeat(32),
        temporaryPasswordExpiresAt: 1_700_604_800,
      },
      {
        receipt,
        temporaryPassword: "a".repeat(32),
        temporaryPasswordExpiresAt: 1_700_604_800.5,
      },
    ]) {
      expect(staffAccountResponseSchema.safeParse({ data }).success).toBe(
        false
      );
    }
    expect(
      staffAccountResponseSchema.safeParse({
        data: { receipt: { ...receipt, createdAt: 1_700_000_000.5 } },
      }).success
    ).toBe(false);
    expect(
      staffReceiptMatchesOperation(
        { ...receipt, action: "staff_password_reset" },
        {
          action: "assisted_account_created",
          actorUserId: "staff-1",
          key: "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071",
          targetUserId: null,
        }
      )
    ).toBe(false);
  });
});
