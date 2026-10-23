import { describe, expect, it } from "vitest";

import { summarizeMutationReport } from "../../../scripts/test-runner";

const report = (mutants: { status: string }[]) => ({
  files: {
    "src/features/account/identity-validation.ts": {
      language: "typescript",
      mutants: mutants.map(({ status }, index) => ({
        id: `mutant-${index}`,
        mutatorName: "StringLiteral",
        replacement: "private replacement text",
        status,
      })),
      source: "private source text must not be copied into the summary",
    },
  },
  schemaVersion: "1.0",
  testFiles: {
    "tests/shared/account/application-contract.test.ts": {},
  },
});

describe("bounded mutation report summary", () => {
  it("reports sanitized category counts and Stryker-compatible scores", () => {
    const summary = summarizeMutationReport(
      report([
        { status: "Killed" },
        { status: "Killed" },
        { status: "Timeout" },
        { status: "Survived" },
        { status: "Survived" },
        { status: "Survived" },
        { status: "NoCoverage" },
        { status: "NoCoverage" },
        { status: "RuntimeError" },
        { status: "CompileError" },
        { status: "Ignored" },
        { status: "Pending" },
      ])
    );

    expect(summary).toEqual({
      counts: {
        CompileError: 1,
        Ignored: 1,
        Killed: 2,
        NoCoverage: 2,
        Pending: 1,
        RuntimeError: 1,
        Survived: 3,
        Timeout: 1,
      },
      mutationScore: 37.5,
      mutationScoreBasedOnCoveredCode: 50,
      totalMutants: 12,
    });
    expect(JSON.stringify(summary)).not.toContain("private source text");
    expect(JSON.stringify(summary)).not.toContain("private replacement text");
    expect(JSON.stringify(summary)).not.toContain("mutant-");
  });

  it("rejects an unexpected source or direct test scope", () => {
    expect(() =>
      summarizeMutationReport({
        ...report([{ status: "Killed" }]),
        files: { "src/unexpected.ts": { mutants: [{ status: "Killed" }] } },
      })
    ).toThrow(/unexpected source scope/u);

    expect(() =>
      summarizeMutationReport({
        ...report([{ status: "Killed" }]),
        testFiles: { "tests/unexpected.test.ts": {} },
      })
    ).toThrow(/unexpected test scope/u);
  });

  it("fails closed for incompatible, unknown, or empty reports", () => {
    expect(() =>
      summarizeMutationReport({
        ...report([{ status: "Killed" }]),
        schemaVersion: "2.0",
      })
    ).toThrow(/incompatible mutation report schema/iu);
    expect(() =>
      summarizeMutationReport(report([{ status: "Unknown" }]))
    ).toThrow(/unknown mutant status/u);
    expect(() => summarizeMutationReport(report([]))).toThrow(
      /contains no mutants/u
    );
  });
});
