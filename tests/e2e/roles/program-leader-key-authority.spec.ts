import { randomUUID } from "node:crypto";

import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";

type RoleKind = "department_manager" | "program_leader";
type NativePlaywright = PlaywrightWorkerArgs["playwright"];

interface AdminActor {
  context: APIRequestContext;
  userId: string;
}

interface RoleGrantScenario {
  kind: RoleKind;
  route: string;
  scopeId: string;
  scopeName: string;
}

interface RoleChangeReceipt {
  action: string;
  createdAt: number;
  id: string;
  scopeId: string;
  scopeName: string;
  targetUserId: string;
}

interface RoleCommandResponse {
  data: { receipt: RoleChangeReceipt };
}

interface RoleEffects {
  departmentAssignments: number;
  departmentAudits: number;
  departmentHistory: number;
  programAssignments: number;
  programAudits: number;
  programHistory: number;
  receiptCount: number;
  receiptId: string | null;
  receiptRole: string | null;
}

interface RoleChangeInboxEvent {
  action: string;
  createdAt: number;
  role: string;
  scopeName: string;
}

const password = "Synthetic-native-password!";

const roleTest = dedicatedTest.extend<{
  admin: AdminActor;
}>({
  admin: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `roles.admin.${suffix}`;
    const userId = await caseApp.provision.account({
      email: `${suffix}@example.com`,
      fullName: `陳測試管理員${suffix}`,
      membershipStatus: "active",
      password,
      role: "admin",
      username,
    });
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const login = await context.post("/api/auth/sign-in/username", {
        data: { password, username },
      });
      expect(login.status()).toBe(200);
      const confirmation = await context.post(
        "/api/v2/account/password-confirmation",
        { data: { operationKey: randomUUID(), password } }
      );
      expect(confirmation.status()).toBe(201);
      await use({ context, userId });
    } finally {
      await context.dispose();
    }
  },
});

const roleEffects = async (
  app: NativeApp,
  actorUserId: string,
  targetUserId: string,
  departmentId: string,
  programId: string,
  operationKey: string
): Promise<RoleEffects> => {
  const result = await app.db
    .prepare(
      "select " +
        "(select count(*) from department_manager_assignment where user_id = ? and department_id = ?) as departmentAssignments, " +
        "(select count(*) from program_leader_assignment where user_id = ? and program_id = ?) as programAssignments, " +
        "(select count(*) from role_assignment_history where target_user_id = ? and role = 'department_manager') as departmentHistory, " +
        "(select count(*) from role_assignment_history where target_user_id = ? and role = 'program_leader') as programHistory, " +
        "(select count(*) from audit_event where target_user_id = ? and action = 'department_manager_granted') as departmentAudits, " +
        "(select count(*) from audit_event where target_user_id = ? and action = 'program_leader_granted') as programAudits, " +
        "(select count(*) from role_change_operation where actor_user_id = ? and operation_key = ?) as receiptCount, " +
        "(select id from role_change_operation where actor_user_id = ? and operation_key = ? limit 1) as receiptId, " +
        "(select role from role_change_operation where actor_user_id = ? and operation_key = ? limit 1) as receiptRole"
    )
    .bind(
      targetUserId,
      departmentId,
      targetUserId,
      programId,
      targetUserId,
      targetUserId,
      targetUserId,
      targetUserId,
      actorUserId,
      operationKey,
      actorUserId,
      operationKey,
      actorUserId,
      operationKey
    )
    .first<RoleEffects>();
  if (!result) {
    throw new Error("Expected the cross-role effect snapshot");
  }
  return result;
};

const readRoleChanges = async (context: APIRequestContext) => {
  const response = await context.get("/api/v2/inbox");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    data: { roleChanges: RoleChangeInboxEvent[] };
  };
  return body.data.roleChanges;
};

const expectSingleRoleChange = async (
  context: APIRequestContext,
  scenario: RoleGrantScenario
) => {
  expect(await readRoleChanges(context)).toEqual([
    {
      action: "granted",
      createdAt: expect.any(Number),
      role: scenario.kind,
      scopeName: scenario.scopeName,
    },
  ]);
};

