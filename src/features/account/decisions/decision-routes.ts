import { Hono } from "hono";

import { guardBusinessRequest } from "../business-request";
import {
  createApplicationDecision,
  getReviewApplications,
  parseDecisionReconciliationRequest,
  parseDecisionRequest,
  reconcileApplicationDecision,
} from "./decisions";

export const decisionRoutes = new Hono()
  .get("/staff/applications", async (c) => {
    const page = await getReviewApplications(
      c.req.raw.headers,
      c.req.query("page"),
      c.req.query("record")
    );
    return c.json({ data: page }, 200);
  })
  .post("/staff/application-decisions", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardBusinessRequest(c.req.raw, "decision");
    const input = await parseDecisionRequest(c.req.raw);
    const result = await createApplicationDecision(c.req.raw.headers, input);
    return c.json(
      { data: { decision: result.decision } },
      result.created ? 201 : 200
    );
  })
  .post("/staff/application-decisions/reconcile", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardBusinessRequest(c.req.raw, "decision-reconcile");
    const input = await parseDecisionReconciliationRequest(c.req.raw);
    const result = await reconcileApplicationDecision(
      c.req.raw.headers,
      input.operationKey,
      input.applicationId
    );
    return c.json({ data: result }, 200);
  });
