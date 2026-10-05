# EFCC UI redesign — understanding brief

Revision: 6 Status: CONFIRMED — Revision 6 accepted as the basis for spec and implementation-ticket authoring on 5 October 2026 Date: 5 October 2026 Storage: immutable repository reference snapshot; current spec/tickets live in GitHub Issues

## Goal and authority

Redesign the current EFCC System UI so that delivered member and Staff journeys have a coherent, usable, phone-first presentation. Work is isolated on `codex/ui-redesign-grilling`, created from refreshed `origin/main` at `100bde89af5b8177e7625bd9b36580c0ab254c43`.

Current EFCC System behavior and accepted issues remain the product authority. The owner explicitly selected `https://github.com/Noahlw/efcc` as the legacy design reference. Its current `main` snapshot is `8bcbf45239cc2a1a17807fd2d3a5e521119cf8ab`. Legacy examples are design inputs, not authority for current business rules.

## Accepted decisions

- Q1: Sample the legacy layout, navigation and visual foundation, then improve it for the new system. This revisits issue #8's restriction against inheriting legacy visual patterns.
- Owner clarification after Q1: this is a rebuild and creative redesign is encouraged. Legacy patterns are inspiration; the new layout, navigation and visual direction do not need to resemble the old screens closely.
- Q2: Cover all delivered Slice 1–2 screens and shared navigation, forms and state presentation. Later Slice 3–8 screens will extend the selected foundation when their own behavior is specified.
- Visual direction: the owner selected the second displayed concept ("design two looks the best to me"). The exact selected image is `selected-home-v1.png`, copied from Image Gen result `exec-97cbbb44-2e4f-4af6-b2d8-593fc4f73a8d.png`. Preserve its calm teal, sans-serif agenda direction as the visual baseline; refine generated content that conflicts with current business semantics before adoption.
- Q3: the week strip filters Home's already-authorized confirmed gatherings by date. Pending Program participation is displayed separately and is never part of a confirmed Event timeline. The semantics-corrected visual is `concepts/selected-home-v2.png`; it removes the generated pending-event time/Department.
- Q4: Staff still land on personal Home, with a clear Management entry for current approvals, account management and records. Current server roles and permissions remain authoritative.
- Q5: account management selects/searches one person first, keeps that person's context visible, then presents permitted operations. Account creation remains a separate entry.
- Q6: initial Home shows all upcoming authorized confirmed gatherings. The strip initially displays the current week; selecting a date filters the event list, “All” resets it, and future weeks can be browsed. Do not add historical Event access in this UI scope.
- Q7: when current sensitive-action policy requires fresh password confirmation, present it in the current work flow. Preserve the same actor, person and intended operation; after confirmation, return to review and require explicit submission. Retain the existing ten-minute lifetime, current server checks and confirmation-operation recovery.
- Q8: leaving or changing target with an unsubmitted dirty form prompts “continue editing / discard changes”. Do not automatically preserve drafts for multiple people. Submitted operations with unknown results retain their original reconciliation reference and must not be discarded as unsaved form data.
- Q9: Home retains gatherings, participation states, valid invitations and church news. Name/Username, membership status, the person's application and security settings are grouped under Account. Existing information and destinations remain available under their current permissions.
- Q10: use “報名已批准” for approved Program enrolment, distinct from pending/waitlisted states and actual Event attendance. This resolved term is recorded in root `CONTEXT.md`.
- Q11: mobile uses bottom navigation; desktop uses a sidebar and wider work area with the same destinations and permissions. Staff may use list/detail side by side on desktop and progressive entry on mobile.
- Keep the already accepted responsive Cantonese/Traditional Chinese application, Hong Kong 24-hour time, one light theme, readable scalable text, 17px body baseline, 44px interaction targets, visible focus and labelled controls.

## Behavior to preserve

- Current authentication, membership, security restrictions and scoped authorization; available-only navigation must not expose undelivered business destinations.
- Distinct pending, banned, deactivated and other current lifecycle states; visible outcomes must not imply authority or completed work that the server has not established.
- Form validation, submitting/duplicate-submit protection, audit, original-actor operation ownership and truthful uncertain-outcome recovery.
- Account management and current role/delegation authority stay with the accepted business contracts, including the separate Slice 3 planning work.

## Current surface inventory

`/sign-in`, `/apply`, `/`, `/status`, `/unavailable`, `/account`, `/application`, `/inbox`, `/staff/applications`, `/staff/accounts`, `/staff/account-audit`, plus their shared layouts and interaction states. The source inventory is verified. All routes and their subflows are mapped in the delivered screenbook; all 40 primary screen designs have mobile and desktop browser captures.

## Evidence and unresolved decisions

