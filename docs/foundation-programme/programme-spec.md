# Whole-repository foundation programme — R3

R3 includes owner-confirmed FB87-01–08 and paging option A; Q1–Q19, all 26 packages and seven phases remain. Publication alone authorizes no implementation, merge or deployment.

## Problem Statement

EFCC's delivered account, membership and church-activity foundation needs a coherent improvement programme before Slice 3 begins. Users must retain reliable sign-in, private account workflows and access to all permitted records while growing lists remain usable. Maintainers need to change a workflow, contract or presentation owner without spreading policy across unrelated layers or losing verification coverage during a refactor.

The audit identified concrete correctness concerns, including incompatible business/native rate-limit ownership and an incomplete Unicode initial, alongside maintainability and verification work. Its 26 package proposals alone did not establish complete repository coverage: several paths had only partial/dependency inspection or fell into an unread catch-all. The subsequent read-only review resolved that coverage gap and found additional affected owners that must be carried into the programme, including the exposed Staff list API, safe cache-fallback diagnostics and the Design Book server's path boundary.

## Solution

Strengthen the currently delivered foundation across correctness, credential boundaries, shared contracts, presentation, workflows, bounded reads, schema/commands, native verification, builds, diagnostics and retirement/documentation. Preserve delivered business policy and the accepted R11 interface except for the explicit behavior changes below.

Cover every tracked baseline file with an evidence-backed CHANGE, KEEP or EXCLUDE disposition and reconcile that inventory against the final candidate. Complete every agreed change. Merge or split packages when justified; an evidence-backed KEEP can complete an unnecessary proposal. Deferral or scope reduction requires the owner's decision. There is no fixed phase, PR, ticket or deadline cap.

All 26 packages remain in scope, including the explicitly accepted CVA and Lucide adoption. Seven phases organize review and priority, rather than acting as artificial technical dependencies. Final foundation acceptance requires one frozen aggregate candidate, real-boundary evidence, independent Standards/Spec review and separate owner acceptance. It prepares the foundation for Slice 3; it does not implement Slice 3.

## User Stories

1. As an account holder, I want my supported Full Chinese name to render a complete initial, including a non-BMP character, so that my identity is displayed correctly without changing my stored name.
2. As an account holder, I want authentication and business access to remain separate, so that pending Membership status, deactivation and a Security ban retain their existing status-only journeys.
3. As a person submitting a business action, I want the existing per-action/IP quota to survive unrelated native-auth housekeeping, so that the same fixed-window rules apply consistently.
4. As a person signing in, I want native authentication limits and wire behavior to remain unchanged, so that foundation work does not weaken or replace credential protection.
5. As an operator rehearsing an upgrade, I want existing quota keys, counts and window anchors preserved, so that an exhausted bucket does not regain requests during migration.
6. As an authorized Staff member, I want a bounded account list ordered by name with stable ties, so that I can browse a growing directory without downloading broad account records.
7. As an authorized Staff member, I want live search after a short typing pause across Full Chinese name and Username only, so that I can find the intended person without searching contact details.
8. As an authorized Staff member, I want trimmed, case-insensitive literal substring search, so that percent and underscore remain ordinary query characters.
9. As an authorized Staff member, I want up to 100 Unicode code points of query input and a visible error beyond that limit, so that input is not silently truncated.
10. As an authorized Staff member, I want search to reset the result list to its first page while retaining independently authorized selected detail, so that changing a query does not lose my current context.
11. As an Admin, I want the existing non-self discovery and operation-specific target rules preserved, so that a projection refactor does not change authority over other account roles.
12. As an ordinary Staff member, I want Member-only target rules retained, so that a list or direct-detail reader cannot grant broader management authority.
13. As an authorized Staff member, I want selected account detail to remain reachable outside the visible list page, so that pagination does not determine permission or hide an authorized target.
14. As an API consumer, I want affected exposed list readers to be bounded as well as their pages, so that an unchanged endpoint cannot retain wholesale sensitive responses.
15. As a Staff reviewer, I want pending applications ordered oldest first with 25-row previous/next navigation, so that I can work through the complete permitted queue predictably.
16. As a Staff reviewer, I want search, page, selected-person/record and task return state retained in URLs, so that back navigation and task completion restore my place.
17. As a Staff reviewer, I want new rows discovered through navigation or explicit refresh, so that background updates do not reorder the task I am reviewing.
18. As an authorized audit reader, I want newest-first bounded history and independent detail access, so that all retained permitted history stays reachable without loading it all.
19. As an authorized audit reader, I want retained history to remain reachable after eligible account deletion, so that deletion does not erase the existing historical contract.
20. As an applicant, I want my inbox paged newest first without Staff-only notes, so that the full permitted history remains private and navigable.
21. As an account holder using Home, I want current participation, valid invitations, future Events and visible notices to remain reachable, so that a read budget does not hide permitted work.
22. As an account holder using Home, I want the first 25 items per section followed by explicit next-batch loading, so that initial payloads stay bounded while the complete result remains available.
23. As a Member, I want all authorized future Events browsable when no day is selected and a selected day filtered server-side, so that the week strip does not impose a hidden time horizon.
24. As a Member, I want Hong Kong week/date controls and browsing positions retained in the URL, so that refresh and back navigation preserve my calendar context.
25. As a Member, I want approved Enrolment, pending/waitlisted Programs, valid invitations and notices to retain their distinct meanings, so that participation is not confused with attendance or approval.
26. As an account holder, I want notices to expand inline and the participation anchor to remain available, so that existing Home navigation continues to work.
27. As an account holder, I want sign-in lookup and historical identity fingerprints unchanged by Staff search, so that a new browsing projection cannot change which account authenticates or which operation replays.
28. As a maintainer, I want one dedicated search projection updated by every identity writer and correctly backfilled, so that old and newly edited records obey the same search contract.
29. As an account holder, I want credential confirmation, session expiry and revision checks retained at request and SQL time, so that stale browser state cannot authorize a mutation.
30. As a maintainer of a non-password workflow, I want neutral credential proof without password hashes, so that sensitive verifier material stays with the actual verification owner.
31. As an authorized Staff member creating or recovering an account, I want the original one-time Temporary password and committed expiry delivered only with original issuance, so that replayed receipts cannot reveal a credential.
32. As an authorized Staff member completing Credential handover, I want lost-display and reissue behavior preserved, so that a receipt is never treated as a new valid issuance or automatic password retrieval.
33. As an account holder using a Temporary password, I want its existing expiry and mandatory-change gate preserved, so that it cannot approve Membership status or remove a Security ban.
34. As an account holder changing my phone or security settings, I want explicit review, confirmation and submission retained, so that a refactor cannot automatically submit sensitive work.
35. As an account holder returning after an uncertain response, I want the existing actor/key-bound reconciliation behavior, so that retry or refresh does not duplicate or misattribute an operation.
36. As an account holder navigating away from a sensitive workflow, I want dirty-state, frozen-review and late-response disposal behavior preserved, so that stale work cannot overwrite a newer task.
37. As an anonymous applicant, I want application creation and device-capability reconciliation to remain separate from signed-in maintenance, so that signup does not unexpectedly create a session or expose credentials.
38. As a signed-in applicant, I want correction, withdrawal and resubmission bound to my account and application, so that shared form mechanics cannot merge distinct authority contracts.
39. As a Staff decision maker, I want internal notes separated from applicant-visible reasons, so that private review information cannot enter the applicant response.
40. As an authorized Staff member changing a restriction, I want Membership status and Security ban actions to remain independent, so that lifting one restriction does not silently change another.
41. As an authorized Staff member considering account deletion, I want existing eligibility, last-Admin and retained-history guards enforced by the server, so that presentation changes cannot bypass destructive-action policy.
42. As an account holder encountering an unavailable read, I want safe failure without partial private data and an authoritative retry, so that cached state is not mistaken for current permission.
43. As an account holder, I want private client reads and reconciliation results to remain transient without automatic retries or persistence, so that sensitive outcomes are not retained or replayed behind my back.
44. As a mobile or keyboard user, I want R11 appearance, focus, refs, native form behavior and accessibility retained, so that library consolidation does not regress an existing journey.
45. As a maintainer, I want CVA, Lucide, CSS and Base UI/native HTML to have clear responsibilities, so that variants, icon geometry, theme values and interactions do not acquire duplicate owners.
46. As a maintainer, I want official typed form composition, so that field and submission contracts remain understandable without manually mirroring a library's generic signature.
47. As a developer adding a business error, I want consistent runtime, RPC and client contracts with native auth kept distinct, so that a valid change does not create contradictory status/code definitions.
48. As a developer, I want enforceable runtime/client boundaries that retain legitimate type-only imports and composition roots, so that static restrictions catch meaningful mistakes without banning valid architecture.
49. As a developer refactoring UI files, I want mobile coverage to follow capability through creation, rename and extraction, so that a new filename cannot silently remove a required browser engine.
50. As a developer using affected or staged qualification, I want unknown paths to fail closed and parent/cumulative bases distinguished, so that an incomplete selection cannot appear green.
51. As a maintainer of a mutation, I want command intent clear while ordered batches, immutable history and SQL predicates stay intact, so that readability does not split an atomic operation.
52. As an operator rehearsing schema changes, I want fresh and populated disposable D1 upgrades using synthetic data, so that retained rows, counters and search projections are checked without touching personal stores.
53. As a reviewer, I want tests at the real HTTP, D1 and browser boundary, so that a mock, screenshot or source check cannot stand in for authorization and persistence evidence.
54. As a maintainer of native tooling, I want owned process cleanup characterized after success, failure, interruption and timeout, so that leader exit is not mistaken for descendant absence.
55. As a developer building the app, I want production/native style and asset parity checked on one candidate, so that different source discovery policies do not hide a presentation regression.
56. As a developer reusing a build, I want cache hits, misses, invalidation, corruption, relocation and unavailable-storage behavior verified, so that only compatible immutable output is reused.
57. As an account holder, I want mutable state, credentials, evidence and passing results excluded from build caches, so that build reuse cannot retain private data or replace fresh testing.
58. As an operator diagnosing a failure, I want fixed safe stage/category/outcome information, so that the failure is attributable without raw exceptions, credentials, contacts, cookies or SQL bindings.
59. As a maintainer using the Design Book locally, I want valid reference paths served while outside and same-prefix sibling paths are rejected, so that the helper honors its intended filesystem boundary.
60. As a maintainer, I want Book screens, original references and licenses preserved during retirement, so that useful design authority is not mistaken for dead product code.
61. As a reviewer, I want every tracked file to retain a justified disposition at the final candidate, so that untouched or newly extracted files cannot disappear into a catch-all.
62. As a maintainer, I want existing guides, glossary and meaningful ADRs updated through their current owners, so that the programme leaves clear instructions without a competing documentation hierarchy.
63. As a programme owner, I want all agreed work planned together and reviewed in seven phases, so that phased delivery does not become silent deferral of the remaining work.
64. As a programme owner, I want exact-candidate qualification, independent review and owner acceptance recorded separately, so that foundation readiness is not mistaken for approval to merge, deploy or start Roles implementation.

