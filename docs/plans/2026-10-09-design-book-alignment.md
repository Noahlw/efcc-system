# Design Book alignment — per-issue execution plan

Plan revision: 1 Status: READY — the user confirmed the complete Plan revision1 in Q11 on 9 October 2026. Product scope is confirmed Understanding Revision2 (Q9); staged owner checkpoints are confirmed in Q10. Planning readiness is not implementation proof; `implement` has not been invoked.

## Context and authority

### Outcome and controlling records

Make the delivered EFCC app faithfully follow the unchanged R11 Design Book for all40screens/subflows and the306-state map, with the explicitly approved deviations below. Correct actual UI behavior and shared/private responsibility, not just screenshot styling. Deliver source-bound functional proof, a per-issue disposition record and an updated offline Workflow Gallery.

- [Confirmed understanding R2](../../.scratch/design-book-alignment/understanding.md) is the canonical rationale, preservation and correction record.
- [Verified gaps and confirmed repair scope](../../.scratch/design-book-alignment/gap-inventory.md) defines G01–G08, S01–S40 and A01–A08, with exact source and comparison evidence. This plan gives execution and acceptance for every ID; do not replace those repairs with an agent-inspection assignment.
- [#30 Revision11](https://github.com/Noahlw/efcc-system/issues/30) and `docs/design/slice-1-2-ui/screenbook/{index.html,render.mjs,screens.mjs,foundation.css,app.css}` are UI authority. Retain the Book unchanged. The old Workflow Gallery is actual implementation evidence, not design authority; issue CLOSED state proves neither fidelity nor runtime acceptance.
- [#46](https://github.com/Noahlw/efcc-system/issues/46) and delivered feature contracts remain business/library-integration authority. Do not resume its obsolete qualification continuation or repeat integrated tickets.
- [Domain glossary](../../CONTEXT.md): Account, Username, Full Chinese name, Membership status, Security ban, Temporary password, Temporary-password expiry, Credential handover, Program/Event/Enrolment. [ADR0001](../adr/0001-authentication-and-business-access.md) governs authentication versus business access. Reversible presentation seams do not warrant a new ADR. This plan changes no business lifecycle.

### Explicit authority reconciliation — do not reopen these decisions

| Decision | Controlling correction and preserved authority |
| --- | --- |
| Q1 | Same viewport, role/access and corresponding state; faithful type/color/spacing/icons/copy/controls/hierarchy. No fixed-environment pixel-diff gate. Truthful data/browser wrapping differences are documented, not used to excuse missing UI. |
| Q2 | Map all306states; exercise every screen and unique reachable state. True shared states may use representative real-boundary proof plus consumer mapping. Reference renders/owner mappings are not production passes; an unresolved material discrepancy blocks completion. |
| Q5 / S04,S09 | Retain Check → Review → Submit for both own-phone and applicant correction as approved Book deviations. Preserve [#50 recipe2](https://github.com/Noahlw/efcc-system/issues/50) frozen applicant review and [#56 recipes1/5](https://github.com/Noahlw/efcc-system/issues/56) immutable own-phone/Staff review and dirty/review/confirmation context. Other sensitive review/confirmation remains. |
| Q6 / S21,A08 | Original issued credential expiry may be added as minimal non-secret read-only response metadata. This is the explicit narrow override of #30 Out of Scope's response-contract prohibition and #46 Implementation Decisions3/10's public-contract preservation clauses. No new endpoint/database schema/policy; no plaintext replay. All other contracts remain. Do not estimate expiry from receipt time+7days or a current/pre-write account snapshot. |
| Q7 / S21 | Keep quiet secondary Copy as an approved UX deviation, acknowledgement/completion restored, manual-selection fallback and one-time guards preserved. #54/#55 still govern original issuance/reissue privacy. |
| Q8 / S38,A07 | Auth errors reuse common Auth geometry/brand; App/Task errors use Book focused neutral geometry. One shared Book-aligned body/copy/controls. No unverified identity or protected navigation; retry remains caller-owned and safe. |
| Q10 | Execute six major waves. After each wave, present the issue-level evidence and wait for the user's explicit approval before the next wave. A checkpoint is not task completion. Full-plan confirmation does not start `implement`. |

These are confirmed later user corrections, reconciled here and in the canonical brief. Do not ask an implementer to resolve a hidden conflict with an older spec, and do not modify/publish GitHub specs as part of this plan.

### Effective checkout and observed baseline

Repository: `/Users/noah.wong/.codex/worktrees/ui-redesign-grilling/efcc-system`.

- Observed HEAD/base: `bc82c48c72f791c42abd1453d0daaba1e11bc84b`, branch `codex/tanstack-query-foundation`. Already a linked worktree; reuse it. Do not create another checkout/worktree or rewrite/amend earlier ticket history.
- Working tree was clean before planning documentation. This stage added established business terms in `CONTEXT.md`; this plan is a new document. Preserve those and all later unrelated work. Reinventory once at implementation start; never reset/stash unexpected work automatically.
- Node24.21.0 and pnpm10.33.2 observed; installed dependency versions are pinned in `package.json`/lockfile. Use pnpm and Node; no package/browser upgrades or new framework/design-system dependency.
- Prior source comparison:107production-code files matched the qualified old capture source; two filesystem `.DS_Store` extras were excluded and untouched.
- [Inspection evidence](file:///Users/noah.wong/orca/efcc-system/.scratch/design-book-alignment/evidence/inspection-2026-10-09T041107650Z/) includes original paired PNGs, source/reference identity, source/caller evidence, state-owner map and machine findings. All306reference states rendered in Chromium; this is not306production executions.
- Previous personal visual adjudication covered all40Pixel7pairs, not all40WebKitpairs. Desktop adjudication covered Home/person/applications only. Available WebKit PNGs are not adjudication. Close these explicit holes on the changed candidate; do not claim prior platform-wide fidelity.
- [Old gallery evidence](file:///Users/noah.wong/orca/efcc-system/.scratch/library-integration-refactor/evidence/workflow-gallery-bc82c48-2026-10-09T021915170Z/) has40primary+26additional screens,396PNGs and22functional journeys. The recorded macOS WebKit native-select25px<52px finding remains historical failure evidence. Restore Book choice cards, not an appearance patch or weakened metric. No physical iOS/PWA/keyboard/native zoom certification exists.
- Structural discovery used CBM project `Users-noah.wong-.codex-worktrees-ui-redesign-grilling-efcc-system`, generation2026-10-08T16:15:54Z,38evidence paths metadata-match, best-effort only; native TypeScript LSP supplied callers. CSS/migration parse limitations and excluded capture-runtime copies are recorded. Do not use stale alias `efcc-system-ui-rework`.

All paths below are repository-relative. Line anchors are discovery hints, not patch authority: reread current sections and use LSP references before changing exported/shared interfaces.

Table shorthand: bare account feature filenames resolve under `src/features/account/`; `page-frame.tsx` resolves under `src/components/`, `app-form.tsx` under `src/components/ui/`, and `globals.css` under `src/app/`. `staff/account-audit/page.tsx` means `src/app/staff/account-audit/page.tsx`. The restrictions rows' “sameG” means G01/G03/G04/G06. These are verified file locators, not guessed new modules.

### Integration, state and publication restrictions

One integration owner owns shared contracts, consumer migration, candidate identity and acceptance. Bounded implementation may be delegated only against these settled issue entries; no child invents design direction or reruns discovery as the deliverable. Shared changes land before dependent consumers; do not run overlapping writers/checks on the same files/runtime. Preserve server-capable presentation and private client leaves.

No commits, pushes, new GitHub issues/comments/status changes, PR publication, merge, deployment or remote D1 actions are authorised by this plan. Repository hooks remain enabled. Use a base SHA plus exact intended-source/test/document content fingerprint for uncommitted candidates; never label base SHA alone as proof of an uncommitted changed tree. Include intended new files in the fingerprint, exclude generated/runtime/secrets, and identify unrelated work separately. Any relevant change during gates invalidates the candidate.

Before ANY `pnpm test:e2e` invocation, see the protected-state protocol in Verification: the script unconditionally deletes local D1. Do not run it during planning or to reconfirm old reports.

## Ordered changes

### Step0 — open the task without disturbing evidence

1. Read this plan, confirmed R2, current issue bodies/comments and repo instructions. Confirm actual branch/base, current dirty/new files and the unchanged Book identity. Preserve all unexpected work; reconcile a moved source with the pinned findings instead of overwriting it.
2. Establish one external candidate evidence directory under the existing `.../orca/efcc-system/.scratch/design-book-alignment/evidence/` initiative, with a unique timestamp and source fingerprint. Preserve old gallery, inspection PNGs, reports and failure records. Do not regenerate the Book or overwrite old captures.
3. Seed the issue-disposition record with all56IDs (8G+40S+8A), their owner/dependency, initial finding and expected check. Add the306-state map. Statuses must distinguish pending, repaired, preserved, approved deviation, actual check result and unresolved issue; a captured image is not a functional pass.
4. Use existing installed environment and local test seams. Set up state protection before any destructive E2E/capture run. Do not copy original member data/session state into a shared gallery; synthetic records only.

### Wave1 — shared rules and stable interfaces

Implement the shared G interfaces at their existing seams and migrate every affected caller coherently in this wave; do not leave aliases or incompatible consumers. The account domain supplies rows/actions/eligibility; shared presentation must not read authorization, run commands or retain operation/secret state. Feature-specific composition/content is completed in its assigned later wave.

A01–A04 are foundational dispositions; A05/A06/A08 execute with Wave4 private phases/metadata. A07's pure body interface can land here, while real failure/denied integrations complete in Wave5. References to later A/S IDs below identify the required consumer responsibility and final proof, not a circular forward build prerequisite. At checkpoint1, a G issue with unfinished leaf consumers is recorded as “shared seam integrated; consumer fidelity/proof pending”, not fully closed. Later waves explicitly close those linked consumer findings before final qualification.

| ID | Verified entrypoints and change | Dependencies / caller contract | Observable wave proof |
| --- | --- | --- | --- |
| G01 | `src/components/page-frame.tsx`, `src/app/globals.css`, `src/app/(auth)/layout.tsx`, `src/app/(task)/layout.tsx`: restore Book role-specific canvas, widths, gutters, scrolling and intrinsic navigation space. Keep `src/app/layout.tsx` HTML/body/QueryProvider thin. | A01; retain `PageFrame`/`RootFrame` responsibilities, stable children/controllers. Root72rem, task40rem and auth28rem rules follow actual reference; no universal shell, blanket white Auth or fixed content heights. | Root Home/Account, long public form and focused Staff task show the correct canvas/scroll region; controls remain reachable at320px/landscape/200%; root nav does not overlap content, Task has no bottom nav. |
| G02 | `src/components/primary-navigation.tsx`, role layouts and `src/features/account/staff-management-workspace.tsx`: restore shared brand/icon/navigation-row/tabs presentation and Staff order Home/Inbox/Management/Account. Reuse existing licensed Book icon assets and retain their license notice; no new icon package. | G01. Current server/caller supplies safe known viewer context and permission-filtered destinations. Brand is composed only where Book or approved Auth-error variant requires it, not automatically repeated on every Task/long form. | Allowed Member/Staff/restricted viewers see correct labels/icons/order and active destination; no unauthorized link/data introduced; mobile and desktop brand/actor presentation corresponds to their permitted state. |
| G03 | `page-frame.tsx` and existing `staff-task-frame.tsx`/feature views: one pure return/title/target presentation; phases provide truthful text rather than inheriting list/edit titles. | G01/A04/A05. Return control is supplied by the private owner so dirty/safe-return behavior is not bypassed. Migrate repeated headings/legends; no second stateful frame owner. | Edit→review→confirmation→handover/outcome updates heading/context once; Back still warns on dirty work and preserves the selected person/reference. |
| G04 | `globals.css`, `src/components/ui/button.tsx`, `src/features/account/operation-presentation.tsx`: restore Book palette and warning/danger/action roles, including amber `#815716`/`#fff3d9`, reference red and correct primary/secondary hierarchy. | G01/A03. Extend existing typed control roles, not caller-specific overrides. Fields/phone primary52px, secondary48px, effective targets≥44×44; rem scaling/natural wrapping. No label-to-policy coupling. | Real withdrawal/deletion actions are danger styled; UNKNOWN/temporary credential warnings amber; long translated/enlarged labels expand without clipping. Disabled/submitting remains real and distinguishable. |
| G05 | `src/components/ui/app-form.tsx:42-83,205-234`: add shared PasswordField/reveal on existing `createFormHook`/Field seam; migrate signin/apply/password/temp-password/confirmation consumers. | A02/G04. Same value, validation, name/autocomplete and Form registration; local reveal state only. Reveal control must be `type=button`, labelled, keyboard reachable, with decorative icon correctly hidden. No secret persistence/logging. | Type a password, toggle both ways by mouse/keyboard: value/errors remain, no submit/network write fires, label/state changes; form still validates/submits normally and hides/clears secrets according to the original owner. |
| G06 | `src/features/account/operation-presentation.tsx:8-63` plus real repeated target/row/empty presentation: deepen current Summary/Outcome instead of replacing them with another receipt engine. | A03/A04/G03/G04. Account-specific row assembly and metadata permissions remain in callers; intentional empty/false values stay truthful. Pure icons/cards/notices do not own recovery. | Same actual state displays Book paired rows/target/empty/result icon and notices; receipt-only recovery never fabricates identity/password/expiry; enlarged long rows and controls remain readable/reachable. |
| G07 | `app-form.tsx` field-component seam, `identity-form-views.tsx`, `staff-accounts-form.tsx`, `decision-review.tsx`: accessible native/Base UI radio-card/segment presentation, with visible disabled explanations. | A02/G04. Values, choices, eligibility and acknowledgement reset supplied by private Form owner; one live Form. Replace native selects rather than CSS appearance patches; keep server enum validation. | Keyboard and touch select the same submitted method/action; disabled phone verification cannot be selected and explains why; eligibility refresh clears invalid choice/acknowledgement without resetting other draft/reference data; cards meet52px criterion in both engines. |
| G08 | Existing Base UI dialog in `security-form-views.tsx` and `src/components/unsaved-changes-link.tsx`: restore16px phone gutters/rounding/action layout, Continue visually primary/first and Discard secondary. | G03/G04/G05/G06. Preserve current Escape/focus-return/DOM draft behavior; no replacement dialog library or shared business controller. | Keyboard-only confirmation/dirty exit has readable modal content, visible controls and correct focus return; Continue preserves draft, Discard exits only unsent work, unresolved submitted reference is retained. |

#### App design-depth dispositions — each has an explicit owner/check

| ID | Concrete execution / preserve decision | Dependencies and acceptance |
| --- | --- | --- |
| A01 | Preserve thin `src/app/layout.tsx`; deepen existing role frames instead of a universal app shell. | G01. Provider/Form/reference identity does not reset when a view/phase changes; App/Task/Auth remain distinct. |
| A02 | Deepen current `app-form.tsx` field/controls for all eight actual feature consumer files; no extra Form owner or one-implementation factory. | G05/G07. Existing schemas and submit boundaries stay private; reveal/choices exercise existing Form values/errors. Use current LSP consumer list, excluding runtime copies. |
| A03 | Reuse account-shared Summary/Outcome in place (`operation-presentation.tsx`); keep row assembly private. | G06. LSP evidence covers9/8files, not29/28independent screens. All actual consumers migrate; no second global receipt/recovery engine. |
| A04 | Share pure Task header/target/action-row style; keep `StaffTaskDirtyContext`, return permission, selected target and operation binding in `staff-task-frame.tsx`/original feature. | G03/G06; S19,S20–S29. Dirty return and same-name target checks pass without UI owning authority. |
| A05 | In `staff/applications/page.tsx`/`decision-review.tsx` and `staff-accounts-form.tsx`, move phase presentation selection to the stable private flow owner: root list, focused edit/review, exclusive handover/outcome. | G01/G03/G06; S20–S22,S30/S31. Server auth/data remains before client rendering; no keyed remount losing Form/reference. Handover does not co-render disabled recovery editor. |
| A06 | Inline only the three evidenced transparent private Creation/Recovery/HandoverPhase wrappers (`staff-accounts-form.tsx:744-849`) as phase composition is repaired. | A05. Each currently has declaration+one caller; preserve meaningful Form/review/confirmation adapters and hook ownership. No file-splitting/refactor campaign. |
| A07 | Reuse one pure safe-state body from `src/components/unavailable-view.tsx`; caller composes frame, safe retry and allowed exits. Migrate `src/app/error.tsx` and Staff denied branches. | G01/G03/G06; S37–S39, Q8. Remove presentation flag coupling without moving authorization into UI. Auth unknown exposes neither identity nor protected nav. |
| A08 | Repair handover identity and authoritative original issued expiry through the existing write/response/client seam detailed below; retain secret lifecycle private. | A05/G06; S20–S22. Original issuance carries correct stored expiry; duplicates/race recovery/reconcile remain receipt-only. Hide/late-response/reissue guards still prevent secret resurrection. |

Checkpoint1: present shared issue dispositions plus real representative Root/Auth/Task/password/choice/dialog comparisons and affected functional proof. Remaining leaf gaps are explicitly unfinished. Wait for user approval before Wave2.

### Wave2 — Auth/public/status consumers

Each row's owner is the edit entrypoint; migrate its actual shared consumers, not only a standalone mock. Shared dependencies are Wave1 G/A IDs. Function-family names refer to the concrete commands in Verification.

| ID / screen | Owner and dependency | Complete repair | Required input → action → result |
| --- | --- | --- | --- |
| S12 signin | `src/features/auth/sign-in-form.tsx`; G01,G02,G04,G05 | Restore church brand, greeting/Username/tab/signup/help copy and Auth rhythm; add reveal. | Anonymous Username/name modes→toggle/retry/login→matching layout, same-name disambiguation, errors/rate limits/submitting preserved; no invented email/reset/SSO flow. |
| S13 apply | `src/features/account/application-form.tsx`; G01,G03,G04,G05 | Book return/title/hints; collapsed native optional disclosure instead of expanded boxed fieldset; reveal, no repeated policy text. | Fill required and optional data→collapse/open/error/dirty exit/submit→same values/errors, correct storage-before-send, no public shared-phone exemption. |
| S14 apply-result | `application-form.tsx`; G01,G03,G04,G06; S13 | Compact result icon/single heading, actions and known current-operation identity/status summary. | Submit→confirmed/UNKNOWN/check/retry/reload→no automatic login, original capability retained, no invented/persisted identity after it is unavailable. |
| S15 status | `src/app/(task)/status/page.tsx`; G01,G03,G04,G06 | Safe known actor/status card, state-specific Home CTA and quiet sign-out. | Pending/banned/deactivated/combined/active viewer→read/recheck→independent states, active-only permitted Home action, no protected business data exposed. |
| S16 temp-password | `security-form.tsx`/`security-form-views.tsx`; G01,G03,G04,G05,G06 | Book label/amber explanation/reveal/helper/action/cancel hierarchy. | Valid/expired temporary holder→change/retry→expiry/first-change gate and other-session effects unchanged, no membership/security mutation. |
| S40 signout | `src/features/auth/sign-out-button.tsx`; G01,G02,G04 | Book Auth brand/compact pending/unknown controls/help. | Signed-in actor→real signout/held failure/retry/return/history→truthful status and fresh server check before private return; no cached private UI. |

Checkpoint2: include all six rows' actual start/error/result/long-form views as relevant and preservation results; wait for user approval before Wave3.

### Wave3 — Personal/member/applicant consumers

| ID / screen | Owner and dependency | Complete repair | Required input → action → result |
| --- | --- | --- | --- |
| S01 home | `src/app/(workspace)/page.tsx`, `src/features/home/upcoming-events.tsx`; G01,G02,G04,G06 | Restore wordmark/account affordance, calendar/agenda/All/today hierarchy, matching participation empty panel and invitations/notices; remove extra top sign-out. | Approved enrolment/pending/waitlist/empty/day selection→filter/week/All→only real authorised upcoming Events in Hong Kong dates; no fake fixture markers or attendance claim. |
| S02 inbox | `src/app/(workspace)/inbox/page.tsx`; G01,G02,G06 | Matched empty mail panel, access disclaimer/status action and navigation; remove extra sign-out. | Approved/rejected/no-visible-reason/empty actor→open decision→correct public reason or truthful absence, never Staff private note. |
| S03 account | `src/app/(workspace)/account/page.tsx`; G01,G02,G06 | Inline profile, paired summary, section rhythm and icon/chevron/help destinations. | Member/Staff/restricted/temp actor→navigate permitted tasks→accurate identity/status/eligibility and correct root/task frame, no new authority. |
| S04 phone | `identity-form.tsx`/`identity-form-views.tsx`; G01,G03,G04,G06; S03 | Book return/title/target/full-width actions and edit/review/result presentation. Keep approved extra Review. | Own permitted actor→edit/check/back/review/submit/unknown→immutable reviewed payload, field error/draft preservation and original-operation reconciliation; no Staff flow substitution. |
| S05 security | `security-form.tsx`/`security-form-views.tsx`; G01,G02,G03,G06 | Unconfirmed/valid-confirmation notice and divided icon/help destination rows. | Current actor→confirm/current validity/expiry/change tasks→actual confirmation state and distinct password/session actions; no invented device list. |
| S06 password | Same security owners; G01,G03,G04,G05; S05 | Three reveals, hint placement, field/header rhythm and correct action state. | Current/new/repeated fields→reveal/mismatch/submit→values preserved, current login remains, other sessions invalidated according to existing policy; loss stays UNKNOWN. |
| S07 sessions | Same security owners; G01,G03,G04; S05 | Cancel, notice tone, task header and action grouping. | Current+other sessions→Cancel then explicit revoke→Cancel sends no command; revoke preserves current login and original reconciliation behavior. |
| S08 application | `src/app/(task)/application/page.tsx`, `src/features/account/applicant-form.tsx`; G01,G02,G03,G06 | Pending badge/open summary/Edit row plus status/inbox footer links. | Eligible/ineligible applicant, each actual status→open destinations→only current-policy actions; no approval/absence inferred from empty data. |
| S09 app-edit | `applicant-form.tsx`; G01,G03,G04; S08 | Fixed Username context, field hints and phase/action presentation; remove duplicated email-policy copy. Keep approved Review. | Edit/check/back/confirm→immutable reviewed payload (#50), Username unchanged; empty/false fields and dirty guard preserved, no email recovery enabled. |
| S10 app-withdraw | `applicant-form.tsx`; G01,G03,G04,G06; S08 | Single review title, amber warning, red action, Book primary/cancel order. | Eligible pending actor→Cancel/withdraw/held response/reconcile→no Cancel write, explicit withdrawal only, original actor/key/reference and conflict preserved. |
| S11 app-resubmit | `applicant-form.tsx`; G01,G03,G04,G06; S08 | Single heading, notice tone, action/copy order. | Rejected/withdrawn actor→review/resubmit/unknown→returns to approval workflow, never automatic approval; original reference and eligibility retained. |

Checkpoint3: provide all11issue results and Member/Staff/restricted context comparisons with relevant validation/dirty/UNKNOWN evidence; wait for user approval before Wave4.

### Wave4 — Staff workspace, phases and original-issuance metadata

Execute within this wave in dependency order: workspace/target selection → stable creation/recovery/review/handover composition and metadata → identity/restrictions/deletion → decisions/audit. There is one integration owner; no generic inspection task substitutes for a row.

#### S18 — bounded private client search leaf

`getStaffAccounts` (`staff-accounts.ts:184-258`) returns the full currently authorised roster, without a search-result page limit. `StaffPeopleWorkspace` (`staff-management-workspace.tsx:127-185`) already filters that supplied array with locale-lowercase name/Username matching, but only after a GET form submit. Put the search/list interaction in a narrow feature-private client leaf initialized from `query`, using the same filter and full authorised array. Keep the management menu and server authorisation/data read server-capable; do not mark the whole mixed workspace module client merely for one input. Reuse the private peopleHref/query/selection semantics so choosing/returning from a person retains the current query and stable target; no global store, new Form owner, endpoint or automatic first-result selection. Typing must filter immediately without a page reload, input-focus loss or write command.

This is a reversible client/presentation seam, not a new business policy or ADR. If the source changes to pagination before execution, reconcile that actual read contract rather than pretending a loaded subset is the whole roster.

#### Mandatory A08/S21 response and data path

1. `src/features/account/staff-accounts.ts:createAssistedAccount` (353-489) and `resetStaffPassword` (491-652): existing code writes `account.temporaryPasswordExpiresAt` in the guarded Drizzle batch. Capture that field with the actual insert/update `.returning(...)` at the existing write slot (batch index1), not a later current-account lookup and not arithmetic on the receipt. Preserve the full batch order, conditioned write, final required-receipt assertion and all-or-nothing failure behavior. Return issuance data only after the whole batch and receipt/current actor checks succeed. Installed insert/update returning and D1 BatchResponse declarations support the shape; declarations are not runtime proof.
2. Preserve the existing `{ data: ... }` response envelope. Original successful create/reset/reissue must return `{ data: { receipt, temporaryPassword, temporaryPasswordExpiresAt } }`, with expiry as integer epoch seconds from the actual returned write row. Receipt-only duplicate/race-catch/reconciliation paths return `{ data: { receipt } }`, omit both issuance fields and never query current account state to reconstruct an old issuance. Preserve `data.receipt: null` as confirmed not-found. Do not persist expiry in a new table/local storage or replay plaintext. Convert the returned Date/timestamp using existing conventions; do not change expiry policy or confuse receipt time with deadline.
3. `src/features/account/staff-account-routes.ts:15-25` `credentialResponse` is the shared create/reset/reissue mapper (calls at33/50/59). Extend this mapper, typed Hono response and `staffAccountResponseSchema` in `src/features/account/staff-account-contract.ts:128-133` together. The decoder must distinguish nullable receipt-only from non-null receipt plus plaintext/expiry, and reject incomplete issuance pairs; it must not accept a password without trustworthy expiry as a qualified handover. Migrate every consumer/real contract test in this clean cutover; no envelope/field rename, legacy-shape shim or guessed expiry fallback.
4. Thread the metadata through private `StaffSubmitOutcome`, `sendStaffCommand` and actual credential-response parsing in `staff-accounts-form.tsx:185-235`. Schema references currently include staff form27/226/1014 and `tests/shared/staff-account-contract.test.ts`; update all actual contract consumers using current LSP references, excluding capture-runtime copies.
5. Recovery currently sets handover identity null despite knowing the target (`staff-accounts-form.tsx:1343-1346`). Carry the original reviewed safe human identity with original target/actor/reference to `StaffHandover:249-310`, not a newly selected person or opaque UUID. Creation already has identity; preserve it. Metadata and identity have the same private generation/phase validity as the handover, never a global store.
6. Add private handover-acknowledgement UI state, not a new business request field. Render only handover/outcome for that phase; retain stable controller/Form/reference owners but do not show the disabled recovery editor beneath it. Quiet Copy uses current clipboard behavior and manual-selection fallback. Hide/task exit/reset/late response still invalidates plaintext; returning cannot revive it, and a replacement requires existing verification/reissue. Receipt-only completion explains secret unavailability without guessed identity/deadline.
7. Prove on actual Worker/D1: original response expiry equals the actual stored issuance field; reset/reissue produces the correct new issuance and original response is not rewritten by later account state; duplicate/race/lost-response reconciliation is receipt-only; failed guards roll back effects. If actual D1 returning behavior differs from declarations, diagnose at this seam and preserve atomicity. No fallback to guessed time, current lookup or fake successful metadata.

| ID / screen | Owner and dependency | Complete repair | Required input → action → result |
| --- | --- | --- | --- |
| S17 management | `src/app/staff/accounts/page.tsx`, `staff-management-workspace.tsx`; G01,G02,G06 | Permitted icon rows/dividers and Book Staff nav order; remove extra top sign-out. | Authorised Staff→Management→only delivered permitted work; personal Home remains landing. |
| S18 accounts | `staff-management-workspace.tsx` and its narrow private search/list client leaf; G01,G02,G06; S17 | Management tabs/create shortcut, avatars/chevrons/selection; input-driven filtering of the existing full authorised roster, with unchanged private query/target links and no new search endpoint. | Same-name/search/no-match records→type/filter/select/return→immediate truthful results without reload/focus loss, distinguishable targets, query/selection preserved and no automatic first-result or write. |
| S19 person | `staff-management-workspace.tsx`; G01,G02,G03,G06; S18/A04 | Account-detail title+target card, switch/return placement, paired summary/icon rows and dangerous-actions disclosure. | Selected person→resize/switch/back→existing desktop split preserved; dirty target replacement warned, no auto-selection; missing Username uses existing safe stable-ID fallback. |
| S20 create | `staff-accounts-form.tsx`; G01,G03,G04,G06; S19/A05/A06 | Remove incorrect reset/reissue intro, redundant heading/fieldset; restore labels/help/checkbox/header; stable create→review→confirm→handover. | Verified synthetic creation/shared-phone case→check/review/confirm/submit→correct reviewed target/data, explicit atomic creation, one-time handover; no role configuration. |
| S21 handover | `staff-accounts-form.tsx`, metadata path above; G01,G03,G04,G06; A05/A08,S20/S22 | Exclusive success/receipt phase, reviewed human identity, authoritative expiry, acknowledgement/completion and quiet Copy. | Original create/reset/reissue→copy/manual fallback/acknowledge/hide/late response/reconcile→correct original deadline/identity; completion hierarchy matches approved design; no plaintext reappearance or disabled editor underneath. |
| S22 recovery | `staff-accounts-form.tsx`; G01,G03,G04,G06,G07; S19/A05/A06/A08 | Verification cards/reasons, action cards plus one Check, compact target/status and truthful review/handover phase. | In-person/eligible-phone/ineligible/temporary target→choose/check/reset/reissue→current policy, invalid-method+ack reset and review/confirmation preserved; one original-operation command. |
| S23 identity | `identity-form.tsx`/`identity-form-views.tsx`; G01,G03,G04,G06,G07; S19/A04 | Cards, target card, field order, Username-change help and full-width Check. | Staff selects target→edit blank/false/changed fields/check/confirm/submit→immutable target/review, verification eligibility and atomic change; no skipped empty/false values. |
| S24 restrictions | `src/features/account/restrictions-form.tsx`; G01,G03,G04,G06; S19/A04 | Two independent membership/security cards and state-specific action/target/impact context. | Normal/banned/deactivated/combined/protected target→choose action→truthful independent states and current-policy availability. |
| S25 ban | `restrictions-form.tsx`; G01,G03,G04,G06; S24 | Ban-specific header, compact original target/summary, impact notice and reachable final controls. | Fresh-confirmed Staff→review/cancel/ban/unknown→explicit ban only, membership unchanged, original reference preserved. |
| S26 unban | `restrictions-form.tsx`; sameG; S24 | Unban-specific header, compact target/summary/impact/actions. | Banned/deactivated target→unban→security restriction removed only, membership not reactivated; protected-target checks remain. |
| S27 deactivate | `restrictions-form.tsx`; sameG; S24 | Deactivation-specific header, compact target/summary/impact/actions. | Eligible target→deactivate→membership changes only, no added security ban; confirmation/reference remains. |
| S28 reactivate | `restrictions-form.tsx`; sameG; S24 | Reactivation-specific header, compact target/summary/impact/actions. | Deactivated+banned target→reactivate→membership changes only, ban remains; last-effective-Admin protection unchanged. |
| S29 deletion | `src/features/account/deletion-form.tsx`; G01,G03,G04,G06; S19/A04 | Red irreversible notice, truthful eligibility/history summary, Book check role and final-review acknowledgement placement. Adjust private validation boundaries so review is reachable before final acknowledgement, while final submit still requires it and frozen target/operation. | Eligible/ineligible/protected target→check/review/ack/confirm/submit/cancel→no write before final explicit acknowledgement, current eligibility/last-Admin/history and atomic deletion preserved. |
| S30 applications | `src/app/staff/applications/page.tsx`, `src/features/account/decision-review.tsx`; G01,G02,G03; A05 | App-root list navigation/tabs/compact icon/count/date rows; stable private owner chooses focused editor instead of inherited list title. | Permitted Staff→list/empty/read-failure/select→only eligible pending records; switch list/editor without discarding live review/reference improperly. |
| S31 application-review | `decision-review.tsx`; G01,G03,G04,G06,G07; S30/A05 | Review-specific header/badge/paired summary, decision segments and approval notice. | Actual profile/optional data→approve/reject/back/unknown→conditional fields retained, immutable review, separate applicant-visible/private reasons, no extra password gate for ordinary decision. |
| S32 audit | `src/app/staff/account-audit/page.tsx`; G01,G02,G06 | Management tabs and compact icon/chevron/time rows; remove large duplicate receipt rows/extra sign-out. | Authorised Staff→recent/empty/failure/detail→read-only actual history, correct active nav; no export/edit/backend filtering added. |
| S33 audit-detail | `staff/account-audit/page.tsx`; G01,G03,G06; S32 | Detail title with operation/icon/time, non-duplicated summary and read-only footer. | Known authorised receipt→open detail→truthful actor/target/time/private-note permissions; no password/session/secret exposure. |

Checkpoint4: cover all17Staff rows and A05/A06/A08, including original-issued metadata/atomicity/one-time lifecycle proof, radio-card keyboard/eligibility and desktop person/list/edit phase comparisons. Wait for user approval before Wave5.

### Wave5 — shared-state integration in every real owner

The pure building blocks exist from Wave1; this wave completes their actual private-flow integration. Do not qualify a single feature and infer every consumer works.

| ID / screen | Owner and dependency | Complete repair | Required input → action → result |
| --- | --- | --- | --- |
| S34 confirm | `security-form.tsx`/`security-form-views.tsx`; G03,G05,G06,G08, A04; actual Staff/personal consumers | Book modal gutters/rounding/actor card/reveal and correct background review title. | Actual actor≠target, valid/expired/wrong/unknown confirmation→confirm/Escape/return→draft/review/target preserved, actual session-bound validity, no automatic subsequent business submit. |
| S35 leave | `src/components/unsaved-changes-link.tsx` and real dirty consumers; G08 | Continue visual primary/first, Discard secondary, Book popup/action geometry. | Dirty unsent app navigation/target replacement→Continue/Discard/Escape→correct field/focus/return behavior; refresh/close uses existing browser-native boundary, forced closure has no false persistence guarantee; posted reference is not discarded. |
| S36 operation | `applicant-form.tsx`, `staff-accounts-form.tsx`, `identity-form-views.tsx`, `restrictions-form.tsx`, `deletion-form.tsx`, `security-form-views.tsx`; G01,G03,G04,G06 | Unknown-state heading/intro, permitted original actor/reference rows and notice/summary/actions/footer. | Each actual lost-response family→check/not-found/same-operation retry/denial/storage failure→truthful UNKNOWN/confirmed/not-completed, no new person/key/action or auto retry; receipt-only secret absence remains truthful. |
| S37 unavailable | `src/components/unavailable-view.tsx`, `src/app/unavailable/page.tsx`, actual read-failure consumers; G01,G03,G06/A07 | Matched auth-unknown title/Refresh icon/short-state hierarchy and context-specific body/frame. | Auth unknown or failed protected read→permitted retry→not empty data, no unverified actor/protected nav, safe original destination freshly checked. |
| S38 error | `src/app/error.tsx`, shared pure safe-state body; G01,G03,G06/A07 | Book error copy/icon/controls with approved Auth versus App/Task frame selection; no duplicate error implementation. | Real caught error in Auth and protected Task→reset/retry→safe context/brand and permitted exits, generic user-facing copy without diagnostics or stale private UI. |
| S39 denied | Staff accounts/applications/account-audit server branches; G01,G03,G06/A07 | Focused safe-state icon/title and permitted exit/status controls, not root-work nav/crowded sign-out. | Non-Staff/restricted/stale actor→each protected page/action→no unauthorised data/command; known allowed exits work; no UI authorization engine. |

Checkpoint5: give every shared-state consumer disposition, actual negative/recovery transitions and matched modal/Auth/Task screenshots; wait for user approval before Wave6.

### Wave6 — freeze candidate, prove fidelity and regenerate evidence

1. Freeze the intended changed source/tests/docs and fingerprint, including new files, on the observed base. Make no relevant changes while final gates run. If a fix is necessary, create a new fingerprint, refresh affected review and rerun the full gate block; no older pass overrides a later required failure.
2. Execute final functional commands sequentially using protected local state. Compare actual discovery with existing full inventory; investigate unexpected omissions/skips. Record new test counts rather than pinning historical302/277/other counts. Preserve each attempt uniquely and inspect failures before any rerun.
3. Close the explicit visual coverage gaps: individually adjudicate all40screens in both exact mobile profiles and desktop, plus all40across the existing R11 responsive/200% contexts. Use same role/access/state as reference; explain synthetic values/browser typography separately from defects. Record each screen/context verdict and approved deviation. No pixel-diff gate, no self-generated replacement design, no claim based only on image load/dimensions.
4. Complete the306-state map with actual scenario/representative proof and consumer mapping. Each unique state must be exercised at the real app seam; do not create306permanent tests merely to echo the fixture catalogue. Unreachable/current-policy conflicts are explicit blockers until resolved, not silently passed. Verify empty/loading/denied/failure/review/submitting/UNKNOWN/outcome/secret-unavailable transitions, not just start images.
5. Capture all40primary and required actual extra phases in iPhone15Pro WebKit393×852,DPR3 and Pixel7 Chromium412×915,DPR2.625 profiles. Use installed engines, actual Worker/D1 app and synthetic records. Start/final-control viewport captures are required; full-page long-form captures may supplement them when genuinely captured. A bounded long audit view must not be labelled an uncropped full document. Mask all credential values at capture, including one-time plaintext and password fields temporarily revealed during UI checks; independently record reveal behavior without publishing the value. Do not embed cookies/local configuration/traces/plaintext in the HTML. OS/browser chrome/keyboard/PWA/native zoom remain unqualified.
6. Reuse the existing gallery-builder pattern in a new candidate evidence directory, with the new source fingerprint/manifest/scenarios and original PNG bytes; do not patch the old gallery or Book. Keep generated-script `node:vm.Script` compile gate before publish, device/state/copy captions honest, source paths/checksums and limitations visible. Show the approved Review/Copy/Auth-error variants explicitly. Original select finding remains historical; current choice-card metric is separately exercised in both engines.
7. Open the generated offline HTML with the browser: decode/hash every embedded PNG, verify all screen/mode/device selections show the correct actual image, and exercise search/no-results/prev-next/history/deep-links/original-image dialog/focus return at desktop/mobile widths offline. Inspect real rendered surfaces and page errors; tests/asset existence alone are insufficient. Close audit-only servers/tabs; preserve a requested user-facing viewer.
8. Reconcile all56issue dispositions and every acceptance item. Owner checkpoint6 contains final candidate identity, commands/counts/results, per-screen/context verdicts, state mapping, allowed deviations, gallery locator, state-restoration evidence and any blocker. User confirmation is owner acceptance, not merge/deployment/physical-device qualification.

## Verification

### Protected local-state protocol — required for each E2E invocation

`package.json:test:e2e` runs `pnpm db:reset:local` before Playwright; `db:reset:local` executes `rm -rf .wrangler/state/v3/d1`. `playwright.config.ts` uses one worker and no reused server. `tests/scenarios/local-env.ts` resolves `E2E_PORT` (default5199) and only creates `.dev.vars` if absent. Do not treat these commands as non-destructive smoke checks.

1. Before the first new run, preserve existing `test-results/` including failure traces, `.last-run.json` and R11 attachments externally. Preserve subsequent attempts before another run replaces them. Auth-bearing artifacts remain local; never commit/upload them.
2. With no process using THIS checkout's D1, back up its complete `.wrangler/state/v3/d1` directory and sidecars outside the checkout; record initial absence if applicable. Preserve `.dev.vars` exact bytes/absence without printing secrets. Each checkout must use its own backup; never use another runtime's state.
3. Check port5199 ownership before starting an owned server. Never kill unrelated listeners. If occupied, choose a free already-supported local port and record actual `E2E_PORT`/base URL consistently; do not change secrets/trusted-origin policy speculatively. Serialize every focused/full/capture invocation; no overlap with other work using this checkout.
4. Run with the existing reset/migrations and synthetic fixtures. In `finally`, stop only the owned server, restore D1/.dev.vars bytes or original absence, and byte-compare the restored directory with its backup (`diff -qr` or exact file manifest). Preserve artifacts before restoring prior test-results if restoring that directory is needed. Failure/teardown must not mask the original test result; if restoration fails, report it as a blocker rather than claim data preservation.
5. Use installed Node/pnpm/browsers. No remote migration/data/deploy, package upgrade or plaintext evidence leak. A healthy run is not interrupted for advisory-only cleanup.

### Focused functional commands — expected checks, not already-run results

Use the relevant completed wave's files, once its changes are integrated, with the protocol above. Do not run every command redundantly at every checkpoint. `E2E_PORT=5199` below assumes that port is available; record the actual chosen value.

```sh
# Auth/public/status and password-entry behavior
E2E_PORT=5199 pnpm test:e2e name-sign-in.spec.ts account-application.spec.ts restricted-status.spec.ts access-foundation.spec.ts

# Personal/applicant/security/reference preservation
E2E_PORT=5199 pnpm test:e2e home-participation.spec.ts home-notices.spec.ts account-identity.spec.ts account-applicant.spec.ts account-security.spec.ts

# Staff original issuance, identity, independent restrictions, deletion, decisions and clock/atomicity boundaries
E2E_PORT=5199 pnpm test:e2e account-assisted.spec.ts account-identity.spec.ts account-restrictions.spec.ts account-deletion.spec.ts account-decisions.spec.ts account-clock-matrix.spec.ts

# Real failed reads/denial and presentation context
E2E_PORT=5199 pnpm test:e2e guard-failures.spec.ts zz-worker-faults.spec.ts r11-ui.spec.ts
```

The filenames above exist and collect real app families; confirm nonzero actual collection. Adapt existing UI choreography for choice cards, segments, optional disclosure, final-review acknowledgement and phase titles; do not remove controls/flows from the test or loosen eligibility/metric assertions. `r11-presentation.ts` must scroll the actual RootFrame content region if it changes, not an obsolete document-scrolling assumption; keep all eight contexts and obstruction/reflow/draft assertions.

Existing critical scenarios to retain include assisted concurrent command/reissue/lost-response/handover hide/same-name cases, identity phone-review/intentional empty-false/draft refresh, applicant dirty/storage failure, security exact-Request cancellation before destination release, restrictions last-Admin/independence, deletion durable history and decisions public/private reason separation. Boundary failures are diagnosed, not hidden by timeout increases/forced clicks/skips.

Permanent tests are added only for plausible consumer-visible uncertain behavior introduced here: authoritative original-issued expiry/non-replay, reveal preserving value and not submitting, exclusive phase/hide/late-plaintext lifecycle, or verification-choice invalidation. Existing contract tests are updated only for the real changed response invariant. No source-text/copy/wiring/forwarding/mock-echo tests, no repinning incidental wording, no fixture-count/length-growth claims as behavior proof. Visual copy/layout fidelity uses actual captured comparison and owner review.

### Final same-candidate gate block

Run sequentially on the frozen source fingerprint, with state protection for the final browser command:

```sh
pnpm check
pnpm typecheck
pnpm test
pnpm build
E2E_PORT=5199 pnpm test:e2e
```

Save commands, stdout/stderr, exits, timestamps/durations, actual collection/skips, source identity, migration result and state restoration under a unique attempt directory. Existing typecheck generates local Worker declarations; identify generated output separately from intended source. Retain installed-vinext warnings honestly. Inspect the completed run and actual candidate surface; no old qualified base/tree or reference checker substitutes for the new gates.

### Presentation and functional acceptance matrix

| Requirement | Starting context / action | Required observable proof |
| --- | --- | --- |
| Role-frame fidelity | All40screens, matching role/state, both phone profiles and1440×1024desktop | Book-correct canvas/brand/nav/header/width/spacing/icons; focus/task/root separation; approved exceptions named. Every context has an actual visual verdict, not only a PNG. |
| Responsive/enlarged behavior | All40screens at390×844,1440×1024,320×568,768×1024,1024×768,844×390, plus320×568 and1440×1024with200%root-font | No horizontal clipping/obstructed nav/final controls; long text and modal/summary reflow; screenshots remain browser/root-font emulation, not OS enlargement. |
| Form/choice semantics | Enter values/errors, reveal passwords, collapse optional disclosure, keyboard-select verified method/action | Values/errors/registration survive presentation changes; reveal does not submit; disabled method explains why and is rejected; refreshed eligibility clears only invalid choice/ack. |
| Stable phase ownership | Target/edit→review→confirm→handover/outcome, then back/hide/reload where supported | Correct single title/target and exclusive phase; no remount losing private state/reference; immutable review and explicit final action retained. |
| Issued expiry and handover | Actual create/reset/reissue, concurrent/duplicate/lost responses, then hide/task-exit/late result | Original successful response matches actual stored issuance deadline, not current account/receipt arithmetic; no replay on receipt-only paths; original target identity; no hidden plaintext revived; Copy/manual fallback and acknowledgement work. |
| Authority/privacy | Non-Staff/restricted/temp/stale actor and target changes | Existing denial/eligibility/server/clock/atomicity checks remain; no unauthorized nav/data/note/command or caller-supplied actor trusted by shared UI. |
| Recovery/unknown | Actual write committed but response lost; missing/denied/storage-failure reconciliation | Original actor/action/target/key retained; truthful unknown/not-completed/confirmed; no auto retry/new operation/ref discard or secret reconstruction. |
| Candidate evidence | Open new offline gallery and compare issue record with source/scenarios | Exact current PNG bytes and source fingerprint, complete screen coverage/labels, functional results distinct from design verdicts; all approved deviations visible; old evidence preserved. |

### Owner checkpoint payload and stop rule

Each wave presents: (a) completed G/S/A IDs and changed files/contracts, (b) matched Book/current screenshots and actual interaction results, (c) affected-consumer coverage and preserved states, (d) remaining issues/deviations, (e) source fingerprint and protected-data restoration where tests ran. Do not claim the entire app is done at checkpoints1–5.

Block the next wave while awaiting the user's explicit approval. If the user rejects a result, repair the specified issue in the current wave and refresh its affected proof; do not restart already-approved unrelated discovery. A material new product/safety contradiction is returned for grilling, never hidden in implementation. Minor reversible mechanics follow existing conventions.

## Implementation handoff

After this plan is confirmed, the user separately invokes `implement` on `docs/plans/2026-10-09-design-book-alignment.md` in `/Users/noah.wong/.codex/worktrees/ui-redesign-grilling/efcc-system`.

Authority: confirmed Understanding Revision2, unchanged R11 Book/#30, feature contracts/#46, the exact Q5–Q8 corrections and Q10 owner checkpoints. Outcome: complete56issue dispositions, faithful40screen/306state coverage, corrected shared/private seams, truthful original-issued metadata and a source-qualified offline Workflow Gallery.

First action: inventory the current linked checkout against base `bc82c48c72f791c42abd1453d0daaba1e11bc84b`, preserve all existing/added documentation and unrelated dirty work, open unique external evidence and issue records, and prepare the protected-state protocol. Then execute Wave1 at existing `page-frame.tsx`/`globals.css`/navigation/Form/Summary/dialog seams with current LSP consumer migration. Do not make another worktree, rerun old baseline tests to reconfirm findings, amend old ticket commits, modify the Book, copy its synthetic controller or add new framework/state stores.

Preserve all validation, per-request authorization, current independent statuses, target/review/confirmation, typed RPC/Drizzle atomicity, original-operation/UNKNOWN and one-time secret guards. The only response extension is authoritative original issued expiry at the existing write/mapping/client seam; no new endpoint/schema/policy or guessed/replayed data. Verify real app behavior and current candidate design separately using the commands/matrix above. Present checkpoint1 and wait for the user's approval before Wave2; apply the same stop rule through checkpoint6.

No commit, publication, merge, deployment or remote-data authority is added. A confirmed/ready plan is permission to hand off to a separately invoked implementation stage, not proof of implementation or permission to skip owner checkpoints. Return actual unresolved decisions/external prerequisites, not generic inspection assignments.
