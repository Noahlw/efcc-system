import { createHmac, randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import { originalIdentity, phone } from "./test-helpers";

for (const kind of ["own", "staff"] as const) {
  test(
    `${kind} pre-original-value receipt keeps its original fingerprint without executing another write`,
    {
      tag: [
        "@native",
        "@http",
        "@account-identity",
        "@risk-compatibility",
        "@risk-privacy",
        "@risk-no-write",
      ],
    },
    async ({ account, caseApp, signedInRequest, staff }) => {
      const actorId = kind === "own" ? account.userId : staff.userId;
      const action =
        kind === "own" ? "own_phone_changed" : "staff_identity_corrected";
      const context = kind === "own" ? signedInRequest : staff.context;
      const path =
        kind === "own"
          ? "/api/v2/account/phone"
          : "/api/v2/staff/accounts/identity";
      const operationKey = randomUUID();
      const localPhone = phone();
      // C0 schema declaration order and normalization, independent of the v2 writer.
      const normalized = Object.fromEntries(
        kind === "own"
          ? [
              ["operationKey", operationKey],
              ["phone", `+852${localPhone}`],
            ]
          : [
              ["email", "legacy@example.test"],
              ["fullName", "陳歷史"],
              ["phone", `+852${localPhone}`],
              ["username", "Legacy.History"],
              ["identityCheck", "face_to_face"],
              ["operationKey", operationKey],
              ["sharedPhone", false],
              ["targetUserId", account.userId],
            ]
      );
      const input = { ...normalized, phone: localPhone };
      const { BETTER_AUTH_SECRET: secret } = await caseApp.harness
        .getWorker<Cloudflare.Env>("efcc-system")
        .getEnv();
      if (!secret) {
        throw new Error("Native authentication secret missing");
      }
      const hash = createHmac("sha256", secret)
        .update(JSON.stringify([actorId, action, normalized]))
        .digest("hex");
      const id = randomUUID();
      const createdAt = Math.floor(Date.now() / 1000) - 3600;
      await caseApp.db.batch([
        caseApp.db
          .prepare(
            "INSERT INTO audit_event (id, action, actor_user_id, target_user_id, created_at) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(id, action, actorId, account.userId, createdAt),
        caseApp.db
          .prepare(
            "INSERT INTO account_change_operation (id, action, actor_user_id, target_user_id, created_at, operation_key, request_hash, identity_check) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .bind(
            id,
            action,
            actorId,
            account.userId,
            createdAt,
            operationKey,
            hash,
            kind === "staff" ? "face_to_face" : null
          ),
      ]);
      // Present mutable data differs from this historical command. Recovery must not reapply it.
      const before = await originalIdentity(caseApp, account.userId);
      const response = await context.post(path, { data: input });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.receipt).toMatchObject({
        action,
        createdAt,
        id,
        targetUserId: account.userId,
      });
      const mismatch = await context.post(path, {
        data: { ...input, phone: phone() },
      });
      expect(mismatch.status()).toBe(409);
      expect(await originalIdentity(caseApp, account.userId)).toEqual(before);
      const operation = await caseApp.db
        .prepare(
          "SELECT id, request_hash FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(actorId, operationKey)
        .all();
      expect(operation.results).toEqual([{ id, request_hash: hash }]);
      const audit = await caseApp.db
        .prepare(
          "SELECT id FROM audit_event WHERE actor_user_id = ? AND action = ?"
        )
        .bind(actorId, action)
        .all();
      expect(audit.results).toEqual([{ id }]);
      // Completion does not confer authority after the actor becomes Banned.
      await caseApp.db
        .prepare(
          "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
        )
        .bind(actorId)
        .run();
      const denied = await context.post(path, { data: input });
      expect(denied.status()).toBe(403);
    }
  );
}