## Implementation Decisions

### Programme and preservation contracts

1. **Complete scope and disposition.** All ST01–ST26 packages require a final disposition. Every tracked baseline file has a reviewed disposition; reconcile added, renamed and removed paths against the final candidate. CHANGE means an accepted adaptation or verification owner, not a demand for a gratuitous edit. KEEP preserves an inspected owner/contract. EXCLUDE preserves generated/reference material outside manual product refactoring and never authorizes deletion. An unnecessary proposal may close as evidence-backed KEEP; a defer requires an owner decision.
2. **Authentication and business access.** Better Auth retains credentials, native auth storage/limits and wire behavior. EFCC retains Membership status, Security bans and current business authority. Pending, banned or deactivated accounts retain their existing authentication/status-only contracts. Do not add in-app Admin promotion/demotion or infer future Roles powers.
3. **Business quota ownership and migration.** Use a separate EFCC-owned business limiter table in the same D1. Preserve existing per-action/IP keys, ten requests per fixed sixty-second window, window anchors and request-error precedence. Forward migration must retain existing keys/counts/anchors, including exhausted buckets, without changing native auth rows. Rehearse on a quiesced populated disposable D1 and exercise genuine business/native denial and expiry afterward. Mixed-version zero-downtime rollout is a separate deployment decision; no dual-write infrastructure is presumed.
4. **Unicode and identity.** Initials retain a complete supported Unicode code point and existing empty fallback. Do not mutate names, Username, sign-in normalization or historical fingerprints. Share only genuinely identical validation/transformations; preserve null/false/empty semantics, frozen-review values, payload property order and old literal/digest expectations. No universal identity normalizer or unrelated locale library is required.
5. **Neutral proof and live authority.** Neutral credential proof excludes passwordHash; actual password verification owns access to it. Preserve session expiry, credential revision, Temporary-password state, ten-minute confirmation and SQL-time predicates. Target lookup uses its supplied actor for existence/self/role checks; current session/revision authority remains with its authorized callers and command predicates, rather than being invented inside the target reader.
6. **Managed targets.** Current list discovery excludes the actor. Admin may discover other account roles; ordinary Staff targets Members only. Recovery, identity, restrictions and deletion retain their own additional target policy. A cursor, cached projection or selected person never grants authority.
7. **Bounded account browsing.** Staff accounts, audit, review queue and applicant inbox use 25 rows per page with previous/next navigation; no total-page count is required. All permitted records and retained history remain reachable, including after eligible deletion. Apply bounds to every affected exposed page/API reader, including GET /staff/accounts. Do not retire a mounted endpoint just because no in-repository client was found. Independently authorize selected person/record detail outside the current list page; preserve privacy, missing-target recovery and denial behavior.
8. **Ordering and return state.** Staff accounts remain name-first, review queue oldest-first, audit/inbox newest-first, all with stable ID tie-breakers. Preserve query, paging and applicable selected-person/record/task return state in URLs. A search change returns the list to its first page while retaining authorized selected detail. Navigation or explicit refresh discovers new rows; do not background-reorder an active review. No additional cross-page snapshot guarantee was agreed. After existing authorization checks, malformed or inapplicable paging positions reset to the first page and normalize the URL, preserving valid query and independently authorized selection.
9. **Staff search.** Search live after a short typing pause over Full Chinese name and display Username only, excluding phone/email. Trim the query; use case-insensitive literal substring semantics without extra Unicode normalization. Percent and underscore are ordinary characters. Accept up to 100 Unicode code points and show a visible error for longer input without slicing it. Do not commit search/navigation during IME composition; apply the normal typing pause after composition ends.
10. **Dedicated search projection.** Derive full name plus a space plus display Username with the same deterministic application case mapping for both stored key and query. Keep the exact-match sign-in key, width conversion and fingerprints unchanged. Backfill old rows with the same application rule and update the projection in every relevant existing atomic identity write, including anonymous application creation, signed-in applicant correction, Staff identity correction and assisted creation. Native literal substring matching must honor this contract; SQL ASCII lowercasing or a LIKE-pattern byte limit must not redefine it. Choose indexes from query-plan evidence. Bounded output/parameter counts do not imply constant scan time or an invented latency SLA.
11. **Home.** Retain current participation, valid invitations, all authorized future Events and visible notices, first 25 items per section with explicit next-batch loading. With no selected date, all permitted future Events remain browsable; a selected date filters server-side. Preserve week/day controls, URL date/browsing state, inline notices and the participation anchor. Remove unbounded scope-ID expansion from query inputs without adding a hidden horizon or changing Enrolment/attendance semantics. Retain Asia/Hong_Kong date keys, Monday-first weeks and 24-hour history timestamps. Existing calendar counts, markers and presence flags retain their authorized whole-result meaning independently of loaded pages; unloaded is not absent. Summaries must not require loading every Event or impose a future-event horizon.
12. **UI/library ownership.** Adopt CVA for stable real variants and Lucide for matching glyph geometry; the dependencies are explicitly accepted. CSS owns theme values; Base UI/native HTML owns interaction, DOM and accessibility. Preserve variants/defaults, Button/form semantics, refs/focus, R11 appearance and stroke geometry. Remove superseded owners; document only minimal geometry exceptions and retain Book references/licenses. This consolidation is a maintenance decision, not proof that current typed maps are broken. Typed form composition does not require CVA first.
13. **Styles and forms.** Characterize production/native stylesheet-source parity before consolidation. Select one explicit source policy or retain the smallest justified parity-preserving exception. Use official typed form composition through existing library contracts without a copied generic-signature layer. Preserve actual native form behavior, field validation and transformed/frozen submission values.
14. **Workflow boundaries.** Keep feature-owned orchestration and phase-specific presentation contracts. Identity, assisted creation/recovery/issuance/handover, own-account security, anonymous application, signed-in applicant maintenance, decisions, restrictions and deletion retain distinct actor/capability authority, storage and operation lifetimes. Share identical mechanics or presentation only. Preserve dirty/discard, frozen review, pending recovery, cancellation/disposal, expiry, retry/reconciliation and operation binding; do not introduce a generic operation engine.
15. **Secrets and envelopes.** Never persist or replay plaintext credentials. Original Staff credential issuance returns 201 with the Temporary password and committed expiry; idempotent replay returns 200 receipt-only and reconcile returns 200. Preserve seven-day Temporary-password issuance/expiry and mandatory-change behavior; a receipt is not proof of current credential validity. Password confirmation must not auto-submit another sensitive operation. Anonymous signup does not create a session.
16. **Transient private state and failure.** Document-owned private Query state uses zero stale/GC time, always-online requests and no automatic retries or persistence. Reconciliation removes its exact query after settlement while feature owners retain domain keys/actors/outcomes. Unavailable reads expose no partial private data. Retry preserves permitted URL state; status recheck obtains a fresh server-authoritative view rather than cached permission.
17. **Business contracts and runtime boundaries.** Retain Hono inference, legitimate type-only AppType imports and framework composition roots. Enforce meaningful client/runtime restrictions with bounded resolver-aware checks and actual client build evidence. Characterize a real business-error addition, preserve public messages/status/code contracts and native auth's distinct envelope, and consolidate only genuine duplication. Do not replace typed boundaries with broad response casts or universal normalization.
18. **Schema and command intent.** Preserve historical SQL, immutable receipts/history, append order, lazy same-batch assertions and transaction boundaries. Add only justified forward migrations. Make command intent and neutral proof/policy/receipt responsibilities clearer without splitting atomic writes, moving policy into views or introducing a generic SQL facade. Internal module layout and pagination/backfill mechanics belong to subsequent planning within these contracts.
19. **Pages and navigation.** Keep headers, search parameters, dynamic/no-store behavior, Suspense/redirects and framework request composition at their proper roots. Preserve delivered routes/query keys, current-authority reads, full-document recovery/revalidation, task return state and delivered-only navigation. Reduce repeated policy-shaped knowledge through settled feature interfaces; do not build a new router or context service by assumption.
20. **Selection and lifecycle.** Mobile intent follows capability across create/rename/delete/extraction and later new-file-only edits. Narrowing requires explicit server-only/non-mobile justification; unknown affected/staged paths fail closed. Keep existing selector/native discovery ownership and distinguish parent-relative from cumulative qualification. Characterize owned process-group absence on success as well as failure/interruption/timeout before changing lifecycle code; leader success alone is insufficient. No unrelated process killing, blanket retries/sleeps, private library patches or second scheduler.
21. **Builds/cache/upgrades.** Retain owned Wrangler Harness, srvx ingress, actual app-bound D1, Playwright and immutable native build reuse. Verify production/native parity and HIT/MISS/invalidation/corrupt/relocation/unavailable-cache cases. Cache only permitted immutable build output, never mutable state, credentials, evidence or passing results. Preserve uncached execution when cache storage is unavailable; a failed build is not retried as an availability fallback. Keep pinned toolchain identity and executable public-seam upgrade checks; no byte-identical fresh-build requirement or historical speed claim is imposed.
22. **Safe diagnostics and configuration.** Use fixed allowlisted stage/category/outcome fields at existing auth, access, business and relevant tooling boundaries. Preserve public failures and explicit configuration validation. Never emit raw exceptions, SQL binds, credentials, contacts, cookies, session state or request bodies. Include the native runner's cache-unavailable fallback: replace raw caught-exception output with a fixed safe category without changing fallback. No external telemetry or new request-ID scheme is presumed.
23. **Reference helper and retirement.** Within ST25, correct the Book local server's filesystem-root containment and add positive/negative checks, including encoded traversal and same-prefix siblings. Preserve localhost use, valid in-root navigation, screens/assets/license. Retire only proven superseded code/assets after caller, selector, build-input and historical-path checks. Update current documentation/glossary/meaningful ADR owners; create no competing glossary, archive registry or testing platform. Allow symlinks only when their resolved targets remain within the resolved reference root; outside targets retain the existing not-found response.