- New-system preview uses this worktree, isolated local D1 and existing synthetic fixtures. Baseline `pnpm test` passed 5/5 tests. This is setup evidence, not UI acceptance.
- Legacy reference uses a clean snapshot in `/tmp/efcc-ui-reference-20261005`; the dirty legacy checkout is preserved. Storybook reference captures, when used, prove presentation only.
- Codebase Memory registrations still point at the former empty legacy root, and no exact current-root index was found. A fast index attempt for this worktree exited with code 1 (`/Users/noah.wong/.cache/codebase-memory-mcp/logs/.worker-log-yfKtPe`). Bounded direct-source reads at the recorded main SHA are the fallback; graph completeness is not claimed.
- Current source captures and bounded findings are recorded in the earlier local reference audit, with screenshots under `screenshots/`. Sign-in, Member Home, account security and Staff account management were sampled; the legacy counterpart is synthetic presentation evidence.
- Three independent Member Home concepts were displayed; the owner selected the second. the earlier concept-selection record records exact displayed order, the selection and required corrections. Selection establishes a visual baseline, not implementation or acceptance of generated extra features.
- Supporting Staff account-management concept: `concepts/staff-accounts-v1.png`, extending the chosen visual system and accepted person-first flow. It demonstrates task grouping, not new API/permission behavior.
- Supporting Sign-in concept: `concepts/sign-in-v1.png`, preserving Username-default/full-Chinese-name mode, one password field and the current application entry in the selected visual family.
- Supporting desktop concept: `concepts/staff-accounts-desktop-v1.png`, showing the accepted sidebar and person-first list/detail arrangement. The Home and supporting bitmaps are visual references, while the accepted decisions above govern labels, navigation, permitted data and interaction behavior.
- Q1–Q11 and the visual selection are settled. The owner subsequently required every Slice 1–2 screen to be designed before consolidated confirmation. Revision 6 delivered the complete design screenbook first. On 5 October 2026 the owner then said “ok lets make it as a spec and then ticket to implment”, confirming this direction as the basis for the explicitly invoked spec → tickets route.
- Current source facts for these decisions: `src/features/home/queries.ts` returns only upcoming Events for approved participation and separate pending/waitlisted Program states; date filtering must not create past-event access. Existing account security already owns password-confirmation operations and a ten-minute server policy. Staff operations and reconciliation retain actor/target references, including unknown-result recovery; redesign must reuse those semantics.
- New domain terms and architectural trade-offs have not yet been resolved. No glossary or ADR is created solely for styling preferences.

## Complete screenbook delivery

- [Interactive design book](design-book-revision-6.zip): 40 primary screens/subflows, with 304 selectable fixture combinations. These counts include shared outcome templates, not 304 independent layouts.
- [Coverage inventory](design-book-revision-6.zip): every route, screen family and available state; current-source authority at `100bde89af5b8177e7625bd9b36580c0ab254c43`.
- [Design QA](design-book-revision-6.zip): selected-reference comparisons, corrections, browser evidence and prototype limitations.
- To run the archived design book, extract it and use its documented local server command. [Visual overview](overview-1.jpg) provides four contact sheets; the interactive book shows full screens and desktop variants.
- Source-contract checks found and corrected distinctions between ordinary decisions and sensitive actions, account/ban state independence, approved-history retention on deletion, current temporary-password gate vs expiry time, current confirmation vs historical receipts, and per-action uncertain-result recovery.
- A public application conflict hides the form and requires reconciliation. Unavailable reference storage blocks a new application. Member recovery is presented under the original action and actor; it is not relabelled as a Staff password reset.
- All prototype data is synthetic. Interactions simulate the design in memory. They do not establish real server authorization, receipt persistence, password policy enforcement, or Worker/D1 acceptance.

## Source locators

- [Whole-system understanding #1](https://github.com/Noahlw/efcc-system/issues/1)
- [Rebuild map #2](https://github.com/Noahlw/efcc-system/issues/2)
- [Access foundation spec #8](https://github.com/Noahlw/efcc-system/issues/8)
- [Legacy EFCC](https://github.com/Noahlw/efcc)
- Owner Q1–Q11 answers, the second-image selection and the creative-redesign clarification in this chat.

## Observable acceptance for the next authoring stage

1. Member and Staff can complete current sign-in, Home/account and sign-out journeys with the selected visual system on mobile and desktop. Username/name sign-in semantics, available-only navigation and restricted-account routes remain intact.
2. Home initially shows all upcoming authorized gatherings; selecting a Hong Kong calendar date filters only those Events. Clearing the filter restores the list. A selected day without events has a truthful empty state. Pending/waitlisted participation, approved Programs without upcoming Events, valid invitations and applicable notices remain discoverable.
3. “報名已批准” describes approved Program enrolment and never claims attendance. Home's current personal information and account destinations are retained under Account rather than lost in the redesign.
4. Eligible Staff reach current management work through a distinct entry, select a permitted person by safe identity information, and retain that person's name/Username context throughout permitted actions. Same-name people remain distinguishable. Account creation is separate.
5. When fresh password confirmation is required, the current work flow preserves actor, target and intended action, reconciles the confirmation outcome if necessary, and requires explicit review/submission afterward. It does not bypass or lengthen current server policy.
6. Dirty unsubmitted forms warn before in-app navigation or target replacement. Discarding a draft never clears a submitted operation's reconciliation reference. Loading, denial, validation failure, definite rejection, uncertain acknowledgement and confirmed completion remain distinct and actionable.
7. Public application, applicant maintenance, inbox, membership/security restrictions, assisted creation/recovery, identity correction, eligible deletion and read-only audit flows remain within scope; sensitive workflows retain their current qualification boundaries.
8. The built candidate must be compared with the selected design at representative mobile/desktop viewports and exercised through real Worker/D1/browser journeys. Check readable scalable 17px body text, 44px targets, contrast, keyboard focus, labels, autofill and responsive reflow. Concept images and baseline unit tests do not constitute that acceptance.

## Resolved documentation

- Root `CONTEXT.md`: Approved enrolment（報名已批准）, resolved in Q10; no attendance-policy change.
- No ADR is created merely to record a visual preference. Current architectural and business-access decisions continue to apply.

## Confirmation and next route

Owner confirmation: after the complete design-book handoff, the direct instruction “ok lets make it as a spec and then ticket to implment” confirmed Revision 6 as the basis for spec and ticket authoring. This is not production implementation or release approval. The invoked next route is to-spec → to-tickets; ticket granularity/dependencies are pending Q13 approval.
