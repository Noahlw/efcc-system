import * as z from "zod";

const targetId = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());

export const programLeaderGrantSchema = z.strictObject({
  action: z.literal("granted"),
  operationKey,
  scopeId: targetId,
  targetUserId: targetId,
});

export const programLeaderWithdrawalSchema = z.strictObject({
  action: z.literal("withdrawn"),
  expectedAssignmentId: targetId,
  operationKey,
  scopeId: targetId,
  targetUserId: targetId,
});

export const programLeaderChangeSchema = z.discriminatedUnion("action", [
  programLeaderGrantSchema,
  programLeaderWithdrawalSchema,
]);

export type ProgramLeaderChangeInput = z.output<
  typeof programLeaderChangeSchema
>;

export const programLeaderReconciliationSchema = z.strictObject({
  operationKey,
});

export const programLeaderReceiptSchema = z.strictObject({
  action: z.enum(["granted", "withdrawn"]),
  createdAt: z.number().int().nonnegative(),
  id: z.string().min(1).max(128),
  scopeId: z.string().min(1).max(128),
  scopeName: z.string().max(200),
  targetUserId: z.string().min(1).max(128),
});

export type ProgramLeaderReceipt = z.output<typeof programLeaderReceiptSchema>;
