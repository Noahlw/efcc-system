# Smart test-gate execution plan

Status: ready for implementation planning handoff; implementation not started. Authority: confirmed understanding revision 1 in [test-gate-advisory.md](../testing-foundation/test-gate-advisory.md). The Owner confirmed the final gate matrix after grilling on 2026-10-28. Planning readiness is not a passing test result, permission to merge or approval to start execution without the user's implementation invocation.

## Context and authority

### Outcome

An ordinary commit validates the exact staged source with formatting, lint, runtime boundaries, complete project typecheck and affected genuinely fast contracts, without launching full coverage, expensive gate-integration tests, production/native builds, application Native or mutation. Development has an explicit source-bound affected path for early risk-specific runtime checks. Ready/pre-merge still requires complete applicable source/base-current qualification. #206 exposes privacy-safe live progress and timing through the existing runner, not a new runner or acceptance owner.

### Confirmed constraints

- Keep every-commit `check` and `typecheck`, including `wrangler types`; do not replace project checking with filename-based tsc invocation.
- Preserve partial staging, native lint-staged backup/restoration, exact index export, authoritative snapshot policy/dependencies, drift detection, privacy, fail-closed source classification and owned process cleanup.
- Retain all existing meaningful tests/assertions and required qualification. Do not lower coverage requirements, shorten genuine timeout probes, remove mobile engines, permit qualification retries/skips or narrow semantic selection to get a green gate.
- CI remains light but retains its complete existing Node suite coverage, including tooling integration tests. No application Native/build/base replay/mutation is added to CI.
- Retain the applicable advisory base coverage comparison at qualification, after required Native feedback. Preserve compatibility/incomparability and cleanup semantics. It is not opt-in in this plan.
- Mutation retains existing source/direct-contract/config/toolchain/full-policy applicability and informational score semantics. Move execution phase only; do not broaden or cancel it.
- Progress is informational: public/OMP output contains only safe stages, known projects, counters, elapsed time and outcomes. Detailed test identity/duration remains private.
- Local readiness can fail closed; it cannot prevent direct GitHub UI actions. Author/reviewer responsibility remains explicit. No signing service, hosted Native workflow or ruleset change.
- One integration owner. Research may use the hard agent's design advice, but the coordinator's confirmed recommendations supersede its fast-only-CI and opt-in-base suggestions.

### Reconciled authority

The confirmed Owner amendment replaces the execution-placement portion of #66 Implementation Decision 18 and #182 Deliverable 20. It does not waive their snapshot/privacy/selection/cleanup guarantees. #182's light CI, current evidence, applicable base comparison and bounded pilot obligations remain. #206 explicitly excludes gate redesign: assess its progress acceptance separately, and attribute phase changes to the confirmed amendment, not to #206. Closed historical issues and old failed/interrupted runs are not rewritten as new passes.

### Repository basis and preservation

Effective repository: `Noahlw/efcc-system`. Create the implementation feature worktree from refreshed `main`, not from `feat/roles-integration` or either S3 branch. Local main observed during research was `af89e994e52ee62183210e0988c2b57cd4dc35b4`; refresh mutable facts at execution.

Preserve without resetting, stashing, committing or silently incorporating:

- `/Users/noah.wong/orca/efcc-system/s3-integration`, branch `feat/s3-194-stacked`: staged #195 work and unrelated `.serena/`.
- `/private/tmp/efcc-s3-195`, branch `feat/s3-195-person-workspace`: separately reviewed but uncommitted feature work; last recorded tree `bfbac5af9c2e04ab050f555bbe51f6a72ec83e60`. This is not current full qualification.
- `/private/tmp/efcc-test-gate-workflow`, branch `chore/separate-commit-qualification`: research/plan plus staged generic prerequisite fixes, currently based on #191. It is not a main-targeted implementation base.
- `/private/tmp/efcc-test-progress-206`, branch `feat/test-progress-206`: previously created checkout; inspect actual state before reuse, do not assume a delivered implementation.

PR #191 is Draft, targets main and had head `1907979fb689e120a50c629ef14f0570c0f20749` at inspection. Its runner/selector/config changes are not all generic: do not transplant its runner into the tooling PR. Prototype/handoff branches remain reference only.

Verified generic prerequisites exist in the staged tooling checkout: compiler-original filename resolution in `scripts/runtime-boundaries.ts`; physical/logical coverage path inventory handling in `scripts/test-runner.ts`; coverage-inventory regressions in `tests/shared/tooling/coverage-report.test.ts`; process-dispatch assertion context in `process-lifecycle.test.ts`. Review their applicability against main and include only the root-cause fixes required by this tooling delivery, without role code. Existing failed-before/passing-after evidence is diagnostic, not qualification of the eventual main-based candidate.

