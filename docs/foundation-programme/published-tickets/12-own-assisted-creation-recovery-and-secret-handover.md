<!-- efcc-foundation:87:R3:W12 -->

**Review label:** Assisted creation／recovery／handover

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 5; primary 5. Phases are review groups, not global execution barriers.

**Packages:** ST12, ST20, ST21
**Applicable gates:** T02, T04, T06, T09
**User stories:** 16, 27, 28, 29, 31, 32, 33, 35, 36, 43, 44, 51

## What to build

Staff-assisted creation and recovery have distinct authority and review lifetimes, with one owned short-lived issuance/handover contract and receipt-only replay.

## Blocked by

Whole-ticket prerequisites: [#92 W05](https://github.com/Noahlw/efcc-system/issues/92). Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W12.C01**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C02](https://github.com/Noahlw/efcc-system/issues/94), [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes neutral proof and password-confirmation authority.
  - [#94 W07.C02](https://github.com/Noahlw/efcc-system/issues/94): Consumes migrated assisted form composition.
  - [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95): Consumes atomic identity/search projection and existing target contracts.
- **W12.C02**: W12.C01.
  - W12.C01: Consumes the established one-time issuance/handover interface and its prerequisite proof/form/read contracts.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W12.C01 — Separate assisted creation from one-time issuance and handover

Source: superseded D28; original review phase 5.

Staff-assisted creation has a distinct review/command lifetime and a small feature-owned one-time issuance/handover contract.

Gates: T02, T04, T06, T09.

- [ ] **D28-A01** — Separate creation draft/review from short-lived issuance/handover using typed feature data; keep the recovery consumer green through an explicit temporary compatibility adapter until W12.C02.
- [ ] **D28-A02** — Preserve current Staff/Admin policy, confirmation, atomic identity/projection writes, original key/fingerprint, receipt and uncertain-response reconciliation.
- [ ] **D28-A03** — Original issuance returns 201 with Temporary password and committed expiry; replay/reconcile return 200 receipt-only. Seven-day expiry and mandatory-change behavior remain.
- [ ] **D28-A04** — Plaintext is not persisted or replayed; copy failure, hide/unmount/reload, actor switch and late responses dispose correctly. A receipt never implies a still-valid password or automatic reissue.
- [ ] **D28-A05** — Keep native page/task return, frozen review and explicit final submit; no generic operation or credential engine is added.

Coordination: Defines the concrete issuance/handover owner consumed by W12.C02; this intra-ST12 edge does not depend on completing [#98 W11.C01](https://github.com/Noahlw/efcc-system/issues/98)/ST11.

### W12.C02 — Migrate Staff recovery and reissue to the owned handover lifetime

Source: superseded D29; original review phase 5.

Staff recovery/reset/reissue stays explicitly authorized and independently understandable while using the owned secret-handover lifetime.

Gates: T04, T09.

- [ ] **D29-A01** — Migrate recovery-specific review/target switching, command intent and receipt/reconciliation policy without merging it with creation authority.
- [ ] **D29-A02** — Preserve original actor/action/target/key, current session/confirmation/SQL-time predicates, immutable receipts and 201 original-secret versus 200 receipt-only behavior.
- [ ] **D29-A03** — Exercise reset/reissue, lost display, copy failure, hide/unmount/reload, late responses and actor/target transitions with authoritative expiry and explicit reissue.
- [ ] **D29-A04** — Remove the W12.C01 recovery compatibility adapter once this real consumer is migrated; no plaintext storage, replay or receipt-driven implicit issuance remains.
- [ ] **D29-A05** — Preserve transient query disposal, frozen review, dirty/cancel and return-state behavior through actual HTTP/D1/browser journeys.

Coordination: Deliberately stacked on the concrete W12.C01 handover contract because both touch the same assisted workflow owner.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
