import { Hono } from "hono";

import { getRolePersonDetail, searchRolePeople } from "./role-people";

export const rolePeopleRoutes = new Hono()
  .get("/roles/people", async (c) => {
    const result = await searchRolePeople(
      c.req.raw.headers,
      c.req.query("q"),
      c.req.query("page")
    );
    return c.json({ data: result }, 200);
  })
  .get("/roles/people/:targetUserId", async (c) => {
    const person = await getRolePersonDetail(
      c.req.raw.headers,
      c.req.param("targetUserId"),
      c.req.query("assignmentPage"),
      c.req.query("programDepartment"),
      c.req.query("programPage")
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
  });
