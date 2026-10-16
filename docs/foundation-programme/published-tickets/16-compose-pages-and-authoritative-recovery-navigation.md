<!-- efcc-foundation:87:R3:W16 -->

**Review label:** Page／navigation／unavailable recovery

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 5; primary 5. Phases are review groups, not global execution barriers.

**Packages:** ST21 **Applicable gates:** T04, T05, T07, T08 **User stories:** 2, 16, 36, 42, 43, 44

## What to build

Delivered pages compose settled read/feature contracts and preserve URL, task-return, dirty-navigation and fresh authoritative recovery behavior.

## Blocked by

Whole-ticket prerequisites: [#95 W08](https://github.com/Noahlw/efcc-system/issues/95), [#96 W09](https://github.com/Noahlw/efcc-system/issues/96), [#97 W10](https://github.com/Noahlw/efcc-system/issues/97). Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W16.C01**: [#95 W08.C03](https://github.com/Noahlw/efcc-system/issues/95), [#96 W09.C02](https://github.com/Noahlw/efcc-system/issues/96), [#96 W09.C03](https://github.com/Noahlw/efcc-system/issues/96), [#97 W10.C01](https://github.com/Noahlw/efcc-system/issues/97), [#97 W10.C02](https://github.com/Noahlw/efcc-system/issues/97), [#97 W10.C03](https://github.com/Noahlw/efcc-system/issues/97).
  - [#95 W08.C03](https://github.com/Noahlw/efcc-system/issues/95): Consumes settled Staff search/page/selection URL behavior.
  - [#96 W09.C02](https://github.com/Noahlw/efcc-system/issues/96): Consumes the complete Home Event/participation/invitation read composition, including [#96 W09.C01](https://github.com/Noahlw/efcc-system/issues/96).
  - [#96 W09.C03](https://github.com/Noahlw/efcc-system/issues/96): Consumes the bounded visible-notice read contract.
  - [#97 W10.C01](https://github.com/Noahlw/efcc-system/issues/97): Consumes queue/detail/task return state.
  - [#97 W10.C02](https://github.com/Noahlw/efcc-system/issues/97): Consumes audit/history/detail return state.
  - [#97 W10.C03](https://github.com/Noahlw/efcc-system/issues/97): Consumes inbox/detail restoration state.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W16.C01 — Compose delivered pages and recovery navigation through settled reads

Source: superseded D36; original review phase 5.

Delivered sign-in, status, task, Account, Home and Staff pages share clear request/navigation composition while preserving real authority and recovery.

Gates: T04, T05, T07, T08.

- [ ] **D36-A01** — Reduce repeated policy-shaped page knowledge through existing feature/read interfaces; keep headers, search params, dynamic/no-store, Suspense and redirects at framework roots.
- [ ] **D36-A02** — Preserve delivered routes/query keys, independently authorized detail, task returns, dirty navigation and delivered-only destinations.
- [ ] **D36-A03** — Unavailable pages expose no partial private data; retry retains valid URL state, restored-page/status checks obtain a fresh server-authoritative view and sign-out remains genuine.
- [ ] **D36-A04** — Use existing frames/navigation and feature policy owners; do not create a generic context service, replacement router or view-owned authorization.
- [ ] **D36-A05** — Real browser/HTTP journeys cover cross-page back/refresh/unavailable/status behavior after bounded reads; workflow-specific command/view ownership remains in the Identity, assisted, security, application and Staff-action workflow deliveries.

Coordination: These are concrete changed read/URL contracts, not an all-phase barrier. Coordinate shared roots with workflow PRs that preserve their public navigation interface.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
