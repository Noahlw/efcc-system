import { allAccounts } from "../scenarios/accounts";
import { E2E_BASE_URL, ensureLocalEnv } from "../scenarios/local-env";

/**
 * Creates the disposable synthetic accounts through the trusted setup API.
 * Idempotent: reruns update the existing rows instead of duplicating people.
 */
export const seedSyntheticAccounts = async (): Promise<void> => {
  const { SEED_TOKEN } = ensureLocalEnv();
  const response = await fetch(`${E2E_BASE_URL}/api/internal/test-setup`, {
    body: JSON.stringify({ accounts: allAccounts }),
    headers: {
      "content-type": "application/json",
      "x-seed-token": SEED_TOKEN ?? "",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Synthetic setup failed: ${response.status} ${await response.text()}`
    );
  }
};
