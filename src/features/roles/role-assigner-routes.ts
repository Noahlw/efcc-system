import { Hono } from "hono";

import { guardBusinessRequest } from "../account/business-request";
import {
  changeRoleAssigner,
  parseRoleAssignerChange,
  parseRoleAssignerReconciliation,
  reconcileRoleAssignerChange,
} from "./role-assigners";

export const roleAssignerRoutes = new Hono()
  .post("/roles/role-assigners/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseRoleAssignerReconciliation(c.req.raw);
    const receipt = await reconcileRoleAssignerChange(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json(
      {
        data: {
          outcome: receipt ? ("committed" as const) : ("unknown" as const),
          receipt,
        },
      },
      200
    );
  })
  .post("/roles/role-assigners", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-assignment");
    const input = await parseRoleAssignerChange(c.req.raw);
    const result = await changeRoleAssigner(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  });
