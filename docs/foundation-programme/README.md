# Foundation programme implementation handoff

> **Current navigation and authority:** [#1](https://github.com/Noahlw/efcc-system/issues/1) is the overall project overview. This handoff preserves earlier source-bound Foundation receipts and instructions. For later Foundation landing, Owner decisions and retained gates, follow the live [#106](https://github.com/Noahlw/efcc-system/issues/106); its later decisions govern where historical text here differs. This notice does not change receipts or grant current task, merge or deployment authorization.

Canonical programme: [#87 R3](https://github.com/Noahlw/efcc-system/issues/87). Its 19 child tickets are [#88–#106](publication-index.md). All 26 packages, seven review phases, 23 decisions, 64 stories and T01–T15 remain in scope. The 41 original work items are internal checkpoints; the 185 acceptance criteria are retained.

The original assembled implementation is on `codex/foundation-programme-complete`; the approved R1–R5 corrective stack continues from it with actual parent branches and source-attributed evidence recorded in [#106](https://github.com/Noahlw/efcc-system/issues/106). The original planning handoff `d2b0b2d25317530a3a77ab344dd7ab96ce810ab1` remains in its ancestry; its application baseline was `272dddbc887e7c3343a61831f91833fb687047bc`. The publication files remain historical snapshots. Current implementation progress, failed gates, candidate receipts, independent review and owner acceptance belong to GitHub Issues.

## Start here

Read [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md), then refresh the full live #87 body/comments and the selected child body/comments/dependencies. Read repository AGENTS.md and its relevant pointers on the destination machine. Use the repository-pinned Node/pnpm versions and the destination’s configured tools.

Continue from the current implementation branch and live checkpoint receipts. W01 and the other producer checkpoints have source-attributed implementation evidence in their issues; final source integration and acceptance remain W19's responsibility. The four [T14 starting exercises](starting-exercises.md) preserve their original before-source and package comparisons. Work the verified checkpoint contracts: absence of native blockers alone does not establish readiness.

## Current implementation owners

- The current [#106 CR-09 corrective programme](https://github.com/Noahlw/efcc-system/issues/106) retains R1 authority/receipts, R2 response and task isolation, R3 original-value contact protection, R4 Staff-assisted Active creation and R5 integration. [ADR0001](../adr/0001-authentication-and-business-access.md), [ADR0008](../adr/0008-bounded-account-read-projections.md) and [ADR0010](../adr/0010-original-value-contact-commands.md) describe these owner boundaries. Their implementation does not itself establish qualification or Owner acceptance.
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

The technical-closure receipt at tree `51b59e8b5e6a668b324b32507eeb8f8cefd9379b` retains those 366 historical rows and reconciles 454 source paths, including the three W11/W12 two-tab regression specs. Preserve that receipt and the original `review-evidence/coverage-summary.json` as source-attributed historical evidence.

The current Owner-authorized W19.C02 documentation reconciliation maps all 459 source paths (tracked files plus approved working additions), including the five later session-draft storage/recovery, auth-context and regression-test files. It refreshes changed owner blobs while preserving original ledger fields and the 75 CHANGE / 178 KEEP / 113 EXCLUDE baseline dispositions. The ledger cannot hash itself: its exact bytes and the complete working source identity belong to the external frozen-source receipt.

The supplementary source reconciliation retains all 26 packages and 185 original criteria. It links the later Creation, Staff Identity and Applicant draft scope to existing owners and the source-attributed session-draft report; it adds no criteria or permanent acceptance authority. That report has 179 unit and 218 valid Native passing receipts, assembled from 212 passing cases plus six fixture-corrected cases, not one all-green run. Current-source mappings, historical runtime results, independent reviews and explicit Owner decisions remain distinct.

The subsequent W19.C03 technical verification at tree `43bb6a34972cd58419408971d64e939c0bb061ba` produced 179 unit and 920 Native passing cases, with zero skips/retries. Independent review then identified draft-binding, failed-discard and draft-selector gaps; those passing results did not close C03. The Owner authorized a bounded repair and refreshed verification. Current repaired-source receipts and independent reviews must identify their own immutable candidate; historical failures and qualification remain preserved. This paragraph records scope and provenance, not successful repair, final Owner acceptance or release authorization.

ADR 0007 now records the accepted/implemented selection policy. The W04.C01 and W12.C02 derived-summary corrections preserve their original receipts; their current review belongs to #106 and the Owner conversation. CVA and Lucide remain delivered under their existing contracts; the wider shadcn migration stays deferred under #1. W19.C02 acceptance, C03 final-source qualification and independent review, applicable human/device/AT and BFCache observations, T14, unfulfilled earlier conditions, B01, source-blocked S1 and separate release authorization remain distinct gates. No checkbox, issue closure, merge, deployment or Book-retirement permission follows from this reconciliation.

- Publication provenance: [publication.json](publication.json), [publication-verification.json](publication-verification.json), and [published-tickets/](published-tickets/). These are snapshots, not a second tracker. GitHub owns subsequent progress.

The original audit folder is research provenance, not required execution instructions. Raw review-evidence JSON may cite the original Mac checkout or Downloads path; those are historical locators. Resolve repository paths against the recorded baseline and the destination checkout. No Mac-local scratch folder, session state or original audit attachment is required to start.

The handoff manifest records portable file hashes. Publication and draft receipts describe their original candidate/authoring stage; they establish no application, migration or browser pass. A later human continuation instruction supplies implementation authorization; publication-only wording in historical snapshots does not override it.

## Finish line

Each checkpoint needs its own genuine boundary evidence. Preserve valid attributed evidence and refresh what a source/base/input change invalidates. W19.C01 retains phase-4 schema-lineage integration; W03/W08 retain their immediate upgrade checks. W19.C02 reconciles final file/package dispositions, and W19.C03 qualifies one exact frozen candidate under T01–T15, including independent Standards/Spec review and separate owner acceptance.

S1 remains a separate source-blocked pre-production track until the complete original O04 verified-phone revocation/reverification contract is recovered. R1–R5 do not establish first-production readiness. Extra notifications remain deferred under the existing Inbox scope; #1 tracks overall rebuild progress. Book retirement follows foundation acceptance/authorized merge and replacement verification, with references and licences retained in Git history; the file ledger alone authorizes no removal.

Merge, deployment, production/remote data changes and future Roles implementation remain outside this handoff’s authorization.

## Final-source closure reconciliation

The earlier Owner-authorized closure batch preserves the `d138f1c` qualification and later source-attributed UI receipts. It reconciles the 13 subsequently changed UI/test ledger rows; the external frozen-source receipt binds the final ledger, current source and runtime evidence. Historical results are not relabelled as results for the new candidate.

T14's four original exercises cover nine distinct paths with five historical comparisons each: **45 comparisons**, correcting the earlier external report's count of 50 without rewriting that report. These comparisons assess actual owner boundaries; they do not measure productivity. The Owner conditionally accepted T14 within its stated evidence limits; this count correction and final-source reconciliation do not grant W19.C03 acceptance.

The Owner accepted the screens actually displayed in the local review server as static visual evidence. Interactive human checks, physical-device/AT, BFCache/no-flash, B01, S1, Book/licence and separate retirement conditions, remaining earlier conditions, published-source CI and final programme acceptance retain their own gates. J16 rework remains under #162 and the wider shadcn/Base UI migration under #1. Merge and deployment require separate authorization.

The Owner subsequently accepted the new J09 result screen at working tree `a515d4f583530ddd5e19aacd6a127a9fc8ce46d0` within its stated evidence limits. Its scoped receipt records 183 unit and 213 related Native passing cases, with independent source and runtime review; it is not a full Foundation qualification. The prior full qualification failure, six obsolete-locator timeouts, later fixture-navigation failure and outer capture-session status 143 remain attributed to their original receipts. The two identified product/test findings have current repair evidence; historical failures are not rewritten as passes.

The renewed final-source closure updates the three subsequently changed product/test ledger rows and this guide's source record, preserving all original criteria, package/file dispositions and historical evidence. Product/test bytes and J09 screenshots remain unchanged from the accepted working source; the external frozen receipt binds the new document bytes and full qualification. W19.C03 remains PENDING until the Owner makes a new explicit decision. Physical-device/AT and all other pending gates above remain; the batch itself grants no acceptance, publication, merge or deployment authority.
