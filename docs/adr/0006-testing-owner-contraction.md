# Testing owner contraction

Authority: Spec #66 and #84. Current commands are documented only in [testing.md](../testing.md). This record is the bounded migration/disposition history, not a maintained case registry or alternate implementation. All original E2E families migrated in place through N03–N15; no assertions were retired merely because a helper was removed. Source-specific acceptance records preserve each family's independent security, atomicity, recovery, privacy and presentation observations and its first failures. N19 owns final integrated qualification.

## CF01–CF14 disposition

| Historical owner | Native replacement / actual contraction | Retained minimum and reason |
| --- | --- | --- |
| CF01 per-query Wrangler SQL / second proxy | Deleted seed SQL wrappers; all family observations use application's actual native D1; candidate `tests/support/db.ts` never adopted | Native D1 statements and independent domain SQL, not a generic facade |
| CF02 shared-IP limiter scan/pacing | Deleted `tests/scenarios/limiter.ts`; case-owned identities, direct binding reads, real denial/window recovery | Real limiter waits only where expiry is the claim |
| CF03 vars/fixed port/connection-close | Deleted `local-env.ts` and old `playwright.config.ts`; ephemeral harness ingress/secrets, native contexts | Exact-origin setup; separate necessary Vite hydration lane |
| CF04 destructive test reset | All test commands use disposable native stores, not developer reset; no test caller of explicit developer reset command | Explicit developer migrate/reset commands remain separate, destructive and unauthorized by tests |
| CF05 seed-based Staff helper / duplicate setup | Deleted `staff-fixture.ts`; native account/Staff/request/context fixtures and genuine HTTP confirmation | Domain prerequisites and existing scenario-specific actions |
| CF06 copied fault guards/runtime | Removed `tests/worker/business-fault.ts`; faults traverse actual app pipeline with dedicated schema fault/restore | Real schema mutations/independent error privacy assertions |
| CF07 HTTP clock controls / copied dispatch | Native default Worker RPC and real emitted fetch; no HTTP controls/copied auth guards/inline process lifecycle | Actual effect-instance `DB.batch` barrier; native runtime has no equivalent last-moment semantic interception |
| CF08 private Better Auth verifier patch | Public password-verifier construction seam in isolated emitted credential graph; no `$context` mutation | Pause only after actual native verification succeeds, with explicit release/failure cleanup |
| CF09 production seed HTTP/reset | Deleted production route, token typings/example and both temporary empty-token overrides; canonical test-only RPC + domain writes | Genuine Better Auth creation, no cookies/Staff bootstrap exposed publicly; obsolete URL404 negative case stays |
| CF10 custom capture/provenance/gallery | Playwright screenshots/masks/attachments/reporters; gate identity once; removed optional critical-control inference | Explicit domain drafts/actions and responsive/accessibility invariants |
| CF11 file-wide engine duplication | Native `@http` once, all Chromium journeys, `@mobile-critical` phone projects | Engine-sensitive claims, not duplicated HTTP |
| CF12 hook/private runner framework | One Husky/lint-staged index gate, native Git export/bootstrap/discovery/runners | Thin source-impact policy/privacy/index drift/process-group cleanup only; not Worker lifecycle or a cached-pass service |
| CF13 pure scenarios/compile/contracts | Retained immutable accounts/activities/notices, all existing fast contracts and typed business API consumer | EFCC meaning and independent expectations; no generic factory |
| CF14 SSR/pure auth tests | Retained Node SSR/component and public allowlist tests under Vitest; `next/link` alias unchanged | Honest static/Node classification, not interactive browser claims |

Causal preservation: the38-case native matrix expands all14 historical deadline cases into expired/fresh controls and actual ABORT/IGNORE recipes (ADR0004). Existing password/assisted races, rollback, actor/target/original-key receipts, lost response, private-note/secret non-replay, durable update/recovery, auth/CSRF/cookie/history and schema-failure assertions remain in their feature families. Home uses dedicated visibility state/domain writes and teardown rather than finally resetting a shared baseline. N18 deletes owners, not those claims.

## Eight packaged candidate files

The completed independent candidate disposition rejected wholesale adoption. Its patch and manifest were removed in N18; no review was repeated and no backup implementation was installed.

| Candidate path | Final disposition |
| --- | --- |
| `docs/testing.md` | Rewritten as one current workflow; no rejected Vite/proxy/serial/offline/no-hooks/auto-full policy |
| `scripts/test-runner.ts` | Rewritten as native source/bootstrap/runner coordination; no port/vars/migration/Worker manager |
| `scripts/test-selection.ts` | Rewritten small explicit impact/risk policy, native classification and unknown fail-closed |
| `scripts/test-snapshot.ts` | Rewritten minimal Git/index/privacy seam; no working-copy copier/custom stash |
| `tests/e2e/testing-foundation.spec.ts` | Rewritten built-ingress/same-D1/canonical auth/migrations/ABORT/IGNORE/isolation/lifecycle proof |
| `tests/shared/test-foundation.test.ts` | Rewritten staged-policy/index/privacy/bootstrap/interrupt counterexamples; no silent full expectation |
| `tests/support/db.ts` | Deleted/rejected; no active second D1 owner |
| `tests/support/fixtures.ts` | Rewritten native worker/test lifetimes and case-owned contexts/accounts; no global IP counter/shared serial state |

New native files are owned by those same boundaries: native/feature/causal/dev/lifecycle Playwright configs; provisioning/default RPC Worker; native credential/batch controls; thin build adapters; native-source guard; selector and portable-build filesystem tests. `tests/types/business-api.ts` remains under TypeScript discovery, all Node/SSR paths remain under Vitest. `scripts` is explicitly typechecked. Historical deleted paths intentionally remain source-impact mappings so branch deletions classify; those strings are not compatibility owners.

## Limits and acceptance

Wrangler owns runtime ports/listen/update/close/storage/migrations; Playwright owns contexts/worker replacement/capture/reporting; Vitest/TypeScript own fast/compile checks; Turbo owns immutable build storage/restore. A test deliberately spawning the real Playwright CLI to prove failure/SIGINT cleanup is a lifecycle counterexample, not another app runtime manager. Git process-group cleanup is likewise not Worker orchestration. No custom SQL splitter, second proxy, reset transport, copied guards, private verifier patch, gallery, case scheduler, cache engine or pass cache remains.

Developer vars/state were not removed or read for contraction; Worker types were regenerated from a clean owned root. Personal/remote D1 and production were not accessed. Final source/check/type/native results and independent review are recorded by N19, not inferred from this structural disposition. No speed, second-OS or physical-device claim is made.
