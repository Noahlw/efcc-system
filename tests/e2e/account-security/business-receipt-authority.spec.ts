import { randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import {
  applicationIdentity,
  applicationInput,
  submitApplication,
} from "../account-decisions/test-helpers";
import { originalPhone, phone } from "../account-identity/test-helpers";

for (const action of ["own_phone_changed", "application_withdrawn"] as const) {
  test(
    `completed ${action} receipt is withheld when Ban becomes current after its write`,
    {
      tag: [
        "@native",
        "@http",
        "@risk-authority",
        "@risk-recovery",
        "@risk-privacy",
      ],
    },
    async ({ account, caseApp, staff, signedInRequest }) => {
      let { userId } = account;
      let applicationId: string | undefined;
      if (action === "application_withdrawn") {
        const profile = applicationInput();
        await submitApplication(signedInRequest, profile);
        const identity = await applicationIdentity(caseApp, profile.username);
        ({ userId, applicationId } = identity);
        const login = await signedInRequest.post("/api/auth/sign-in/username", {
          data: { password: profile.password, username: profile.username },
        });
        expect(login.status()).toBe(200);
      }
      const table =
        action === "own_phone_changed"
          ? "account_change_operation"
          : "applicant_operation";
      const target =
        action === "own_phone_changed" ? "NEW.target_user_id" : "NEW.user_id";
      const trigger = `synthetic_post_write_ban_${randomUUID().replaceAll("-", "")}`;
      await caseApp.db
        .prepare(
          `CREATE TRIGGER ${trigger} AFTER INSERT ON ${table} WHEN NEW.action = '${action}' BEGIN UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ${target}; END`
        )
        .run();
      const key = randomUUID();
      try {
        const response = await signedInRequest.post(
          action === "own_phone_changed"
            ? "/api/v2/account/phone"
            : "/api/v2/applications/actions",
          {
            data:
              action === "own_phone_changed"
                ? {
                    operationKey: key,
                    original: await originalPhone(caseApp, account.userId),
                    phone: phone(),
                  }
                : { action, applicationId, operationKey: key },
          }
        );
        expect(response.status()).toBe(403);
        const receipt = await caseApp.db
          .prepare(`SELECT id FROM ${table} WHERE operation_key = ?`)
          .bind(key)
          .first<{ id: string }>();
        expect(receipt).not.toBeNull();
        const unban = await staff.context.post(
          "/api/v2/staff/accounts/restrictions",
          {
            data: {
              action: "account_unbanned",
              operationKey: randomUUID(),
              targetUserId: userId,
            },
          }
        );
        expect(unban.status()).toBe(201);
        const recovered = await signedInRequest.post(
          action === "own_phone_changed"
            ? "/api/v2/account/changes/reconcile"
            : "/api/v2/applications/actions/reconcile",
          { data: { operationKey: key } }
        );
        expect(recovered.status()).toBe(200);
        const body = await recovered.json();
        expect(body.data.receipt.id).toBe(receipt?.id);
        const retained = await caseApp.db
          .prepare(
            `SELECT count(*) AS count FROM ${table} WHERE operation_key = ?`
          )
          .bind(key)
          .first<{ count: number }>();
        expect(retained?.count).toBe(1);
      } finally {
        await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
      }
    }
  );
}