### Complete package register

These stable scope IDs are not tickets or a PR count. Every package needs implementation/verification or justified KEEP; acceptance includes ST09.

| ID | Package | Required outcome and acceptance focus |
| --- | --- | --- |
| ST01 | Business/native limiter ownership | Separate storage in the same D1; preserve quotas, precedence and populated counters/anchors/native rows; prove real cleanup/expiry/concurrency interoperability. |
| ST02 | Unicode display boundaries | Complete supported initials and empty fallback in the actual Account render; leave identity/sign-in/fingerprint semantics unchanged. |
| ST03 | Source-selection stability | Capability-based mobile coverage survives create/rename/delete/extraction/new-file-only edits and stacked bases; unknown affected/staged paths fail closed. |
| ST04 | Meaningful module/runtime boundaries | Relevant forbidden runtime imports fail bounded checks and client build, while legitimate aliases, type-only imports and composition roots remain valid. |
| ST05 | Credential proof versus policy | Narrow neutral proof, private hash verification, preserved request/SQL-time authority, confirmation and Temporary-password behavior. |
| ST06 | API error/normalization ownership | Coherent business status/code/runtime/RPC/client contracts with preserved messages and native-auth separation; exercise one legitimate business-error change. |
| ST07 | Stylesheet sources/theme responsibility | Same-candidate production/native source, used-class, computed-state and asset parity; consolidate explicit policy or retain a minimal justified exception. |
| ST08 | CVA recipes | Adopt actual variant recipes, remove replaced owners and preserve defaults, public UI and native form contracts. |
| ST09 | Lucide geometry consolidation | Adopt matching library glyphs, retain minimal documented geometry exceptions/stroke fidelity, remove superseded owners and preserve Book/license. |
| ST10 | Official typed form composition | Remove manual library-signature glue without changing field/submission typing, frozen values or actual form behavior. |
| ST11 | Identity workflow interface | Separate feature lifecycle/authority from presentation; preserve self phone/Staff correction, stored pending references, null/false values and reconciliation. |
| ST12 | Assisted account lifetimes | Separate creation, recovery/reissue and receipt/handover phases; preserve one-time issuance, expiry, disposal, actor/key binding and 201/200 secret omission. |
| ST13 | Own-account security | Preserve password change/confirmation/revoke/Temporary-password journeys, explicit submit, revision/session authority and refresh recovery. |
| ST14 | Public versus applicant workflows | Preserve anonymous device capability versus signed-in actor-bound correction/withdrawal/resubmission; stable normalization/fingerprints and no signup session. |
| ST15 | Decision/restriction/deletion views | Share presentation mechanics only; retain private-note separation, independent Membership/Security-ban policy, destructive eligibility/history/last-Admin guards and uncertainty recovery. |
| ST16 | Staff list/detail/search projections | Minimal authorized projections, 25-row page/API bounds including GET /staff/accounts, independent selected detail, exact search/projection/all-writer contract. |
| ST17 | Home query ownership | Remove unbounded scope parameters; preserve all four sections, 25-item next batches, server date filter, full future reachability and Hong Kong calendar/URL behavior. |
| ST18 | History/queue/inbox browsing | Bounded reachable lists, stable ordering, independent authorized detail, private projections, deleted-account history and return-state preservation. |
| ST19 | Schema/migration ownership | Preserve historical schema/SQL lineage and ordered appends; fresh/populated rehearsals include business quota preservation and deterministic search backfill. |
| ST20 | Command intent and atomicity | Clarify actual mutation intent and proof/policy/receipt boundaries while preserving ordered atomic D1 batches, predicates, triggers, immutable receipts and concurrency outcomes. |
| ST21 | Page/navigation composition | Reduce repeated feature/task context while retaining framework roots, routes/query keys, delivered-only navigation, full refresh and live authorization. |
| ST22 | Native lifecycle/gate interfaces | Characterize success/failure/interruption/timeout/descendants through owned resources; preserve exact source/index/privacy, fixture cleanup, discovery and first-failure evidence. |
| ST23 | Build parity/cache/upgrade seams | Same-candidate native/production interoperability; controlled cache integrity/input/relocation/unavailable-storage cases and pinned public-seam upgrade checks. |
| ST24 | Safe diagnostics/configuration | Fixed safe attribution without raw/sensitive data or public-error changes, including cache fallback; explicit existing configuration contracts. |
| ST25 | Documentation/retirement/Book boundary | Update existing owners, retire only proven replacements, preserve reference assets/license/history aliases, maintain whole-repo disposition and correct the accepted Book path boundary. |
| ST26 | Aggregate foundation acceptance | One frozen complete candidate, parent/cumulative evidence, targeted and full local qualification, four developer exercises, independent Standards/Spec review and separate owner acceptance. |

