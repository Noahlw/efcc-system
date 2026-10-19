import { randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import {
  applicationIdentity,
  applicationInput,
  submitApplication,
} from "../account-decisions/test-helpers";
import { phone } from "./test-helpers";

const tags = [
  "@native",
  "@http",
  "@account-identity",
  "@risk-freshness",
  "@risk-compatibility",
  "@risk-no-write",
];

test(
  "new own-phone writes without original values require an updated client",
  { tag: tags },
  async ({ account, caseApp, signedInRequest }) => {
    const before = await caseApp.db
      .prepare(
        "SELECT phone, phone_shared FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first();
    const key = randomUUID();
    const response = await signedInRequest.post("/api/v2/account/phone", {
      data: { operationKey: key, phone: phone() },
    });
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("client_update_required");
    expect(
      await caseApp.db
        .prepare(
          "SELECT phone, phone_shared FROM person_profile WHERE user_id = ?"
        )
        .bind(account.userId)
        .first()
    ).toEqual(before);
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM account_change_operation WHERE operation_key = ?"
        )
        .bind(key)
        .first()
    ).toBeNull();
  }
);

test(
  "new Staff Identity writes without original values require an updated client",
  { tag: tags },
  async ({ account, caseApp, staff }) => {
    const before = await caseApp.db
      .prepare(
        "SELECT name, email, username, display_username FROM user WHERE id = ?"
      )
      .bind(account.userId)
      .first();
    const key = randomUUID();
    const response = await staff.context.post(
      "/api/v2/staff/accounts/identity",
      {
        data: {
          email: "original-value-required@example.test",
          fullName: "陳更新",
          identityCheck: "face_to_face",
          operationKey: key,
          phone: phone(),
          sharedPhone: false,
          targetUserId: account.userId,
          username: `original.${randomUUID().slice(0, 8)}`,
        },
      }
    );
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("client_update_required");
    expect(
      await caseApp.db
        .prepare(
          "SELECT name, email, username, display_username FROM user WHERE id = ?"
        )
        .bind(account.userId)
        .first()
    ).toEqual(before);
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM account_change_operation WHERE operation_key = ?"
        )
        .bind(key)
        .first()
    ).toBeNull();
  }
);

test(
  "new Applicant Correction without original values requires an updated client",
  { tag: tags },
  async ({ caseApp, signedInRequest }) => {
    const input = applicationInput();
    await submitApplication(signedInRequest, input);
    const identity = await applicationIdentity(caseApp, input.username);
    const login = await signedInRequest.post("/api/auth/sign-in/username", {
      data: { password: input.password, username: input.username },
    });
    expect(login.status()).toBe(200);
    const before = await caseApp.db
      .prepare("SELECT name, email FROM user WHERE id = ?")
      .bind(identity.userId)
      .first();
    const key = randomUUID();
    const response = await signedInRequest.post(
      "/api/v2/applications/actions",
      {
        data: {
          action: "application_corrected",
          applicationId: identity.applicationId,
          email: input.email,
          fullName: "陳最新",
          operationKey: key,
          phone: phone(),
        },
      }
    );
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("client_update_required");
    expect(
      await caseApp.db
        .prepare("SELECT name, email FROM user WHERE id = ?")
        .bind(identity.userId)
        .first()
    ).toEqual(before);
    expect(
      await caseApp.db
        .prepare("SELECT id FROM applicant_operation WHERE operation_key = ?")
        .bind(key)
        .first()
    ).toBeNull();
  }
);

