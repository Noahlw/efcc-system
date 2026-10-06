import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { waitForSignInWindow } from "../scenarios/limiter";
import { E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql } from "./seed";

const applicationInput = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `applicant.${suffix}@example.test`,
    fullName: `陳申請${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-password-17!",
    phone: String(50_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    username: `applicant.${suffix}`,
  };
};

test("an application provisions no session and native sign-in reaches only Pending", async ({
  request,
}) => {
  const input = applicationInput();
  const submitted = await request.post("/api/v2/applications", { data: input });
  expect(submitted.status()).toBe(201);
  expect(await submitted.json()).toEqual({ data: { outcome: "pending" } });
  expect(submitted.headers()["set-cookie"]).toBeUndefined();
  expect(submitted.headers()["cache-control"]).toContain("no-store");

  const anonymousBusiness = await request.get("/api/v2/me");
  expect(anonymousBusiness.status()).toBe(401);
  await waitForSignInWindow();
  const signedIn = await request.post("/api/auth/sign-in/username", {
    data: { password: input.password, username: input.username },
  });
  expect(signedIn.status()).toBe(200);
  const usernameBusiness = await request.get("/api/v2/me");
  expect(usernameBusiness.status()).toBe(403);
  const status = await request.get("/api/v2/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: input.fullName,
      reasons: ["membership_pending"],
    },
  });
  const signedOut = await request.post("/api/auth/sign-out", { data: {} });
  expect(signedOut.status()).toBe(200);
  await waitForSignInWindow();
  const byName = await request.post("/api/auth/sign-in/name", {
    data: { fullName: input.fullName, password: input.password },
  });
  expect(byName.status()).toBe(200);
  const nameBusiness = await request.get("/api/v2/me");
  expect(nameBusiness.status()).toBe(403);
});

test("lost-response reconciliation and replay disclose only the original outcome", async ({
  request,
}) => {
  const input = applicationInput();
  const first = await request.post("/api/v2/applications", {
    data: input,
    headers: { "cf-connecting-ip": "198.51.100.17" },
  });
  expect(first.status()).toBe(201);
  const reconciled = await request.post("/api/v2/applications/reconcile", {
    data: { operationKey: input.operationKey },
  });
  expect(reconciled.status()).toBe(200);
  expect(await reconciled.json()).toEqual({ data: { outcome: "pending" } });
  const replay = await request.post("/api/v2/applications", {
    data: input,
    headers: { "cf-connecting-ip": "198.51.100.18" },
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual({ data: { outcome: "pending" } });
  const stranger = await request.post("/api/v2/applications/reconcile", {
    data: { operationKey: randomBytes(32).toString("hex") },
  });
  expect(stranger.status()).toBe(200);
  expect(await stranger.json()).toEqual({ data: { outcome: "not_found" } });
  const reused = await request.post("/api/v2/applications", {
    data: { ...input, username: `${input.username}.new` },
    headers: { "cf-connecting-ip": "198.51.100.19" },
  });
  expect(reused.status()).toBe(409);
});

test("competing duplicate submissions leave exactly one complete canonical identity", async ({
  request,
}) => {
  const input = applicationInput();
  const results = await Promise.all(
    [0, 1].map((index) =>
      request.post("/api/v2/applications", {
        data: {
          ...input,
          operationKey: randomBytes(32).toString("hex"),
          username: index === 0 ? input.username : input.username.toUpperCase(),
        },
        headers: { "cf-connecting-ip": `198.51.100.${20 + index}` },
      })
    )
  );
  expect(results.map((response) => response.status()).toSorted()).toEqual([
    201, 409,
  ]);
  const rows = queryLocalSql<{
    applications: number;
    audits: number;
    credentials: number;
    people: number;
    profiles: number;
    reservations: number;
  }>(
    `select count(*) as people,
    (select count(*) from account where user_id in
      (select id from user where username = '${input.username}')) as credentials,
    (select count(*) from person_profile where user_id in
      (select id from user where username = '${input.username}')) as profiles,
    (select count(*) from membership_application where user_id in
      (select id from user where username = '${input.username}')) as applications,
    (select count(*) from audit_event where action = 'self_application_created' and target_user_id in
      (select id from user where username = '${input.username}')) as audits,
    (select count(*) from username_reservation where username_key = '${input.username}') as reservations
    from user where username = '${input.username}'`
  );
  expect(rows).toEqual([
    {
      applications: 1,
      audits: 1,
      credentials: 1,
      people: 1,
      profiles: 1,
      reservations: 1,
    },
  ]);
});

test("new applications with duplicate Chinese names remain non-enumerating on native sign-in", async ({
  request,
}) => {
  const first = applicationInput();
  const second = applicationInput();
  second.fullName = first.fullName;
  const creations = await Promise.all(
    [first, second].map((input, index) =>
      request.post("/api/v2/applications", {
        data: input,
        headers: { "cf-connecting-ip": `198.51.100.${25 + index}` },
      })
    )
  );
  expect(creations.map((response) => response.status())).toEqual([201, 201]);
  await waitForSignInWindow();
  const ambiguous = await request.post("/api/auth/sign-in/name", {
    data: { fullName: first.fullName, password: first.password },
  });
  expect(ambiguous.status()).toBe(409);
  const body: unknown = await ambiguous.json();
  expect(body).toEqual({
    code: "NAME_AMBIGUOUS",
    message: "此中文姓名對應多個帳戶，請改用使用者名稱登入。",
  });
  expect(ambiguous.headers()["set-cookie"]).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(first.username);
  expect(JSON.stringify(body)).not.toContain(second.username);
});

test("invalid public inputs and cross-origin submissions never provision credentials", async ({
  request,
}) => {
  const input = applicationInput();
  const invalidInputs = [
    { username: "x" },
    { email: "not-an-email" },
    { email: "no-email@efcc.invalid" },
    { phone: "123" },
    { password: "short" },
    { membershipStatus: "active" },
  ];
  await Promise.all(
    invalidInputs.map(async (invalid, index) => {
      const response = await request.post("/api/v2/applications", {
        data: { ...input, ...invalid },
        headers: { "cf-connecting-ip": `198.51.100.${30 + index}` },
      });
      expect(response.status()).toBe(400);
    })
  );
  const crossOrigin = await request.post("/api/v2/applications", {
    data: input,
    headers: { origin: "https://untrusted.example.test" },
  });
  expect(crossOrigin.status()).toBe(403);
  const crossSiteMetadata = await request.post("/api/v2/applications", {
    data: input,
    headers: { "sec-fetch-site": "cross-site" },
  });
  expect(crossSiteMetadata.status()).toBe(403);
  expect(await crossSiteMetadata.json()).toMatchObject({
    error: { code: "origin_denied" },
  });
  expect(
    queryLocalSql<{ people: number }>(
      `select count(*) as people from user where username = '${input.username}'`
    )
  ).toEqual([{ people: 0 }]);
});

test("case-equivalent email and existing phone conflicts leave no second account", async ({
  request,
}) => {
  const original = applicationInput();
  const created = await request.post("/api/v2/applications", {
    data: original,
    headers: { "cf-connecting-ip": "198.51.100.40" },
  });
  expect(created.status()).toBe(201);
  await Promise.all(
    [{ email: original.email.toUpperCase() }, { phone: original.phone }].map(
      async (contact, index) => {
        const candidate = { ...applicationInput(), ...contact };
        const response = await request.post("/api/v2/applications", {
          data: candidate,
          headers: { "cf-connecting-ip": `198.51.100.${41 + index}` },
        });
        expect(response.status()).toBe(409);
        expect(
          queryLocalSql<{ people: number }>(
            `select count(*) as people from user where username = '${candidate.username}'`
          )
        ).toEqual([{ people: 0 }]);
        const outcome = await request.post("/api/v2/applications/reconcile", {
          data: { operationKey: candidate.operationKey },
          headers: { "cf-connecting-ip": `198.51.100.${43 + index}` },
        });
        expect(await outcome.json()).toEqual({
          data: { outcome: "not_found" },
        });
      }
    )
  );
});

for (const fault of ["profile", "audit"] as const) {
  test(`${fault} failure rolls back auth, application, reservation and required audit`, async ({
    request,
  }) => {
    const input = applicationInput();
    const before = queryLocalSql<{
      accounts: number;
      applications: number;
      audits: number;
      profiles: number;
      reservations: number;
      users: number;
    }>(
      `select
        (select count(*) from account) as accounts,
        (select count(*) from membership_application) as applications,
        (select count(*) from audit_event) as audits,
        (select count(*) from person_profile) as profiles,
        (select count(*) from username_reservation) as reservations,
        (select count(*) from user) as users`
    );
    const trigger = `application_failure_${fault}`;
    const table = fault === "profile" ? "person_profile" : "audit_event";
    const target = fault === "profile" ? "user_id" : "target_user_id";
    runLocalSql(
      `create trigger ${trigger} before insert on ${table}
       when NEW.${target} = (select id from user where username = '${input.username}')
       begin select raise(abort, 'synthetic application fault'); end`
    );
    try {
      const response = await request.post("/api/v2/applications", {
        data: input,
        headers: {
          "cf-connecting-ip":
            fault === "profile" ? "198.51.100.50" : "198.51.100.51",
        },
      });
      expect(response.status()).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          code: "internal_error",
          message: "系統暫時無法完成請求，請稍後再試。",
        },
      });
      expect(
        queryLocalSql(
          `select
            (select count(*) from account) as accounts,
            (select count(*) from membership_application) as applications,
            (select count(*) from audit_event) as audits,
            (select count(*) from person_profile) as profiles,
            (select count(*) from username_reservation) as reservations,
            (select count(*) from user) as users`
        )
      ).toEqual(before);
      const reconciled = await request.post("/api/v2/applications/reconcile", {
        data: { operationKey: input.operationKey },
      });
      expect(await reconciled.json()).toEqual({
        data: { outcome: "not_found" },
      });
    } finally {
      runLocalSql(`drop trigger ${trigger}`);
    }
    const recovered = await request.post("/api/v2/applications", {
      data: input,
      headers: {
        "cf-connecting-ip":
          fault === "profile" ? "198.51.100.52" : "198.51.100.53",
      },
    });
    expect(recovered.status()).toBe(201);
  });
}

test("oversized bodies, invalid content types and placeholder emails reject writes", async ({
  request,
}) => {
  const input = applicationInput();
  const oversized = await request.post("/api/v2/applications", {
    data: JSON.stringify({ ...input, intent: "x".repeat(9000) }),
    headers: {
      "cf-connecting-ip": "198.51.100.90",
      "content-type": "application/json",
    },
  });
  expect(oversized.status()).toBe(400);
  const wrongContentType = await request.post("/api/v2/applications", {
    data: input,
    headers: {
      "cf-connecting-ip": "198.51.100.91",
      "content-type": "text/plain",
    },
  });
  expect(wrongContentType.status()).toBe(400);
  const reservedEmail = await request.post("/api/v2/applications", {
    data: { ...input, email: "nobody@example.invalid" },
    headers: { "cf-connecting-ip": "198.51.100.92" },
  });
  expect(reservedEmail.status()).toBe(400);
});

test("reload reconciles committed applications without retaining form secrets", async ({
  page,
}) => {
  const suffix = randomBytes(6).toString("hex");
  const username = `reload.${suffix}`;
  const fullName = `陳重載${suffix}`;
  const password = "Synthetic-reload-password!";
  const phone = String(50_000_000 + (Number.parseInt(suffix, 16) % 10_000_000));
  await page.goto("/apply");
  await page.locator('input[name="phone"]').fill(phone);
  await page.locator('input[name="fullName"]').fill(fullName);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="email"]').fill(`${username}@example.test`);
  await page.locator('input[name="password"]').fill(password);
  let committedWithoutResponse = false;
  let reconciliationCalls = 0;
  await page.route("**/api/v2/applications", async (route) => {
    if (route.request().method() === "POST" && !committedWithoutResponse) {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      committedWithoutResponse = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.on("request", (outgoing) => {
    if (new URL(outgoing.url()).pathname === "/api/v2/applications/reconcile") {
      reconciliationCalls += 1;
    }
  });
  await page.getByRole("button", { name: "提交申請" }).click();
  await expect(page.getByText("申請已收到")).toBeVisible();
  const committedRows = queryLocalSql<{ applications: number; users: number }>(
    `select
      (select count(*) from membership_application where user_id =
        (select id from user where username = '${username.toLowerCase()}')) as applications,
      (select count(*) from user where username = '${username.toLowerCase()}') as users`
  );
  expect(committedRows).toEqual([{ applications: 1, users: 1 }]);
  await page.reload();
  await expect(page.getByText("申請已收到")).toBeVisible();
  expect(reconciliationCalls).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("efcc."))
    )
  ).toEqual(["efcc.account-application.operationKey.v1"]);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const record = queryLocalSql<{
    email: string;
    name: string;
    password: string;
    phone: string;
    profilePhone: string;
    username: string;
  }>(
    `select u.name as name, u.username as username, u.email as email,
      a.password as password, u.id as id,
      p.phone as profilePhone
      from user u
      inner join account a on a.user_id = u.id
      inner join person_profile p on p.user_id = u.id
      where u.username = '${username.toLowerCase()}'`
  );
  expect(record).toHaveLength(1);
  expect(record[0]).toMatchObject({
    email: `${username}@example.test`,
    name: fullName,
    profilePhone: `+852${phone}`,
    username: username.toLowerCase(),
  });
  expect(record[0]?.password).not.toBe(password);
});

test("application operation limiter permits ten requests and rate-limits later requests per action and IP", async ({
  request,
}) => {
  const key = randomBytes(32).toString("hex");
  const headers = { "cf-connecting-ip": "198.51.100.93" };
  const attempts = await Promise.all(
    Array.from({ length: 12 }, () =>
      request.post("/api/v2/applications/reconcile", {
        data: { operationKey: key },
        headers,
      })
    )
  );
  expect(attempts.map((response) => response.status()).toSorted()).toEqual([
    200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429,
  ]);
});

test("mobile application form is labelled, keyboard/paste ready and reaches Pending", async ({
  browser,
}) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2.625,
    extraHTTPHeaders: { origin: E2E_BASE_URL },
    hasTouch: true,
    isMobile: true,
    viewport: { height: 915, width: 412 },
  });
  try {
    const page = await context.newPage();
    const input = applicationInput();
    await page.goto("/apply");
    await expect(page.getByLabel("電話號碼")).toBeVisible();
    const measurements = await page.evaluate(() => ({
      bodyFontSize: Number(
        getComputedStyle(document.body).fontSize.slice(0, -2)
      ),
      controls: [...document.querySelectorAll("button, input, textarea")].map(
        (element) => {
          const { height, width } = element.getBoundingClientRect();
          return { height, width };
        }
      ),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(measurements.bodyFontSize).toBeGreaterThanOrEqual(17);
    expect(measurements.overflow).toBe(false);
    expect(
      measurements.controls.every(
        ({ height, width }) => height >= 44 && width >= 44
      )
    ).toBe(true);

    await expect(page.getByLabel("電話號碼")).toHaveAttribute(
      "autocomplete",
      "tel"
    );
    await expect(page.getByLabel("中文全名")).toHaveAttribute(
      "autocomplete",
      "name"
    );
    await expect(page.getByLabel("設定密碼")).toHaveAttribute(
      "autocomplete",
      "new-password"
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(
      (phone) => navigator.clipboard.writeText(phone),
      input.phone
    );
    await page.getByLabel("電話號碼").focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+V" : "Control+V"
    );
    await expect(page.getByLabel("電話號碼")).toHaveValue(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("使用者名稱").fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼").fill(input.password);
    await page.getByRole("button", { name: "提交申請" }).click();
    await expect(page.getByText("申請已收到")).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith("efcc."))
      )
    ).toEqual(["efcc.account-application.operationKey.v1"]);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("unsent public application can be resumed or discarded without saving it", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { height: 844, width: 390 },
  });
  try {
    const page = await context.newPage();
    const input = applicationInput();
    await page.goto("/apply");
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("設定密碼").fill(input.password);
    expect(
      await page.evaluate(
        (password) => ({
          keys: [localStorage, sessionStorage].flatMap((storage) =>
            Array.from({ length: storage.length }, (_, index) =>
              storage.key(index)
            )
          ),
          passwordStored: [localStorage, sessionStorage].some((storage) =>
            Array.from({ length: storage.length }, (_, index) =>
              storage.getItem(storage.key(index) ?? "")
            ).includes(password)
          ),
        }),
        input.password
      )
    ).toEqual({ keys: [], passwordStored: false });
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })
    ).toBe(true);

    const backToSignIn = page.getByRole("link", { name: "← 返回登入" });
    await backToSignIn.click();
    await expect(
      page.getByRole("heading", { name: "放棄未提交的更改？" })
    ).toBeVisible();
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(page.getByLabel("電話號碼")).toHaveValue(input.phone);
    await expect(page.getByLabel("設定密碼")).toHaveValue(input.password);

    await backToSignIn.click();
    await page.getByRole("button", { name: "放棄變更" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    await page.goto("/apply");
    await expect(page.getByLabel("電話號碼")).toHaveValue("");
    await expect(page.getByLabel("設定密碼")).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("public application remains usable on desktop and at 320px with 200% text", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { height: 1024, width: 1440 },
  });
  try {
    const page = await context.newPage();
    const input = applicationInput();
    await page.goto("/apply");
    const desktopLayout = await page.evaluate(() => ({
      mainWidth: document.querySelector("main")?.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(desktopLayout.mainWidth).toBeLessThanOrEqual(448);
    expect(desktopLayout.overflow).toBe(false);

    await page.setViewportSize({ height: 568, width: 320 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.getByLabel("電話號碼").fill(input.phone);
    await page.getByLabel("中文全名").fill(input.fullName);
    await page.getByLabel("使用者名稱").fill(input.username);
    await page.getByLabel("電郵地址").fill(input.email);
    await page.getByLabel("設定密碼").fill(input.password);

    const pageSize = await page.evaluate(() => ({
      height: innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    expect(pageSize.width).toBe(320);
    expect(pageSize.scrollWidth).toBeLessThanOrEqual(pageSize.width);
    expect(pageSize.scrollHeight).toBeGreaterThan(pageSize.height);

    const submit = page.getByRole("button", { name: "提交申請" });
    await expect(submit).toBeEnabled();
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    if (!submitBox) {
      throw new Error(
        "The submit button should have a visible box after scrolling"
      );
    }
    expect(submitBox.x).toBeGreaterThanOrEqual(0);
    expect(submitBox.x + submitBox.width).toBeLessThanOrEqual(pageSize.width);
    expect(submitBox.y).toBeGreaterThanOrEqual(0);
    expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(pageSize.height);
    expect(
      await page.evaluate(() =>
        [localStorage, sessionStorage].some((storage) =>
          Array.from({ length: storage.length }, (_, index) =>
            storage.getItem(storage.key(index) ?? "")
          ).some((value) => value?.includes("Synthetic-password-17!"))
        )
      )
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.account-application.operationKey.v1")
      )
    ).toBeNull();
  } finally {
    await context.close();
  }
});

test("an unreadable saved application reference blocks a blank application", async ({
  page,
}) => {
  const key = "efcc.account-application.operationKey.v1";
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, "unreadable-application-reference");
  }, key);
  await page.goto("/apply");

  await expect(
    page.getByRole("button", { name: "重新檢查本機儲存" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "申請狀態" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("無法辨認");
  await expect(page.getByLabel("電話號碼")).toHaveCount(0);
  await page.getByRole("button", { name: "重新檢查本機儲存" }).click();
  await expect(page.getByLabel("電話號碼")).toHaveCount(0);
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
  ).toBe("unreadable-application-reference");
});

test("application submission waits until its operation reference can be stored", async ({
  page,
}) => {
  const key = "efcc.account-application.operationKey.v1";
  const input = applicationInput();
  await page.addInitScript((storageKey) => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name, value) {
      if (name === storageKey) {
        throw new DOMException("Storage is unavailable", "QuotaExceededError");
      }
      originalSetItem.call(this, name, value);
    };
  }, key);
  await page.goto("/apply");
  await page.getByLabel("電話號碼").fill(input.phone);
  await page.getByLabel("中文全名").fill(input.fullName);
  await page.getByLabel("使用者名稱").fill(input.username);
  await page.getByLabel("電郵地址").fill(input.email);
  await page.getByLabel("設定密碼").fill(input.password);

  let submissions = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/v2/applications" &&
      request.method() === "POST"
    ) {
      submissions += 1;
    }
  });
  await page.getByRole("button", { name: "提交申請" }).click();
  await expect(page.getByRole("alert")).toContainText("無法安全儲存申請編號");
  await expect(page.getByRole("button", { name: "提交申請" })).toBeDisabled();
  expect(submissions).toBe(0);
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
  ).toBeNull();
});

test("a confirmed application can clear its reference before another blank application", async ({
  page,
}) => {
  const input = applicationInput();
  const key = "efcc.account-application.operationKey.v1";
  await page.goto("/apply");
  await page.getByLabel("電話號碼").fill(input.phone);
  await page.getByLabel("中文全名").fill(input.fullName);
  await page.getByLabel("使用者名稱").fill(input.username);
  await page.getByLabel("電郵地址").fill(input.email);
  await page.getByLabel("設定密碼").fill(input.password);
  await page.getByRole("button", { name: "提交申請" }).click();
  await expect(page.getByText("申請已收到")).toBeVisible();
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
  ).not.toBeNull();

  await page
    .getByRole("button", { name: "清除此裝置的申請記錄，開始另一份申請" })
    .click();
  await expect(page.getByLabel("電話號碼")).toHaveValue("");
  await expect(page.getByLabel("設定密碼")).toHaveValue("");
  await expect(
    page.getByText("已清除此裝置上的申請編號，可以開始另一份申請。")
  ).toBeVisible();
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)
  ).toBeNull();
});

test("an uncertain public submission retries with the same operation reference", async ({
  page,
}) => {
  const input = applicationInput();
  const operationKeys: string[] = [];
  let droppedFirstSubmission = false;
  await page.route("**/api/v2/applications*", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (
      pathname === "/api/v2/applications" &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON() as { operationKey: string };
      operationKeys.push(body.operationKey);
      if (!droppedFirstSubmission) {
        droppedFirstSubmission = true;
        await route.abort();
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/apply");
  await page.getByLabel("電話號碼").fill(input.phone);
  await page.getByLabel("中文全名").fill(input.fullName);
  await page.getByLabel("使用者名稱").fill(input.username);
  await page.getByLabel("電郵地址").fill(input.email);
  await page.getByLabel("設定密碼").fill(input.password);
  await page.getByRole("button", { name: "提交申請" }).click();
  await expect(page.getByText(/查核後未找到已完成的申請/u)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "清除此裝置的申請記錄，開始另一份申請" })
  ).toHaveCount(0);
  expect(operationKeys).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("efcc.account-application.operationKey.v1")
    )
  ).toBe(operationKeys[0]);

  await page.getByRole("button", { name: "提交申請" }).click();
  await expect(page.getByText("申請已收到")).toBeVisible();
  expect(operationKeys).toHaveLength(2);
  expect(operationKeys[1]).toBe(operationKeys[0]);
});

test("a public application conflict hides its form until its reference is checked", async ({
  page,
  request,
}) => {
  const existing = applicationInput();
  const established = await request.post("/api/v2/applications", {
    data: existing,
  });
  expect(established.status()).toBe(201);

  const conflicting = { ...applicationInput(), phone: existing.phone };
  await page.goto("/apply");
  await page.getByLabel("電話號碼").fill(conflicting.phone);
  await page.getByLabel("中文全名").fill(conflicting.fullName);
  await page.getByLabel("使用者名稱").fill(conflicting.username);
  await page.getByLabel("電郵地址").fill(conflicting.email);
  await page.getByLabel("設定密碼").fill(conflicting.password);
  await page.getByRole("button", { name: "提交申請" }).click();

  await expect(
    page.getByRole("heading", { name: "申請資料需要查核" })
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("不會把衝突當成成功");
  await expect(page.getByLabel("電話號碼")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交申請" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新查核申請結果" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "清除此裝置的申請記錄，開始另一份申請" })
  ).toHaveCount(0);
});
