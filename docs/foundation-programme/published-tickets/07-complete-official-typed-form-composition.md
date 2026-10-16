<!-- efcc-foundation:87:R3:W07 -->

**Review label:** Official typed forms：expand→migrate→contract

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 3; primary 3. Phases are review groups, not global execution barriers.

**Packages:** ST10 **Applicable gates:** T02, T03, T04, T08 **User stories:** 36, 44, 46

## What to build

All real form consumers use official typed composition and the obsolete generic-signature surface is removed through green, resumable checkpoints.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.

- **W07.C01**: None (this checkpoint can start immediately after authorization and entry checks).
- **W07.C02**: W07.C01.
  - W07.C01: Consumes the official typed composition surface proven by the pilot.
- **W07.C03**: W07.C01.
  - W07.C01: Consumes the official typed composition surface proven by the pilot.
- **W07.C04**: W07.C01.
  - W07.C01: Consumes the official typed composition surface proven by the pilot.
- **W07.C05**: W07.C02, W07.C03, W07.C04.
  - W07.C02: Assisted/security consumers must no longer require the legacy surface.
  - W07.C03: Public/applicant consumers must no longer require the legacy surface.
  - W07.C04: Review/destructive-action consumers must no longer require the legacy surface.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W07.C01 — Expand official typed form composition with an Identity pilot

Source: superseded D12; original review phase 3.

A real Identity edit/review/back journey uses official typed form composition while other consumers remain green during migration.

Gates: T02, T04, T08.

- [ ] **D12-A01** — Use the existing library's public composition/inference, one form instance and stable component identity; field groups are used only for genuinely shared fields.
- [ ] **D12-A02** — Migrate the Identity field composition pilot, preserving validation, raw/transformed/frozen values, subscriptions, dirty/discard, focus and actual submission behavior.
- [ ] **D12-A03** — Prove wrong-field typing and genuine native edit/review/back behavior without copying the library's generic signature into a replacement alias.
- [ ] **D12-A04** — Inventory every legacy AppFormApi consumer. Retain the old compatibility surface only until the three consumer-family migration checkpoints migrate their families and W07.C05 contracts it.
- [ ] **D12-A05** — Keep sign-in and other unchanged useAppForm consumers valid and include them in the inventory; no CVA prerequisite is imposed.

Coordination: Expand-contract is limited to the genuinely shared form type surface; it does not introduce a generic workflow engine.

### W07.C02 — Migrate assisted and own-security form composition

Source: superseded D13; original review phase 3.

Assisted-account and own-security forms use official typed composition without changing credential workflow lifetimes.

Gates: T04, T08.

- [ ] **D13-A01** — Migrate their real legacy form-type consumers and preserve one form instance, fields, subscriptions, review transformations and remount/focus behavior.
- [ ] **D13-A02** — Actual creation/recovery/password/confirmation journeys retain explicit submit, frozen values, secret disposal and 201/200 envelopes.
- [ ] **D13-A03** — Keep lifecycle/controller and command-intent refactors for the assisted and own-security workflow deliveries; this mechanical migration must remain green on existing business policy.
- [ ] **D13-A04** — No owned consumer continues to require the legacy generic-signature alias when this batch closes.

Coordination: Small mechanical consumer batch; shared assisted-controller edits are reserved separately from later lifecycle work.

### W07.C03 — Migrate anonymous and applicant form composition

Source: superseded D14; original review phase 3.

Public application and signed-in applicant forms gain typed composition while retaining their separate capability contracts.

Gates: T02, T04, T08.

- [ ] **D14-A01** — Migrate the real application/applicant legacy consumers; preserve raw values, normalization, frozen review and historical payload literals/fingerprints.
- [ ] **D14-A02** — Native anonymous creation/reconciliation and signed-in correction/withdrawal/resubmission remain distinct and behaviorally unchanged.
- [ ] **D14-A03** — No new signup session, second form instance, hidden auto-submit or legacy generic-signature consumer remains in this batch.
- [ ] **D14-A04** — Lifecycle and command refactoring remains separately owned by [#101 W14.C01](https://github.com/Noahlw/efcc-system/issues/101)/[#101 W14.C02](https://github.com/Noahlw/efcc-system/issues/101).

Coordination: Can follow W07.C01 independently of the assisted/security batch; coordinate common field/validation edits.

### W07.C04 — Migrate review and destructive-action form composition

Source: superseded D15; original review phase 3.

Decision, restriction and deletion form consumers retain their native confirmation behavior through official typed composition.

Gates: T04, T08.

- [ ] **D15-A01** — Migrate each applicable legacy consumer; an inspected form that does not use the obsolete type surface remains KEEP with evidence.
- [ ] **D15-A02** — Preserve private notes, applicant-visible reasons, independent restrictions, destructive warnings, frozen reviews and explicit final submission.
- [ ] **D15-A03** — Verify actual field/confirmation/dirty/focus behavior and type rejection; keep policy and lifecycle refactoring out of this mechanical batch.
- [ ] **D15-A04** — No owned consumer still requires the legacy generic-signature alias at batch completion.

Coordination: Shares form primitives with W07.C02/W07.C03, but their completion is not a technical prerequisite.

### W07.C05 — Contract the legacy form type surface

Source: superseded D16; original review phase 3.

Form authors no longer maintain the library's generic parameter list or an unused compatibility alias.

Gates: T03, T04, T08.

- [ ] **D16-A01** — Reconcile the complete current consumer inventory, including additions/renames, and prove no remaining production consumer needs the obsolete signature glue.
- [ ] **D16-A02** — Remove obsolete aliases/bridges rather than leaving a permanent parallel API; retain legitimate official inferred types and useful useAppForm consumers.
- [ ] **D16-A03** — Type/client-build evidence and affected native field/form claims pass on the contracted candidate, preserving the batches' actual interaction contracts.
- [ ] **D16-A04** — This is the contract step of the wide mechanical refactor, not a new product or workflow abstraction.

Coordination: Known expand-contract sequence, with green intermediate batches; no global red integration branch is currently justified.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
