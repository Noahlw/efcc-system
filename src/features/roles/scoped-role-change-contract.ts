import * as z from "zod";

// Four worst-case JSON-escaped 128-unit scope/witness pairs plus target and
// authority IDs fit within the existing 8192-byte request envelope.
export const SCOPED_ROLE_CHANGE_LIMIT = 4;

const id = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());
const entry = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("granted"), scopeId: id }),
  z.strictObject({
    action: z.literal("withdrawn"),
    expectedAssignmentId: id,
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
      new Set(changes.map((change) => change.scopeId)).size === changes.length,
    { message: "每個部門只可選擇一次。", path: ["changes"] }
  )
  .transform((input) => ({
    ...input,
    changes: input.changes.toSorted((a, b) => {
      if (a.scopeId < b.scopeId) {
        return -1;
      }
      return a.scopeId > b.scopeId ? 1 : 0;
    }),
  }));

export type ScopedRoleChangeInput = z.output<typeof scopedRoleChangeSchema>;

export const scopedRoleChangeReceiptSchema = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        action: z.enum(["granted", "withdrawn"]),
        scopeId: id,
        scopeName: z.string().max(200),
      })
    )
    .min(1)
    .max(SCOPED_ROLE_CHANGE_LIMIT),
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
  page: z.number().int().positive(),
});

export const scopedRoleReconciliationSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("committed"),
    receipt: scopedRoleChangeReceiptSchema,
  }),
  z.strictObject({ outcome: z.literal("unknown"), receipt: z.null() }),
]);
