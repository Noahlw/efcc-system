# Issue tracker: GitHub

`Noahlw/efcc-system` uses GitHub Issues through `gh`. Read the assigned issue and comments before work. Issues own scope, decisions and progress; `.scratch/` contains temporary drafts and private publication material.

Use `--repo Noahlw/efcc-system` outside this checkout. GitHub shares issue/PR numbers: resolve an ambiguous number with `gh pr view`, then `gh issue view`. [Triage labels](triage-labels.md) maps the five triage roles to this repository's labels.

## Pull requests

PRs are not a general request-discovery surface. An explicitly assigned PR can be read or updated within the owner's authorization. If PR discovery is separately enabled, only external authors with association `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE` are discovery candidates; this filter does not restrict an explicitly named PR.

## Skill and wayfinding conventions

- Publishing a spec/task means creating a GitHub issue; fetching a ticket includes its comments.
- One map issue uses `wayfinder:map`, with Notes / Decisions-so-far / Fog.
- Use native sub-issues for children. Fallback: a map task list and `Part of #<map>` in the child. Child roles are `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` and `wayfinder:task`.
- Use native blocking dependencies, supplying the blocker's database ID (not issue number/node ID). Fallback: `Blocked by: #<n>` in the child. Eligibility requires all blockers closed; skip claimed tickets when selecting the map's next eligible child.
- Claim by assigning the ticket to the implementing agent's account. Record results in the existing issue and map. Closing issues or publishing other changes still requires the applicable authorization.

Keep multiline publication text in a temporary file and pass it with `--body-file`. Do not rewrite historical decisions to represent a later source or sign-off.
