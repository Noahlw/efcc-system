# AGENTS.md

- Use pnpm for package management and Node.js for local tooling.
- Read the assigned GitHub issue and comments before work. Issues own planning and progress.
- Preserve existing work. Use synthetic data; never commit secrets, session state or member records.
- Work within the requested scope and report actual changes, checks and gaps. Deployment and remote-data actions require authorization.
- Develop on a feature branch and submit a reviewed PR. Squash-merge only when authorized.

### Issue tracker

Issues live in GitHub Issues (`Noahlw/efcc-system`), managed via the `gh` CLI.

### Domain docs

Single-context: root `CONTEXT.md` and `docs/adr/`, when present.
Follow `docs/agents/domain.md` when present; skip missing domain documents.
