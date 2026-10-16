# EFCC foundation programme — shared understanding

Revision: 3

Date: 2026-10-16

Snapshot note: GitHub Issues own current scope and progress. Historical authoring/approval paragraphs describe their original stage; the next implementation run is authorized by the user’s continuation prompt.

Status: Revision 3 records the user-confirmed FB87-01–08 refinements and paging option A, preserving Q1–Q19, all 26 packages and the seven review groups. Issue #87 is updated to R3. The user approved the consolidated 19-ticket breakdown and publication. All 19 native sub-issues are now published and verified; implementation has not started. The R2 CEO review below is historical authoring evidence, not a review of new implementation.

Artifact: portable snapshot of the shared understanding, prepared from the repository-local working brief. The complete R3 programme spec is published as [GitHub issue #87](https://github.com/Noahlw/efcc-system/issues/87), labelled `ready-for-agent`. That issue is the canonical programme scope/progress authority; this brief records rationale and provenance. The approved implementation plans are published as 19 child tickets; no implementation has started.

## Goal and scope

Strengthen the currently delivered EFCC foundation so it is correct, maintainable, bounded in its reads, consistent across its libraries and verifiable at its real boundaries before starting Slice 3. Cover the whole agreed programme together, then divide delivery and review into phases. Do not plan and implement only the first phase while leaving the rest undecided. [Q1–Q6, Q17]

All 26 audit package proposals require an explicit disposition and every agreed change must be completed. Packages may be merged or split. An evidence-backed KEEP is a completed disposition where a change is unnecessary; deferral requires the user's decision. Do not silently drop a proposal, turn every audit suggestion into a mandatory rewrite, or use an arbitrary phase/PR cap. The seven groups below are accepted review groupings, not a fixed ticket or PR count. [Q2, Q5–Q6, Q17]

Whole-repository scope also requires an evidence-backed CHANGE, KEEP or EXCLUDE disposition for every tracked baseline file. Close the unread, partial and dependency-only handwritten code/config/test-contract inspection before `to-spec`; generated metadata and reference assets require provenance and preservation reasons rather than a product rewrite. Explicitly reconcile later added, renamed and removed paths against the final candidate. The original audit's catch-all “resolve only if reached by planned changes” is insufficient for this programme's completion claim. [Q18]

The scope includes application correctness, credential boundaries, shared contracts, presentation consolidation, workflow interfaces, bounded reads, migrations, command ownership, native verification, build/cache contracts, safe diagnostics and retirement/documentation. Preserve delivered business policy and UI behavior except for the explicit changes below. Library adoption is a maintenance choice, not evidence that existing presentation maps are broken.

Out of scope: implementing Slice 3 Roles, a new permissions engine, new recovery/dashboard/queue product scope, production cutover, deployment, remote member-data changes, merging or release. Mixed old/new Worker zero-downtime migration is a separate deployment decision. Do not add dual-write infrastructure to this foundation programme by assumption. Issue #86 remains a separate follow-up unless evidence establishes a causal blocker to a required gate.

## Authority and evidence

- The user's explicit scope, Q1–Q19 and approved FB87-01–08 refinements govern this programme. Existing delivered business and R11 UI contracts remain preservation authority; the external audit is research input, not an approved spec or instruction to execute its packages.
- Research baseline: commit `272dddbc887e7c3343a61831f91833fb687047bc`, tree `fc539e58b119067477fd339811f3a110663c8792`. The planning worktree is based on this exact commit. Any later implementation must refresh its base and reconcile intervening changes.
- All seven audit-folder files were inspected. The pack contains 28 findings and 26 proposed packages. Its 210 coverage-register rows are scoped records: 78 full this pass, 17 full carried at the same commit, 16 partial, 95 dependency analysis, and four other single-record categories. They do not establish full semantic review of every repository file.
- Audit experiments cover only a SQLite cleanup predicate, a JavaScript selection regex and Unicode slicing. They do not reproduce the installed EFCC/native auth/D1/browser paths. Subsequent source inspection clarified the contracts below; it did not execute the application.
- Available CBM metadata concerned an older checkout and lacked affected baseline paths. Structural findings therefore used pinned source reads. The graph was not treated as proof of coverage for this baseline.
- Historical testing closeout in #85 is prior, candidate-specific evidence. No install, application build, repository test, native runtime, migration rehearsal or browser qualification has been run in this task. CEO review adds read-only inventory/provenance/source checks and the isolated Book path calculation; these do not qualify the application.

## Accepted decisions and observable behavior

### Correctness and verification safety

Business rate limiting will use a separate EFCC-owned table in the same D1; Better Auth retains its native `rate_limit` owner. Preserve per-action/per-IP keys, ten requests per fixed sixty-second window, window anchors, same-origin/missing-IP/error precedence and native auth behavior. A forward migration must retain existing business keys, counts and anchors, including exhausted buckets, while leaving native auth rows unaffected. Its acceptance includes a **quiesced, populated, disposable D1** upgrade rehearsal followed by real business/auth denial and expiry checks. [Q7, Q9; ADR 0006]

Account initials must preserve a complete supported Unicode code point, including non-BMP Chinese names, with the existing empty fallback. This does not change persisted names, Username, sign-in normalization or identity fingerprints. Grapheme segmentation and a new locale library are not required.

Mobile selection follows capability across created, renamed and extracted UI files. Exclusion requires an explicit server-only/non-mobile justification. Unknown paths fail closed in affected/staged selection. Extra mobile cases are acceptable; naming a file differently must not silently reduce required engines or claims. Preserve the existing selector and native Playwright discovery owners. [Q8; ADR 0007]

### Credential and shared contracts

Neutral credential proof must not expose `passwordHash`. Only the actual password-verification owner receives it. Preserve current session, credential revision, confirmation and temporary-password authority; session expiry, ten-minute confirmation and SQL-time checks remain authoritative. A UI projection or cursor never grants permission. [Q10; ADR 0001]

Enforce meaningful runtime/client boundaries while retaining legitimate type-only contracts, Hono `AppType` imports and framework composition roots. Existing strict TypeScript or lint success alone does not prove these boundaries. Add bounded checks using existing/native tooling; no new graph framework is assumed.

API error work must characterize an actual business-error change, distinguish native auth from business errors, preserve public messages and consolidate only truly duplicated contract facts. A generic response cast or universal normalization layer does not satisfy the outcome. Evidence-backed KEEP remains available if the current owner already meets the contract.

### Bounded browsing and search

Staff accounts, account audit, the review queue and applicant inbox will read **25 rows per page**, with previous/next navigation and no required total-page count. This includes every exposed affected page/API reader, including the mounted `GET /staff/accounts`; changing only the Staff page must not leave an unbounded API response. Do not retire a mounted endpoint merely because no in-repository client was found. Every permitted record and retained historical record remains reachable, including history after deletion. Independently authorize selected person/record detail even when it is outside the visible list page. Preserve private-note visibility, missing-target recovery and current-authority denial. [Q11, Q13; ADR 0008]

Keep Staff accounts ordered by name, reviews oldest first, audit and inbox newest first, with stable ID tie-breakers. URLs retain query, paging position and applicable selected-person/record/task return state. Search changes reset the list to page one while preserving authorized selected detail. Discover new rows through navigation or explicit refresh rather than background reordering during review. No new cross-page snapshot guarantee was agreed. [Q12–Q13]

Staff search is live after a short typing pause and covers **full name and Username only**, excluding phone/email. Trim the query, use case-insensitive literal substring matching, treat `%` and `_` literally and introduce no additional Unicode normalization. Accept up to **100 Unicode code points**; longer input gets a visible error, never silent slicing. [Q12]

Use a dedicated EFCC-owned search projection of full name plus display Username, with one deterministic application case-mapping rule for both data and query. Existing sign-in lookup applies width conversion and exact-match semantics, so it must remain separate and unchanged. Backfill old rows with the same application rule and maintain the projection in every relevant identity writer's existing atomic write. Native literal substring matching must honor the agreed query contract; SQL ASCII-only lowercasing or a LIKE-pattern byte limit must not redefine it. Include the populated upgrade rehearsal; choose indexes from query-plan evidence. Bounded output/parameter counts do not imply constant scan time, and no latency SLA has been invented. [Q16; ADR 0008]

Home retains all current participation, valid invitations, future events and visible notices. Read the first **25 items per section**, then offer explicit next-batch loading. Without a selected date, all permitted future events remain browsable; a selected date filters server-side. Preserve week/date controls, URL date/browsing state, inline notice expansion and `#participation`. Do not introduce an arbitrary finite horizon or hide otherwise permitted records. Remove unbounded JavaScript scope-ID expansion from SQL inputs while preserving authority. [Q14; ADR 0008]

### Presentation and workflows

Adopt **CVA and Lucide** as explicitly accepted dependencies and remove superseded owners. CSS owns theme values; Base UI/native HTML retains interaction, DOM and accessibility responsibilities. Preserve current variants/defaults, Button/form semantics, refs, focus, R11 appearance and stroke geometry. Allow only minimal documented icon-geometry exceptions; retain the reference Book and license. Form composition does not require CVA adoption to finish first. Verify production/native stylesheet source parity before consolidating it. [Q15; ADR 0009]

Refactor Identity, assisted account creation/recovery/issuance, own-account security, public/applicant workflows and decision/restriction/deletion views through their feature-owned interfaces. Preserve distinct actor/capability authority and operation lifetimes, frozen/pending review state, confirmation behavior, late-response disposal, server expiry and secret handover. Do not persist or replay plaintext credentials. Preserve private notes, independent restrictions, member/last-Admin/deletion guards and retained history.

Keep page/request composition and framework semantics at their existing roots: headers, search parameters, dynamic/no-store behavior, Suspense/redirects, navigation, refresh/revalidation and task return state. Preserve delivered routes and query keys; do not expose unfinished destinations. Command refactors must keep existing atomic writes and transaction boundaries intact. Internal file layout is an execution-planning choice, not an additional product decision.

Concrete preservation contracts clarified by the Q18 source inspection:

- Managed-account discovery excludes the actor. Admin may discover other account roles; ordinary Staff targets Members only. Direct target lookup independently enforces existence/self/target-role rules using its supplied actor. Fresh session/revision authority remains with its callers and command-time predicates; do not assume the target reader itself reauthenticates. Individual recovery/restriction/deletion policies remain separate.
- Original Staff credential issuance returns `201` with the temporary password and committed expiry. Idempotent replay returns `200` with receipt only; reconciliation also returns `200`. A bounded detail/list refactor must not broaden secret replay or change these mutation envelopes.
- Document-owned private Query state uses zero stale/GC time, always-online requests and no automatic retry or persistence. Transient reconciliation removes its exact query after settlement; feature owners retain keys, actors and outcome policy.
- Failed reads render safe unavailable UI without partial private data. Retry retains the permitted URL state; status recheck obtains a new server-authoritative view. Home/history dates retain `Asia/Hong_Kong`, Monday-first weeks and 24-hour retained timestamps.

These clarify existing preservation requirements; they do not grant new roles, add a cache, change credential policy or introduce another route owner.

### Native lifecycle, build and diagnostics

Use the owned Wrangler Harness/D1 and native Playwright boundaries. Characterize process-group cleanup on normal completion as well as failure, interruption and timeout; preserve nested fixture cleanup and first-failure evidence. A successful leader exit alone does not prove descendants are gone. Do not kill unrelated processes, add blanket retries/sleeps, patch private library internals or introduce a second scheduler. The source gap has not yet been reproduced as an orphan.

Verify production/native build parity and cache input/invalidation/relocation/corruption/unavailable-cache behavior. Cache only permitted immutable build output, never state, secrets, evidence or a passing test result. Keep the established slim CI and heavy local real-boundary qualification split. Timing can be diagnostic; no historical speed comparison or byte-identical fresh-build hash is a success criterion.

Diagnostics use fixed allowlisted stages/categories/outcomes, retain public error behavior and give explicit configuration errors. Never log raw exceptions, SQL bindings, credentials, contact data, cookies or session state. Do not add external telemetry or a request-ID scheme by assumption. Retire only proven superseded code/assets and update existing documentation owners.

The runner's cache-unavailable fallback is also an affected diagnostic owner: replace its raw caught exception output with a fixed safe category while preserving uncached execution. Source inspection establishes the mismatch with this agreed diagnostics contract, not a demonstrated secret disclosure. [ST23/ST24]

ST25 also includes the minimal correction of the Design Book local server's filesystem-root boundary and positive/negative path checks. Its current string-prefix check admits an outside sibling whose name starts with `screenbook`; an encoded-separator path demonstrates the predicate failure with pure path calculation. Preserve localhost use, Book screens/assets/license and ordinary valid navigation. No server was started and no outside file was read for this finding. [Q19]

## Accepted phase groups

Every original package ID appears once in this coverage table. These groups organize later planning and review; they are not execution authorization or a fully designed ticket graph. [Q17]

| Phase | Agreed scope and audit package coverage |
| --- | --- |
| 1 — Correctness and verification safety | **ST01** business/native rate-limit separation; **ST02** Unicode display; **ST03** source/mobile selection; **ST22** native lifecycle and gate interfaces. |
| 2 — Credential and shared contracts | **ST04** runtime/module boundaries; **ST05** credential proof and policy separation; **ST06** API error ownership. |
| 3 — CSS, UI and forms | **ST07** stylesheet source/theme ownership; **ST08** CVA recipes; **ST09** Lucide/geometry consolidation; **ST10** official typed form composition. |
| 4 — Bounded reads and migrations | **ST16** Staff list/detail projections and search; **ST17** Home queries; **ST18** retained-history/queue/inbox browsing; **ST19** schema/migration ownership and populated upgrades. |
| 5 — Workflows, commands and pages | **ST11** Identity; **ST12** assisted account lifetimes; **ST13** own-account security; **ST14** public/applicant boundaries; **ST15** decisions/restrictions/deletion; **ST20** command intent and atomicity; **ST21** page/navigation composition. |
| 6 — Build, cache and diagnostics | **ST23** build parity, cache and upgrade seams; **ST24** safe diagnostics/configuration contracts. |
| 7 — Documentation, retirement and aggregate acceptance | **ST25** final owner documentation, retirement and the accepted Book path-boundary correction; **ST26** same-candidate aggregate qualification and foundation acceptance. |

## Dependency conclusions to carry forward

Only a real safety, contract or shared-owner constraint is a hard dependency. Distinguish those from priority, review order and temporary edit coordination. The audit's diagram and dependency lists are proposals; these accepted corrections take precedence. [Q5, Q17]

- Selection safety and necessary native lifecycle characterization precede relying on affected qualification. ST04 is not a universal blocker: each change needs the relevant enforceable boundary, not completion of all module work first.
- ST10 consumes the public Button/form contract and does not require ST08. ST12 does not require all of ST11; serialize concrete shared-owner changes where necessary. Security/workflow changes consume the relevant neutral-proof and typed form/error contracts.
- ST17 does not depend on ST01. ST19's relation to credential work is primarily coordination; integration must include both the business-limiter migration and search backfill. The limiter's own populated upgrade checks belong with that change immediately, not only at final migration consolidation.
- ST18 consumes the relevant authorized projections/query contracts from ST16/ST17. ST20 waits only for the schema/command owner it actually changes; preserve transactions and avoid moving unsettled owners twice. ST21 consumes settled feature/query contracts.
- ST22 is independently characterizable; serialize shared runner edits with ST03. ST23 consumes the selected stylesheet policy and lifecycle contract. ST24 consumes final error/command-stage ownership.
- ST25 follows final owners. ST26 qualifies **all** accepted work, including now-mandatory ST09. Independently safe packages may advance without inventing an all-to-all phase barrier; the aggregate must still be complete.

## Acceptance thresholds for later implementation

These are observable seams to carry into CEO review/spec synthesis, not claims that tests have passed or a finished test/task inventory. [Q6, Q17]

| Outcome | Evidence needed to distinguish success from a misleading pass |
| --- | --- |
| Limiter ownership and Unicode correctness | Installed native auth plus genuine business HTTP/D1 requests across cleanup, rollover, expiry, exhausted/fresh/unrelated keys and concurrency; populated forward migration retains counters/anchors and native rows. Render supported BMP/non-BMP names and fallback without changing identity semantics. |
| Selection and runtime boundaries | Full selection results and native engine discovery for create/rename/delete/extraction and extracted-file-only edits; parent and cumulative stack bases; unknown affected/staged paths fail closed. Positive/negative alias and type-only cases plus the actual client build validate relevant runtime restrictions. |
| Credential and workflow authority | Real request/session/D1 and browser journeys exercise current authority, stale/revoked/expired confirmation, temporary credentials, disposal/cancellation and denied operations. Preserve each existing workflow's policy and atomicity; mocks or a neutral proof object alone cannot establish authorization. |
| Bounded lists, search and Home | Fixtures exceed a page and scope-parameter budgets. Reads and responses are actually bounded at the server, rather than fetching everything and slicing afterward. Verify complete navigation, stable ties, URL/back/task restoration, selected detail outside the page, privacy/denial/missing/deleted history and refresh behavior. Verify 100-code-point query validation, literal metacharacters, Unicode case mapping, old-row backfill and all identity writers without sign-in/fingerprint changes. Home date filtering and next batches preserve all four section contracts. |
| UI and form consolidation | The relevant production/native renders, computed styles, responsive states, native form/focus/ref behavior and library interactions preserve R11. Updated desktop/mobile evidence covers affected global presentation and real routes; screenshots alone do not prove behavior. Superseded owners are removed and geometry exceptions are justified. |
| Schema and commands | Fresh and populated disposable D1 upgrades verify limiter/search changes and retained records. Genuine mutation/concurrency/failure cases preserve request-time and SQL-time checks and atomic writes. No rehearsal uses personal or production data. |
| Lifecycle, build/cache and diagnostics | Owned process groups are absent after success/failure/interruption/timeout, including descendant cases and missing-process versus permission errors. Candidate builds exercise native/production parity and controlled cache cases. Fixed diagnostic fields attribute stages without exposing forbidden data or changing public failures. |
| Whole-repository closure and reference helper | Every tracked path has a justified disposition and source/provenance evidence; prior full reads may carry at the exact unchanged baseline. Partial and dependency-only entries need bounded semantic inspection rather than an automatic KEEP. Keep generated/reference limitations explicit. For the Book server, valid in-root paths remain available and encoded traversal/same-prefix siblings fail the filesystem boundary; only owned synthetic fixtures are needed. |
| Complete foundation acceptance | Freeze the final source tree and documented toolchain, qualify parent changes and the cumulative candidate, run relevant targeted checks and full `pnpm test:qualify`, refresh affected evidence, then complete independent Standards/Spec review and owner acceptance. Implementation, qualification, review, approval, merge and release remain separate gates. |

Maintainability also needs four bounded developer exercises: change Staff review copy through its owner; add a legitimate business error without contradictory contract copies; design a Roles HTTP test using existing owned fixtures **without implementing Roles**; trace a business invariant from rule through command and SQL/trigger to its real test. Success is understandable ownership and a working real boundary, not LOC reduction or test count.

The repository's pinned Node/pnpm toolchain and documented native harness remain the starting point. An implementation plan must identify its exact candidate and commands rather than borrowing historical results. No fixed deadline, phase/PR cap or performance number has been agreed.

## Material assumptions and remaining work

No consequential product decision remained open at the end of Q17. CEO review then identified a whole-repository completion gap and one additional source-supported helper defect; the user resolved their scope through Q18 and Q19. A later reviewer may identify another concrete missing decision; retain settled decisions and reopen only the affected question.

Implementation still has to reproduce the native limiter interaction; exercise selector/native discovery counterexamples; prove populated migrations and search writer coverage; establish stylesheet/icon/browser parity; characterize process teardown; and verify query plans, cache seams and the cumulative candidate. Source-supported feasibility is not runtime qualification. If evidence contradicts a hypothesis, correct its disposition instead of forcing a speculative fix. Scope reduction or deferral goes back to the user.

The detailed module layout, pagination mechanism, migration/backfill mechanics, exact typing pause, work-item granularity and final dependency graph remain ordinary design/planning work within the accepted contracts. They do not authorize weaker behavior. Rehearsal operations must be disposable and owned; production rollout/rollback and mixed-version compatibility remain outside this request.

## Source locators

- Audit pack: folder (historical audit input; see the portable [coverage ledger](coverage.csv)), containing `README.md`, `REPOSITORY-AUDIT.md`, `STACKED-PR-PLAN.md`, `findings.csv`, `review-coverage.csv`, `audit-metadata.json` and `isolated-counterexamples.json`. Keep the coverage and experiment qualifications with any cited finding.
- Pinned source: [baseline tree](https://github.com/Noahlw/efcc-system/tree/272dddbc887e7c3343a61831f91833fb687047bc); [business request guard](https://github.com/Noahlw/efcc-system/blob/272dddbc887e7c3343a61831f91833fb687047bc/src/features/account/business-request.ts); [name lookup](https://github.com/Noahlw/efcc-system/blob/272dddbc887e7c3343a61831f91833fb687047bc/src/features/identity/name-lookup.ts); [selection owner](https://github.com/Noahlw/efcc-system/blob/272dddbc887e7c3343a61831f91833fb687047bc/scripts/test-selection.ts); [schema](https://github.com/Noahlw/efcc-system/tree/272dddbc887e7c3343a61831f91833fb687047bc/src/server/db/schema); [migrations](https://github.com/Noahlw/efcc-system/tree/272dddbc887e7c3343a61831f91833fb687047bc/migrations).
- Existing authority: [R11 issue #30](https://github.com/Noahlw/efcc-system/issues/30); [Slice 3 spec #29](https://github.com/Noahlw/efcc-system/issues/29), whose implementation is excluded here; [historical testing closeout #85](https://github.com/Noahlw/efcc-system/issues/85#issuecomment-6194980298); [separate Harness teardown follow-up #86](https://github.com/Noahlw/efcc-system/issues/86). Refresh current issues and comments at the next authoring/implementation stage; do not treat the roadmap index as stronger than its accepted spec.
- Existing repository owners: [glossary](../../GLOSSARY.md), [testing contract](../../docs/testing.md), [issue tracker](../../docs/agents/issue-tracker.md), [domain rules](../../docs/agents/domain.md), [native/runtime ADRs](../../docs/adr/).
- Accepted design records, implementation pending: [0001 credential/business access](../../docs/adr/0001-authentication-and-business-access.md), [0006 limiter storage](../../docs/adr/0006-business-rate-limit-storage.md), [0007 mobile coverage](../../docs/adr/0007-mobile-coverage-through-ui-refactors.md), [0008 bounded projections/search/Home](../../docs/adr/0008-bounded-account-read-projections.md), [0009 UI library responsibilities](../../docs/adr/0009-library-owned-ui-presentation.md). At that authoring checkpoint, changes were documentation only on `codex/foundation-programme-planning`. The later spec and ticket publications are recorded below; this portable handoff is now committed for remote continuation.

## Prepared next-stage input

The user invoked `$ceo-review` against Revision 1 and confirmed the Q18/Q19 corrections recorded in Revision 2, then invoked `$to-spec`. Spec synthesis/publication is complete in #87, now R3. The user subsequently invoked to-tickets, approved the consolidated Draft 2 and its publication. The 19 child tickets are now published; implementation has not started. Do not repeat settled grilling.

For CEO review, inspect the stated revision against outcome/scope, ownership/reuse, real dependencies, state/failure, security/data, UI/accessibility, verification and operations/performance. Investigate discoverable facts; report only material gaps and the smallest correction. Do not require a finished execution design before assessing readiness for spec synthesis. The recorded readiness review owns the verdict for the revision it names.

For `to-spec`, synthesize the whole programme into the configured issue-tracker format, preserving all accepted behaviors, exclusions, testing seams and phase coverage. Do not silently publish the audit's 26 package texts as 26 tickets. Spec synthesis, detailed planning/ticket breakdown and implementation are separately invoked stages. CEO review is optional, not a prerequisite for `to-spec` or direct planning.

## Historical R2 readiness review

Reviewed revision: **2**, using the user's Q1–Q19 decisions, current issue authority and pinned source at `272dddbc887e7c3343a61831f91833fb687047bc`. GitHub `main` was refreshed during this review and matched that baseline. The first review of R1 found a whole-repository completion gap; Q18 and Q19 supplied the accepted corrections recorded above. The user requested fresh subagents after changing their defaults; three replacements, without explicit model overrides, checked the source/test/tooling evidence. They supplied factual review input, not implementation or independent code acceptance.

Verdict at the R2 review: **READY for `to-spec`, or direct `writing-plans` if the user chooses it.** Whole-repository scope and dispositions are explicit; the programme remains 26 packages in seven review groups. The later spec publication is recorded below. This verdict does not establish absence of all defects, passing implementation, runtime qualification, owner code acceptance or release readiness.

### Coverage result

[coverage.csv](coverage.csv) contains one row per **366 tracked baseline files**, with no missing/extra/duplicate paths. Every row records the Git blob, original review depth, current disposition, evidence, rationale, related packages and limits. The original 35 catch-all paths and 111 partial/dependency-only paths now have specific supplemental inspection records. The four new planning ADRs and the credential ADR refinement were also read as planning artifacts; they are not silently counted as baseline application files.

| Repository area | Tracked files | Programme disposition coverage |
| --- | ---: | --- |
| Root configuration and guides | 24 | Toolchain, formatting, build/cache, safe configuration and current documentation; preserve unrelated commit policy. |
| CI and Git hooks | 3 | Preserve slim CI, staged-source authority and local qualification ownership. |
| Documentation and R11 reference | 124 | Preserve single-context authority, Book/asset/license provenance; update final owners and the accepted Book path guard. |
| Migrations and generated metadata | 21 | Preserve ten historical SQL migrations and eleven metadata files; add only accepted forward migrations/rehearsals. |
| Scripts | 7 | Existing selection, snapshot, native build, portability and lifecycle owners. |
| Application source | 114 | Auth/access, account capabilities, Home/identity, UI, page/API reads, shared contracts and database owners. |
| Tests, fixtures, scenarios and Worker controls | 73 | Real HTTP/browser/D1/causal seams, native selection/lifecycle, contract/type/UI checks and owned synthetic fixtures. |
| **Total** | **366** | **75 CHANGE, 178 KEEP, 113 EXCLUDE.** |

CHANGE identifies an accepted adaptation or verification owner, not 75 bugs, mandatory gratuitous file edits or 75 PRs. KEEP preserves an inspected owner/contract, not an assertion of universal runtime correctness. EXCLUDE preserves generated/reference material outside manual product refactoring; it is never a deletion instruction. Unrelated commit-policy files need no invented implementation package.

Evidence depths remain distinct: 95 prior full-source records carry at the identical baseline; 146 limited/unrecorded entries received supplemental source/contract/provenance inspection; 125 reference/generated entries received appropriate provenance/interface checks, including full source plus the isolated counterexample for the Book server. The latter checks cover 80 original JPEGs, 21 SVG assets, their license, twelve reference source files and eleven migration metadata files. They are not screenshot-by-screenshot visual approval or full SQL equivalence proof. The generated dependency lock's 35 root specifiers match `package.json`; this is not a vendored-source security audit.

### Review lenses

| Lens | Applicability, conclusion and remaining boundary |
| --- | --- |
| Outcome and scope | Applicable to the user's whole-programme goal. All 28 findings map to the 26 packages, all packages appear in the seven groups, and Q18 closes the former tracked-file catch-all. Q19 explicitly includes the new helper finding without another phase/package. |
| Architecture and reuse | Applicable because changes cross deep modules and libraries. Preserve native auth/Harness/D1/Playwright, feature policy and framework composition; CVA/Lucide/form responsibilities and legitimate KEEP outcomes are explicit. No blanket move, generic operation engine or new scheduler is required. |
| Dependencies and integration | Applicable to storage, search writers, shared forms and build owners. Carry the corrected hard edges above; do not restore the audit's artificial ST08→ST10, ST01→ST17 or whole-ST11→ST12 barriers. Migration integration includes both quota preservation and search backfill. |
| State and failure | Applicable to persisted operations, credentials and navigation. Exact issuance/replay envelopes, no plaintext replay, transient reconciliation, frozen review, disposal, missing/denied/stale outcomes and authoritative refresh are preservation contracts. Their changed implementation still needs real-boundary evidence. |
| Security and data | Applicable to hash/proof isolation, managed targets, private list/detail projections, SQL-time authority and diagnostics. Caller versus target-reader authority is clarified. Book containment and raw cache-exception output are now explicit affected owners; neither source finding proves a deployed exploit or secret disclosure. |
| UI and accessibility | Applicable to global styles, UI libraries and mobile task flows. R11, native/Base UI behavior, geometry exceptions, refs/focus and responsive claims are explicit; original reference resources are preserved, not mistaken for current app tests. |
| Verification and review | Applicable because source coverage could be mistaken for acceptance. Full baseline inventory and individual dispositions are complete. Existing tests must change for the accepted new contracts; historical #85 results do not qualify that future candidate. Independent Standards/Spec review and owner acceptance remain later gates. |
| Operations and performance | Applicable to large histories/scopes, migration state, subprocesses and cached builds. Bounds, query-plan evidence, quiesced populated upgrades, exact toolchain/candidate, safe fallback and owned cleanup are explicit. Native performance, migration correctness and cleanup remain unexecuted; production rollout and #86 retain their agreed separate status. |

### Material findings and their disposition

1. **[Closed for authoring; originally blocking whole-repository completion] Coverage criterion.** R1 said “All 26 audit package proposals require an explicit disposition”; the audit catch-all said “Not silently KEEP/DELETE; resolve only if reached by planned changes” (register row 211 (historical audit input; see the portable [coverage ledger](coverage.csv))). Those values allowed all known packages to close while untouched paths stayed unexamined. Minimum correction: Q18's tracked-file criterion and the reconciled ledger. All 366 rows now have a disposition; no essential source is inaccessible.
2. **[Accepted implementation work; non-blocking to spec] Book filesystem boundary.** `serve.mjs` lines 16–28 resolves a decoded path then uses `file.startsWith(root)`. `/..%2Fscreenbook-private%2Fsentinel.txt` resolves outside a synthetic `/synthetic/design/screenbook` root while passing that check. Q19 accepts the smallest containment correction and positive/negative cases in ST25. The pure path counterexample is recorded in [parent evidence](review-evidence/parent.json); no server/request/outside read was performed.
3. **[Clarified within accepted scope] Exposed read and authority contracts.** `staff-account-routes.ts` lines 26–31 mounts an unbounded GET as well as mutation endpoints. Bound that API and the page through the shared ST16 owner; preserve mutation envelopes and do not infer deletion safety from missing in-repo callers. The revised preservation section also names the actual target policy, caller/SQL-time authority, private Query lifecycle, safe read failure and Hong Kong time contracts. [Source evidence](review-evidence/source.json)
4. **[Existing diagnostics contract applies; non-blocking to spec] Cache fallback output.** `test-runner.ts` lines 857–869 emits the caught filesystem exception while falling back without cache. Carry the fixed safe category through ST23/ST24, preserving fallback. This is a source-confirmed mismatch with the agreed no-raw-exception contract, not evidence that a secret leaked. Mobile extraction and success-path process-group checks remain the already accepted ST03/ST22 work. [Tooling evidence](review-evidence/tooling.json)
5. **[Expected future verification work; non-blocking to spec] Tests for new contracts.** Extend existing owners for 25-row history/detail/queue/inbox/Home browsing, search projection/backfill/all writers and counter-preserving limiter migration. Existing business application assertions tied to native `rate_limit` must move with the new business owner; native-auth assertions stay native. This is a test-impact inventory, not a claim that every old audit journey lacks tests or that any new behavior has passed. [Test evidence](review-evidence/tests.json)

## Spec publication history

On 2026-10-16, the user invoked `$to-spec` for this complete programme. Initially published R2 [spec #87](https://github.com/Noahlw/efcc-system/issues/87) with `ready-for-agent`: all 26 packages, the seven confirmed phases, 64 user stories, 15 acceptance gates and a portable 366-file disposition/package/review-depth appendix in the same issue body. GitHub readback exactly matched the local draft (SHA-256 `d641a795f460dbce5869d98b912321c0de824e4c5306419723d711eeb65ad92d`).

The issue records the pre-publication R2 input hash `a470918c496fa9b231f4a9ad6935457430f795c2f597830987373de5640fb5a5`; these publication-status edits do not change accepted scope or revision. The full coverage ledger remains unchanged at SHA-256 `e9c1ebd70ff57341028ec2a84e63518d2a638886208912244e1f04338e6df788`.

No implementation, repository build/test/runtime qualification, commits, PRs, assignee, implementation tickets or release actions occurred. The later user-invoked ticket draft is recorded below; #87 remains scope authority and this brief records provenance.

## R3 confirmed feedback reconciliation

The user accepted all eight reconciliation dispositions/minimal amendments and selected recommended paging option A. They then explicitly authorized updating #87 and invoking to-tickets for a complete draft, while forbidding child publication and implementation this round. This accepted refinement changes the brief revision; the R2 CEO verdict is not relabelled as a new R3 review.

1. FB87-01: existing calendar counts/markers/presence retain authorized whole-result meaning independently of loaded pages; preserve all-future reachability without fetching every Event. D11/T07.
2. FB87-02: existing atomic projection/all-writer requirements remain; add actual applicable failed/ignored-write, replay and verified interrupted-backfill restart evidence. Do not invent a separate projection write/fault API. D10/D18/T06/T09.
3. FB87-03: after existing authorization, malformed/inapplicable paging positions normalize to page one while valid query and independently authorized detail remain. Validate according to the selected mechanism; no signed cursor or cross-page snapshot is presumed. D8/T05.
4. FB87-04: unfinished IME composition does not commit search/navigation; apply normal pause afterward. Superseded success/error cannot alter current results/loading/error/page/URL; cover clear, overlength and pending Back/Forward. D9/T06.
5. FB87-05: inspect generated statements/all binds and native D1 evidence, including accepted multibyte/literal search and high-cardinality scopes. D1 limits do not narrow the accepted 100-code-point input or imply bounded scan cost. T06/T07.
6. FB87-06: ST18 depends on ST16/ST17 only for concretely consumed contracts/shared owners; separate technical blockers from review/edit coordination. Dependency decisions.
7. FB87-07: record four T14 starting baselines on a named revision before relevant owner edits, retain package after results and compare on ST26. No new measurement platform. T14.
8. FB87-08: Book links are allowed only when resolved targets remain within the resolved reference root; outside targets keep the existing not-found response, verified with owned fixtures. D23/T13.

GitHub R3 update/readback: 2026-10-16T05:47:07Z, body SHA-256 `60420f610ec3d8db1177b245fde92a9027baeb4bf78f9affe15b51745bfc08b6`. The package register, phases, 64 stories and complete portable baseline ledger are unchanged. Shortened provenance prose preserved its original evidence limitations.

## Current to-tickets publication

The user approved Draft 2 and its publication. [Publication index](publication-index.md): **19 tickets, #88–#106**, native sub-issues of #87, with eight genuine whole-ticket native blocker links. All have ready-for-agent and wayfinder:task, remain open/unassigned and passed exact remote body/label/parent/dependency readback. Partial-contract dependencies remain linked checkpoint conditions, without artificial whole-ticket barriers.

[Complete breakdown](breakdown-draft.md) and [traceability](draft2-traceability.md) retain all 41 internal checkpoints and 185 acceptance criteria, all 26 packages, seven phases, 23 decisions, 64 stories and T01–T15. Source pre-publication artifacts are preserved in the approved Draft 2 archive; Draft 1 is superseded provenance. #87 R3 body SHA-256 remains `60420f610ec3d8db1177b245fde92a9027baeb4bf78f9affe15b51745bfc08b6`.

[Publication verification](publication-verification.json) records 27 passing publication checks. W19.C01 remains the phase-4 migration-lineage integration; W03/W08 retain immediate checks. Forms expand/migrate/contract and assisted adapter migration/removal remain green checkpoints.

This turn published planning only. Implementation, the four T14 baseline exercises, application/native qualification, commits, PRs, independent implementation review, owner implementation acceptance, merge, deploy and remote-data actions have not been performed or authorized by publication. Existing unrelated work is preserved.
