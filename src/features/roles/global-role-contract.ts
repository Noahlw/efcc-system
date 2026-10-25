import * as z from "zod";

const targetId = z.string().trim().min(1).max(128);
const operationKey = z.uuid().transform((value) => value.toLowerCase());

export const globalRoleChangeSchema = z.discriminatedUnion("role", [
  z.strictObject({
    action: z.enum(["granted", "withdrawn"]),
    operationKey,
    role: z.literal("staff"),
    targetUserId: targetId,
  }),
  z.strictObject({
    action: z.literal("granted"),
    operationKey,
    role: z.literal("admin"),
    targetUserId: targetId,
  }),
]);

export type GlobalRoleChangeInput = z.output<typeof globalRoleChangeSchema>;

export const globalRoleReconciliationSchema = z.strictObject({
  operationKey,
});

export const globalRoleReceiptSchema = z.discriminatedUnion("role", [
  z.strictObject({
    action: z.enum(["granted", "withdrawn"]),
    createdAt: z.number().int().nonnegative(),
    id: z.string().min(1).max(128),
    resultingGlobalRole: z.enum(["member", "staff"]),
    role: z.literal("staff"),
    targetUserId: z.string().min(1).max(128),
  }),
  z.strictObject({
    action: z.literal("granted"),
    createdAt: z.number().int().nonnegative(),
    id: z.string().min(1).max(128),
    resultingGlobalRole: z.literal("admin"),
    role: z.literal("admin"),
    targetUserId: z.string().min(1).max(128),
  }),
]);

export type GlobalRoleReceipt = z.output<typeof globalRoleReceiptSchema>;
