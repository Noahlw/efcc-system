# EFCC v1 project context

This folder is a temporary reading guide for work tracked through the v1 project overview, [issue #1](https://github.com/Noahlw/efcc-system/issues/1). GitHub issues and their approved comments remain the source of current scope, decisions and progress. This guide maps authorities; it is not a second status board or a substitute for reading the assigned issue.

## Read before v1 feature work

1. Read [#1](https://github.com/Noahlw/efcc-system/issues/1) for the project direction and its preserved [original specification](https://github.com/Noahlw/efcc-system/issues/1#issuecomment-6346598567). Read the [#2 slice map](https://github.com/Noahlw/efcc-system/issues/2) only as historical navigation; verify live issue relationships and decisions before relying on them.
2. Read the assigned issue, its comments, linked approved decisions and any later superseding authority. Then inspect the relevant source and evidence.
3. Treat a proposal, closed ticket, existing read screen or passing test as evidence only for its own scope. It does not establish full feature delivery or Owner acceptance.

## v1 feature and authority map

The groups below are the agreed v1 planning map. As of 24 October 2026, the proposed feature parents and #1/#2 reorganization are unpublished. Their publication remains on hold; use actual issue IDs only after authorized publication and readback. Existing tickets listed here keep their own scope and history.

| Feature area | Requirement and decision routes | Existing related records and boundary |
| --- | --- | --- |
| Roles and delegation | [#29](https://github.com/Noahlw/efcc-system/issues/29), including approved [O08](https://github.com/Noahlw/efcc-system/issues/29#issuecomment-6253275987) and [O09](https://github.com/Noahlw/efcc-system/issues/29#issuecomment-6253385403); #1 original specification | Any future delivery contract is separate from #29. Keep Departments, Programs, enrolment and notices in their own feature areas. |
| Departments and membership | #1 original specification; #2 historical Slice 4 | Existing Department reads do not establish complete membership management. Distinguish Department membership from work roles and Program enrolment. |
| Programs and Events management | #1 original specification; #2 historical Slice 5 | [#12](https://github.com/Noahlw/efcc-system/issues/12) provides personal participation/invitation context, not management delivery. |
| Program enrolment, waitlists and invitations | #1 original specification; #2 historical Slice 6 | #12 is existing personal-read context. Program capacity owns enrolment; Event does not have a separate enrolment cap. |
| Event attendance and bounded Care | #1 original specification; #2 historical Slice 7 | Keep Care within the agreed Attendance scope; the QR mechanism remains a planning question. |
| Scoped notices, Home surfacing and agreed notifications | #1 original specification; #2 historical Slice 8; retain the [O06-B decision](https://github.com/Noahlw/efcc-system/issues/106#issuecomment-6269637121) | [#13](https://github.com/Noahlw/efcc-system/issues/13) is scoped notice-read context; [#18](https://github.com/Noahlw/efcc-system/issues/18) is the application-outcome Inbox. Neither is the full notification feature. |
| Email verification and self-service recovery | #1 original specification; [#6](https://github.com/Noahlw/efcc-system/issues/6), [#21](https://github.com/Noahlw/efcc-system/issues/21), [#22](https://github.com/Noahlw/efcc-system/issues/22) | This feature remains Deferred. #6 is research; #21/#22 retain their closed, not-planned history. Do not infer a provider or release-policy decision. |

Home changes follow the feature that owns the data or behavior. Care remains within Attendance. These groupings do not set implementation order. Existing Access work (#8 and #4, with #9–#15) and Application/Membership lifecycle work (#7, with #17–#26) provide delivered or partial context; they do not prove the future feature areas above are complete.

## Retained review and design work

- [#162 — J16 recovery UI](https://github.com/Noahlw/efcc-system/issues/162) owns the complete J16 error, unavailable, denied and sign-out recovery presentation. Review its current route/state scope before changing these screens.
- [#163 — J09 Reset/Reissue redesign](https://github.com/Noahlw/efcc-system/issues/163) remains Deferred and owns the full staff recovery journey. Preserve automatic result checks, manual credential commands and existing safety checks; a copy change or partial screen is not completion.
- [#86 — macOS Native RPC teardown investigation](https://github.com/Noahlw/efcc-system/issues/86) retains its separate engineering scope.
- The [whole-UI framework migration deferral](https://github.com/Noahlw/efcc-system/issues/1#issuecomment-6292141012) remains separate from #162 and #163.
- [#106 Foundation acceptance and landing record](https://github.com/Noahlw/efcc-system/issues/106#issuecomment-6346979469) remains the authority for its pending gates. Do not treat feature mapping or technical evidence as those gates' acceptance.

Each retained ticket keeps its own current contract and completion rules. Linking it here does not reopen, reparent or activate it.

## v1 feature handoffs

These conventions apply to the proposed v1 feature parents when their publication and work are authorized. For those parents, same-issue specification and local progress updates replace the generic create-new-spec and shared-map progress defaults. Follow the repository's normal issue and PR procedures for all other work.

- Keep one feature issue ID through baseline, full specification, delivery tasks and full-feature completion. An unapproved baseline has no spec revision or implementation readiness. Bind `to-spec`, `to-tickets` and full-feature `implement-spec` to that issue and the applicable approved version; verify the target on readback instead of creating a duplicate. Each stage requires its own invocation and applicable authorization. Keep existing separate authorities such as #29 separate.
- When a detailed contract is approved, record its revision, date and decision links in that feature issue. Task and PR descriptions identify the relevant issue, contract version and applicable decisions using the existing PR structure.
- The feature owner reflects approved material requirement changes in the current issue body, links the source decision and marks proposals as unresolved. Reconcile only affected tasks and evidence; preserve valid unaffected work.
- One coordinator maintains shared v1 scope, navigation and cross-feature relationships. Authors maintain their own issues, PRs and affected docs; routine progress does not require rewriting #1.
- An authorized partial-delivery closure targets only its completed task or phase. Full-parent closure requires the entire approved contract, required evidence and applicable acceptance. Before relying on merge auto-close, verify its repository setting read-only; the authorized merge handoff reads back actual source and issue state. Preserve #1, #29, #106 and separate programme/release gates as their own authorities.

## Retiring this guide

When #1 no longer serves as the active v1 project route, first ensure continuing product constraints have an appropriate spec, ADR or issue owner. Then remove this folder, the v1-context pointer in [AGENTS.md](../../../AGENTS.md) and the #1 Roadmap sentence in [README.md](../../../README.md). Generic development guides remain unchanged. Keep original specifications, decisions, ADRs, Foundation evidence and pending acceptance gates with their own authorities. Any change to GitHub records or relationships requires separate authorization.
