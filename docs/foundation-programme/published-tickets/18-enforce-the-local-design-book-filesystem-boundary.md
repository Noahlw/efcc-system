<!-- efcc-foundation:87:R3:W18 -->

**Review label:** Book path／symlink containment

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 7; primary 7. Phases are review groups, not global execution barriers.

**Packages:** ST25 **Applicable gates:** T13 **User stories:** 59, 60

## What to build

The localhost Book serves valid reference paths and in-root links while rejecting traversal, prefix siblings and outside-root link targets.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W18.C01**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W18.C01 — Enforce the local Design Book's resolved filesystem boundary

Source: superseded D39; original review phase 7.

The localhost Book helper serves valid references while rejecting traversal, prefix siblings and outside-root symlink targets.

Gates: T13.

- [ ] **D39-A01** — Use the smallest root-containment correction, including decoded/encoded paths and same-prefix outside siblings.
- [ ] **D39-A02** — Allow in-root symlinks only when their resolved target remains within the resolved root; outside targets retain the existing not-found response.
- [ ] **D39-A03** — Owned synthetic filesystem fixtures prove valid files/in-root links and invalid outside/link cases at the actual serving boundary without accessing unrelated personal files.
- [ ] **D39-A04** — Preserve localhost use, normal navigation, screens, assets and license; this is not a production static-server redesign.

Coordination: Independent safety correction within ST25. Phase 7 is its review group, not a technical requirement to wait for all application refactors.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
