# EFCC System

Church-management application on Cloudflare Workers/D1, built with vinext and React.

## Folder structure

| Location | Responsibility |
| --- | --- |
| `src/app/` | Pages and thin framework entry points |
| `src/features/` | Domain behavior and UI; account capabilities have separate owners and small shared leaves |
| `src/server/` | Auth, API and database composition |
| `src/components/`, `src/shared/` | Shared UI and application utilities |
| `tests/` | Independent E2E, Node/SSR, tooling, Worker and type-contract tests |
| `scripts/` | Local qualification, source selection and build adapters |
| `docs/` | [ADRs](docs/adr/), [testing workflow](docs/testing.md), agent guides and the runnable [Design Book](docs/design/slice-1-2-ui/README.md) |

Use [GLOSSARY.md](GLOSSARY.md) for domain terms and [AGENTS.md](AGENTS.md) for repository instructions.

Contributors should start with [CONTRIBUTING.md](CONTRIBUTING.md), which links to the shared [pull request delivery contract](docs/agents/pull-request-contract.md).

## Libraries

React/vinext, Hono, Better Auth, Drizzle, Zod and TanStack own their application concerns. Wrangler Test Harness, Playwright, Vitest and Turbo own the testing/runtime/build primitives. Pinned dependencies live in `package.json` and `pnpm-lock.yaml`.

## External Service

Cloudflare Workers runs the application; D1 stores its data. Local tests use owned synthetic stores and credentials. Keep personal vars, member records and saved sessions out of Git.

## Distributions

Use the Node version in `.nvmrc` and pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile --prefer-offline
cp .dev.vars.example .dev.vars
pnpm dev
```

Replace placeholders with synthetic local values. Developer migrations/reset affect developer D1; they are not test setup. [Testing](docs/testing.md) documents exact-staged commit checks, explicit affected feedback and complete local qualification. Every commit retains formatting/lint/runtime boundaries, project typecheck and fast contracts; builds/Native/coverage/mutation belong to delivery qualification. GitHub CI retains actionlint, project checks and complete Node coverage, not Native attestation. Every PR needs current source/base-bound evidence before Ready/merge. Deployment requires separate authorization.

## Roadmap

For v1 scope and planned features, see [project overview #1](https://github.com/Noahlw/efcc-system/issues/1).