## Ordered changes

### 1. Establish main-based implementation and measurement boundary

Read live #206/comments and repo testing/delivery instructions; use the confirmed amendment for workflow authority. Record the issue/progress association before PR delivery without falsely closing #194 or broadening #206's original non-goals. Do not publish a new spec/ticket merely to restate this plan.

Create the clean main-based feature worktree using the approved worktree workflow. Copy this confirmed brief/plan into the same canonical relative paths if needed. Inspect main's actual runner, selector, hook and tests; current research-checkout line numbers are not interchangeable with main.

Record source/base/toolchain and a reproducible synthetic ordinary-commit scenario before edits. Measure actual stage/scope and wall time, separating warm store/native cache hit from cold setup. Historical #182 39m03s and earlier #195 timings are context only. Do not rerun an already reported failure just to reconfirm it. Do not fabricate an unmeasured whole-gate baseline or speed target.

### 2. Separate fast contracts from expensive Node integration

Entrypoints: `vitest.config.ts`, `vitest.coverage.config.ts`, `tests/shared/tooling/fixtures.ts`, `tests/shared/tooling/{snapshot-gate,native-selection,process-lifecycle}.test.ts` where present on main, and existing pure tooling/product/SSR tests.

Use the installed Vitest configuration/project conventions, reusing existing aliases and coverage merge pattern. Classify by actual work: pure contracts/SSR/small policy tests are fast; real nested bootstrap/discovery/listener/timeout/interrupt probes are integration. Mixed files may be split only where needed for truthful execution ownership. Do not exclude the entire tooling directory or duplicate cases across projects.

Keep `pnpm test`/full candidate coverage capable of executing the complete retained Node suite. Commit dispatch selects only the fast class. Fast affected selection must include changed tests and trustworthy consumers; configuration/computed-import/subprocess uncertainty falls back to the complete fast class. An empty related result never silently permits an unverified production change. Unknown source mapping remains blocking under existing explicit-full/mapping rules.

Use existing Vitest selection facilities where they fit; do not build another general dependency graph or permanent case registry. The full coverage inventory stays all executable src TS/TSX, including unimported modules, not changed-files-only coverage.

### 3. Separate commit, development and delivery execution inside the existing runner

Entrypoints: `.husky/pre-commit`, `.lintstagedrc.json`, `package.json`, `scripts/test-runner.ts`, `scripts/test-selection.ts`, `scripts/test-snapshot.ts` and their existing callers/tests.

- Keep a single native Husky/lint-staged path. Successful formatting must be followed by validation of the resulting authoritative staged tree.
- Commit phase: snapshot/privacy/source classification, native staged formatting/lint, complete `check`, complete `typecheck`, affected fast contracts without coverage, final index-drift check and confirmed cleanup. It must not enter full Native discovery, expensive integration class, coverage/base replay, mutation or builds.
- Preserve source-impact selection as qualification intent even when the current phase does not execute those expensive stages. Full-selection intent must not silently turn an ordinary commit into full execution or become a fast-only delivery exemption. Update documented `staged --full` behavior/callers coherently if needed; explicit full qualification remains available through the existing qualification path.
- Development affected path remains explicit and source-bound. Preserve existing conservative risk/mobile selection and an early path to relevant Native scenarios, with fresh authoritative dependencies/builds where required. No new application runtime or parallel runner. Keep direct diagnostics clearly distinct from formal candidate evidence.
- Delivery phase: one candidate Node-coverage execution including all retained integration tests, applicable production/native builds, required discovery/execution matrix and scoped mutation. Preserve all required checks under existing source policy and governing spec; explicit full/toolchain/full-spec scopes remain complete.
- Decouple candidate coverage report validation/publication from the base replay call, so required Native feedback can happen before the applicable advisory comparison. Final qualification still completes the comparison attempt and cleanup. Preserve incomparable behavior, do not invent a delta, and do not run a second ordinary candidate unit suite alongside coverage.
- Measure double snapshot/bootstrap and repeated collectors. Only reduce proven repeated work while maintaining exact staged dependency/policy authority; avoid a speculative dependency-reuse subsystem. Keep production and native builds distinct.

Adapt existing staged-dispatch regressions to the new phase contract. Retain real fidelity/privacy/cleanup counterexamples at the proper phase; do not re-pin tests that merely assert incidental output wording.

