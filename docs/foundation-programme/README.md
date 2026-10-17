# Foundation programme implementation handoff

Canonical programme: [#87 R3](https://github.com/Noahlw/efcc-system/issues/87). Its 19 child tickets are [#88–#106](publication-index.md). All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain in scope. The 41 original work items are internal checkpoints; the 185 acceptance criteria are retained.

The complete implementation is assembled on `codex/foundation-programme-complete`, with one actual stacked parent and source-attributed producer inputs recorded in [#106](https://github.com/Noahlw/efcc-system/issues/106). The original planning handoff `d2b0b2d25317530a3a77ab344dd7ab96ce810ab1` remains in its ancestry; its application baseline was `272dddbc887e7c3343a61831f91833fb687047bc`. The publication files remain historical snapshots. Current implementation progress, failed gates, candidate receipts, independent review and owner acceptance belong to GitHub Issues.

## Start here

Read [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md), then refresh the full live #87 body/comments and the selected child body/comments/dependencies. Read repository AGENTS.md and its relevant pointers on the destination machine. Use the repository-pinned Node/pnpm versions and the destination’s configured tools.

Continue from the current implementation branch and live checkpoint receipts. W01 and the other producer checkpoints have source-attributed implementation evidence in their issues; final source integration and acceptance remain W19's responsibility. The four [T14 starting exercises](starting-exercises.md) preserve their original before-source and package comparisons. Work the verified checkpoint contracts: absence of native blockers alone does not establish readiness.

## Current implementation owners

- Business quotas use `business_rate_limit`; native authentication retains `rate_limit`. Original `0010` quota and `0011` search migrations, metadata lineage and populated upgrade checks are coordinated by #90, #95 and #106.
- Staff directory/search, audit, review queue, applicant inbox and Home retain their distinct bounded readers and independently authorised details. [ADR0008](../adr/0008-bounded-account-read-projections.md) describes their contracts.
- [Official form composition](../testing-foundation/form-composition-inventory.md) retains eight form-owner modules and ten owning hooks. The old generic aliases and recovery handover adapter are retired; later workflow views/controllers consume the final library interface.
- [ADR0009](../adr/0009-library-owned-ui-presentation.md) records CVA/Lucide ownership. `src/app/globals.css` declares the shared production/native source policy.
- [Native runtime ownership](../adr/0002-native-testing-runtime.md) and [cache qualification](../testing-foundation/native-cache-qualification.md) distinguish application evidence, owned Node connection lifetime and the separately reproduced local SDK transport limitation. A successful build or selected run does not repair that limitation or grant aggregate acceptance.
- Root `GLOSSARY.md` remains the single domain vocabulary. The [existing file ledger](coverage.csv) retains baseline dispositions and reconciles final tracked paths; its KEEP/EXCLUDE entries are not runtime passes.

## Read on demand

- Scope or a disputed decision: live #87, then [programme-spec.md](programme-spec.md) and [understanding.md](understanding.md). The spec snapshot is byte-identical to the published R3 body at handoff preparation.
- Ticket readiness and review sequencing: [publication-index.md](publication-index.md), [breakdown-draft.md](breakdown-draft.md), and the live child issue. Eight whole-ticket prerequisites are native GitHub blockers; partial contracts remain named checkpoint conditions.
- Exact acceptance/story/decision mapping: [draft2-traceability.md](draft2-traceability.md) and [breakdown-draft.json](breakdown-draft.json). The JSON’s `published_body` field locates the included ticket snapshot; `draft_file` is the historical source filename.
- Affected source ownership or coverage: filter [coverage.csv](coverage.csv) for the selected package/path, then read its bounded evidence under [review-evidence/](review-evidence/) and the actual source at the named revision. The ledger has 366 baseline tracked files: 75 CHANGE, 178 KEEP and 113 EXCLUDE. KEEP is not a runtime pass; EXCLUDE does not authorize deletion. Reconcile additions/renames/removals as implementation proceeds.
- Publication provenance: [publication.json](publication.json), [publication-verification.json](publication-verification.json), and [published-tickets/](published-tickets/). These are snapshots, not a second tracker. GitHub owns subsequent progress.

The original audit folder is research provenance, not required execution instructions. Raw review-evidence JSON may cite the original Mac checkout or Downloads path; those are historical locators. Resolve repository paths against the recorded baseline and the destination checkout. No Mac-local scratch folder, session state or original audit attachment is required to start.

The handoff manifest records portable file hashes. Publication and draft receipts describe their original candidate/authoring stage; they establish no application, migration or browser pass. A later human continuation instruction supplies implementation authorization; publication-only wording in historical snapshots does not override it.

## Finish line

Each checkpoint needs its own genuine boundary evidence. Preserve valid attributed evidence and refresh what a source/base/input change invalidates. W19.C01 retains phase-4 schema-lineage integration; W03/W08 retain their immediate upgrade checks. W19.C02 reconciles final file/package dispositions, and W19.C03 qualifies one exact frozen candidate under T01–T15, including independent Standards/Spec review and separate owner acceptance.

Merge, deployment, production/remote data changes and future Roles implementation remain outside this handoff’s authorization.
