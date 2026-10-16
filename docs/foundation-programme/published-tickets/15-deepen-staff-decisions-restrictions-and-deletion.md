<!-- efcc-foundation:87:R3:W15 -->

**Review label:** Membership decisions／restrictions／deletion

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 5; primary 5. Phases are review groups, not global execution barriers.

**Packages:** ST15, ST20, ST21
**Applicable gates:** T04, T05, T06, T09, T14
**User stories:** 2, 16, 17, 19, 27, 28, 29, 35, 36, 39, 40, 41, 43, 44, 51

## What to build

Staff review, restriction and eligible deletion tasks retain distinct policy, private notes, explicit confirmation, atomic history and safe uncertainty recovery.

## Blocked by

Whole-ticket prerequisites: [#92 W05](https://github.com/Noahlw/efcc-system/issues/92). Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W15.C01**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C04](https://github.com/Noahlw/efcc-system/issues/94), [#97 W10.C01](https://github.com/Noahlw/efcc-system/issues/97).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes current neutral proof and command-time authority.
  - [#94 W07.C04](https://github.com/Noahlw/efcc-system/issues/94): Consumes migrated decision form composition.
  - [#97 W10.C01](https://github.com/Noahlw/efcc-system/issues/97): Consumes the settled bounded review queue, selected-detail and return-state contract.
- **W15.C02**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C04](https://github.com/Noahlw/efcc-system/issues/94), [#95 W08.C01](https://github.com/Noahlw/efcc-system/issues/95).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes neutral proof and current credential/SQL authority.
  - [#94 W07.C04](https://github.com/Noahlw/efcc-system/issues/94): Consumes applicable migrated restriction/confirmation form composition.
  - [#95 W08.C01](https://github.com/Noahlw/efcc-system/issues/95): Consumes the independently authorized managed-target/detail and return-state contract.
- **W15.C03**: [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92), [#94 W07.C04](https://github.com/Noahlw/efcc-system/issues/94), [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95).
  - [#92 W05.C01](https://github.com/Noahlw/efcc-system/issues/92): Consumes current neutral proof and SQL-time authority.
  - [#94 W07.C04](https://github.com/Noahlw/efcc-system/issues/94): Consumes migrated destructive-action form composition.
  - [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95): Consumes selected-target and actual identity/projection storage ownership, including [#95 W08.C01](https://github.com/Noahlw/efcc-system/issues/95).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W15.C01 — Deepen Membership decision review and atomic intent

Source: superseded D33; original review phase 5.

Staff make existing Membership decisions through clear review/view/command boundaries without exposing internal notes or losing the selected task.

Gates: T04, T05, T09.

- [ ] **D33-A01** — Keep internal notes distinct from applicant-visible reasons and preserve all existing reviewer/target policies.
- [ ] **D33-A02** — Share presentation mechanics only; preserve frozen review, explicit confirmation/submission, dirty/discard, missing/denied targets and task-return context.
- [ ] **D33-A03** — Retain atomic ordered decision/audit/receipt effects, current-session and SQL-time guards, native failure/replay/race outcomes and retained history.
- [ ] **D33-A04** — Exercise selection outside the visible queue page, uncertainty/reconciliation, late response disposal and safe authoritative refresh without background review reorder.

Coordination: No artificial dependency on Home or all identity/assisted workflows; use only the concrete queue/form/proof contracts above.

### W15.C02 — Keep Membership restrictions separate from Security bans

Source: superseded D34; original review phase 5.

Permitted Staff change existing restriction states through clear feature-owned commands without one restriction silently changing another.

Gates: T04, T09.

- [ ] **D34-A01** — Preserve independent Membership deactivation/reactivation and Security ban semantics, status-only journeys and operation-specific target policy.
- [ ] **D34-A02** — Retain notes/reasons privacy, explicit review/confirmation/submit, frozen state and original actor/target/action/key.
- [ ] **D34-A03** — Clarify command intent without splitting atomic restriction/history/receipt writes or weakening SQL-time authority.
- [ ] **D34-A04** — Native denied/stale/replay/failure and uncertain-response journeys preserve disposal, transient reconciliation and selected-target return context.

Coordination: Shares view mechanics with W15.C01/W15.C03 only where identical; their business policies remain separate.

### W15.C03 — Preserve destructive eligibility and retained history through deletion

Source: superseded D35; original review phase 5.

Eligible deletion remains explicitly confirmed, atomic and historically traceable without making an old account or Username available again.

Gates: T04, T05, T06, T09, T14.

- [ ] **D35-A01** — Preserve all existing eligibility, Member/last-Admin and operation-specific target guards, with no policy moved into presentation.
- [ ] **D35-A02** — Retain reserved Username semantics, immutable receipts and permitted audit history; deleted identities do not remain discoverable through the new search projection.
- [ ] **D35-A03** — Actual native D1 failure, denial, race, replay and lost-response cases retain atomic effects and current SQL-time authority.
- [ ] **D35-A04** — Keep frozen review, explicit destructive confirmation, dirty/discard, disposal and task/history return behavior, including detail outside the page.
- [ ] **D35-A05** — Complete the T14 invariant trace from an existing deletion rule through command, SQL/trigger enforcement and real regression test, comparing the named baseline.

Coordination: [#97 W10.C02](https://github.com/Noahlw/efcc-system/issues/97)'s independent retained-history browsing is verified cumulatively; no blanket dependency on the entire history or Home package is invented.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
