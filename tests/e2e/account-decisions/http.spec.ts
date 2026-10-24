import { randomUUID } from "node:crypto";

import { dedicatedTest, expect, test } from "../../support/fixtures";
import {
  applicationInput,
  submitApplication,
  applicationIdentity,
  decisionSnapshot,
  expectDecisionEffects,
  seedApplicantInboxDecisions,
  seedReviewQueueApplications,
} from "./test-helpers";

interface ApplicantInboxResponse {
  data: {
    decisions: { id: string }[];
    page: { hasNext: boolean; hasPrevious: boolean; number: number };
  };
}

interface StaffReviewQueueResponse {
  data: {
    applications: { id: string }[];
    selectedApplication: {
      fullName: string;
      groupNote: string | null;
      id: string;
      intentNote: string | null;
      referralNote: string | null;
      userId: string;
    } | null;
    page: { hasNext: boolean; hasPrevious: boolean; number: number };
  };
}

test(
  "an applicant reads their own Pending application without member access",
  { tag: ["@native", "@http", "@risk-authorization", "@risk-privacy"] },
  async ({ request }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const signIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(signIn.status()).toBe(200);
    const application = await request.get("/api/v2/applications/mine");
    expect(application.status()).toBe(200);
    expect(await application.json()).toMatchObject({
      data: { application: { fullName: input.fullName, status: "pending" } },
    });
    const memberData = await request.get("/api/v2/me");
    expect(memberData.status()).toBe(403);
  }
);

