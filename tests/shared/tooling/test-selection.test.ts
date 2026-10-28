import { describe, expect, it } from "vitest";

import {
  assertNativeClassification,
  selectedGrep,
  selectTests,
} from "../../../scripts/test-selection";

describe("source-area native selection", () => {
  it("selects shared session draft recovery for all three flows and mobile engines", () => {
    for (const sourcePath of [
      "src/features/account/session-draft.ts",
      "src/features/account/session-draft-recovery.tsx",
      "tests/e2e/session-draft-recovery.spec.ts",
    ]) {
      const selection = selectTests([sourcePath]);
      expect(selection.mobile).toBe(true);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@account-assisted",
          "@account-identity",
          "@account-applicant",
          "@risk-draft",
          "@risk-recovery",
          "@risk-privacy",
          "@risk-freshness",
        ])
      );
    }
    expect(() =>
      selectTests(["src/features/account/unregistered-session-draft.ts"])
    ).toThrow(/Unclassified test source path/u);
  });

  it("selects role boundaries for the person workspace route", () => {
    expect(selectTests(["src/app/(workspace)/roles/people/page.tsx"])).toEqual(
      selectTests(["src/features/roles/ui/role-person-workspace.tsx"])
    );
  });

  it("keeps focused identity route, extracted frame and task journeys on mobile security and recovery coverage", () => {
    for (const path of [
      "src/app/(workspace)/roles/people/identity/page.tsx",
      "src/features/roles/ui/role-task-frame.tsx",
      "src/features/roles/ui/account-identity-task.tsx",
      "src/features/roles/ui/admin-stepdown-task.tsx",
      "tests/e2e/roles/task-layout-ui.spec.ts",
      "tests/e2e/roles/admin-grant-task-ui.spec.ts",
    ]) {
      const selection = selectTests([path]);
      expect(selection.mobile).toBe(true);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@risk-authorization",
          "@risk-session",
          "@risk-recovery",
          "@risk-privacy",
          "@risk-presentation",
        ])
      );
    }
  });

  it("selects the real scoped aggregate browser consumer and focused route on mobile atomic recovery coverage", () => {
    for (const path of [
      "src/app/(workspace)/roles/people/duties/page.tsx",
      "src/features/roles/scoped-role-change-contract.ts",
      "src/features/roles/ui/scoped-role-api.ts",
      "src/features/roles/ui/scoped-role-task.tsx",
      "tests/e2e/roles/scoped-role-batch-ui.spec.ts",
      "tests/e2e/roles/department-program-entry-ui.spec.ts",
    ]) {
      const selection = selectTests([path]);
      expect(selection.mobile).toBe(true);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-actor-target-key",
          "@risk-session",
          "@risk-recovery",
          "@risk-privacy",
          "@risk-presentation",
        ])
      );
    }
  });

  it("selects the batch picker and public command on mobile and causal boundaries", () => {
    for (const path of [
      "src/features/roles/program-leader-grant-batch-contract.ts",
      "src/features/roles/program-leader-routes.ts",
      "src/features/roles/program-leaders.ts",
      "src/features/roles/ui/program-leader-candidate-picker.tsx",
      "src/features/roles/ui/program-leader-grant-batch-api.ts",
      "tests/e2e/roles/program-leader-grant-batch-ui.spec.ts",
    ]) {
      const selection = selectTests([path]);
      expect(selection.mobile).toBe(true);
      expect(selection.tags).toEqual(
        expect.arrayContaining([
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-actor-target-key",
          "@risk-session",
          "@risk-recovery",
          "@risk-privacy",
          "@risk-presentation",
          "@risk-resilience",
        ])
      );
    }
    expect(
      selectTests(["src/features/roles/program-leader-grant-batch-contract.ts"])
        .tags
    ).toContain("@account-clock-matrix");
  });

  it("keeps direct Admin grant selection on required effects, original-key and retained-history boundaries", () => {
    const selection = selectTests([
      "tests/e2e/roles/admin-grant-task-ui.spec.ts",
    ]);
    expect(selection.mobile).toBe(true);
    expect(selection.tags).toEqual(
      expect.arrayContaining([
        "@risk-atomicity",
        "@risk-actor-target-key",
        "@risk-history",
      ])
    );
  });

  it("keeps role UI source changes on the Session-revocation boundary", () => {
    const selection = selectTests([
      "src/features/roles/ui/global-role-client.tsx",
    ]);
    expect(selection.mobile).toBe(true);
    expect(selection.tags).toEqual(
      expect.arrayContaining([
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-session",
        "@risk-non-replay",
        "@risk-presentation",
      ])
    );
  });

  it("selects shared stale-data refresh for both contact owners on all browser projects", () => {
    const selection = selectTests([
      "src/features/account/stale-data-refresh.tsx",
    ]);
    expect(selection.mobile).toBe(true);
    expect(selection.tags).toEqual(
      expect.arrayContaining([
        "@account-identity",
        "@account-applicant",
        "@risk-freshness",
        "@risk-draft",
        "@risk-recovery",
        "@risk-privacy",
      ])
    );
    expect(
      selectTests(["tests/e2e/account-applicant/stale-refresh-ui.spec.ts"]).tags
    ).toContain("@account-applicant");
    expect(() =>
      selectTests(["src/features/account/unregistered-stale-refresh.tsx"])
    ).toThrow(/Unclassified test source path/u);
  });
  it("selects repaired Home and Staff URL journeys on their native mobile boundaries", () => {
    const home = selectTests(["tests/e2e/home-browsing-state.spec.ts"]);
    expect(home.mobile).toBe(true);
    expect(home.tags).toEqual(
      expect.arrayContaining(["@home", "@risk-compatibility"])
    );
    const staff = selectTests(["tests/e2e/staff-query-navigation.spec.ts"]);
    expect(staff.mobile).toBe(true);
    expect(staff.tags).toEqual(
      expect.arrayContaining([
        "@account-assisted",
        "@risk-authorization",
        "@risk-recovery",
      ])
    );
    expect(() =>
      selectTests(["tests/e2e/staff-query-unregistered.spec.ts"])
    ).toThrow(/Unclassified test source path/u);
  });
  it("selects shared Staff denial presentation across native authority and mobile recovery", () => {
    const selection = selectTests([
      "src/features/account/staff-workspace/staff-access-denied.tsx",
    ]);
    expect(selection.mobile).toBe(true);
    expect(selection.tags).toEqual(
      expect.arrayContaining([
        "@risk-authority",
        "@risk-authorization",
        "@risk-privacy",
        "@risk-recovery",
        "@risk-presentation",
        "@r11-ui",
      ])
    );
    expect(
      selectTests([
        "src/features/account/staff-workspace/access/denial-summary.tsx",
      ])
    ).toEqual(selection);
    for (const sourcePath of [
      "src/features/account/staff-workspace/staff-access-denied-unregistered.ts",
      "src/features/account/unregistered-capability/denial-summary.tsx",
    ]) {
      expect(() => selectTests([sourcePath])).toThrow(
        /Unclassified test source path/u
      );
    }
  });

  it("keeps the exact Staff directory browser proof on authority, privacy and recovery risks", () => {
    const selection = selectTests(["tests/e2e/staff-directory.spec.ts"]);
    expect(selection.mobile).toBe(true);
    for (const tag of [
      "@account-assisted",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ]) {
      expect(selection.tags).toContain(tag);
    }
    expect(() =>
      selectTests(["tests/e2e/staff-directory-unregistered.spec.ts"])
    ).toThrow(/Unclassified test source path/u);
  });

  it("keeps Staff search projection writers and validation on native semantic risks", () => {
    for (const file of [
      "src/features/account/staff-search.ts",
      "src/features/account/staff-search-contract.ts",
    ]) {
      expect(selectTests([file])).toMatchObject({
        mobile: true,
        tags: selectTests(["src/features/account/identity-validation.ts"]).tags,
      });
      expect(selectTests([file]).mutation).toBeUndefined();
    }
    expect(() =>
      selectTests(["src/features/account/unregistered-staff-search.ts"])
    ).toThrow();
  });

  it("classifies the shared business error owner at the real error boundary", () => {
    const selection = selectTests([
      "src/features/account/business-error-contract.ts",
    ]);
    expect(selection.tags).toContain("@risk-validation");
    expect(() =>
      selectTests(["src/features/account/unregistered-business-error.ts"])
    ).toThrow();
  });

  it("keeps assisted HTTP rollback changes out of mobile projects", () => {
    expect(
      selectTests(["tests/e2e/account-assisted/transaction-rollback.spec.ts"])
    ).toEqual({
      configs: [],
      mobile: false,
      tags: ["@risk-atomicity", "@risk-recovery"],
    });
    expect(
      selectTests(["tests/e2e/account-assisted/staff-ui.spec.ts"]).mobile
    ).toBe(true);
    expect(selectTests(["tests/e2e/account-assisted/fixtures.ts"]).mobile).toBe(
      true
    );
    expect(
      selectTests(["tests/e2e/account-assisted/visibility-browser.ts"])
    ).toEqual(selectTests(["tests/e2e/account-assisted/staff-ui.spec.ts"]));
  });

  it("selects typed Staff handover lifecycle changes for mobile journeys", () => {
    expect(
      selectTests([
        "src/features/account/assisted-accounts/staff-account-handover.ts",
      ])
    ).toEqual({
      configs: [],
      mobile: true,
      productionBuild: true,
      tags: [
        "@account-assisted",
        "@risk-accessibility",
        "@risk-actor-target-key",
        "@risk-atomicity",
        "@risk-auth",
        "@risk-non-replay",
        "@risk-presentation",
        "@risk-privacy",
        "@risk-recovery",
        "@risk-verifier-race",
      ],
    });
  });

  it("selects account security and causal deadline risks without losing their lanes", () => {
    const security = selectTests(["src/features/account/security/security.ts"]);
    expect(security).toMatchObject({
      mobile: false,
    });
    expect(security.tags).toEqual(
      expect.arrayContaining([
        "@risk-auth",
        "@risk-atomicity",
        "@risk-session",
        "@risk-verifier-race",
        "@risk-recovery",
        "@risk-privacy",
        "@risk-non-replay",
      ])
    );

    const ui = selectTests(["src/features/account/security/security-form.tsx"]);
    expect(ui.mobile).toBe(true);
    expect(ui.tags).toContain("@security");

    const causal = selectTests(["tests/e2e/account-clock-matrix.spec.ts"]);
    expect(causal).toMatchObject({
      mobile: false,
    });
    expect(causal.tags).toEqual(
      expect.arrayContaining(["@risk-deadline", "@risk-atomicity"])
    );

    const adminStepdown = selectTests([
      "tests/e2e/roles/admin-stepdown-causal.spec.ts",
    ]);
    expect(adminStepdown.tags).toEqual(
      expect.arrayContaining([
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-session",
      ])
    );

    const adminStepdownAtomicity = selectTests([
      "tests/e2e/roles/admin-stepdown-atomicity.spec.ts",
    ]);
    expect(adminStepdownAtomicity.tags).toEqual(
      expect.arrayContaining([
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-history",
        "@risk-session",
      ])
    );

    const adminStepdownUi = selectTests([
      "tests/e2e/roles/admin-stepdown-ui.spec.ts",
    ]);
    expect(adminStepdownUi.mobile).toBe(true);
    expect(adminStepdownUi.tags).toEqual(
      expect.arrayContaining([
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-session",
        "@risk-resilience",
        "@risk-privacy",
        "@risk-presentation",
      ])
    );
  });

  it("selects auth, actor-key, transaction, verifier-race and secret non-replay boundaries", () => {
    const access = selectTests(["tests/e2e/access-foundation.spec.ts"]);
    expect(access.tags).toEqual(
      expect.arrayContaining([
        "@risk-auth",
        "@risk-csrf",
        "@risk-session",
        "@risk-session-cookie",
      ])
    );

    const assisted = selectTests(["tests/e2e/account-assisted.spec.ts"]);
    expect(assisted.mobile).toBe(true);
    expect(assisted.tags).toEqual(
      expect.arrayContaining([
        "@risk-atomicity",
        "@risk-actor-target-key",
        "@risk-verifier-race",
        "@risk-recovery",
        "@risk-privacy",
        "@risk-non-replay",
      ])
    );
  });

  it("keeps signed-in applicant lifetime changes in mobile coverage", () => {
    expect(
      selectTests(["src/features/account/applications/applicant-operation.ts"])
    ).toEqual(
      selectTests(["src/features/account/applications/applicant-form.tsx"])
    );
  });

  it("keeps UI compatibility, limiter and authentication recovery risks in their source scopes", () => {
    const applicant = selectTests([
      "src/features/account/applications/applicant-form.tsx",
    ]);
    expect(applicant.mobile).toBe(true);
    expect(applicant.tags).toEqual(
      expect.arrayContaining([
        "@risk-compatibility",
        "@risk-rate-limit",
        "@risk-accessibility",
      ])
    );

    const limiter = selectTests(["tests/scenarios/limiter.ts"]);
    expect(limiter.tags).toEqual(
      expect.arrayContaining(["@risk-rate-limit", "@risk-real-limiter"])
    );

    const authentication = selectTests(["src/features/auth/sign-in-form.tsx"]);
    expect(authentication.tags).toContain("@risk-auth-recovery");

    expect(selectTests(["src/components/ui/button.tsx"]).tags).toContain(
      "@risk-accessibility"
    );
  });

  it("retains mobile application coverage when its lifecycle moves out of the form", () => {
    const operation = selectTests([
      "src/features/account/applications/application-operation.ts",
    ]);
    expect(operation.mobile).toBe(true);
    expect(operation.tags).toEqual(
      expect.arrayContaining([
        "@account-application",
        "@risk-auth",
        "@risk-atomicity",
        "@risk-recovery",
        "@risk-privacy",
      ])
    );
  });

  it("selects account decision cases by retained semantic risks", () => {
    const decisions = selectTests(["tests/e2e/account-decisions.spec.ts"]);
    expect(decisions.tags).toEqual(
      expect.arrayContaining(["@risk-authorization", "@risk-privacy"])
    );
    expect(decisions.tags).not.toContain("@account-decisions");

    expect(selectTests(["tests/scenarios/accounts.ts"]).tags).toContain(
      "@risk-authorization"
    );
  });

  it("classifies account audit native HTTP and mobile navigation coverage", () => {
    const audit = selectTests(["tests/e2e/account-audit/staff-ui.spec.ts"]);
    expect(audit.mobile).toBe(true);
    expect(audit.tags).toEqual(
      expect.arrayContaining([
        "@risk-authorization",
        "@risk-privacy",
        "@risk-recovery",
      ])
    );
  });

  it("maps operation, staff-frame and lifecycle sources to real native scopes", () => {
    const operation = selectTests(["src/features/account/post-operation.ts"]);
    expect(operation).toMatchObject({
      mobile: true,
    });
    expect(operation.tags).toEqual(
      expect.arrayContaining([
        "@risk-actor-target-key",
        "@risk-atomicity",
        "@risk-recovery",
        "@risk-privacy",
      ])
    );

    const staffFrame = selectTests([
      "src/features/account/staff-task-frame.tsx",
    ]);
    expect(staffFrame.mobile).toBe(true);
    expect(staffFrame.tags).toEqual(
      expect.arrayContaining(["@risk-authorization", "@risk-accessibility"])
    );

    const lifecycle = selectTests(["tests/support/lifecycle-child.spec.ts"]);
    expect(lifecycle).toMatchObject({
      configs: [],
      tags: ["@foundation"],
    });

    for (const ledger of [
      "docs/design/slice-1-2-ui/r11-source-diff-register.csv",
      "docs/design/slice-1-2-ui/r11-visual-ledger.csv",
    ]) {
      expect(selectTests([ledger]).tags).toEqual([]);
    }
    expect(() =>
      selectTests(["docs/design/slice-1-2-ui/new-ledger.csv"])
    ).toThrow(/Unclassified test source path/u);
  });

  it("requires complete qualification when the shared runner changes", () => {
    const shared = selectTests(["scripts/test-runner.ts"]);
    expect(shared).toMatchObject({
      full: true,
      mobile: true,
      productionBuild: true,
      tags: ["@native"],
    });
    expect(selectTests(["playwright.native.config.ts"]).configs).toEqual([
      "playwright.native.config.ts",
    ]);

    const features = selectTests(["playwright.features.config.ts"]);
    expect(features.mobile).toBe(true);
    expect(features.configs).toEqual(["playwright.features.config.ts"]);
    expect(features.tags).toEqual([]);
    expect(features.tags).not.toContain("@native");
  });

  it("keeps fast-only and explicitly known documentation changes out of runtime lanes", () => {
    expect(
      selectTests(["tests/shared/account/application-contract.test.ts"])
    ).toEqual({
      configs: [],
      mobile: false,
      mutation: true,
      tags: [],
    });
    expect(selectTests(["README.md"]).tags).toEqual([]);
    expect(
      selectTests(["docs/testing-foundation/N15_ACCEPTANCE.md"]).tags
    ).toEqual([]);
    expect(selectTests(["docs/testing-foundation/N16_GATE.md"]).tags).toEqual(
      []
    );
    expect(
      selectTests(["docs/design/slice-1-2-ui/verification/detector.json"]).tags
    ).toEqual([]);
    expect(
      selectTests([
        "docs/foundation-programme/IMPLEMENTATION_PROMPT.md",
        "docs/foundation-programme/published-tickets/01-render-complete-unicode-account-initials.md",
        "docs/foundation-programme/breakdown-draft.json",
        "docs/foundation-programme/coverage.csv",
      ])
    ).toEqual({
      configs: [],
      mobile: false,
      tags: [],
    });
    expect(
      selectTests(["docs/design/slice-1-2-ui/screenbook/book.mjs"]).tags
    ).toContain("@risk-presentation");
    expect(() =>
      selectTests(["docs/foundation-programme/unmapped-file.ts"])
    ).toThrow(/Unclassified test source path/u);
    expect(selectTests([]).tags).toEqual([]);
  });

  it("keeps moved family and tooling sources classified without another execution registration", () => {
    for (const family of [
      "account-identity",
      "account-decisions",
      "account-audit",
      "account-restrictions",
      "account-deletion",
      "account-security",
      "restricted-status",
    ]) {
      expect(selectTests([`tests/e2e/${family}/fixtures.ts`])).toEqual(
        selectTests([`tests/e2e/${family}.spec.ts`])
      );
    }
    expect(
      selectTests(["tests/shared/tooling/native-selection.test.ts"]).tags
    ).toEqual([]);
    expect(selectTests(["GLOSSARY.md"]).tags).toEqual([]);
    expect(selectTests(["playwright.discovery.config.ts"])).toMatchObject({
      full: true,
      mobile: true,
      tags: ["@native"],
    });
  });

  it("fails unknown and escaping paths while explicit full selection remains a full matrix", () => {
    for (const path of [
      "src/features/account/new-feature.ts",
      "src/features/account/security.ts.bak",
      "src/features/account/security-form.tsx.backup",
      "src/app/layout.tsx.backup",
      "src/shared/protected-pages.ts.bak",
      "docs/new-script.ts",
      "docs/new-script.json",
      "docs/unmapped.md",
    ]) {
      expect(() => selectTests([path])).toThrow(
        /Unclassified test source path/u
      );
    }
    expect(() => selectTests(["../outside"], true)).toThrow(
      /Unclassified test source path/u
    );
    expect(() => selectTests(["/tmp/outside"], true)).toThrow(
      /Unclassified test source path/u
    );
    expect(() => selectTests(["C:\\outside"], true)).toThrow(
      /Unclassified test source path/u
    );

    const full = selectTests(["renamed/new-feature.ts"], true);
    expect(full).toMatchObject({
      mobile: true,
      tags: ["@native"],
    });
  });
});

