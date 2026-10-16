<!-- efcc-foundation:87:R3:W09 -->

**Review label:** Home bounded reads／calendar truth

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 4; primary 4. Phases are review groups, not global execution barriers.

**Packages:** ST17, ST21
**Applicable gates:** T07, T08, T09
**User stories:** 21, 22, 23, 24, 25, 26, 42, 44

## What to build

Home Events, participation, invitations and notices remain completely reachable in bounded batches while calendar facts and relational authority stay correct.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W09.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W09.C02**: W09.C01.
  - W09.C01: Consumes decoupled Event/presence facts so paging participation cannot hide Events or misstate calendar truth.
- **W09.C03**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W09.C01 — Page Home Events without corrupting calendar truth

Source: superseded D20; original review phase 4.

All permitted future Events remain reachable in 25-item batches while visible calendar counts/markers retain their complete authorized meaning.

Gates: T07, T08, T09.

- [ ] **D20-A01** — Replace unbounded program-ID expansion in the Event path with native relational authority; count all generated binds and exercise more than 100 scopes without truncation, unsafe interpolation or per-ID N+1 queries.
- [ ] **D20-A02** — Separate Event reads and existing presence facts from participation-card paging so the first 25 cards never determine which Events exist.
- [ ] **D20-A03** — No selected date means all authorized future Events are browsable; selected dates filter server-side. Preserve Hong Kong dates, Monday-first weeks, URL/back state and valid next-batch loading.
- [ ] **D20-A04** — Calendar markers/counts and existing presence flags do not equate unloaded with absent. Cover more than 25 Events on one day, another day only in later batches and cross-week/month/year navigation.
- [ ] **D20-A05** — Use bounded summaries rather than loading every Event to rebuild counts; no hidden future horizon, past-event access or Enrolment/attendance change is introduced.

Coordination: Defines the decoupled Event/presence contract W09.C02 needs before paging participation. Does not depend on the limiter or Staff lists.

### W09.C02 — Bound Home participation and valid invitations

Source: superseded D21; original review phase 4.

Home initially reads 25 participation and invitation entries per section, with complete permitted records reachable through explicit next batches.

Gates: T07, T08.

- [ ] **D21-A01** — Bound server reads and preserve approved, pending and waitlisted meanings, current participation visibility and invitation validity/expiry.
- [ ] **D21-A02** — Preserve the participation anchor, independently correct Event/presence facts, section empty states and the distinction between invitation, Enrolment approval and attendance.
- [ ] **D21-A03** — Restore relevant URL browsing/calendar context; any invalid applicable paging state follows option A after existing authorization.
- [ ] **D21-A04** — Fixtures exceed 25, include mixed states and expiry boundaries, and prove full reachability rather than fetch-all-then-slice.

Coordination: Home notice ownership remains W09.C03; coordinate the shared Home composition root without making all Home work a global blocker.

### W09.C03 — Bound visible Home notices with relational scope checks

Source: superseded D22; original review phase 4.

Home notices remain private, inline and completely reachable without an expanding JavaScript scope-ID parameter list.

Gates: T07, T08.

- [ ] **D22-A01** — Use the existing visibility policy through native relational reads, first 25 notices and explicit next batches; never silently truncate authorized scopes or content.
- [ ] **D22-A02** — Inspect generated statements including all non-scope binds for empty, overlapping and more-than-100 scopes alongside genuine native D1 behavior.
- [ ] **D22-A03** — Preserve inline expansion, scope labels, publication timestamps, private denial and safe unavailable/refresh behavior.
- [ ] **D22-A04** — Verify applicable invalid paging normalization, all permitted notice reachability and no hidden time horizon, N+1 workaround or speculative index.

Coordination: Technically independent of W09.C01/W09.C02; reserve shared Home page edits or stack them for conflict avoidance only.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
