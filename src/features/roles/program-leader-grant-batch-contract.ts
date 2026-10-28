import * as z from "zod";

// Seven worst-case escaped target IDs plus authority, Department and Program IDs
// occupy 7,840 request bytes; the maximal receipt envelope occupies 7,506 bytes.
// Eight exceed the 8,192-byte envelope (8,611 and 8,277 respectively).
export const PROGRAM_LEADER_GRANT_BATCH_LIMIT = 7;

const id = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());
const uniqueTargetUserIds = z
  .array(id)
  .min(1)
  .max(PROGRAM_LEADER_GRANT_BATCH_LIMIT)
  .refine((ids) => new Set(ids).size === ids.length, "每位會友只可選擇一次。");
const targetUserIds = uniqueTargetUserIds.transform((ids) => ids.toSorted());
const canonicalTargetUserIds = uniqueTargetUserIds.refine(
  (ids) =>
    ids.every((value, index) => index === 0 || (ids[index - 1] ?? "") < value),
  "收據的人士次序不正確。"
);
const selection = {
  authorityAssignmentId: id,
  expectedDepartmentId: id,
  scopeId: id,
  targetUserIds,
};

export const programLeaderGrantBatchSchema = z.strictObject({
  ...selection,
  operationKey,
});
export type ProgramLeaderGrantBatchInput = z.output<
  typeof programLeaderGrantBatchSchema
>;

export const programLeaderGrantBatchEligibilitySchema =
  z.strictObject(selection);
export type ProgramLeaderGrantBatchEligibilityInput = z.output<
  typeof programLeaderGrantBatchEligibilitySchema
>;

export const programLeaderGrantBatchEligibilityResultSchema = z.strictObject({
  actorUserId: id,
  authorityAssignmentId: id,
  eligible: z.literal(true),
  expectedDepartmentId: id,
  scopeId: id,
});
export type ProgramLeaderGrantBatchEligibilityResult = z.output<
  typeof programLeaderGrantBatchEligibilityResultSchema
>;

export const programLeaderGrantBatchReceiptSchema = z.strictObject({
  createdAt: z.number().int().nonnegative(),
  id,
  scopeId: id,
  scopeName: z.string().max(200),
  targetUserIds: canonicalTargetUserIds,
});
export type ProgramLeaderGrantBatchReceipt = z.output<
  typeof programLeaderGrantBatchReceiptSchema
>;

export const programLeaderGrantBatchResultSchema = z.strictObject({
  receipt: programLeaderGrantBatchReceiptSchema,
});
export type ProgramLeaderGrantBatchResult = z.output<
  typeof programLeaderGrantBatchResultSchema
>;
export const programLeaderGrantBatchReconciliationSchema = z.strictObject({
  operationKey,
});
export const programLeaderGrantBatchReconciliationResultSchema =
  z.discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("committed"),
      receipt: programLeaderGrantBatchReceiptSchema,
    }),
    z.strictObject({ outcome: z.literal("unknown"), receipt: z.null() }),
  ]);
export type ProgramLeaderGrantBatchReconciliationResult = z.output<
  typeof programLeaderGrantBatchReconciliationResultSchema
>;
