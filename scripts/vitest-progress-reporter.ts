import type { Reporter, TestCase } from "vitest/node";

import { CaseProgress } from "./test-progress";

export default class VitestProgressReporter implements Reporter {
  private readonly progress = new CaseProgress();

  onTestRunStart(): void {
    this.progress.begin(["unit"]);
  }

  onTestCaseResult(test: TestCase): void {
    try {
      const result = test.result();
      if (result.state === "passed" || result.state === "failed") {
        this.progress.complete(
          "unit",
          test.id,
          result.state === "failed" || Boolean(result.errors?.length)
        );
      }
    } catch {
      this.progress.unavailable();
    }
  }

  onTestRunEnd(): void {
    this.progress.finish();
  }
}
