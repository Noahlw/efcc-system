# CI security and dependency policy

This repository uses GitHub Actions and GitHub-native security signals to make changes easier to review. These checks provide evidence; they do not replace the application’s Native qualification, independent review, or Owner gates.

## Pull request execution

- Workflows that execute pull-request code use the ordinary `pull_request` event and the least permissions they need. Do not pass repository secrets to jobs that execute pull-request-controlled code. GitHub withholds secrets from fork pull requests, but same-repository pull-request code must also be treated as untrusted. The repository-level default `GITHUB_TOKEN` permission is read-only, and workflows should declare their own narrower permissions.
- Do not use `pull_request_target` or `workflow_run` to check out or execute pull-request-controlled code. If a future workflow publishes a report with write permission, keep that publication job separate from code execution, validate the originating run and head SHA, and do not reuse caches written by an untrusted run.
- Pin third-party actions to reviewed full commit SHAs and keep the release tag in a same-line comment so Dependabot can propose reviewed pin updates.

## Security signals

- CodeQL default setup and GitHub secret scanning/push protection provide repository-level signals. Review the actual repository settings and run results; a configured service is not proof that every pull-request class was scanned. GitHub's default CodeQL setup excludes pull requests from forks.
- The Dependency Review workflow uses `pull_request`, which evaluates the pull-request merge commit. GitHub discovers workflow files from the commit associated with the event, so the workflow can run in the integration PR before this file reaches the default branch. Confirm the actual Actions run before describing the signal as active. Findings are advisory: this workflow uses `warn-only`, has no license allow/deny policy, and is not a required merge check. It does not write PR comments or edit the PR description. See GitHub's [workflow event reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) and [Dependency Review action setup](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action).
- These tools do not prove Worker or D1 runtime behavior, authorization correctness, migration safety, or Native qualification. Keep those checks at their existing boundaries.

## Dependency updates

- The configuration schedules npm and GitHub Actions updates weekly, with at most three open version-update pull requests per ecosystem. This cap applies to scheduled version updates, not security-update pull requests.
- Only routine development-tooling minor and patch updates and routine GitHub Actions minor and patch updates are grouped. Production dependencies, major updates, and other development dependencies remain individually attributable for review.
- Merge all update pull requests manually after the applicable CI and Native checks. Do not enable auto-merge.
- The checked-in configuration takes effect only after it reaches the default branch. Do not describe proposed configuration as an active scheduled service before then. Keep Dependabot security-fix pull-request automation disabled until the conservative default-branch configuration is active and its behavior has been read back.

## References

- [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [Dependency Review Action v5.0.0](https://github.com/actions/dependency-review-action/tree/v5.0.0)
