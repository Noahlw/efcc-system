import { describe, expect, it } from "vitest";

import {
  PROGRAM_LEADER_GRANT_BATCH_LIMIT,
  programLeaderGrantBatchReceiptSchema,
  programLeaderGrantBatchSchema,
} from "../../../src/features/roles/program-leader-grant-batch-contract";
import {
  scopedRoleChangeSchema,
  SCOPED_ROLE_CHANGE_LIMIT,
} from "../../../src/features/roles/scoped-role-change-contract";

const operationKey = "A72A4508-2045-4C55-B665-614810453435";
const grant = (scopeId: string) => ({
  action: "granted" as const,
  role: "department_manager" as const,
  scopeId,
});
const withdrawal = (scopeId: string, expectedAssignmentId: string) => ({
  action: "withdrawn" as const,
  expectedAssignmentId,
  role: "department_manager" as const,
  scopeId,
});
const identifier = (suffix: string) => `${"\u0001".repeat(127)}${suffix}`;
const escapedIdentifier = "\u0001".repeat(128);

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

  it("canonicalizes mixed roles, binds Program ownership, and rejects over-limit mixed sets", () => {
    const program = {
      action: "withdrawn" as const,
      expectedAssignmentId: "w",
      expectedDepartmentId: "d",
      role: "program_leader" as const,
      scopeId: "p",
    };
    const input = {
      changes: [program, grant("d")],
      operationKey,
      targetUserId: "target",
    };
    expect(scopedRoleChangeSchema.parse(input)).toEqual(
      scopedRoleChangeSchema.parse({
        ...input,
        changes: input.changes.toReversed(),
      })
    );
    expect(
      scopedRoleChangeSchema.safeParse({
        ...input,
        changes: [...input.changes, grant("other")],
      }).success
    ).toBe(false);
    expect(
      scopedRoleChangeSchema.safeParse({
        ...input,
        changes: [{ ...program, expectedDepartmentId: "" }],
      }).success
    ).toBe(false);
    expect(
      scopedRoleChangeSchema.safeParse({
        ...input,
        changes: [{ action: "granted", role: "program_leader", scopeId: "p" }],
      }).success
    ).toBe(false);
  });

  it("keeps maximum escaped two-Program withdrawals below the transport limit", () => {
    const command = {
      authorityAssignmentId: escapedIdentifier,
      changes: ["\u0002", "\u0003"].map((suffix) => ({
        action: "withdrawn" as const,
        expectedAssignmentId: escapedIdentifier,
        expectedDepartmentId: escapedIdentifier,
        role: "program_leader" as const,
        scopeId: identifier(suffix),
      })),
      operationKey,
      targetUserId: escapedIdentifier,
    };
    expect(scopedRoleChangeSchema.safeParse(command).success).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(command)).length
    ).toBeLessThanOrEqual(8192);
  });

  it("keeps a maximally escaped four-withdrawal envelope below the transport limit", () => {
    const command = {
      authorityAssignmentId: escapedIdentifier,
      changes: Array.from({ length: SCOPED_ROLE_CHANGE_LIMIT }, (_, index) =>
        withdrawal(
          identifier(String.fromCodePoint(index + 2)),
          escapedIdentifier
        )
      ),
      operationKey,
      targetUserId: escapedIdentifier,
    };
    expect(scopedRoleChangeSchema.safeParse(command).success).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(command)).length
    ).toBeLessThanOrEqual(8192);
  });
});

describe("local Program Leader grant batch", () => {
  it("canonicalizes the selected set and rejects duplicates and more than seven", () => {
    const input = {
      authorityAssignmentId: "authority",
      expectedDepartmentId: "department",
      operationKey,
      scopeId: "program",
      targetUserIds: ["b", "a"],
    };
    expect(programLeaderGrantBatchSchema.parse(input)).toEqual(
      programLeaderGrantBatchSchema.parse({
        ...input,
        targetUserIds: ["a", "b"],
      })
    );
    expect(
      programLeaderGrantBatchSchema.safeParse({
        ...input,
        targetUserIds: ["a", "a"],
      }).success
    ).toBe(false);
    expect(
      programLeaderGrantBatchSchema.safeParse({
        ...input,
        targetUserIds: Array.from(
          { length: PROGRAM_LEADER_GRANT_BATCH_LIMIT + 1 },
          (_, index) => String(index)
        ),
      }).success
    ).toBe(false);
  });

  it("requires canonical durable receipt order", () => {
    const receipt = {
      createdAt: 1,
      id: "receipt",
      scopeId: "program",
      scopeName: "聚會",
      targetUserIds: ["a", "b"],
    };
    expect(
      programLeaderGrantBatchReceiptSchema.safeParse(receipt).success
    ).toBe(true);
    expect(
      programLeaderGrantBatchReceiptSchema.safeParse({
        ...receipt,
        targetUserIds: ["b", "a"],
      }).success
    ).toBe(false);
  });

  it("bounds the maximally escaped seven-target request", () => {
    const input = {
      authorityAssignmentId: escapedIdentifier,
      expectedDepartmentId: escapedIdentifier,
      operationKey,
      scopeId: escapedIdentifier,
      targetUserIds: Array.from(
        { length: PROGRAM_LEADER_GRANT_BATCH_LIMIT },
        (_, index) => identifier(String.fromCodePoint(index + 14))
      ),
    };
    expect(programLeaderGrantBatchSchema.safeParse(input).success).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(input)).length
    ).toBeLessThanOrEqual(8192);
  });
});
