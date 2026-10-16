import type { InferResponseType } from "hono/client";
import { expect, expectTypeOf, it } from "vitest";

import { BusinessApiError as SharedBusinessApiError } from "../../../src/features/account/business-error-contract";
import type { BusinessApiError } from "../../../src/features/account/business-request";
import { operationErrorSchema } from "../../../src/features/account/operation-error";
import type { businessRpc } from "../../../src/shared/business-rpc";

// Checked by the repository TypeScript gate; this function is never executed.
const checkBusinessFailureArguments = (
  create: (...args: ConstructorParameters<typeof BusinessApiError>) => unknown
): void => {
  create(400, "invalid_password", "目前密碼不正確，未有作出變更或確認。");
  create(401, "unauthorized", "請先登入。");
  // @ts-expect-error The runtime status/code pair must agree with the RPC contract.
  create(401, "invalid_password", "目前密碼不正確，未有作出變更或確認。");
  // @ts-expect-error A new code must first join the authoritative business contract.
  create(400, "unregistered_failure", "disposable type-only demonstration");
};
void checkBusinessFailureArguments;

it("keeps business messages and safely readable unknown business codes", () => {
  expect(
    operationErrorSchema.parse({
      error: {
        code: "invalid_password",
        message: "目前密碼不正確，未有作出變更或確認。",
      },
    })
  ).toEqual({
    error: {
      code: "invalid_password",
      message: "目前密碼不正確，未有作出變更或確認。",
    },
  });
  expect(
    operationErrorSchema.safeParse({
      error: { code: "future_business_failure", message: "保留伺服器訊息。" },
    }).success
  ).toBe(true);
});

it("retains the inferred RPC status/code contract and runtime error identity", () => {
  expectTypeOf<
    InferResponseType<typeof businessRpc.api.v2.account.password.$post, 400>
  >().toEqualTypeOf<{
    error: { code: "validation_error" | "invalid_password"; message: string };
  }>();
  const failure = new SharedBusinessApiError(
    400,
    "invalid_password",
    "目前密碼不正確，未有作出變更或確認。"
  );
  expect(failure).toBeInstanceOf(Error);
  expect({
    code: failure.code,
    message: failure.message,
    name: failure.name,
    status: failure.status,
  }).toEqual({
    code: "invalid_password",
    message: "目前密碼不正確，未有作出變更或確認。",
    name: "BusinessApiError",
    status: 400,
  });
});
