# N08 account identity — scoped acceptance record

This is the ticket-scoped disposition for #74. It records the exact N08 source and qualification; it is not acceptance of all of Spec #66, PR #47, or the wider native-feature gate.

## Candidate and source identity

- Worktree/branch: `/Users/noah.wong/.codex/worktrees/efcc-native-n08`, `codex/testing-foundation-n08`.
- N08 code candidate qualified: `ed7e80a5b6873c21ef9c98a8e8cc44590eca0c44` (`test: use valid application operation key`). Preceding N08 implementation/correction commits: `351d064`, `024bdb8`, `5db4d82`.
- Final run `EFCC_TEST_SOURCE`: `ticket74-n08-ed7e80a-helper-d64c1d8`. The Playwright result records this under `config.metadata.source`; `config.metadata.actualWorkers` is `2`.
- The final tested composition included the parent-authorized `tests/e2e/r11-presentation.ts` source synchronized exactly from `d64c1d8`. That shared helper is not in the N08 commits: the integration parent already has the same helper. The helper source identity is recorded separately from the N08 candidate SHA so the evidence does not imply it was authored or committed by N08.
- The temporary `.scratch/n08-playwright.config.ts` imported the shared native Playwright config/projects and narrowed `testMatch` to `account-identity.spec.ts` for this ticket-only matrix. It was removed after the run; it is neither a permanent test-selection policy nor an integration source gate.
- Separately, Main reported the integration `nativefeatures/excludedlegacy` family selection at source `96cf597` and successful type/check. That parent-owned integration gate is distinct from this ticket's temporary single-spec selection and 49-execution result; this record does not claim to have run it.

## Case and assertion disposition

All 33 logical cases are retained in `tests/e2e/account-identity.spec.ts`; parameterized fault cases account for the larger execution count. HTTP cases use native request fixtures and production ingress. Independent `caseApp` D1 queries verify persisted effects, audit/operation rows, reservations, sessions and receipts rather than deriving expectations from production helpers.

| Cases | Layer and retained claims |
| --- | --- |
| Actor spoofing | 1 HTTP case: forged actor headers across the reconciliation routes cannot mutate/reconcile another account; actor binding, target privacy and own-phone receipt remain asserted. |
| Own phone and canonical identity | 1 HTTP case: holder changes only their own unique phone; Staff correction preserves canonical Chinese identity, permanent Username reservation/alias, independent audit and receipt. |
| Former Username | 1 HTTP case: old Username remains permanently unavailable (including the explicit application-create 409); corrected Username sign-in is case-insensitive. The create request uses a valid 64-hex operation key. |
| Shared phone | 1 dedicated HTTP case: Staff's shared-phone exception is audited, but the edited value does not become verified recovery proof. |
| Staff identity rollback | 10 dedicated HTTP cases: `ABORT` and `IGNORE` against `user`, `person_profile`, `username_reservation`, `audit_event`, and `account_change_operation`; each checks no partial identity/audit effect and matching-key recovery. |
| Idempotency and conflict | 1 dedicated HTTP case: competing identity claims and same-operation replay retain one authoritative effect; key conflict, reconciliation and alias/receipt evidence remain asserted. |
| Staff policy | 1 HTTP case: fixed targets, stale confirmation, current authority and pre-existing verified-phone policy remain authoritative. |
| Phone race | 1 dedicated HTTP case: concurrent unique-phone changes cannot claim the same number for both accounts. |
| Canonical-name lookup | 1 dedicated HTTP case: unique name sign-in works before the case establishes duplicate canonical names; ambiguity remains non-enumerating and placeholder email remains unverified. |
| Own-phone rollback | 6 dedicated HTTP cases: `ABORT` and `IGNORE` against `person_profile`, `audit_event`, and `account_change_operation`; contact/audit stay unchanged until a matching-key retry. |
| Origin/privacy | 1 HTTP case: foreign Origin and actor/target metadata do not expose another account or allow identity mutation. |
| Stale phone page | 1 browser case: a phone page held by one tab cannot mutate after another tab signs in as a different account; the two other sessions and before/after IDs are independently checked. |
| Stale revoke-others page | 1 browser case: same actor transition, preserving two sessions and exact session-ID comparison so the wrong-actor result cannot pass by a one-session tautology. |
| Own-phone review | 1 browser case: dirty review/cancel and recovery after a committed lost response preserve the original operation identity. |
| Staff review | 1 browser case: empty and `false` edits survive verification/password confirmation; review, focus, dirty/cancel and successful recovery/audit behavior remain asserted. |
| Unavailable verification | 1 browser case: refresh removes an unavailable method without discarding the draft or unresolved reference. |
| Stale target | 1 browser case: changed target is rejected before explicit submit. |
| Lost Staff authority | 1 browser case: work is suppressed when management access is removed before submit; no audit or operation is written. |
| Incomplete profile | 1 browser case: incomplete profile does not block existing own-password controls. |

