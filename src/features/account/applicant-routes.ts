import { Hono } from "hono";

import {
  createApplicantAction,
  getApplicantState,
  parseApplicantAction,
  parseApplicantReconciliation,
  reconcileApplicantAction,
} from "./applicant-actions";
import { guardApplicationRequest } from "./applications";
import { getOwnApplication } from "./decisions";

/** Existing self-applicant reads and operations composed under /api/v2. */
export const applicantRoutes = new Hono()
  .get("/applications/mine", async (c) => {
    const application = await getOwnApplication(c.req.raw.headers);
    return c.json({ data: { application } }, 200);
  })
  .get("/applications/self-service", async (c) => {
    const state = await getApplicantState(c.req.raw.headers);
    return c.json({ data: { state } }, 200);
  })
  .post("/applications/actions", async (c) => {
    await guardApplicationRequest(c.req.raw, "applicant-action");
    const input = await parseApplicantAction(c.req.raw);
    const result = await createApplicantAction(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/applications/actions/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "applicant-reconcile");
    const input = await parseApplicantReconciliation(c.req.raw);
    const receipt = await reconcileApplicantAction(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  });