test(
  "guarded Own Phone binds the original sharing bit and recovers its completed key before comparing mutable values",
  { tag: tags },
  async ({ account, caseApp, signedInRequest }) => {
    const before = await signedInRequest.get("/api/v2/account/identity");
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    const original = {
      phone: beforeBody.data.identity.phone,
      phoneShared: beforeBody.data.identity.phoneShared,
    };
    const input = { operationKey: randomUUID(), original, phone: phone() };
    const first = await signedInRequest.post("/api/v2/account/phone", {
      data: input,
    });
    expect(first.status()).toBe(201);
    const firstBody = await first.json();
    const repeat = await signedInRequest.post("/api/v2/account/phone", {
      data: input,
    });
    expect(repeat.status()).toBe(200);
    const repeatBody = await repeat.json();
    expect(repeatBody.data.receipt).toEqual(firstBody.data.receipt);
    const after = await caseApp.db
      .prepare(
        "SELECT phone, phone_shared, staff_search_key FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first();
    const stale = await signedInRequest.post("/api/v2/account/phone", {
      data: { ...input, operationKey: randomUUID() },
    });
    expect(stale.status()).toBe(409);
    const mismatchedOriginal = await signedInRequest.post(
      "/api/v2/account/phone",
      {
        data: {
          ...input,
          original: {
            ...original,
            phoneShared: original.phoneShared === 1 ? 0 : 1,
          },
        },
      }
    );
    expect(mismatchedOriginal.status()).toBe(409);
    const mismatchedNew = await signedInRequest.post("/api/v2/account/phone", {
      data: { ...input, phone: phone() },
    });
    expect(mismatchedNew.status()).toBe(409);
    expect(
      await caseApp.db
        .prepare(
          "SELECT phone, phone_shared, staff_search_key FROM person_profile WHERE user_id = ?"
        )
        .bind(account.userId)
        .first()
    ).toEqual(after);
    const latestResponse = await signedInRequest.get(
      "/api/v2/account/identity"
    );
    const latest = await latestResponse.json();
    const baseline = {
      phone: latest.data.identity.phone,
      phoneShared: latest.data.identity.phoneShared,
    };
    await caseApp.db
      .prepare("UPDATE person_profile SET phone_shared = 1 WHERE user_id = ?")
      .bind(account.userId)
      .run();
    const sharedRace = await signedInRequest.post("/api/v2/account/phone", {
      data: { operationKey: randomUUID(), original: baseline, phone: phone() },
    });
    expect(sharedRace.status()).toBe(409);
    await caseApp.db
      .prepare("UPDATE person_profile SET phone_shared = ? WHERE user_id = ?")
      .bind(baseline.phoneShared, account.userId)
      .run();
    const aba = await signedInRequest.post("/api/v2/account/phone", {
      data: { operationKey: randomUUID(), original: baseline, phone: phone() },
    });
    expect(aba.status()).toBe(201);
  }
);

test(
  "Staff Identity original values prevent stale field overwrite and preserve a matching completed receipt",
  { tag: tags },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const response = await signedInRequest.get("/api/v2/account/identity");
    expect(response.status()).toBe(200);
    const body = await response.json();
    const value = body.data.identity;
    const original = {
      canonicalUsername: value.canonicalUsername,
      email: value.email,
      fullName: value.fullName,
      phone: value.phone,
      phoneShared: value.phoneShared,
      username: value.username,
    };
    const input = {
      email: `guarded.${randomUUID().slice(0, 8)}@example.com`,
      fullName: "陳已核對",
      identityCheck: "face_to_face",
      operationKey: randomUUID(),
      original,
      phone: phone(),
      sharedPhone: false,
      targetUserId: account.userId,
      username: `guarded.${randomUUID().slice(0, 8)}`,
    };
    const created = await staff.context.post(
      "/api/v2/staff/accounts/identity",
      { data: input }
    );
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    const replay = await staff.context.post("/api/v2/staff/accounts/identity", {
      data: input,
    });
    expect(replay.status()).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(createdBody.data.receipt);
    const state = await caseApp.db
      .prepare(
        "SELECT u.name,u.email,u.username,u.display_username,p.phone,p.phone_shared,p.name_lookup_key,p.staff_search_key FROM user u JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(account.userId)
      .first();
    const staleKey = randomUUID();
    const stale = await staff.context.post("/api/v2/staff/accounts/identity", {
      data: { ...input, fullName: "陳過期", operationKey: staleKey },
    });
    expect(stale.status()).toBe(409);
    const mismatch = await staff.context.post(
      "/api/v2/staff/accounts/identity",
      {
        data: {
          ...input,
          original: { ...original, canonicalUsername: "changed.original" },
        },
      }
    );
    expect(mismatch.status()).toBe(409);
    expect(
      await caseApp.db
        .prepare(
          "SELECT u.name,u.email,u.username,u.display_username,p.phone,p.phone_shared,p.name_lookup_key,p.staff_search_key FROM user u JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
        )
        .bind(account.userId)
        .first()
    ).toEqual(state);
    expect(
      await caseApp.db
        .prepare(
          "SELECT id FROM account_change_operation WHERE operation_key = ?"
        )
        .bind(staleKey)
        .first()
    ).toBeNull();
  }
);

test(
  "Applicant Correction guards the Username search dependency and both old and new values of a committed operation",
  { tag: tags },
  async ({ caseApp, signedInRequest }) => {
    const profile = applicationInput();
    await submitApplication(signedInRequest, profile);
    const login = await signedInRequest.post("/api/auth/sign-in/username", {
      data: { password: profile.password, username: profile.username },
    });
    expect(login.status()).toBe(200);
    const response = await signedInRequest.get("/api/v2/applications/mine");
    expect(response.status()).toBe(200);
    const body = await response.json();
    const value = body.data.application;
    const original = {
      canonicalUsername: value.canonicalUsername,
      email: value.email,
      fullName: value.fullName,
      phone: value.phone,
      phoneShared: value.phoneShared,
      username: value.username,
    };
    const input = {
      action: "application_corrected",
      applicationId: value.id,
      email: profile.email,
      fullName: "陳已核對",
      operationKey: randomUUID(),
      original,
      phone: phone(),
    };
    const first = await signedInRequest.post("/api/v2/applications/actions", {
      data: input,
    });
    expect(first.status()).toBe(201);
    const firstBody = await first.json();
    const repeat = await signedInRequest.post("/api/v2/applications/actions", {
      data: input,
    });
    expect(repeat.status()).toBe(200);
    const repeatBody = await repeat.json();
    expect(repeatBody.data.receipt).toEqual(firstBody.data.receipt);
    const staleKey = randomUUID();
    const stale = await signedInRequest.post("/api/v2/applications/actions", {
      data: { ...input, operationKey: staleKey },
    });
    expect(stale.status()).toBe(409);
    const mismatch = await signedInRequest.post(
      "/api/v2/applications/actions",
      {
        data: {
          ...input,
          original: { ...original, username: "different.original" },
        },
      }
    );
    expect(mismatch.status()).toBe(409);
    const newerResponse = await signedInRequest.get(
      "/api/v2/applications/mine"
    );
    const newer = await newerResponse.json();
    const latest = newer.data.application;
    const usernameGuard = {
      ...input,
      operationKey: randomUUID(),
      original: {
        canonicalUsername: latest.canonicalUsername,
        email: latest.email,
        fullName: latest.fullName,
        phone: latest.phone,
        phoneShared: latest.phoneShared,
        username: latest.username,
      },
    };
    await caseApp.db
      .prepare("UPDATE user SET display_username = ? WHERE username = ?")
      .bind("Changed.Search.Dependency", profile.username)
      .run();
    const state = await caseApp.db
      .prepare(
        "SELECT u.name,u.email,p.phone,p.phone_shared,p.name_lookup_key,p.staff_search_key FROM user u JOIN person_profile p ON p.user_id = u.id WHERE u.username = ?"
      )
      .bind(profile.username)
      .first();
    const denied = await signedInRequest.post("/api/v2/applications/actions", {
      data: usernameGuard,
    });
    expect(denied.status()).toBe(409);
    expect(
      await caseApp.db
        .prepare(
          "SELECT u.name,u.email,p.phone,p.phone_shared,p.name_lookup_key,p.staff_search_key FROM user u JOIN person_profile p ON p.user_id = u.id WHERE u.username = ?"
        )
        .bind(profile.username)
        .first()
    ).toEqual(state);
    expect(
      await caseApp.db
        .prepare("SELECT id FROM applicant_operation WHERE operation_key = ?")
        .bind(usernameGuard.operationKey)
        .first()
    ).toBeNull();
  }
);

test(
  "Identity refresh uses current Staff discovery authority and keeps lawful Admin reads separate from mutation",
  { tag: tags },
  async ({ account, caseApp, signedInRequest, staff }) => {
    const path = `/api/v2/staff/accounts/identity?targetUserId=${account.userId}`;
    const initial = await staff.context.get(path);
    expect(initial.status()).toBe(200);
    const initialBody = await initial.json();
    expect(initialBody.data.identity).toMatchObject({
      fullName: account.fullName,
      userId: account.userId,
      username: account.username,
    });
    const member = await signedInRequest.get(path);
    expect(member.status()).toBe(403);
    expect(await member.text()).not.toContain(account.email);
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'admin' WHERE user_id = ?"
      )
      .bind(account.userId)
      .run();
    const excluded = await staff.context.get(path);
    expect(excluded.status()).toBe(200);
    expect(await excluded.json()).toEqual({ data: { identity: null } });
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'admin' WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const lawfulRead = await staff.context.get(path);
    expect(lawfulRead.status()).toBe(200);
    const lawfulBody = await lawfulRead.json();
    expect(lawfulBody.data.identity).toMatchObject({
      role: "admin",
      userId: account.userId,
    });
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const banned = await staff.context.get(path);
    expect(banned.status()).toBe(403);
    expect(await banned.text()).not.toContain(account.email);
  }
);
