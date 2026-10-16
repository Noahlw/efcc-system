<!-- efcc-foundation:87:R3:W02 -->

**Review label:** Native qualification／process ownership

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 1; primary 1. Phases are review groups, not global execution barriers.

**Packages:** ST03, ST22
**Applicable gates:** T03, T10, T14
**User stories:** 49, 50, 54

## What to build

Developers can select, execute and dispose the correct native checks against an exact source/index without losing mobile coverage or owned-process failures.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W02.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W02.C02**: None (this checkpoint can start immediately after authorization and entry checks).
- **W02.C03**: W02.C01, W02.C02.
  - W02.C01: Consumes the settled selection/discovery result contract.
  - W02.C02: Consumes owned lifecycle completion and cleanup outcomes.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W02.C01 — Keep mobile qualification attached to UI capability

Source: superseded D02; original review phase 1.

Affected and staged qualification cannot silently lose required mobile engines when UI is created, renamed or extracted.

Gates: T03, T10.

- [ ] **D02-A01** — Full selection outputs and native project discovery cover creation, rename, deletion, extraction and later extracted-file-only edits.
- [ ] **D02-A02** — Unknown affected/staged paths fail closed; server-only or non-mobile exclusions have explicit capability evidence. Extra mobile selection remains acceptable.
- [ ] **D02-A03** — Parent-relative and cumulative bases are independently exercised; claims and executed projects agree rather than merely producing a nonempty selection.
- [ ] **D02-A04** — The existing selector/discovery owners remain authoritative, including historical path aliases needed during the stack.

Coordination: Shares native runner interfaces with W02.C03; coordinate edits without making unrelated application work depend on this entire package.

### W02.C02 — Characterize and enforce owned process cleanup

Source: superseded D03; original review phase 1.

A native task reports successful cleanup only when its owned process group and listeners are absent, including after a successful leader exits.

Gates: T10.

- [ ] **D03-A01** — Owned synthetic fixtures characterize normal completion, successful leader with descendant, failure, SIGINT, timeout and missing command.
- [ ] **D03-A02** — EPERM is distinguished from ESRCH; inability to establish absence remains visible. No unrelated PID is probed or killed.
- [ ] **D03-A03** — Retain nested cleanup and first-failure evidence. Fix only demonstrated ownership gaps; an evidence-backed KEEP is valid when characterization satisfies the contract.
- [ ] **D03-A04** — No blanket retry/sleep, private dependency patch or replacement scheduler is introduced; the separate issue #86 is not absorbed without causal evidence.

Coordination: Stabilizes the lifecycle interface consumed by W02.C03, independently of source-selection policy.

### W02.C03 — Make native qualification stages and source ownership explicit

Source: superseded D04; original review phase 1.

Developers can follow the owned native gate from exact source/index to discovery, execution and disposal without weakening privacy or source fidelity.

Gates: T03, T10, T14.

- [ ] **D04-A01** — Preserve immutable source identity, exact staged index, partial-hunk formatting restoration, privacy rejection and discovery/execution equality.
- [ ] **D04-A02** — Clarify stage inputs, outputs and owned fixture disposal only where the existing interface is inadequate; keep the native Wrangler Harness, srvx and app-bound D1.
- [ ] **D04-A03** — Failure evidence names the candidate, stage and first failure; a later repair is a separate result, with zero acceptance retries or skipped cases.
- [ ] **D04-A04** — Perform the T14 Roles HTTP-test design exercise against the original baseline and resulting interface, using existing fixtures without implementing Roles.

Coordination: Parent-relative affected evidence may rely on this settled gate; other tickets may use the existing complete explicit gate beforehand.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
