<!-- efcc-foundation:87:R3:W19 -->

**Review label:** Schema integration／docs／whole-programme acceptance

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 4, 7; primary 7. Phases are review groups, not global execution barriers.

**Packages:** ST19, ST25, ST26 **Applicable gates:** T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15 **User stories:** 52, 53, 60, 61, 62, 63, 64

## What to build

The programme retains its migration lineage and justified final owners, then qualifies one frozen complete candidate for independent review and separate owner acceptance.

## Blocked by

Whole-ticket prerequisites: [#90 W03](https://github.com/Noahlw/efcc-system/issues/90). Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W19.C01**: [#90 W03.C01](https://github.com/Noahlw/efcc-system/issues/90), [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95).
  - [#90 W03.C01](https://github.com/Noahlw/efcc-system/issues/90): Integrates the real counter-preserving business-limiter migration.
  - [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95): Integrates the real search projection/backfill and its completion/restart contract.
- **W19.C02**: [#88 W01.C01](https://github.com/Noahlw/efcc-system/issues/88), [#91 W04.C01](https://github.com/Noahlw/efcc-system/issues/91), [#93 W06.C02](https://github.com/Noahlw/efcc-system/issues/93), [#93 W06.C03](https://github.com/Noahlw/efcc-system/issues/93), W19.C01, [#98 W11.C01](https://github.com/Noahlw/efcc-system/issues/98), [#99 W12.C02](https://github.com/Noahlw/efcc-system/issues/99), [#100 W13.C01](https://github.com/Noahlw/efcc-system/issues/100), [#101 W14.C01](https://github.com/Noahlw/efcc-system/issues/101), [#101 W14.C02](https://github.com/Noahlw/efcc-system/issues/101), [#102 W15.C01](https://github.com/Noahlw/efcc-system/issues/102), [#102 W15.C02](https://github.com/Noahlw/efcc-system/issues/102), [#102 W15.C03](https://github.com/Noahlw/efcc-system/issues/102), [#103 W16.C01](https://github.com/Noahlw/efcc-system/issues/103), [#104 W17.C01](https://github.com/Noahlw/efcc-system/issues/104), [#104 W17.C02](https://github.com/Noahlw/efcc-system/issues/104), [#105 W18.C01](https://github.com/Noahlw/efcc-system/issues/105).
  - [#88 W01.C01](https://github.com/Noahlw/efcc-system/issues/88): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#91 W04.C01](https://github.com/Noahlw/efcc-system/issues/91): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#93 W06.C02](https://github.com/Noahlw/efcc-system/issues/93): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#93 W06.C03](https://github.com/Noahlw/efcc-system/issues/93): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - W19.C01: Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#98 W11.C01](https://github.com/Noahlw/efcc-system/issues/98): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#99 W12.C02](https://github.com/Noahlw/efcc-system/issues/99): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#100 W13.C01](https://github.com/Noahlw/efcc-system/issues/100): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#101 W14.C01](https://github.com/Noahlw/efcc-system/issues/101): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#101 W14.C02](https://github.com/Noahlw/efcc-system/issues/101): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#102 W15.C01](https://github.com/Noahlw/efcc-system/issues/102): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#102 W15.C02](https://github.com/Noahlw/efcc-system/issues/102): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#102 W15.C03](https://github.com/Noahlw/efcc-system/issues/102): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#103 W16.C01](https://github.com/Noahlw/efcc-system/issues/103): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#104 W17.C01](https://github.com/Noahlw/efcc-system/issues/104): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#104 W17.C02](https://github.com/Noahlw/efcc-system/issues/104): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
  - [#105 W18.C01](https://github.com/Noahlw/efcc-system/issues/105): Consumes this terminal delivery and all of its prerequisites for final retirement and tracked-file reconciliation.
- **W19.C03**: W19.C02.
  - W19.C02: Consumes completed scope/dispositions, final owners/paths and every earlier candidate change through the integrated closure.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W19.C01 — Reconcile schema ownership and populated upgrade lineage

Source: superseded D26; original review phase 4.

A fresh or populated owned D1 reaches the complete accepted schema through its original migration lineage and explicit current owners.

Gates: T01, T06, T09.

- [ ] **D26-A01** — Preserve historical SQL, generated metadata provenance, migration tracking, immutable history/triggers and ordered appends; use only justified forward migrations.
- [ ] **D26-A02** — Rehearse fresh and populated disposable upgrades through original migrations, with quota/native-row preservation and deterministic Unicode search backfill.
- [ ] **D26-A03** — Retain independent command-time assertions and public schema interfaces; improve ownership only where needed, with evidence-backed KEEP instead of a speculative schema facade.
- [ ] **D26-A04** — This integration does not replace [#90 W03.C01](https://github.com/Noahlw/efcc-system/issues/90)/[#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95)'s own immediate upgrade checks and does not authorize production rollback, personal-data operations or mixed-version rollout.

Coordination: Any extra index migration needs its own query-plan evidence and concrete integration edge; no whole-schema prerequisite is imposed on unrelated workflows.

### W19.C02 — Retire proven replacements and reconcile every final tracked file

Source: superseded D40; original review phase 7.

The complete programme leaves current documentation and only justified owners, with no tracked file or replacement consumer lost from coverage.

Gates: T03, T08, T13, T15.

- [ ] **D40-A01** — Update existing guides, glossary and meaningful ADR owners to the actual final contracts; no competing glossary, archive registry or permanent planning authority is introduced.
- [ ] **D40-A02** — Retire only proven superseded code/assets after complete current callers, resolver/build inputs, historical selector aliases and relevant native evidence are checked.
- [ ] **D40-A03** — [#94 W07.C05](https://github.com/Noahlw/efcc-system/issues/94)/[#99 W12.C02](https://github.com/Noahlw/efcc-system/issues/99) must already have removed their temporary compatibility surfaces; remaining legitimate interfaces and minimal geometry exceptions have explicit reasons.
- [ ] **D40-A04** — Reconcile the 366-file baseline with every added/renamed/removed final tracked path, recording evidence-backed CHANGE/KEEP/EXCLUDE, package disposition and appropriate review depth/provenance.
- [ ] **D40-A05** — Preserve reference/generated assets, Book/license, historical SQL and unrelated work. KEEP is not a runtime pass; EXCLUDE never authorizes deletion; scope reduction/deferral needs the owner.
- [ ] **D40-A06** — Verify all ST01-ST25 outcomes, including mandatory CVA/Lucide, are complete or have a legitimate evidence-backed disposition before aggregate qualification.

Coordination: This final integration closure intentionally waits for the complete work set. It does not serialize the earlier independent tickets.

### W19.C03 — Accept one complete frozen foundation candidate

Source: superseded D41; original review phase 7.

The owner can assess the whole delivered foundation on one attributable candidate, separately from merge, release and future Roles implementation.

Gates: T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15.

- [ ] **D41-A01** — Freeze exact source/tree, parent/cumulative bases and pinned toolchain; reconcile all final package/file dispositions before claiming the aggregate.
- [ ] **D41-A02** — Run relevant targeted gates and full local pnpm test:qualify with genuine HTTP/D1/browser boundaries, synthetic owned data, zero retries and no skipped required acceptance.
- [ ] **D41-A03** — Refresh affected desktop/mobile/presentation, migrations, query budgets, atomicity, lifecycle, build/cache, diagnostics and Book evidence on that candidate; never assemble a pass from incompatible SHAs or cached results.
- [ ] **D41-A04** — Perform the four T14 exercises on the aggregate and compare their source-attributed original and package results, with no invented productivity/LOC target.
- [ ] **D41-A05** — Record selected/executed claims/projects, first failures and separate repairs, unavailable/unperformed/bypassed gates and evidence limits. Any repair affecting evidence requires an appropriately refreshed frozen candidate.
- [ ] **D41-A06** — Complete independent Standards and Spec review, then separate owner acceptance. Neither agent completion nor qualification grants owner approval, merge, deployment, remote-data actions or Slice 3 scope.

Coordination: Final full gate only; the complete stack may reach it through multiple independent review branches.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Cross-phase integration

W19.C01 is the phase-4 schema-lineage integration checkpoint and can run once the quota and search migration contracts exist; their immediate upgrade checks remain in [#90 W03](https://github.com/Noahlw/efcc-system/issues/90)/[#95 W08](https://github.com/Noahlw/efcc-system/issues/95). W19.C02 performs final documentation/retirement/file closure after all delivery checkpoints. W19.C03 freezes and qualifies the aggregate, obtains independent review and records separate owner acceptance. This grouping does not postpone migration checks or require Book containment to wait for the programme.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
