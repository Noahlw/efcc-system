# N10 / #76 — eligible deletion migration acceptance

This is the scoped local acceptance record for N10, not a whole-Spec #66 qualification, independent review, tracker closure, or release approval.

## Candidate and ownership

- Qualified implementation source: `f84f78554343bb0a86419f381589682d02aace12` (`test: migrate account deletion to native fixtures`), based on `8b6d6131c4078654502919853f3edd792351c5c2`.
- Primary migration: [`tests/e2e/account-deletion.spec.ts`](../../tests/e2e/account-deletion.spec.ts). The previous inventory records the original family as 886 lines with 23 `queryLocalSql` and 16 `runLocalSql` call sites; the preserved historical claim disposition is in [`CANDIDATE_DISPOSITION.md`](CANDIDATE_DISPOSITION.md).
- Fast contract expectations remain in [`tests/shared/deletion-contract.test.ts`](../../tests/shared/deletion-contract.test.ts) and still exercise the production deletion schemas.
- The suite uses `tests/support/fixtures.ts` (`caseApp`, `account`, `signedInRequest`, genuine `staff` login and password confirmation) and directly observes/writes the app's own D1 binding. The approved-member prerequisite is feature-specific: it applies through the actual application and Staff decision endpoints, then signs in through real auth ingress. Fault, concurrency, last-Admin, and browser reconciliation cases select `dedicatedApp`; no scenario resets its store.
- N10 removes the deletion spec's reliance on the legacy per-query SQL/seed, shared Staff/auth context and pacing setup, inline lifecycle, and custom capture ownership. Current imports are native Playwright fixtures, actual D1-backed account provisioning, deletion contracts, and the shared explicit presentation helper. Other suites still consume legacy helpers, so this ticket intentionally does not delete their shared owners.
- Retained narrow seams: direct D1 setup/independent effect assertions and six-table SQLite triggers establish controlled business state and ABORT/IGNORE causes against the real store; the browser's `route.fetch()` executes the real deletion request before aborting its response to reproduce a lost response. `qualifyPresentation` receives explicit draft, focus, and critical-action locators. None is a second DB/runtime owner or generic reset.

## Original-claim disposition

| Required claim | Native evidence retained |
| --- | --- |
| Eligible deletion, real credential/session revocation, durable history and permanent Username claims | `eligible deletion removes credentials and sessions...` creates and approves a synthetic applicant through real endpoints, submits `POST /api/v2/staff/accounts/delete`, observes removal from `user`, `account`, `session` and `person_profile`, verifies the old session and credential cannot authenticate, and independently checks the application decision, security operation, audit, original operation receipt, canonical Username plus alias reservations, and reapplication conflict. |
| Participation, assignment, invitation and retained history block eligibility without half-delete | Four separate cases insert withdrawn `enrolment`, revoked `invitation`, `department_membership`, or `department_manager_assignment`; each observes the live endpoint's history denial, the retained row and account, no deletion audit, blocked direct cascade, and a successful deactivation of the still-active target. The browser history-denial case independently keeps the account active and offers deactivation. |
| Every distinct fault recipe, rollback and retry | Twelve dedicated-store cases cover `ABORT` and `IGNORE` for `user`, `account`, `session`, `person_profile`, `audit_event`, and `account_change_operation`. Each injects the original delete or `account_deleted` insert fault through a trigger, requires the live endpoint failure, verifies all core rows survive and neither audit nor receipt was partially written, removes the trigger, and retries the same actor/target/key to prove the real deletion completes exactly once and revokes the old session. |
| Self/protected targets and current authority | One live-endpoint case denies self-deletion, an Admin target, expired password proof, and an actor whose Staff role has been revoked; the target remains present. |
| Last-effective-Admin authority and concurrent attempts | A dedicated store begins with two Admins and no target session, verifies durable schema guards reject loss of the last effective Admin, restores the second Admin, then races opposing deletions. The independent result keeps exactly one effective Admin and records one deletion. |
| Actor/target/key binding, concurrent matching retry and original receipt | A dedicated-store pair of concurrent matching requests returns the same receipt with one audit and one durable operation. Reusing that key for a different target conflicts; a different signed-in actor cannot see the original actor's private receipt. |
| UNKNOWN, response loss, target disappearance and reconciliation | The browser case keeps acknowledgement/focus through an aborted initial request and failed reconciliation, retries with the saved original key, then lets the real request delete the target while suppressing its response. It verifies the target is gone, the durable receipt reconciles to the original operation, the page reload retains confirmed state, and the audit remains navigable. |
| Explicit review, acknowledgement, password confirmation and final Submit | Browser cases retain a separate review acknowledgement and explicit final action; the password-protected case proves confirmation returns to review without submitting, then requires the distinct final Submit. Draft, focus, overflow and critical-action assertions run via the required explicit presentation contract. |
| Deferred auth routes and deletion-specific resilience | HTTP cases keep deferred auth endpoints closed for removed/replacement accounts, exercise foreign-Origin and real D1 limiter denial, and prove deletion revokes an issued temporary credential without removing recovery audit history. |
| Fast Node deletion contracts | Seven Vitest expectations preserve normalization, strict actor/target/key metadata, forbidden persisted password, request binding/extra-field rejection, explicit acknowledgement, valid/not-found receipt decoding, and invalid receipt rejection. |

## Scoped qualification

Runtime was macOS 25.6.0 arm64, Node `24.21.0`, pnpm `10.33.2`, Playwright `1.63.0`, Wrangler `4.145.0`, Vitest `5.0.3`, and Vite `8.3.2`.

On the qualified implementation SHA above:

- `pnpm typecheck` passed.
- `pnpm exec vitest run tests/shared/deletion-contract.test.ts` passed: 1 file, 7 tests.
- `pnpm build:native` and `pnpm build:test-provision` (Wrangler dry-run only) passed. Vite emitted its non-blocking ineffective-dynamic-import warnings; both builds completed.
- The temporary ignored `.scratch/n10-qualification.config.ts` imported the parent-owned `playwright.features.config.ts` project matrix and selected only `account-deletion.spec.ts`; retries were explicitly zero. It did not alter shared Playwright configuration.
- Capture-off: 26 unique cases, 32 executions — `features-http` 23, `features-chromium` 3, `features-iphone-webkit` 3, `features-pixel-chromium` 3. All 32 passed; zero failures, skips, flaky cases or retries; zero PNG attachments.
- Capture-on: the same 26 cases and project counts, all 32 passed; zero failures, skips, flaky cases or retries; 162 native PNG attachments.
- Full private Playwright JSON and reports remain in ignored worktree output `.scratch/n10-qualification/capture-off/` and `.scratch/n10-qualification/capture-on/`; no raw report, trace, auth state, or database is included in this record.

## Integration boundary

`account-deletion.spec.ts` carries inherited `@native @deletion`; every case is exactly one of `@http` or `@browser`. The three browser cases also carry `@mobile-critical`. Risk tags used are `@risk-atomicity`, `@risk-authorization`, `@risk-concurrency`, `@risk-privacy`, `@risk-recovery`, `@risk-resilience`, and `@risk-security`.

The shared feature config currently discovers only the N02 qualification spec. Parent-owned integration must add `account-deletion.spec.ts` to its `testMatch`; this ticket did not edit shared fixtures, package scripts, or Playwright configs. This scoped pass does not claim the remaining feature families or the final #85 qualification/review.
