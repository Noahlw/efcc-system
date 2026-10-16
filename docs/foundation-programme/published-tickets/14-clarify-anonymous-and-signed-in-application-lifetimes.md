<!-- efcc-foundation:87:R3:W14 -->

**Review label:** Anonymous／signed-in applicant workflows

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 5; primary 5. Phases are review groups, not global execution barriers.

**Packages:** ST14, ST20, ST21 **Applicable gates:** T02, T04, T06, T09 **User stories:** 27, 28, 29, 35, 36, 37, 38, 43, 44, 51

## What to build

Anonymous device-capability creation and signed-in correction, withdrawal and resubmission remain separately authorized through explicit, atomic and reconcilable workflows.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W14.C01**: [#94 W07.C03](https://github.com/Noahlw/efcc-system/issues/94), [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95).
  - [#94 W07.C03](https://github.com/Noahlw/efcc-system/issues/94): Consumes migrated public-application form composition.
  - [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95): Consumes the atomic anonymous identity/search writer contract.
- **W14.C02**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C03](https://github.com/Noahlw/efcc-system/issues/94), [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes current signed-in proof and credential authority where required by existing operations.
  - [#94 W07.C03](https://github.com/Noahlw/efcc-system/issues/94): Consumes migrated applicant form composition.
  - [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95): Consumes the atomic applicant correction/search projection contract.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W14.C01 — Clarify anonymous application capability and command lifetime

Source: superseded D31; original review phase 5.

Anonymous applicants create and reconcile an application through the existing device capability without inheriting signed-in authority or creating a session.

Gates: T02, T04, T06, T09.

- [ ] **D31-A01** — Preserve anonymous creation, existing device-capability storage and original operation identity; signup still creates no session or secret replay.
- [ ] **D31-A02** — Retain raw/normalized/frozen values, existing name/Username/phone semantics, old fingerprints and property ordering.
- [ ] **D31-A03** — Keep identity/projection writes, immutable receipts, native failure/replay effects and command-time assertions within the existing atomic boundary.
- [ ] **D31-A04** — Exercise dirty/discard, uncertain response, device-bound reconciliation, disposal and safe authoritative unavailable/retry paths through real HTTP/browser/D1.
- [ ] **D31-A05** — Share mechanics only where identical; do not add authenticated neutral-proof requirements to the anonymous capability.

Coordination: No [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92) or whole signed-in applicant dependency. Coordinate shared identity validation with W14.C02 while preserving both contracts.

### W14.C02 — Clarify signed-in applicant maintenance and atomic commands

Source: superseded D32; original review phase 5.

Correction, withdrawal and resubmission remain bound to the signed-in account/application through feature-owned lifecycle and command interfaces.

Gates: T02, T04, T06, T09.

- [ ] **D32-A01** — Keep account/application actor binding distinct from anonymous device capability; preserve operation-specific confirmation and current authority.
- [ ] **D32-A02** — Retain frozen review, old references, normalization/serialization/digests, explicit submit and identity/projection atomicity.
- [ ] **D32-A03** — Real replay/conflict/stale-operation/failure cases retain immutable receipts, append order and SQL predicates without restoring older identity data.
- [ ] **D32-A04** — Preserve dirty/discard, late disposal, transient exact-query cleanup, authoritative refresh and existing task return state.
- [ ] **D32-A05** — Do not merge public and authenticated policies merely because their field/transport mechanics look similar.

Coordination: May proceed without all W14.C01; concrete shared validator/storage edits are coordinated rather than a universal application-workflow edge.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
