<!-- efcc-foundation:87:R3:W08 -->

**Review label:** Staff browsing＋live search

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 4; primary 4. Phases are review groups, not global execution barriers.

**Packages:** ST16, ST19, ST21
**Applicable gates:** T02, T04, T05, T06, T08, T09
**User stories:** 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 27, 28, 42, 43, 44, 52

## What to build

Staff can page and search the complete permitted directory with independently authorized detail, atomic projections, safe backfill, IME handling and latest-query results.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W08.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W08.C02**: [#91 W04.C02](https://github.com/Noahlw/efcc-system/issues/91), W08.C01.
  - [#91 W04.C02](https://github.com/Noahlw/efcc-system/issues/91): Consumes the settled typed business validation/error contract for legal versus overlength query input.
  - W08.C01: Consumes the bounded Staff reader, paging and independent-detail contract.
- **W08.C03**: W08.C02.
  - W08.C02: Consumes the validated bounded search HTTP/read contract and authoritative projection.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W08.C01 — Bound Staff page/API browsing and independent selected detail

Source: superseded D17; original review phase 4.

Permitted Staff browse 25-row account pages and independently authorized detail without a remaining wholesale exposed API.

Gates: T04, T05.

- [ ] **D17-A01** — Bound underlying reads and projections for both the page and mounted GET /staff/accounts; do not fetch all then slice or retire the endpoint from missing in-repo callers.
- [ ] **D17-A02** — Retain non-self discovery, Admin other-role versus ordinary Staff Member target policy, name-first ordering and stable ID ties.
- [ ] **D17-A03** — Selected detail remains independently authorized outside the page; missing/denied targets and current-session/SQL-time authority retain their existing outcomes.
- [ ] **D17-A04** — Preserve URL query/paging/selection/task-return state. After authorization, invalid/inapplicable positions normalize to page one; query validation and denied access are not bypassed.
- [ ] **D17-A05** — Fixtures exceed 25 and prove full reachability, previous/next and restoration; live server-search UI remains W08.C03.

Coordination: Defines the concrete bounded reader/detail contract consumed by W08.C02 and relevant Staff tasks. No Home prerequisite.

### W08.C02 — Make Staff search projections atomic across every identity writer

Source: superseded D18; original review phase 4.

A bounded real Staff HTTP read searches old and newly written identities consistently without altering sign-in or historical operation identity.

Gates: T02, T05, T06, T09.

- [ ] **D18-A01** — Use a dedicated EFCC projection of Full Chinese name plus space plus display Username, with identical deterministic application case mapping for data/query and no extra Unicode normalization.
- [ ] **D18-A02** — Preserve trimmed literal substring semantics, percent/underscore, legal 100-code-point multibyte input and visible rejection at 101 without truncation; exclude phone/email.
- [ ] **D18-A03** — Maintain projection in the existing atomic writes for anonymous creation, signed-in applicant correction, Staff identity correction and assisted creation; preserve exact sign-in keys, width conversion, serialization and old digests.
- [ ] **D18-A04** — A populated additive backfill uses that same application rule, permits existing nullable display Username cases, verifies completion before authoritative use and demonstrates safe interruption/restart.
- [ ] **D18-A05** — Applicable real failure/ignored-effect/replay cases use independently expected state: no committed identity with stale projection and no old replay restoring an older key over a newer identity.
- [ ] **D18-A06** — Inspect generated statements and all binds against native D1 limits; legal input is not constrained by LIKE pattern bytes. Add indexes only from query-plan evidence, with no invented latency SLA.

Coordination: Owns the projection contract all later identity-changing workflows preserve. Migration sequencing coordinates with [#90 W03.C01](https://github.com/Noahlw/efcc-system/issues/90)/[#106 W19.C01](https://github.com/Noahlw/efcc-system/issues/106), not a mixed-version deployment platform.

### W08.C03 — Keep live Staff search attached to the latest committed query

Source: superseded D19; original review phase 4.

Staff can type, clear, page and navigate search without stale responses or unfinished Chinese composition taking over the current task.

Gates: T05, T06, T08.

- [ ] **D19-A01** — Commit live search after the agreed short pause; composition start/update does not commit search/navigation, and normal timing applies after composition ends.
- [ ] **D19-A02** — A superseded success or failure cannot overwrite current results, loading/error, page or URL. Prove reversed response order visibly rather than only asserting cancellation was called.
- [ ] **D19-A03** — Exercise clear, overlength input and Back/Forward during pending work, preserving deterministic valid-query state and visible validation without silent truncation.
- [ ] **D19-A04** — A query change resets page one while independently authorized detail remains; preserve task return context and avoid background review reordering.
- [ ] **D19-A05** — Reuse existing framework and transient-private-state behavior, with no automatic retry, persistence or generic search lifecycle engine.

Coordination: A distinct browser-complete slice; no dependency on unrelated workflow refactors or Home.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
