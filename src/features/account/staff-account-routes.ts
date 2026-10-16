import { Hono } from "hono";

import {
  createAssistedAccount,
  parseStaffAccountReconciliation,
  parseStaffCreationRequest,
  parseStaffPasswordRequest,
  reconcileStaffAccount,
  resetStaffPassword,
} from "./assisted-accounts/assisted-accounts";
import { guardBusinessRequest } from "./business-request";
import { getStaffAccountPage } from "./managed-accounts";

const credentialResponse = (
  result: Awaited<ReturnType<typeof createAssistedAccount>>
) => ({
  data: result.created
    ? {
        receipt: result.receipt,
        temporaryPassword: result.temporaryPassword,
        temporaryPasswordExpiresAt: result.temporaryPasswordExpiresAt,
      }
    : { receipt: result.receipt },
});

/** Staff workspace reads and assisted-account creation/reconciliation routes. */
export const staffAccountRoutes = new Hono()
  .get("/staff/accounts", async (c) => {
    const page = await getStaffAccountPage(
      c.req.raw.headers,
      c.req.query("page"),
      c.req.query("q")
    );
    return c.json({ data: page }, 200);
  })
  .post("/staff/accounts", async (c) => {
    await guardBusinessRequest(c.req.raw, "staff-account-create");
    const result = await createAssistedAccount(
      c.req.raw.headers,
      await parseStaffCreationRequest(c.req.raw)
    );
    return c.json(credentialResponse(result), result.created ? 201 : 200);
  })
  .post("/staff/accounts/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "staff-account-reconcile");
    const input = await parseStaffAccountReconciliation(c.req.raw);
    const receipt = await reconcileStaffAccount(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  })
  .post("/staff/accounts/password-reissue", async (c) => {
    await guardBusinessRequest(c.req.raw, "staff-password-reissue");
    const result = await resetStaffPassword(
      c.req.raw.headers,
      await parseStaffPasswordRequest(c.req.raw),
      true
    );
    return c.json(credentialResponse(result), result.created ? 201 : 200);
  })
  .post("/staff/accounts/password-reset", async (c) => {
    await guardBusinessRequest(c.req.raw, "staff-password-reset");
    const result = await resetStaffPassword(
      c.req.raw.headers,
      await parseStaffPasswordRequest(c.req.raw),
      false
    );
    return c.json(credentialResponse(result), result.created ? 201 : 200);
  });