dedicatedTest(
  "applicant Inbox reads bounded pages in stable newest-first order without Staff notes",
  {
    tag: ["@native", "@http", "@risk-authorization", "@risk-privacy"],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, request }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const signIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(signIn.status()).toBe(200);
    const identity = await applicationIdentity(caseApp, input.username);

    const decisions = await seedApplicantInboxDecisions(
      caseApp,
      "synthetic-inbox-staff-actor",
      identity.userId
    );
    const otherInput = applicationInput();
    const otherApplicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(otherApplicant, otherInput);
    } finally {
      await otherApplicant.dispose();
    }
    const otherIdentity = await applicationIdentity(
      caseApp,
      otherInput.username
    );
    const otherDecisionId = "synthetic-inbox-foreign-decision";
    const otherVisibleReason =
      "Synthetic other-applicant visible reason canary";
    const otherInternalNote = "Staff-only other-applicant note canary";
    const otherDecisionAt = Math.floor(Date.now() / 1000);
    await caseApp.db.batch([
      caseApp.db
        .prepare(
          "update membership_application set decision_id = ?, status = 'rejected' where id = ?"
        )
        .bind(otherDecisionId, otherIdentity.applicationId),
      caseApp.db
        .prepare(
          `insert into audit_event
             (action, actor_user_id, created_at, id, target_user_id)
           values ('application_rejected', 'synthetic-inbox-staff-actor', ?, ?, ?)`
        )
        .bind(otherDecisionAt, otherDecisionId, otherIdentity.userId),
      caseApp.db
        .prepare(
          `insert into application_decision
             (actor_user_id, application_id, created_at, id, internal_note,
              operation_key, outcome, request_hash, target_user_id, visible_reason)
           values ('synthetic-inbox-staff-actor', ?, ?, ?, ?, ?, 'rejected', ?, ?, ?)`
        )
        .bind(
          otherIdentity.applicationId,
          otherDecisionAt,
          otherDecisionId,
          otherInternalNote,
          randomUUID(),
          randomUUID(),
          otherIdentity.userId,
          otherVisibleReason
        ),
    ]);

    const expectedIds = decisions.map(({ id }) => id).toReversed();
    const firstPage = await request.get("/api/v2/inbox");
    expect(firstPage.status()).toBe(200);
    const firstPageBody = (await firstPage.json()) as ApplicantInboxResponse;
    expect(firstPageBody.data.decisions).toHaveLength(25);
    expect(firstPageBody.data.decisions.map(({ id }) => id)).toEqual(
      expectedIds.slice(0, 25)
    );
    expect(firstPageBody.data.page).toEqual({
      hasNext: true,
      hasPrevious: false,
      number: 1,
    });
    expect(await firstPage.text()).not.toContain("Staff-only synthetic note");
    expect(JSON.stringify(firstPageBody)).not.toContain(otherDecisionId);
    expect(JSON.stringify(firstPageBody)).not.toContain(
      otherIdentity.applicationId
    );
    expect(JSON.stringify(firstPageBody)).not.toContain(otherVisibleReason);
    expect(JSON.stringify(firstPageBody)).not.toContain(otherInternalNote);

    const secondPage = await request.get("/api/v2/inbox?page=2");
    expect(secondPage.status()).toBe(200);
    const secondPageBody = (await secondPage.json()) as ApplicantInboxResponse;
    expect(secondPageBody.data.decisions).toHaveLength(3);
    expect(secondPageBody.data.decisions.map(({ id }) => id)).toEqual(
      expectedIds.slice(25)
    );
    expect(secondPageBody.data.page).toEqual({
      hasNext: false,
      hasPrevious: true,
      number: 2,
    });
    expect(JSON.stringify(secondPageBody)).not.toContain(otherDecisionId);
    expect(JSON.stringify(secondPageBody)).not.toContain(
      otherIdentity.applicationId
    );
    expect(JSON.stringify(secondPageBody)).not.toContain(otherVisibleReason);
    expect(JSON.stringify(secondPageBody)).not.toContain(otherInternalNote);

    const outOfRange = await request.get("/api/v2/inbox?page=3");
    expect(outOfRange.status()).toBe(200);
    expect(await outOfRange.json()).toEqual(firstPageBody);
    const malformed = await request.get("/api/v2/inbox?page=not-a-page");
    expect(malformed.status()).toBe(200);
    expect(await malformed.json()).toEqual(firstPageBody);

    const banned = await caseApp.db
      .prepare(
        "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
      )
      .bind(identity.userId)
      .run();
    expect(banned.meta.changes).toBe(1);
    const bannedInbox = await request.get("/api/v2/inbox?page=2");
    expect(bannedInbox.status()).toBe(403);
    expect(await bannedInbox.json()).toMatchObject({
      error: { code: "business_access_denied" },
    });
    const bannedBody = await bannedInbox.text();
    expect(bannedBody).not.toContain("Synthetic applicant reason");
    expect(bannedBody).not.toContain("Staff-only synthetic note");
    expect(bannedBody).not.toContain(identity.applicationId);
    expect(bannedBody).not.toContain("synthetic-inbox-decision-");
    expect(bannedBody).not.toContain("synthetic-inbox-application-");
    expect(bannedBody).not.toContain(otherVisibleReason);
    expect(bannedBody).not.toContain(otherInternalNote);

    const deactivated = await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'deactivated', banned_at = NULL WHERE user_id = ?"
      )
      .bind(identity.userId)
      .run();
    expect(deactivated.meta.changes).toBe(1);
    const deactivatedInbox = await request.get("/api/v2/inbox?page=2");
    expect(deactivatedInbox.status()).toBe(403);
    expect(await deactivatedInbox.json()).toMatchObject({
      error: { code: "business_access_denied" },
    });
    const deactivatedBody = await deactivatedInbox.text();
    expect(deactivatedBody).not.toContain("Synthetic applicant reason");
    expect(deactivatedBody).not.toContain("Staff-only synthetic note");
    expect(deactivatedBody).not.toContain(identity.applicationId);
    expect(deactivatedBody).not.toContain("synthetic-inbox-decision-");
    expect(deactivatedBody).not.toContain("synthetic-inbox-application-");
    expect(deactivatedBody).not.toContain(otherVisibleReason);
    expect(deactivatedBody).not.toContain(otherInternalNote);

    await caseApp.db
      .prepare("delete from session where user_id = ?")
      .bind(identity.userId)
      .run();
    const changedAuthority = await request.get("/api/v2/inbox?page=2");
    expect(changedAuthority.status()).toBe(401);
    expect(await changedAuthority.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
  }
);

