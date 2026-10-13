# N07 account decisions — scoped acceptance record

This record covers the #73 account-decisions migration only. It does not accept the whole Spec #66 or close the issue. The scoped candidate is the `codex/testing-foundation-n07` worktree based on integration SHA `8b6d6131c4078654502919853f3edd792351c5c2`; the immutable implementation commit is reported in the delivery handoff.

## Case-claim disposition

All 15 original account-decision cases/claims remain represented. The foreign-actor local-operation claim adds one case; the native `beforeunload` claim is split into a desktop-only browser case while the app-owned review/modal/submit case remains mobile-critical. The four fault recipes are separate cases. No product or production behavior changed.

| Native case | Layer and retained evidence |
| --- | --- |
| Applicant reads their own Pending application without member access | `@native @http`: authenticated own application projection and denied member profile access. |
| Active ordinary member cannot review applications or read private account audit | `@native @browser @mobile-critical`: real member API denials, restricted pages, private-data non-disclosure, and keyboard exit. |
| Staff approval unlocks membership and publishes one exact durable decision | `@native @http`: pending-to-member effect, complete decision/audit rows, applicant Inbox projection, exact replay, and same-key/different-target conflict with unchanged second target. |
| Rejection shows only the HK-localized visible reason in the applicant Inbox | `@native @browser @mobile-critical`: missing-reason validation, exact receipt and coupled state, Hong Kong timestamp, private-note separation, stale and changed replay conflicts. |
| Competing approval and rejection commit exactly one decision and audit | `@native @http`, dedicated store: concurrent requests yield one commit and one conflict, with independent D1 state, receipt, and audit expectations. |
| `person_profile` trigger with `ABORT` | `@native @http`, dedicated store: app state, receipt, and audit roll back; reconciliation is unresolved; same-key retry succeeds after owned trigger removal. |
| `person_profile` trigger with `IGNORE` | Same independently asserted rollback and original-key recovery. |
| `audit_event` trigger with `ABORT` | Same independently asserted rollback and original-key recovery. |
| `audit_event` trigger with `IGNORE` | Same independently asserted rollback and original-key recovery. |
| Current Staff authority, expected actor, and target roles | `@native @http`, dedicated store: forged identity headers fail, changed expected actor conflicts, active Staff can read the queue, Staff/Admin targets fail without creating decision/audit rows, and an applicant promoted to Staff is denied when deciding their own application. Staff session comes from the shared fixture's real login and password-confirmation flow. |
| Decision receipt and read-only audit survive target deletion | `@native @browser @mobile-critical`, dedicated store: exact receipt/audit survive synthetic-user deletion, username reservation remains, reconciliation returns the original receipt, and audit detail has no mutation controls. |
| Staff reviews exact rejection/private note before one explicit final submit | `@native @browser @mobile-critical`: 501-character validation, exact payload preview, modal Back/continue preserves fields, discard clears the draft and returns to the queue, and one rebuilt review submits exactly once on Chromium, iPhone WebKit, and Pixel Chromium. |
| Staff approval reason is optional; invalid rejection keeps focus on the required public reason | `@native @browser @mobile-critical`: approval preview omits an applicant-visible reason; an empty public reason and 501-character private note show field errors, focus the public reason, and send no decision; a valid review preserves exact trimmed public/private values. |
| Staff's unsaved rejection draft blocks page unload and preserves private notes | `@native @browser`, desktop Chromium only: a real Playwright form interaction and navigation attempt trigger the native browser beforeunload prompt; dismissing it preserves visible/private fields and sends no decision POST. This records desktop Chromium behavior, not a physical-device guarantee or injected-event equivalence. |
| Committed decision with a lost response reconciles to one receipt and never reopens | `@native @browser @mobile-critical`, dedicated store: real committed D1 effects survive the aborted browser response, every reconciliation request carries the original application/key, one exact receipt/audit is durable, and reload does not resubmit. |
| Decision lost before commit remains unresolved until explicit original-key retry | `@native @browser @mobile-critical`: aborted request leaves no effects/receipt, preserves local operation through reload, and explicit same-key retry commits. |
| Foreign Staff actor's saved key remains untouched | `@native @browser @mobile-critical`, dedicated store: foreign actor operation remains in local storage, no reconcile/decision POST occurs, and target state remains pending. |

