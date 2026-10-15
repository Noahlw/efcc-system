import { randomUUID } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import type { RestrictionAction } from "@/features/account/restriction-contract";

import { expect } from "../../support/fixtures";

const status = async (request: Promise<APIResponse>, expected: number) => {
  const response = await request;
  expect(response.status()).toBe(expected);
  return response;
};

const command = (targetUserId: string, action: RestrictionAction) => ({
  action,
  operationKey: randomUUID(),
  targetUserId,
});

export { status, command };
export { dedicatedTest as isolatedTest } from "../../support/fixtures";
