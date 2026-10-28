import * as z from "zod";

const targetId = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());

export const departmentManagerGrantSchema = z.strictObject({
  action: z.literal("granted"),
  authorityAssignmentId: targetId.optional(),
  operationKey,
  scopeId: targetId,
  targetUserId: targetId,
});

export const departmentManagerWithdrawalSchema = z.strictObject({
  action: z.literal("withdrawn"),
  authorityAssignmentId: targetId.optional(),
  expectedAssignmentId: targetId,
  operationKey,
  scopeId: targetId,
  targetUserId: targetId,
});

export const departmentManagerChangeSchema = z.discriminatedUnion("action", [
  departmentManagerGrantSchema,
  departmentManagerWithdrawalSchema,
]);

export type DepartmentManagerChangeInput = z.output<
  typeof departmentManagerChangeSchema
>;

export const departmentManagerReconciliationSchema = z.strictObject({
  operationKey,
});

export const departmentManagerReceiptSchema = z.strictObject({
  action: z.enum(["granted", "withdrawn"]),
  createdAt: z.number().int().nonnegative(),
  id: z.string().min(1).max(128),
  scopeId: z.string().min(1).max(128),
  scopeName: z.string().max(200),
  targetUserId: z.string().min(1).max(128),
});

export const storedDepartmentManagerOperationSchema = z.strictObject({
  actorUserId: z.string().min(1).max(128),
  operationKey,
  version: z.literal(1),
});

export type DepartmentManagerReceipt = z.output<
  typeof departmentManagerReceiptSchema
>;
