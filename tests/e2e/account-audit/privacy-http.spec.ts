import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";

test("@native @http @risk-privacy @risk-authorization Audit LIST contains note presence only; separately authorized DETAIL contains the note", async ({
  caseApp,
  playwright,
  staff,
}) => {
  const suffix = randomBytes(6).toString("hex");
  const profile = {
    email: `privacy.${suffix}@example.com`,
    fullName: `陳私隱${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-audit-privacy-password!",
    phone: String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000)),
    username: `privacy.${suffix}`,
  };
  const created = await staff.context.post("/api/v2/applications", {
    data: profile,
  });
  expect(created.status()).toBe(201);
  const application = await caseApp.db
    .prepare(
      "SELECT a.id FROM membership_application a JOIN user u ON u.id = a.user_id WHERE u.username = ?"
    )
    .bind(profile.username)
    .first<{ id: string }>();
  if (!application) {
    throw new Error("Synthetic privacy application missing");
  }
  const note = `Staff-only-canary-${suffix}`;
  const decision = await staff.context.post(
    "/api/v2/staff/application-decisions",
    {
      data: {
        applicationId: application.id,
        internalNote: note,
        operationKey: randomUUID(),
        outcome: "rejected",
        visibleReason: "Synthetic visible reason",
      },
    }
  );
  expect(decision.status()).toBe(201);
  const decisionBody = await decision.json();
  const record = decisionBody.data.decision.id;
  const list = await staff.context.get("/api/v2/staff/account-audit");
  expect(list.status()).toBe(200);
  const listBody = await list.json();
  const entry = listBody.data.events.find(
    (event: { id: string }) => event.id === record
  );
  expect(entry).toBeDefined();
  expect(entry).not.toHaveProperty("internalNote");
  expect(entry.hasInternalNote).toBe(true);
  expect(JSON.stringify(listBody)).not.toContain(note);
  const detail = await staff.context.get(
    `/api/v2/staff/account-audit?record=${record}`
  );
  expect(detail.status()).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.data.selectedEvent).toMatchObject({
    id: record,
    internalNote: note,
  });
  expect(
    detailBody.data.events.find((event: { id: string }) => event.id === record)
  ).not.toHaveProperty("internalNote");
  const administrator = {
    email: `audit.admin.${suffix}@example.com`,
    fullName: "陳紀錄管理員",
    membershipStatus: "active" as const,
    password: "Synthetic-audit-admin-password!",
    role: "admin" as const,
    username: `audit.admin.${suffix}`,
  };
  await caseApp.provision.account(administrator);
  const admin = await playwright.request.newContext({
    baseURL: caseApp.origin,
    extraHTTPHeaders: { origin: caseApp.origin },
  });
  try {
    const login = await admin.post("/api/auth/sign-in/username", {
      data: {
        password: administrator.password,
        username: administrator.username,
      },
    });
    expect(login.status()).toBe(200);
    const adminList = await admin.get("/api/v2/staff/account-audit");
    expect(adminList.status()).toBe(200);
    expect(await adminList.text()).not.toContain(note);
    const adminDetail = await admin.get(
      `/api/v2/staff/account-audit?record=${record}`
    );
    expect(adminDetail.status()).toBe(200);
    const adminBody = await adminDetail.json();
    expect(adminBody.data.selectedEvent).toMatchObject({
      id: record,
      internalNote: note,
    });
  } finally {
    await admin.dispose();
  }
  const renderHeaders: Record<string, string>[] = [{}, { RSC: "1" }];
  await Promise.all(
    renderHeaders.map(async (headers) => {
      const rendered = await staff.context.get("/staff/account-audit", {
        headers,
      });
      expect(rendered.status()).toBe(200);
      expect(await rendered.text()).not.toContain(note);
      const renderedDetail = await staff.context.get(
        `/staff/account-audit?record=${record}`,
        { headers }
      );
      expect(renderedDetail.status()).toBe(200);
      expect(await renderedDetail.text()).toContain(note);
    })
  );
  await caseApp.db
    .prepare(
      "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
    )
    .bind(staff.userId)
    .run();
  const denied = await staff.context.get(
    `/api/v2/staff/account-audit?record=${record}`
  );
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain(note);
});
