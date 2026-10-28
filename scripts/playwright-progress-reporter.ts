import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import { CaseProgress } from "./test-progress";

export default class PlaywrightProgressReporter implements Reporter {
  private readonly progress = new CaseProgress();

  onBegin(_config: FullConfig, suite: Suite): void {
    try {
      this.progress.begin([
        ...new Set(
          suite.allTests().map((test) => test.parent.project()?.name ?? "")
        ),
      ]);
    } catch {
      // Playwright swallows reporter exceptions; publish health failure explicitly.
      this.progress.unavailable();
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      if (result.status !== "skipped") {
        this.progress.complete(
          test.parent.project()?.name ?? "",
          test.id,
          result.status === "failed" ||
            result.status === "timedOut" ||
            result.status === "interrupted"
        );
      }
    } catch {
      this.progress.unavailable();
    }
  }

  onEnd(_result: FullResult): void {
    // Returning void is intentional: progress must never override Playwright's result.
    this.progress.finish();
  }

  // oxlint-disable-next-line class-methods-use-this -- Playwright invokes this public reporter instance hook.
  printsToStdio(): boolean {
    return false;
  }
}
