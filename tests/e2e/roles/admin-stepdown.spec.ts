import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";

const signIn = async (
  context: APIRequestContext,
  username: string,
  password: string
) => {
  const response = await context.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
  expect(response.status()).toBe(200);
};

const confirmPassword = async (
  context: APIRequestContext,
  password: string
) => {
  const response = await context.post("/api/v2/account/password-confirmation", {
    data: { operationKey: randomUUID(), password },
  });
  expect(response.status()).toBe(201);
};

dedicatedTest(
  "the last-Admin guard excludes another Admin with an empty permanent credential",
  {
    tag: ["@native", "@http", "@risk-authorization", "@risk-atomicity"],
  },
  async ({ caseApp }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const actorUserId = await caseApp.provision.account({
      email: `stepdown.actor.${suffix}@example.com`,
      fullName: `陳自願離任管理員${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-native-password!",
      role: "admin",
      username: `sd.actor.${suffix}`,
    });
    const emptyCredentialAdminId = await caseApp.provision.account({
      email: `stepdown.empty.${suffix}@example.com`,
      fullName: `陳空密碼管理員${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-native-password!",
      role: "admin",
      username: `sd.empty.${suffix}`,
    });

    const credentialUpdate = await caseApp.db
      .prepare(
        "UPDATE account SET password='', updated_at=unixepoch() WHERE user_id=? AND account_id=? AND provider_id='credential'"
      )
      .bind(emptyCredentialAdminId, emptyCredentialAdminId)
      .run();
    expect(credentialUpdate.meta.changes).toBe(1);

    const peer = await caseApp.db
      .prepare(
        `SELECT
          p.account_role AS role,
          p.membership_status AS membershipStatus,
          p.banned_at AS bannedAt,
          a.password AS password,
          a.temporary_password_expires_at AS temporaryPasswordExpiresAt
        FROM person_profile p
        INNER JOIN account a
          ON a.user_id=p.user_id
          AND a.account_id=p.user_id
          AND a.provider_id='credential'
        WHERE p.user_id=?`
      )
      .bind(emptyCredentialAdminId)
      .first();
    expect(peer).toEqual({
      bannedAt: null,
      membershipStatus: "active",
      password: "",
      role: "admin",
      temporaryPasswordExpiresAt: null,
    });

    await expect(
      caseApp.db
        .prepare(
          "UPDATE person_profile SET account_role='member' WHERE user_id=? AND account_role='admin'"
        )
        .bind(actorUserId)
        .run()
    ).rejects.toThrow(/Last effective administrator/u);
    await expect(
      caseApp.db
        .prepare("DELETE FROM person_profile WHERE user_id=?")
        .bind(actorUserId)
        .run()
    ).rejects.toThrow(/Last effective administrator/u);
    await expect(
      caseApp.db.prepare("DELETE FROM user WHERE id=?").bind(actorUserId).run()
    ).rejects.toThrow(/Last effective administrator/u);

    const actorRole = await caseApp.db
      .prepare(
        "SELECT account_role AS role FROM person_profile WHERE user_id=?"
      )
      .bind(actorUserId)
      .first();
    expect(actorRole).toEqual({ role: "admin" });
  }
);

dedicatedTest(
  "self-stepdown rolls back when the actor is the last effective Admin",
  {
    tag: [
      "@native",
      "@http",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-session",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const password = "Synthetic-last-admin-password!";
    const username = `sd.last.${suffix}`;
    const actorUserId = await caseApp.provision.account({
      email: `stepdown.last.${suffix}@example.com`,
      fullName: `陳最後管理員${suffix}`,
      membershipStatus: "active",
      password,
      role: "admin",
      username,
    });
    const [initiatingContext, secondContext] = await Promise.all([
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      }),
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      }),
    ]);
    const contexts = [initiatingContext, secondContext];
    const operationKey = randomUUID();
    try {
      await Promise.all(
        contexts.map((context) => signIn(context, username, password))
      );
      await confirmPassword(initiatingContext, password);
      expect(
        await caseApp.db
          .prepare("SELECT COUNT(*) AS sessions FROM session WHERE user_id=?")
          .bind(actorUserId)
          .first()
      ).toEqual({ sessions: 2 });

      const response = await initiatingContext.post(
        "/api/v2/roles/global-roles",
        {
          data: {
            action: "withdrawn",
            operationKey,
            resultingGlobalRole: "member",
            role: "admin",
            targetUserId: actorUserId,
          },
        }
      );
      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "conflict" },
      });

      const state = await caseApp.db
        .prepare(
          `SELECT
            (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
            (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
            (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id=? AND target_user_id=? AND action='withdrawn' AND role='admin') AS history,
            (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=?) AS receipts,
            (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND target_user_id=? AND action='global_role_changed') AS audits`
        )
        .bind(
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          operationKey,
          actorUserId,
          actorUserId
        )
        .first();
      expect(state).toEqual({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
        sessions: 2,
      });

      const stillAdmin = await Promise.all(
        contexts.map(async (context) => {
          const session = await context.get("/api/auth/get-session");
          const body: unknown = await session.json();
          const protectedRead = await context.get("/api/v2/roles/global-roles");
          return {
            protectedReadStatus: protectedRead.status(),
            sessionBody: body,
            sessionStatus: session.status(),
          };
        })
      );
      expect(stillAdmin).toEqual(
        contexts.map(() => ({
          protectedReadStatus: 200,
          sessionBody: expect.objectContaining({
            user: expect.objectContaining({ id: actorUserId }),
          }),
          sessionStatus: 200,
        }))
      );
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  }
);