### Seven review phases

| Phase | Included packages |
| --- | --- |
| 1 — Correctness and verification safety | ST01, ST02, ST03, ST22 |
| 2 — Credential and shared contracts | ST04, ST05, ST06 |
| 3 — CSS, UI and forms | ST07, ST08, ST09, ST10 |
| 4 — Bounded reads and migrations | ST16, ST17, ST18, ST19 |
| 5 — Workflows, commands and pages | ST11, ST12, ST13, ST14, ST15, ST20, ST21 |
| 6 — Build, cache and diagnostics | ST23, ST24 |
| 7 — Documentation, retirement and aggregate acceptance | ST25, ST26 |

### Dependency decisions

- Plan the complete programme before implementation. Prioritize correctness and selection/lifecycle safety, with early query-budget and CSS-parity characterization. Phase grouping does not create a technical all-to-all barrier or a fixed PR count.
- Only real safety, consumed contract or concrete shared-owner constraints are hard edges. Separate them from priority, review order and temporary edit coordination. Selection must be trustworthy before relying on affected qualification; ST04 is not a universal prerequisite for every unrelated change.
- ST10 does not require ST08: forms consume the public Button contract, not its CVA internals. ST12 does not require all ST11; coordinate actual shared proof/form/identity/reconciliation edits. Security/workflow packages consume the relevant neutral-proof, form and error contracts.
- ST17 does not depend on ST01. ST19 integrates the quota migration and search backfill; the limiter's own populated-upgrade checks belong with ST01 immediately. Credential work and migration ownership mostly require coordination, not a whole-package dependency.
- ST18 depends on ST16/ST17 only for contracts or shared owners it actually consumes or changes; identify the concrete prerequisite for each hard edge. Other sequencing is review/edit coordination. ST20 waits only for its actual unsettled schema/command owners and never splits transactions. ST21 consumes settled feature/query contracts.
- ST22 can be characterized independently, with shared runner edits coordinated with ST03. ST23 consumes the stylesheet policy and lifecycle contract. ST24 consumes the settled error/command-stage owners and includes safe cache fallback.
- ST25 follows final owners; ST26 covers all accepted ST01–ST25, including mandatory ST09. Preserve still-valid evidence, but refresh affected evidence after changes or base movement. Never combine different candidate SHAs into one aggregate pass.

## Testing Decisions

### Confirmed seams and test quality

The owner already confirmed these seams through Q6/Q17 and the Q19 Book checks. Prefer existing highest observable boundaries: genuine application HTTP through the owned native Wrangler Harness and srvx listener, the app's actual D1 binding/original migrations, and native Playwright browser contexts with genuine authentication cookies. Extend current test families/fixtures rather than adding another runtime, SQL proxy, fake auth/cookies, copied route guards or broad testing framework.

Fast pure contract/type/resolver checks and actual client builds complement those boundaries. The Book uses a small owned path-containment check at its actual filesystem boundary. Neither a mock, a source assertion, a screenshot nor an isolated SQLite/JavaScript counterexample proves application authorization, persistence or native interoperability. Tests must assert external behavior and meaningful failure states, not mirror the refactor's implementation or generate their own expected historical fingerprints.

Use synthetic data and owned disposable stores/resources. Keep native fixture ownership, same-effect HTTP/RPC causal controls, dedicated stores for schema/race cases, no reset masquerading as restart, nested cleanup, zero retries and no skipped acceptance. Retain the first failure and distinguish its source/candidate from repaired results. Capture remains optional evidence after behavioral assertions, with sensitive masking; reference screenshots are not current application qualification.

### Acceptance matrix

