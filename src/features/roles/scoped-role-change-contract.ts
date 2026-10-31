import * as z from "zod";

// Four DM changes fit the 8192-byte envelope; mixed sets permit two because
// each Program change also carries its reviewed Department ownership.
export const SCOPED_ROLE_CHANGE_LIMIT = 4;
export const MIXED_SCOPED_ROLE_CHANGE_LIMIT = 2;

const id = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());
const entry = z.union([
  z.strictObject({
    action: z.literal("granted"),
    role: z.literal("department_manager"),
    scopeId: id,
  }),
  z.strictObject({
    action: z.literal("withdrawn"),
    expectedAssignmentId: id,
    role: z.literal("department_manager"),
    scopeId: id,
  }),
  z.strictObject({
    action: z.literal("granted"),
    expectedDepartmentId: id,
    role: z.literal("program_leader"),
    scopeId: id,
  }),
  z.strictObject({
    action: z.literal("withdrawn"),
    expectedAssignmentId: id,
    expectedDepartmentId: id,
    role: z.literal("program_leader"),
    scopeId: id,
  }),
]);

export const scopedRoleChangeSchema = z
  .strictObject({
    authorityAssignmentId: id.optional(),
    changes: z.array(entry).min(1).max(SCOPED_ROLE_CHANGE_LIMIT),
    operationKey,
    targetUserId: id,
  })
  .refine(
    ({ changes }) =>
      new Set(
        changes.map((change) => JSON.stringify([change.role, change.scopeId]))
      ).size === changes.length,
    { message: "每個職務只可選擇一次。", path: ["changes"] }
  )
  .refine(
    ({ changes }) =>
      !changes.some((change) => change.role === "program_leader") ||
      changes.length <= MIXED_SCOPED_ROLE_CHANGE_LIMIT,
    { message: "包含聚會職務時，每次最多兩項更改。", path: ["changes"] }
  )
  .transform((input) => ({
    ...input,
    changes: input.changes.toSorted((a, b) => {
      if (a.role !== b.role) {
        return a.role < b.role ? -1 : 1;
      }
      if (a.scopeId < b.scopeId) {
        return -1;
      }
      return a.scopeId > b.scopeId ? 1 : 0;
    }),
  }));

export type ScopedRoleChangeInput = z.output<typeof scopedRoleChangeSchema>;

const receiptEntry = z.strictObject({
  action: z.enum(["granted", "withdrawn"]),
  role: z.enum(["department_manager", "program_leader"]),
  scopeId: id,
  scopeName: z.string().max(200),
});
const legacyReceiptEntry = z.strictObject({
  action: z.enum(["granted", "withdrawn"]),
  scopeId: id,
  scopeName: z.string().max(200),
});

// Only persisted pre-mixed receipts may omit the role.
export const legacyScopedRoleChangeReceiptSchema = z
  .strictObject({
    changes: z.array(legacyReceiptEntry).min(1).max(SCOPED_ROLE_CHANGE_LIMIT),
    createdAt: z.number().int().nonnegative(),
    id,
    targetUserId: id,
  })
  .transform((receipt) => ({
    ...receipt,
    changes: receipt.changes.map((change) => ({
      ...change,
      role: "department_manager" as const,
    })),
  }));

export const scopedRoleChangeReceiptSchema = z.strictObject({
  changes: z.array(receiptEntry).min(1).max(SCOPED_ROLE_CHANGE_LIMIT),
  createdAt: z.number().int().nonnegative(),
  id,
  targetUserId: id,
});

export type ScopedRoleChangeReceipt = z.output<
  typeof scopedRoleChangeReceiptSchema
>;

export const scopedRoleBaselineSchema = z.strictObject({
  actorKind: z.enum(["admin", "role-assigner"]),
  actorUserId: id,
  authorityAssignmentId: id.nullable(),
  changeLimit: z.literal(SCOPED_ROLE_CHANGE_LIMIT),
  departments: z
    .array(
      z.strictObject({
        assignmentId: id.nullable(),
        scopeId: id,
        scopeName: z.string(),
      })
    )
    .max(25),
  eligibleForGrant: z.boolean(),
  hasNextPage: z.boolean(),
  mixedChangeLimit: z.literal(MIXED_SCOPED_ROLE_CHANGE_LIMIT),
  page: z.number().int().positive(),
});

export const scopedRoleProgramBaselineSchema = z.strictObject({
  actorKind: z.enum(["admin", "role-assigner"]),
  actorUserId: id,
  authorityAssignmentId: id.nullable(),
  departmentId: id,
  departmentName: z.string(),
  eligibleForGrant: z.boolean(),
  hasNextPage: z.boolean(),
  page: z.number().int().positive(),
  programs: z
    .array(
      z.strictObject({
        assignmentId: id.nullable(),
        scopeId: id,
        scopeName: z.string(),
      })
    )
    .max(25),
});

export const scopedRoleReconciliationSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("committed"),
    receipt: scopedRoleChangeReceiptSchema,
  }),
  z.strictObject({ outcome: z.literal("unknown"), receipt: z.null() }),
]);