dedicatedTest(
  "self-stepdown requires current-session password proof and credential revision",
  {
    tag: [
      "@native",
      "@http",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-session",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const password = "Synthetic-stepdown-proof-password!";
    const username = `sd.proof.${suffix}`;
    const actorUserId = await caseApp.provision.account({
      email: `stepdown.proof.${suffix}@example.com`,
      fullName: `陳驗證離任證明${suffix}`,
      membershipStatus: "active",
      password,
      role: "admin",
      username,
    });
    await caseApp.provision.account({
      email: `stepdown.proof.peer.${suffix}@example.com`,
      fullName: `陳驗證保留管理員${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-stepdown-proof-peer-password!",
      role: "admin",
      username: `sd.proof.peer.${suffix}`,
    });
    const [initiatingContext, secondContext] = await Promise.all([
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      }),
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
      }),
    ]);
    const contexts = [initiatingContext, secondContext];
    const missingProofOperationKey = randomUUID();
    const staleProofOperationKey = randomUUID();
    try {
      await Promise.all(
        contexts.map((context) => signIn(context, username, password))
      );
      const missingProof = await initiatingContext.post(
        "/api/v2/roles/global-roles",
        {
          data: {
            action: "withdrawn",
            operationKey: missingProofOperationKey,
            resultingGlobalRole: "member",
            role: "admin",
            targetUserId: actorUserId,
          },
        }
      );
      expect(missingProof.status()).toBe(403);

      await confirmPassword(initiatingContext, password);
      const revisionUpdate = await caseApp.db
        .prepare(
          "UPDATE account SET credential_revision=credential_revision+1, updated_at=unixepoch() WHERE user_id=? AND account_id=? AND provider_id='credential'"
        )
        .bind(actorUserId, actorUserId)
        .run();
      expect(revisionUpdate.meta.changes).toBe(1);

      const staleProof = await initiatingContext.post(
        "/api/v2/roles/global-roles",
        {
          data: {
            action: "withdrawn",
            operationKey: staleProofOperationKey,
            resultingGlobalRole: "member",
            role: "admin",
            targetUserId: actorUserId,
          },
        }
      );
      expect(staleProof.status()).toBe(401);

      const state = await caseApp.db
        .prepare(
          `SELECT
            (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
            (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
            (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id=? AND target_user_id=? AND action='withdrawn' AND role='admin') AS history,
            (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key IN (?,?)) AS receipts,
            (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND target_user_id=? AND action='global_role_changed') AS audits`
        )
        .bind(
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          missingProofOperationKey,
          staleProofOperationKey,
          actorUserId,
          actorUserId
        )
        .first();
      expect(state).toEqual({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
        sessions: 2,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  }
);

dedicatedTest(
  "an Admin can step down to Staff without changing independent assignments",
  {
    tag: [
      "@native",
      "@http",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-session",
      "@risk-history",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const adminPassword = "Synthetic-stepdown-peer-password!";
    const adminUsername = `sd.staff.peer.${suffix}`;
    const actorPassword = "Synthetic-stepdown-staff-password!";
    const actorUsername = `sd.staff.self.${suffix}`;
    await caseApp.provision.account({
      email: `stepdown.staff.peer.${suffix}@example.com`,
      fullName: `陳保留職員管理員${suffix}`,
      membershipStatus: "active",
      password: adminPassword,
      role: "admin",
      username: adminUsername,
    });
    const actorUserId = await caseApp.provision.account({
      email: `stepdown.staff.self.${suffix}@example.com`,
      fullName: `陳退出後職員${suffix}`,
      membershipStatus: "active",
      password: actorPassword,
      role: "staff",
      username: actorUsername,
    });
    const departmentId = randomUUID();
    const programId = randomUUID();
    await caseApp.db
      .prepare(
        "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
      )
      .bind(departmentId, `自願退出保留部門${suffix}`)
      .run();
    await caseApp.db
      .prepare(
        "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
      )
      .bind(programId, departmentId, `自願退出保留聚會${suffix}`)
      .run();
    await Promise.all([
      caseApp.db
        .prepare(
          "INSERT INTO department_membership(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
        )
        .bind(randomUUID(), departmentId, actorUserId)
        .run(),
      caseApp.db
        .prepare(
          "INSERT INTO department_manager_assignment(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
        )
        .bind(randomUUID(), departmentId, actorUserId)
        .run(),
      caseApp.db
        .prepare(
          "INSERT INTO program_leader_assignment(id,program_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
        )
        .bind(randomUUID(), programId, actorUserId)
        .run(),
      caseApp.db
        .prepare(
          "INSERT INTO enrolment(created_at,id,program_id,status,updated_at,user_id) VALUES(unixepoch(),?,?, 'approved',unixepoch(),?)"
        )
        .bind(randomUUID(), programId, actorUserId)
        .run(),
    ]);

    const headersForIp = (address: string) => ({
      ...extraHTTPHeaders,
      "cf-connecting-ip": address,
    });
    const adminContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: headersForIp("198.19.253.1"),
    });
    const [actorContext, secondActorContext] = await Promise.all([
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: headersForIp("198.19.253.2"),
      }),
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: headersForIp("198.19.253.3"),
      }),
    ]);
    const actorContexts = [actorContext, secondActorContext];
    const freshContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: headersForIp("198.19.253.4"),
    });
    const operationKey = randomUUID();
    try {
      await signIn(adminContext, adminUsername, adminPassword);
      await confirmPassword(adminContext, adminPassword);
      const roleAssignerGrant = await adminContext.post(
        "/api/v2/roles/role-assigners",
        {
          data: {
            action: "granted",
            operationKey: randomUUID(),
            targetUserId: actorUserId,
          },
        }
      );
      expect(roleAssignerGrant.status()).toBe(201);

      await confirmPassword(adminContext, adminPassword);
      const adminGrant = await adminContext.post("/api/v2/roles/global-roles", {
        data: {
          action: "granted",
          operationKey: randomUUID(),
          role: "admin",
          targetUserId: actorUserId,
        },
      });
      expect(adminGrant.status()).toBe(201);
      expect(
        await caseApp.db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id=?) AS roleAssignerAssignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='role_assigner' AND action='withdrawn') AS roleAssignerWithdrawals,
              (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id=?) AS departmentManagers,
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id=?) AS programLeaders`
          )
          .bind(actorUserId, actorUserId, actorUserId, actorUserId)
          .first()
      ).toEqual({
        departmentManagers: 1,
        programLeaders: 1,
        roleAssignerAssignments: 0,
        roleAssignerWithdrawals: 1,
      });

      await Promise.all(
        actorContexts.map((context) =>
          signIn(context, actorUsername, actorPassword)
        )
      );
      await confirmPassword(actorContext, actorPassword);
      expect(
        await caseApp.db
          .prepare("SELECT COUNT(*) AS sessions FROM session WHERE user_id=?")
          .bind(actorUserId)
          .first()
      ).toEqual({ sessions: 2 });

      const stepdown = await actorContext.post("/api/v2/roles/global-roles", {
        data: {
          action: "withdrawn",
          operationKey,
          resultingGlobalRole: "staff",
          role: "admin",
          targetUserId: actorUserId,
        },
      });
      expect(stepdown.status()).toBe(201);
      expect(await stepdown.json()).toMatchObject({
        data: {
          receipt: {
            action: "withdrawn",
            resultingGlobalRole: "staff",
            role: "admin",
            targetUserId: actorUserId,
          },
        },
      });

      const state = await caseApp.db
        .prepare(
          `SELECT
            (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
            (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
            (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id=?) AS roleAssignerAssignments,
            (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='role_assigner' AND action='withdrawn') AS roleAssignerWithdrawals,
            (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id=?) AS departmentManagers,
            (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id=?) AS programLeaders,
            (SELECT COUNT(*) FROM department_membership WHERE user_id=?) AS departmentMemberships,
            (SELECT COUNT(*) FROM enrolment WHERE user_id=?) AS enrolments,
            (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id=? AND target_user_id=? AND action='withdrawn' AND role='admin' AND resulting_global_role='staff') AS history,
            (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND target_user_id=? AND operation_key=? AND action='withdrawn' AND role='admin' AND resulting_global_role='staff') AS receipts,
            (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND target_user_id=? AND action='global_role_changed') AS audits`
        )
        .bind(
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          operationKey,
          actorUserId,
          actorUserId
        )
        .first();
      expect(state).toEqual({
        audits: 1,
        departmentManagers: 1,
        departmentMemberships: 1,
        enrolments: 1,
        history: 1,
        programLeaders: 1,
        receipts: 1,
        role: "staff",
        roleAssignerAssignments: 0,
        roleAssignerWithdrawals: 1,
        sessions: 0,
      });

      const oldSessions = await Promise.all(
        actorContexts.map(async (context) => {
          const session = await context.get("/api/auth/get-session");
          const sessionBody: unknown = await session.json();
          const protectedRead = await context.get("/api/v2/roles/global-roles");
          return {
            protectedReadStatus: protectedRead.status(),
            sessionBody,
            sessionStatus: session.status(),
          };
        })
      );
      expect(oldSessions).toEqual([
        {
          protectedReadStatus: 401,
          sessionBody: null,
          sessionStatus: 200,
        },
        {
          protectedReadStatus: 401,
          sessionBody: null,
          sessionStatus: 200,
        },
      ]);

      await signIn(freshContext, actorUsername, actorPassword);
      const staffAccounts = await freshContext.get("/api/v2/staff/accounts");
      const adminRoleRead = await freshContext.get(
        "/api/v2/roles/global-roles"
      );
      expect(staffAccounts.status()).toBe(200);
      expect(adminRoleRead.status()).toBe(403);
    } finally {
      await Promise.all([
        adminContext.dispose(),
        ...actorContexts.map((context) => context.dispose()),
        freshContext.dispose(),
      ]);
    }
  }
);

dedicatedTest(
  "a confirmed Admin can voluntarily step down to Member and revoke every session",
  {
    tag: [
      "@native",
      "@http",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-history",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright }) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const password = "Synthetic-stepdown-admin-password!";
    const username = `sd.self.${suffix}`;
    const actorUserId = await caseApp.provision.account({
      email: `stepdown.self.${suffix}@example.com`,
      fullName: `陳自願離任管理員${suffix}`,
      membershipStatus: "active",
      password,
      role: "admin",
      username,
    });
    await caseApp.provision.account({
      email: `stepdown.peer.${suffix}@example.com`,
      fullName: `陳保留管理員${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-stepdown-peer-password!",
      role: "admin",
      username: `sd.peer.${suffix}`,
    });

    const initiatingContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    const secondContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    const operationKey = randomUUID();
    try {
      const logins = await Promise.all(
        [initiatingContext, secondContext].map((context) =>
          context.post("/api/auth/sign-in/username", {
            data: { password, username },
          })
        )
      );
      expect(logins.map((login) => login.status())).toEqual([200, 200]);
      const confirmation = await initiatingContext.post(
        "/api/v2/account/password-confirmation",
        { data: { operationKey: randomUUID(), password } }
      );
      expect(confirmation.status()).toBe(201);
      expect(
        await caseApp.db
          .prepare("SELECT COUNT(*) AS sessions FROM session WHERE user_id=?")
          .bind(actorUserId)
          .first()
      ).toEqual({ sessions: 2 });

      const response = await initiatingContext.post(
        "/api/v2/roles/global-roles",
        {
          data: {
            action: "withdrawn",
            operationKey,
            resultingGlobalRole: "member",
            role: "admin",
            targetUserId: actorUserId,
          },
        }
      );
      expect(response.status()).toBe(201);
      expect(await response.json()).toMatchObject({
        data: {
          receipt: {
            action: "withdrawn",
            resultingGlobalRole: "member",
            role: "admin",
            targetUserId: actorUserId,
          },
        },
      });

      const state = await caseApp.db
        .prepare(
          `SELECT
            (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
            (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
            (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id=? AND target_user_id=? AND action='withdrawn' AND role='admin' AND resulting_global_role='member' AND scope_id='global' AND scope_name='全域角色') AS history,
            (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND target_user_id=? AND operation_key=? AND action='withdrawn' AND role='admin' AND resulting_global_role='member' AND scope_id='global' AND scope_name='全域角色') AS receipts,
            (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND target_user_id=? AND action='global_role_changed') AS audits`
        )
        .bind(
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          actorUserId,
          operationKey,
          actorUserId,
          actorUserId
        )
        .first();
      expect(state).toEqual({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });
      const revokedContexts = await Promise.all(
        [initiatingContext, secondContext].map(async (context) => {
          const session = await context.get("/api/auth/get-session");
          const sessionBody: unknown = await session.json();
          const protectedRead = await context.get("/api/v2/roles/global-roles");
          return {
            protectedReadStatus: protectedRead.status(),
            sessionBody,
            sessionStatus: session.status(),
          };
        })
      );
      expect(revokedContexts).toEqual([
        {
          protectedReadStatus: 401,
          sessionBody: null,
          sessionStatus: 200,
        },
        {
          protectedReadStatus: 401,
          sessionBody: null,
          sessionStatus: 200,
        },
      ]);
      await expect(
        caseApp.db
          .prepare("DELETE FROM user WHERE id=?")
          .bind(actorUserId)
          .run()
      ).rejects.toThrow();
    } finally {
      await Promise.all([initiatingContext.dispose(), secondContext.dispose()]);
    }
  }
);
