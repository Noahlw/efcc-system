import { Hono } from "hono";

import { getOwnAccountIdentity } from "./account-changes";
import { getDecisionInbox } from "./decisions";
import { getAccountSecurityState } from "./security";

/** Read-only routes used by the delivered Inbox and Account work. */
export const accountReadRoutes = new Hono()
  .get("/inbox", async (c) => {
    const decisions = await getDecisionInbox(c.req.raw.headers);
    return c.json({ data: { decisions } }, 200);
  })
  .get("/account/security", async (c) => {
    const state = await getAccountSecurityState(c.req.raw.headers);
    return c.json({ data: { state } }, 200);
  })
  .get("/account/identity", async (c) => {
    const identity = await getOwnAccountIdentity(c.req.raw.headers);
    return c.json({ data: { identity } }, 200);
  });
