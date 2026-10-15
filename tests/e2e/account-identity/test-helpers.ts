import { randomInt } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import { expect } from "../../support/fixtures";

export const expectResponseStatus = async (
  response: Promise<APIResponse>,
  expected: number
) => {
  const result = await response;
  expect(result.status()).toBe(expected);
  return result;
};

export const phone = () => String(randomInt(60_000_000, 70_000_000));
