import * as z from "zod";

const key = z.uuid().transform((value) => value.toLowerCase());
const targetUserId = z.string().min(1).max(128);

/** The wire shape the deletion route already validates; shared with the client. */
export const deletionRequestSchema = z.strictObject({
  operationKey: key,
  targetUserId,
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

/**
 * Local operation capability. It keeps only the action, actor, target and
 * idempotency key; the checkbox confirmation is editing state, never stored.
 */
export const storedDeletionOperationSchema = z.strictObject({
  action: z.literal("account_deleted"),
  actorUserId: z.string().min(1).max(128),
  key,
  targetUserId,
});
export type StoredDeletionOperation = z.infer<
  typeof storedDeletionOperationSchema
>;

export const deletionReceiptSchema = z.object({
  action: z.literal("account_deleted"),
  createdAt: z.int(),
  id: z.uuid(),
  targetUserId,
});
export type DeletionReceipt = z.infer<typeof deletionReceiptSchema>;

/** `receipt: null` is a confirmed "not found"; invalid bodies are rejected. */
export const deletionReceiptResponseSchema = z.object({
  data: z.object({ receipt: deletionReceiptSchema.nullable() }),
});

/** The destruction acknowledgement is a real constraint, not decoration. */
export const deletionConfirmationSchema = z.literal(true, {
  error: "請先確認永久刪除，並保留歷史紀錄及使用者名稱。",
});

export { operationErrorSchema as deletionErrorSchema } from "./operation-error";
