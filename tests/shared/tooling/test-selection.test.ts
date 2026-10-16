import { describe, expect, it } from "vitest";

import {
  assertNativeClassification,
  selectedGrep,
  selectTests,
} from "../../../scripts/test-selection";

describe("source-area native selection", () => {
  it("keeps Staff search projection writers and validation on native semantic risks", () => {
    for (const file of [
      "src/features/account/staff-search.ts",
      "src/features/account/staff-search-contract.ts",
    ]) {
      expect(selectTests([file])).toEqual(
        selectTests(["src/features/account/identity-validation.ts"])
      );
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

  it("keeps shared runtime selection risk-scoped instead of selecting the full suite", () => {
    const shared = selectTests(["scripts/test-runner.ts"]);
    expect(shared).toMatchObject({
      mobile: true,
    });
    expect(shared.tags).toEqual(
      expect.arrayContaining([
        "@risk-auth",
        "@risk-access",
        "@risk-auth-boundary",
        "@risk-authentication",
        "@risk-csrf",
        "@risk-session",
        "@risk-actor-target-key",
        "@risk-origin",
        "@risk-atomicity",
        "@risk-deadline",
        "@risk-verifier-race",
        "@risk-recovery",
        "@risk-privacy",
        "@risk-non-replay",
        "@foundation",
      ])
    );
    expect(shared.tags).not.toContain("@native");
    expect(shared.tags).not.toContain("@sign-in-experience");
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
      selectTests(["docs/design/slice-1-2-ui/screenbook/book.mjs"]).tags
    ).toContain("@risk-presentation");
    expect(selectTests([]).tags).toEqual([]);
  });

  it("keeps moved family and tooling sources classified without another execution registration", () => {
    for (const family of [
      "account-identity",
      "account-decisions",
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
    expect(selectTests(["playwright.discovery.config.ts"]).tags).toContain(
      "@risk-auth"
    );
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
