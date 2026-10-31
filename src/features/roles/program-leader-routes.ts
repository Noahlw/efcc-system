import { Hono } from "hono";

import { guardBusinessRequest } from "../account/business-request";
import {
  changeProgramLeader,
  changeProgramLeaderGrantBatch,
  getProgramLeaderAssigneeBaseline,
  getProgramLeaderCandidates,
  getProgramLeaderDepartments,
  getProgramLeaderPerson,
  getProgramLeaderPrograms,
  getProgramLeaderRoster,
  getProgramLeaderSearch,
  parseProgramLeaderChange,
  parseProgramLeaderReconciliation,
  parseProgramLeaderGrantBatch,
  parseProgramLeaderGrantBatchEligibility,
  parseProgramLeaderGrantBatchReconciliation,
  reconcileProgramLeaderChange,
  reconcileProgramLeaderGrantBatch,
  validateProgramLeaderGrantBatch,
} from "./program-leaders";

export const programLeaderRoutes = new Hono()
  .post("/roles/program-leader-grant-batches/validate", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseProgramLeaderGrantBatchEligibility(c.req.raw);
    return c.json(
      { data: await validateProgramLeaderGrantBatch(c.req.raw.headers, input) },
      200
    );
  })
  .post("/roles/program-leader-grant-batches/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseProgramLeaderGrantBatchReconciliation(c.req.raw);
    return c.json(
      {
        data: await reconcileProgramLeaderGrantBatch(
          c.req.raw.headers,
          input.operationKey
        ),
      },
      200
    );
  })
  .post("/roles/program-leader-grant-batches", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-assignment");
    const input = await parseProgramLeaderGrantBatch(c.req.raw);
    const result = await changeProgramLeaderGrantBatch(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .get("/roles/program-leaders", async (c) => {
    const page = await getProgramLeaderSearch(
      c.req.raw.headers,
      c.req.query("q"),
      c.req.query("page")
    );
    return c.json({ data: page }, 200);
  })
  .get("/roles/program-leaders/programs", async (c) => {
    const page = await getProgramLeaderPrograms(
      c.req.raw.headers,
      c.req.query("page"),
      c.req.query("departmentId"),
      c.req.query("local") === "1",
      c.req.query("authority")
    );
    return c.json({ data: page }, 200);
  })
  .get("/roles/program-leaders/departments", async (c) => {
    const page = await getProgramLeaderDepartments(
      c.req.raw.headers,
      c.req.query("page")
    );
    return c.json({ data: page }, 200);
  })
  .get("/roles/program-leaders/programs/:programId/leaders", async (c) => {
    const page = await getProgramLeaderRoster(
      c.req.raw.headers,
      c.req.param("programId"),
      c.req.query("page"),
      c.req.query("authority")
    );
    return c.json({ data: page }, 200);
  })
  .get(
    "/roles/program-leaders/programs/:programId/leaders/:targetUserId",
    async (c) => {
      const baseline = await getProgramLeaderAssigneeBaseline(
        c.req.raw.headers,
        c.req.param("programId"),
        c.req.param("targetUserId")
      );
      return baseline
        ? c.json({ data: baseline }, 200)
        : c.json(
            {
              error: {
                code: "not_found" as const,
                message: "此人士目前不在可管理的範圍內。",
              },
            },
            404
          );
    }
  )
  .get("/roles/program-leaders/programs/:programId/candidates", async (c) => {
    const page = await getProgramLeaderCandidates(
      c.req.raw.headers,
      c.req.param("programId"),
      c.req.query("q"),
      c.req.query("page"),
      c.req.query("authority")
    );
    return c.json({ data: page }, 200);
  })
  .get("/roles/program-leaders/:targetUserId", async (c) => {
    const person = await getProgramLeaderPerson(
      c.req.raw.headers,
      c.req.param("targetUserId"),
      c.req.query("assignmentPage")
    );
    return person
      ? c.json({ data: { person } }, 200)
      : c.json(
          {
            error: {
              code: "not_found" as const,
              message: "此人士目前不在可管理的範圍內。",
            },
          },
          404
        );
  })
  .post("/roles/program-leaders/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseProgramLeaderReconciliation(c.req.raw);
    const receipt = await reconcileProgramLeaderChange(
      c.req.raw.headers,
      input.operationKey,
      input.authorityKind
    );
    return c.json(
      {
        data: {
          outcome: receipt ? ("committed" as const) : ("unknown" as const),
          receipt,
        },
      },
      200
    );
  })
  .post("/roles/program-leaders", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-assignment");
    const input = await parseProgramLeaderChange(c.req.raw);
    const result = await changeProgramLeader(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  });