### 4. Make exact-candidate qualification and local readiness verifiable

Entrypoint: the existing runner and private evidence/report owners. Keep existing commands; add any needed verification option/mode within that coordinator rather than another driver.

Bind qualification to the exported source tree, actual current target-base identity, merge-base where used for selection/comparison, required selection/scope and pinned toolchain. `qualify` must support the actual PR base instead of silently assuming origin/main; preserve affected/CI provenance semantics. Record an uncommitted tested tree honestly with `tested: null`; a later commit with an identical tree does not retroactively become the executed commit.

Produce a minimal private terminal qualification summary only after all required stages, discovery/execution checks, index checks where applicable, owned process cleanup and snapshot disposal succeed. Keep final JSON reports authoritative for selected/executed identity, engines, first attempt, skips/retries and errors. Progress cannot satisfy these fields. A summary must not be marked complete before outer cleanup succeeds.

The local read-only readiness check recomputes current tree/base/required scope and validates required receipts, not just a saved success string. Missing reports, failed/cancelled/timed-out attempts, incomplete stages, mismatched source/base/selection, unavailable required engines or unconfirmed cleanup reject readiness. A base tip change must invalidate evidence even if a previous merge-base has not moved. No automatic reuse/fallback to an older pass after a failed current attempt; preserve first-failure history.

This is a local evidence validator, not remote attestation or a pass-cache service. A malicious author editing both code and receipts is outside that trust boundary; independent review and GitHub's separate light checks remain required.

### 5. Implement #206 safe timing/progress through native reporters

Entrypoints: runner command/stage lifecycle, `vitest.config.ts`/coverage merge, `playwright.{native,features,causal,dev}.config.ts`, and the smallest new reporter/progress owner beside existing tooling. Use installed Vitest 5.0.3 and Playwright 1.63.0 structured lifecycle APIs; verify exact APIs against pinned versions before implementation.

A bounded private structured channel may carry allowlisted cumulative counters from child reporters to the parent. Keep test titles/IDs/paths, raw output, stack traces, payloads, SQL binds and secrets out of that channel/output. Deduplicate attempts inside reporter memory as needed without emitting identity. Validate every event, known stage/project, safe integer range, monotonicity and bounded size.

Emit append-only single lines immediately at stage/terminal transitions and rate-limited updates/heartbeats while running, without TTY or carriage-return rewriting. Show elapsed wall time for setup, formatting, checks, units/coverage, builds, discovery, selected Native lanes, scoped mutation, advisory comparison and cleanup. Completed counts cases, not assertions/files/attempts/passes; failures are separate. Use actual selected project-by-case Native totals. Omit a unit denominator unless trustworthy. Do not sum parallel case durations as gate wall time or fabricate ETA.

Missing/malformed progress must disclose unavailable/stale progress, never fabricate success or override the real child/report outcome. Playwright reporter exceptions can be swallowed by the library: explicitly account for reporter health, and keep existing exit codes and final-report validation decisive. Preserve zero-retry/skip policy and owned-group cancellation/cleanup.

### 6. Update current contracts and obtain independent acceptance

Entrypoints: `docs/testing.md`, `docs/ci-security.md`, `docs/agents/pull-request-contract.md`, command documentation and CI configuration only where needed for truthful progress/semantics. Keep `.github/workflows/checks.yml`'s existing complete Node coverage and security boundaries. Do not claim new GitHub merge protection.

Document phase/command meanings, fast-versus-integration test classification, early risk checks, final evidence validity, automatic applicable base comparison, unchanged mutation scope, safe progress observation and actual limitations. Reconcile all existing callers and policy tests. Do not add a competing glossary of EFCC business terms or a speculative ADR.

Freeze the actual main-based tooling candidate, run complete applicable qualification and source-affine light CI when PR execution is authorized, and obtain distinct independent Standards and Spec reviews. Compare gate/contract changes against the trusted base and the confirmed Owner amendment; the candidate cannot waive its own acceptance. Fix material findings and refresh affected evidence. Publish only sanitized scope/timing/receipts, preserving failed/interrupted history.

## Verification

Use existing Vitest/Playwright/tooling owners and synthetic disposable resources. Prefer one regression per plausible false-green boundary rather than duplicated implementation tests. Focused tests are not a substitute for actual hook/runner execution.

