<!-- efcc-foundation:87:R3:W13 -->

**Review label:** Own-account security

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 5; primary 5. Phases are review groups, not global execution barriers.

**Packages:** ST13, ST20, ST21 **Applicable gates:** T04, T09 **User stories:** 2, 29, 33, 34, 35, 36, 43, 44, 51

## What to build

Password, confirmation, revocation and Temporary-password journeys preserve explicit submission, current authority and atomic receipts through clear feature-owned lifetimes.

## Blocked by

Whole-ticket prerequisites: [#92 W05](https://github.com/Noahlw/efcc-system/issues/92). Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W13.C01**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C02](https://github.com/Noahlw/efcc-system/issues/94).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes neutral proof, actual password verification and current credential authority.
  - [#94 W07.C02](https://github.com/Noahlw/efcc-system/issues/94): Consumes migrated own-security form composition.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W13.C01 — Clarify own-account security lifetimes and atomic intent

Source: superseded D30; original review phase 5.

Password change, confirmation, revocation and Temporary-password journeys have clear feature-owned lifetimes without weakening credential gates.

Gates: T04, T09.

- [ ] **D30-A01** — Preserve explicit submission and prevent password confirmation from automatically submitting another sensitive operation.
- [ ] **D30-A02** — Retain session expiry, credential revision, confirmation/Temporary-password expiry, SQL-time denial and existing mutation envelopes.
- [ ] **D30-A03** — Keep frozen review, dirty/discard, disposal, original-key replay/conflict, refresh reconciliation and no plaintext persistence/replay.
- [ ] **D30-A04** — Clarify command intent while retaining lazy assertions, atomic batches, immutable receipts and causal native race evidence.
- [ ] **D30-A05** — Use existing transient private Query and full server-authoritative recovery behavior; preserve relevant Account/status navigation.

Coordination: Independent of Identity and Staff creation. Coordinate shared proof/query helpers without inventing a whole-workflow prerequisite.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
