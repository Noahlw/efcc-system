# N15 / #81 — R11 native journey migration

Base: `8b6d6131c4078654502919853f3edd792351c5c2`. Scope is `tests/e2e/r11-ui.spec.ts` and the coordinated native-scroll repair in `r11-presentation.ts`; no product UI or Design Book change.

## Case and claim disposition

All eleven original cases remain browser cases. They run on Chromium, iPhone 15 Pro WebKit (393×852, DPR3), and Pixel 7 Chromium (412×915, DPR2.625), selected by `@native @browser @r11-ui @mobile-critical`. No HTTP permutation was removed or duplicated as a new mobile-only case.

| Original case | Preserved claims / native disposition |
| --- | --- |
| Public sign-in/application/dirty exit/result | Real controls, dirty leave dialog, continue editing and retained phone, explicit submission, result exit, real sign-in and own projection; independent D1 pending application added. |
| Personal roots/security/contact | Eight roots/tasks and headings, exact spacing/type checks, Cancel produces zero revoke commands and preserves session, phone review/explicit submit and projection; independent D1 phone added. |
| Applicant correction/withdraw/lost response/resubmit | Back without mutation, correction review, actual committed response loss plus reconcile loss, original operation lookup, explicit resubmit; D1 immutable three-receipt sequence added. |
| Staff workspace/identity/confirmation/recovery | Person-first search/selection, dirty target-switch cancellation and retained draft, identity review, real password confirmation returns without auto-submit, explicit identity submit, real recovery/verification hit target, one-time masked handover, reload non-replay and real temporary-password authentication; independent actor/target issuance receipt added. |
| Staff creation/restrictions/deletion/audit | Create review and one-time handover, four explicit restriction reviews/submits, keyboard details disclosure and target identity, nullable display username, deletion review/checkbox, retained audit navigation/details. Added actual explicit deletion plus user absence and all five retained change receipts. |
| Staff application decision/privacy | Chooser/review/Back retained. Added retained internal draft across review Back, no D1 decision before explicit Submit, actual approval and independent actor/internal-note receipt, real applicant authentication and private-note absence from Inbox. |
| Denied/unavailable exits | Actual ordinary account denied Staff ingress and unavailable presentation; explicit destination controls. |
| Client error boundary | Real browser focus exception, safe main copy, actual retry enables form; development-only overlay handling retained. |
| Native Staff fields/Management | Native label focus, keyboard focus ring, exact border/radius/type tokens, radio 52px hit target and exact styling, selected person styling, Management current destination. |
| Pending sign-out/retry | Real held network response and failure, non-dismissible pending view, private compact auth shell, Escape/Query recoveries, explicit retry, real logout and null session. |
| Stale verdict after committed lost logout | First abort then actual second committed logout/lost response, exact write/read counts and independent D1 zero sessions. |

Additional second-tab case preserves a stale Staff restriction review while another real actor signs in through the shared browser cookie jar; explicit submission cannot mutate the target. Independent D1 verifies zero receipts and no ban, Staff history is denied, native Back restores the ordinary account, and no secret is exposed.

## Ownership and retained seams

Each journey uses native `caseApp: dedicatedApp` because cross-feature Staff/global audit visibility and deliberate response faults are not proven independent on a shared store. Native fixtures own harness/migrations/RPC/D1/context lifetime. Staff prerequisites use genuine confirmed native `staff` context. The explicit browser password-confirmation journey deliberately establishes a new genuine unconfirmed session for that Staff account.

Deleted from this consumer: seed HTTP imports, SQL CLI calls, duplicated Staff role setup, shared limiter pacing. Direct app-binding prepared queries remain independent domain effect observations; holder inputs and real sign-in used for session-transition claims are local domain inputs, not another runtime/context/SQL owner. There is no beforeAll, generic reset, fake cookie/hash, mutation retry, fake time or custom PNG/metadata owner.

Presentation supplies explicit draft/action locators to N02. Existing eight responsive/root-font contexts plus the original native device viewport always run; success capture remains explicit `EFCC_CAPTURE_SUCCESS=1`, with native masks/attachments. Native `scrollIntoViewIfNeeded` first waits for the action's stable layout; the existing end alignment then respects the scrolling frame's bottom padding. This is applied in both assertion and opt-in capture phases; visibility, overflow, nav clearance and draft equality remain unchanged.

## Qualification record

Pinned local toolchain observed: Node 24.21.0, pnpm 10.33.2. Frozen/prefer-offline install and actual `pnpm build:native && pnpm build:test-provision` completed successfully in the owned tracked-only worktree. No developer variables or personal/remote D1 were read.

First complete invocation: 33 selected/executed, 17 passed, 16 failed, zero skips/retries. Preserve as failure, not acceptance: explicit action locators selected navigation links or incorrectly exact compound labels; one WebKit public-form native-scroll visibility failure also surfaced. Private first report is `.scratch/n15-first-results.json`; private native traces are not publishable evidence. Subsequent candidate qualification is recorded separately after completion.

Intermediate repairs were not acceptance: capture-on 36 executed/23 passed/13 failed, then capture-off 36 executed/27 passed/9 failed. Root-cause evidence separated selector errors from the scroll issue: native centering alone left audit/action bottoms at 446.16/417.36 against the 374px phone navigation top; retaining end alignment after native layout stability restored the exact clearance checks. A further complete off/on pair passed 36/36 each; the final cleanup then removed redundant Staff confirmation setup and must qualify afresh.

Observed fresh native attachments: desktop identity review at 1440×1024 showed the retained correction draft, explicit password confirmation and disabled final Submit before confirmation. iPhone WebKit recovery handover at 390×844 showed the one-time output fully masked in the original capture, expiry, handover warning and checkbox. These are native attachment inspections, not a Design Book modification, visual redesign or physical-device proof.

Final settled-source qualification after the redundant confirmation removal: scoped Ultracite formatting/lint passed; native LSP diagnostics reported OK. Capture off: **36 selected / 36 executed / 36 passed** (12 Chromium, 12 iPhone WebKit, 12 Pixel Chromium), 1.5 minutes. Capture on: **36 selected / 36 executed / 36 passed**, 3.3 minutes. Both used two workers, zero failed/skipped/retried cases. The off/on pair used the actual previously built native app/provision artifacts; all test assertions executed afresh against harness-owned disposable stores. Success PNGs and result JSON remain private in `.scratch/test-results/n15/results.json`; no screenshots, session state, D1 stores or raw traces are committed.

Normal local commit hooks are required for the source delivery. Parent owns independent review, the shared feature-config discovery expansion and integrated N02 off/on regression; this bounded qualification does not claim whole-Spec acceptance, tracker closure, merge or release.

Parent must add `r11-ui.spec.ts` to the shared feature testMatch during integration. Qualification used a ticket-only ignored `.scratch/n15.config.ts` importing the existing shared native projects; that throwaway config was removed before commit. No parallel configuration framework is retained.
