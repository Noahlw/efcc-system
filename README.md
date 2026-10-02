# EFCC System

Church-management application for 中國基督教播道會顯恩堂 (internal use only).

The structure and application libraries below describe the target architecture. Slice 1 (the access foundation) is implemented for local Worker/D1/browser acceptance; deployment and remote resources are not configured. “Internal” describes the audience, not repository visibility.

## Slice 1: implemented boundaries

- **Runtime:** one vinext-owned Worker on `vite dev` (workerd) with the local D1 binding `DB`, configured by `wrangler.jsonc` (Cloudflare Vite plugin v1 path, no beta `cf` config). The request guard uses the App Router `proxy` convention in `src/proxy.ts`.
- **Authentication (`/api/auth`):** Better Auth with the Drizzle adapter, the Username plugin and database-backed rate limiting. The App Router handler in `src/app/api/auth/[...all]/route.ts` allows only the implemented method/path pairs from `src/server/auth/allowlist.ts` (Username sign-in, full-Chinese-name sign-in, get-session, sign-out); every other native entry returns 404. Better Auth keeps its native protocol, including cookie and origin/CSRF behaviour.
- **Name sign-in:** the namespaced native plugin endpoint `POST /api/auth/sign-in/name` (`src/server/auth/plugins/name-sign-in.ts`) resolves exactly one credential-bearing account from the full Chinese name and then calls the public Username sign-in API, so password verification, session creation and cookie semantics stay owned by the Username plugin. Matching keys live in `person_profile.name_lookup_key` (non-unique) and are produced by `canonicalNameKey` (`src/features/identity/name-matching.ts`): trim, full-width→half-width and Latin case-insensitivity, with Traditional and Simplified forms kept distinct. Ambiguity returns `409 NAME_AMBIGUOUS` with no account list; both sign-in entries share the D1-backed limiter on their own buckets.
- **Business API (`/api/v2`):** Hono with typed `error.code`/`error.message` JSON and one generic unexpected-error handler, delegated from `src/app/api/v2/[[...route]]/route.ts`. Identity is derived from the validated session, never from client input.
- **Guard:** `src/proxy.ts` resolves the session with a response-capable Better Auth call (90-day idle window, `updateAge: 0`, cookie cache off), renews on every valid use, forwards Better Auth's `Set-Cookie` values, and injects the authoritative access decision for the request. Native auth endpoints never pass through it. Full-page, RSC, refresh, status and business-API requests all renew the persisted D1 expiry and the browser cookie; RSC readers only read and never own a refresh write.
- **Session truthfulness:** personalised HTML/RSC/API responses are `no-store`. Sign-out reports success only from the native endpoint; a lost response is settled by an authoritative `get-session` recheck rather than a false success or an active-session claim, and a restored back/forward snapshot is revalidated (`pageshow` → refresh) instead of being trusted.
- **Access policy:** `src/server/auth/access.ts` separates authentication from EFCC membership/security state in `person_profile` (`pending`/`active`/`deactivated` plus an independent ban) using the shared rule in `src/features/identity/restrictions.ts`. Restricted people authenticate to `/status`, which lists every applicable restriction through `GET /api/v2/status`, and offers only recheck and sign-out; business pages and `/api/v2` reads fail closed. Removing a ban never reactivates membership.
- **Feature reads:** `src/features/identity/queries.ts` reads Drizzle directly from the Worker; Home renders on the server and never calls its own HTTP API.
- **Home projection:** `src/features/home/queries.ts` reads the session person's enrolments, Programs, Departments, upcoming Events and valid invitations through Drizzle with database-side ownership/visibility predicates. Approved participation lists upcoming occurrences ordered by start time with Program context; pending/waitlisted enrolments are labelled as unconfirmed; a valid enrolment without a next occurrence stays visible; rejected/withdrawn/cancelled/past rows and expired or revoked invitations are excluded. Church Time (`src/shared/time/church-time.ts`) formats Asia/Hong_Kong in 24-hour form.
- **Notices:** `src/features/home/notices.ts` reads published, unexpired notices for the session person with database-side scope checks: church-wide notices reach everyone, Department notices reach current Department members and assigned Department Managers (membership not required), and Program notices reach enrolled people plus the members and managers of the owning Department. Home renders them read-only with their scope label; withdrawal of an assignment removes only the notice visibility it granted. There is no authoring, assignment or read-state workflow in this slice.
- **Shared UI:** `src/components/ui` holds the Base UI-backed primitives (`button`, `input`, `field`) styled with the light semantic tokens in `src/app/globals.css` (17px body text, 44px targets, visible focus).
- **Synthetic setup:** `src/app/api/internal/test-setup/route.ts` creates disposable local accounts through Better Auth's trusted server API and upserts the Department/Program/Event/enrolment/invitation fixtures the tests need. It returns 404 unless the `SEED_TOKEN` from the gitignored `.dev.vars` is presented, and it is never part of committed Worker configuration.

