import * as z from "zod";

import { programLeaderAuthorityKindSchema } from "./program-leader-grant-batch-contract";

const targetId = z.string().trim().min(1).max(128);
const validReaderAuthority = (value: {
  authorityKind: "admin" | "role_assigner" | "department_manager";
  authorityAssignmentId: string | null;
}) =>
  (value.authorityKind === "admin") === (value.authorityAssignmentId === null);
const operationKey = z.uuid().transform((value) => value.toLowerCase());

export const programLeaderGrantSchema = z.strictObject({
  action: z.literal("granted"),
  authorityAssignmentId: targetId.optional(),
  authorityKind: z.literal("department_manager").optional(),
  operationKey,
  scopeId: targetId,
  targetUserId: targetId,
});

export const programLeaderWithdrawalSchema = z.strictObject({
  action: z.literal("withdrawn"),
  authorityAssignmentId: targetId.optional(),
  authorityKind: z.literal("department_manager").optional(),
  expectedAssignmentId: targetId,
  operationKey,
  scopeId: targetId,
  targetUserId: targetId,
});

export const programLeaderChangeSchema = z
  .discriminatedUnion("action", [
    programLeaderGrantSchema,
    programLeaderWithdrawalSchema,
  ])
  .refine(
    (input) =>
      input.authorityKind !== "department_manager" ||
      input.authorityAssignmentId !== undefined,
    { message: "請重新確認部門主管權限。", path: ["authorityAssignmentId"] }
  );

export type ProgramLeaderChangeInput = z.output<
  typeof programLeaderChangeSchema
>;

export const programLeaderReconciliationSchema = z.strictObject({
  authorityKind: z.literal("department_manager").optional(),
  operationKey,
});

export const programLeaderReceiptSchema = z.strictObject({
  action: z.enum(["granted", "withdrawn"]),
  createdAt: z.number().int().nonnegative(),
  id: z.string().min(1).max(128),
  scopeId: z.string().min(1).max(128),
  scopeName: z.string().max(200),
  targetUserId: z.string().min(1).max(128),
});

export type ProgramLeaderReceipt = z.output<typeof programLeaderReceiptSchema>;

export const programLeaderReconciliationResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      outcome: z.literal("committed"),
      receipt: programLeaderReceiptSchema,
    }),
    z.strictObject({ outcome: z.literal("unknown"), receipt: z.null() }),
  ]
);

export const programLeaderDepartmentProgramsSchema = z.strictObject({
  actorUserId: targetId,
  authorityAssignmentId: targetId,
  authorityKind: z.literal("department_manager"),
  department: z.strictObject({
    assignmentId: targetId,
    id: targetId,
    name: z.string(),
  }),
  hasNextPage: z.boolean(),
  page: z.number().int().positive(),
  programs: z
    .array(
      z.strictObject({
        departmentId: targetId,
        departmentName: z.string(),
        id: targetId,
        name: z.string(),
      })
    )
    .max(25),
});

export const programLeaderGlobalProgramsSchema = z
  .strictObject({
    actorUserId: targetId,
    authorityAssignmentId: targetId.nullable(),
    authorityKind: z.enum(["admin", "role_assigner"]),
    hasNextPage: z.boolean(),
    page: z.number().int().positive(),
    programs: z
      .array(
        z.strictObject({
          departmentId: targetId,
          departmentName: z.string(),
          id: targetId,
          name: z.string(),
        })
      )
      .max(25),
  })
  .refine(validReaderAuthority, { path: ["authorityAssignmentId"] });
export type ProgramLeaderGlobalPrograms = z.output<
  typeof programLeaderGlobalProgramsSchema
>;

export const programLeaderRosterSchema = z
  .strictObject({
    actorUserId: targetId,
    authorityAssignmentId: targetId.nullable(),
    authorityKind: programLeaderAuthorityKindSchema,
    hasNextPage: z.boolean(),
    leaders: z
      .array(
        z.strictObject({
          assignmentId: targetId,
          createdAt: z.number().int().nonnegative(),
          eligibleForWithdrawal: z.boolean(),
          fullName: z.string(),
          userId: targetId,
          username: z.string().nullable(),
        })
      )
      .max(25),
    page: z.number().int().positive(),
    program: z.strictObject({
      departmentId: targetId,
      departmentName: z.string(),
      id: targetId,
      name: z.string(),
    }),
  })
  .refine(validReaderAuthority, { path: ["authorityAssignmentId"] });

export const programLeaderAssigneeBaselineSchema = z.strictObject({
  actorUserId: targetId,
  assignmentId: targetId,
  authorityAssignmentId: targetId,
  departmentId: targetId,
  departmentName: z.string(),
  person: z.strictObject({
    fullName: z.string(),
    userId: targetId,
    username: z.string().nullable(),
  }),
  programId: targetId,
  programName: z.string(),
});

export type ProgramLeaderAssigneeBaseline = z.infer<
  typeof programLeaderAssigneeBaselineSchema
>;
export type ProgramLeaderRoster = z.infer<typeof programLeaderRosterSchema>;

export const programLeaderCandidateSchema = z.strictObject({
  fullName: z.string(),
  userId: targetId,
  username: z.string().nullable(),
});
export const programLeaderCandidatePageSchema = z
  .strictObject({
    actorUserId: targetId,
    authorityAssignmentId: targetId.nullable(),
    authorityKind: programLeaderAuthorityKindSchema,
    candidates: z.array(programLeaderCandidateSchema).max(25),
    hasNextPage: z.boolean(),
    page: z.number().int().positive(),
  })
  .refine(validReaderAuthority, { path: ["authorityAssignmentId"] });
export type ProgramLeaderCandidate = z.output<
  typeof programLeaderCandidateSchema
>;
export type ProgramLeaderCandidatePage = z.output<
  typeof programLeaderCandidatePageSchema
>;
