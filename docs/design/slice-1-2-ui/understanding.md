# EFCC UI redesign — understanding brief

Revision: 9 Status: CONFIRMED by the owner in Q20 on 5 October 2026 Storage: source in local scratch; durable Revision 9 reference in PR #31

## Goal and delivery

Redesign and polish the **whole delivered Slice 1–2 UI and its code structure** as the system's reusable presentation foundation. Auth is one family, not the scope limit. Cover all 31 tracked TSX UI modules and all 40 designed screens/subflows: Home, Inbox, Account/status/security, public application and applicant maintenance, Staff account work, approval, identity/recovery/restrictions/deletion, audit and shared states.

Continue existing draft [PR #31](https://github.com/Noahlw/efcc-system/pull/31) through design and eventual implementation in the same branch. Q15 preserves #31: local `feat/ui-rework` tracks remote `codex/ui-redesign-grilling`, because GitHub head-branch renaming closes an open PR. Push explicitly to that retained head. The prior PR head was `7342415df7bfab2e68743151dac86570d8ee0c55`; production baseline is `100bde89af5b8177e7625bd9b36580c0ab254c43`. Branch/title/body and OPEN/DRAFT state were verified. Production implementation has not started.

## Accepted design and architecture

- Q1/Q2 and creative-rebuild clarification: legacy [EFCC](https://github.com/Noahlw/efcc) is inspiration; redesign every delivered Slice 1–2 screen. Later Slice 3–8 capabilities remain separately specified.
- Preserve the selected second calm-teal agenda direction. Exact selected image: `selected-home-v1.png`; semantic refinement: `selected-home-v2.png`. Accepted behavior takes priority over generated copy.
- Q3/Q6/Q10: Home defaults to all authorised upcoming Events for approved enrolment, with Hong Kong date filtering, future weeks and All reset. Pending/waitlisted Programs remain separate; no new past-event access. “報名已批准” describes enrolment, not attendance.
- Q4/Q9: Staff land on personal Home with a permitted Management entry. Home retains participation/invitations/notices; Account groups personal details, status, application and security. Preserve existing information/destinations.
- Q5: Staff search/select one person before choosing work; keep name/Username and target context through edit/review/result. Same-name people remain distinguishable; creation is separate.
- Q7/Q8: confirm current password within the work, preserve actor/session/person/action and the ten-minute policy, then return to review for separate explicit submission. Warn before leaving/replacing an unsent dirty draft; submitted uncertain operations retain their original reconciliation reference.
- Q11/Q14 and reconfirmation: mobile roots have viewport-fixed bottom nav with reserved space. Focused forms/person/review/sensitive work hide it and use one return/title row. Desktop has sidebar/wider work areas; tablet follows mobile destinations. Avoid a repeated separate brand row above every task.
- Retain R8 scalable roles: body 17, label 16, meta 14, section 20, task 22, root 28/32; mobile primary CTA/fields 52, secondary 48, effective targets at least 44×44. Roles use rem and remain readable/reachable with safe areas, landscape and enlarged text.
- Q16: common content-width/header/spacing/type/control rules, **naturally expanding content**. Short outcomes remain compact; long forms and 200% text wrap/scroll. Content heights are not rigidly identical.
- Q17/Q18: shared frames and whole-system outcome presentation; reuse existing Base UI/Tailwind tokens/controls. CVA is a bounded typed-class option for genuinely repeated delivered variants. Sign-in/reauthentication/sign-out pending or unknown use a central compact single-column Auth canvas on mobile/desktop, without a large management sidebar/split brand panel. Preserve branding and true retry/return actions. Account password changes/confirmation retain task context.
- Q19 correction/Q20 confirmation: scan and polish **all Slice 1–2 UI structure**, including Staff person-first workspace, every form/review/summary/dialog, outcomes/recovery presentation and list/detail. Shared modules own presentation rules; each feature retains actual validation, permissions, actor/target/operation and server contracts. Auth is only one covered family.
- Concentrate real repeated responsibilities for locality and leverage. Reuse current field descriptors, ReviewChooser/ReviewEditor and actor-bound postAccountOperation; preserve React state identity and existing TanStack/native form adapters. Static frames remain server-capable, interactive leaves stay client. A long file alone does not justify splitting; do not add a generic recovery engine, replacement framework or standalone design-system package without an actual need.

## Authority and preservation

[#30 Revision 8](https://github.com/Noahlw/efcc-system/issues/30) remains the published UI spec until separately rewritten. Business authorities remain [#1](https://github.com/Noahlw/efcc-system/issues/1), [#2](https://github.com/Noahlw/efcc-system/issues/2), [Access #8](https://github.com/Noahlw/efcc-system/issues/8) and [account lifecycle #7](https://github.com/Noahlw/efcc-system/issues/7) with its delivered children; Email #6 and Roles #29 remain separate.

Preserve authentication versus business access, independent membership/ban states, current server checks, decision privacy, assisted verification/seven-day credentials/first-change gate/one-time handover, actor/action/target-bound recovery, storage failure/same-operation retry, truthful unknown/denied/rejected/completed states, eligible deletion/history, read-only audit and restored-private-page revalidation. UI polish does not silently change endpoints, policy or persistence contracts.

The root [glossary](https://github.com/Noahlw/efcc-system/blob/100bde89af5b8177e7625bd9b36580c0ab254c43/CONTEXT.md) defines approved enrolment separately from attendance. [ADR 0001](https://github.com/Noahlw/efcc-system/blob/100bde89af5b8177e7625bd9b36580c0ab254c43/docs/adr/0001-authentication-and-business-access.md) continues to govern authentication/business access. No new domain term or hard-to-reverse architecture trade-off was resolved; no additional glossary entry or ADR is needed yet.

## Observable acceptance

1. Every one of the 40 subflows records its current production owner, common presentation roles, unique preserved behavior, revised visual evidence and qualification scenario. No UI family is omitted because Auth is polished.
2. Common frames/type/spacing/controls work at 320px, normal phone, tablet, desktop, landscape and enlarged text. Long content/final actions remain reachable; fixed root navigation does not obstruct content; focused work follows Q14.
3. Exercise Home date/list context, Inbox privacy, applicant validation/draft/reconciliation, same-name person selection, confirmation/review/explicit submit, restrictions/deletion, one-time handover and audit. Intentional empty/false values, current actor/target and submitted references remain truthful; layout/modal changes do not accidentally reset drafts.
4. Shared-module checks complement complete-page/flow checks. Qualify the eventual production candidate at the existing Worker/D1/browser seam, including negative/recovery behavior, and compare it with the selected direction and revised design. Synthetic catalogue evidence is not production acceptance.
5. Version the current reference, source/evidence identity and confirmed architecture in #31 before implementation assignment. Design, implementation, independent review, owner approval and release are separate states.

## Evidence and open work

- [Architecture research](architecture-research.md) records source friction/reuse and official Context7/web guidance for CVA, Base UI, Tailwind, React, TanStack and WCAG. [Census](ui-architecture-census.json) checks the 31-module inventory and exact-once 40-subflow mapping. There are 11 existing page routes; design subflows are not 40 standalone routes.
- A read-only explorer inspected all 31 TSX owner/caller/render/state anchors. Related helpers were sampled for UI contracts, not a full API/server/domain audit. Complete CBM pagination found no exact current project among 94 registrations; no generation/path coverage is claimed.
- Temp visual report: `/tmp/architecture-review-20261005T074529Z.html`, with whole-scope before/after diagrams and real existing Sign-in/logout retry captures. It was rendered and checked; its diagrams are proposals, not production UI.
- [Screenbook](screenbook/index.html), [coverage](screenbook/coverage.md), [R9 report](screenbook/audit-r9/report.md)/[manifest](screenbook/audit-r9/manifest.json) contain the revised all-screen reference. R6 is historical. F4 publication is satisfied only once this current packet is committed and pushed to #31; an ignored local preview alone is insufficient.
- No production edits/tests, physical PWA/keyboard/OS zoom qualification, merge or release occurred. Independent candidate review is recorded separately in the durable packet. Earlier R8 CEO READY does not certify R9 or production.
- The subsequent Route Groups/roles question is assessed in architecture-research.md. Shared frames are recommended; URL-transparent grouping remains an implementation tool, with current data/action checks retained. No per-role route tree, role engine or production migration was introduced.

## Confirmation and next route

Owner Q20: “確認全範圍 R9（建議）”. Q1–Q11/Q14 remain settled; Q15–Q18 and the whole-UI scope correction are incorporated above. No consequential architecture choice remains open for this understanding.

User-selected delivery remains eventual implementation in the same #31. Recommended immediate route: revise/recheck **all Slice 1–2 design families** against R9, including Auth drift, then separately invoke `to-spec` to rewrite #30 and the chosen planning/implementation stage. Ticket granularity is not decided here; no separate PRs are inferred. The next stage has not been invoked by confirmation alone.