### Local acceptance

```bash
cp .dev.vars.example .dev.vars   # then replace both values
pnpm db:reset:local              # recreate the local D1 schema
pnpm dev                         # vite dev on :5173 (or --port 5199)
pnpm test                        # Vitest contract tests
pnpm test:e2e                    # resets local D1 and runs the Playwright suite
pnpm typecheck                   # wrangler types && tsc --noEmit
pnpm build                       # production Worker build
```

Local D1 state lives in `.wrangler/state/v3/d1`; migrations are generated into `migrations/` from `src/server/db/schema` and applied with `pnpm db:migrate:local`. Resolved local runtime versions are recorded as workerd `1.20260930.2` and Miniflare `5.20260930.0-alpha` (Wrangler `4.145.0`, Vite `8.3.2`, vinext `1.0.0`, Better Auth `1.7.7`, Drizzle ORM `0.45.3`).

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
│   ├── care/
│   ├── notices/
│   ├── notifications/
│   └── audit/
├── components/
│   └── ui/              # Shared presentation primitives
├── server/
│   ├── api/             # Hono composition and request context
│   ├── auth/            # Better Auth integration and access checks
│   └── db/              # Database connection and schema composition
│       └── schema/      # Central schema ownership; files grouped by domain
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

Target ownership for the whole v1 application, not the current filesystem. Feature folders own contracts, queries, UI and operations; database schema ownership stays in `server/db/schema`, grouped by domain. Slice 1 introduces only the domain tables, relations and constraints needed for its accepted journeys; later slices extend them through reviewed migrations.

The documented tree includes future features. Create physical directories and files when needed; empty directories require no placeholder files and are not tracked by Git. Missing domain documents are not an error.

Slice 1 Home reads Drizzle through authorised server-side feature queries and renders on the server, without an HTTP loopback to its own API. TanStack Query remains selected for slices that need client refetching or mutation state; Home does not introduce a duplicate client-owned data cache by default. The runtime bridge remains subject to Worker/D1 qualification.

Sign-in accepts username and full Chinese name only, following the owner's Slice 1 grilling correction on 1 October 2026 and complete Revision 4 confirmation on 2 October 2026. The canonical issues and [Access foundation specification](https://github.com/Noahlw/efcc-system/issues/8) reflect this policy; email verification and recovery remain separate account-lifecycle requirements. Better Auth's Username plugin owns username/password sign-in, and Chinese-name sign-in must reuse Better Auth's credential verification rather than introduce another verifier. Removing email sign-in from the UI alone is insufficient: its public auth endpoint must also be blocked.

Business API errors under `/api/v2` use a consistent typed JSON shape with `error.code` and `error.message` plus the appropriate HTTP status. Expected failures are explicit responses; one global handler handles unexpected exceptions with a generic response. Better Auth `/api/auth` retains its native protocol. These are accepted foundation contracts, not implemented behaviour.

