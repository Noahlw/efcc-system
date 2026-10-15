import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import { boundedJsonValidator } from "../bounded-json-validator";
import { guardBusinessRequest } from "../business-request";
import {
  createApplicantAction,
  getApplicantState,
  reconcileApplicantAction,
} from "./applicant-actions";
import {
  applicantActionSchema,
  applicantReconciliationBodySchema,
} from "./application-contract";
import { getOwnApplication } from "./applications";

const applicantGuard =
  (action: "applicant-action" | "applicant-reconcile"): MiddlewareHandler =>
  async (c, next) => {
    await guardBusinessRequest(c.req.raw, action);
    return next();
  };

const applicantActionInput = boundedJsonValidator(
  applicantActionSchema,
  "申請操作資料格式不正確。"
);
const applicantReconciliationInput = boundedJsonValidator(
  applicantReconciliationBodySchema,
  "操作代碼格式不正確。"
);

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
  .post(
    "/applications/actions",
    applicantGuard("applicant-action"),
    applicantActionInput,
    async (c) => {
      const input = c.req.valid("json");
      const result = await createApplicantAction(c.req.raw.headers, input);
      if (result.created) {
        return c.json({ data: { receipt: result.receipt } }, 201);
      }
      return c.json({ data: { receipt: result.receipt } }, 200);
    }
  )
  .post(
    "/applications/actions/reconcile",
    applicantGuard("applicant-reconcile"),
    applicantReconciliationInput,
    async (c) => {
      const input = c.req.valid("json");
      const receipt = await reconcileApplicantAction(
        c.req.raw.headers,
        input.operationKey
      );
      return c.json({ data: { receipt } }, 200);
    }
  );
