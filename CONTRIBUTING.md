# Contributing to EFCC System

Use Node **24.21.0**, pnpm **10.33.2** and the checked-in lockfile. The [README](README.md) describes the project and setup; [AGENTS.md](AGENTS.md) provides repository instructions for coding agents.

Before opening a pull request, follow the shared [Pull Request Delivery Contract](docs/agents/pull-request-contract.md). It applies to human contributors, agents and bots. The contract defines the PR body, flexible UI Preview, evidence expectations and review responsibilities. The current commands and their boundaries are in the [Testing workflow](docs/testing.md).

GitHub CI is light and retains the complete Node suite coverage. Every PR, including bots and web-created changes, needs current source/base-bound local qualification before Ready or merge. Keep the pre-commit hook enabled for formatting/lint/runtime boundaries, complete project typecheck and fast contracts; follow the testing workflow for early affected checks and final qualification. Saving a commit does not establish delivery readiness.

Work from the relevant GitHub issue and its approved decisions. Use synthetic local data, keep personal credentials and saved sessions out of Git, and obtain separate authorization for deployment or remote-data actions. A passing CI result does not itself mean Owner acceptance or permission to merge.
