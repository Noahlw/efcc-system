import { describe, expect, it } from "vitest";

import {
  deletionConfirmationSchema,
  deletionReceiptResponseSchema,
  deletionRequestSchema,
  storedDeletionOperationSchema,
} from "@/features/account/deletion-contract";

describe("deletion operation metadata", () => {
  const valid = {
    action: "account_deleted",
    actorUserId: "user-1",
    key: "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071",
    targetUserId: "user-2",
  };

  it("accepts the exact capability plus actor/target binding", () => {
    expect(storedDeletionOperationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects malformed, unbound or foreign-action metadata", () => {
    expect(
      storedDeletionOperationSchema.safeParse({ ...valid, key: "not-a-key" })
        .success
    ).toBe(false);
    expect(
      storedDeletionOperationSchema.safeParse({
        ...valid,
        action: "staff_identity_corrected",
      }).success
    ).toBe(false);
    expect(
      storedDeletionOperationSchema.safeParse({ ...valid, actorUserId: "" })
        .success
    ).toBe(false);
    expect(
      storedDeletionOperationSchema.safeParse({ ...valid, targetUserId: "" })
        .success
    ).toBe(false);
    expect(storedDeletionOperationSchema.safeParse({}).success).toBe(false);
  });
});

describe("deletion submission boundary", () => {
  const key = "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071";

  it("normalizes the operation key exactly as the existing route did", () => {
    const parsed = deletionRequestSchema.safeParse({
      operationKey: key.toUpperCase(),
      targetUserId: "user-2",
    });
    expect(parsed.success && parsed.data.operationKey).toBe(key);
  });

  it("rejects missing binding and extra request fields", () => {
    expect(deletionRequestSchema.safeParse({ operationKey: key }).success).toBe(
      false
    );
    expect(
      deletionRequestSchema.safeParse({ operationKey: key, targetUserId: "" })
        .success
    ).toBe(false);
    expect(
      deletionRequestSchema.safeParse({
        extra: true,
        operationKey: key,
        targetUserId: "user-2",
      }).success
    ).toBe(false);
  });
});

describe("deletion confirmation boundary", () => {
  it("requires the explicit destruction acknowledgement", () => {
    expect(deletionConfirmationSchema.safeParse(true).success).toBe(true);
    expect(deletionConfirmationSchema.safeParse(false).success).toBe(false);
  });
});

describe("deletion receipt decoding", () => {
  const receipt = {
    action: "account_deleted",
    createdAt: 1_700_000_000,
    id: "9e2b7c41-5d3a-4f8b-9c1d-2e3f4a5b6c7d",
    targetUserId: "user-2",
  };

  it("accepts the deletion receipt and an explicit not-found", () => {
    const found = deletionReceiptResponseSchema.safeParse({
      data: { receipt },
    });
    expect(found.success && found.data.data.receipt).toEqual(receipt);
    expect(
      deletionReceiptResponseSchema.safeParse({ data: { receipt: null } })
        .success
    ).toBe(true);
  });

  it("rejects foreign actions, fractional timestamps and missing data", () => {
    expect(
      deletionReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, action: "account_banned" } },
      }).success
    ).toBe(false);
    expect(
      deletionReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, createdAt: 1_700_000_000.5 } },
      }).success
    ).toBe(false);
    expect(deletionReceiptResponseSchema.safeParse({ data: {} }).success).toBe(
      false
    );
  });
});
