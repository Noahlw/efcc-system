import { describe, expect, it } from "vitest";

import {
  scopedRoleChangeSchema,
  SCOPED_ROLE_CHANGE_LIMIT,
} from "../../../src/features/roles/scoped-role-change-contract";

const operationKey = "A72A4508-2045-4C55-B665-614810453435";
const grant = (scopeId: string) => ({ action: "granted" as const, scopeId });
const withdrawal = (scopeId: string, expectedAssignmentId: string) => ({
  action: "withdrawn" as const,
  expectedAssignmentId,
  scopeId,
});
const identifier = (suffix: string) => `${"\u0001".repeat(127)}${suffix}`;

describe("person-scoped Department Manager changes", () => {
  it("canonicalizes equivalent sets and the operation key", () => {
    const first = {
      changes: [grant("b"), withdrawal("a", "witness")],
      operationKey,
      targetUserId: "target",
    };
    const second = { ...first, changes: first.changes.toReversed() };
    expect(scopedRoleChangeSchema.parse(first)).toEqual(
      scopedRoleChangeSchema.parse(second)
    );
    expect(scopedRoleChangeSchema.parse(first).operationKey).toBe(
      operationKey.toLowerCase()
    );
  });

  it("rejects empty, duplicate, contradictory, unwitnessed and oversized sets", () => {
    const input = { operationKey, targetUserId: "target" };
    for (const changes of [
      [],
      [grant("a"), grant("a")],
      [grant("a"), withdrawal("a", "id")],
      [{ action: "withdrawn", scopeId: "a" }],
      Array.from({ length: SCOPED_ROLE_CHANGE_LIMIT + 1 }, (_, i) =>
        grant(String(i))
      ),
    ]) {
      expect(
        scopedRoleChangeSchema.safeParse({ ...input, changes }).success
      ).toBe(false);
    }
    expect(
      scopedRoleChangeSchema.safeParse({
        ...input,
        changes: Array.from({ length: SCOPED_ROLE_CHANGE_LIMIT }, (_, i) =>
          grant(String(i))
        ),
      }).success
    ).toBe(true);
  });

  it("keeps a maximally escaped four-withdrawal envelope below the transport limit", () => {
    const command = {
      authorityAssignmentId: identifier("x"),
      changes: Array.from({ length: SCOPED_ROLE_CHANGE_LIMIT }, (_, index) =>
        withdrawal(identifier(String(index)), identifier("w"))
      ),
      operationKey,
      targetUserId: identifier("t"),
    };
    expect(scopedRoleChangeSchema.safeParse(command).success).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(command)).length
    ).toBeLessThanOrEqual(8192);
  });
});
