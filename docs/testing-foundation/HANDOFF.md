# EFCC testing foundation — implementation checkpoint

## Goal and authority

Continue the complete approved testing-foundation Spec #66 and tickets #67–#85 on existing draft PR #47; do not narrow this to a pilot.

- Repository: https://github.com/Noahlw/efcc-system
- Integration branch: `codex/tanstack-query-foundation`
- Existing PR: https://github.com/Noahlw/efcc-system/pull/47
- Spec: https://github.com/Noahlw/efcc-system/issues/66
- Read `docs/testing-foundation/IMPLEMENTATION_PROMPT.md` in full, `README.md`, `ticket-index.md`, `coverage.md`, live issues/comments/native dependencies, repo instructions and domain docs. Those files and live tickets carry the full acceptance contract; this checkpoint is not a replacement spec.
- Session integration base: `d897393d86a070960bfb3f91339262a30279449a`, refreshed from origin by fast-forward from `ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf`. Refresh current remote state; do not reset to these historical SHAs.

## Latest user request and publication scope

The user paused implementation to move to another machine and explicitly requested the handoff location/prompt and all safe local changes online. Publish safe source and sanitized review/checkpoint records on existing branches. Do not merge the PR, deploy, force-push, close issues or publish secrets, auth/session state, member records, D1/SQLite stores or raw private traces.

## Status: checkpoint, not completion

No implementation ticket is independently accepted or closed. #67/N01 was in progress; #68–#85 have not started. The N01 checkpoint uses branch `codex/testing-foundation-n01`; recovered source is being preserved for continuation, not certified as complete. Do not infer full-suite qualification from a successful foundation smoke run.

A host/runtime transition removed the agent-owned `/tmp/efcc-testing-foundation-n01`, `/tmp/efcc-testing-foundation-baseline` and `/tmp/efcc-testing-foundation-authority` directories before N01 was committed. Git branch/worktree metadata survived but the files did not. Source recovery uses retained agent tool-call history, into a persistent worktree. The source commit and the accompanying checkpoint verification record are the portable evidence; old `/tmp` paths and OMP artifact/history URIs are NOT cross-machine dependencies. Any unrecovered artifact must be explicitly recorded as unavailable, never regenerated and labelled original evidence.

Read `docs/testing-foundation/N01_CHECKPOINT.md` for the exact recovery inventory, source SHA, current-machine checks and remaining gaps once published. Read `docs/testing-foundation/CANDIDATE_DISPOSITION.md` for the already-completed independent candidate review.

## Work already performed

- Read Spec #66 and every ticket #67–#85, comments and native dependencies. At the recorded snapshot all were OPEN with zero comments; refresh live state.
- Read PR #47: OPEN/draft, head `d897393…`, base main, zero comments/reviews at the recorded snapshot.
- Baseline production build and typecheck passed under Node 24.21.0; fast Vitest passed 11 files/56 tests. These are historical baseline results, not qualification of recovered/new source.
- Baseline local check and GitHub run `38386960284` failed formatting only in `docs/testing-foundation/SOURCE_OF_TRUTH.md`. Preserve the failure record; repair formatting rather than waive it. Historical run: https://github.com/Noahlw/efcc-system/actions/runs/38386960284
- Baseline native Playwright discovery: 389 entries = 309 Chromium + 40 review-webkit + 40 review-chromium across 20 families, zero discovery errors. `--list` is discovery, never execution. The temporary JSON inventory was lost at host transition; recollect from the pinned baseline if needed for migration crosswalk.
- Candidate patch was NEVER applied. Independent review covered all 9,523 physical patch lines, 30 tracked changes and eight new files. Verdict: not adoptable wholesale; runtime Acceptance unverified. Review report is retained online; evidence-only reconstructed source directories were temporary and are now unavailable.

## N01 historical verification — not current recovered-source proof

NativeFoundation reported 7/7 single-worker V1–V4 proof: actual browser UI login/RSC/logout, genuine cookies/CSRF, actual app D1, original migrations, fault/interrupt teardown and replacement.

The first expanded two-worker run passed 6/8; nested lifecycle fault-child runner setups timed out before readiness. Do not relabel that run green. The fix separated lifecycle subprocess probes into a native `workers:1` project dependent on the ordinary two-worker native project, without raising timeouts or weakening assertions.

A subsequent historical `pnpm test:native` run in retained OMP artifact 62 was observed to end **8 passed (2.0m)** and total command wall time 167.35 seconds, including built-app session-trigger rollback and separate assertion-failure/interrupt listener and replacement-storage probes. This artifact is host-local, not an online qualification artifact. A later enhanced actual Playwright worker-replacement assertion check was pending when the host changed; its outcome is not established. The restored source therefore needs its own verification; read N01_CHECKPOINT rather than assume historical passes match the restored bytes.

## Native contract to inspect, not guess

