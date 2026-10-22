import { randomInt } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import { expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";

export const expectResponseStatus = async (
  response: Promise<APIResponse>,
  expected: number
) => {
  const result = await response;
  expect(result.status()).toBe(expected);
  return result;
};

export const phone = () => String(randomInt(60_000_000, 70_000_000));

/** Freeze the actual native read-time tuple before sending or parking a command. */
export const originalIdentity = async (app: NativeApp, userId: string) => {
  const record = await app.db
    .prepare(
      "SELECT u.username AS canonicalUsername, u.email, u.name AS fullName, u.display_username AS username, p.phone, p.phone_shared AS phoneShared FROM user u JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
    )
    .bind(userId)
    .first<{
      canonicalUsername: string | null;
      email: string;
      fullName: string;
      username: string | null;
      phone: string | null;
      phoneShared: 0 | 1;
    }>();
  if (!record) {
    throw new Error("Synthetic original identity was not found");
  }
  return record;
};

export const originalPhone = async (app: NativeApp, userId: string) => {
  const original = await originalIdentity(app, userId);
  return { phone: original.phone, phoneShared: original.phoneShared };
};