describe("CI applicability classification", () => {
  it("keeps only the explicitly owned PR guidance files fast-only", () => {
    for (const sourcePath of [
      "AGENTS.md",
      "CONTRIBUTING.md",
      "README.md",
      ".github/pull_request_template.md",
      "docs/testing.md",
      "docs/ci-security.md",
      "docs/agents/pull-request-contract.md",
      "docs/agents/domain.md",
      "docs/agents/issue-tracker.md",
      "docs/agents/triage-labels.md",
      ".github/dependabot.yml",
    ]) {
      expect(selectTests([sourcePath])).toEqual({
        configs: [],
        mobile: false,
        tags: [],
      });
    }
  });

  it("fails closed for new workflow and guidance paths without a reviewed mapping", () => {
    for (const sourcePath of [
      ".github/workflows/new-check.yml",
      ".github/dependency-review-config.yml",
      "docs/agents/unreviewed-guide.md",
      "CONTRIBUTING.extra.md",
    ]) {
      expect(() => selectTests([sourcePath])).toThrow(
        /Unclassified test source path/u
      );
    }
  });

  it("maps the shared axe helper to only its three mobile Native journeys", () => {
    const helper = selectTests(["tests/e2e/accessibility-baseline.ts"]);
    const journeys = selectTests([
      "tests/e2e/sign-in-experience.spec.ts",
      "tests/e2e/account-applicant.spec.ts",
      "tests/e2e/account-assisted/staff-ui.spec.ts",
    ]);

    expect(helper).toEqual(journeys);
    expect(helper.mobile).toBe(true);
    expect(helper.full).toBeUndefined();
  });

  it("requires complete Native qualification for runner and toolchain changes", () => {
    for (const sourcePath of [
      ".github/workflows/checks.yml",
      ".github/workflows/dependency-review.yml",
      "package.json",
      "pnpm-lock.yaml",
      ".npmrc",
      "vitest.coverage.config.ts",
      "stryker.config.json",
      "vitest.mutation.config.ts",
      "scripts/test-runner.ts",
      "scripts/test-selection.ts",
      "scripts/test-snapshot.ts",
      "scripts/build-causal.ts",
      "scripts/build-credential-race.ts",
      "scripts/assert-legacy-source.ts",
      "tests/support/native-source.ts",
      "migrations/0008_access_restrictions.sql",
      "playwright.config.ts",
      "playwright.discovery.config.ts",
      "wrangler.jsonc",
      "vite.config.ts",
      "turbo.json",
    ]) {
      expect(selectTests([sourcePath])).toMatchObject({
        full: true,
        mobile: true,
        mutation: true,
        productionBuild: true,
        tags: ["@native"],
      });
    }
  });

  it("adds the production build to product-source changes without widening Native selection", () => {
    const selection = selectTests(["src/features/auth/sign-in.ts"]);
    expect(selection).toMatchObject({ productionBuild: true });
    expect(selection.full).toBeUndefined();
    expect(selection.mobile).toBe(true);
    expect(selection.tags).not.toEqual(["@native"]);
  });

  it("keeps mixed fast-only and full-scope changes at full Native qualification", () => {
    expect(
      selectTests(["README.md", ".github/workflows/checks.yml"])
    ).toMatchObject({
      full: true,
      mobile: true,
      productionBuild: true,
      tags: ["@native"],
    });
  });
});

