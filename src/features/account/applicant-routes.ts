import { Hono } from "hono";
import type { Env, MiddlewareHandler } from "hono";
import type * as z from "zod";

import {
  createApplicantAction,
  getApplicantState,
  reconcileApplicantAction,
} from "./applicant-actions";
import {
  applicantActionSchema,
  applicantReconciliationBodySchema,
} from "./application-contract";
import {
  ApplicationRequestError,
  guardApplicationRequest,
  readBoundedJson,
} from "./applications";
import { getOwnApplication } from "./decisions";

/**
 * Keeps the established bounded/fatal-UTF-8 body read and schema message while
 * making the parsed value the route's typed JSON input for the browser RPC.
 */
const applicantJsonValidator = <T extends z.ZodType>(
  schema: T,
  message: string
) =>
  (async (c, next) => {
    const parsed = schema.safeParse(await readBoundedJson(c.req.raw));
    if (!parsed.success) {
      throw new ApplicationRequestError(400, "validation_error", message);
    }
    c.req.addValidatedData("json", parsed.data as object);
    return next();
  }) as MiddlewareHandler<
    Env,
    string,
    { in: { json: z.input<T> }; out: { json: z.output<T> } }
  >;

const applicantGuard =
  (action: "applicant-action" | "applicant-reconcile"): MiddlewareHandler =>
  async (c, next) => {
    await guardApplicationRequest(c.req.raw, action);
    return next();
  };

const applicantActionInput = applicantJsonValidator(
  applicantActionSchema,
  "申請操作資料格式不正確。"
);
const applicantReconciliationInput = applicantJsonValidator(
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
