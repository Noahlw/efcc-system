import { Hono } from "hono";

import { changeOwnPhone, parseOwnPhone } from "./account-changes";
import { guardApplicationRequest } from "./applications";
import {
  createAccountSecurityOperation,
  parseAccountSecurityRequest,
  parseSecurityReconciliationRequest,
  reconcileAccountSecurityOperation,
} from "./security";

/** Own-phone and credential/session operations under the existing /api/v2 bridge. */
export const accountSecurityRoutes = new Hono()
  .post("/account/phone", async (c) => {
    await guardApplicationRequest(c.req.raw, "own-phone");
    const input = await parseOwnPhone(c.req.raw);
    const result = await changeOwnPhone(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/password", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "password-change");
    const input = await parseAccountSecurityRequest(
      c.req.raw,
      "password_changed"
    );
    const result = await createAccountSecurityOperation(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/sessions/revoke-others", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "session-revoke");
    const input = await parseAccountSecurityRequest(
      c.req.raw,
      "other_sessions_revoked"
    );
    const result = await createAccountSecurityOperation(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/password-confirmation", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "password-confirmation");
    const input = await parseAccountSecurityRequest(
      c.req.raw,
      "password_confirmed"
    );
    const result = await createAccountSecurityOperation(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/security/reconcile", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "security-reconcile");
    const input = await parseSecurityReconciliationRequest(c.req.raw);
    const receipt = await reconcileAccountSecurityOperation(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  });
