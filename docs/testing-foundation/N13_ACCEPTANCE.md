# N13 / #79 — assisted issuance, recovery and one-time handover

Base: `f98d5b2e4a3786b892870937d36b89d3fc2fa0eb`. Scope: `tests/e2e/account-assisted.spec.ts`; no production change. This is a source-level claim crosswalk, not a report of native execution.

## Original case-claim disposition

The baseline assisted-account spec had 21 test declaration sites. The replacement maps the original one-time output/expiry/non-replay, recovery prerequisites, audit/revision/session effects, distinct write-fault recipes and native Username/name verifier-race claims into the native cases below. Current source expands to 40 logical cases; that source count is not an executed-case claim.

| Original claim family | Native realization and independent effect evidence |
| --- | --- |
| Missing reissue request and explicit retry | Browser UNKNOWN path preserves original actor/target/key, requires fresh identity confirmation after reload, and submits the same reissue operation once. Receipt, target and private reconciliation are checked separately. |
| Native password-verification race | The N11 public `credentialTest` control pauses genuine Username and name sign-ins across Staff recovery. Stale credentials mint no cookie/session; the replacement temporary password enters the real first-change gate. |
| Matching concurrent recovery and replay | Same actor/target/key requests race; exactly one issuance response contains the one-time secret, the other returns only the original receipt. Direct D1 checks establish one audit/receipt and the persisted expiry. |
| Actor/target/key scope | Two real confirmed Staff actors reuse operation keys across create/reset/reissue. Matching replay returns receipt-only; changed payload/target conflicts; foreign-actor reconciliation returns no receipt and cannot recover another actor's secret. |
| Sensitive-command boundary | Exact-origin denial and independent per-action limiter buckets remain; self, Staff and Admin targets are denied, stale confirmation/current authority is rechecked, and the real verified-recovery-phone exception is exercised. Public phone uniqueness remains enforced. |
| Creation write-failure permutations | Dedicated native D1 stores cover `account`, `person_profile`, and `audit_event`, each with `RAISE(ABORT)` and `RAISE(IGNORE)`: six cases. Each checks no partial canonical account/audit/receipt, UNKNOWN reconciliation, then same-key retry and exact actor/target receipt. |
| Recovery write-failure permutations | Dedicated native D1 stores cover account update, session delete, audit insert and operation-receipt insert, each with `RAISE(ABORT)` and `RAISE(IGNORE)`: eight cases. Each checks the original credential row/session/audit/receipt, UNKNOWN reconciliation, same-key retry, revision/expiry and old-session/password rejection. |
| Additional receipt rollback controls | Ignored public-application and decision receipts preserve their coupled state; an ignored own-password receipt preserves password/session; an ignored Staff receipt leaves no orphan created account, audit, credential or reservation. These controls supplement rather than replace the assisted-account fault matrix. |
| Verified recovery and temporary expiry | Actual D1 expiry values are compared with issuance results; unverified phone and caller-supplied phone are rejected. Existing native sessions and old credentials are revoked. Expired credentials require reissue, and first change preserves ban/deactivation state. |
| Original one-time issuance | Creation returns the secret only once, with actual D1 deadline; replay/reconciliation is receipt-only. Native sign-in is restricted until the actual password-change endpoint succeeds. Secret absence is checked against durable D1 fields. |
| Lost recovery response and runtime update | A real browser response is intercepted after commit and lost; local persisted state retains only the original operation reference, not the password. Native `server.update()` preserves D1 and Staff session; reload reconciles the original receipt, and replay cannot recover the secret. |
| Browser review and handover | Creation/reset/reissue reviews keep explicit final-submit, draft and focus qualification. Acknowledgement toggling, copy failure/manual text selection, local-exit storage failure, reload, and explicit reissue remain covered; a separate desktop case reads the real clipboard. |
| Lost creation response and late delivery | Lost creation response is reconciled without local/D1 plaintext, then recovered through confirmed reset/reissue and native first password change. The late-response matrix covers create/reset/reissue × hidden-before-response and return-before-response: six cases, with receipt/audit, original-key and secret non-replay checks. |
| Staff view and access presentation | Same-name permitted targets retain selected-person context across viewport changes; unavailable security context retains task/target; touch target and visible keyboard focus checks remain. |

## Case count and project scope

The current source expands to **40 logical cases** from 23 declaration sites: **26 HTTP** cases and **14 browser** cases. The 14 browser cases comprise 13 `@mobile-critical` cases and one desktop-clipboard-only case. Under the shared feature project matrix, the expected source selection is 26 `features-http` entries, 14 Chromium entries, 13 iPhone 15 Pro WebKit entries and 13 Pixel 7 Chromium entries: **66 project executions**. This is the required matrix shape, not an execution receipt.

Fault totals are explicit: 14 original assisted-account ABORT/IGNORE permutations (6 creation + 8 recovery), plus the four additional ignored-receipt controls above. No recovery test infers a deadline from the receipt or current account state; expiry is read directly from the case app's D1.

## Owner retirement and retained seams

The spec now uses the shared native `test`/`expect` fixtures and selected `caseApp`; all schema-fault cases select a dedicated `dedicatedApp`. D1 mutations/observations and real built-app ingress replace inline Worker spawn/assets/ports/health/control-HTTP/kill ownership, generic data reset, and the old SQL/context/capture transports. No mutation retry or fake time is used. The original Node `tests/shared/staff-account-contract.test.ts` remains unchanged.

Credential races reuse N11 `tests/support/credential-fixtures.ts` and `tests/worker/credential-race.ts`; Staff setup remains the genuine confirmed native Staff fixture. `qualifyPresentation` uses explicit drafts, critical action and focus arguments. Shared fixtures, package scripts and Playwright configs remain parent-owned and unchanged in this ticket.

The production receipt guard remains the existing migration invariant in `migrations/0004_assisted_accounts.sql` (`staff_account_operation_requires_complete_write`): it rejects incomplete account/profile/reservation/audit state and unreleased sessions inside the transaction. No shared receipt helper or product code was changed. Parent integration must add `tests/e2e/account-assisted.spec.ts` to `playwright.features.config.ts` `testMatch`; its `@native @http` and `@native @browser` tags select the existing projects, with `@mobile-critical` selecting both original mobile profiles.

## Qualification record

Pinned Node 24.21.0 / pnpm 10.33.2; frozen/prefer-offline install succeeded. `pnpm build:native`, `pnpm build:test-provision`, and `node scripts/build-credential-race.ts` completed successfully. The existing shared `features-http`, Chromium, iPhone 15 Pro WebKit and Pixel 7 Chromium projects were imported through an ignored, ticket-only `.scratch/n13.config.ts`; no shared config was changed.

The first full source matrix ran **66 selected / 66 executed / 46 passed / 20 failed / 0 skipped / 0 retries**. Its first-failure report remains private at `.scratch/n13-results/capture-off/results.json`. Nineteen failures occurred during synthetic prerequisite provisioning: `syntheticAccount` used invalid hyphenated or over-30-character Usernames. The remaining failure was a `429` when the reissued credential used the same client IP after earlier name-sign-in attempts; the real name-sign-in plugin enforces a three-attempt budget.

The source correction normalizes the synthetic Username prefix to allowed ASCII characters and caps it at 17 characters before adding the period and 12-character random suffix, keeping every generated Username unique and within the real 30-character contract. The post-reissue sign-in uses a separate native request context with its own synthetic client IP; the existing name-sign-in limiter remains enabled and is not cleared or bypassed. `pnpm typecheck` passed after these changes. The fresh full 66-entry qualification remains outstanding; the first failed run is preserved and does not count as acceptance.
