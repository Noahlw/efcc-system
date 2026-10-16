<!-- efcc-foundation:87:R3:W04 -->

**Review label:** Runtime boundaries／business error contracts

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 2; primary 2. Phases are review groups, not global execution barriers.

**Packages:** ST04, ST06
**Applicable gates:** T03, T04, T14
**User stories:** 47, 48

## What to build

Meaningful runtime/client boundaries are enforced and a business failure has one consistent runtime, RPC and client contract.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W04.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W04.C02**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W04.C01 — Enforce meaningful client and runtime boundaries

Source: superseded D06; original review phase 2.

A forbidden runtime dependency fails the appropriate check or client build while legitimate type contracts and framework roots continue to work.

Gates: T03.

- [ ] **D06-A01** — Use bounded resolver-aware checks and actual client build evidence for relevant positive and negative imports, including aliases.
- [ ] **D06-A02** — Retain legitimate type-only Hono AppType imports and composition roots; inspect real cycles rather than banning every cycle.
- [ ] **D06-A03** — Reuse existing/native tooling; no new graph framework or blanket directory relocation is required.
- [ ] **D06-A04** — The final boundary inventory follows added, renamed and removed owners; ordinary lint/type success alone does not establish this claim.

Coordination: Not a universal blocker. Each changing ticket must preserve the relevant boundary even while this independent enforcement work is underway.

### W04.C02 — Make one business error agree across runtime, RPC and client

Source: superseded D08; original review phase 2.

A developer can add or maintain a legitimate business failure through its authoritative contract without contradictory status/code copies.

Gates: T03, T04, T14.

- [ ] **D08-A01** — Characterize a real business-error change and preserve existing public messages, statuses/codes, Hono inference and client handling.
- [ ] **D08-A02** — Keep native auth envelopes distinct; do not replace inferred boundaries with broad response casts or universal normalization.
- [ ] **D08-A03** — Consolidate only duplicated authoritative facts; preserve null/false/empty and historical identity serialization expectations.
- [ ] **D08-A04** — Record the pre-change and resulting T14 error-addition exercise, using a legitimate existing domain failure or a disposable demonstration without inventing product policy.

Coordination: [#95 W08.C02](https://github.com/Noahlw/efcc-system/issues/95) consumes the resulting typed query-validation/error contract; [#104 W17.C02](https://github.com/Noahlw/efcc-system/issues/104) consumes its stable diagnostic attribution boundary.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
