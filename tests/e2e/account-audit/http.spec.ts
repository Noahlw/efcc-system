import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";
import {
  applicationInput,
  applicationIdentity,
  submitApplication,
} from "../account-decisions/test-helpers";

interface AccountAuditResponse {
  data: {
    events: {
      action: string;
      actorUserId: string;
      createdAt: number;
      id: string;
      hasInternalNote: boolean;
      targetUserId: string;
    }[];
    page: { hasNext: boolean; hasPrevious: boolean; number: number };
    selectedEvent: {
      action: string;
      actorUserId: string;
      createdAt: number;
      id: string;
      internalNote: string | null;
      targetUserId: string;
    } | null;
  };
}

dedicatedTest(
  "Staff audit reads 25-row newest-first pages and independently rechecks retained record detail",
  {
    tag: ["@native", "@http", "@risk-authorization", "@risk-privacy"],
  },
  async ({ caseApp, request, staff }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const identity = await applicationIdentity(caseApp, input.username);
    const internalNote = "合成職員內部備註只在已授權紀錄詳情顯示";
    const decisionResponse = await staff.context.post(
      "/api/v2/staff/application-decisions",
      {
        data: {
          applicationId: identity.applicationId,
          internalNote,
          operationKey: randomUUID(),
          outcome: "rejected",
          visibleReason: "合成拒絕原因",
        },
      }
    );
    expect(decisionResponse.status()).toBe(201);
    const {
      data: { decision },
    } = await decisionResponse.json();

    const createdAt = Math.floor(Date.now() / 1000) + 120;
    const retainedEvents = Array.from({ length: 28 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return {
        action: "synthetic_retained_audit",
        actorUserId: staff.userId,
        createdAt,
        id: `synthetic-account-audit-${suffix}`,
        targetUserId: `deleted-account-${suffix}`,
      };
    });
    await caseApp.db.batch(
      retainedEvents.map((event) =>
        caseApp.db
          .prepare(
            "INSERT INTO audit_event (action, actor_user_id, created_at, id, target_user_id) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(
            event.action,
            event.actorUserId,
            event.createdAt,
            event.id,
            event.targetUserId
          )
      )
    );

    const firstPageResponse = await staff.context.get(
      `/api/v2/staff/account-audit?page=1&record=${retainedEvents[0]?.id}`
    );
    expect(firstPageResponse.status()).toBe(200);
    const firstPage = (await firstPageResponse.json()) as AccountAuditResponse;
    expect(firstPage.data.events).toHaveLength(25);
    expect(firstPage.data.events.map(({ id }) => id)).toEqual(
      retainedEvents
        .toReversed()
        .slice(0, 25)
        .map(({ id }) => id)
    );
    expect(firstPage.data.events.some(({ id }) => id === decision.id)).toBe(
      false
    );
    expect(firstPage.data.page).toEqual({
      hasNext: true,
      hasPrevious: false,
      number: 1,
    });
    expect(firstPage.data.selectedEvent).toMatchObject({
      actorUserId: staff.userId,
      id: retainedEvents[0]?.id,
      targetUserId: retainedEvents[0]?.targetUserId,
    });
    expect(
      await caseApp.db
        .prepare("SELECT id FROM user WHERE id = ?")
        .bind(retainedEvents[0]?.targetUserId)
        .first()
    ).toBeNull();

    const secondPageResponse = await staff.context.get(
      "/api/v2/staff/account-audit?page=2"
    );
    expect(secondPageResponse.status()).toBe(200);
    const secondPage =
      (await secondPageResponse.json()) as AccountAuditResponse;
    expect(secondPage.data.events).toHaveLength(6);
    expect(secondPage.data.events.slice(0, 3).map(({ id }) => id)).toEqual(
      retainedEvents
        .toReversed()
        .slice(25)
        .map(({ id }) => id)
    );
    expect(secondPage.data.events.map(({ id }) => id)).toContain(decision.id);
    expect(secondPage.data.page).toEqual({
      hasNext: false,
      hasPrevious: true,
      number: 2,
    });

    const selectedOutsidePage = await staff.context.get(
      `/api/v2/staff/account-audit?page=1&record=${decision.id}`
    );
    expect(selectedOutsidePage.status()).toBe(200);
    const selectedBody =
      (await selectedOutsidePage.json()) as AccountAuditResponse;
    expect(selectedBody.data.events.map(({ id }) => id)).not.toContain(
      decision.id
    );
    expect(selectedBody.data.selectedEvent).toMatchObject({
      actorUserId: staff.userId,
      id: decision.id,
      internalNote,
      targetUserId: identity.userId,
    });

    const normalizedBodies = await Promise.all(
      ["page=not-a-page", "page=4", "page=2&page=3"].map(
        async (invalidPage) => {
          const normalized = await staff.context.get(
            `/api/v2/staff/account-audit?${invalidPage}`
          );
          expect(normalized.status()).toBe(200);
          return (await normalized.json()) as AccountAuditResponse;
        }
      )
    );
    for (const normalizedBody of normalizedBodies) {
      expect(normalizedBody.data.page).toEqual(firstPage.data.page);
      expect(normalizedBody.data.events.map(({ id }) => id)).toEqual(
        firstPage.data.events.map(({ id }) => id)
      );
    }

    const missingRecord = await staff.context.get(
      "/api/v2/staff/account-audit?record=missing-retained-record"
    );
    expect(missingRecord.status()).toBe(200);
    expect(
      ((await missingRecord.json()) as AccountAuditResponse).data.selectedEvent
    ).toBeNull();

    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const changedAuthority = await staff.context.get(
      `/api/v2/staff/account-audit?record=${decision.id}&page=2`
    );
    expect(changedAuthority.status()).toBe(403);
    expect(await changedAuthority.json()).toMatchObject({
      error: { code: "business_access_denied" },
    });
  }
);
