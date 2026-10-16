<!-- efcc-foundation:87:R3:W11 -->

**Review label:** Identity workflow＋atomic commands

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 5; primary 5. Phases are review groups, not global execution barriers.

**Packages:** ST11, ST20, ST21 **Applicable gates:** T02, T04, T06, T09, T14 **User stories:** 16, 27, 28, 29, 34, 35, 36, 43, 44, 51

## What to build

Self-phone and Staff identity correction use clear feature-owned review, reconciliation and atomic commands without changing authority, identity or task-return contracts.

## Blocked by

Whole-ticket prerequisites: [#92 W05](https://github.com/Noahlw/efcc-system/issues/92). Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W11.C01**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C01](https://github.com/Noahlw/efcc-system/issues/94), [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes neutral current credential proof and the actual verifier boundary.
  - [#94 W07.C01](https://github.com/Noahlw/efcc-system/issues/94): Consumes the migrated Identity form composition contract.
  - [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95): Consumes the projection/writer and bounded selected-target contracts, including [#95 W08.C01](https://github.com/Noahlw/efcc-system/issues/95).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W11.C01 — Deepen Identity review, reconciliation and atomic command ownership

Source: superseded D27; original review phase 5.

Self-phone and Staff identity correction have feature-owned lifecycle and clear command intent, while presentation changes do not require reading unrelated operation rules.

Gates: T02, T04, T06, T09, T14.

- [ ] **D27-A01** — Use the smallest phase-specific view/action contract, retaining distinct self/Staff target authority, explicit confirmation and final submission.
- [ ] **D27-A02** — Preserve dirty/discard, frozen values, null/false/empty, old stored references, payload ordering/digests, original actor/target/action/key and late-response disposal.
- [ ] **D27-A03** — Keep current proof, SQL predicates, ordered atomic batches and search-projection consistency; lost-response/replay/conflict and current-authority denial remain real-boundary cases.
- [ ] **D27-A04** — Reuse transient reconciliation mechanics with feature-owned keys/outcomes, zero stale/GC time, always-online requests, no automatic retries/persistence and exact query cleanup.
- [ ] **D27-A05** — Compare the T14 Staff review-copy exercise against its recorded starting revision; preserve page/task return and authoritative unavailable/status recovery.

Coordination: No other workflow waits for all ST11. Shared Query/reconciliation helper edits preserve existing public mechanics and are explicitly serialized only when touched.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
