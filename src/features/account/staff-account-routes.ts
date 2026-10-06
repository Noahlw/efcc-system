import { Hono } from "hono";

import { guardApplicationRequest } from "./applications";
import type { StaffAccountReceipt } from "./staff-accounts";
import {
  createAssistedAccount,
  getStaffAccounts,
  parseStaffAccountReconciliation,
  parseStaffCreationRequest,
  parseStaffPasswordRequest,
  reconcileStaffAccount,
  resetStaffPassword,
} from "./staff-accounts";

const credentialResponse = (result: {
  receipt: StaffAccountReceipt;
  temporaryPassword?: string;
}) => ({
  data: {
    receipt: result.receipt,
    ...("temporaryPassword" in result
      ? { temporaryPassword: result.temporaryPassword }
      : {}),
  },
});

/** Staff workspace reads and assisted-account creation/reconciliation routes. */
export const staffAccountRoutes = new Hono()
  .get("/staff/accounts", async (c) => {
    const accounts = await getStaffAccounts(c.req.raw.headers);
    return c.json({ data: { accounts } }, 200);
  })
  .post("/staff/accounts", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-account-create");
    const result = await createAssistedAccount(
      c.req.raw.headers,
      await parseStaffCreationRequest(c.req.raw)
    );
    return c.json(credentialResponse(result), result.created ? 201 : 200);
  })
  .post("/staff/accounts/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-account-reconcile");
    const input = await parseStaffAccountReconciliation(c.req.raw);
    const receipt = await reconcileStaffAccount(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  })
  .post("/staff/accounts/password-reissue", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-password-reissue");
    const result = await resetStaffPassword(
      c.req.raw.headers,
      await parseStaffPasswordRequest(c.req.raw),
      true
    );
    return c.json(credentialResponse(result), result.created ? 201 : 200);
  })
  .post("/staff/accounts/password-reset", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-password-reset");
    const result = await resetStaffPassword(
      c.req.raw.headers,
      await parseStaffPasswordRequest(c.req.raw),
      false
    );
    return c.json(credentialResponse(result), result.created ? 201 : 200);
  });
