import { randomBytes, randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";
import * as z from "zod";

import { deletionReceiptResponseSchema } from "../../../src/features/account/deletion-contract";
import type { DeletionReceipt } from "../../../src/features/account/deletion-contract";
import { expect, test as nativeTest } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";

interface ApplicantInput {
  email: string;
  fullName: string;
  operationKey: string;
  password: string;
  phone: string;
  username: string;
}

const applicationMineResponseSchema = z.object({
  data: z.object({ application: z.object({ id: z.string() }) }),
});

const expectStatus = async (
  pending: Promise<APIResponse>,
  expected: number
) => {
  const response = await pending;
  expect(response.status()).toBe(expected);
  return response;
};

const deletionReceipt = async (
  response: APIResponse
): Promise<DeletionReceipt> => {
  const { receipt } = deletionReceiptResponseSchema.parse(
    await response.json()
  ).data;
  if (!receipt) {
    throw new Error("The completed deletion did not return its receipt");
  }
  return receipt;
};

const applicationInput = (namespace: string): ApplicantInput => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `${namespace}.${suffix}@example.com`,
    fullName: `陳資料${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-identity-password!",
    phone: String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000)),
    username: `${namespace}.${suffix}`,
  };
};

type ApprovedMember = ApplicantInput & {
  context: APIRequestContext;
  userId: string;
};

const deletionTest = nativeTest.extend<{ approvedMember: ApprovedMember }>({
  approvedMember: async (
    { caseApp, extraHTTPHeaders, playwright, staff },
    use
  ) => {
    const applicant = applicationInput("deletion");
    await expectStatus(
      staff.context.post("/api/v2/applications", { data: applicant }),
      201
    );
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await expectStatus(
        context.post("/api/auth/sign-in/username", {
          data: {
            password: applicant.password,
            username: applicant.username,
          },
        }),
        200
      );
      const ownApplication = await expectStatus(
        context.get("/api/v2/applications/mine"),
        200
      );
      const ownBody = applicationMineResponseSchema.parse(
        await ownApplication.json()
      );
      const account = await caseApp.db
        .prepare("SELECT id FROM user WHERE username = ?")
        .bind(applicant.username)
        .first<{ id: string }>();
      if (!account) {
        throw new Error("Synthetic deletion applicant was not provisioned");
      }
      await expectStatus(
        staff.context.post("/api/v2/staff/application-decisions", {
          data: {
            applicationId: ownBody.data.application.id,
            operationKey: randomUUID(),
            outcome: "approved",
          },
        }),
        201
      );
      const profile = await caseApp.db
        .prepare(
          "SELECT membership_status FROM person_profile WHERE user_id = ?"
        )
        .bind(account.id)
        .first<{ membership_status: string }>();
      expect(profile?.membership_status).toBe("active");
      await use({ ...applicant, context, userId: account.id });
    } finally {
      await context.dispose();
    }
  },
});

const dedicatedDeletionTest = deletionTest.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

export {
  type ApplicantInput,
  applicationMineResponseSchema,
  expectStatus,
  deletionReceipt,
  applicationInput,
  type ApprovedMember,
  deletionTest,
  dedicatedDeletionTest,
};
