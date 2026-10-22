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

/** Raw read-time values: do not normalize away null, display or sharing changes. */
export const originalPhoneSchema = z.strictObject({
  phone: z.string().max(40).nullable(),
  phoneShared: z.union([z.literal(0), z.literal(1)]),
});
export const originalIdentitySchema = originalPhoneSchema.extend({
  canonicalUsername: z.string().max(128).nullable(),
  email: z.string().max(254),
  fullName: z.string().max(200),
  username: z.string().max(128).nullable(),
});
export type OriginalIdentity = z.infer<typeof originalIdentitySchema>;

/** Current authorised edit data; extra server fields never become form defaults. */
export const identityRefreshResponseSchema = z.object({
  data: z.object({
    identity: z
      .object({
        ...originalIdentitySchema.shape,
        banned: z.int().nullable().optional(),
        credentialRevision: z.int().optional(),
        membershipStatus: z.string().optional(),
        role: z.string().optional(),
        userId: z.string().min(1).max(128),
        verifiedRecoveryPhone: z.string().nullable().optional(),
      })
      .nullable(),
  }),
});

export const originalIdentityValues = (identity: {
  canonicalUsername: string | null;
  email: string;
  fullName: string;
  phone: string | null;
  phoneShared: number;
  username: string | null;
}): OriginalIdentity => ({
  canonicalUsername: identity.canonicalUsername,
  email: identity.email,
  fullName: identity.fullName,
  phone: identity.phone,
  phoneShared: identity.phoneShared === 1 ? 1 : 0,
  username: identity.username,
});

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
  original: originalPhoneSchema.optional(),
  phone: z.string().min(1).max(40),
});
export type OwnPhoneRequest = z.infer<typeof ownPhoneRequestSchema>;

export const staffIdentityRequestSchema = z.strictObject({
  email: z.string().max(254).nullable(),
  fullName: z.string().min(1).max(200),
  identityCheck: identityCheckSchema,
  operationKey,
  original: originalIdentitySchema.optional(),
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

export { operationErrorSchema as identityErrorSchema } from "../operation-error";
