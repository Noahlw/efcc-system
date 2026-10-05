import { Hono } from "hono";

import {
  correctStaffIdentity,
  parseIdentityReconciliation,
  parseStaffIdentity,
  reconcileIdentityChange,
} from "./account-changes";
import { guardApplicationRequest } from "./applications";

/** Identity correction and its original-operation reconciliation routes. */
export const identityRoutes = new Hono()
  .post("/staff/accounts/identity", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-identity");
    const input = await parseStaffIdentity(c.req.raw);
    const result = await correctStaffIdentity(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/changes/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "account-change-reconcile");
    const input = await parseIdentityReconciliation(c.req.raw);
    const receipt = await reconcileIdentityChange(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  });
