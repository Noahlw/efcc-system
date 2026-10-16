# Foundation programme implementation handoff

Canonical programme: [#87 R3](https://github.com/Noahlw/efcc-system/issues/87). Its 19 child tickets are [#88–#106](publication-index.md). All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain in scope. The 41 original work items are internal checkpoints; the 185 acceptance criteria are retained.

This branch carries accepted design records and portable planning evidence. Application code is unchanged from source baseline `272dddbc887e7c3343a61831f91833fb687047bc`. Planning/publication is complete; implementation, native qualification and independent implementation review have not run. The user requested this commit/push so another machine can begin implementation.

## Start here

Read [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md), then refresh the full live #87 body/comments and the selected child body/comments/dependencies. Read repository AGENTS.md and its relevant pointers on the destination machine. Use the repository-pinned Node/pnpm versions and the destination’s configured tools.

The default first delivery is [W01 / #88](https://github.com/Noahlw/efcc-system/issues/88), if still open and unclaimed. Record the four T14 starting exercises before changing their relevant owners. Work the verified checkpoint frontier; a ticket without native blockers can still have an unmet checkpoint prerequisite. Continue through the complete programme using reviewable stacked PRs and the seven review groups.

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