The unchanged six `tests/shared/identity-contract.test.ts` fast tests continue to cover exact actor/target capability metadata, malformed/unbound metadata, existing own-phone/Staff payload shapes including empty/false, missing operation identity/unknown verification, matching receipt/not-found, and invalid receipt shapes/windows.

## Final N08 qualification

Pinned environment: Node `24.21.0`, pnpm `10.33.2`. Command:

```sh
EFCC_TEST_SOURCE=ticket74-n08-ed7e80a-helper-d64c1d8 PLAYWRIGHT_WORKERS=2 \
  pnpm exec playwright test --config=.scratch/n08-playwright.config.ts
```

Observed result at `2026-10-13T18:56:23.742Z`: **49 expected/passed, 0 skipped, 0 unexpected, 0 flaky** (46.2s). Projects: `features-http` 25/25; `features-chromium` 8/8; `features-iphone-webkit` 8/8; `features-pixel-chromium` 8/8. The 25 HTTP cases ran once; the eight browser cases ran on desktop Chromium, iPhone 15 Pro WebKit, and Pixel 7 Chromium. Browser cases carry `@native @browser @mobile-critical`; HTTP cases carry `@native @http`; cases also carry the applicable `@risk-auth`, `@risk-privacy`, `@risk-atomicity`, and `@risk-recovery` tags.

`pnpm check && pnpm typecheck` passed after the final operation-key correction. The local commit hooks also passed formatting and commitlint. Earlier in this N08 worktree, Vitest passed 56/56 and `pnpm build:native` plus `pnpm build:test-provision` passed before subsequent E2E-spec-only corrections; these were not rerun on the final E2E-only correction. Parent-directed N08 work did not rerun tests/build/review after the final 49-case matrix.

The final private local evidence copy is `.scratch/n08-final-qualification-ed7e80a/` (`results.json`, report and artifacts). First-failure bundles are retained locally in `.scratch/n08-first-run-351d064/`, `.scratch/n08-first-final-attempt-024bdb8/`, and `.scratch/n08-second-final-attempt-5db4d82/`; no raw report, trace or auth state is committed.

## First-failure record and corrections

| Candidate/run | Observed result | Failure and disposition |
| --- | --- | --- |
| `351d064` initial full N08 run | 37/48 passed; 11 unexpected; 0 skipped; 0 flaky | One application sign-in hit the actual same-IP Better Auth limit after redundant username sign-ins; six stale-page browser executions hit the limiter after the second-session login reused that bucket; three management-loss browser executions could not reach review because the required phone input was blank; one WebKit route was interrupted by direct navigation while a client transition was pending. Corrections retained the two-session invariant with a genuine second-device API login from a distinct trusted IPv6 `/64`, limited same-bucket auth attempts without removing limiter claims, filled the required field, and used the real Staff tab plus URL waits rather than `page.goto`. |
| `024bdb8` corrected full matrix | 48/49 passed; 1 unexpected; 0 skipped; 0 flaky | The reserved-Username application request expected 409 but received 400: its operation key was a UUID, while `applicationBodySchema` requires exactly 64 hex characters. The expected 409 and no-account-write assertion were retained. |
| `5db4d82` full matrix after ordering correction | 48/49 passed; 1 unexpected; 0 skipped; 0 flaky | Same sole 409-versus-400 failure on the reserved-Username application request. This was not accepted as a pass or retried away. |
| `ed7e80a` final full matrix | 49/49 passed; 0 skipped; 0 unexpected; 0 flaky | Request key changed to `randomBytes(32).toString("hex")`, satisfying the public application contract while preserving the reserved-name 409 assertion. |

## Cleanup and retained seams

The migrated spec no longer owns copied Staff/person setup, auth/login/context construction, manual browser contexts, seed/local-env/SQL CLI, limiter pacing, or capture/report plumbing. It uses the shared native `test`/`expect` fixtures, `caseApp`, genuine Staff API context and actual ingress. Test-only dedicated stores are limited to global name ambiguity/uniqueness, true races, shared-phone isolation and destructive schema-fault cases; these retain causal independence and do not create another generic store/context owner.

No production behavior or API/schema contract was changed. The only uncommitted shared implementation-file difference in the assigned worktree is the parent-approved `r11-presentation.ts` sync noted above; it is intentionally excluded from the N08 commit. The scoped Playwright config was deleted after qualification. This record documents ticket-level scope and evidence; it does not replace the parent's final integrated source gate or the single final review requested by the user.
