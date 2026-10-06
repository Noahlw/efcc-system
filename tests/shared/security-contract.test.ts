import { describe, expect, it } from "vitest";

import {
  securityReceiptResponseSchema,
  storedSecurityOperationSchema,
} from "@/features/account/security-contract";

describe("security operation metadata", () => {
  const valid = {
    action: "password_changed",
    actorUserId: "user-1",
    key: "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071",
  };

  it("accepts the exact capability plus actor/action binding", () => {
    expect(storedSecurityOperationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects malformed or unbound metadata", () => {
    expect(
      storedSecurityOperationSchema.safeParse({ ...valid, key: "not-a-key" })
        .success
    ).toBe(false);
    expect(
      storedSecurityOperationSchema.safeParse({ ...valid, action: "unknown" })
        .success
    ).toBe(false);
    expect(
      storedSecurityOperationSchema.safeParse({ ...valid, actorUserId: "" })
        .success
    ).toBe(false);
    expect(storedSecurityOperationSchema.safeParse({}).success).toBe(false);
  });
});

describe("security receipt decoding", () => {
  const receipt = {
    action: "password_confirmed",
    createdAt: 1_700_000_000,
    id: "9e2b7c41-5d3a-4f8b-9c1d-2e3f4a5b6c7d",
  };

  it("accepts a matching receipt and an explicit not-found", () => {
    const found = securityReceiptResponseSchema.safeParse({
      data: { receipt },
    });
    expect(found.success && found.data.data.receipt).toEqual(receipt);
    expect(
      securityReceiptResponseSchema.safeParse({ data: { receipt: null } })
        .success
    ).toBe(true);
  });

  it("rejects invalid receipt windows and shapes", () => {
    expect(
      securityReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, createdAt: 1_700_000_000.5 } },
      }).success
    ).toBe(false);
    expect(
      securityReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, action: "password_reset" } },
      }).success
    ).toBe(false);
    expect(securityReceiptResponseSchema.safeParse({ data: {} }).success).toBe(
      false
    );
  });
});