dedicatedTest(
  "Staff review queue reads bounded oldest-first pages and independently rechecks selected applications",
  {
    tag: ["@native", "@http", "@risk-authorization", "@risk-privacy"],
  },
  async ({ caseApp, staff }) => {
    const applications = await seedReviewQueueApplications(caseApp);
    const expectedIds = applications.map(({ applicationId }) => applicationId);
    const firstPage = await staff.context.get(
      "/api/v2/staff/applications?page=1"
    );
    expect(firstPage.status()).toBe(200);
    const firstPageBody = (await firstPage.json()) as StaffReviewQueueResponse;
    expect(firstPageBody.data.applications).toHaveLength(25);
    expect(firstPageBody.data.applications.map(({ id }) => id)).toEqual(
      expectedIds.slice(0, 25)
    );
    expect(firstPageBody.data.page).toEqual({
      hasNext: true,
      hasPrevious: false,
      number: 1,
    });
    expect(firstPageBody.data.selectedApplication).toBeNull();

    const secondPage = await staff.context.get(
      "/api/v2/staff/applications?page=2"
    );
    expect(secondPage.status()).toBe(200);
    const secondPageBody =
      (await secondPage.json()) as StaffReviewQueueResponse;
    expect(secondPageBody.data.applications).toHaveLength(3);
    expect(secondPageBody.data.applications.map(({ id }) => id)).toEqual(
      expectedIds.slice(25)
    );
    expect(secondPageBody.data.page).toEqual({
      hasNext: false,
      hasPrevious: true,
      number: 2,
    });

    await Promise.all(
      ["not-a-page", "3"].map(async (position) => {
        const normalizedPage = await staff.context.get(
          `/api/v2/staff/applications?page=${position}`
        );
        expect(normalizedPage.status()).toBe(200);
        const normalizedBody =
          (await normalizedPage.json()) as StaffReviewQueueResponse;
        expect(normalizedBody.data.page).toEqual({
          hasNext: true,
          hasPrevious: false,
          number: 1,
        });
        expect(normalizedBody.data.applications.map(({ id }) => id)).toEqual(
          expectedIds.slice(0, 25)
        );
        expect(normalizedBody.data.selectedApplication).toBeNull();
      })
    );

    const missingSelection = await staff.context.get(
      "/api/v2/staff/applications?record=missing-application"
    );
    expect(missingSelection.status()).toBe(200);
    const missingBody =
      (await missingSelection.json()) as StaffReviewQueueResponse;
    expect(missingBody.data.selectedApplication).toBeNull();

    const selected = applications.at(-1);
    if (!selected) {
      throw new Error("Missing synthetic outside-page application");
    }
    const selectedResponse = await staff.context.get(
      `/api/v2/staff/applications?page=1&record=${selected.applicationId}`
    );
    expect(selectedResponse.status()).toBe(200);
    const selectedBody =
      (await selectedResponse.json()) as StaffReviewQueueResponse;
    expect(selectedBody.data.applications).toHaveLength(25);
    expect(selectedBody.data.applications.map(({ id }) => id)).toEqual(
      expectedIds.slice(0, 25)
    );
    expect(selectedBody.data.selectedApplication).toMatchObject({
      fullName: selected.fullName,
      groupNote: "Synthetic group note 027",
      id: selected.applicationId,
      intentNote: "Synthetic intent note 027",
      referralNote: "Synthetic referral note 027",
      userId: selected.userId,
    });

    await caseApp.db
      .prepare(
        "update person_profile set account_role = 'staff' where user_id = ?"
      )
      .bind(selected.userId)
      .run();
    const noLongerAuthorized = await staff.context.get(
      `/api/v2/staff/applications?record=${selected.applicationId}`
    );
    expect(noLongerAuthorized.status()).toBe(200);
    const noLongerAuthorizedBody =
      (await noLongerAuthorized.json()) as StaffReviewQueueResponse;
    expect(noLongerAuthorizedBody.data.selectedApplication).toBeNull();
    expect(JSON.stringify(noLongerAuthorizedBody)).not.toContain(
      selected.fullName
    );

    await caseApp.db
      .prepare(
        "update person_profile set account_role = 'member' where user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const changedActor = await staff.context.get(
      `/api/v2/staff/applications?record=${selected.applicationId}`
    );
    expect(changedActor.status()).toBe(403);
  }
);