Recovered `tests/support/fixtures.ts` is expected to expose `NativeApp`, `openApp()` and extended native fixtures: worker-owned `app`, case-owned `dedicatedApp`/`account`/`signedInRequest`/`staff`, native origin/baseURL/headers. Inspect the actual published signatures before using them.

Test-only default-export RPC creates genuine Better Auth credentials plus canonical EFCC prerequisites; app binding is the sole D1 owner. Normal auth setup must remain production HTTP login with in-memory native storageState. `staff` must use real HTTP password confirmation. No second getPlatformProxy owner, fake cookie/hash, persisted session or shared roster. N01 did not claim production seam changes.

## Independent candidate disposition

Do not redo the completed source review or wholesale apply the patch. Use the published report as claim-preservation input. Seven blockers:

1. Second D1 owner/generic SQL facade: delete, use actual app binding.
2. Process-global limiter identity misobserves manually chosen request buckets: case-owned actual identities; retire ordinary pacing.
3. Snapshot privacy blacklist misses auth/session JSON, SQLite and raw artifacts outside named directories: complete policy with synthetic counterexamples.
4. Unknown/shared automatic full-selection and docs-prefix executable exemptions; missing required commands/classification/nonempty discovery; wrong resilience/mobile semantics: fail closed or explicit full and required native tags/projects.
5. Forced offline/ignore-scripts bootstrap: use `--frozen-lockfile --prefer-offline` and real required install scripts.
6. Legacy seed/reset/shared state, per-query CLI, inline subprocesses/control HTTP/copied guards/private verifier patches survive: migrate all consumers and actually delete obsolete owners.
7. Custom PNG/JSON/hash/gallery, implicit critical action, Vite default and absent immutable cache: native captures/attachments/reporters, explicit draft/action contract and mature build reuse with real parity proof.

Remove packaged `review-material/local-candidate.patch` and `candidate-manifest.json` in the N18 contraction after disposition. They remain unaccepted review material until then; no backup implementation should survive the final cutover.

## Next dependency frontier

1. Finish and independently accept #67 using the recovered source, native actual ingress/isolation/lifecycle proof and explicit first-failure record. Integrate current integration tip into ticket branch before declaring completion.
2. After #67 acceptance, implement #68 presentation/native reporting and #78 deadlines/batch controls as independent ticket branches/worktrees.
3. After #68's stable contract, migrate #69–#77, #80 and #81 according to native dependencies and file ownership; #79 follows #77. Preserve every independent assertion, special fault permutation, negative Origin/no-CF-header input, ABORT/IGNORE, real deadline positive/negative control, actual verifier-instance barrier, restart durability and original-key recovery.
4. Then #82 staged-tree gates/slim CI → #83 immutable build/compiled-test invalidation → #84 full retirement/docs/types → #85 exact-final-candidate clean qualification and fresh independent review.
5. Existing PR47 stays draft; no merge/deploy. Required tests must really execute each time; cached builds are not cached passes. Do not combine partial runs from different SHAs into a final green result.

## Safety and platform constraints

Use pnpm 10.33.2 and pinned Node 24.21.0; provision afresh on the new machine. Historical Node binary paths, ports and running processes are not portable. Context7 documented Wrangler createTestHarness/getEnv/applyD1Migrations/default-export RPC and Playwright fixture lifetimes; API docs alone do not prove EFCC compatibility.

Earlier interactive destructive approval was specifically limited to this session's owned disposable synthetic harness/worktrees: CREATE/DROP fault triggers, schema alter/rename/drop+restore, synthetic business deletion, credential/session revocation, runtime reset/update/failure-interrupt/teardown. It does not authorize personal `.wrangler`, remote D1 or production actions. New-machine destructive runs require a new scoped approval; do not treat this document as interactive consent. Legacy `pnpm test:e2e` starts with personal local DB reset: do not run it blindly.

No speed SLA, multiplier, dual-OS benchmark or full-platform gate is required. Report only the observed platform. Preserve accepted UI/business/security behavior and Design Book; production construction seams only where evidence requires a minimal change.

Use the actual loaded remote OMP instructions/profiles/models/tools; do not copy credentials/config or infer unavailable capabilities. Main conversation Cantonese, technical terms English. Independent review is not implementation-owner acceptance.

## Suggested skills

- `codex/implement-spec`: full dependency-ordered ticket implementation and integration workflow.
- `using-git-worktrees`: owned ticket branches/worktrees and preserving unrelated work.
- `ponytail`: minimum complete native-first cutover, no speculative frameworks.
- `workers-best-practices`, `wrangler`, `durable-objects` as relevant to native runtime/lifecycle boundaries.
- `better-auth-best-practices` and `better-auth-security-best-practices` before auth construction/verifier work.
- `codebase-memory`: graph-first structural discovery with path coverage and honest source fallback.
- `ultracite`: repository formatting/lint workflow.
- `code-review`: independent Standards/Spec axes and explicitly separate exercised Acceptance.
- `impeccable` / `web-design-guidelines` for actual UI/presentation changes.
