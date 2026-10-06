import { describe, expect, it } from "vitest";

import {
  restrictionReceiptResponseSchema,
  restrictionRequestSchema,
  storedRestrictionOperationSchema,
} from "@/features/account/restriction-contract";

describe("restriction operation metadata", () => {
  const valid = {
    action: "membership_deactivated",
    actorUserId: "user-1",
    key: "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071",
    targetUserId: "user-2",
  };

  it("accepts the exact capability plus actor/target binding", () => {
    expect(storedRestrictionOperationSchema.safeParse(valid).success).toBe(
      true
    );
    expect(
      storedRestrictionOperationSchema.safeParse({ ...valid, rejected: true })
        .success
    ).toBe(true);
  });

  it("rejects malformed, unbound or non-definitive metadata", () => {
    expect(
      storedRestrictionOperationSchema.safeParse({ ...valid, key: "not-a-key" })
        .success
    ).toBe(false);
    expect(
      storedRestrictionOperationSchema.safeParse({
        ...valid,
        action: "password_changed",
      }).success
    ).toBe(false);
    expect(
      storedRestrictionOperationSchema.safeParse({ ...valid, actorUserId: "" })
        .success
    ).toBe(false);
    expect(
      storedRestrictionOperationSchema.safeParse({ ...valid, targetUserId: "" })
        .success
    ).toBe(false);
    expect(
      storedRestrictionOperationSchema.safeParse({ ...valid, rejected: false })
        .success
    ).toBe(false);
    expect(storedRestrictionOperationSchema.safeParse({}).success).toBe(false);
  });
});

describe("restriction submission boundary", () => {
  const key = "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071";

  it("keeps the existing independent action payload", () => {
    const parsed = restrictionRequestSchema.safeParse({
      action: "account_banned",
      operationKey: key.toUpperCase(),
      targetUserId: "user-2",
    });
    expect(parsed.success && parsed.data.operationKey).toBe(key);
    for (const action of [
      "account_unbanned",
      "membership_deactivated",
      "membership_reactivated",
    ]) {
      expect(
        restrictionRequestSchema.safeParse({
          action,
          operationKey: key,
          targetUserId: "user-2",
        }).success
      ).toBe(true);
    }
  });

  it("rejects unknown actions, unbound targets and extra fields", () => {
    expect(
      restrictionRequestSchema.safeParse({
        action: "membership_reactivated",
        operationKey: key,
      }).success
    ).toBe(false);
    expect(
      restrictionRequestSchema.safeParse({
        action: "combined_access_toggle",
        operationKey: key,
        targetUserId: "user-2",
      }).success
    ).toBe(false);
    expect(
      restrictionRequestSchema.safeParse({
        action: "account_banned",
        operationKey: key,
        reason: "because",
        targetUserId: "user-2",
      }).success
    ).toBe(false);
  });
});

describe("restriction receipt decoding", () => {
  const receipt = {
    action: "account_banned",
    createdAt: 1_700_000_000,
    id: "9e2b7c41-5d3a-4f8b-9c1d-2e3f4a5b6c7d",
    targetUserId: "user-2",
  };

  it("accepts a matching receipt and an explicit not-found", () => {
    const found = restrictionReceiptResponseSchema.safeParse({
      data: { receipt },
    });
    expect(found.success && found.data.data.receipt).toEqual(receipt);
    expect(
      restrictionReceiptResponseSchema.safeParse({ data: { receipt: null } })
        .success
    ).toBe(true);
  });

  it("rejects invalid receipt windows and shapes", () => {
    expect(
      restrictionReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, createdAt: 1_700_000_000.5 } },
      }).success
    ).toBe(false);
    expect(
      restrictionReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, targetUserId: "" } },
      }).success
    ).toBe(false);
    expect(
      restrictionReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, action: "combined_access_toggle" } },
      }).success
    ).toBe(false);
    expect(
      restrictionReceiptResponseSchema.safeParse({ data: {} }).success
    ).toBe(false);
  });
});
