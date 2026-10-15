import { Hono } from "hono";

import { getAccountAudit } from "./audit";

export const auditRoutes = new Hono().get("/staff/account-audit", async (c) => {
  const events = await getAccountAudit(c.req.raw.headers);
  return c.json({ data: { events } }, 200);
});
