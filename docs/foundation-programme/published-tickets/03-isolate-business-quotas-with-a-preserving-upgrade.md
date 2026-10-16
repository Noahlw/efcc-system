<!-- efcc-foundation:87:R3:W03 -->

**Review label:** Business quota isolation＋upgrade

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 1; primary 1. Phases are review groups, not global execution barriers.

**Packages:** ST01, ST19
**Applicable gates:** T01, T09
**User stories:** 3, 4, 5, 52

## What to build

Business quotas survive native-auth housekeeping and a populated upgrade, with existing limits, precedence and concurrent consumption preserved.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W03.C01**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W03.C01 — Separate business quota storage with a counter-preserving upgrade

Source: superseded D05; original review phase 1.

Native auth housekeeping cannot remove live business quota state, and a populated upgrade does not restore exhausted requests.

Gates: T01, T09.

- [ ] **D05-A01** — Use a separate EFCC-owned business limiter table in the same D1; native Better Auth limiter storage and wire behavior remain native.
- [ ] **D05-A02** — Preserve per-action/IP keys, ten requests per fixed sixty-second window, anchors and origin/missing-IP/error precedence.
- [ ] **D05-A03** — An additive forward upgrade on a quiesced populated disposable store preserves existing business keys/counts/anchors, including exhausted buckets, and native auth rows.
- [ ] **D05-A04** — Installed native auth plus genuine business HTTP/D1 requests prove cleanup isolation, denial, expiry/rollover, fresh/unrelated keys and concurrent consumption.
- [ ] **D05-A05** — Own these upgrade checks immediately; do not defer them to [#106 W19.C01](https://github.com/Noahlw/efcc-system/issues/106) or assume dual-write or mixed-version production rollout.

Coordination: Coordinate additive migration naming with [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95)/[#106 W19.C01](https://github.com/Noahlw/efcc-system/issues/106). This is not a prerequisite for Home queries.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