const assertCrossRoleKeyReuse = async (
  firstKind: RoleKind,
  {
    admin,
    caseApp,
    extraHTTPHeaders,
    playwright,
  }: {
    admin: AdminActor;
    caseApp: NativeApp;
    extraHTTPHeaders: Record<string, string>;
    playwright: NativePlaywright;
  }
) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `roles.member.${suffix}`;
  const targetUserId = await caseApp.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳跨角色測試${suffix}`,
    membershipStatus: "active",
    password,
    role: "member",
    username,
  });

  const departmentId = randomUUID();
  const programId = randomUUID();
  const departmentName = `跨角色部門${suffix}`;
  const programName = `跨角色聚會${suffix}`;
  await caseApp.db.batch([
    caseApp.db
      .prepare(
        "insert into department (id, name, created_at) values (?, ?, unixepoch())"
      )
      .bind(departmentId, departmentName),
    caseApp.db
      .prepare(
        "insert into program (id, department_id, name, created_at) values (?, ?, ?, unixepoch())"
      )
      .bind(programId, departmentId, programName),
  ]);

  const departmentScenario: RoleGrantScenario = {
    kind: "department_manager",
    route: "/api/v2/roles/department-managers",
    scopeId: departmentId,
    scopeName: departmentName,
  };
  const programScenario: RoleGrantScenario = {
    kind: "program_leader",
    route: "/api/v2/roles/program-leaders",
    scopeId: programId,
    scopeName: programName,
  };
  const firstScenario =
    firstKind === "department_manager" ? departmentScenario : programScenario;
  const otherScenario =
    firstKind === "department_manager" ? programScenario : departmentScenario;
  const operationKey = randomUUID();
  const firstInput = {
    action: "granted",
    operationKey,
    scopeId: firstScenario.scopeId,
    targetUserId,
  };

  const recipient = await playwright.request.newContext({
    baseURL: caseApp.origin,
    extraHTTPHeaders,
  });
  try {
    const login = await recipient.post("/api/auth/sign-in/username", {
      data: { password, username },
    });
    expect(login.status()).toBe(200);

    const firstGrant = await admin.context.post(firstScenario.route, {
      data: firstInput,
    });
    expect(firstGrant.status()).toBe(201);
    const firstBody = (await firstGrant.json()) as RoleCommandResponse;
    const firstReceipt = firstBody.data.receipt;
    const afterFirst = await roleEffects(
      caseApp,
      admin.userId,
      targetUserId,
      departmentId,
      programId,
      operationKey
    );
    expect(afterFirst).toMatchObject({
      departmentAssignments: firstKind === "department_manager" ? 1 : 0,
      departmentAudits: firstKind === "department_manager" ? 1 : 0,
      departmentHistory: firstKind === "department_manager" ? 1 : 0,
      programAssignments: firstKind === "program_leader" ? 1 : 0,
      programAudits: firstKind === "program_leader" ? 1 : 0,
      programHistory: firstKind === "program_leader" ? 1 : 0,
      receiptCount: 1,
      receiptId: firstReceipt.id,
      receiptRole: firstKind,
    });
    await expectSingleRoleChange(recipient, firstScenario);

    const crossRoleReuse = await admin.context.post(otherScenario.route, {
      data: {
        action: "granted",
        operationKey,
        scopeId: otherScenario.scopeId,
        targetUserId,
      },
    });
    expect(crossRoleReuse.status()).toBe(409);
    const conflictBody: unknown = await crossRoleReuse.json();
    expect(conflictBody).toMatchObject({ error: { code: "conflict" } });
    expect(JSON.stringify(conflictBody)).not.toContain(firstReceipt.id);
    expect(
      await roleEffects(
        caseApp,
        admin.userId,
        targetUserId,
        departmentId,
        programId,
        operationKey
      )
    ).toEqual(afterFirst);
    await expectSingleRoleChange(recipient, firstScenario);

    const replay = await admin.context.post(firstScenario.route, {
      data: firstInput,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect(
      await roleEffects(
        caseApp,
        admin.userId,
        targetUserId,
        departmentId,
        programId,
        operationKey
      )
    ).toEqual(afterFirst);
    await expectSingleRoleChange(recipient, firstScenario);
  } finally {
    await recipient.dispose();
  }
};

roleTest.describe(
  "actor-wide role operation keys",
  {
    tag: ["@native", "@risk-authorization", "@risk-atomicity", "@risk-history"],
  },
  () => {
    roleTest(
      "a Department Manager key conflicts with Program Leader reuse and replays the original receipt",
      { tag: ["@http"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        await assertCrossRoleKeyReuse("department_manager", {
          admin,
          caseApp,
          extraHTTPHeaders: extraHTTPHeaders ?? {},
          playwright,
        });
      }
    );

    roleTest(
      "a Program Leader key conflicts with Department Manager reuse and replays the original receipt",
      { tag: ["@http"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        await assertCrossRoleKeyReuse("program_leader", {
          admin,
          caseApp,
          extraHTTPHeaders: extraHTTPHeaders ?? {},
          playwright,
        });
      }
    );
  }
);