describe("native CLI tag filter", () => {
  it("selects exact claim tags without prefix collisions", () => {
    const grep = new RegExp(
      selectedGrep(["@risk-auth", "@risk-actor-target-key"]),
      "u"
    );
    expect(grep.test("@native @http @risk-auth sign-in")).toBe(true);
    expect(grep.test("@native @browser @risk-actor-target-key retry")).toBe(
      true
    );
    expect(grep.test("@native @http @risk-authentication")).toBe(false);
    expect(grep.test("@native @http @risk-recovery")).toBe(false);
    for (const tags of [[], ["invalid tag"], ["@risk-auth|.*"]]) {
      expect(() => selectedGrep(tags)).toThrow();
    }
  });
});

describe("native case classification", () => {
  it("accepts known transport, feature, risk and browser capability tags", () => {
    expect(() =>
      assertNativeClassification([
        "native",
        "http",
        "access-foundation",
        "risk-auth",
        "risk-csrf",
        "risk-ambiguity",
        "risk-responsive",
        "risk-compatibility",
        "risk-rate-limit",
        "risk-accessibility",
        "risk-auth-recovery",
      ])
    ).not.toThrow();
    expect(() =>
      assertNativeClassification([
        "@native",
        "@browser",
        "@mobile-critical",
        "@sign-in-experience",
        "@presentation",
        "@risk-presentation",
      ])
    ).not.toThrow();
  });

  it("accepts explicit startup only in the native foundation lane", () => {
    expect(() =>
      assertNativeClassification([
        "@native",
        "@startup",
        "@foundation",
        "@risk-auth",
      ])
    ).not.toThrow();
    for (const tags of [
      ["@native", "@startup", "@risk-auth"],
      ["@native", "@startup", "@foundation", "@http"],
      ["@native", "@startup", "@foundation", "@browser"],
      ["@native", "@startup", "@foundation", "@mobile-critical"],
    ]) {
      expect(() => assertNativeClassification(tags)).toThrow();
    }
  });

  it("rejects missing classification, unknown tags and transport conflicts", () => {
    for (const tags of [
      ["@native", "@http"],
      ["@native", "@http", "@access-foundation"],
      ["@http", "@risk-auth"],
      ["@native", "@risk-auth"],
      ["@native", "@http", "@lifecycle", "@risk-auth"],
      ["@native", "@http", "@access-foundation", "@new-feature"],
      ["@native", "@http", "@risk-new"],
      ["@native", "@http", "@browser", "@risk-auth"],
      ["@native", "@http", "@mobile-critical", "@risk-auth"],
    ]) {
      expect(() => assertNativeClassification(tags)).toThrow();
    }
  });
});