test(
  "Staff approval unlocks membership and publishes one exact durable decision",
  {
    tag: [
      "@native",
      "@http",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, extraHTTPHeaders, playwright, request, staff }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const signIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(signIn.status()).toBe(200);
    const identity = await applicationIdentity(caseApp, input.username);
    const pending = await request.get("/api/v2/applications/mine");
    expect(pending.status()).toBe(200);
    expect(await pending.json()).toMatchObject({
      data: { application: { id: identity.applicationId, status: "pending" } },
    });

    const internalNote = "只供職員查閱的審批備註";
    const decisionInput = {
      applicationId: identity.applicationId,
      internalNote,
      operationKey: randomUUID(),
      outcome: "approved" as const,
    };
    const approved = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: decisionInput }
    );
    expect(approved.status()).toBe(201);
    const {
      data: { decision },
    } = await approved.json();
    expect(decision).toEqual({
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: expect.any(Number),
      id: expect.any(String),
      internalNote,
      outcome: "approved",
      targetUserId: identity.userId,
      visibleReason: null,
    });
    await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      internalNote,
      operationKey: decisionInput.operationKey,
      outcome: "approved",
      targetUserId: identity.userId,
      visibleReason: null,
    });
    const currentAccount = await request.get("/api/v2/me");
    expect(currentAccount.status()).toBe(200);
    const inbox = await request.get("/api/v2/inbox");
    expect(await inbox.json()).toEqual({
      data: {
        decisions: [
          {
            applicationId: identity.applicationId,
            createdAt: decision.createdAt,
            id: decision.id,
            outcome: "approved",
            visibleReason: null,
          },
        ],
        page: { hasNext: false, hasPrevious: false, number: 1 },
        roleChanges: [],
      },
    });

    const replay = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: decisionInput }
    );
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ data: { decision } });
    const audit = await staff.context.get("/api/v2/staff/account-audit");
    expect(audit.status()).toBe(200);
    const { data: auditData } = await audit.json();
    expect(
      auditData.events.filter(
        (event: { id: string }) => event.id === decision.id
      )
    ).toEqual([
      {
        action: "application_approved",
        actorUserId: staff.userId,
        createdAt: decision.createdAt,
        hasInternalNote: true,
        id: decision.id,
        targetUserId: identity.userId,
      },
    ]);

    const detailResponse = await staff.context.get(
      `/api/v2/staff/account-audit?record=${decision.id}`
    );
    expect(detailResponse.status()).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.data.selectedEvent).toMatchObject({
      id: decision.id,
      internalNote,
    });
    expect(JSON.stringify(auditData.events)).not.toContain(internalNote);

    const secondInput = applicationInput();
    const secondApplicant = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await submitApplication(secondApplicant, secondInput);
      const second = await applicationIdentity(caseApp, secondInput.username);
      const reusedKey = await staff.context.post(
        "/api/v2/staff/application-decisions",
        {
          data: {
            ...decisionInput,
            applicationId: second.applicationId,
          },
        }
      );
      expect(reusedKey.status()).toBe(409);
      expect(await reusedKey.json()).toMatchObject({
        error: { code: "conflict" },
      });
      const secondState = await decisionSnapshot(caseApp, second.applicationId);
      expect(secondState.application).toEqual({
        applicationId: second.applicationId,
        decisionId: null,
        membershipStatus: "pending",
        status: "pending",
        targetRole: "member",
        targetUserId: second.userId,
      });
      expect(secondState.decisions).toEqual([]);
      expect(secondState.auditEvents).toEqual([]);
    } finally {
      await secondApplicant.dispose();
    }
  }
);

