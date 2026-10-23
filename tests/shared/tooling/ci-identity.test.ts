import { describe, expect, it } from "vitest";

import {
  assertCiEventIdentity,
  parseGateOptions,
} from "../../../scripts/test-runner";

const sha = (digit: string) => digit.repeat(40);

describe("CI candidate identity", () => {
  it("allows CI identity validation only for the affected runner", () => {
    expect(parseGateOptions(["affected", "--ci"]).ci).toBe(true);
    expect(() => parseGateOptions(["staged", "--ci"])).toThrow();
  });

  it("keeps pull request base, head, and tested merge commit distinct", () => {
    const base = sha("a");
    const head = sha("b");
    const tested = sha("c");

    expect(
      assertCiEventIdentity(
        "pull_request",
        { pull_request: { base: { sha: base }, head: { sha: head } } },
        tested,
        tested,
        [base, head]
      )
    ).toEqual({ base, full: false, head, tested });
  });

  it("requires the tested merge commit to have the event base and head parents", () => {
    const base = sha("a");
    const head = sha("b");

    expect(() =>
      assertCiEventIdentity(
        "pull_request",
        { pull_request: { base: { sha: base }, head: { sha: head } } },
        sha("c"),
        sha("c"),
        [base, sha("d")]
      )
    ).toThrow(/Tested merge commit does not match event base and head/u);
  });

  it("forces full qualification when a push has no prior commit", () => {
    const head = sha("b");
    const before = "0".repeat(40);

    expect(
      assertCiEventIdentity("push", { after: head, before }, head, head, [])
    ).toEqual({ base: before, full: true, head, tested: head });
  });

  it("rejects a checkout that differs from the event head", () => {
    const head = sha("b");

    expect(() =>
      assertCiEventIdentity(
        "push",
        { after: sha("c"), before: sha("a") },
        head,
        head,
        [sha("a")]
      )
    ).toThrow(/Checked out commit does not match event head/u);
  });
});
