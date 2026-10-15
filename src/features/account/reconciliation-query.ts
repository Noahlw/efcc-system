import type { QueryClient, QueryFunctionContext } from "@tanstack/react-query";

/**
 * One reconciliation read with the shared transient lifecycle: it must reach
 * the worker on every attempt, hold no cached result, never retry a lost
 * response on the user's behalf, and leave no query entry once it settles. The
 * domain query key, read, actor header and outcome handling stay with the
 * owning flow.
 */
export const readTransientReconciliation = async <TData>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  queryFn: (context: QueryFunctionContext) => Promise<TData>
): Promise<TData> => {
  try {
    return await queryClient.query({
      gcTime: 0,
      networkMode: "always",
      queryFn,
      queryKey,
      retry: false,
      staleTime: 0,
    });
  } finally {
    queryClient.removeQueries({ exact: true, queryKey });
  }
};
