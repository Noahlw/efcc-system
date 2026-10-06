import { Hono } from "hono";

import { guardApplicationRequest } from "./applications";
import { deleteEligibleAccount, parseDeletionRequest } from "./deletion";

export const deletionRoutes = new Hono().post(
  "/staff/accounts/delete",
  async (c) => {
    await guardApplicationRequest(c.req.raw, "account-deletion");
    const result = await deleteEligibleAccount(
      c.req.raw.headers,
      await parseDeletionRequest(c.req.raw)
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  }
);
