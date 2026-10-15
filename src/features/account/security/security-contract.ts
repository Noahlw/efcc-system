import * as z from "zod";

export const securityActionValues = [
  "password_changed",
  "other_sessions_revoked",
  "password_confirmed",
] as const;

export const securityActionSchema = z.enum(securityActionValues);
export type AccountSecurityAction = z.infer<typeof securityActionSchema>;

/** Session capability plus actor binding; passwords are never persisted here. */
export const storedSecurityOperationSchema = z.object({
  action: securityActionSchema,
  actorUserId: z.string().min(1).max(128),
  key: z.uuid(),
});

export const securityReceiptSchema = z.object({
  action: securityActionSchema,
  createdAt: z.int(),
  id: z.uuid(),
});
export type AccountSecurityReceipt = z.infer<typeof securityReceiptSchema>;

/** `receipt: null` is a confirmed "not found"; invalid bodies are rejected. */
export const securityReceiptResponseSchema = z.object({
  data: z.object({ receipt: securityReceiptSchema.nullable() }),
});