it("discovers nested fast test sources without classifying arbitrary helpers", () => {
  expect(
    selectTests(["tests/shared/account/new-contract.test.ts"]).tags
  ).toEqual([]);
  expect(selectTests(["tests/ui/new-component.test.tsx"]).tags).toEqual([]);
  expect(selectTests(["tests/shared/tooling/fixtures.ts"]).tags).toEqual([]);
  expect(() => selectTests(["tests/shared/tooling/new-helper.ts"])).toThrow(
    /Unclassified test source path/u
  );
});

it("preserves semantic and mobile selection across capability path changes", () => {
  expect(selectTests(["src/features/account/security/security.ts"])).toEqual(
    selectTests(["src/features/account/security.ts"])
  );
  expect(
    selectTests(["src/features/account/security/security-form.tsx"])
  ).toEqual(selectTests(["src/features/account/security-form.tsx"]));
  expect(selectTests(["src/features/account/timestamps.ts"])).toMatchObject({
    configs: [],
    mobile: false,
    tags: expect.arrayContaining(["@account-clock-matrix", "@risk-deadline"]),
  });
});

it("classifies programme documents without exempting executable or unknown inputs", () => {
  for (const file of [
    "docs/foundation-programme/README.md",
    "docs/foundation-programme/breakdown-draft.json",
    "docs/foundation-programme/review-evidence/source.json",
    "docs/foundation-programme/published-tickets/01-render-complete-unicode-account-initials.md",
  ]) {
    expect(selectTests([file])).toEqual({
      configs: [],
      mobile: false,
      tags: [],
    });
  }
  for (const file of [
    "docs/foundation-programme/script.ts",
    "docs/foundation-programme/unknown.jsonc",
    "docs/unknown.json",
  ]) {
    expect(() => selectTests([file])).toThrow(/Unclassified test source path/u);
  }
});

