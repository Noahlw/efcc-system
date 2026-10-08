"use client";

import { createAuthClient } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";

/** Per-consumer transport only: EFCC's server remains the session authority. */
export const createNativeAuthClient = () =>
  createAuthClient({
    disableDefaultFetchPlugins: true,
    fetchOptions: { credentials: "same-origin", retry: 0 },
    plugins: [usernameClient()],
  });
