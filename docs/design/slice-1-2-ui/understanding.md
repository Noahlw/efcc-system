# EFCC UI redesign — understanding brief

Revision: 11 Status: Complete R11 understanding CONFIRMED in Q23 on 5 October 2026, including Q22 mobile lifecycle boundary; Q21 combined planning scope and Q20 R9 product/design decisions remain confirmed. Detailed module placement remains a planning recommendation. Storage: canonical repository reference at docs/design/slice-1-2-ui/understanding.md. Earlier R6/R9 packets are historical; R11 source and evidence are consolidated beside this brief.

## Goal and delivery

Redesign and polish the **whole delivered Slice 1–2 UI and its code structure** as the system's reusable presentation foundation. Q21 extends the current planning to include feature server/client/contracts ownership and feature-composed Hono API routing, using published tickets as future-feature authority; existing endpoints, permissions and behavior remain unchanged. Auth is one family, not the scope limit. Cover all 31 tracked TSX UI modules and all 40 designed screens/subflows: Home, Inbox, Account/status/security, public application and applicant maintenance, Staff account work, approval, identity/recovery/restrictions/deletion, audit and shared states.

Continue existing draft [PR #31](https://github.com/Noahlw/efcc-system/pull/31) through design and eventual implementation in the same branch. Q15 preserves #31: local `feat/ui-rework` tracks remote `codex/ui-redesign-grilling`, because GitHub head-branch renaming closes an open PR. Push explicitly to that retained head. The prior PR head was `7342415df7bfab2e68743151dac86570d8ee0c55`; production baseline is `100bde89af5b8177e7625bd9b36580c0ab254c43`. Branch/title/body and OPEN/DRAFT state were verified. Production implementation has not started.

## Accepted design and architecture

- Q1/Q2 and creative-rebuild clarification: legacy [EFCC](https://github.com/Noahlw/efcc) is inspiration; redesign every delivered Slice 1–2 screen. Later Slice 3–8 capabilities remain separately specified.
- Preserve the selected second calm-teal agenda direction. Exact selected image: `selected-home-v1.png`; semantic refinement: `selected-home-v2.png`. Accepted behavior takes priority over generated copy.
- Q3/Q6/Q10: Home defaults to all authorised upcoming Events for approved enrolment, with Hong Kong date filtering, future weeks and All reset. Pending/waitlisted Programs remain separate; no new past-event access. “報名已批准” describes enrolment, not attendance.
- Q4/Q9: Staff land on personal Home with a permitted Management entry. Home retains participation/invitations/notices; Account groups personal details, status, application and security. Preserve existing information/destinations.
- Q5: Staff search/select one person before choosing work; keep name/Username and target context through edit/review/result. Same-name people remain distinguishable; creation is separate.
- Q7/Q8: confirm current password within the work, preserve actor/session/person/action and the ten-minute policy, then return to review for separate explicit submission. Warn before leaving/replacing an unsent dirty draft; submitted uncertain operations retain their original reconciliation reference.
- Q22 bounds that warning: app-controlled navigation, return and target replacement offer Continue editing/Discard. Refresh/close uses the browser-native warning when allowed; mobile/OS forced closure may lose unsent fields. Do not add automatic draft persistence or save passwords. Submitted-operation references retain their separate existing owner/operation/storage protection and storage-failure behavior; no guarantee against browser storage clearing is introduced.
- Q11/Q14 and reconfirmation: mobile roots have viewport-fixed bottom nav with reserved space. Focused forms/person/review/sensitive work hide it and use one return/title row. Desktop has sidebar/wider work areas; tablet follows mobile destinations. Avoid a repeated separate brand row above every task.
- Retain R8 scalable roles: body 17, label 16, meta 14, section 20, task 22, root 28/32; mobile primary CTA/fields 52, secondary 48, effective targets at least 44×44. Roles use rem and remain readable/reachable with safe areas, landscape and enlarged text.
- Q16: common content-width/header/spacing/type/control rules, **naturally expanding content**. Short outcomes remain compact; long forms and 200% text wrap/scroll. Content heights are not rigidly identical.
- Q17/Q18: shared frames and whole-system outcome presentation; reuse existing Base UI/Tailwind tokens/controls. CVA is a bounded typed-class option for genuinely repeated delivered variants. Sign-in/reauthentication/sign-out pending or unknown use a central compact single-column Auth canvas on mobile/desktop, without a large management sidebar/split brand panel. Preserve branding and true retry/return actions. Account password changes/confirmation retain task context.
- Q19 correction/Q20 confirmation: scan and polish **all Slice 1–2 UI structure**, including Staff person-first workspace, every form/review/summary/dialog, outcomes/recovery presentation and list/detail. Shared modules own presentation rules; each feature retains actual validation, permissions, actor/target/operation and server contracts. Auth is only one covered family.
- Concentrate real repeated responsibilities for locality and leverage. Reuse current field descriptors, ReviewChooser/ReviewEditor and actor-bound postAccountOperation; preserve React state identity and existing TanStack/native form adapters. Static frames remain server-capable, interactive leaves stay client. A long file alone does not justify splitting; do not add a generic recovery engine, replacement framework or standalone design-system package without an actual need.

## Combined architecture planning — Q21

Owner answer: “一併規劃”. Plan common UI/routes together with feature server/client/contracts and existing Hono feature composition. This does not implement future roles/business features, change current policy/URLs, or invoke writing-plans/implementation.

- Retain one application and current `app / components / features / server / shared` roots. Shared modules concentrate actual repeated responsibility; future module folders appear with their tickets, not as empty scaffolding now.
- Keep one HTML root. Proposed URL-transparent public/app groups organize routes; they do not establish authentication or role authority. Public geometry may be shared; protected layout should remain thin enough for root/task/Auth presentation and fresh per-request navigation.
- Root/task/Auth frame rules remain the R9 roles. Feature-owned work state selects presentation; layout inheritance must not force navigation into tasks or a sidebar around unconfirmed sign-out.
- Separate server operations, client flow owners and genuinely shared pure contracts within actual features. Keep existing validation, current authority, actor/target/session/reference and one-time credential responsibilities. Type-only imports from current server files are not a demonstrated runtime leak.
- Keep existing Hono `/api/v2` bridge, error/status/JSON contracts and typed inference. Compose actual feature routers; current feature functions remain the shared data/action interface for Server Components and HTTP adapters.
- Use #29 for future Roles, #1/#2 for later uncharted slices, and the explicit #6 email deferral. R9 UI scope remains the 40 delivered subflows. No custom permission editor, new design-system package, generic recovery engine or automatic durable mail queue is introduced.

[Concrete module ownership proposal](module-ownership.md) supplies responsibility, current callers, frame interfaces and future ticket stress cases. These file names/placements are recommendations for further grilling, not performed refactoring.

## Authority and preservation

[#30 Revision 11](https://github.com/Noahlw/efcc-system/issues/30) is the published spec authority after the owner invoked to-spec on 5 October 2026. This confirmed brief retains rationale and provenance. Business authorities remain [#1](https://github.com/Noahlw/efcc-system/issues/1), [#2](https://github.com/Noahlw/efcc-system/issues/2), [Access #8](https://github.com/Noahlw/efcc-system/issues/8) and [account lifecycle #7](https://github.com/Noahlw/efcc-system/issues/7) with its delivered children; Email #6 and Roles #29 remain separate.

Preserve authentication versus business access, independent membership/ban states, current server checks, decision privacy, assisted verification/seven-day credentials/first-change gate/one-time handover, actor/action/target-bound recovery, storage failure/same-operation retry, truthful unknown/denied/rejected/completed states, eligible deletion/history, read-only audit and restored-private-page revalidation. UI polish does not silently change endpoints, policy or persistence contracts.

The root [glossary](https://github.com/Noahlw/efcc-system/blob/100bde89af5b8177e7625bd9b36580c0ab254c43/CONTEXT.md) defines approved enrolment separately from attendance. [ADR 0001](https://github.com/Noahlw/efcc-system/blob/100bde89af5b8177e7625bd9b36580c0ab254c43/docs/adr/0001-authentication-and-business-access.md) continues to govern authentication/business access. No new domain term or hard-to-reverse architecture trade-off was resolved; no additional glossary entry or ADR is needed yet.

## Observable acceptance

1. Every one of the 40 subflows records its current production owner, common presentation roles, unique preserved behavior, revised visual evidence and qualification scenario. No UI family is omitted because Auth is polished.
2. Common frames/type/spacing/controls work at 320px, normal phone, tablet, desktop, landscape and enlarged text. Long content/final actions remain reachable; fixed root navigation does not obstruct content; focused work follows Q14.
3. Exercise Home date/list context, Inbox privacy, applicant validation/draft/reconciliation, same-name person selection, confirmation/review/explicit submit, restrictions/deletion, one-time handover and audit. Intentional empty/false values, current actor/target and submitted references remain truthful; layout/modal changes do not accidentally reset drafts.
4. Shared-module checks complement complete-page/flow checks. Qualify the eventual production candidate at the existing Worker/D1/browser seam, including negative/recovery behavior, and compare it with the selected direction and revised design. Synthetic catalogue evidence is not production acceptance.
5. Version the current reference, source/evidence identity and confirmed architecture in #31 before implementation assignment. Design, implementation, independent review, owner approval and release are separate states.

## Evidence and open work

- [Architecture research](architecture-research.md) records existing reuse and official documentation for Next.js, vinext, React, Hono and installed UI/form adapters. [Census](ui-architecture-census.json) retains the 31-TSX inventory and exact-once 40-subflow mapping; these are 11 existing page routes, not 40 routes.
- Current CBM discovery returned all 94 registered projects without an EFCC System match; structural evidence uses narrow source reads. No graph coverage or complete backend audit is claimed.
- [Screenbook](screenbook/index.html), [coverage](screenbook/coverage.md), [qualification](qualification.md) and [manifest](manifest.json) form the one current R11 reference. R9's unchanged primary captures and historical checks are labelled separately from new R11 evidence.
- The auth-unavailable state now uses the shared compact neutral Auth frame, without unverified identity or signed-in navigation. Retry and sign-out were clicked in the native browser. Eight responsive/text cases and keyboard reachability passed; 918 render comparisons changed only this state in three actor/access contexts.
- No production implementation/tests, physical PWA/OS zoom qualification, completed independent code review, merge or release is claimed. The R11 reference remains local until pushed to #31; no remote publication is inferred.

## Confirmation and next route

R10 scope: Q21 owner “一併規劃”. R9 design: owner Q20: “確認全範圍 R9（建議）”. Q1–Q11/Q14 remain settled; Q15–Q18 and the whole-UI scope correction are incorporated above. R11 boundary: Q22 owner “保留提醒＋不自動存草稿（建議）”. Complete R11 understanding: Q23 owner “確認完整 R11 理解（建議）”. These decisions are confirmed; detailed module recommendations may be refined without reopening accepted UI behavior.

User-selected delivery remains eventual implementation in the same #31. Current route: R11 grilling is complete; the required prototype correction and affected-state recheck are complete. Use the consolidated ownership proposal and qualified R11 reference. The owner invoked `to-spec`; #30 has been rewritten in full as Revision 11. The previously requested next route is a separately invoked `to-tickets`; ticket granularity remains for that stage. No code review is requested during this stage. Ticket granularity is not decided here; no separate PRs are inferred. No ticket-authoring, planning or implementation stage has been launched by this publication.

## Readiness review

Revision 11 is **READY for requirements synthesis** after the owner confirmed Q22/Q23. See the [eight-lens review](readiness-review.md) and [qualification](qualification.md).

- B1 is corrected: authentication-unavailable uses the compact neutral Auth frame without unverified identity or navigation. Supported retry/sign-out remain functional fixture actions. Current [desktop proof](verification/desktop.png) and [responsive results](verification/responsive.json) supersede the earlier counterexample.
- B2 is resolved by Q22: custom Continue/Discard for app-controlled navigation, browser-native warning when allowed, no automatic draft persistence; forced closure may lose unsent fields. Passwords remain unpersisted and submitted references keep separate existing protection.
- Preserve stable feature state through frame changes and future route protection/safe-return/navigation/server checks. Exact edit paths and empty future modules are not prerequisites for the spec.

The consequential grilling frontier is empty, and the known reference correction has been rechecked. Spec synthesis/publication is complete at #30 Revision 11. Next stage is the separately invoked `to-tickets` route. This status does not claim production code acceptance or release readiness.
