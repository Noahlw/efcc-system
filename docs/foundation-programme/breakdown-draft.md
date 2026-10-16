# EFCC foundation programme — complete ticket breakdown draft

Draft revision: 2 Date: 2026-10-16 (Asia/Hong_Kong)

**Status: APPROVED AND PUBLISHED.** The user approved Draft 2. Its 19 tickets are published as #88–#106, native children of [#87](https://github.com/Noahlw/efcc-system/issues/87), with eight genuine whole-ticket blocking links. Implementation, builds/runtime qualification, commits and PRs have not started.

## What changed

Ticket granularity now follows coherent delivery and review ownership. The original 41 work items become 41 internal checkpoints across 19 tickets. Every original acceptance criterion is preserved verbatim in the structured source trace and mapped to a current checkpoint; no scope or test gate is removed. A ticket may span several context sessions and stacked PRs. Context limits are handled by bounded checkpoints and explicit handoffs, not by creating another issue for every batch.

The main consolidations are native selection/lifecycle/gates; CSS/CVA/Lucide presentation; the complete forms expand–migrate–contract; Staff list/search; Home sections; review/audit/inbox readers; assisted creation/recovery; application lifetimes; Staff decisions/restrictions/deletion; build/diagnostics; and programme closure. The detailed checkpoints retain separate authority, policy and evidence where required.

## Authority and preserved scope

