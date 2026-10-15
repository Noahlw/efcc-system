"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

/** A document owns its client; private reads are fresh and never persisted. */
export const QueryProvider = ({ children }: { children: ReactNode }) => {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { gcTime: 0, networkMode: "always", retry: false },
          queries: {
            gcTime: 0,
            networkMode: "always",
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
            retry: false,
            staleTime: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
