import { randomUUID } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import type { RestrictionAction } from "@/features/account/restrictions/restriction-contract";

import { expect } from "../../support/fixtures";

const expectResponseStatus = async (
  request: Promise<APIResponse>,
  expected: number
) => {
  const response = await request;
  expect(response.status()).toBe(expected);
  return response;
};

const restrictionCommand = (
  targetUserId: string,
  action: RestrictionAction
) => ({
  action,
  operationKey: randomUUID(),
  targetUserId,
});

export { expectResponseStatus, restrictionCommand };
