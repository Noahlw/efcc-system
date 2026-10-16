<!-- efcc-foundation:87:R3:W01 -->

**Review label:** Unicode Account initials

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 1; primary 1. Phases are review groups, not global execution barriers.

**Packages:** ST02 **Applicable gates:** T02, T08 **User stories:** 1

## What to build

Account initials render complete supported characters while stored identity and sign-in behavior remain unchanged.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W01.C01**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W01.C01 — Render complete Unicode Account initials

Source: superseded D01; original review phase 1.

Account holders see a complete supported initial, including a non-BMP character, through the actual Account presentation.

Gates: T02, T08.

- [ ] **D01-A01** — BMP, non-BMP and empty-name cases render correctly without lone surrogates at the actual Account boundary.
- [ ] **D01-A02** — Stored Full Chinese name, Username, sign-in lookup, identity fingerprints and the existing empty fallback remain unchanged.
- [ ] **D01-A03** — The required native render evidence accompanies the smallest shared display correction; an isolated slicing demonstration alone does not close the ticket.

Coordination: Independent correctness PR; no UI-library, limiter or whole-module-boundary prerequisite.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
