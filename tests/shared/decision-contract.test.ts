import { describe, expect, it } from "vitest";

import { storedDecisionOperationSchema } from "@/features/account/decision-contract";

const operation = {
  actorUserId: "staff-1",
  applicationId: "123e4567-e89b-42d3-a456-426614174000",
  key: "123e4567-e89b-42d3-a456-426614174001",
  outcome: "approved",
} as const;

describe("stored decision operation", () => {
  it("validates the bound reference and drops unrelated local fields", () => {
    expect(
      storedDecisionOperationSchema.parse({ ...operation, ignored: true })
    ).toEqual(operation);
  });

  it("rejects invalid ids, missing actors and unsupported outcomes", () => {
    expect(
      storedDecisionOperationSchema.safeParse({
        ...operation,
        applicationId: "not-an-id",
      }).success
    ).toBe(false);
    expect(
      storedDecisionOperationSchema.safeParse({
        ...operation,
        actorUserId: "",
      }).success
    ).toBe(false);
    expect(
      storedDecisionOperationSchema.safeParse({
        ...operation,
        outcome: "pending",
      }).success
    ).toBe(false);
  });
});
