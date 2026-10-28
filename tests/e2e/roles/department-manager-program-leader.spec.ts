import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";

const roleTest = dedicatedTest;
const escapedBatchId = (n: number) =>
  `${"\u0001".repeat(127)}${String.fromCodePoint(n + 14)}`;

roleTest.describe(
  "Department Manager Program Leader assignments",
  {
    tag: ["@native", "@risk-authorization", "@risk-atomicity"],
  },
  () => {
    roleTest(
      "maximally escaped seven-person command crosses the real HTTP and D1 boundary",
      { tag: ["@http", "@risk-validation", "@risk-atomicity"] },
      async ({ caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-max-batch-password!";
        const username = `batch.max.${suffix}`;
        const actorId = await caseApp.provision.account({
          email: `batch.max.${suffix}@example.com`,
          fullName: "測試主管",
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const authorityAssignmentId = escapedBatchId(8);
        const departmentId = escapedBatchId(9);
        const scopeId = escapedBatchId(10);
        const targets = Array.from({ length: 8 }, (_, index) =>
          escapedBatchId(index)
        );
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentId, "極長測試部門"),
          caseApp.db
            .prepare(
              "INSERT INTO program (id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(scopeId, departmentId, "\u0001".repeat(200)),
          caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(authorityAssignmentId, actorId, departmentId),
        ]);
        const seedTarget = async (index: number): Promise<void> => {
          const target = targets[index];
          if (target === undefined) {
            return;
          }
          await caseApp.db.batch([
            caseApp.db
              .prepare(
                "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,0,unixepoch(),unixepoch())"
              )
              .bind(
                target,
                "Synthetic target",
                `batch.max.${index}.${suffix}@example.com`
              ),
            caseApp.db
              .prepare(
                "INSERT INTO person_profile(user_id,membership_status,created_at,updated_at) VALUES (?,'active',unixepoch(),unixepoch())"
              )
              .bind(target),
            caseApp.db
              .prepare(
                "INSERT INTO department_membership(id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
              )
              .bind(randomUUID(), target, departmentId),
          ]);
          await seedTarget(index + 1);
        };
        await seedTarget(0);
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
            {
              data: { operationKey: randomUUID(), password },
            }
          );
          expect(confirmation.status()).toBe(201);
          const input = {
            authorityAssignmentId,
            expectedDepartmentId: departmentId,
            operationKey: randomUUID(),
            scopeId,
            targetUserIds: targets.slice(0, 7),
          };
          expect(new TextEncoder().encode(JSON.stringify(input)).length).toBe(
            7840
          );
          const saved = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            { data: input }
          );
          expect(saved.status()).toBe(201);
          const body = await saved.json();
          expect(body.data.receipt.targetUserIds).toEqual(
            input.targetUserIds.toSorted()
          );
          const overKey = randomUUID();
          expect(
            new TextEncoder().encode(
              JSON.stringify({
                ...input,
                operationKey: overKey,
                targetUserIds: targets,
              })
            ).length
          ).toBe(8611);
          const over = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            {
              data: { ...input, operationKey: overKey, targetUserIds: targets },
            }
          );
          expect(over.status()).toBe(400);
          const effects = await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM program_leader_assignment WHERE program_id = ?"
            )
            .bind(scopeId)
            .first();
          expect(effects).toEqual({ count: 7 });
          const overReceipt = await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(actorId, overKey)
            .first();
          expect(overReceipt).toEqual({ count: 0 });
        } finally {
          await context.dispose();
        }
      }
    );
    roleTest(
      "batch grants seven selected members atomically, canonicalizes replay and isolates actor-wide keys",
      {
        tag: [
          "@http",
          "@risk-recovery",
          "@risk-atomicity",
          "@risk-authorization",
        ],
      },
      async ({ caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-batch-manager-password!";
        const username = `batch.manager.${suffix}`;
        const actorId = await caseApp.provision.account({
          email: `batch.manager.${suffix}@example.com`,
          fullName: "批次主管",
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const departmentId = randomUUID();
        const scopeId = randomUUID();
        const authorityAssignmentId = randomUUID();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentId, "批次部門"),
          caseApp.db
            .prepare(
              "INSERT INTO program (id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(scopeId, departmentId, "批次聚會"),
          caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(authorityAssignmentId, actorId, departmentId),
        ]);
        const targets: string[] = [];
        const seedTarget = async (index: number): Promise<void> => {
          if (index === 8) {
            return;
          }
          const id = await caseApp.provision.account({
            email: `batch.${index}.${suffix}@example.com`,
            fullName: `批次會友${index}`,
            membershipStatus: "active",
            password,
            role: "member",
            username: `batch.${index}.${suffix}`,
          });
          targets.push(id);
          await caseApp.db
            .prepare(
              "INSERT INTO department_membership (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), id, departmentId)
            .run();
          await seedTarget(index + 1);
        };
        await seedTarget(0);
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
            {
              data: { operationKey: randomUUID(), password },
            }
          );
          expect(confirmation.status()).toBe(201);
          const input = {
            authorityAssignmentId,
            expectedDepartmentId: departmentId,
            operationKey: randomUUID(),
            scopeId,
            targetUserIds: targets.slice(0, 7),
          };
          const invalid = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            { data: { ...input, targetUserIds: targets } }
          );
          expect(invalid.status()).toBe(400);
          const validated = await context.post(
            "/api/v2/roles/program-leader-grant-batches/validate",
            {
              data: {
                authorityAssignmentId,
                expectedDepartmentId: departmentId,
                scopeId,
                targetUserIds: input.targetUserIds,
              },
            }
          );
          expect(validated.status()).toBe(200);
          const selfSelection = await context.post(
            "/api/v2/roles/program-leader-grant-batches/validate",
            {
              data: {
                authorityAssignmentId,
                expectedDepartmentId: departmentId,
                scopeId,
                targetUserIds: [actorId],
              },
            }
          );
          expect(selfSelection.status()).toBe(409);
          const saved = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            { data: input }
          );
          expect(saved.status()).toBe(201);
          const body = await saved.json();
          expect(body.data.receipt.targetUserIds).toEqual(
            input.targetUserIds.toSorted()
          );
          const replay = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            {
              data: {
                ...input,
                targetUserIds: input.targetUserIds.toReversed(),
              },
            }
          );
          expect(replay.status()).toBe(200);
          const replayBody = await replay.json();
          expect(replayBody.data.receipt).toEqual(body.data.receipt);
          const changedIntent = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            {
              data: { ...input, targetUserIds: [targets[7]] },
            }
          );
          expect(changedIntent.status()).toBe(409);
          const collision = await context.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                action: "granted",
                authorityAssignmentId,
                authorityKind: "department_manager",
                operationKey: input.operationKey,
                scopeId,
                targetUserId: targets[7],
              },
            }
          );
          expect(collision.status()).toBe(409);
          const effects = await caseApp.db
            .prepare(`SELECT
            (SELECT COUNT(*) FROM program_leader_assignment WHERE program_id=?) assignments,
            (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id=? AND role='program_leader') history,
            (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND action='program_leader_granted') audits,
            (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=? AND command_family='program_grants' AND target_user_id IS NULL) receipts`)
            .bind(scopeId, actorId, actorId, actorId, input.operationKey)
            .first();
          expect(effects).toEqual({
            assignments: 7,
            audits: 7,
            history: 7,
            receipts: 1,
          });
          const reconciled = await context.post(
            "/api/v2/roles/program-leader-grant-batches/reconcile",
            { data: { operationKey: input.operationKey } }
          );
          const reconciledBody = await reconciled.json();
          expect(reconciledBody.data).toEqual({
            outcome: "committed",
            receipt: body.data.receipt,
          });
          const singleKey = randomUUID();
          const single = await context.post("/api/v2/roles/program-leaders", {
            data: {
              action: "granted",
              authorityAssignmentId,
              authorityKind: "department_manager",
              operationKey: singleKey,
              scopeId,
              targetUserId: targets[7],
            },
          });
          expect(single.status()).toBe(201);
          const reverseCollision = await context.post(
            "/api/v2/roles/program-leader-grant-batches",
            {
              data: {
                ...input,
                operationKey: singleKey,
                targetUserIds: [targets[7]],
              },
            }
          );
          expect(reverseCollision.status()).toBe(409);
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
            )
            .bind(targets[0])
            .run();
          const retained = await context.post(
            "/api/v2/roles/program-leader-grant-batches/reconcile",
            { data: { operationKey: input.operationKey } }
          );
          const retainedBody = await retained.json();
          expect(retainedBody.data).toEqual({
            outcome: "committed",
            receipt: body.data.receipt,
          });
          const alreadyGranted = await context.post(
            "/api/v2/roles/program-leader-grant-batches/validate",
            {
              data: {
                authorityAssignmentId,
                expectedDepartmentId: departmentId,
                scopeId,
                targetUserIds: [targets[1]],
              },
            }
          );
          expect(alreadyGranted.status()).toBe(409);
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
            .bind(authorityAssignmentId)
            .run();
          const deniedReceipt = await context.post(
            "/api/v2/roles/program-leader-grant-batches/reconcile",
            { data: { operationKey: input.operationKey } }
          );
          expect(deniedReceipt.status()).toBe(403);
        } finally {
          await context.dispose();
        }
      }
    );
    roleTest(
      "local and Admin intents cannot share a fingerprint and local receipt requires current DM scope",
      { tag: ["@http", "@risk-authorization", "@risk-recovery"] },
      async ({ caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-local-admin-password!";
        const username = `local.receipt.${suffix}`;
        const actorId = await caseApp.provision.account({
          email: `admin.${suffix}@example.com`,
          fullName: "管理員",
          membershipStatus: "active",
          password,
          role: "admin",
          username,
        });
        const targetId = await caseApp.provision.account({
          email: `target.${suffix}@example.com`,
          fullName: "現任負責人",
          membershipStatus: "active",
          password,
          role: "member",
          username: `receipt.target.${suffix}`,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        const authorityId = randomUUID();
        const assignmentId = randomUUID();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentId, "部門"),
          caseApp.db
            .prepare(
              "INSERT INTO program (id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, "聚會"),
          caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(authorityId, actorId, departmentId),
          caseApp.db
            .prepare(
              "INSERT INTO program_leader_assignment (id,user_id,program_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(assignmentId, targetId, programId),
        ]);
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
          const operationKey = randomUUID();
          const base = {
            action: "withdrawn",
            expectedAssignmentId: assignmentId,
            operationKey,
            scopeId: programId,
            targetUserId: targetId,
          };
          const local = {
            ...base,
            authorityAssignmentId: authorityId,
            authorityKind: "department_manager",
          };
          const missingWitness = await context.post(
            "/api/v2/roles/program-leaders",
            { data: { ...base, authorityKind: "department_manager" } }
          );
          expect(missingWitness.status()).toBe(400);
          const save = await context.post("/api/v2/roles/program-leaders", {
            data: local,
          });
          expect(save.status()).toBe(201);
          const saved = await save.json();
          const savedKind = await caseApp.db
            .prepare(
              "SELECT authority_kind FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(actorId, operationKey)
            .first();
          expect(savedKind).toEqual({ authority_kind: "department_manager" });
          const collision = await context.post(
            "/api/v2/roles/program-leaders",
            { data: base }
          );
          expect(collision.status()).toBe(409);
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
            .bind(authorityId)
            .run();
          const localReceipt = await context.post(
            "/api/v2/roles/program-leaders/reconcile",
            { data: { authorityKind: "department_manager", operationKey } }
          );
          expect(localReceipt.status()).toBe(403);
          const adminReceipt = await context.post(
            "/api/v2/roles/program-leaders/reconcile",
            { data: { operationKey } }
          );
          expect(adminReceipt.status()).toBe(403);
          const replacementAuthorityId = randomUUID();
          await caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(replacementAuthorityId, actorId, departmentId)
            .run();
          const currentLocalReceipt = await context.post(
            "/api/v2/roles/program-leaders/reconcile",
            { data: { authorityKind: "department_manager", operationKey } }
          );
          expect(currentLocalReceipt.status()).toBe(200);
          const currentLocalBody = await currentLocalReceipt.json();
          expect(currentLocalBody.data).toEqual({
            outcome: "committed",
            receipt: saved.data.receipt,
          });
          const stale = await context.post("/api/v2/roles/program-leaders", {
            data: local,
          });
          expect(stale.status()).toBe(409);
          const grant = {
            action: "granted",
            operationKey: randomUUID(),
            scopeId: programId,
            targetUserId: targetId,
          };
          const adminGrant = await context.post(
            "/api/v2/roles/program-leaders",
            { data: grant }
          );
          const legacyKind = await caseApp.db
            .prepare(
              "SELECT authority_kind FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(actorId, grant.operationKey)
            .first();
          expect(legacyKind).toEqual({ authority_kind: null });
          expect(adminGrant.status()).toBe(201);
          const reverseCollision = await context.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                ...grant,
                authorityAssignmentId: replacementAuthorityId,
                authorityKind: "department_manager",
              },
            }
          );
          expect(reverseCollision.status()).toBe(409);
        } finally {
          await context.dispose();
        }
      }
    );
    roleTest(
      "an Admin with a local Department Manager assignment uses its independent scope witness",
      { tag: ["@http", "@risk-authorization"] },
      async ({ caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-local-admin-password!";
        const username = `local.admin.${suffix}`;
        const userId = await caseApp.provision.account({
          email: `admin.${suffix}@example.com`,
          fullName: "本區管理員",
          membershipStatus: "active",
          password,
          role: "admin",
          username,
        });
        const departmentId = randomUUID();
        const assignmentId = randomUUID();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentId, "本區部門"),
          caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(assignmentId, userId, departmentId),
        ]);
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await context.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);
          const noDepartment = await context.get(
            "/api/v2/roles/program-leaders/programs?local=1"
          );
          expect(noDepartment.status()).toBe(400);
          const path = `/api/v2/roles/program-leaders/programs?departmentId=${departmentId}&page=1`;
          const local = await context.get(`${path}&local=1`);
          expect(local.status()).toBe(200);
          const localBody = await local.json();
          expect(localBody.data).toMatchObject({
            actorUserId: userId,
            authorityAssignmentId: assignmentId,
            department: { assignmentId, id: departmentId, name: "本區部門" },
            programs: [],
          });
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
            .bind(assignmentId)
            .run();
          const denied = await context.get(`${path}&local=1`);
          expect(denied.status()).toBe(403);
          const global = await context.get(path);
          expect(global.status()).toBe(200);
        } finally {
          await context.dispose();
        }
      }
    );
    roleTest(
      "a Member manager independently reads and withdraws only an existing in-scope Member",
      { tag: ["@http", "@risk-privacy", "@risk-recovery"] },
      async ({ caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-local-manager-password!";
        const managerUsername = `local.dm.${suffix}`;
        const managerId = await caseApp.provision.account({
          email: `manager.${suffix}@example.com`,
          fullName: "本區主管",
          membershipStatus: "active",
          password,
          role: "member",
          username: managerUsername,
        });
        const targetId = await caseApp.provision.account({
          email: `target.${suffix}@example.com`,
          fullName: "已離開聚會負責人",
          membershipStatus: "deactivated",
          password,
          role: "member",
          username: `local.target.${suffix}`,
        });
        const protectedId = await caseApp.provision.account({
          email: `staff.${suffix}@example.com`,
          fullName: "受保護職員",
          membershipStatus: "active",
          password,
          role: "staff",
          username: `local.staff.${suffix}`,
        });
        const departmentId = randomUUID();
        const otherDepartmentId = randomUUID();
        const programId = randomUUID();
        const otherProgramId = randomUUID();
        const authorityId = randomUUID();
        const assignmentId = randomUUID();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(departmentId, "授權部門"),
          caseApp.db
            .prepare(
              "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(otherDepartmentId, "其他部門"),
          caseApp.db
            .prepare(
              "INSERT INTO program (id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, "授權聚會"),
          caseApp.db
            .prepare(
              "INSERT INTO program (id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(otherProgramId, otherDepartmentId, "其他聚會"),
          caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(authorityId, managerId, departmentId),
          caseApp.db
            .prepare(
              "INSERT INTO program_leader_assignment (id,user_id,program_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(assignmentId, targetId, programId),
          caseApp.db
            .prepare(
              "INSERT INTO program_leader_assignment (id,user_id,program_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), protectedId, programId),
        ]);
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await context.post("/api/auth/sign-in/username", {
            data: { password, username: managerUsername },
          });
          expect(login.status()).toBe(200);
          const confirm = await context.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password } }
          );
          expect(confirm.status()).toBe(201);
          const emptyPrograms = await context.get(
            `/api/v2/roles/program-leaders/programs?departmentId=${departmentId}&page=99`
          );
          expect(emptyPrograms.status()).toBe(200);
          const emptyProgramsBody = await emptyPrograms.json();
          expect(emptyProgramsBody.data).toMatchObject({
            department: {
              assignmentId: authorityId,
              id: departmentId,
              name: "授權部門",
            },
            programs: [],
          });
          const emptyRoster = await context.get(
            `/api/v2/roles/program-leaders/programs/${programId}/leaders?page=99`
          );
          expect(emptyRoster.status()).toBe(200);
          const emptyRosterBody = await emptyRoster.json();
          expect(emptyRosterBody.data).toMatchObject({
            leaders: [],
            program: {
              departmentId,
              departmentName: "授權部門",
              id: programId,
              name: "授權聚會",
            },
          });
          const path = `/api/v2/roles/program-leaders/programs/${programId}/leaders`;
          const baseline = await context.get(`${path}/${targetId}`);
          expect(baseline.status()).toBe(200);
          const baselineBody = await baseline.json();
          expect(baselineBody.data).toEqual({
            actorUserId: managerId,
            assignmentId,
            authorityAssignmentId: authorityId,
            departmentId,
            departmentName: "授權部門",
            person: {
              fullName: "已離開聚會負責人",
              userId: targetId,
              username: `local.target.${suffix}`,
            },
            programId,
            programName: "授權聚會",
          });
          const protectedRead = await context.get(`${path}/${protectedId}`);
          expect(protectedRead.status()).toBe(404);
          expect(await protectedRead.text()).not.toContain("受保護職員");
          const selfRead = await context.get(`${path}/${managerId}`);
          expect(selfRead.status()).toBe(404);
          const outsideRead = await context.get(
            `/api/v2/roles/program-leaders/programs/${otherProgramId}/leaders/${targetId}`
          );
          expect(outsideRead.status()).toBe(403);
          const aggregateKey = randomUUID();
          const aggregate = await context.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                changes: [
                  {
                    action: "withdrawn",
                    expectedAssignmentId: assignmentId,
                    expectedDepartmentId: departmentId,
                    role: "program_leader",
                    scopeId: programId,
                  },
                ],
                operationKey: aggregateKey,
                targetUserId: targetId,
              },
            }
          );
          expect(aggregate.status()).toBe(403);
          const outsideKey = randomUUID();
          const outsideWrite = await context.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                action: "withdrawn",
                authorityAssignmentId: authorityId,
                expectedAssignmentId: assignmentId,
                operationKey: outsideKey,
                scopeId: otherProgramId,
                targetUserId: targetId,
              },
            }
          );
          expect(outsideWrite.status()).toBe(403);
          const deniedEffects = await caseApp.db
            .prepare(`SELECT
            (SELECT count(*) FROM program_leader_assignment WHERE id = ?) AS assignments,
            (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
            (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_withdrawn') AS audits,
            (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key IN (?,?)) AS receipts`)
            .bind(
              assignmentId,
              targetId,
              targetId,
              managerId,
              outsideKey,
              aggregateKey
            )
            .first();
          expect(deniedEffects).toEqual({
            assignments: 1,
            audits: 0,
            history: 0,
            receipts: 0,
          });
          const operationKey = randomUUID();
          const command = {
            action: "withdrawn",
            authorityAssignmentId: authorityId,
            authorityKind: "department_manager",
            expectedAssignmentId: assignmentId,
            operationKey,
            scopeId: programId,
            targetUserId: targetId,
          };
          const withdrawal = await context.post(
            "/api/v2/roles/program-leaders",
            { data: command }
          );
          expect(withdrawal.status()).toBe(201);
          const withdrawalBody = await withdrawal.json();
          const { receipt } = withdrawalBody.data;
          const replay = await context.post("/api/v2/roles/program-leaders", {
            data: command,
          });
          expect(replay.status()).toBe(200);
          const replayBody = await replay.json();
          expect(replayBody.data.receipt).toEqual(receipt);
          const reconcile = await context.post(
            "/api/v2/roles/program-leaders/reconcile",
            { data: { authorityKind: "department_manager", operationKey } }
          );
          const reconcileBody = await reconcile.json();
          expect(reconcileBody.data).toEqual({ outcome: "committed", receipt });
          const after = await context.get(`${path}/${targetId}`);
          expect(after.status()).toBe(404);
          const effects = await caseApp.db
            .prepare(`SELECT
            (SELECT count(*) FROM program_leader_assignment WHERE id = ?) AS assignments,
            (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader') AS history,
            (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_withdrawn') AS audits,
            (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`)
            .bind(assignmentId, targetId, targetId, managerId, operationKey)
            .first();
          expect(effects).toEqual({
            assignments: 0,
            audits: 1,
            history: 1,
            receipts: 1,
          });
          await caseApp.db
            .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
            .bind(authorityId)
            .run();
          const revokedBaseline = await context.get(`${path}/${targetId}`);
          expect(revokedBaseline.status()).toBe(403);
          const revokedReceipt = await context.post(
            "/api/v2/roles/program-leaders/reconcile",
            { data: { authorityKind: "department_manager", operationKey } }
          );
          expect(revokedReceipt.status()).toBe(403);
          await caseApp.db
            .prepare(
              "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), managerId, departmentId)
            .run();
          const restoredReceipt = await context.post(
            "/api/v2/roles/program-leaders/reconcile",
            { data: { authorityKind: "department_manager", operationKey } }
          );
          expect(restoredReceipt.status()).toBe(200);
          const staleReplay = await context.post(
            "/api/v2/roles/program-leaders",
            { data: command }
          );
          expect(staleReplay.status()).toBe(409);
        } finally {
          await context.dispose();
        }
      }
    );
    roleTest(
      "a Member-only Department Manager grants a current Member only that Program's Home notice",
      { tag: ["@browser", "@home", "@mobile-critical"] },
      async ({ browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-department-manager-password!";
        const managerUsername = `roles.dm.${suffix}`;
        const targetUsername = `roles.candidate.${suffix}`;
        const targetPassword = "Synthetic-program-leader-password!";
        const managerUserId = await caseApp.provision.account({
          email: `dm.${suffix}@example.com`,
          fullName: `陳部門負責人${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username: managerUsername,
        });
        const targetUserId = await caseApp.provision.account({
          email: `target.${suffix}@example.com`,
          fullName: `陳聚會候選人${suffix}`,
          membershipStatus: "active",
          password: targetPassword,
          role: "member",
          username: targetUsername,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        const otherDepartmentId = randomUUID();
        const otherProgramId = randomUUID();
        const managerAssignmentId = randomUUID();
        const departmentMembershipId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `本部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `本部門聚會${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(managerAssignmentId, departmentId, managerUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(departmentMembershipId, departmentId, targetUserId)
          .run();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(otherDepartmentId, `其他部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(otherProgramId, otherDepartmentId, `其他聚會${suffix}`)
          .run();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `DM Program 通告${suffix}`,
              "只供獲授權人士閱讀。",
              programId
            ),
          caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `其他 Program 通告${suffix}`,
              "不應向未獲授權人士顯示。",
              otherProgramId
            ),
        ]);

        const manager = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await manager.post("/api/auth/sign-in/username", {
            data: { password, username: managerUsername },
          });
          expect(login.status()).toBe(200);
          const confirmation = await manager.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password } }
          );
          expect(confirmation.status()).toBe(201);

          const grant = await manager.post("/api/v2/roles/program-leaders", {
            data: {
              action: "granted",
              authorityAssignmentId: managerAssignmentId,
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          });
          const body: unknown = await grant.json();
          expect(grant.status(), JSON.stringify(body)).toBe(201);
          expect(body).toMatchObject({
            data: {
              receipt: {
                action: "granted",
                scopeId: programId,
                scopeName: `本部門聚會${suffix}`,
                targetUserId,
              },
            },
          });

          const recipient = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
          });
          try {
            const recipientLogin = await recipient.post(
              "/api/auth/sign-in/username",
              {
                data: { password: targetPassword, username: targetUsername },
              }
            );
            expect(recipientLogin.status()).toBe(200);

            const homeContext = await browser.newContext({
              baseURL: caseApp.origin,
              extraHTTPHeaders,
              storageState: await recipient.storageState(),
            });
            try {
              const page = await homeContext.newPage();
              await page.goto("/");
              const notices = page.getByRole("region", { name: "教會消息" });
              await expect(
                notices.getByText(`DM Program 通告${suffix}`, { exact: true })
              ).toBeVisible();
              await expect(
                notices.getByText(`其他 Program 通告${suffix}`, {
                  exact: true,
                })
              ).toHaveCount(0);
            } finally {
              await homeContext.close();
            }
          } finally {
            await recipient.dispose();
          }

          const departmentMembershipCount = await caseApp.db
            .prepare(
              "select count(*) as count from department_membership where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          const departmentMembership = await caseApp.db
            .prepare(
              "select id, department_id from department_membership where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ department_id: string; id: string }>();
          const enrolmentCount = await caseApp.db
            .prepare(
              "select count(*) as count from enrolment where user_id = ?"
            )
            .bind(targetUserId)
            .first<{ count: number }>();
          expect(departmentMembershipCount?.count).toBe(1);
          expect(departmentMembership).toEqual({
            department_id: departmentId,
            id: departmentMembershipId,
          });
          expect(enrolmentCount?.count).toBe(0);
        } finally {
          await manager.dispose();
        }
      }
    );
  }
);