- Canonical scope: [Issue #87 R3](https://github.com/Noahlw/efcc-system/issues/87), owner-approved FB87-01–08 and paging option A. Read-only refresh matched R3 exactly on 2026-10-16; no remote edit was needed for regrouping.
- Spec body SHA-256: `60420f610ec3d8db1177b245fde92a9027baeb4bf78f9affe15b51745bfc08b6`. Source/planning baseline: `272dddbc887e7c3343a61831f91833fb687047bc`; refresh live source and comments before implementation.
- All 26 packages, seven review phases, 23 implementation decisions, 64 user stories, T01–T15 and the 366-file evidence ledger remain. KEEP is not runtime acceptance; EXCLUDE does not authorize deletion. Scope reduction or deferral needs an owner decision.
- The original audit, prior read-only findings and feedback handoff remain research/provenance. This refinement does not restart the whole-repo audit or infer current source coverage from a stale graph.
- The [complete mapping](draft2-traceability.md) preserves all 41 original work items and acceptance IDs in the 19 published deliveries. Superseded draft archives remain local provenance and are not required for implementation. W-numbers are stable programme IDs; the links below open the real issues.

## Entry, context and PR policy

Inherit Issue #87 R3, FB87-01–08, paging option A and applicable T01–T15. Use synthetic owned data and genuine boundaries. No automatic acceptance retries, private persistence or policy weakening. Before changing a relevant owner, capture the named-source T14 starting exercise. Drafting has not run those exercises or any runtime qualification.

B0 stays an entry checklist: record the four T14 starting exercises before their respective owner changes (Staff Identity review copy, business-error addition, Roles HTTP-test design without Roles implementation, deletion invariant trace). Package after-results belong to W11.C01, W04.C02, W02.C03 and W15.C03; W19.C03 compares the final aggregate. Draft preparation has not performed them.

The seven phases organize review/priority. They do not require every earlier phase to finish before a later independent change. One ticket is not one PR or one context window. In particular W07 uses expand → green migration batches → contract; W12 uses creation/handover expansion → green recovery migration → adapter removal. Do not collapse these safety steps into one unreviewable edit.

Each PR has one actual parent/base. Choose a reviewable parent containing the consumed contracts, record parent-relative and cumulative evidence, and refresh affected evidence after base/input movement. Publication has not started branch, implementation, merge or release work. Slim CI and the full local frozen-candidate qualification boundary stay unchanged.

## Reading dependencies

A whole-ticket blocker requires all of that delivery before any checkpoint can proceed. Other edges name the exact checkpoint contract, and only the consuming step waits for it. A verified checkpoint receipt can unblock a consumer while other work remains in its producer ticket. Shared files, review phases and the union of ticket references do not create extra blockers. Only genuine whole-ticket prerequisites are published as native issue-blocking edges; checkpoint prerequisites remain explicit linked readiness conditions in each body.

## Seven review groups

| Phase | Canonical packages | Draft deliveries/checkpoints |
| --- | --- | --- |
| 1 — Correctness and verification safety | ST01, ST02, ST03, ST22 | W01, W02, W03 |
| 2 — Credential and shared contracts | ST04, ST05, ST06 | W04, W05 |
| 3 — CSS, UI and forms | ST07, ST08, ST09, ST10 | W06, W07 |
| 4 — Bounded reads and migrations | ST16, ST17, ST18, ST19 | W08, W09, W10, W19.C01 |
| 5 — Workflows, commands and pages | ST11, ST12, ST13, ST14, ST15, ST20, ST21 | W11, W12, W13, W14, W15, W16 |
| 6 — Build, cache and diagnostics | ST23, ST24 | W17 |
| 7 — Documentation, retirement and aggregate acceptance | ST25, ST26 | W18, W19 |

ST19 upgrade checks run immediately inside W03 and W08; W19.C01 integrates their original migration lineage in phase 4. Its location in the programme-closure ticket is an administrative consolidation, not permission to postpone those checks. W18 Book containment remains independently deliverable.

## Published numbered breakdown

1. **[W01 — Unicode Account initials](https://github.com/Noahlw/efcc-system/issues/88)** — Phase 1
   - **What it delivers:** Account initials render complete supported characters while stored identity and sign-in behavior remain unchanged.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W01.C01 (D01). This listing is not an added sequential edge; the body declares the actual dependencies.

2. **[W02 — Native qualification／process ownership](https://github.com/Noahlw/efcc-system/issues/89)** — Phase 1
   - **What it delivers:** Developers can select, execute and dispose the correct native checks against an exact source/index without losing mobile coverage or owned-process failures.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W02.C01 (D02); W02.C02 (D03); W02.C03 (D04). This listing is not an added sequential edge; the body declares the actual dependencies.

3. **[W03 — Business quota isolation＋upgrade](https://github.com/Noahlw/efcc-system/issues/90)** — Phase 1
   - **What it delivers:** Business quotas survive native-auth housekeeping and a populated upgrade, with existing limits, precedence and concurrent consumption preserved.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W03.C01 (D05). This listing is not an added sequential edge; the body declares the actual dependencies.

4. **[W04 — Runtime boundaries／business error contracts](https://github.com/Noahlw/efcc-system/issues/91)** — Phase 2
   - **What it delivers:** Meaningful runtime/client boundaries are enforced and a business failure has one consistent runtime, RPC and client contract.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W04.C01 (D06); W04.C02 (D08). This listing is not an added sequential edge; the body declares the actual dependencies.

5. **[W05 — Neutral credential proof](https://github.com/Noahlw/efcc-system/issues/92)** — Phase 2
   - **What it delivers:** Non-password workflows receive neutral current proof while verifier material and request/SQL-time authority stay with their proper owners.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W05.C01 (D07). This listing is not an added sequential edge; the body declares the actual dependencies.

6. **[W06 — CSS／CVA／Lucide presentation](https://github.com/Noahlw/efcc-system/issues/93)** — Phase 3
   - **What it delivers:** The app uses the accepted CSS, CVA and Lucide owners with production/native parity and preserved R11 appearance, accessibility and interaction.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W06.C01 (D09); W06.C02 (D10); W06.C03 (D11). This listing is not an added sequential edge; the body declares the actual dependencies.

7. **[W07 — Official typed forms：expand→migrate→contract](https://github.com/Noahlw/efcc-system/issues/94)** — Phase 3
   - **What it delivers:** All real form consumers use official typed composition and the obsolete generic-signature surface is removed through green, resumable checkpoints.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W07.C01 (D12); W07.C02 (D13); W07.C03 (D14); W07.C04 (D15); W07.C05 (D16). This listing is not an added sequential edge; the body declares the actual dependencies.

8. **[W08 — Staff browsing＋live search](https://github.com/Noahlw/efcc-system/issues/95)** — Phase 4
   - **What it delivers:** Staff can page and search the complete permitted directory with independently authorized detail, atomic projections, safe backfill, IME handling and latest-query results.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** W08.C02 ← W04.C02
   - **Internal checkpoints:** W08.C01 (D17); W08.C02 (D18); W08.C03 (D19). This listing is not an added sequential edge; the body declares the actual dependencies.

9. **[W09 — Home bounded reads／calendar truth](https://github.com/Noahlw/efcc-system/issues/96)** — Phase 4
   - **What it delivers:** Home Events, participation, invitations and notices remain completely reachable in bounded batches while calendar facts and relational authority stay correct.
   - **Whole-ticket blockers:** None.
   - **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
   - **Internal checkpoints:** W09.C01 (D20); W09.C02 (D21); W09.C03 (D22). This listing is not an added sequential edge; the body declares the actual dependencies.

10. **[W10 — Review queue／audit／inbox paging](https://github.com/Noahlw/efcc-system/issues/97)** — Phase 4

- **What it delivers:** Reviewers, audit readers and applicants can traverse their complete permitted records with independent detail and restored task context, retaining each distinct privacy policy.
- **Whole-ticket blockers:** None.
- **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
- **Internal checkpoints:** W10.C01 (D23); W10.C02 (D24); W10.C03 (D25). This listing is not an added sequential edge; the body declares the actual dependencies.

11. **[W11 — Identity workflow＋atomic commands](https://github.com/Noahlw/efcc-system/issues/98)** — Phase 5

- **What it delivers:** Self-phone and Staff identity correction use clear feature-owned review, reconciliation and atomic commands without changing authority, identity or task-return contracts.
- **Whole-ticket blockers:** W05.
- **Exact contract prerequisites:** W11.C01 ← W05.C01, W07.C01, W08.C02
- **Internal checkpoints:** W11.C01 (D27). This listing is not an added sequential edge; the body declares the actual dependencies.

12. **[W12 — Assisted creation／recovery／handover](https://github.com/Noahlw/efcc-system/issues/99)** — Phase 5

- **What it delivers:** Staff-assisted creation and recovery have distinct authority and review lifetimes, with one owned short-lived issuance/handover contract and receipt-only replay.
- **Whole-ticket blockers:** W05.
- **Exact contract prerequisites:** W12.C01 ← W05.C01, W07.C02, W08.C02
- **Internal checkpoints:** W12.C01 (D28); W12.C02 (D29). This listing is not an added sequential edge; the body declares the actual dependencies.

13. **[W13 — Own-account security](https://github.com/Noahlw/efcc-system/issues/100)** — Phase 5

- **What it delivers:** Password, confirmation, revocation and Temporary-password journeys preserve explicit submission, current authority and atomic receipts through clear feature-owned lifetimes.
- **Whole-ticket blockers:** W05.
- **Exact contract prerequisites:** W13.C01 ← W05.C01, W07.C02
- **Internal checkpoints:** W13.C01 (D30). This listing is not an added sequential edge; the body declares the actual dependencies.

14. **[W14 — Anonymous／signed-in applicant workflows](https://github.com/Noahlw/efcc-system/issues/101)** — Phase 5

- **What it delivers:** Anonymous device-capability creation and signed-in correction, withdrawal and resubmission remain separately authorized through explicit, atomic and reconcilable workflows.
- **Whole-ticket blockers:** None.
- **Exact contract prerequisites:** W14.C01 ← W07.C03, W08.C02; W14.C02 ← W05.C01, W07.C03, W08.C02
- **Internal checkpoints:** W14.C01 (D31); W14.C02 (D32). This listing is not an added sequential edge; the body declares the actual dependencies.

15. **[W15 — Membership decisions／restrictions／deletion](https://github.com/Noahlw/efcc-system/issues/102)** — Phase 5

- **What it delivers:** Staff review, restriction and eligible deletion tasks retain distinct policy, private notes, explicit confirmation, atomic history and safe uncertainty recovery.
- **Whole-ticket blockers:** W05.
- **Exact contract prerequisites:** W15.C01 ← W05.C01, W07.C04, W10.C01; W15.C02 ← W05.C01, W07.C04, W08.C01; W15.C03 ← W05.C01, W07.C04, W08.C02
- **Internal checkpoints:** W15.C01 (D33); W15.C02 (D34); W15.C03 (D35). This listing is not an added sequential edge; the body declares the actual dependencies.

16. **[W16 — Page／navigation／unavailable recovery](https://github.com/Noahlw/efcc-system/issues/103)** — Phase 5

- **What it delivers:** Delivered pages compose settled read/feature contracts and preserve URL, task-return, dirty-navigation and fresh authoritative recovery behavior.
- **Whole-ticket blockers:** W08, W09, W10.
- **Exact contract prerequisites:** W16.C01 ← W08.C03, W09.C02, W09.C03, W10.C01, W10.C02, W10.C03
- **Internal checkpoints:** W16.C01 (D36). This listing is not an added sequential edge; the body declares the actual dependencies.

17. **[W17 — Build／cache／upgrades／safe diagnostics](https://github.com/Noahlw/efcc-system/issues/104)** — Phase 6

- **What it delivers:** Developers reuse only compatible immutable builds and operators receive safe attributable failures, with real public upgrade seams and explicit configuration validation.
- **Whole-ticket blockers:** None.
- **Exact contract prerequisites:** W17.C01 ← W02.C03, W06.C01, W07.C05; W17.C02 ← W04.C02
- **Internal checkpoints:** W17.C01 (D37); W17.C02 (D38). This listing is not an added sequential edge; the body declares the actual dependencies.

18. **[W18 — Book path／symlink containment](https://github.com/Noahlw/efcc-system/issues/105)** — Phase 7

- **What it delivers:** The localhost Book serves valid reference paths and in-root links while rejecting traversal, prefix siblings and outside-root link targets.
- **Whole-ticket blockers:** None.
- **Exact contract prerequisites:** No external checkpoint prerequisites; internal order is in the body.
- **Internal checkpoints:** W18.C01 (D39). This listing is not an added sequential edge; the body declares the actual dependencies.

19. **[W19 — Schema integration／docs／whole-programme acceptance](https://github.com/Noahlw/efcc-system/issues/106)** — Phase 7

- **What it delivers:** The programme retains its migration lineage and justified final owners, then qualifies one frozen complete candidate for independent review and separate owner acceptance.
- **Whole-ticket blockers:** W03.
- **Exact contract prerequisites:** W19.C01 ← W03.C01, W08.C02; W19.C02 ← W01.C01, W04.C01, W06.C02, W06.C03, W11.C01, W12.C02, W13.C01, W14.C01, W14.C02, W15.C01, W15.C02, W15.C03, W16.C01, W17.C01, W17.C02, W18.C01
- **Internal checkpoints:** W19.C01 (D26); W19.C02 (D40); W19.C03 (D41). This listing is not an added sequential edge; the body declares the actual dependencies.

## Complete package coverage

| Package | Current delivery owners |
| --- | --- |
| ST01 | [W03](https://github.com/Noahlw/efcc-system/issues/90) |
| ST02 | [W01](https://github.com/Noahlw/efcc-system/issues/88) |
| ST03 | [W02](https://github.com/Noahlw/efcc-system/issues/89) |
| ST04 | [W04](https://github.com/Noahlw/efcc-system/issues/91) |
| ST05 | [W05](https://github.com/Noahlw/efcc-system/issues/92) |
| ST06 | [W04](https://github.com/Noahlw/efcc-system/issues/91) |
| ST07 | [W06](https://github.com/Noahlw/efcc-system/issues/93) |
| ST08 | [W06](https://github.com/Noahlw/efcc-system/issues/93) |
| ST09 | [W06](https://github.com/Noahlw/efcc-system/issues/93) |
| ST10 | [W07](https://github.com/Noahlw/efcc-system/issues/94) |
| ST11 | [W11](https://github.com/Noahlw/efcc-system/issues/98) |
| ST12 | [W12](https://github.com/Noahlw/efcc-system/issues/99) |
| ST13 | [W13](https://github.com/Noahlw/efcc-system/issues/100) |
| ST14 | [W14](https://github.com/Noahlw/efcc-system/issues/101) |
| ST15 | [W15](https://github.com/Noahlw/efcc-system/issues/102) |
| ST16 | [W08](https://github.com/Noahlw/efcc-system/issues/95) |
| ST17 | [W09](https://github.com/Noahlw/efcc-system/issues/96) |
| ST18 | [W10](https://github.com/Noahlw/efcc-system/issues/97) |
| ST19 | [W03](https://github.com/Noahlw/efcc-system/issues/90), [W08](https://github.com/Noahlw/efcc-system/issues/95), [W19](https://github.com/Noahlw/efcc-system/issues/106) |
| ST20 | [W11](https://github.com/Noahlw/efcc-system/issues/98), [W12](https://github.com/Noahlw/efcc-system/issues/99), [W13](https://github.com/Noahlw/efcc-system/issues/100), [W14](https://github.com/Noahlw/efcc-system/issues/101), [W15](https://github.com/Noahlw/efcc-system/issues/102) |
| ST21 | [W08](https://github.com/Noahlw/efcc-system/issues/95), [W09](https://github.com/Noahlw/efcc-system/issues/96), [W10](https://github.com/Noahlw/efcc-system/issues/97), [W11](https://github.com/Noahlw/efcc-system/issues/98), [W12](https://github.com/Noahlw/efcc-system/issues/99), [W13](https://github.com/Noahlw/efcc-system/issues/100), [W14](https://github.com/Noahlw/efcc-system/issues/101), [W15](https://github.com/Noahlw/efcc-system/issues/102), [W16](https://github.com/Noahlw/efcc-system/issues/103) |
| ST22 | [W02](https://github.com/Noahlw/efcc-system/issues/89) |
| ST23 | [W17](https://github.com/Noahlw/efcc-system/issues/104) |
| ST24 | [W17](https://github.com/Noahlw/efcc-system/issues/104) |
| ST25 | [W18](https://github.com/Noahlw/efcc-system/issues/105), [W19](https://github.com/Noahlw/efcc-system/issues/106) |
| ST26 | [W19](https://github.com/Noahlw/efcc-system/issues/106) |

## Completion and review

W19.C02 waits for the terminal delivery frontier, including W19.C01, and its transitive prerequisites cover every preceding checkpoint. W19.C03 waits for that closure and applies the full T01–T15 finish line to one frozen exact candidate: targeted and full local qualification, appropriate presentation/migration/query/lifecycle evidence, the four T14 comparisons, independent Standards/Spec review and separate owner acceptance. A passing checkpoint, ticket or PR does not grant merge, deployment, remote-data or Roles scope.

The original source acceptance text, current acceptance IDs, 23-decision map, 64-story map, T-gate map and original-to-current dependencies are retained in [Draft 2 traceability](draft2-traceability.md) and the structured draft. [Draft validation](draft-validation.json) records packaging checks only; it is not application qualification.

## Approval and publication

The user approved this 19-ticket breakdown and its publication. All 19 child bodies, labels, native parent relations and eight native blockers passed remote readback. Checkpoint dependencies retain their exact scope. Implementation has not been started; merge, deployment and remote-data operations remain separate.

[Publication index](publication-index.md) provides the real issue-number mapping. [Publication verification](publication-verification.json) records the 27 passing publication/readback checks. Historical pre-publication receipts remain authoring evidence; current handoff file hashes are recorded in handoff-manifest.json.
