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

### W15.C03 deletion trace after-result

Compared with B0 source `d2b0b2d25317530a3a77ab344dd7ab96ce810ab1` above, the invariant still belongs to the same command, SQL predicate, migration trigger and four native regression cases. No deletion eligibility or retention policy was moved into presentation, and no new deletion engine was needed. The command checks all four durable church record owners before deletion and repeats that predicate in the ordered atomic batch; `user_preserves_church_history_delete` independently denies direct native D1 deletion before cascades. Username reservation and immutable receipts survive eligible deletion; the current bounded search projection disappears with the deleted person profile.

On W15 source tree `9480b9cc59b3979e2d1b34705718f13db1eb84f8`, actual native HTTP/D1 qualification executed all four `stored ... history blocks deletion before cascades and retains deactivation` cases once: **4 passed, zero retries/skips**. Each verifies the real HTTP409/code, direct D1 trigger denial and retained user/history, including expired invitation history. A separate native eligible-deletion case verifies searchable identity before deletion, original201 and receipt-only replay200, no subsequent search result, retained decisions/security/audit/receipts and permanently reserved old/current Username claims. The independent restriction-state case also passed in the same two-case selection. These are current boundary observations, not a retrospective runtime claim for B0.

This bounded after-exercise preserves the original owner trace rather than claiming a measured navigation-speed improvement. The complete normal gate, the final aggregate T14 comparison with the other three exercises, independent aggregate review and separate owner acceptance remain required under W19.

## Integrated source comparison

B0 and the package after-results above retain their original source attribution. W19 repeats the four bounded ownership exercises against the assembled source; exact candidate/runtime receipts belong to #106. This source comparison does not relabel an earlier run as a current pass or set a productivity/LOC target.

| Exercise | B0 owner and problem | Integrated owner and comparison | Actual verification owner |
| --- | --- | --- | --- |
| Staff review copy | `identityTaskDescription` in `identity-form-views.tsx`; orchestration already owns frozen intent | The same Staff/review branch now says `請核對此帳戶資料；按「確認並提交修正」才會送交伺服器。`; phase-specific view/action props keep the copy edit separate from command intent and authority | Existing Staff Identity review/frozen empty/false/native journeys; W11 source and current aggregate receipts |
| Legitimate business error | Runtime string code and separately enumerated Hono global response could disagree | `business-error-contract.ts` owns status/code facts and derives both constructor arguments and Hono response types. Existing legitimate `invalid_password` is registered once; commands retain contextual messages and native auth keeps its distinct envelope | Type rejection for contradictory/unregistered pairs, typed RPC and the real wrong-password business HTTP response; W04 and aggregate receipts |
| Roles test design only | Existing disposable app, real username sign-in, Staff confirmation and authority-change-next-request seam | `caseApp`, `staff.context`, per-case metadata and native D1 ownership remain usable through the same public fixture interface. The owned Node listener lifetime changes without introducing a Roles endpoint, payload, transition or test | Existing fixture/authority tests; the Roles exercise remains a design only, with future policy separately authorised |
| Durable deletion history | Command pre-read plus atomic SQL predicate, original trigger and all four native history cases | The same rule remains at command/SQL/trigger owners. Views own presentation only; bounded selection/search and eligible deletion retain immutable history/receipts and reserved Username claims | All four existing HTTP409 plus direct D1-trigger denials, and eligible deletion/search/replay native cases; W15 and aggregate receipts |

The aggregate must refresh affected execution on one frozen candidate. Known local transport failures, independent Standards/Spec review, owner acceptance and release retain separate gates; this comparison grants none of them.

## CR-09 corrective comparison

The corrective round recorded all four starting exercises before relevant owner edits at C0 `ec73ceead1c52ec7e0805c608b21daaa9177cd5f`, tree `dcd62220f2222c6ac0463814104404153c302d25`; the private source excerpts and subsequent frozen-candidate receipts are linked from #106. This supplements B0 and the package results without rewriting their source attribution.

- Staff Identity review copy remains in `identity-form-views.tsx`; the existing form/controller freezes the request and its original values. Copy and stale-data warning presentation do not construct fingerprints, refresh drafts automatically or authorize writes. A new authorized read replaces the draft only after explicit discard confirmation and a successful matching response.
- Approved `client_update_required` and `stale_identity` errors extend the existing status/code registry at HTTP409. Runtime constructors and Hono/RPC response types derive from that same registry; contextual feature messages and native authentication remain separate. Missing original values and conflicting writes have genuine HTTP/D1 negative cases, including unchanged durable-effects snapshots.
- The Roles exercise still designs a future test using the existing disposable native app, genuine sign-in, Staff context and current-authority/D1 fixtures. No Roles endpoint, payload, policy, source or test is introduced or executed.
- Deletion retains the command pre-read, atomic history predicate and original `0009` trigger over all four church-history owners. Current ordinary Admin-target denial is an additional action-specific policy, not a replacement for direct-D1 last-effective-Admin or retained-history defenses. Tests continue to cover the actual HTTP/SQL/trigger boundaries, independently of presentation.

The comparison demonstrates retained ownership and the new approved contracts; it claims no productivity or LOC improvement. Exact aggregate source, selected/executed cases, first failures, capture parity and any unperformed independent or Owner gates belong to #106. The preserved stock SDK transport counterexample is distinct from the qualified owned Harness/asset dispatch; S1 remains separately source-blocked.