The HTTP-only project selects eight `@native @http` cases exactly once. Eight `@native @browser @mobile-critical` cases select `features-chromium`, `features-iphone-webkit` (iPhone 15 Pro/WebKit), and `features-pixel-chromium` (Pixel 7/Chromium). The separate non-mobile-critical beforeunload case selects `features-chromium` only: 33 expected executions. The suite file is `tests/e2e/account-decisions.spec.ts`; existing project selection is `playwright.features.config.ts`. Each browser presentation call uses the mandatory explicit draft and critical-action contract; focus is supplied for invalid-field qualification.

## Cleanup and retained seams

`account-decisions.spec.ts` no longer owns the legacy seed import, SQL CLI wrappers, fixed account roster, sign-in-window polling, HTTP transport headers/base URL, or per-file Staff mutation/presentation metadata. It uses the native `test`/`expect`, real confirmed Staff context, case-scoped `NativeApp` D1 binding, and native presentation helper. `tests/shared/decision-contract.test.ts` retains independent schema expectations and additionally rejects invalid operation keys and oversized/empty actors.

N07 changed no shared fixture, runner, production, or presentation implementation. The only cross-ticket worktree difference is the parent-authorized N02 sync to `tests/e2e/r11-presentation.ts`; it is intentionally excluded from the N07 commit.

The shared legacy seed/local-environment and SQL helpers remain because other unmigrated families still consume them. `staff-fixture.ts` likewise remains for clock-matrix, deletion, identity, and restrictions cases. `tests/scenarios/accounts.ts` and `limiter.ts` remain owned by N06/native access work; none is reintroduced or wrapped here. These are retained cross-ticket consumers, not N07 dependencies.

## Scoped checks and limits

Observed setup: Node `v24.21.0`, pnpm `10.33.2`; frozen/prefer-offline install succeeded.

- `pnpm build:native && pnpm build:test-provision` passed.
- `pnpm typecheck` and `pnpm test` passed; Vitest reported 11 files/56 tests.
- Final scoped Playwright command `pnpm exec playwright test --config .scratch/n07-account-decisions/playwright.config.ts` selected 33 cases with two workers: **33 passed, 0 failed, 0 skipped, retries=0** (37.9 seconds runner time). Counts: `features-http` 8/8; `features-chromium` 9/9; `features-iphone-webkit` 8/8; `features-pixel-chromium` 8/8. Output/traces are private under `.scratch/n07-account-decisions/settled-results` and `artifact://822`.
- The first 32-case run was 15 passed/17 failed (artifact `artifact://503`): multiline trigger parsing, an invalid first-Tab assumption, Node/browser locale mismatch, wrong reconciliation response shape, mobile native-dialog absence, and an overlong synthetic username. The corrected 33-case run before final fixes was 25 passed/8 failed (artifact `artifact://807`): keyboard focus on desktop/Pixel, a nonexistent Inbox navigation link, and an incidental exact-one reconciliation-count expectation.
- The terminal recovery flow observed two reconciliation POSTs as the UI refreshed; the final test verifies each request is bound to the original application/key, and independently asserts one decision POST, one durable receipt/audit, and terminal UI after reload. It does not require one read/reconciliation request.
- Native beforeunload is an explicitly desktop-Chromium-only browser claim (dismissed prompt, preserved exact draft, zero decision writes); mobile-critical review/modal Back/continue, discard/reset, focus, and one-submit claims remain selected on both phone engines. This is not a physical-device or injected-event claim. No production or shared change is part of the N07 commit. The parent-authorized N02 presentation-helper sync remains worktree-only as described above.
