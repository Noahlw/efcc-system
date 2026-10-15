import { Hono } from "hono";

import { guardBusinessRequest } from "../business-request";
import {
  changeAccountRestriction,
  parseRestrictionRequest,
} from "./restrictions";

export const restrictionRoutes = new Hono().post(
  "/staff/accounts/restrictions",
  async (c) => {
    await guardBusinessRequest(c.req.raw, "account-restriction");
    const input = await parseRestrictionRequest(c.req.raw);
    const result = await changeAccountRestriction(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  }
);
