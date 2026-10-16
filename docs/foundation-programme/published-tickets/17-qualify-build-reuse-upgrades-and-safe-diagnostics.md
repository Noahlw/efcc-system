<!-- efcc-foundation:87:R3:W17 -->

**Review label:** Build／cache／upgrades／safe diagnostics

**Status:** Published from approved Draft 2; ready-for-agent. Publication has not started implementation.

**Parent:** [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87)

**Review phases:** 6; primary 6. Phases are review groups, not global execution barriers.

**Packages:** ST23, ST24
**Applicable gates:** T04, T08, T10, T11, T12
**User stories:** 55, 56, 57, 58

## What to build

Developers reuse only compatible immutable builds and operators receive safe attributable failures, with real public upgrade seams and explicit configuration validation.

## Blocked by

Whole-ticket prerequisites: None. Only these have native issue-blocking relationships; all other prerequisites are checkpoint-scoped below.

The following exact checkpoint dependencies govern execution. A verified checkpoint can unblock its consumer before the producer ticket closes; no whole-ticket gate is implied by a partial-contract dependency.
- **W17.C01**: [#89 W02.C03](https://github.com/Noahlw/efcc-system/issues/89), [#93 W06.C01](https://github.com/Noahlw/efcc-system/issues/93), [#94 W07.C05](https://github.com/Noahlw/efcc-system/issues/94).
  - [#89 W02.C03](https://github.com/Noahlw/efcc-system/issues/89): Consumes the settled native gate/resource/lifecycle interfaces.
  - [#93 W06.C01](https://github.com/Noahlw/efcc-system/issues/93): Consumes the explicit production/native stylesheet policy.
  - [#94 W07.C05](https://github.com/Noahlw/efcc-system/issues/94): Consumes the final official form composition surface for executable public compatibility checks.
- **W17.C02**: [#91 W04.C02](https://github.com/Noahlw/efcc-system/issues/91).
  - [#91 W04.C02](https://github.com/Noahlw/efcc-system/issues/91): Consumes the settled business-error runtime/RPC/public-failure contract.

## Acceptance criteria and execution checkpoints

This is one delivery/management ticket. Each checkpoint is a bounded execution/review step, not a new ticket. Use a fresh context and a handoff when needed; retain green intermediate candidates and exact parent/cumulative evidence. Ticket completion requires all its checkpoints.

### W17.C01 — Qualify native build reuse, portability and public upgrade seams

Source: superseded D37; original review phase 6.

Developers reuse only compatible immutable native builds and retain fresh trustworthy execution and safe fallback under the pinned toolchain.

Gates: T08, T10, T11, T12.

- [ ] **D37-A01** — On one candidate, verify genuine Wrangler Harness/srvx/app-bound D1 identity, production/native style/asset interoperability and pinned Node/pnpm.
- [ ] **D37-A02** — Controlled owned cache roots exercise HIT, MISS, compiled-input invalidation, assertion-only non-inputs, corrupt rebuild, relocation and unavailable-storage uncached execution.
- [ ] **D37-A03** — Cache no mutable state, secrets, evidence or passing results. A failed build is not retried as an availability fallback.
- [ ] **D37-A04** — The cache-unavailable path emits a fixed safe category instead of the raw caught exception while preserving its public behavior and uncached execution.
- [ ] **D37-A05** — Executable public-seam upgrade checks cover actual auth, runtime, styling and form compatibility. Later dependency/input changes refresh affected evidence; no historical speed ratio or byte-identical fresh build is promised.

Coordination: CVA/Lucide and later lockfile changes are build inputs and trigger fresh affected evidence; they are not blanket prerequisites for editing a generic cache owner.

### W17.C02 — Make application diagnostics and configuration failures safe

Source: superseded D38; original review phase 6.

Operators can attribute relevant auth/access/business failures using fixed safe fields without exposing private data or changing public errors.

Gates: T04, T12.

- [ ] **D38-A01** — Use allowlisted fixed stage/category/outcome fields at existing owners; explicit required configuration validation remains attributable.
- [ ] **D38-A02** — Synthetic faults demonstrate no raw exception, SQL binding, credential, contact, cookie, session or request-body leakage, preserving native auth and public business envelopes.
- [ ] **D38-A03** — Coordinate actual command-stage names with the Identity, assisted, security, application and Staff-action workflow deliveries and refresh affected evidence after owner changes, without waiting for unrelated entire packages.
- [ ] **D38-A04** — Use existing boundaries rather than external telemetry or a request-ID platform. W17.C01 separately owns the safe native cache fallback, and final ST24 coverage includes both.

Coordination: Review after command owners settle where useful; only the consumed error interface is a known hard edge.

## Evidence and handoff

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

Before pausing, record the exact source/tree and parent/cumulative base, accepted contracts and public interface/behavior changes, first failures and separate repairs, valid/invalidated evidence, remaining checks and the next bounded action. Evidence from a different candidate is not silently carried as a current pass.

Checkpoint readiness is an implementation tracking condition within this ticket, not another approval request or a child issue. Implementation, independent review, owner acceptance and release remain separate.

## Stacked PR and programme policy

Use feature branches and reviewable stacked PRs. One delivery ticket may span multiple fresh contexts and PRs; preserve green checkpoints, record the actual parent/base and cumulative programme evidence, and refresh affected evidence when inputs move. Phase priority and shared edit coordination are not additional blockers.

Before starting a checkpoint, verify its named contract prerequisites in the producer issue; a ready-for-agent label or absence of whole-ticket blockers does not override an unfulfilled checkpoint dependency. This publication round authorizes no implementation, merge, deployment, remote-data action or future Roles scope.

All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain owned by #87 R3. No scope is reduced by the 19-ticket grouping.
