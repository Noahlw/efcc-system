import { Hono } from "hono";

import { getAccountAudit } from "./audit";

export const auditRoutes = new Hono().get("/staff/account-audit", async (c) => {
  const recordIds = c.req.queries("record");
  const audit = await getAccountAudit(
    c.req.raw.headers,
    c.req.queries("page"),
    recordIds?.length === 1 ? recordIds[0] : undefined
  );
  return c.json({ data: audit }, 200);
});