| Gate | Required observable evidence | Existing prior art to extend |
| --- | --- | --- |
| T01 — Limiter ownership | Installed native auth and real business HTTP/D1 paths show native cleanup cannot remove a live business bucket. Cover exhausted/fresh/unrelated action/IP keys, rollover/expiry/concurrent consumption and original origin/missing-IP/error precedence. A quiesced populated forward upgrade preserves counters/anchors and native rows. Retarget business storage assertions only; native-auth tests remain native. | Existing native rate-limit, application HTTP and forwarded-address/auth families; current owned D1 fixtures. |
| T02 — Unicode and preserved identity | Actual Account rendering handles BMP/non-BMP names and empty fallback without lone surrogates. Independent old literals/digests, full-width phone, Username case, null/false/empty and payload order retain current wire/replay semantics. | Existing identity/application contract tests, real identity/applicant HTTP families and R11 Account render. |
| T03 — Selection and boundary enforcement | Complete selection results/native project discovery for create, rename, deletion, extraction and later extracted-file-only edits retain required desktop/mobile engines. Exercise parent and cumulative bases and fail-closed unknowns. Positive/negative alias/type-only cases and actual client build establish the relevant runtime boundary; inspect any real cycle rather than assuming every cycle is invalid. | Existing native-selection, test-selection, snapshot-gate, type-contract and client-build checks. |
| T04 — Authority, workflows and private state | Genuine request/session/D1/browser journeys retain role/target/actor/key policy, session/revision/confirmation/Temporary-password expiry and SQL-time denial. Cover frozen review, dirty/discard, late disposal, lost responses, duplicate/replay/conflict, refresh/reconcile and explicit submit. Verify private-note separation, no plaintext storage/replay, 201 original secret versus 200 receipt-only replay, transient exact-query cleanup and fresh unavailable/status recovery. | Existing assisted, Identity, security, applicant, decision, restriction/deletion, restricted-status, session-renewal, worker-fault and Query-provider/contract families. |
| T05 — Staff/history/queue/inbox bounds | Fixtures exceed 25 and include equal sort values, selected detail outside the page, missing/denied targets and retained history after deletion. Genuine page/API responses and underlying reads are bounded, not fetch-all-then-slice. Prove every permitted row remains reachable, stable previous/next order, query/back/task restoration, explicit refresh and no background review reorder. Existing audit permission/render claims remain valid; add the new paging/detail claims rather than asserting that all old audit tests are absent. Cover invalid/context-incompatible state under the chosen paging mechanism, authority changes and missing anchors where applicable. | Existing managed-target, decision queue, inbox/audit/R11 and retained-history journeys using owned account fixtures. |
| T06 — Search projection | Verify trimmed literal percent/underscore, Unicode case mapping, no extra width/Unicode normalization, 100-code-point validation without truncation, selected-detail retention and first-page reset. Populated old rows and every production identity writer maintain the same projection; sign-in keys/fingerprints stay unchanged. Collect query-plan evidence before adding an index; do not infer latency from a bounded payload alone. Superseded responses must not overwrite current results, loading/error, paging or URL state. Cover reversed success/error order, IME composition, clear, overlength input and pending Back/Forward navigation; apply T07 query-budget checks to legal 100-code-point multibyte search and literal percent/underscore. | Existing name-sign-in, identity/applicant/assisted HTTP and contract fixtures, extended through the same D1 boundary. |
| T07 — Home completeness | More than 25 items in each applicable section and scope cardinality beyond the former parameter budget remain reachable through explicit next batches. Verify relational authority, server date filtering, all-future default, week/month/year rollover, Hong Kong date/URL restoration, distinct participation states, inline notices and the participation anchor. No arbitrary horizon or past-event access is added. Inspect generated statements, counting all binds against D1's per-statement limit alongside native D1 evidence. Cover high-cardinality scopes, more than 25 Events on one day, another day only in later batches and week/date navigation. | Existing Home participation/notices, activity/notice scenario builders and church-time checks. |
| T08 — Presentation/form parity | Production/native builds of the same candidate preserve used classes/assets, representative computed styles, responsive/state variants and dependency-component classes. Native browser actions preserve Button/form DOM, refs/focus/keyboard, validation, disabled/busy behavior, transformed review values and icon geometry/stroke. Refresh affected desktop/iPhone WebKit/Pixel evidence with existing assertions and masks. | Existing sign-in/R11 presentation families, native presentation helper, real feature UI journeys and typed form contracts. |
| T09 — Schema and atomic commands | Fresh and populated disposable upgrades preserve migration tracking/history/triggers, quota state and deterministic search backfill. Real mutation/concurrency/failure cases retain atomic batches, independent current-authority checks, immutable receipts, append order and rollback behavior. No personal/production store is touched. Include applicable failed/ignored writes and replay against independently expected identity/projection state. Verify populated backfill completion before the projection becomes authoritative, including a safe interruption/restart outcome. | Existing original-migration/ABORT/fault tests, native D1 fixtures, causal clock and credential-verifier race controls. |
| T10 — Lifecycle/index/privacy | Characterize normal success, successful leader with an owned descendant, failure, SIGINT, timeout, missing command and EPERM versus ESRCH. Owned process groups/listeners are absent when success is claimed; never probe/kill unrelated PIDs. Recheck exact staged index, partial-hunk formatting restoration, privacy rejection, native discovery/execution equality and first-failure preservation. A source gap is not a reproduced orphan. | Existing process-lifecycle, snapshot-gate, native fixture and lifecycle-child families. |
| T11 — Build/cache/upgrades | Controlled owned cache roots exercise HIT, MISS, compiled-input invalidation, assertion-only non-inputs, corrupt-entry rebuild, relocation and unavailable-storage uncached execution. Preserve true app/binding/module identity and pinned Node/pnpm. Public-seam upgrade checks cover actual auth, native runtime, styling and form compatibility. Runtime tests remain fresh; timings are diagnostic, not a promised historical speed ratio or identical fresh-build hash. | Existing native-build, portability, Turbo input/privacy and native Harness interoperability checks. |
| T12 — Diagnostics/configuration | Synthetic auth/access/business/cache faults yield useful fixed safe fields without raw exceptions, secrets, contact data, cookies, SQL binds or changed public errors/native envelopes. Invalid required configuration fails explicitly at existing owners. Cache storage failure falls back safely without a raw exception payload or retrying a failed build. | Existing guard/worker-fault, configuration/privacy, native-build and error-contract families. |
| T13 — Book path containment | Owned synthetic fixtures show valid in-root paths work and outside, encoded-traversal and same-prefix sibling paths fail. Preserve localhost serving, reference screens/assets/license and normal navigation. The planning counterexample was pure path calculation, not a server run or outside-file read. Verify owned in-root and outside-root symlink fixtures alongside the existing path cases. | Existing Book local helper; a minimal direct boundary check, not a new server/testing framework. |
| T14 — Maintainability exercises | Demonstrate changing Staff review copy through its owner; adding a legitimate business error without contradictory copies; designing a Roles HTTP test using existing fixtures without implementing Roles; and tracing an invariant from rule through command and SQL/trigger to its real test. Use understandable ownership and working boundaries, not LOC/test-count targets. Record the four exercises on a named starting revision before modifying their relevant owners; retain package-level after results for the ST26 comparison. | Existing feature interfaces, typed business RPC, owned native fixtures and invariant/causal tests. |
| T15 — Complete candidate acceptance | Reconcile all tracked dispositions and final additions/renames/removals, then freeze one exact source tree/base/toolchain. Qualify parent changes and cumulative scope, run relevant targeted gates and full local pnpm test:qualify, refresh affected presentation evidence and perform the four exercises. Complete independent Standards/Spec review and separate owner acceptance with exact source, selected/executed cases/projects, first failures/repairs, bypasses/unperformed gates and evidence limits. | Existing immutable Git snapshot gate, slim CI/heavy local policy, native reports and independent review process. |

The starting toolchain is the repository's pinned Node 24.21.0 and pnpm 10.33.2. Preserve slim remote CI; heavy native/browser/visual qualification remains local. A changed candidate/base invalidates affected evidence; no cached test pass or green result from another SHA satisfies T15.

No implementation/build/repository test/native runtime/populated migration/browser qualification has run for this programme at publication. Current readiness rests on confirmed decisions, source/coverage review and isolated read-only checks. Historical testing closeout remains candidate-specific evidence, not a pass for future programme changes.

## Out of Scope

- Starting implementation or detailed execution/ticket planning merely by publishing this issue; directly creating the 26 proposed implementation tickets.
- Implementing Slice 3 Roles/delegation, a generic permissions engine or in-app Admin promotion/demotion. The separate Roles specification remains unchanged.
- New recovery, dashboard, queue or activity-management product features beyond the agreed refactors and bounded browsing of delivered functionality.
- Production cutover/deployment, remote member-data actions, merging, release, zero-downtime mixed old/new Worker compatibility or assumed dual-write infrastructure.
- Rewriting historical migration SQL, resetting personal stores, persisting secrets/auth snapshots, exposing a test bootstrap in production or replacing native auth behavior.
- Blanket directory moves, a universal identity normalizer/operation engine/error normalizer, a second runner/cache/SQL/runtime platform, speculative indexes or a new documentation/glossary hierarchy.
- External telemetry, automatic request-ID infrastructure, raw-sensitive diagnostic logging or unsupported performance/security guarantees.
- Automatically absorbing issue #86's standalone Harness teardown observation. It remains separately tracked unless evidence demonstrates a causal blocker to a required programme gate; no deterministic app/auth/D1 failure is inferred from it.
- Changing R11 visual/product authority or treating reference assets, generated metadata, screenshots, mocks or historical green runs as acceptance of the changed application.

