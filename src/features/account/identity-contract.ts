import * as z from "zod";

export const identityActionValues = [
  "own_phone_changed",
  "staff_identity_corrected",
  "staff_shared_phone_corrected",
] as const;
export const identityActionSchema = z.enum(identityActionValues);
export type IdentityChangeAction = z.infer<typeof identityActionSchema>;

export const identityCheckSchema = z.enum(["face_to_face", "verified_phone"]);
export type IdentityCheck = z.infer<typeof identityCheckSchema>;

const operationKey = z.uuid().transform((value) => value.toLowerCase());
const targetUserId = z.string().min(1).max(128);

/** Local operation capability; submitted identity values are never stored here. */
export const storedIdentityOperationSchema = z.strictObject({
  action: identityActionSchema,
  actorUserId: z.string().min(1).max(128),
  key: operationKey,
  targetUserId,
});
export type StoredIdentityOperation = z.infer<
  typeof storedIdentityOperationSchema
>;

/**
 * Submission-boundary shapes for the two existing commands. They preserve the
 * fields/normalization the server already owns; domain validation stays there.
 */
export const ownPhoneRequestSchema = z.strictObject({
  operationKey,
  phone: z.string().min(1).max(40),
});
export type OwnPhoneRequest = z.infer<typeof ownPhoneRequestSchema>;

export const staffIdentityRequestSchema = z.strictObject({
  email: z.string().max(254).nullable(),
  fullName: z.string().min(1).max(200),
  identityCheck: identityCheckSchema,
  operationKey,
  phone: z.string().min(1).max(40),
  sharedPhone: z.boolean(),
  targetUserId,
  username: z.string().min(3).max(30),
});
export type StaffIdentityRequest = z.infer<typeof staffIdentityRequestSchema>;

export const identityReceiptSchema = z.object({
  action: identityActionSchema,
  createdAt: z.int(),
  id: z.uuid(),
  targetUserId,
});
export type IdentityChangeReceipt = z.infer<typeof identityReceiptSchema>;

/** `receipt: null` is a confirmed "not found"; invalid bodies are rejected. */
export const identityReceiptResponseSchema = z.object({
  data: z.object({ receipt: identityReceiptSchema.nullable() }),
});

export { operationErrorSchema as identityErrorSchema } from "./operation-error";
