import { expect } from "../../support/credential-fixtures";
import { expectStatus, securityTest } from "./fixtures";

securityTest(
  "Server-selected Security-only responses exclude identity and business data on direct HTML and RSC reads",
  {
    tag: [
      "@native",
      "@http",
      "@risk-privacy",
      "@risk-authorization",
      "@security",
    ],
  },
  async ({ actor, holder, caseApp }) => {
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = (SELECT id FROM user WHERE username = ?)"
      )
      .bind(holder.username)
      .run();
    const security = await expectStatus(
      actor.get("/api/v2/account/security"),
      200
    );
    const state = await security.json();
    expect(state.data.state.securityOnly).toBe(true);
    const renderHeaders: Record<string, string>[] = [{}, { RSC: "1" }];
    await Promise.all(
      renderHeaders.flatMap((headers) =>
        [
          "/account",
          "/account?task=phone",
          "/account?task=password",
          "/account?task=sessions",
          "/account?task=confirm",
        ].map(async (route) => {
          const response = await expectStatus(
            actor.get(route, { headers }),
            200
          );
          const body = await response.text();
          expect(body).not.toContain(holder.email);
          expect(body).not.toContain(holder.username);
          expect(body).not.toContain(holder.fullName);
          expect(body).not.toContain("更新聯絡電話");
          if (route.endsWith("sessions")) {
            expect(body).toContain("請先確認目前密碼");
          }
        })
      )
    );
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = (SELECT id FROM user WHERE username = ?)"
      )
      .bind(holder.username)
      .run();
    const denied = await expectStatus(
      actor.get("/api/v2/account/security"),
      403
    );
    const deniedBody = await denied.text();
    expect(deniedBody).not.toContain(holder.email);
    expect(deniedBody).not.toContain(holder.username);
    await expectStatus(actor.get("/status"), 200);
  }
);