dedicatedTest(
  "competing approval and rejection commit exactly one decision and audit",
  { tag: ["@native", "@http", "@risk-atomicity", "@risk-resilience"] },
  async ({ caseApp, request, staff }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const identity = await applicationIdentity(caseApp, input.username);
    const candidates = [
      { operationKey: randomUUID(), outcome: "approved" as const },
      {
        operationKey: randomUUID(),
        outcome: "rejected" as const,
        visibleReason: "請重新安排會面。",
      },
    ];
    const responses = await Promise.all(
      candidates.map((candidate) =>
        staff.context.post("/api/v2/staff/application-decisions", {
          data: { applicationId: identity.applicationId, ...candidate },
        })
      )
    );
    expect(responses.map((response) => response.status()).toSorted()).toEqual([
      201, 409,
    ]);
    const winnerIndex = responses.findIndex(
      (response) => response.status() === 201
    );
    if (winnerIndex === -1) {
      throw new Error("No valid concurrent decision committed");
    }
    const winningInput = candidates[winnerIndex];
    if (!winningInput) {
      throw new Error("Winning decision input is missing");
    }
    const winningResponse = responses[winnerIndex];
    if (!winningResponse) {
      throw new Error("Winning decision response is missing");
    }
    const {
      data: { decision },
    } = await winningResponse.json();
    expect(decision.applicationId).toBe(identity.applicationId);
    expect(decision.actorUserId).toBe(staff.userId);
    expect(decision.outcome).toBe(winningInput.outcome);
    await expectDecisionEffects(caseApp, {
      actorUserId: staff.userId,
      applicationId: identity.applicationId,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      internalNote: null,
      operationKey: winningInput.operationKey,
      outcome: winningInput.outcome,
      targetUserId: identity.userId,
      visibleReason:
        winningInput.outcome === "rejected"
          ? (winningInput.visibleReason ?? null)
          : null,
    });
  }
);

for (const { failure, table } of [
  { failure: "ABORT, 'Synthetic decision failure'", table: "person_profile" },
  { failure: "IGNORE", table: "person_profile" },
  { failure: "ABORT, 'Synthetic decision failure'", table: "audit_event" },
  { failure: "IGNORE", table: "audit_event" },
]) {
  dedicatedTest(
    `${table} ${failure} rolls back required decision effects and permits the same-key recovery`,
    {
      tag: ["@native", "@http", "@risk-atomicity", "@risk-resilience"],
    },
    async ({ caseApp, request, staff }) => {
      const input = applicationInput();
      await submitApplication(request, input);
      const identity = await applicationIdentity(caseApp, input.username);
      const body = {
        applicationId: identity.applicationId,
        operationKey: randomUUID(),
        outcome: "approved" as const,
      };
      const trigger = `synthetic_decision_${identity.applicationId.replaceAll("-", "")}`;
      const condition =
        table === "person_profile"
          ? `NEW.user_id = '${identity.userId}' AND NEW.membership_status = 'active'`
          : `NEW.target_user_id = '${identity.userId}' AND NEW.action = 'application_approved'`;
      await caseApp.db.exec(
        `CREATE TRIGGER ${trigger} BEFORE ${table === "person_profile" ? "UPDATE" : "INSERT"} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(${failure}); END;`
      );
      try {
        const failed = await staff.context.post(
          "/api/v2/staff/application-decisions",
          { data: body }
        );
        expect(failed.status()).toBe(500);
        expect(await failed.json()).toMatchObject({
          error: { code: "internal_error" },
        });
        const failedState = await decisionSnapshot(
          caseApp,
          identity.applicationId
        );
        expect(failedState.application).toEqual({
          applicationId: identity.applicationId,
          decisionId: null,
          membershipStatus: "pending",
          status: "pending",
          targetRole: "member",
          targetUserId: identity.userId,
        });
        expect(failedState.decisions).toEqual([]);
        expect(failedState.auditEvents).toEqual([]);
        const unresolved = await staff.context.post(
          "/api/v2/staff/application-decisions/reconcile",
          { data: { operationKey: body.operationKey } }
        );
        expect(await unresolved.json()).toEqual({
          data: { decision: null },
        });
      } finally {
        await caseApp.db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
      }
      const retried = await staff.context.post(
        "/api/v2/staff/application-decisions",
        { data: body }
      );
      expect(retried.status()).toBe(201);
      const {
        data: { decision },
      } = await retried.json();
      expect(decision.outcome).toBe("approved");
      await expectDecisionEffects(caseApp, {
        actorUserId: staff.userId,
        applicationId: identity.applicationId,
        createdAt: decision.createdAt,
        decisionId: decision.id,
        internalNote: null,
        operationKey: body.operationKey,
        outcome: "approved",
        targetUserId: identity.userId,
        visibleReason: null,
      });
    }
  );
}

