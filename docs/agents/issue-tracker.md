# Issue tracker: GitHub

Issues and specs for `Noahlw/efcc-system` live in GitHub Issues. Use the `gh` CLI for tracker operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, including labels and relevant comments.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`, with appropriate label and state filters.
- **Comment**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Run inside this clone so `gh` resolves the repository from its remote; use `--repo Noahlw/efcc-system` when outside it. `.scratch/` holds working drafts and publication artifacts, not the authoritative issue tracker.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If explicitly enabled later, use the equivalent `gh pr` operations and the same triage-role mapping. Discovery includes external authors with association `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE`; an explicitly named PR is not subject to that discovery filter.

GitHub shares one number space across issues and PRs. Resolve an ambiguous number with `gh pr view <number>` and fall back to `gh issue view <number>`.

## Skill operations

- **Publish to the issue tracker**: create a GitHub issue.
- **Fetch the relevant ticket**: read the issue and comments.

## Wayfinding operations

- **Map**: one issue labelled `wayfinder:map`, containing Notes / Decisions-so-far / Fog.
- **Child ticket**: link it as a GitHub sub-issue. If unavailable, use a task list in the map and `Part of #<map>` in the child. Apply `wayfinder:<type>` (`research`, `prototype`, `grilling`, `task`).
- **Blocking**: use native GitHub issue dependencies. Add with `gh api --method POST repos/Noahlw/efcc-system/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Obtain the numeric database ID with `gh api repos/Noahlw/efcc-system/issues/<blocker> --jq .id`, not its issue number or node ID.
- **Fallback blocking**: if native dependencies are unavailable, use `Blocked by: #<n>` in the child. A ticket is unblocked only when every blocker is closed.
- **Frontier**: inspect open map children; skip claimed tickets and tickets with open blockers (`issue_dependencies_summary.blocked_by > 0`, or the fallback references). Choose the first eligible ticket in map order.
- **Claim**: assign the ticket with `gh issue edit <number> --add-assignee @me`.
- **Resolve**: post the result, close the ticket and add a gist/link to the map's Decisions-so-far.
