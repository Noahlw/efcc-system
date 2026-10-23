import { AxeBuilder } from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

const ruleTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

interface AccessibilityBaselineState {
  role: string;
  state: string;
}

export const scanAccessibilityBaseline = async (
  page: Page,
  testInfo: TestInfo,
  context: AccessibilityBaselineState
) => {
  const result = await new AxeBuilder({ page }).withTags(ruleTags).analyze();
  const expectedSource = process.env.EFCC_TEST_SOURCE;
  const metadataSource =
    testInfo.project.metadata?.source ?? testInfo.config.metadata?.source;
  const sourceBound =
    typeof expectedSource === "string" && expectedSource.length > 0;
  if (sourceBound && metadataSource !== expectedSource) {
    throw new Error(
      "Axe baseline source metadata does not match EFCC_TEST_SOURCE."
    );
  }
  const sourceIdentity = sourceBound ? expectedSource : "UNBOUND";
  const sourceBinding = sourceBound ? "SOURCE_BOUND" : "UNBOUND";

  const violations = result.violations.map((violation) => ({
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    id: violation.id,
    impact: violation.impact,
    nodeCount: violation.nodes.length,
    tags: violation.tags,
  }));
  const url = new URL(page.url());
  const viewport = page.viewportSize();
  const report = {
    browserProject: testInfo.project.name,
    counts: {
      inapplicableRules: result.inapplicable.length,
      incompleteRules: result.incomplete.length,
      passedRules: result.passes.length,
      violationNodes: violations.reduce(
        (count, violation) => count + violation.nodeCount,
        0
      ),
      violations: violations.length,
    },
    findings: violations,
    role: context.role,
    route: url.pathname,
    ruleTags,
    source: sourceIdentity,
    sourceBinding,
    state: context.state,
    test: testInfo.title,
    viewport,
  };

  await testInfo.attach(`axe-${context.state}`, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });

  console.info(
    `[axe baseline] ${JSON.stringify({
      browserProject: report.browserProject,
      counts: report.counts,
      findings: violations.map(({ id, impact, nodeCount }) => ({
        id,
        impact,
        nodeCount,
      })),
      role: report.role,
      route: report.route,
      ruleTags: report.ruleTags,
      source: report.source,
      sourceBinding: report.sourceBinding,
      state: report.state,
      viewport: report.viewport,
    })}`
  );
};
