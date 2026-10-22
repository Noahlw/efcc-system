import * as z from "zod";

import { originalIdentitySchema } from "./identity-changes/identity-contract";

export const draftLifetime = 30 * 60 * 1000;
export const draftStoragePrefix = "efcc.draft.v1.";
export const draftFlows = ["creation", "identity", "applicant"] as const;
export type DraftFlow = (typeof draftFlows)[number];

const contactFields = {
  email: z.string().max(254),
  fullName: z.string().max(200),
  phone: z.string().max(40),
};
const applicantFields = z.strictObject(contactFields);
const staffFields = applicantFields.extend({
  sharedPhone: z.boolean(),
  username: z.string().max(128),
});
export type DraftValues = z.infer<typeof applicantFields> & {
  sharedPhone?: boolean;
  username?: string;
};
export const draftBaselineSchema = z.strictObject({
  contact: originalIdentitySchema.nullable(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).nullable(),
});
export type DraftBaseline = z.infer<typeof draftBaselineSchema>;
const common = {
  actorUserId: z.string().min(1).max(128),
  authContext: z.string().min(1).max(128),
  baseline: draftBaselineSchema,
  savedAt: z.number().int().nonnegative(),
  submittedOperationKey: z.uuid().nullable().default(null),
  targetId: z.string().min(1).max(128),
  version: z.literal(1),
};
export const sessionDraftSchema = z.discriminatedUnion("flow", [
  z.strictObject({
    ...common,
    flow: z.literal("creation"),
    values: staffFields,
  }),
  z.strictObject({
    ...common,
    flow: z.literal("identity"),
    values: staffFields,
  }),
  z.strictObject({
    ...common,
    flow: z.literal("applicant"),
    values: applicantFields,
  }),
]);
export type SessionDraft = z.infer<typeof sessionDraftSchema>;

/** Pick, never serialize a whole form, account, review, or submitted request. */
export const draftValues = (
  flow: DraftFlow,
  values: DraftValues
): DraftValues => {
  const contact = {
    email: values.email,
    fullName: values.fullName,
    phone: values.phone,
  };
  return flow === "applicant"
    ? contact
    : {
        ...contact,
        sharedPhone: values.sharedPhone ?? false,
        username: values.username ?? "",
      };
};

const parseSessionDraft = (raw: string): SessionDraft | null => {
  try {
    const parsed = sessionDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const readSessionDraft = (
  storage: Storage,
  flow: DraftFlow,
  owner: { actorUserId: string; authContext: string; targetId: string },
  now = Date.now()
): SessionDraft | null => {
  const key = `${draftStoragePrefix}${flow}`;
  const raw = storage.getItem(key);
  if (raw === null) {
    return null;
  }
  const parsed = parseSessionDraft(raw);
  if (
    !parsed ||
    parsed.flow !== flow ||
    parsed.actorUserId !== owner.actorUserId ||
    parsed.authContext !== owner.authContext ||
    parsed.targetId !== owner.targetId ||
    parsed.savedAt > now ||
    now - parsed.savedAt >= draftLifetime
  ) {
    storage.removeItem(key);
    return null;
  }
  return parsed;
};

/** Only the existing command owner links or settles its own saved draft. */
export const linkSessionDraft = (
  flow: DraftFlow,
  operationKey: string,
  actorUserId: string,
  targetId: string,
  draft?: SessionDraft
) => {
  const key = `${draftStoragePrefix}${flow}`;
  const raw = sessionStorage.getItem(key);
  if (!raw && !draft) {
    return;
  }
  const saved = draft ?? (raw ? parseSessionDraft(raw) : null);
  if (!saved) {
    sessionStorage.removeItem(key);
    return;
  }
  if (saved.actorUserId !== actorUserId || saved.targetId !== targetId) {
    if (draft) {
      throw new Error("Draft submission owner changed");
    }
    return;
  }
  const linked = JSON.stringify({
    ...saved,
    submittedOperationKey: operationKey,
  });
  sessionStorage.setItem(key, linked);
  if (sessionStorage.getItem(key) !== linked) {
    throw new Error("Draft submission link unavailable");
  }
};

export const settleSessionDraft = (
  flow: DraftFlow,
  operationKey: string,
  confirmed: boolean
) => {
  const key = `${draftStoragePrefix}${flow}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) {
    return;
  }
  const saved = parseSessionDraft(raw);
  if (!saved) {
    sessionStorage.removeItem(key);
    return;
  }
  if (saved.submittedOperationKey !== operationKey) {
    return;
  }
  if (confirmed) {
    sessionStorage.removeItem(key);
    if (sessionStorage.getItem(key) !== null) {
      throw new Error("Draft remains stored");
    }
  } else {
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...saved, submittedOperationKey: null })
    );
  }
};

/** Explicit discard does not clear any operation metadata. */
export const discardSessionDraft = (flow: DraftFlow) => {
  const key = `${draftStoragePrefix}${flow}`;
  sessionStorage.removeItem(key);
  if (sessionStorage.getItem(key) !== null) {
    throw new Error("Draft remains stored");
  }
};

/** Only this feature's three keys; operation metadata is a separate owner. */
export const clearSessionDrafts = () => {
  for (const flow of draftFlows) {
    sessionStorage.removeItem(`${draftStoragePrefix}${flow}`);
  }
};
