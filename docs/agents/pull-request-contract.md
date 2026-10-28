# Pull Request Delivery Contract

This is EFCC's shared review contract for contributors, maintainers and coding agents. It is self-contained: no private skill, editor or model provider is required. The default PR template follows this contract; the current testing commands and evidence owners remain in [Testing workflow](../testing.md).

Every delivery belongs to its governing issue and approved decisions. The PR is one reviewable handoff, not a substitute for implementation evidence, independent review, Owner acceptance or separate merge authorization.

## PR body

Keep exactly three top-level sections, in this order: **Summary**, **Evidence**, **Merge Danger**. The default template at `.github/pull_request_template.md` supplies these headings.

- **Summary** tells the reviewer what problem the change addresses, what behavior changes, and which issue or accepted decision governs it. Include the smallest useful explanation of structure or behavior; do not restate the full spec.
- **Evidence** reports checks actually run on this candidate, their result and limits, plus relevant UI Preview. Keep the key result in the PR body. Link or fold detailed receipts when needed; do not create a parallel stream of permanent bot comments.
- **Merge Danger** states whether the change is a one-way or two-way door, how readily it can be reversed, its Blast Radius, the consequence of an error and the rollback path. A cheap, safe rollback makes the change easier to reverse; destructive or hard-to-reverse effects make it a one-way door. For low-risk changes, concise answers are enough.

Only ask the Owner about a real product or retained-risk choice. If none remains, say **None**. Routine passing checks do not create approval questions. A template is a writing aid; it does not prove the answers or make a PR ready by itself.

## Flexible UI Preview

Choose the preview that helps a reviewer understand the actual change. A preview can show a new screen, a changed screen, an ordered journey, component or responsive variants, or material states such as loading, empty, validation, error, permission, review, confirmation and completion. Include the states affected by the change; do not flood the main PR view with every case or viewport.

- A **new** screen needs no Before image.
- An **existing** screen may use comparable Before/After images when the comparison clarifies the change.
- A **journey** uses a small set of ordered steps and outcomes when sequence matters.
- A **component or responsive** change shows useful variants and affected desktop/mobile views.
- A **non-UI** change marks UI Preview not applicable and supplies its relevant execution evidence; it does not add filler images.

For each preview group, state the role, route and state, browser and viewport, source identity, and expected versus observed result. Label material truthfully as new, changed, unchanged, reference or mockup. Historical comparisons must identify both candidates and use comparable synthetic fixtures and rendering conditions; a screenshot from another source is not a Before image for this candidate.

Use the existing Native fixtures and presentation/capture owners. Publish only approved masked synthetic PNGs and sanitized summaries through the authenticated GitHub attachment path. Check the image in the rendered PR itself; a successful upload, local preview or filename alone does not prove that the reviewer can see the intended image. Masks apply to screenshot bytes and do not sanitize raw logs, traces or other media. Keep those private. Images are visual evidence only; they do not establish interaction, keyboard, physical-device, assistive-technology or other unobserved behavior.

## Evidence and readiness

Report only observed results for the current candidate. Identify the base, PR head and tested checkout/tree separately when they differ, including a GitHub synthetic merge checkout. Preserve the first failure and distinguish it from a later repair. Do not carry evidence across a source change unless its scope remains valid and source affinity is established. A green aggregate is not proof that every applicable case was selected and executed.

Every PR, including bot, Dependabot and web-created changes, needs current agent-run local qualification before Ready or merge. Every commit retains exact-staged formatting/lint/runtime boundaries, complete project typecheck and fast contracts; a saved commit is not qualification. GitHub `checks` retains the complete Node suite coverage but does not attest Native execution. Source or target-base changes require refreshed local evidence. Validate the terminal source/base-bound receipt through the documented local readiness command and report local and CI results separately. This does not prohibit direct GitHub UI Ready/merge actions; author/reviewer delivery responsibility remains explicit.

Use the established source-impact policy and owners in [Testing workflow](../testing.md). Select checks by the actual files and behavior changed. Unknown or mixed paths must not silently receive a fast-only exemption. Record required cases selected and executed, retries, skips, startup/discovery failures and unavailable coverage as the runner reports them. Do not describe a partial run as complete. Keep private runtime output, credentials, sessions and fixture data out of public logs and artifacts.

Readiness requires the applicable checks and requested evidence to be current, required verification to have run, and material findings to be resolved or clearly blocking. A missing, stale, failed or partial result is not a pass. A reviewer reports **PASS**, **PASS WITH NOTES**, **FAIL**, **BLOCKED** or **NOT RUN** with scope and limits. A material defect or required unexecuted check cannot be hidden by PASS WITH NOTES. There is no AI score or numeric review quota.

## Responsibilities

### Author

- Follow the governing issue and accepted decisions; state the behavior and meaningful risks in the PR body.
- Run the applicable checks using the repository's documented commands and present actual candidate-bound results and limits.
- Provide the UI Preview that fits the change, or mark it not applicable. Use synthetic, approved masked visual evidence only.
- Do not weaken tests, assertions, source selection or trusted review guidance to make the change appear ready. Explain intentional test/oracle changes and preserve the behavior they must still detect.

### CI

- Run actionlint, format/lint/runtime boundaries, typecheck and one candidate unit-coverage measurement against the validated event checkout.
- Validate source identity and source selection; unknown paths, setup failures and failed required light checks block. Do not install browsers, build or run Native, replay base coverage or run mutation in automatic PR/main CI. There is no full-test backup workflow.
- Keep receipts and summaries sanitized. Native selection/execution completeness, zero skip/retry and cleanup remain required in applicable local delivery qualification, not ordinary commits. Live progress is informational, never acceptance evidence. CI status does not establish local qualification, independent review, Owner acceptance or merge permission.

### Standards reviewer

An eligible non-author checks the repository's documented standards, module ownership, maintainability, unnecessary complexity and changes to gates or permissions. The reviewer verifies relevant claims against source and configuration, rather than echoing the author's summary.

### Spec reviewer

An eligible non-author checks the governing requirements and approved decisions, including changed tests, fixtures and assertions. For material runtime or UI changes, the reviewer verifies the affected real boundary using existing Native owners and approved synthetic fixtures. Documentation or tooling changes receive the relevant source and observable tooling checks; they do not receive invented product UI evidence.

Standards and Spec are distinct responsibilities and may use the repo's existing reviewer roles. A reviewer must not independently approve work they implemented. Review of source, configuration and GitHub state is read-only; when authorized, a reviewer may run checks or create isolated synthetic runtime/evidence state. Fresh context does not mean different model providers or statistical independence. Findings state their preconditions, source evidence, expected and observed behavior, consequence, and a reproducer or concrete proof. Verify and deduplicate findings; explain reasoned dismissals. Do not change code merely to silence an unverified suggestion.

### Coordinator

The coordinator assembles the one concise PR handoff, checks that results and links identify the actual candidate, and ensures attachments render in GitHub. The coordinator preserves valid evidence, refreshes affected evidence after changes and reports remaining limits. The coordinator does not turn technical verdicts into Owner acceptance or merge authorization.

## Trusted instructions and separate decisions

Use the governing issue, accepted Owner decisions, and trusted instructions from the target/base branch to assess the candidate. A change that edits this contract, `AGENTS.md`, test policy or other review instructions does not get to waive the obligations already governing itself. Compare those changes with the trusted base and flag them for independent review; apply approved changes to later work only after they land.

Technical checks and reviewer verdicts inform the Owner; they do not decide product policy, Owner acceptance, merge or release. Merge and deployment each require their own authorization. Preserve existing programme gates and historical evidence unless their authority explicitly changes them.
