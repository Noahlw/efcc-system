import * as z from "zod";

/**
 * Client-safe decision request rules shared by the Staff form and the routes.
 * The server parses untrusted input again at its own boundary; these schemas
 * carry the field rules only, never staff policy or private projections.
 */
const boundedNote = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => [...value].length <= 500);

export const decisionOutcomeSchema = z.enum(["approved", "rejected"]);
export type DecisionOutcome = z.output<typeof decisionOutcomeSchema>;

export const decisionRequestSchema = z
  .strictObject({
    applicationId: z.uuid(),
    internalNote: boundedNote.optional().transform((value) => value || null),
    operationKey: z.uuid().transform((value) => value.toLowerCase()),
    outcome: decisionOutcomeSchema,
    visibleReason: boundedNote.optional().transform((value) => value || null),
  })
  .refine(
    (input) => input.outcome !== "rejected" || input.visibleReason !== null
  );

export const decisionReconciliationSchema = z.strictObject({
  applicationId: z.uuid().optional(),
  operationKey: z.uuid().transform((value) => value.toLowerCase()),
});

export type DecisionWriteInput = z.input<typeof decisionRequestSchema>;
export type DecisionReconciliationInput = z.input<
  typeof decisionReconciliationSchema
>;

/**
 * The Staff form's own rules, normalized into the frozen submission body that
 * one explicit final submit sends. Absent optional fields stay absent so the
 * server's `strictObject` request schema sees exactly the reviewed values.
 */
export const decisionFormSchema = z
  .strictObject({
    internalNote: z.string(),
    outcome: decisionOutcomeSchema,
    visibleReason: z.string(),
  })
  .superRefine((input, context) => {
    if (!boundedNote.safeParse(input.internalNote).success) {
      context.addIssue({
        code: "custom",
        message: "內部備註不可多於 500 個字元。",
        path: ["internalNote"],
      });
    }
    if (!boundedNote.safeParse(input.visibleReason).success) {
      context.addIssue({
        code: "custom",
        message: "申請人可見原因不可多於 500 個字元。",
        path: ["visibleReason"],
      });
    }
    if (input.outcome === "rejected" && input.visibleReason.trim() === "") {
      context.addIssue({
        code: "custom",
        message: "拒絕申請必須填寫申請人可見的原因。",
        path: ["visibleReason"],
      });
    }
  })
  .transform(({ internalNote, outcome, visibleReason }) => ({
    internalNote: internalNote.trim() || undefined,
    outcome,
    visibleReason: outcome === "rejected" ? visibleReason.trim() : undefined,
  }));

export type DecisionFormValues = z.input<typeof decisionFormSchema>;
export type DecisionSubmission = z.output<typeof decisionFormSchema>;

export const staffDecisionSchema = z.object({
  actorUserId: z.string(),
  applicationId: z.uuid(),
  createdAt: z.number(),
  id: z.uuid(),
  internalNote: z.string().nullable(),
  outcome: decisionOutcomeSchema,
  targetUserId: z.string(),
  visibleReason: z.string().nullable(),
});

export const decisionWriteResponseSchema = z.object({
  data: z.object({ decision: staffDecisionSchema }),
});

export const decisionReconciliationResponseSchema = z.object({
  data: z.object({
    applicationStatus: z
      .enum(["pending", "approved", "rejected", "withdrawn"])
      .nullish(),
    decision: staffDecisionSchema.nullable(),
  }),
});