Sign-in rate limiting uses Better Auth's database storage rather than per-instance memory. Both public sign-in paths must be protected, including full-Chinese-name lookup, and the local acceptance environment explicitly enables the limiter. Limits are tuned with measured shared-IP scenarios; D1 behaviour and bypass resistance remain proof gates. No account lockout is introduced.

Session idle expiry is 90 days from the last valid session use, not an interval-based approximation. The selected Better Auth policy refreshes on every use (`updateAge: 0`), with cookie session caching disabled and database-backed session and business-access checks on each protected request. Cookie renewal, next-request revocation and D1 read/write cost require proof on the pinned runtime; no custom session engine is introduced.

The selected renewal seam is an uncached, response-capable vinext request guard before protected page, status and business-API dispatch. It forwards Better Auth's returned Set-Cookie headers; RSC reads do not own renewal. Native auth endpoints keep their cookie handling, and the Next-specific cookie bridge is not selected. Full-page and RSC navigation, status and API cookie propagation remain unproved until the pinned-stack acceptance run.

## Libraries

Planned stack; compatible versions are pinned and verified when introduced.

- Tooling: selected project pins pnpm 10.33.2 and Node.js 24.21.0 LTS for local tooling; the Node pin is not applied yet
- Code quality: Oxlint, Oxfmt, Ultracite, Husky, lint-staged, commitlint
- Frontend: vinext 1.0.0 / App Router with Vite 8.3.2, React/React DOM 19.3.0, Tailwind CSS 4.3.3, shadcn/ui (Base UI primitives), TanStack Query, TanStack Form
- API: Hono, hono/client, Zod
- Testing: Vitest, Testing Library, Playwright; MSW for isolated presentation where appropriate
- Acceptance: real application pages with isolated seeded scenarios; no Storybook or component catalogue
- Database: Drizzle ORM, Drizzle Kit, Cloudflare D1
- Auth: Better Auth 1.7.7 with its Drizzle adapter and Username plugin; a namespaced plugin endpoint owns full-Chinese-name sign-in

## External Service

- Cloudflare Workers — application runtime and hosting
- Cloudflare D1 — one database per environment
- Selected stable tooling path: Cloudflare Vite plugin 1.62.3 + Wrangler 4.145.0, with `wrangler.jsonc`; no `cf` beta config path

vinext owns the main Worker. Thin App Router API handlers delegate to Hono and Better Auth directly using Web Request/Response, while Home reads authorised feature queries directly. Selected versions and these boundaries still require install/build/workerd/browser qualification; no application dependencies or runtime configuration have been applied yet.

For Slice 1, the public auth handler only allows the selected Username/name POST paths, get-session GET and sign-out POST. Other auth paths/methods return 404 until their slice implements the required policy; trusted server APIs remain available for synthetic setup.

Slice 1 uses a new visual design with one light theme; the old EFCC POC is flow/feature reference. Sign-in explicitly switches between Username (default) and full Chinese name. Home groups read-only personal itinerary, invitations and eligible notices, with no unfinished business actions or destination links. Activity means Program/Event, without a separate entity. Program enrolments include clearly labelled Pending/waitlisted states; approved participation supplies upcoming Events, and a valid enrolment without a next Event remains visible. Inactive/past items, invalid invitations and unauthorised/unpublished/expired notices are excluded from this Home. Restricted accounts receive status-only UI with recheck and sign-out; failure feedback distinguishes empty, denied, rate-limited and unavailable states, and an unconfirmed sign-out is never reported as successful. These are accepted UI decisions, not implemented pages.

## Distributions

- Branch from current `main`
- Develop on a feature branch
- Submit a PR
- Squash-merge after review and remove the merged feature branch
- Merge is not deployment

## Roadmap

- [Rebuild map](https://github.com/Noahlw/efcc-system/issues/2)
- [Confirmed understanding](https://github.com/Noahlw/efcc-system/issues/1)
- [Access foundation delivery](https://github.com/Noahlw/efcc-system/issues/4) and [published specification](https://github.com/Noahlw/efcc-system/issues/8)

GitHub issues own accepted scope, dependencies and progress.
