import { Hono } from "hono";

import { guardApplicationRequest } from "./applications";
import {
  createAssistedAccount,
  getStaffAccounts,
  parseStaffAccountReconciliation,
  parseStaffCreationRequest,
  reconcileStaffAccount,
} from "./staff-accounts";

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
    return c.json(
      {
        data: {
          receipt: result.receipt,
          ...("temporaryPassword" in result
            ? { temporaryPassword: result.temporaryPassword }
            : {}),
        },
      },
      result.created ? 201 : 200
    );
  })
  .post("/staff/accounts/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-account-reconcile");
    const input = await parseStaffAccountReconciliation(c.req.raw);
    const receipt = await reconcileStaffAccount(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  });
