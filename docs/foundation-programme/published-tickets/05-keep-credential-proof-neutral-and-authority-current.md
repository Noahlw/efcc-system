<!-- efcc-foundation:87:R3:W05 -->

**Review label:** Neutral credential proof

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 2; primary 2. Phases are review groups, not global execution barriers.

**Packages:** ST05
**Applicable gates:** T04, T09
**User stories:** 2, 29, 30, 33

## What to build

Non-password workflows receive neutral current proof while verifier material and request/SQL-time authority stay with their proper owners.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W05.C01**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W05.C01 — Keep neutral credential proof separate from password verification

Source: superseded D07; original review phase 2.

Non-password capabilities receive current neutral proof without passwordHash; the actual verifier alone obtains verifier material.

Gates: T04, T09.

- [ ] **D07-A01** — Narrow the shared proof interface and all real consumers without changing native authentication or public business responses.
- [ ] **D07-A02** — Preserve session expiry, credential revision, Temporary-password state, ten-minute confirmation and SQL-time authority predicates.
- [ ] **D07-A03** — Keep supplied-actor target existence/self/role checks separate from caller/session and command-time authority; preserve operation-specific policies.
- [ ] **D07-A04** — Real request/session/D1, expiry and race evidence demonstrate denial of stale authority, alongside meaningful type/runtime hash-exposure checks.
- [ ] **D07-A05** — Keep relevant public interfaces usable by existing workflows during migration; no future Roles or generic permissions engine is introduced.

Coordination: Defines the concrete neutral-proof contract consumed by the authenticated workflow tickets, rather than a whole-package architecture gate.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
