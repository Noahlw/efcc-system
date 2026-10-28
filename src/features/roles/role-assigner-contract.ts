import * as z from "zod";

const targetId = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());

export const roleAssignerGrantSchema = z.strictObject({
  action: z.literal("granted"),
  operationKey,
  targetUserId: targetId,
});

export const roleAssignerWithdrawalSchema = z.strictObject({
  action: z.literal("withdrawn"),
  expectedAssignmentId: targetId,
  operationKey,
  targetUserId: targetId,
});

export const roleAssignerChangeSchema = z.discriminatedUnion("action", [
  roleAssignerGrantSchema,
  roleAssignerWithdrawalSchema,
]);

export type RoleAssignerChangeInput = z.output<typeof roleAssignerChangeSchema>;

export const roleAssignerReconciliationSchema = z.strictObject({
  operationKey,
});

export const roleAssignerReceiptSchema = z.strictObject({
  action: z.enum(["granted", "withdrawn"]),
  createdAt: z.number().int().nonnegative(),
  id: z.string().min(1).max(128),
  role: z.literal("role_assigner"),
  targetUserId: z.string().min(1).max(128),
});

export type RoleAssignerReceipt = z.output<typeof roleAssignerReceiptSchema>;
