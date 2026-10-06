# R11 production qualification — #45

Execution brief Revision 1 was confirmed on 6 October 2026. Authority: [#30 Revision 11](https://github.com/Noahlw/efcc-system/issues/30), [#45](https://github.com/Noahlw/efcc-system/issues/45), and the confirmed verification/repair plan. Starting SHA: `20839bb85a3b64cb88208b95bdc6ab41694b1afe`; the worktree was clean. Continue local `feat/ui-rework`, remote `codex/ui-redesign-grilling`, and existing draft [#31](https://github.com/Noahlw/efcc-system/pull/31).

## Coverage contract

The primary-screen IDs below match the R11 screenbook. `tests/e2e/r11-ui.spec.ts` exercises actual production owners with disposable synthetic records through the existing Worker/D1/browser harness. `r11-presentation.ts` captures six real viewport sizes (390×844, 1440×1024, 320×568, 768×1024, 1024×768, 844×390) and 200% root-font fixtures at 320×568 and 1440×1024. Its JSON attachments identify each completed screen/context; screenshots remain in ignored test results. A capture is presentation evidence, not a substitute for exercising the control or checking the durable result.

Captures contain the start and final-control viewports at CSS-pixel scale. This bounds artifacts even when accumulated audit history is very long, and avoids painting offscreen background documents around a fixed dialog. Root-font fixtures do not prove actual browser/OS enlargement. A real client focus fault exercises the application error boundary; the vinext development diagnostic overlay is dismissed separately and is not application UI. Lost-response cases execute the real write before aborting the browser response, then reconcile through the real endpoint.

| ID | Entry and production owner | Preserved controls/behavior | Functional qualification family |
| --- | --- | --- | --- |
| home | `/`, `features/home/*` | Week/date/All; approved Events separate from pending/waitlisted Programs; scoped notices/invitations | home-participation, home-notices |
| inbox | `/inbox` | Applicant-visible decisions, private notes excluded | account-decisions |
| account | `/account` | Identity/status/application/security destinations | account-security, restricted-status |
| phone | `/account?task=phone`, identity form | Review, save, original-operation reconciliation | account-identity |
| security | `/account?task=security` | Delivered security destinations and confirmation expiry | account-security |
| password | `/account?task=password` | Current/new/repeated password, session effects | account-security |
| sessions | `/account?task=sessions` | Explicit other-session revocation | account-security |
| application | `/application`, applicant form | Current eligibility/status and original actor | account-applicant |
| app-edit | Applicant edit/review | Immutable Username; Continue/Discard; explicit submit | account-applicant |
| app-withdraw | Applicant withdrawal review | Explicit withdrawal, conflict and receipt | account-applicant |
| app-resubmit | Applicant resubmission review | Rejected/withdrawn eligibility; explicit resubmit | account-applicant |
| signin | `/sign-in`, sign-in form | Username/name modes, ambiguity, limits, submitting | name-sign-in, qualification |
| apply | `/apply`, application form | Field validation, storage-before-send, draft exit | account-application |
| apply-result | Public application result | Original capability check/retry, confirmed reset/login | account-application |
| status | `/status` | Independent membership/security state; current read | restricted-status |
| temp-password | `/account`, temporary-password task | Expiry, required change, session and credential checks | account-assisted, account-security |
| management | `/staff/accounts` | Only delivered authorized destinations | account-assisted |
| accounts | `/staff/accounts?view=people` | Search, empty list, same-name disambiguation | account-assisted |
| person | `?view=people&person=…` | One selected account; resize and return preserve context | account-assisted |
| create | `?task=create`, Staff accounts form | Verified creation, review, explicit submission | account-assisted |
| handover | Staff creation/recovery result | One-time password, copy fallback, never persisted/re-shown | account-assisted |
| recovery | `?person=…&task=recovery` | Existing verification/reset/reissue policy | account-assisted |
| identity | `?person=…&task=identity` | Verified identity edit, confirmation/review preservation | account-identity |
| restrictions | `?person=…&task=restrictions` | Independent membership and security restrictions | account-restrictions |
| ban | Restriction review | Current target/authority; explicit ban | account-restrictions |
| unban | Restriction review | Explicit unban without changing membership | account-restrictions |
| deactivate | Restriction review | Explicit membership deactivation without ban | account-restrictions |
| reactivate | Restriction review | Explicit membership activation without unban | account-restrictions |
| deletion | `?person=…&task=deletion` | Eligibility, irreversible warning, review, retained history | account-deletion |
| applications | `/staff/applications`, decision review | Only eligible pending applications | account-decisions |
| application-review | Decision editor/review | Back, unsent notes, preview, explicit approve/reject | account-decisions |
| audit | `/staff/account-audit` | Read-only retained history | account-deletion, account-decisions |
| audit-detail | `?record=…` | Actor/target/receipt/time, private note Staff-only | account-deletion, account-decisions |
| confirm | In-work security dialog | Current actor password, expiry, return without auto-submit | account-security, account-identity, account-assisted |
| leave | Shared dirty-exit dialog | Continue/Discard; native lifecycle limitation | account-applicant, account-identity, account-assisted |
| operation | Feature-owned reconciliation | Original actor/target/reference, lost response and retry | account-applicant, account-assisted, account-restrictions, account-deletion |
| unavailable | `/unavailable` and feature read failures | Truthful failed read, protected retry destination | guard-failures, zz-worker-faults |
| error | `src/app/error.tsx` | Generic safe copy, reset; no internal exception in application UI | r11-ui, UI app-error tests |
| denied | Staff denied branches | No unauthorized records/actions; working permitted exits | guard-failures, account-assisted |
| signout | Shared sign-out owner | Compact Auth pending/unknown, native retry/session check | access-foundation, r11-ui |

## Completion record

Automated qualification completed on 6 October 2026 using split evidence. Production-source content fingerprint (15 changed source files, relative-path/SHA-256 map): `76e63a8f2eb63680a7fd0ff49b49d109538a3474b4b5ede7563a68de1e6e31fa`. The frozen full-run candidate and the later R11 candidate have identical production source; only the presentation capture helper changed.

| Boundary | Actual result |
| --- | --- |
| Repository | `pnpm check`, `pnpm typecheck`, `pnpm test` (2 files / 9 tests), `pnpm build`, and `git diff --check` passed. |
| Full existing Worker/D1/browser run | 263 tests in 19 files: 262 passed, 1 failed, no skipped/flaky tests. The failure was Chromium `Page.captureScreenshot: Unable to capture screenshot` for the audit full-document capture. All 253 non-R11 tests passed. |
| Affected evidence after capture repair | All 10 R11 tests passed against the retained full-suite synthetic D1, without resetting its audit history. No skipped/flaky tests. All 40 distinct screens completed all 8 contexts: 320 context records and 640 correctly sized start/end viewport captures. No functional, overflow, reflow, navigation-obstruction or draft-preservation assertion was removed, and no screenshot retry was added. |
| Design reference | Screenbook checker passed 40 synthetic designs / 306 fixture states. Production primary mobile/desktop hierarchy was visually compared with the retained reference captures; enlarged summary and dialog captures were inspected separately. Fixture evidence remains distinct from production journeys. |
| Local state | Both original local D1 databases were restored after stopping test runtimes; SQLite integrity and original canonical content digests match. Test data and artifacts remain ignored and synthetic. |
| Independent review | Standards: no hard violations; low-priority duplication advisories retained. Spec: initial sign-out Escape and pending-evidence findings repaired, no outstanding actionable static findings. Acceptance verifies composable unchanged-suite/R11 evidence; physical qualification remains incomplete. |

This is **not one clean full-suite run**. Preserve the 253 unchanged non-R11 results and refresh all 10 consumers of the changed capture helper. Raw reports and frozen per-file hashes remain in ignored `.scratch/r45/e2e-full.json`, `e2e-candidate-start.json`, `r11-final.json`, `r11-candidate-start.json`, and `qualification-summary.json`; captures are in ignored `test-results/`. The final commit must match the reviewed source hashes. No merge, deployment, live-member action, or release is authorized.

Repairs cover natural control/text expansion, native field dimensions, active Management navigation, compact neutral sign-out with real pending/retry/return/Escape behavior, one guarded task heading, distinguishable Staff targets without Username, and font-responsive shared metadata summaries. Application metadata reuses the existing summary owner; unused `mode="all"` was removed after checking its callers. Existing APIs, URLs, roles, validation, schema and recovery contracts are preserved.

Do not infer completed acceptance from an Open/Closed issue state. Predecessors #35 and #39–44 were Open when inspected. #45 stays incomplete until the physical gate below is qualified.

## Physical handoff — still required

Record device model, OS/browser version, PWA/browser mode and candidate identity. On a real mid-range Android Chrome and iPhone Safari/PWA, exercise each family:

| Family                              | Android Chrome | iPhone Safari/PWA |
| ----------------------------------- | -------------- | ----------------- |
| Auth/sign-out                       | Not performed  | Not performed     |
| Home/Inbox/Account roots            | Not performed  | Not performed     |
| Long public/applicant forms         | Not performed  | Not performed     |
| Staff person/task/review            | Not performed  | Not performed     |
| Confirmation and dirty-exit dialogs | Not performed  | Not performed     |
| Uncertain-operation recovery        | Not performed  | Not performed     |

For each family verify portrait/landscape, browser chrome changes, safe areas, soft keyboard open/closed, scrolling to the final action, modal scroll/focus, and supported browser/system enlargement. Repeat affected journeys for defects found. Submit only synthetic records to an authorized local/device-accessible runtime. Missing device evidence keeps #45 incomplete; desktop emulation and root-font fixtures cannot check these boxes.

Unsent drafts use Continue/Discard for app navigation and browser-native warnings where supported; force-closing a PWA can lose an unsent draft. No auto-save/password persistence is added. Submitted uncertain-operation references remain independently protected.
