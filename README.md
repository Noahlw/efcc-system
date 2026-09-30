# EFCC System

Church-management application for 中國基督教播道會顯恩堂 (internal use only).

The structure and libraries below describe the target architecture. The application, dependencies and live services are not configured yet. “Internal” describes the audience, not repository visibility.

## Folder structure

```text
src/
├── app/                 # Pages, layouts and thin API entry points
├── features/            # Feature-owned contracts, queries, UI and operations
│   ├── auth/
│   ├── identity/
│   ├── profile/
│   ├── home/
│   ├── departments/
│   ├── programs/
│   ├── scheduling/
│   ├── enrollment/
│   ├── attendance/      # Includes scanner journeys
│   └── audit/
├── components/
│   └── ui/              # Shared presentation primitives
├── server/
│   ├── api/             # Hono composition and request context
│   ├── auth/            # Better Auth integration and access checks
│   └── db/              # Drizzle configuration and schema
└── shared/
    └── time/            # Church Time helpers
migrations/              # Drizzle-generated, reviewed D1 schema changes
tests/
├── worker/              # Real Worker/D1 integration
├── e2e/                 # Real application browser journeys
└── scenarios/           # Synthetic fixtures
docs/
├── agents/              # Engineering-skills configuration
│   ├── issue-tracker.md
│   ├── triage-labels.md
│   └── domain.md
└── adr/                 # Architectural decisions, created when needed
CONTEXT.md               # Domain glossary, created when needed
README.md
AGENTS.md
package.json
.gitignore
```

Proposed single-application layout, not the current filesystem. Create files only when the accepted work needs them; missing domain documents are not an error.

## Libraries

Planned stack; compatible versions are pinned and verified when introduced.

- Tooling: pnpm, Node.js for local tooling
- Code quality: Oxlint, Oxfmt, Ultracite, Husky, lint-staged, commitlint
- Frontend: vinext / Next.js App Router, React, Tailwind CSS, shadcn/ui, TanStack Query, TanStack Form
- API: Hono, hono/client, Zod
- Testing: Vitest, Testing Library, Playwright; MSW for isolated presentation where appropriate
- Presentation: Storybook remains selected until an approved replacement
- Database: Drizzle ORM, Drizzle Kit, Cloudflare D1
- Auth: Better Auth with its Drizzle adapter

## External Service

- Cloudflare Workers — application runtime and hosting
- Cloudflare D1 — one database per environment

## Distributions

- Branch from current `main`
- Develop on a feature branch
- Submit a PR
- Squash-merge after review and remove the merged feature branch
- Merge is not deployment

## Roadmap

- [Rebuild map](https://github.com/Noahlw/efcc-system/issues/2)
- [Confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1)

GitHub issues own accepted scope, dependencies and progress.