it("keeps mobile coverage for a view extracted under its existing account capability", () => {
  expect(
    selectTests(["src/features/account/security/review-card.tsx"])
  ).toEqual(
    expect.objectContaining({
      configs: [],
      mobile: true,
      tags: expect.arrayContaining(["@security", "@risk-auth"]),
    })
  );
});

it.each([
  [
    "applicant forms",
    "src/features/account/applications/applicant-form.tsx",
    "src/features/account/applications/contact-step.tsx",
  ],
  [
    "assisted account forms",
    "src/features/account/assisted-accounts/staff-accounts-form.tsx",
    "src/features/account/assisted-accounts/recovery-step.tsx",
  ],
  [
    "decision review",
    "src/features/account/decisions/decision-review.tsx",
    "src/features/account/decisions/review-card.tsx",
  ],
  [
    "deletion forms",
    "src/features/account/deletion/deletion-form.tsx",
    "src/features/account/deletion/confirmation-step.tsx",
  ],
  [
    "identity changes",
    "src/features/account/identity-changes/identity-form-views.tsx",
    "src/features/account/identity-changes/review-card.tsx",
  ],
  [
    "restriction forms",
    "src/features/account/restrictions/restrictions-form.tsx",
    "src/features/account/restrictions/review-card.tsx",
  ],
  [
    "security forms",
    "src/features/account/security/security-form.tsx",
    "src/features/account/security/review-card.tsx",
  ],
  [
    "Staff workspace views",
    "src/features/account/staff-workspace/staff-people-list.tsx",
    "src/features/account/staff-workspace/person-card.tsx",
  ],
])(
  "keeps mobile selection when %s gets an extracted view",
  (_name, original, extracted) => {
    const existing = selectTests([original]);
    expect(existing.mobile).toBe(true);
    expect(selectTests([extracted])).toEqual(existing);
  }
);

it("keeps rename, deletion, extraction and later edits on the existing UI selection", () => {
  const original = "src/features/account/security/security-form.tsx";
  const created = "src/features/account/security/review-card.tsx";
  const extracted = "src/features/account/security/review/review-card.tsx";
  const expected = selectTests([original]);

  expect(selectTests([created])).toEqual(expected);
  expect(selectTests([original, created])).toEqual(expected);
  expect(selectTests([original])).toEqual(expected);
  expect(selectTests([original, extracted])).toEqual(expected);
  expect(selectTests([extracted])).toEqual(expected);
});

it("keeps new non-UI account paths fail-closed without a capability mapping", () => {
  expect(() =>
    selectTests(["src/features/account/security/review/credential-store.ts"])
  ).toThrow(/Unclassified test source path/u);
});
