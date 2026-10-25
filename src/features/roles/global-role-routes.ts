import { Hono } from "hono";

import { guardBusinessRequest } from "../account/business-request";
import {
  changeGlobalRole,
  getGlobalRolePerson,
  parseGlobalRoleChange,
  parseGlobalRoleReconciliation,
  reconcileGlobalRoleChange,
  searchGlobalRolePeople,
} from "./global-roles";

export const globalRoleRoutes = new Hono()
  .get("/roles/global-roles", async (c) => {
    const result = await searchGlobalRolePeople(
      c.req.raw.headers,
      c.req.query("q"),
      c.req.query("page")
    );
    return c.json({ data: result }, 200);
  })
  .get("/roles/global-roles/:targetUserId", async (c) => {
    const person = await getGlobalRolePerson(
      c.req.raw.headers,
      c.req.param("targetUserId")
    );
    return person
      ? c.json({ data: { person } }, 200)
      : c.json(
          {
            error: {
              code: "not_found" as const,
              message: "此人士目前不在可管理的範圍內。",
            },
          },
          404
        );
  })
  .post("/roles/global-roles/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseGlobalRoleReconciliation(c.req.raw);
    const receipt = await reconcileGlobalRoleChange(
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
  .post("/roles/global-roles", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-assignment");
    const input = await parseGlobalRoleChange(c.req.raw);
    const result = await changeGlobalRole(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  });
