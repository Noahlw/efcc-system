# Issue tracker: GitHub

`Noahlw/efcc-system` uses GitHub Issues through `gh`. These rules apply to all contributors without personal skills. Issues own requirements, decisions and delivery progress; tracked repository docs own shared procedures. `.scratch/` contains temporary drafts and private evidence.

Use `--repo Noahlw/efcc-system` outside this checkout. GitHub shares issue/PR numbers: resolve an ambiguous number with `gh pr view`, then `gh issue view`. [Triage labels](triage-labels.md) maps the five triage roles to this repository's labels.

## 1. Read the assigned contract

[Project overview #1](https://github.com/Noahlw/efcc-system/issues/1) owns stable v1 scope, constraints and reading routes. Its native feature children own delivery progress. Use [#2](https://github.com/Noahlw/efcc-system/issues/2) for historical navigation; preserve its archive, comments and historical children. Routine PR merges do not require rewriting #1.

Read the assigned feature/task body, its governing spec, relevant comments and later approved decisions, then the applicable docs/source and PR evidence. The feature inventory is navigation: a baseline, schema, closed issue or Home read does not establish full feature delivery. Native child counts describe tracked units, not v1 completion or release readiness; closed/not-planned work is not delivered work.

## 2. Maintain one current feature contract

A new unplanned feature keeps the same issue ID from baseline through full specification, delivery tasks and completion. Register agreed outcome, scope, authority links, unknowns and next action; an unapproved baseline has no approved spec revision or implementation readiness.

When detailed specification is authorized, publish/reconcile the full contract at that existing ID and read it back. An approved contract records its **spec revision, date and approval-decision links**. Its owner reflects approved requirements, acceptance, exclusions and explicit supersession in the current body, links original decisions, and preserves comments/history. Mark proposals separately. Resolve a stale/conflicting body against actual approved authority; a newer edit alone is not approval.

Advance the revision for an approved material change to scope, behavior, constraints or acceptance. Cosmetics and progress do not advance it. Keep a concise revision note and original decision references in the same issue; edit history alone is not the approval record. Task/PR handoffs identify the governing issue, revision/date and applicable decisions in their existing descriptions. Before starting or handing over work, reconcile approved material changes in affected tasks/PRs and evidence; preserve unaffected work and valid evidence. Metadata changes alone require no blanket qualification rerun. Follow [Testing workflow](../testing.md) for candidate/source changes.

`to-spec` targets that existing feature ID; `to-tickets` uses its approved full-contract revision; full-feature `implement-spec` uses the same delivery ID and task graph. Each stage needs its applicable invocation/publication or implementation authorization. Verify the target ID/version on readback; stop and report a target-binding failure if a tool would create a duplicate spec. A Ready label grants no additional work or merge permission.

Keep existing separate authorities: [#29](https://github.com/Noahlw/efcc-system/issues/29) and approved [O08](https://github.com/Noahlw/efcc-system/issues/29#issuecomment-6253275987)/[O09](https://github.com/Noahlw/efcc-system/issues/29#issuecomment-6253385403) govern Roles policy. Its delivery parent owns tasks and references those decisions instead of replacing #29. Where an authority has no revision number, cite its exact approved decision and retrieval date. A separately agreed partial phase has its own complete contract/target and leaves the broader feature open. Email, [J16 #162](https://github.com/Noahlw/efcc-system/issues/162) and [J09 #163](https://github.com/Noahlw/efcc-system/issues/163) retain their existing resumption/acceptance rules; listing them activates no work.

## 3. Deliver useful slices

Publish authorized, independently verifiable delivery tasks as native sub-issues of their governing feature/spec, carrying the parent and applicable contract version. Task publication leaves the parent body/state unchanged. Use native blocking dependencies only for genuine prerequisites, supplying the blocker's database ID, not issue number/node ID. Fallbacks: `Part of #<parent>` plus a parent task list when native children are unavailable; `Blocked by: #<n>` when native blocking links are unavailable. Treat fallback lists as navigation, not another manually maintained progress board.

Work the eligible frontier: required blockers are closed and their actual prerequisite contracts satisfied. Claim work by assigning the implementing account; skip claimed tasks and identify the active PR when handing work over. Authors maintain their task/PR and affected tracked docs; ordinary task progress does not require a shared overview edit. The project overview uses the global `wayfinder:map` role; actual child roles remain `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task`. Use the [triage mapping](triage-labels.md) when applying readiness labels.

## 4. Close only eligible completed work

Follow the existing [PR Delivery Contract](pull-request-contract.md). In its Summary, identify the applicable issue/spec revision and decisions. Partial/intermediate PRs reference work without closing keywords or another auto-closing relationship. Use `Closes #<delivery-issue>` only when that merge completes the entire approved issue contract, required evidence and applicable acceptance, and closure is authorized. Child closure alone does not authorize parent closure. For partial work, target the completed child/phase; full-feature completion requires the whole parent contract.

Existing reviewers check the applicable revision, scope, evidence and every closing reference. Unmet in-issue Owner/human acceptance keeps the issue open unless an explicit Owner decision already separates its delivery contract. Preserve [#106](https://github.com/Noahlw/efcc-system/issues/106)'s acceptance authority and all retained programme/release gates; technical pass, Owner acceptance, merge and deployment remain separate.

Before relying on auto-close, verify the repository setting read-only. With it enabled, an eligible linked PR closes its named issue on merge to default `main`. The authorized merge handoff reads back landed source and actual issue states/relationships. An unmerged PR closure or non-default stacked merge is not delivery. Report disabled/unavailable settings or failed closure; settings/manual closure need applicable authorization. Feature PRs do not incidentally close #1, #29 or #106.

PRs are not a general request-discovery surface. An explicitly assigned PR can be read or updated within authorization. If discovery is separately enabled, only external authors with association `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE` are discovery candidates; this filter does not restrict an explicitly named PR.

## 5. Coordinate shared edits

One authorized coordinator updates shared scope/navigation/grouping only when agreed work, product shape or authority routes change. Feature owners maintain their current contracts; routine task/PR work continues without a #1 sync field or coordinator dependency. Tracked docs use normal branch/PR review.

Before an external write, reread the live body, comments and relationships and reconcile intervening edits. Preserve historical decisions and source-bound receipts. Keep multiline text in a temporary file and publish with `--body-file`. For archive/redirect migrations, preserve and read back the original before replacing navigation, then change authorized metadata/relationships. Resume interrupted publication from verified live state, reusing verified archives instead of duplicating them. This convention is not a lock/CAS guarantee; hand over to another authorized publisher when necessary. Coordinator duties grant no additional acceptance, closure, settings, merge, deployment or remote-data authority.

## Two handoff examples

- **New Programs/Events feature:** its baseline ID later receives an approved spec revision/date and decision links. Children and PRs cite that version. An approved material revision updates the body and affected work/evidence; unrelated evidence remains. Partial PRs reference the parent; only eligible full completion may close it. This illustrates the workflow, not an approved product spec.
- **Roles with existing #29 / partial delivery:** the delivery parent has its own approved contract revision and cites exact #29/O08/O09 policy decisions. A PR completing one child closes only that child; the incomplete parent remains open. #29 remains separate and is excluded from closing references.
