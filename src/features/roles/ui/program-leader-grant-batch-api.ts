import * as z from "zod";

import {
  programLeaderCandidatePageSchema,
  programLeaderRosterSchema,
} from "../program-leader-contract";
import type {
  ProgramLeaderCandidatePage,
  ProgramLeaderRoster,
} from "../program-leader-contract";
import {
  programLeaderGrantBatchEligibilityResultSchema,
  programLeaderGrantBatchEligibilitySchema,
  programLeaderGrantBatchReconciliationResultSchema,
  programLeaderGrantBatchReconciliationSchema,
  programLeaderGrantBatchResultSchema,
  programLeaderGrantBatchSchema,
} from "../program-leader-grant-batch-contract";
import type {
  ProgramLeaderAuthorityKind,
  ProgramLeaderGrantBatchEligibilityInput,
  ProgramLeaderGrantBatchEligibilityResult,
  ProgramLeaderGrantBatchInput,
  ProgramLeaderGrantBatchResult,
  ProgramLeaderGrantBatchReconciliationResult,
} from "../program-leader-grant-batch-contract";
import { ProgramLeaderApiError } from "./program-leader-api";

const endpoint = "/api/v2/roles/program-leader-grant-batches";
const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const dataEnvelope = z.object({ data: z.unknown() });

const request = async (
  actorUserId: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<unknown> => {
  const response = await fetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-efcc-expected-actor-id": actorUserId,
    },
    method: body === undefined ? "GET" : "POST",
    signal,
  });
  const envelope: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorEnvelope.safeParse(envelope);
    throw new ProgramLeaderApiError(
      response.status,
      error.success ? error.data.error.code : "service_error",
      error.success ? error.data.error.message : "暫時未能完成聚會職務操作。"
    );
  }
  return dataEnvelope.parse(envelope).data;
};

export const readGrantBatchScope = async (
  actorUserId: string,
  scopeId: string,
  authorityKind: ProgramLeaderAuthorityKind,
  signal: AbortSignal
): Promise<ProgramLeaderRoster> =>
  programLeaderRosterSchema.parse(
    await request(
      actorUserId,
      `/api/v2/roles/program-leaders/programs/${encodeURIComponent(scopeId)}/leaders?${new URLSearchParams({ authority: authorityKind, page: "1" })}`,
      undefined,
      signal
    )
  );

export const readGrantBatchCandidates = async (
  actorUserId: string,
  scopeId: string,
  query: string,
  page: number,
  authorityKind: ProgramLeaderAuthorityKind,
  signal: AbortSignal
): Promise<ProgramLeaderCandidatePage> => {
  const search = new URLSearchParams({
    authority: authorityKind,
    page: String(page),
    q: query,
  });
  return programLeaderCandidatePageSchema.parse(
    await request(
      actorUserId,
      `/api/v2/roles/program-leaders/programs/${encodeURIComponent(scopeId)}/candidates?${search}`,
      undefined,
      signal
    )
  );
};

export const validateGrantBatchSelection = async (
  actorUserId: string,
  input: ProgramLeaderGrantBatchEligibilityInput,
  signal: AbortSignal
): Promise<ProgramLeaderGrantBatchEligibilityResult> =>
  programLeaderGrantBatchEligibilityResultSchema.parse(
    await request(
      actorUserId,
      `${endpoint}/validate`,
      programLeaderGrantBatchEligibilitySchema.parse(input),
      signal
    )
  );

export const saveProgramLeaderGrantBatch = async (
  actorUserId: string,
  input: ProgramLeaderGrantBatchInput
): Promise<ProgramLeaderGrantBatchResult> =>
  programLeaderGrantBatchResultSchema.parse(
    await request(
      actorUserId,
      endpoint,
      programLeaderGrantBatchSchema.parse(input)
    )
  );

export const reconcileProgramLeaderGrantBatch = async (
  actorUserId: string,
  operationKey: string
): Promise<ProgramLeaderGrantBatchReconciliationResult> =>
  programLeaderGrantBatchReconciliationResultSchema.parse(
    await request(
      actorUserId,
      `${endpoint}/reconcile`,
      programLeaderGrantBatchReconciliationSchema.parse({ operationKey })
    )
  );
