/* eslint-disable no-await-in-loop -- Home prerequisites follow FK dependency order; each actor context is acquired before teardown registration. */
import { randomUUID } from "node:crypto";

import type { APIRequestContext, Page } from "@playwright/test";

import type { SyntheticAccount } from "../scenarios/accounts";
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
  home: {
    accounts: Record<HomeActor, SyntheticAccount>;
    activities: ActivityFixtures;
    namespace: string;
    notices: NoticeFixtures;
  };
  homeNamespace: string;
  homeNoticeScopes: boolean;
  homePages: Record<HomeActor, Page>;
  homeRequests: Record<HomeActor, APIRequestContext>;
}>({
  home: async (
    { caseApp, homeNamespace: namespace, homeNoticeScopes },
    use
  ) => {
    const ids = new Map<string, string>();
    const accounts = {} as Record<HomeActor, SyntheticAccount>;
    for (const actor of actors) {
      const template = findAccount(approvedAccounts, actor);
      const account = {
        ...template,
        email: `${namespace}${template.email}`,
        username: namespace
          ? `home.${namespace}${actors.indexOf(actor)}`
          : template.username,
      };
      accounts[actor] = account;
      ids.set(actor, await caseApp.provision.account(account));
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
        .bind(namespace + row.id, row.name)
        .run();
    }
    for (const row of activities.programs) {
      await db
        .prepare(
          "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
        )
        .bind(namespace + row.id, namespace + row.departmentId, row.name)
        .run();
    }
    for (const row of activities.events) {
      await db
        .prepare(
          "insert into program_event (id,program_id,title,starts_at,created_at) values (?,?,?,?,unixepoch())"
        )
        .bind(
          namespace + row.id,
          namespace + row.programId,
          row.title,
          Date.parse(row.startsAt) / 1000
        )
        .run();
    }
    for (const row of activities.enrolments) {
      await db
        .prepare(
          "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) values (?,?,?,?,unixepoch(),unixepoch())"
        )
        .bind(
          namespace + row.id,
          namespace + row.programId,
          userId(row.username),
          row.status
        )
        .run();
    }
    for (const row of activities.invitations) {
      await db
        .prepare(
          "insert into invitation (id,program_id,user_id,state,expires_at,created_at) values (?,?,?,?,?,unixepoch())"
        )
        .bind(
          namespace + row.id,
          namespace + row.programId,
          userId(row.username),
          row.state,
          Date.parse(row.expiresAt) / 1000
        )
        .run();
    }
    if (homeNoticeScopes) {
      for (const row of notices.departmentMemberships) {
        await db
          .prepare(
            "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            namespace + row.id,
            namespace + row.departmentId,
            userId(row.username)
          )
          .run();
      }
      for (const row of notices.departmentManagerAssignments) {
        await db
          .prepare(
            "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(
            namespace + row.id,
            namespace + row.departmentId,
            userId(row.username)
          )
          .run();
      }
      for (const row of notices.notices) {
        await db
          .prepare(
            "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,?,?,?,?,unixepoch())"
          )
          .bind(
            namespace + row.id,
            row.title,
            row.body,
            row.scopeType,
            row.scopeId ? namespace + row.scopeId : null,
            row.publishedAt ? Date.parse(row.publishedAt) / 1000 : null,
            row.expiresAt ? Date.parse(row.expiresAt) / 1000 : null
          )
          .run();
      }
    }
    await use({ accounts, activities, namespace, notices });
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  homeNamespace: async ({}, use) => {
    await use(`${randomUUID().replaceAll("-", "").slice(0, 16)}.`);
  },
  homeNoticeScopes: [false, { option: true }],
  homePages: async (
    { browser, homeRequests, caseApp, extraHTTPHeaders },
    use
  ) => {
    const contexts = [];
    const pages = {} as Record<HomeActor, Page>;
    try {
      for (const actor of actors) {
        const context = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          storageState: await homeRequests[actor].storageState(),
        });
        contexts.push(context);
        pages[actor] = await context.newPage();
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
    const identity = extraHTTPHeaders?.["cf-connecting-ip"];
    if (!identity) {
      throw new Error("Native Home actor identity is required");
    }
    const contexts = {} as Record<HomeActor, APIRequestContext>;
    try {
      for (const actor of actors) {
        const account = home.accounts[actor];
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: {
            ...extraHTTPHeaders,
            "cf-connecting-ip": identity.replace(
              "2001:db8:",
              `2001:db8:${actors.indexOf(actor) + 2}:`
            ),
          },
        });
        contexts[actor] = context;
        const response = await context.post("/api/auth/sign-in/username", {
          data: { password: account.password, username: account.username },
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

/** Global notice visibility, row counts and ordering require their own store. */
export const dedicatedTest = test.extend({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
  homeNamespace: "",
  homeNoticeScopes: true,
});
export { expect } from "./fixtures";
