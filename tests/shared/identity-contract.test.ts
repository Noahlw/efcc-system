import { describe, expect, it } from "vitest";

import {
  identityReceiptResponseSchema,
  ownPhoneRequestSchema,
  staffIdentityRequestSchema,
  storedIdentityOperationSchema,
} from "@/features/account/identity-contract";

describe("identity operation metadata", () => {
  const valid = {
    action: "own_phone_changed",
    actorUserId: "user-1",
    key: "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071",
    targetUserId: "user-2",
  };

  it("accepts the exact capability plus actor/target binding", () => {
    expect(storedIdentityOperationSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects malformed or unbound metadata", () => {
    expect(
      storedIdentityOperationSchema.safeParse({ ...valid, key: "not-a-key" })
        .success
    ).toBe(false);
    expect(
      storedIdentityOperationSchema.safeParse({
        ...valid,
        action: "account_deleted",
      }).success
    ).toBe(false);
    expect(
      storedIdentityOperationSchema.safeParse({ ...valid, actorUserId: "" })
        .success
    ).toBe(false);
    expect(
      storedIdentityOperationSchema.safeParse({ ...valid, targetUserId: "" })
        .success
    ).toBe(false);
    expect(storedIdentityOperationSchema.safeParse({}).success).toBe(false);
  });
});

describe("identity submission boundaries", () => {
  const key = "6f3d1c9a-3b2e-4c6f-8a1b-2c3d4e5f6071";

  it("keeps the existing own-phone and Staff identity payload shapes", () => {
    expect(
      ownPhoneRequestSchema.safeParse({ operationKey: key, phone: "60000000" })
        .success
    ).toBe(true);
    expect(
      staffIdentityRequestSchema.safeParse({
        email: null,
        fullName: "陳資料",
        identityCheck: "face_to_face",
        operationKey: key,
        phone: "+85260000000",
        sharedPhone: false,
        targetUserId: "user-2",
        username: "staff.fix",
      }).success
    ).toBe(true);
  });

  it("rejects missing operation identity or an unknown verification method", () => {
    expect(ownPhoneRequestSchema.safeParse({ phone: "60000000" }).success).toBe(
      false
    );
    expect(
      ownPhoneRequestSchema.safeParse({ operationKey: key, phone: "" }).success
    ).toBe(false);
    expect(
      staffIdentityRequestSchema.safeParse({
        email: null,
        fullName: "陳資料",
        identityCheck: "checked_somehow",
        operationKey: key,
        phone: "+85260000000",
        sharedPhone: false,
        targetUserId: "user-2",
        username: "staff.fix",
      }).success
    ).toBe(false);
  });
});

describe("identity receipt decoding", () => {
  const receipt = {
    action: "staff_identity_corrected",
    createdAt: 1_700_000_000,
    id: "9e2b7c41-5d3a-4f8b-9c1d-2e3f4a5b6c7d",
    targetUserId: "user-2",
  };

  it("accepts a matching receipt and an explicit not-found", () => {
    const found = identityReceiptResponseSchema.safeParse({
      data: { receipt },
    });
    expect(found.success && found.data.data.receipt).toEqual(receipt);
    expect(
      identityReceiptResponseSchema.safeParse({ data: { receipt: null } })
        .success
    ).toBe(true);
  });

  it("rejects invalid receipt windows and shapes", () => {
    expect(
      identityReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, createdAt: 1_700_000_000.5 } },
      }).success
    ).toBe(false);
    expect(
      identityReceiptResponseSchema.safeParse({
        data: { receipt: { ...receipt, targetUserId: "" } },
      }).success
    ).toBe(false);
    expect(identityReceiptResponseSchema.safeParse({ data: {} }).success).toBe(
      false
    );
  });
});
