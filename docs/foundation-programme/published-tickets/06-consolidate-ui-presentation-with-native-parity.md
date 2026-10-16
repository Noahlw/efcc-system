<!-- efcc-foundation:87:R3:W06 -->

**Review label:** CSS／CVA／Lucide presentation

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 3; primary 3. Phases are review groups, not global execution barriers.

**Packages:** ST07, ST08, ST09
**Applicable gates:** T08, T11
**User stories:** 44, 45, 55, 60

## What to build

The app uses the accepted CSS, CVA and Lucide owners with production/native parity and preserved R11 appearance, accessibility and interaction.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W06.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W06.C02**: None (this checkpoint can start immediately after authorization and entry checks).
- **W06.C03**: None (this checkpoint can start immediately after authorization and entry checks).

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W06.C01 — Unify stylesheet ownership only after production/native parity

Source: superseded D09; original review phase 3.

The real production and native builds discover the required styles and assets through a clear source/theme policy.

Gates: T08, T11.

- [ ] **D09-A01** — Characterize both builds of the same candidate before changing the current source-discovery safety seam.
- [ ] **D09-A02** — Check used classes/assets, dependency-component classes and representative computed states, responsive variants and R11 appearance.
- [ ] **D09-A03** — Consolidate to one explicit policy or retain the smallest evidenced parity-preserving exception; CSS retains theme-value ownership.
- [ ] **D09-A04** — Keep the reference Book independent and preserve actual Base UI/native interaction responsibilities.

Coordination: CVA and Lucide preserve public UI contracts independently; shared stylesheet edits are coordinated, not an all-to-all dependency.

### W06.C02 — Adopt CVA for real variant recipes

Source: superseded D10; original review phase 3.

Existing UI variants are maintained through the accepted CVA dependency without changing caller behavior or R11 appearance.

Gates: T08.

- [ ] **D10-A01** — Adopt actual stable variant recipes and remove their superseded owners; do not retain duplicate maps indefinitely.
- [ ] **D10-A02** — Preserve variants/defaults, Button form semantics, refs/focus, DOM, keyboard and disabled/busy behavior.
- [ ] **D10-A03** — Native state/responsive evidence checks representative real consumers and the affected desktop/mobile claims.
- [ ] **D10-A04** — Keep CSS responsible for theme values and Base UI/native HTML responsible for interaction and accessibility.

Coordination: No W06.C01 or [#94 W07.C01](https://github.com/Noahlw/efcc-system/issues/94) hard edge is assumed merely because they also touch UI. Serialize concrete shared primitive edits.

### W06.C03 — Adopt Lucide with preserved glyph geometry

Source: superseded D11; original review phase 3.

Product glyphs use the accepted Lucide owner while retaining the agreed R11 geometry and useful reference assets.

Gates: T08.

- [ ] **D11-A01** — Replace matching product geometry and remove superseded geometry owners; document only minimal necessary exceptions.
- [ ] **D11-A02** — Preserve stroke, sizing, labels/decorative semantics, focus and actual native rendering in affected states and engines.
- [ ] **D11-A03** — Retain useful semantic caller interfaces where justified; do not mistake that interface for a duplicated geometry library.
- [ ] **D11-A04** — Book screens/assets and license are preserved; Lucide remains mandatory in final aggregate acceptance.

Coordination: Independent presentation PR; coordinate icon and primitive edits with W06.C02 without inventing a package-wide blocker.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
