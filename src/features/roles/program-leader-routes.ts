import { Hono } from "hono";

import { guardBusinessRequest } from "../account/business-request";
import {
  changeProgramLeader,
  getProgramLeaderPerson,
  getProgramLeaderPrograms,
  getProgramLeaderSearch,
  parseProgramLeaderChange,
  parseProgramLeaderReconciliation,
  reconcileProgramLeaderChange,
} from "./program-leaders";

export const programLeaderRoutes = new Hono()
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
      c.req.query("page")
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
      input.operationKey
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
