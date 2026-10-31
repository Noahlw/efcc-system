import { Hono } from "hono";

import { guardBusinessRequest } from "../account/business-request";
import {
  changeDepartmentManager,
  changeScopedDepartmentManagers,
  getDepartmentManagerDepartments,
  getDepartmentManagerPerson,
  getScopedDepartmentManagerBaseline,
  getScopedProgramLeaderBaseline,
  getDepartmentManagerSearch,
  parseDepartmentManagerChange,
  parseDepartmentManagerReconciliation,
  parseScopedDepartmentManagers,
  reconcileDepartmentManagerChange,
  reconcileScopedDepartmentManagers,
} from "./department-managers";

export const departmentManagerRoutes = new Hono()
  .get(
    "/roles/scoped-department-managers/:targetUserId/programs",
    async (c) => {
      const baseline = await getScopedProgramLeaderBaseline(
        c.req.raw.headers,
        c.req.param("targetUserId"),
        c.req.query("departmentId"),
        c.req.query("page"),
        c.req.query("programId")
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
  .get("/roles/scoped-department-managers/:targetUserId", async (c) => {
    const baseline = await getScopedDepartmentManagerBaseline(
      c.req.raw.headers,
      c.req.param("targetUserId"),
      c.req.query("page")
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
  })
  .post("/roles/scoped-department-managers/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseDepartmentManagerReconciliation(c.req.raw);
    const receipt = await reconcileScopedDepartmentManagers(
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
  .post("/roles/scoped-department-managers", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-assignment");
    const input = await parseScopedDepartmentManagers(c.req.raw);
    const result = await changeScopedDepartmentManagers(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .get("/roles/department-managers", async (c) => {
    const page = await getDepartmentManagerSearch(
      c.req.raw.headers,
      c.req.query("q"),
      c.req.query("page")
    );
    return c.json({ data: page }, 200);
  })
  .get("/roles/department-managers/departments", async (c) => {
    const page = await getDepartmentManagerDepartments(
      c.req.raw.headers,
      c.req.query("page")
    );
    return c.json({ data: page }, 200);
  })
  .get("/roles/department-managers/:targetUserId", async (c) => {
    const person = await getDepartmentManagerPerson(
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
  .post("/roles/department-managers/reconcile", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-reconciliation");
    const input = await parseDepartmentManagerReconciliation(c.req.raw);
    const receipt = await reconcileDepartmentManagerChange(
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
  .post("/roles/department-managers", async (c) => {
    await guardBusinessRequest(c.req.raw, "role-assignment");
    const input = await parseDepartmentManagerChange(c.req.raw);
    const result = await changeDepartmentManager(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  });
