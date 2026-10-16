<!-- efcc-foundation:87:R3:W10 -->

**Review label:** Review queue／audit／inbox paging

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 4; primary 4. Phases are review groups, not global execution barriers.

**Packages:** ST18, ST21
**Applicable gates:** T04, T05
**User stories:** 15, 16, 17, 18, 19, 20, 39, 42, 44

## What to build

Reviewers, audit readers and applicants can traverse their complete permitted records with independent detail and restored task context, retaining each distinct privacy policy.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W10.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W10.C02**: None (this checkpoint can start immediately after authorization and entry checks).
- **W10.C03**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W10.C01 — Page the oldest-first Staff review queue and selected application

Source: superseded D23; original review phase 4.

Staff reviewers traverse the full permitted queue in 25-row pages without losing a separately authorized application task.

Gates: T04, T05.

- [ ] **D23-A01** — Bound actual page/API reads, preserve oldest-first order with stable ID ties and independently authorize selected detail outside the current page.
- [ ] **D23-A02** — Preserve private-note policy, missing/denied outcomes and current authority; pagination never grants access.
- [ ] **D23-A03** — Retain query/page/record/task-return context, option A for malformed/inapplicable positions, and navigation/explicit refresh instead of background review reorder.
- [ ] **D23-A04** — More-than-25, equal-sort, stale/changed-authority and applicable missing-anchor cases prove complete previous/next traversal.
- [ ] **D23-A05** — Leave the decision workflow itself green and unchanged until [#102 W15.C01](https://github.com/Noahlw/efcc-system/issues/102) consumes this settled queue/detail contract.

Coordination: No Home or whole Staff-directory dependency is recorded: this queue owns its existing authority and reads.

### W10.C02 — Page retained account audit history and independent record detail

Source: superseded D24; original review phase 4.

Authorized audit readers reach the complete retained history, including eligible deleted-account history, through bounded newest-first browsing.

Gates: T04, T05.

- [ ] **D24-A01** — Bound genuine page/API reads and projections to 25, preserving newest-first order and stable ID ties without required totals.
- [ ] **D24-A02** — Authorize selected record detail outside the page and re-evaluate current authority, private-note visibility, missing targets and retained-history policy.
- [ ] **D24-A03** — Preserve URL/back/task context and option A paging recovery, with applicable malformed/context/anchor and changed-authority cases.
- [ ] **D24-A04** — Retain existing audit permission/render claims and add the new paging/detail evidence; no claim that the old audit path was entirely untested is made.

Coordination: Independent audit projection. A shared time formatter is edit coordination unless its public contract actually changes.

### W10.C03 — Page the applicant inbox without exposing Staff notes

Source: superseded D25; original review phase 4.

An account holder reaches all inbox history permitted by the existing actor/status policy in 25-row newest-first pages.

Gates: T04, T05.

- [ ] **D25-A01** — Bound actual reads and public projections, preserve stable ID ties and never expose Staff-only notes.
- [ ] **D25-A02** — Read applicable selected records independently of the visible page with current authorization and existing missing/denied behavior.
- [ ] **D25-A03** — Preserve URL/back context and option A for invalid applicable paging positions, with more-than-25, equal-sort and changed-authority evidence.
- [ ] **D25-A04** — Do not add access for an ineligible or deleted account merely because audit history is retained elsewhere.

Coordination: No whole Staff-directory or Home dependency; keep the applicant actor contract separate.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
