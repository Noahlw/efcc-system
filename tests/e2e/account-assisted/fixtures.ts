/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */
import { randomBytes, randomUUID } from "node:crypto";

import type { APIResponse, Page } from "@playwright/test";
import type * as z from "zod";

import {
  staffAccountErrorSchema,
  staffAccountResponseSchema,
} from "../../../src/features/account/staff-account-contract";
import { test as credentialTest } from "../../support/credential-fixtures";
import { expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";

interface CreationInput {
  email: string | null;
  fullName: string;
  identityCheck: "face_to_face";
  operationKey: string;
  phone: string;
  sharedPhone: boolean;
  username: string;
}

interface RecoveryInput {
  identityCheck: "face_to_face" | "verified_phone";
  operationKey: string;
  targetUserId: string;
}

type StaffResponseData = z.infer<typeof staffAccountResponseSchema>["data"];

interface CredentialRow {
  credential_revision: number;
  password: string;
  temporary_password_expires_at: number | null;
}

const status = async (pending: Promise<APIResponse>, expected: number) => {
  const response = await pending;
  expect(response.status()).toBe(expected);
  return response;
};

const staffData = async (response: {
  json: () => Promise<unknown>;
}): Promise<StaffResponseData> =>
  staffAccountResponseSchema.parse(await response.json()).data;

const issuedCredential = (data: StaffResponseData) => {
  if (!("temporaryPassword" in data)) {
    throw new Error(
      "The original Staff handover did not return its credential"
    );
  }
  return data;
};

const errorCode = async (response: APIResponse) =>
  staffAccountErrorSchema.parse(await response.json()).error.code;

const creation = (): CreationInput => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: null,
    fullName: `陳新會員${suffix}`,
    identityCheck: "face_to_face",
    operationKey: randomUUID(),
    phone: String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000)),
    sharedPhone: false,
    username: `created.${suffix}`,
  };
};

const syntheticAccount = (
  namespace: string,
  role?: ProvisionAccount["role"],
  membershipStatus: ProvisionAccount["membershipStatus"] = "active"
): ProvisionAccount => {
  const suffix = randomBytes(6).toString("hex");
  const usernamePrefix = namespace
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/gu, "")
    .slice(0, 17);
  return {
    email: `${namespace}.${suffix}@example.invalid`,
    fullName: `陳協助${suffix}`,
    membershipStatus,
    ...(role ? { role } : {}),
    password: "Synthetic-assisted-password!",
    username: `${usernamePrefix}.${suffix}`,
  };
};

const accountId = async (app: NativeApp, username: string) => {
  const account = await app.db
    .prepare("SELECT id FROM user WHERE username = ?")
    .bind(username)
    .first<{ id: string }>();
  if (!account) {
    throw new Error("The synthetic account was not provisioned");
  }
  return account.id;
};

const credentialRow = (app: NativeApp, userId: string) =>
  app.db
    .prepare(
      "SELECT password, credential_revision, temporary_password_expires_at FROM account WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
    )
    .bind(userId)
    .first<CredentialRow>();

const creationEffects = (
  app: NativeApp,
  username: string,
  plaintext: string | null
) =>
  app.db
    .prepare(`SELECT
      (SELECT COUNT(*) FROM user WHERE username = ?) AS users,
      (SELECT COUNT(*) FROM account a JOIN user u ON u.id = a.user_id WHERE u.username = ?) AS credentials,
      (SELECT COUNT(*) FROM person_profile p JOIN user u ON u.id = p.user_id WHERE u.username = ?) AS profiles,
      (SELECT COUNT(*) FROM username_reservation WHERE username_key = ?) AS reservations,
      (SELECT COUNT(*) FROM audit_event WHERE action = 'assisted_account_created' AND target_user_id = (SELECT id FROM user WHERE username = ?)) AS audits,
      (SELECT COUNT(*) FROM staff_account_operation WHERE action = 'assisted_account_created' AND target_user_id = (SELECT id FROM user WHERE username = ?)) AS receipts,
      (SELECT COUNT(*) FROM account a JOIN user u ON u.id = a.user_id WHERE u.username = ? AND a.password = ?) AS plaintext`)
    .bind(
      username,
      username,
      username,
      username,
      username,
      username,
      username,
      plaintext ?? ""
    )
    .first<{
      audits: number;
      credentials: number;
      plaintext: number;
      profiles: number;
      receipts: number;
      reservations: number;
      users: number;
    }>();

const dedicatedCredentialTest = credentialTest.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

const creationDrafts = (page: Page) =>
  page.locator(
    "#assisted-name, #assisted-username, #assisted-email, #assisted-phone, #assisted-shared-phone, #assisted-verified"
  );

const recoveryDrafts = (page: Page) =>
  page.locator(
    'input[name="recovery-action"], input[name="identityCheck"], input[type="checkbox"][required]'
  );

export {
  status,
  staffData,
  issuedCredential,
  errorCode,
  creation,
  syntheticAccount,
  accountId,
  credentialRow,
  creationEffects,
  dedicatedCredentialTest,
  creationDrafts,
  recoveryDrafts,
};
export type { CredentialRow, CreationInput, RecoveryInput, StaffResponseData };

export { test, expect, dedicatedTest } from "../../support/fixtures";