## Further Notes

### Authority and provenance

- Q1–Q19/R2 and the owner-confirmed FB87-01–08 refinements govern R3. The R2 CEO readiness review is historical authoring evidence, not an R3 code review or implementation/release acceptance. This published issue becomes the canonical programme scope/progress authority; the local brief records rationale/provenance.
- Reviewed source baseline: **272dddbc887e7c3343a61831f91833fb687047bc**, tree **fc539e58b119067477fd339811f3a110663c8792**. Current main matched it at publication preflight. Refresh source and issue comments before subsequent work; reconcile intervening changes rather than replaying stale evidence.
- [Pinned repository baseline](https://github.com/Noahlw/efcc-system/tree/272dddbc887e7c3343a61831f91833fb687047bc), [R11 authority #30](https://github.com/Noahlw/efcc-system/issues/30), [separate Slice 3 specification #29](https://github.com/Noahlw/efcc-system/issues/29), [native testing foundation #66](https://github.com/Noahlw/efcc-system/issues/66), [historical closeout #85](https://github.com/Noahlw/efcc-system/issues/85) and [separate teardown follow-up #86](https://github.com/Noahlw/efcc-system/issues/86).
- Existing ADRs retain native auth/business-access separation, built-app Harness ownership, native presentation, same-effect causal controls and immutable build reuse. Accepted implementation-pending design refinements add business/native storage separation, conservative mobile selection, bounded projections/search/Home and explicit UI library responsibilities; their normative substance is included above, so no local-only file is required to understand this issue.
- The audit is research: 28 findings, 26 proposals and 210 scoped records. Its isolated predicate/regex/Unicode experiments are not runtime acceptance. Review reconciled **366 tracked files: 75 CHANGE / 178 KEEP / 113 EXCLUDE**, with zero missing/extra/duplicate paths. Disposition coverage does not prove a fresh read of every line or absence of defects.
- Evidence depths remain explicit: 95 prior full-source records carried at the exact baseline; 146 limited/unrecorded paths supplemented with source/contract/provenance inspection; 125 reference/generated entries checked by appropriate provenance/interface depth, including the Book helper counterexample. The latter group retains 80 JPEGs, 21 SVGs, their license, twelve reference sources and eleven migration metadata files. Root lockfile specifiers were checked as generated dependency provenance, not vendored implementation review.
- Pinned source supplied gaps in the older CBM checkout; no index repair was performed. Three restarted subagents supplied factual input, not the future implementation's independent Standards/Spec review.
- R2 input SHA-256: **a470918c496fa9b231f4a9ad6935457430f795c2f597830987373de5640fb5a5**. Full local evidence-ledger SHA-256: **e9c1ebd70ff57341028ec2a84e63518d2a638886208912244e1f04338e6df788**. The portable projection below carries every baseline path/disposition/package/depth; the pinned commit resolves its source identity. Local detailed rationale is supporting evidence, not another scope authority.
- The ready-for-agent label records a fully specified issue under the configured triage vocabulary. The user invokes the next planning/ticket/implementation stage separately. No assignee, sub-issues, blocking-ticket graph, PR, merge or deployment is created by this publication.

### Portable baseline disposition ledger

All 366 baseline files are listed below. Package cells contain ST numbers; a dash adds no package. CHANGE refers to its package contract; KEEP preserves the inspected owner/contract; EXCLUDE preserves generated/reference material. These are dispositions, not mandatory file edits. Each `@ directory` line scopes subsequent filenames; `.` means repository root.

Disposition: **C** = CHANGE, **K** = KEEP, **E** = EXCLUDE/preserve outside manual product refactoring. Review depth: **P** = prior full-source read carried at identical baseline; **F** = fresh full-source read; **B** = bounded semantic/caller/contract inspection; **D** = full document review; **G** = generated metadata/dependency provenance; **R** = reference asset/interface provenance; **I** = full helper source plus isolated path counterexample. None denotes a runtime pass.

<details>
<summary>All 366 baseline paths</summary>

```text
name,disposition,packages,depth
@ .
.dev.vars.example,K,05/26,F
.gitignore,K,22/23/26,F
.lintstagedrc.json,K,22/26,F
.nvmrc,K,23/26,F
AGENTS.md,K,25,P
GLOSSARY.md,K,25,P
README.md,K,25,P
commitlint.config.mjs,K,-,F
drizzle.config.ts,K,19/26,F
oxfmt.config.ts,K,22/26,F
oxlint.config.ts,C,04,P
package.json,C,08/09/23,P
playwright.causal.config.ts,K,22/26,F
playwright.dev.config.ts,K,22/26,F
playwright.discovery.config.ts,K,03/22/26,F
playwright.features.config.ts,K,03/26,F
playwright.lifecycle.config.ts,K,22/26,F
playwright.native.config.ts,K,22/26,F
pnpm-lock.yaml,C,08/09/23,G
tsconfig.json,K,04,P
turbo.json,K,07/23,P
vite.config.ts,C,07/23,P
vitest.config.ts,K,22/26,F
wrangler.jsonc,K,24,P
@ .github/workflows
checks.yml,K,22/26,P
@ .husky
commit-msg,K,-,F
pre-commit,K,22/26,P
@ docs/adr
0001-authentication-and-business-access.md,C,05/25,D
0002-native-testing-runtime.md,K,22/23/26,D
0003-native-presentation.md,K,07/09/26,D
0004-native-causal-controls.md,K,20/22/26,D
0005-native-immutable-builds.md,K,23/26,D
@ docs/agents
domain.md,K,25,P
issue-tracker.md,K,25,D
triage-labels.md,K,25,D
@ docs/design/slice-1-2-ui
README.md,K,09/25/26,D
@ docs/design/slice-1-2-ui/screenbook
app.css,K,09/25,R
app.html,K,09/25,R
app.mjs,K,09/25,R
book.css,K,09/25,R
book.mjs,K,09/25,R
check.mjs,K,09/25,R
foundation.css,K,09/25,R
gallery.html,K,09/25,R
index.html,K,09/25,R
render.mjs,K,09/25,R
screens.mjs,K,09/25,R
serve.mjs,C,25,I
@ docs/design/slice-1-2-ui/screenbook/assets
ArrowLeft.svg,E,09/25,R
CalendarDays.svg,E,09/25,R
ChevronLeft.svg,E,09/25,R
ChevronRight.svg,E,09/25,R
CircleCheck.svg,E,09/25,R
CircleUserRound.svg,E,09/25,R
Eye.svg,E,09/25,R
FileText.svg,E,09/25,R
House.svg,E,09/25,R
KeyRound.svg,E,09/25,R
LUCIDE-LICENSE,E,09/25,R
LogOut.svg,E,09/25,R
Mail.svg,E,09/25,R
Plus.svg,E,09/25,R
RefreshCw.svg,E,09/25,R
Search.svg,E,09/25,R
Settings2.svg,E,09/25,R
ShieldCheck.svg,E,09/25,R
Smartphone.svg,E,09/25,R
Trash2.svg,E,09/25,R
UserRound.svg,E,09/25,R
UsersRound.svg,E,09/25,R
@ docs/design/slice-1-2-ui/screenbook/captures
account-desktop.jpg,E,09/25,R
account-mobile.jpg,E,09/25,R
accounts-desktop.jpg,E,09/25,R
accounts-mobile.jpg,E,09/25,R
app-edit-desktop.jpg,E,09/25,R
app-edit-mobile.jpg,E,09/25,R
app-resubmit-desktop.jpg,E,09/25,R
app-resubmit-mobile.jpg,E,09/25,R
app-withdraw-desktop.jpg,E,09/25,R
app-withdraw-mobile.jpg,E,09/25,R
application-desktop.jpg,E,09/25,R
application-mobile.jpg,E,09/25,R
application-review-desktop.jpg,E,09/25,R
application-review-mobile.jpg,E,09/25,R
applications-desktop.jpg,E,09/25,R
applications-mobile.jpg,E,09/25,R
apply-desktop.jpg,E,09/25,R
apply-mobile.jpg,E,09/25,R
apply-result-desktop.jpg,E,09/25,R
apply-result-mobile.jpg,E,09/25,R
audit-desktop.jpg,E,09/25,R
audit-detail-desktop.jpg,E,09/25,R
audit-detail-mobile.jpg,E,09/25,R
audit-mobile.jpg,E,09/25,R
ban-desktop.jpg,E,09/25,R
ban-mobile.jpg,E,09/25,R
confirm-desktop.jpg,E,09/25,R
confirm-mobile.jpg,E,09/25,R
create-desktop.jpg,E,09/25,R
create-mobile.jpg,E,09/25,R
deactivate-desktop.jpg,E,09/25,R
deactivate-mobile.jpg,E,09/25,R
deletion-desktop.jpg,E,09/25,R
deletion-mobile.jpg,E,09/25,R
denied-desktop.jpg,E,09/25,R
denied-mobile.jpg,E,09/25,R
error-desktop.jpg,E,09/25,R
error-mobile.jpg,E,09/25,R
handover-desktop.jpg,E,09/25,R
handover-mobile.jpg,E,09/25,R
home-desktop.jpg,E,09/25,R
home-mobile.jpg,E,09/25,R
identity-desktop.jpg,E,09/25,R
identity-mobile.jpg,E,09/25,R
inbox-desktop.jpg,E,09/25,R
inbox-mobile.jpg,E,09/25,R
leave-desktop.jpg,E,09/25,R
leave-mobile.jpg,E,09/25,R
management-desktop.jpg,E,09/25,R
management-mobile.jpg,E,09/25,R
operation-desktop.jpg,E,09/25,R
operation-mobile.jpg,E,09/25,R
password-desktop.jpg,E,09/25,R
password-mobile.jpg,E,09/25,R
person-desktop.jpg,E,09/25,R
person-mobile.jpg,E,09/25,R
phone-desktop.jpg,E,09/25,R
phone-mobile.jpg,E,09/25,R
reactivate-desktop.jpg,E,09/25,R
reactivate-mobile.jpg,E,09/25,R
recovery-desktop.jpg,E,09/25,R
recovery-mobile.jpg,E,09/25,R
restrictions-desktop.jpg,E,09/25,R
restrictions-mobile.jpg,E,09/25,R
security-desktop.jpg,E,09/25,R
security-mobile.jpg,E,09/25,R
sessions-desktop.jpg,E,09/25,R
sessions-mobile.jpg,E,09/25,R
signin-desktop.jpg,E,09/25,R
signin-mobile.jpg,E,09/25,R
signout-desktop.jpg,E,09/25,R
signout-mobile.jpg,E,09/25,R
status-desktop.jpg,E,09/25,R
status-mobile.jpg,E,09/25,R
temp-password-desktop.jpg,E,09/25,R
temp-password-mobile.jpg,E,09/25,R
unavailable-desktop.jpg,E,09/25,R
unavailable-mobile.jpg,E,09/25,R
unban-desktop.jpg,E,09/25,R
unban-mobile.jpg,E,09/25,R
@ docs
testing.md,C,25,P
@ migrations
0000_access_foundation.sql,K,19/20,P
0001_account_application.sql,K,19/20,P
0002_application_decisions.sql,K,19/20,P
0003_account_security.sql,K,19/20,P
0004_assisted_accounts.sql,K,19/20,P
0005_applicant_actions.sql,K,19/20,P
0006_application_retention.sql,K,19/20,P
0007_account_identity.sql,K,19/20,P
0008_access_restrictions.sql,K,19/20,P
0009_eligible_deletion.sql,K,19/20,P
@ migrations/meta
0000_snapshot.json,E,19,G
0001_snapshot.json,E,19,G
0002_snapshot.json,E,19,G
0003_snapshot.json,E,19,G
0004_snapshot.json,E,19,G
0005_snapshot.json,E,19,G
0006_snapshot.json,E,19,G
0007_snapshot.json,E,19,G
0008_snapshot.json,E,19,G
0009_snapshot.json,E,19,G
_journal.json,E,19,G
@ scripts
assert-native-dev-root.ts,K,22/26,F
build-causal.ts,K,22/26,F
build-credential-race.ts,K,05/12/13/22/26,F
portable-build.ts,K,23/26,F
test-runner.ts,C,03/22/23/24/26,B
test-selection.ts,C,03/26,B
test-snapshot.ts,K,03/22,P
@ src/app/(auth)/apply
page.tsx,K,21/26,P
@ src/app/(auth)
layout.tsx,K,21/26,P
@ src/app/(auth)/sign-in
page.tsx,K,21/26,P
@ src/app/(task)/application
page.tsx,C,21/26,P
@ src/app/(task)
layout.tsx,K,21/26,P
@ src/app/(task)/status
page.tsx,K,21/26,P
@ src/app/(workspace)/account
page.tsx,C,02/21,P
@ src/app/(workspace)/inbox
page.tsx,C,21/26,P
@ src/app/(workspace)
page.tsx,C,17/21,P
@ src/app/api/auth/[...all]
route.ts,K,05/24/26,P
@ src/app/api/v2/[[...route]]
route.ts,K,21/26,P
@ src/app
error.tsx,K,21/26,P
globals.css,C,07/23,F
layout.tsx,K,21/26,P
@ src/app/staff/account-audit
page.tsx,C,21/26,P
@ src/app/staff/accounts
page.tsx,C,21/16,F
@ src/app/staff/applications
page.tsx,C,21/26,P
@ src/app/unavailable
page.tsx,K,21/26,P
@ src/components
page-frame.tsx,K,21/26,P
primary-navigation.tsx,C,21/26,P
query-provider.tsx,K,11/12/13/14/15,F
unavailable-view.tsx,K,21,F
unsaved-changes-link.tsx,K,21/26,P
@ src/components/ui
app-form.tsx,C,10,P
button.tsx,C,08,P
field.tsx,K,10/08,F
icon.tsx,C,09,F
input.tsx,K,08/10,F
@ src
env.d.ts,K,24,F
proxy.ts,K,05/24/26,P
@ src/features/account
account-actors.ts,K,05,P
account-change-operations.ts,C,05/20,P
bounded-json-validator.ts,K,06/24,P
business-request.ts,C,01,P
identity-validation.ts,K,02/14/16,P
managed-accounts.ts,C,16/21,F
operation-error.ts,K,06,F
operation-presentation.tsx,C,08,P
read-routes.ts,C,16/18,P
reconciliation-query.ts,K,11/12/13/14/15/20,F
staff-account-identifier.ts,K,12/15/16/21,F
staff-account-routes.ts,C,12/16/06,F
timestamps.ts,K,05/12/13/15/19/20,F
@ src/features/account/applications
applicant-actions.ts,C,14/16/20,P
applicant-form.tsx,C,14/10/06,B
applicant-routes.ts,K,01/06/14,F
application-contract.ts,K,06/14/19,F
application-form.tsx,C,14/10/06,B
applications.ts,C,14/16/20,P
@ src/features/account/assisted-accounts
assisted-accounts.ts,C,12/16/20,P
staff-account-contract.ts,K,06/12,F
staff-accounts-form.tsx,C,12/10/05,B
@ src/features/account/decisions
decision-contract.ts,K,06/15,F
decision-review.tsx,C,15/18/21/10/05/06,B
decision-routes.ts,C,06/18,F
decisions.ts,C,15/18/20,P
@ src/features/account/deletion
deletion-contract.ts,K,06/15,F
deletion-form.tsx,C,15/10/05/06,B
deletion-routes.ts,K,01/06/15/20,F
deletion.ts,K,15/20,P
@ src/features/account/identity-changes
identity-changes.ts,C,11/16/20,P
identity-contract.ts,K,06/11,F
identity-form-views.tsx,C,11,B
identity-form.tsx,C,11/10/05,B
identity-routes.ts,K,01/06/11/20,F
@ src/features/account/restrictions
restriction-contract.ts,K,06/15,F
restriction-routes.ts,K,01/06/15/20,F
restrictions-form.tsx,C,15/05/06,B
restrictions.ts,K,15/20,P
@ src/features/account/security
security-contract.ts,K,06/13,F
security-form-views.tsx,C,13/10,B
security-form.tsx,C,13/10/05,B
security-routes.ts,K,01/06/13/20,F
security.ts,C,05/13/20,P
@ src/features/account/staff-workspace
audit-routes.ts,C,06/18,F
audit.ts,C,16/18/21,P
staff-management-workspace.tsx,K,16/21,B
staff-people-href.ts,K,16/21,F
staff-people-list.tsx,C,16/18/21,P
staff-task-contract.ts,K,16/18/21,P
@ src/features/auth
client.ts,K,21/26,P
restored-page-revalidator.tsx,K,21/26,P
sign-in-form.tsx,C,10/14,P
sign-out-button.tsx,K,21/26,P
@ src/features/home
labels.ts,K,17,F
notices.ts,C,17/21,P
queries.ts,C,17/21,P
upcoming-events.tsx,C,17/21,P
@ src/features/identity
labels.ts,K,15/16/21,F
name-lookup.ts,K,02/14/16,P
name-matching.ts,K,02/14/16,P
queries.ts,K,16/21,F
recheck-status-button.tsx,K,17/21,F
restrictions.ts,K,15/17/21,F
@ src/server/api
app.ts,K,06/24,P
@ src/server/auth
access.ts,K,05/24/26,P
allowlist.ts,K,05/24/26,P
index.ts,K,01/24,P
password-verification.ts,K,05/24/26,P
@ src/server/auth/plugins
name-sign-in.ts,K,05/24/26,P
@ src/server/db
client.ts,K,20/26,P
required-receipt.ts,K,20/26,P
@ src/server/db/schema
account-changes.ts,K,19/20,P
account-security.ts,K,19/20,P
activities.ts,K,17/19,P
applicant-actions.ts,K,19/20,P
applications.ts,K,19/20,P
auth.ts,K,01/19,P
identity.ts,K,16/19,P
notices.ts,K,19/20,P
staff-accounts.ts,K,19/20,P
@ src/shared
business-rpc.ts,K,04/06,F
protected-pages.ts,K,21/26,P
@ src/shared/time
church-time.ts,K,17/18/21,F
@ tests/e2e
access-foundation.spec.ts,K,05/06/21/26,B
account-applicant.spec.ts,C,06/14/19/20/26,B
account-application.spec.ts,C,01/02/06/14/19/20/21/26,B
account-clock-matrix.spec.ts,K,20/22/26,B
guard-failures.spec.ts,K,19/20/24/26,B
home-notices.spec.ts,C,17/18/21/26,B
home-participation.spec.ts,C,17/18/21/26,B
name-sign-in.spec.ts,K,05/11/21/26,B
presentation-assertions.ts,K,07/08/09/10/21/23,F
r11-ui.spec.ts,C,02/07/08/09/10/21/23/26,B
rate-limit.spec.ts,C,01,P
session-renewal.spec.ts,K,05/13/21/22,B
sign-in-experience.spec.ts,C,07/08/09/10/21/26,B
testing-foundation.spec.ts,C,01/03/05/19/22/23/26,B
worker-faults.spec.ts,C,19/24/26,B
@ tests/e2e/account-assisted
actor-authority.spec.ts,C,05/12/16/21/26,B
credential-lifecycle.spec.ts,K,05/12/20/21/26,B
fixtures.ts,C,12/16/19,F
staff-ui.spec.ts,C,12/16/21/26,B
transaction-rollback.spec.ts,K,12/15/19/20/26,B
@ tests/e2e/account-decisions
http.spec.ts,K,05/15/20/26,B
staff-ui.spec.ts,C,05/15/18/21/26,B
test-helpers.ts,K,15/20,F
@ tests/e2e/account-deletion
deletion-ui.spec.ts,K,15/21/26,B
fixtures.ts,K,15/19,F
http.spec.ts,K,05/15/19/20/26,B
@ tests/e2e/account-identity
http.spec.ts,C,05/11/16/19/20/26,B
identity-ui.spec.ts,K,05/11/13/21/26,B
test-helpers.ts,K,11/20,F
@ tests/e2e/account-restrictions
http.spec.ts,K,05/15/20/26,B
restrictions-ui.spec.ts,K,15/21/26,B
test-helpers.ts,K,15/20,F
@ tests/e2e/account-security
fixtures.ts,K,05/13,F
holder-ui.spec.ts,K,05/13/21/26,B
http.spec.ts,K,05/13/20/26,B
@ tests/e2e/rate-limit
forwarded-for.spec.ts,K,01,F
@ tests/e2e/restricted-status
dev-readiness.spec.ts,K,05/22/23/26,B
fixtures.ts,K,05/22,F
status.spec.ts,K,05/21/26,B
@ tests/scenarios
accounts.ts,C,16/18/26,F
activities.ts,C,17/18/26,F
notices.ts,C,17/18/26,F
@ tests/shared/account
application-contract.test.ts,K,06/14/20,F
decision-contract.test.ts,K,06/15/20,F
deletion-contract.test.ts,K,06/15/20,F
identity-contract.test.ts,K,05/06/11/20,F
restriction-contract.test.ts,K,05/06/15/20,F
security-contract.test.ts,K,05/06/13/20,F
staff-account-contract.test.ts,K,05/06/12/20,F
@ tests/shared
bounded-body.test.ts,K,06,P
church-time.test.ts,K,17/18/21,F
public-auth-boundary.test.ts,K,03/05/22,F
@ tests/shared/tooling
fixtures.ts,K,03/22/23,F
native-build.test.ts,C,07/22/23,F
native-selection.test.ts,C,03/22/23,B
process-lifecycle.test.ts,C,22/26,P
snapshot-gate.test.ts,C,03/22/23/26,B
test-selection.test.ts,C,03/04/22,B
@ tests/support
causal.ts,K,22/26,F
credential-fixtures.ts,K,05/12/13/22/26,F
fixtures.ts,K,22/26,P
home.ts,C,17/18/21/26,B
lifecycle-child.spec.ts,K,22,F
native-source.ts,K,03/22/23,F
@ tests/types
business-api.ts,K,04/06,F
@ tests/ui
app-error.test.tsx,K,06/24/21,F
query-provider.test.tsx,K,05/06/21,F
@ tests/worker
clock-matrix.ts,K,20/22,F
credential-race.ts,K,05/22,F
dev-driver.ts,K,22/23,F
provision.jsonc,K,19/22/23/26,F
provision.ts,C,05/11/12/14/16/19,F
tsconfig.json,K,03/22/23,F
```

</details>
