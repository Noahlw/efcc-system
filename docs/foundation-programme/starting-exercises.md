# T14 starting exercises (B0)

Recorded on 2026-10-16 before changing the four relevant owners. Source: `d2b0b2d25317530a3a77ab344dd7ab96ce810ab1`, tree `b34e1d3f642d72095ba3137b2d0b7f0d2a6a09ac`; application/base: `272dddbc887e7c3343a61831f91833fb687047bc`, tree `fc539e58b119067477fd339811f3a110663c8792`. Live #87/#88 and comments were refreshed. These are bounded source exercises, not runtime qualification or implementation of new policy.

## Staff Identity review copy

Exercise: locate the owner of the Staff review description, and trace how a copy-only edit reaches the review without changing a frozen command.

`src/features/account/identity-changes/identity-form-views.tsx` owns `identityTaskDescription(staffVerified, step)`. The Staff/review branch returns `同一個人，同一次更改。`; `identityTaskTitle` separately owns `檢查身份修正`. `identity-form.tsx` owns `step`, `reviewDraft`, `reviewBaseline`, transitions to review and passes those into the view. A description change belongs in the view's Staff/review branch. It should not edit `correctStaffIdentity`, payload/fingerprint construction or confirmation/submit transitions. Native follow-up belongs in the existing `tests/e2e/account-identity/identity-ui.spec.ts` Staff review journey. No copy was changed for B0 and that journey has not been run here.

## Legitimate business-error addition

Exercise: trace a possible new business failure through runtime, typed RPC and client without adding an unapproved error.

`BusinessApiError` in `src/features/account/business-request.ts` accepts a restricted status union but an unrestricted string code. `src/server/api/app.ts` serializes its status/code/message in `handleUnexpectedError`, while its separate `ApplyGlobalResponse` declaration enumerates status/code pairs for `AppType`. `src/shared/business-rpc.ts` imports that type into `hc<AppType>`. The generic client envelope in `operation-error.ts` accepts a string code; Identity's form parses its feature error schema before choosing feedback. A legitimate new policy error would require the feature command's throw and the matching status/code entry in `AppType`, followed by feature schema/handling review and a genuine HTTP assertion. Runtime currently cannot prevent a contradictory status/code pair. This is the starting duplication to exercise under W04; no new policy/code was invented or installed. Native auth remains a separate route/envelope.

## Roles HTTP-test design (design only)

Exercise: design a future authority test using existing fixtures without implementing Roles or guessing its policy.

`tests/support/fixtures.ts` already owns the disposable native app, synthetic `account`, real `signedInRequest`, confirmed Staff `staff.context`, per-case IP/origin headers and nested context disposal. `tests/e2e/account-restrictions/http.spec.ts` shows an actual HTTP authority change followed by another real request, and `dedicatedTest` supplies isolated D1 for destructive/race scenarios. A future Roles test can provision actor and target through `caseApp.provision.account`, authenticate through `/api/auth/sign-in/username`, submit the **future approved** endpoint using the real request context, then assert the approved response and authority on the next HTTP request. It must cover denial/replay/SQL-time revocation according to the separate Roles specification, using existing fixture ownership instead of forged cookies or mocked guards. Endpoint, payload and expected role transitions deliberately remain unspecified pending that authorization. No Roles source/test was added or executed.

## Deletion invariant trace

Exercise: trace "stored church history prevents account deletion" from command through SQL to the real regression test.

`src/features/account/deletion/deletion.ts` owns `historyBlocksDeletion`: enrolment, invitation, department membership and manager assignment each block deletion, irrespective of active/expired status. `deleteEligibleAccount` rejects the pre-read with 409 `church_history_retained`, then repeats the history predicate with eligibility in the same ordered `db.batch` before deleting `user` and recording the immutable receipt. `migrations/0009_eligible_deletion.sql` independently installs `user_preserves_church_history_delete`, which aborts direct user deletion before cascades; receipt update/delete triggers preserve history. `tests/e2e/account-deletion/http.spec.ts` parameterizes `stored ${table} history blocks deletion before cascades and retains deactivation` over all four tables. It creates synthetic retained history, asserts the real deletion HTTP 409/code, verifies direct D1 deletion rejects and checks the user/history remain. This identifies both request and database boundaries; those regression cases have not been executed for B0.

## After-results and remaining gates

W04, W11/W15 and W19 must append or link their attributed after-results to the relevant issue receipts. Preserve B0 as historical source evidence; do not relabel it as a later candidate pass. T14 comparison and full T01–T15 qualification, independent Standards/Spec review and separate owner acceptance remain outstanding. All 26 packages, 19 issues and seven phases remain in scope.
