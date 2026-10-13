import { afterEach, describe, expect, it } from "vitest";

import {
  assertNativeClassification,
  nativeGrep,
  selectTests,
} from "../../scripts/test-selection";

const priorTags = process.env.EFCC_REQUIRED_TAGS;
afterEach(() => {
  if (priorTags === undefined) {
    delete process.env.EFCC_REQUIRED_TAGS;
  } else {
    process.env.EFCC_REQUIRED_TAGS = priorTags;
  }
});

describe("source-area native selection", () => {
  it("selects account security and causal deadline risks without losing their lanes", () => {
    const security = selectTests(["src/features/account/security.ts"]);
    expect(security).toMatchObject({
      causal: false,
      dev: false,
      foundation: false,
      mobile: false,
      requiresRuntime: true,
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

    const ui = selectTests(["src/features/account/security-form.tsx"]);
    expect(ui.mobile).toBe(true);
    expect(ui.tags).toContain("@security");

    const causal = selectTests(["tests/e2e/account-clock-matrix.spec.ts"]);
    expect(causal).toMatchObject({
      causal: true,
      mobile: false,
      requiresRuntime: true,
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


  it("keeps fast-only and explicitly known documentation changes out of runtime lanes", () => {
    expect(selectTests(["tests/shared/application-contract.test.ts"])).toEqual({
      tags: [],
      mobile: false,
      foundation: false,
      causal: false,
      dev: false,
      requiresRuntime: false,
    });
    expect(selectTests(["README.md"]).requiresRuntime).toBe(false);
    expect(selectTests([]).tags).toEqual([]);
  });

  it("fails unknown paths closed while explicit full selection remains a full matrix", () => {
    expect(() => selectTests(["src/features/account/new-feature.ts"])).toThrow(
      /Unclassified test source path/u
    );
    expect(() => selectTests(["docs/new-script.ts"])).toThrow(
      /Unclassified test source path/u
    );

    const full = selectTests(["renamed/new-feature.ts"], true);
    expect(full).toMatchObject({
      causal: true,
      dev: true,
      foundation: true,
      mobile: true,
      requiresRuntime: true,
      tags: ["@native"],
    });
  });
});

describe("native grep composition", () => {
  it("ANDs project filters with an OR of exact selected tags", () => {
    process.env.EFCC_REQUIRED_TAGS = JSON.stringify([
      "@risk-auth",
      "@risk-actor-target-key",
    ]);
    const grep = nativeGrep(/(?=.*@native)(?=.*@http)/u);

    expect(grep.test("@native @http @risk-auth sign-in")).toBe(true);
    expect(grep.test("@native @http @risk-actor-target-key retry")).toBe(true);
    expect(grep.test("@native @browser @risk-auth")).toBe(false);
    expect(grep.test("@native @http @risk-authentication")).toBe(false);
    expect(grep.test("@native @http @risk-recovery")).toBe(false);
  });

  it("does not turn malformed or empty required tags into a full run", () => {
    for (const value of ["", "not-json", "[]", "{}", '["invalid tag"]']) {
      process.env.EFCC_REQUIRED_TAGS = value;
      expect(() => nativeGrep(/@native/u)).toThrow(/EFCC_REQUIRED_TAGS/u);
    }
  });

  it("leaves ordinary direct native commands unfiltered", () => {
    delete process.env.EFCC_REQUIRED_TAGS;
    const base = /(?=.*@native)(?=.*@http)/u;
    expect(nativeGrep(base)).toBe(base);
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
      ])
    ).not.toThrow();
    expect(() =>
      assertNativeClassification([
        "@native",
        "@browser",
        "@mobile-critical",
        "@qualification",
        "@presentation",
      ])
    ).not.toThrow();
  });

  it("rejects missing classification, unknown tags and transport conflicts", () => {
    for (const tags of [
      ["@native", "@http"],
      ["@native", "@http", "@access-foundation", "@new-feature"],
      ["@native", "@http", "@risk-new"],
      ["@native", "@http", "@browser", "@risk-auth"],
      ["@native", "@http", "@mobile-critical", "@risk-auth"],
    ]) {
      expect(() => assertNativeClassification(tags)).toThrow();
    }
  });
});