| Requirement | Input/action | Observable expected result and boundary |
| --- | --- | --- |
| Ordinary commit is bounded by the fast phase | Same synthetic staged source before/after; real ordinary git commit through Husky, non-TTY | Format/lint/check/project typecheck and selected fast contracts execute. No candidate/base coverage, integration probes, Native collection/runtime, builds or mutation are dispatched. Record scope and actual elapsed time, not just a mocked call trace. |
| Fast failures still block | Staged formatting/lint/type error or failing fast contract, with any unstaged repair separate | Real commit exits nonzero; invalid staged code is not saved. Include actual project typechecking and runtime-boundary failure, not per-file tsc. |
| Partial staging/index authority | Staged-red/unstaged-green, formatter partial hunk and concurrent index mutation | Existing restoration/fidelity behavior preserved; drift blocks; unrelated dirty files remain unchanged. |
| Selection is not a silent exemption | Config/subprocess consumer, renamed/deleted path, unknown path and zero related matches | Conservative fast fallback or explicit mapping/full-policy failure as appropriate; no empty-import-graph pass and no missing final Native intent. |
| Retained suite/CI meaning | Complete Node coverage through existing CI dispatch and qualification | Every retained Node class executes once per measurement, all src inventory represented, no ordinary-plus-coverage duplicate, no new product Native in light CI. |
| Required final scope preserved | Actual main-based qualified candidate with selected/full matrix as policy/spec requires | Required builds/Node/Native/mobile/causal/dev/presentation and scoped mutation complete; selected equals executed, zero skip/retry, first attempt and errors validated. |
| Base comparison preserved but later | Comparable base and incompatible-base counterexamples | Required Native feedback occurs before comparison; applicable base attempt still runs, truthful comparable/incomparable receipt, cleanup failure blocking. |
| Invalid evidence cannot imply readiness | Missing/failed/interrupted/incomplete receipt; modify source, required selection or target-base tip after a pass | Existing runner's local readiness verification exits nonzero; no old success fallback, no progress-based acceptance. Same-source staged receipt remains honestly tree-bound. |
| Safe live progress | Actual unit and Native stage under CI=true/non-TTY; zero-completion interval; parallel cases | Stage/project elapsed/counters/heartbeat visible, reliable denominators only; completion is not pass, no raw identities or output. |
| Progress failure/privacy | Synthetic secret-like output/events, malformed/oversized/decreasing events, reporter failure and child error | No new secret/identity leakage, no fabricated counts/success; authoritative failure and final-report checks preserved. |
| Interruption/cleanup | Interrupt an owned disposable real gate invocation and exercise existing timeout/listener cases | Non-pass terminal status, no continued dependent stages, group absence confirmed, source disposed and failure retained. |
| Performance claim is real | Comparable source/host/pinned toolchain; separately identify warm/cold setup/cache state | Report commit wall time, first useful failure latency and full qualification wall time separately, with stage breakdown. No historical-source ratio or promised SLA. |

Known observed evidence is in the confirmed brief. No current full main-based baseline or optimized run exists at planning time. Node 24.21.0/pnpm 10.33.2, locked dependencies and installed required browsers are prerequisites; verify against refreshed main. Do not modify developer vars/state or invoke developer DB reset/migration commands for tests. Any interrupted or failed run remains non-passing.

## Implementation handoff

Invoke `implement` on `docs/plans/2026-10-28-test-gate-optimization.md` in `Noahlw/efcc-system`. Authority is confirmed understanding revision 1 at `docs/testing-foundation/test-gate-advisory.md`, including the Owner's every-commit project typecheck correction and final confirmation. Implement the single main-targeted tooling change described above; preserve all S3/PR191 work and unrelated dirty files. First action: inspect refreshed main and create its isolated implementation worktree, not rebase or reset the existing feature checkouts.

The saved planning artifacts currently live under `/private/tmp/efcc-test-gate-workflow/`; that checkout is based on #191 and is not the implementation base. Use the exact saved files as pointers when transferring the handoff to a main-based workspace. This is one tooling delivery with an integration owner, not a new ticket graph or a continuation of #194.

Prepare a reviewed PR against main when implementation is invoked; do not merge it. After an authorized merge is actually observed, refresh main, then obtain the necessary history-rewrite/push authority before rebasing/publishing PR191. Requalify rebased PR191 and update its actual source/base evidence; do not relabel old Native/CI receipts. Only then rebase/re-evaluate the preserved #194 work onto rebased191 and resume its task graph. Do not treat this tooling PR or #206 as completion of #194.

No merge/deploy/remote-data operation, force-push, global tool configuration change or hook bypass is authorized. Return actual changed artifacts, exercised checks, timing/scope and limits; a ready plan alone is not implementation proof.