dedicatedTest(
  "current Staff authority, expected actor and target roles are checked on every decision",
  {
    tag: [
      "@native",
      "@http",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-actor-target-key",
    ],
  },
  async ({ caseApp, request, staff }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const identity = await applicationIdentity(caseApp, input.username);
    const body = {
      applicationId: identity.applicationId,
      operationKey: randomUUID(),
      outcome: "approved" as const,
    };
    const forged = await request.post("/api/v2/staff/application-decisions", {
      data: body,
      headers: {
        "x-efcc-access": "full",
        "x-efcc-session-id": randomUUID(),
        "x-efcc-user-id": identity.userId,
      },
    });
    expect(forged.status()).toBe(401);
    const changedActor = await staff.context.post(
      "/api/v2/staff/application-decisions",
      {
        data: body,
        headers: { "x-efcc-expected-actor-id": identity.userId },
      }
    );
    expect(changedActor.status()).toBe(409);
    expect(await changedActor.json()).toMatchObject({
      error: { code: "actor_changed" },
    });
    const reviewQueue = await staff.context.get("/api/v2/staff/applications");
    expect(reviewQueue.status()).toBe(200);
    const queueData = await reviewQueue.json();
    expect(
      queueData.data.applications.some(
        (application: { id: string }) =>
          application.id === identity.applicationId
      )
    ).toBe(true);

    await caseApp.db
      .prepare("update person_profile set account_role = ? where user_id = ?")
      .bind("staff", identity.userId)
      .run();
    const staffTarget = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: body }
    );
    expect(staffTarget.status()).toBe(403);
    await caseApp.db
      .prepare("update person_profile set account_role = ? where user_id = ?")
      .bind("admin", identity.userId)
      .run();
    const adminTarget = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: body }
    );
    expect(adminTarget.status()).toBe(403);

    await caseApp.db
      .prepare("update person_profile set account_role = ? where user_id = ?")
      .bind("member", identity.userId)
      .run();
    await caseApp.db
      .prepare("update person_profile set account_role = ? where user_id = ?")
      .bind("member", staff.userId)
      .run();
    const ordinaryTarget = await staff.context.post(
      "/api/v2/staff/application-decisions",
      { data: body }
    );
    expect(ordinaryTarget.status()).toBe(403);

    await caseApp.db
      .prepare(
        "update person_profile set account_role = ?, membership_status = ? where user_id = ?"
      )
      .bind("staff", "active", identity.userId)
      .run();
    const applicantSignIn = await request.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(applicantSignIn.status()).toBe(200);
    const selfTarget = await request.post(
      "/api/v2/staff/application-decisions",
      { data: body }
    );
    expect(selfTarget.status()).toBe(403);

    const unchanged = await decisionSnapshot(caseApp, identity.applicationId);
    expect(unchanged.application).toEqual({
      applicationId: identity.applicationId,
      decisionId: null,
      membershipStatus: "active",
      status: "pending",
      targetRole: "staff",
      targetUserId: identity.userId,
    });
    expect(unchanged.decisions).toEqual([]);
    expect(unchanged.auditEvents).toEqual([]);
  }
);
