import { randomUUID } from "node:crypto";

import { expect } from "../../support/credential-fixtures";
import { expectStatus, securityAccount, securityTest } from "./fixtures";

securityTest(
  "Security task replacement rechecks the original receipt while an older real response is held",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ actor, holder, signedInPage: page }) => {
    const key = randomUUID();
    const completed = await expectStatus(
      actor.post("/api/v2/account/password-confirmation", {
        data: { operationKey: key, password: holder.password },
      }),
      201
    );
    const completedBody = await completed.json();
    const { receipt } = completedBody.data;
    const nativeSession = await expectStatus(
      actor.get("/api/auth/get-session"),
      200
    );
    const sessionBody = await nativeSession.json();
    const userId = sessionBody.user.id;
    await page.goto("/status");
    const reference = {
      action: "password_confirmed",
      actorUserId: userId,
      key,
    };
    await page.evaluate(
      (operation) =>
        localStorage.setItem(
          "efcc.account-security.operation.v1",
          JSON.stringify(operation)
        ),
      reference
    );
    const arrived = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    const settled = Promise.withResolvers<boolean>();
    const releaseCurrent = Promise.withResolvers<boolean>();
    let reads = 0;
    await page.route("**/api/v2/account/security/reconcile", async (route) => {
      reads += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const responseBody = await response.json();
      expect(responseBody.data.receipt).toEqual(receipt);
      if (reads === 1) {
        arrived.resolve(true);
        try {
          await release.promise;
          await route.fulfill({ response });
        } finally {
          settled.resolve(true);
        }
      } else {
        await releaseCurrent.promise;
        await route.fulfill({ response });
      }
    });
    try {
      await page.goto("/account?task=confirm");
      await arrived.promise;
      await page
        .getByRole("link", { exact: true, name: "返回帳戶安全" })
        .click();
      await expect(page).toHaveURL(/task=security/u);
      await expect
        .poll(() => reads, {
          message:
            "replacement task must obtain its own current-authorized result",
        })
        .toBe(2);
      release.resolve(true);
      await settled.promise;
      await expect(
        page.getByRole("main", { name: "帳戶安全操作" }).getByRole("status")
      ).toContainText("正在向伺服器查核");
      releaseCurrent.resolve(true);
      await expect(
        page.getByRole("main", { name: "帳戶安全操作" }).getByRole("status")
      ).toContainText("伺服器已確認");
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("efcc.account-security.operation.v1") ?? "null"
          )
        )
      ).toEqual(reference);
    } finally {
      releaseCurrent.resolve(true);
      release.resolve(true);
      await settled.promise;
      await page.unroute("**/api/v2/account/security/reconcile");
    }
  }
);

securityTest(
  "A real actor replacement cannot adopt a held Security receipt or remove the original operation key",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-actor-isolation",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ actor, holder, caseApp, signedInPage: page }) => {
    const key = randomUUID();
    const completed = await expectStatus(
      actor.post("/api/v2/account/password-confirmation", {
        data: { operationKey: key, password: holder.password },
      }),
      201
    );
    const completedBody = await completed.json();
    const native = await expectStatus(actor.get("/api/auth/get-session"), 200);
    const originalSession = await native.json();
    const operation = {
      action: "password_confirmed",
      actorUserId: originalSession.user.id,
      key,
    };
    await page.goto("/status");
    await page.evaluate(
      (saved) =>
        localStorage.setItem(
          "efcc.account-security.operation.v1",
          JSON.stringify(saved)
        ),
      operation
    );
    const replacement = securityAccount();
    await caseApp.provision.account(replacement);
    const arrived = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    const settled = Promise.withResolvers<boolean>();
    await page.route("**/api/v2/account/security/reconcile", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.receipt).toEqual(completedBody.data.receipt);
      arrived.resolve(true);
      try {
        await release.promise;
        await route.fulfill({ response });
      } finally {
        settled.resolve(true);
      }
    });
    try {
      await page.goto("/account?task=confirm");
      await arrived.promise;
      await expectStatus(
        page.request.post("/api/auth/sign-in/username", {
          data: {
            password: replacement.password,
            username: replacement.username,
          },
          headers: { origin: caseApp.origin },
        }),
        200
      );
      await page
        .getByRole("link", { exact: true, name: "返回帳戶安全" })
        .click();
      await expect(page).toHaveURL(/task=security/u);
      const warning = page
        .getByRole("main", { name: "帳戶安全操作" })
        .getByRole("status");
      await expect(warning).toContainText("另一帳戶未確認的操作");
      release.resolve(true);
      await settled.promise;
      await expect(warning).toContainText("另一帳戶未確認的操作");
      await expect(warning).not.toContainText("伺服器已確認");
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("efcc.account-security.operation.v1") ?? "null"
          )
        )
      ).toEqual(operation);
      const currentResponse = await expectStatus(
        page.request.get("/api/v2/account/security"),
        200
      );
      const current = await currentResponse.json();
      expect(current.data.state.passwordConfirmationExpiresAt).toBeNull();
    } finally {
      release.resolve(true);
      await settled.promise;
      await page.unroute("**/api/v2/account/security/reconcile");
    }
  }
);
