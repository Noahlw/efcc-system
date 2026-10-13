/* eslint-disable no-await-in-loop -- Home prerequisites follow FK dependency order; each actor context is acquired before teardown registration. */
import type { APIRequestContext, Page } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import type { ActivityFixtures } from "../scenarios/activities";
import { buildActivityFixtures } from "../scenarios/activities";
import type { NoticeFixtures } from "../scenarios/notices";
import { buildNoticeFixtures } from "../scenarios/notices";
import { expect, test as base } from "./fixtures";

const actors = [
  "wong.tai.ming",
  "Chan.Siu.Fong",
  "chen.simplified",
  "ng.wing.yan",
] as const;
type HomeActor = (typeof actors)[number];
export const test = base.extend<{
  home: { activities: ActivityFixtures; notices: NoticeFixtures };
  homePages: Record<HomeActor, Page>;
  homeRequests: Record<HomeActor, APIRequestContext>;
}>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
  home: async ({ caseApp }, use) => {
    const ids = new Map<string, string>();
    for (const username of actors) {
      const account = findAccount(approvedAccounts, username);
      ids.set(username, await caseApp.provision.account(account));
    }
    const userId = (username: string) => {
      const id = ids.get(username);
      if (!id) {
        throw new Error(`Missing Home actor ${username}`);
      }
      return id;
    };
    const activities = buildActivityFixtures();
    const notices = buildNoticeFixtures();
    const { db } = caseApp;
    for (const row of activities.departments) {
      await db
        .prepare(
          "insert into department (id,name,created_at) values (?,?,unixepoch())"
        )
        .bind(row.id, row.name)
        .run();
    }
    for (const row of activities.programs) {
      await db
        .prepare(
          "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
        )
        .bind(row.id, row.departmentId, row.name)
        .run();
    }
    for (const row of activities.events) {
      await db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(row.id, row.programId, row.title, Date.parse(row.startsAt) / 1000)
        .run();
    }
    for (const row of activities.enrolments) {
      await db
        .prepare(
          "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,?,unixepoch(),unixepoch())"
        )
        .bind(row.id, row.programId, userId(row.username), row.status)
        .run();
    }
    for (const row of activities.invitations) {
      await db
        .prepare(
          "insert into invitation (id,program_id,user_id,state,expires_at,created_at) values (?,?,?,?,?,unixepoch())"
        )
        .bind(
          row.id,
          row.programId,
          userId(row.username),
          row.state,
          Date.parse(row.expiresAt) / 1000
        )
        .run();
    }
    for (const row of notices.departmentMemberships) {
      await db
        .prepare(
          "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
        )
        .bind(row.id, row.departmentId, userId(row.username))
        .run();
    }
    for (const row of notices.departmentManagerAssignments) {
      await db
        .prepare(
          "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
        )
        .bind(row.id, row.departmentId, userId(row.username))
        .run();
    }
    for (const row of notices.notices) {
      await db
        .prepare(
          "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,?,?,?,?,unixepoch())"
        )
        .bind(
          row.id,
          row.title,
          row.body,
          row.scopeType,
          row.scopeId ?? null,
          row.publishedAt ? Date.parse(row.publishedAt) / 1000 : null,
          row.expiresAt ? Date.parse(row.expiresAt) / 1000 : null
        )
        .run();
    }
    await use({ activities, notices });
  },
  homePages: async (
    { browser, homeRequests, caseApp, extraHTTPHeaders },
    use
  ) => {
    const contexts = [];
    const pages = {} as Record<HomeActor, Page>;
    try {
      for (const username of actors) {
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          storageState: await homeRequests[username].storageState(),
        });
        contexts.push(context);
        pages[username] = await context.newPage();
      }
      await use(pages);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  homeRequests: async (
    { home, playwright, caseApp, extraHTTPHeaders },
    use
  ) => {
    void home;
    const identity = extraHTTPHeaders?.["cf-connecting-ip"];
    if (!identity) {
      throw new Error("Native Home actor identity is required");
    }
    const contexts = {} as Record<HomeActor, APIRequestContext>;
    try {
      for (const username of actors) {
        const account = findAccount(approvedAccounts, username);
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: {
            ...extraHTTPHeaders,
            "cf-connecting-ip": identity.replace(
              "2001:db8:",
              `2001:db8:${actors.indexOf(username) + 2}:`
            ),
          },
        });
        contexts[username] = context;
        const response = await context.post("/api/auth/sign-in/username", {
          data: { password: account.password, username },
        });
        expect(response.status()).toBe(200);
      }
      await use(contexts);
    } finally {
      await Promise.all(
        Object.values(contexts).map((context) => context.dispose())
      );
    }
  },
});
export { expect } from "./fixtures";
