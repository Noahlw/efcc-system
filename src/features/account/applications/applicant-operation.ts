"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useMemo } from "react";

/** Signed-in reads and continuations belong to one account/application owner. */
export const useApplicantOperationLifetime = (
  actorUserId: string,
  applicationId: string,
  resetSubmission: () => void
) => {
  const queryClient = useQueryClient();
  const lifetime = useMemo(() => {
    let active = false;
    let generation = 0;
    return {
      activate: () => {
        active = true;
      },
      capture: () => {
        const started = generation;
        return () => active && started === generation;
      },
      dispose: () => {
        active = false;
        generation += 1;
      },
      queryKey: [
        "applicant-operation-reconciliation",
        actorUserId,
        applicationId,
      ] as const,
    };
  }, [actorUserId, applicationId]);

  useLayoutEffect(() => {
    lifetime.activate();
    return () => {
      lifetime.dispose();
      void queryClient.cancelQueries({
        exact: true,
        queryKey: lifetime.queryKey,
      });
      queryClient.removeQueries({ exact: true, queryKey: lifetime.queryKey });
      resetSubmission();
    };
  }, [lifetime, queryClient, resetSubmission]);

  return lifetime;
};
