import * as z from "zod";

export const restrictionActionValues = [
  "account_banned",
  "account_unbanned",
  "membership_deactivated",
  "membership_reactivated",
] as const;

export const restrictionActionSchema = z.enum(restrictionActionValues);
export type RestrictionAction = z.infer<typeof restrictionActionSchema>;

const operationKey = z.uuid().transform((value) => value.toLowerCase());
const opaqueId = z.string().min(1).max(128);

/**
 * The existing restriction payload, parsed at both the server submission
 * boundary and the browser submission boundary. Membership status and the
 * Security ban stay independent action values.
 */
export const restrictionRequestSchema = z.strictObject({
  action: restrictionActionSchema,
  operationKey,
  targetUserId: opaqueId,
});
export type RestrictionRequest = z.infer<typeof restrictionRequestSchema>;

/**
 * Local operation capability plus actor/target binding; only `action`,
 * `actorUserId`, `key`, `targetUserId` and the definitive-conflict marker are
 * ever persisted.
 */
export const storedRestrictionOperationSchema = z.strictObject({
  action: restrictionActionSchema,
  actorUserId: opaqueId,
  key: z.uuid(),
  rejected: z.literal(true).optional(),
  targetUserId: opaqueId,
});
export type StoredRestrictionOperation = z.infer<
  typeof storedRestrictionOperationSchema
>;

export const restrictionReceiptSchema = z.object({
  action: restrictionActionSchema,
  createdAt: z.int(),
  id: z.uuid(),
  targetUserId: opaqueId,
});
export type RestrictionChangeReceipt = z.infer<typeof restrictionReceiptSchema>;

/** `receipt: null` is a confirmed "not found"; invalid bodies are rejected. */
export const restrictionReceiptResponseSchema = z.object({
  data: z.object({ receipt: restrictionReceiptSchema.nullable() }),
});

export const restrictionErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
