# EFCC System

Church-management application for 中國基督教播道會顯恩堂 (internal use only).

The Access foundation is qualified for local Worker/D1/browser acceptance. The single Slice 2 development candidate adds public self-application, Staff application decisions and private decision/audit reads in [PR27](https://github.com/Noahlw/efcc-system/pull/27), based on unmerged PR16; it is not a release. Active feature issues remain open until separately authorised. Deployment and remote resources are not configured. “Internal” describes the audience, not repository visibility.

## Implemented foundation and account-lifecycle boundaries

- **Runtime:** one vinext-owned Worker on `vite dev` (workerd) with the local D1 binding `DB`, configured by `wrangler.jsonc` (Cloudflare Vite plugin v1 path, no beta `cf` config). The request guard uses the App Router `proxy` convention in `src/proxy.ts`.
- **Authentication (`/api/auth`):** Better Auth with the Drizzle adapter, the Username plugin and database-backed rate limiting. The App Router handler in `src/app/api/auth/[...all]/route.ts` allows only the implemented method/path pairs from `src/server/auth/allowlist.ts` (Username sign-in, full-Chinese-name sign-in, get-session, sign-out); every other native entry returns 404. Better Auth keeps its native protocol, including cookie and origin/CSRF behaviour.
- **Browser auth composition (#48):** each interactive consumer creates a transport-only Better Auth client (`src/features/auth/client.ts`), with no session hook/cache or automatic retry. Username and sign-out use native methods; the custom EFCC name endpoint uses the same client's `$fetch` because no built-in name method exists. Native HTTP status and temporary-password error codes remain authoritative. Auth credential-proof/current-revision reads use central Drizzle builders; timestamp columns decode to `Date`, preserving the stored second-resolution expiry boundary.
- **Name sign-in:** the namespaced native plugin endpoint `POST /api/auth/sign-in/name` (`src/server/auth/plugins/name-sign-in.ts`) resolves exactly one credential-bearing account from the full Chinese name and then calls the public Username sign-in API, so password verification, session creation and cookie semantics stay owned by the Username plugin. Matching keys live in `person_profile.name_lookup_key` (non-unique) and are produced by `canonicalNameKey` (`src/features/identity/name-matching.ts`): trim, full-width→half-width and Latin case-insensitivity, with Traditional/Simplified forms, internal whitespace, compatibility characters and non-Latin case kept distinct. Ambiguity returns `409 NAME_AMBIGUOUS` with no account list; both sign-in entries share the D1-backed limiter on their own buckets. The limiter trusts only Cloudflare's `cf-connecting-ip`; caller-supplied forwarding headers never influence buckets or session records.
- **Business API (`/api/v2`):** Hono with typed `error.code`/`error.message` JSON and one generic unexpected-error handler. Chained routes export `AppType`, with Hono’s native `ApplyGlobalResponse` covering global 404/500 bodies; `tests/types/business-api.ts` proves the native `hc<AppType>` consumer during typecheck. Requests are delegated from `src/app/api/v2/[[...route]]/route.ts`. Identity is derived from the validated session, never from client input.
- **Guard:** `src/proxy.ts` uses response-capable Better Auth session resolution (90-day idle window, `updateAge: 0`, cookie cache off), forwards renewal cookies and injects the validated user and exact native session identifiers; client-supplied decision headers are discarded. Protected HTML/RSC/API requests renew consistently, while RSC reads never own renewal. Anonymous pages redirect to sign-in with the exact authentication-required reason. A guard failure returns the typed API 500 or the generic unavailable surface with an exact delivered protected-page retry destination, never a signed-out or successful-access fallback. Native auth endpoints keep their own cookie protocol.
- **Session truthfulness:** personalised HTML/RSC/API responses are `no-store`. Sign-out reports success only from the native endpoint; a lost response is settled by an authoritative `get-session` recheck rather than a false success or an active-session claim. A browser-history restore is hidden synchronously and revalidated with a full-document request (`pagehide`/`pageshow` → conceal → `location.reload()`), never trusted from the snapshot.
- **Query recovery:** the document-scoped QueryProvider isolates browser documents and server renders. Uncertain sign-out retains its explicit fresh `get-session` read through Query, caching only a boolean verdict, never the session payload; a failed read is not signed-out success. Confirmed exit clears private Query state before hiding the document and replacing its URL.
- **Access policy:** `src/server/auth/access.ts` separates authentication from EFCC membership/security state in `person_profile` (`pending`/`active`/`deactivated` plus an independent ban). Only the exact active, unbanned state grants church-business access; removing a ban never reactivates membership. Restricted people authenticate to `/status` and may read only their own application and private decision inbox through `/application`, `/inbox` and their session-bound API projections. These lifecycle reads do not grant Home, participation, notice or Staff access.
- **Central schema:** `src/server/db/client.ts` composes auth, identity, account-application, activity and notice domains for the shared D1 client. Better Auth retains its narrower native table mapping.
- **Feature reads:** `src/features/identity/queries.ts` reads Drizzle directly from the Worker; Home renders on the server and never calls its own HTTP API.
- **Home projection:** `src/features/home/queries.ts` reads the session person's enrolments, Programs, Departments, upcoming Events and valid invitations through Drizzle with database-side ownership/visibility predicates. Approved participation lists upcoming occurrences globally ordered by start time across Programs, each retaining its Program/Department context; pending/waitlisted enrolments are labelled as unconfirmed; a valid enrolment without a next occurrence stays visible; rejected/withdrawn/cancelled/past rows and expired or revoked invitations are excluded. Church Time (`src/shared/time/church-time.ts`) formats Asia/Hong_Kong in 24-hour form.
- **Notices:** `src/features/home/notices.ts` reads published, unexpired notices for the session person with database-side scope checks: church-wide notices reach everyone, Department notices reach current Department members and assigned Department Managers (membership not required), and Program notices reach people whose enrolment is still current (approved, pending or waitlisted) plus assigned managers of the owning Department. Ordinary Department membership alone never grants descendant Program-notice visibility. A withdrawn, rejected or cancelled enrolment grants no Program-notice scope on the next request. Home renders notices read-only with their scope label; withdrawal of an assignment removes only the notice visibility it granted. There is no authoring, assignment or read-state workflow in this slice.
- **Member root reads (#52):** `/`, `/inbox` and `/account` render from direct authorised server reads — Home's Drizzle participation/notice projections, the Inbox's private decision projection and the Account's own identity through session-scoped central builders. These roots add no browser query, loopback request or hydrated duplicate copy; a member projection never selects internal notes, another person's rows or an unvalidated session.
- **Primary navigation:** `src/app/primary-navigation.tsx` exposes only delivered, authorised destinations with a labelled `nav`, current-page marker and 44px targets. Home requires membership access; application, inbox and status remain available to restricted authenticated people. Staff review/audit links require current Staff/Admin eligibility. `src/shared/protected-pages.ts` owns exact permitted retry destinations; the proxy matcher remains a literal list for framework analysis.
- **Self-application (Slice 2 T01):** `/apply` posts validated contact, full-name, Username and password data to the narrow `POST /api/v2/applications` boundary. A single D1 batch creates the configured Better Auth credential, Pending `person_profile`, canonical name key, minimal account audit, retained application record, operation receipt and permanent Username reservation; it never creates a session or exposes a general native signup endpoint. Username/email/phone constraints arbitrate concurrent attempts, and insert constraints roll back incomplete profile/audit/application writes.
- **Lost application responses:** a 256-bit browser capability is the only self-application value retained in local storage. `POST /api/v2/applications/reconcile` reveals the original Pending/not-found receipt even after a later membership decision; matching retries never create another account or store password plaintext. Current application state is read only after native sign-in. Email remains unverified contact data; verification, email sign-in, reset, resend and mail routes remain unavailable.
- **Application decisions (Slice 2 T02, #59):** `src/features/account/decisions.ts` approves or rejects a current Pending application through one D1 batch assembled from schema-bound Drizzle builders. The conditional transition checks the exact current native session, active/unbanned Staff/Admin authority and target eligibility at write time. Membership, application state, business audit and immutable decision receipt commit together; the receipt assertion remains the last batch item and the final completeness trigger also rejects ignored required profile/audit writes. Rejection requires a separate applicant-visible reason, and the request/form rules live in the client-safe Zod contract `src/features/account/decision-contract.ts`.
- **Private inbox and read-only audit (#59):** `/inbox` derives only the session person's decision outcomes and visible reasons from immutable decision records with a current-session predicate; internal notes never enter applicant projections. `/staff/account-audit` re-checks current Staff/Admin authority inside its own Drizzle read and retains actor/time/target/action identifiers plus optional internal notes for authorised viewers. Historical identifiers have no cascading auth foreign keys, and decisions cannot be updated or purged. A prior approval record is not a claim about current membership/security access.
- **Decision recovery (#59):** the review UI submits and reconciles through the typed `hc<AppType>` client inside TanStack Mutation (no automatic retry/replay; the expected-actor header travels per request) and persists only operation key, actor identifier, application identifier and outcome — never reason/note/password/session content. The reviewed values are frozen into the submission body before one explicit final submit. A native browser lock protects unresolved operation metadata across tabs; matching retries and authoritative reconciliation recover committed decisions after lost responses, reload and Worker restart without another business effect. Another signed-in actor cannot overwrite or clear the original actor's unresolved operation. Terminal application ids cannot be reopened; resubmission must append a new record.
- **Account security (Slice 2 T03, #51):** `/account` remains available to restricted holders and uses the configured native password verifier. Credential/session reads and the operation lookup are schema-bound builders with the exact session, provider, account-id and credential-revision predicates. The password-change batch asserts the current session and revision, advances the revision, clears any temporary password, preserves the current native session, revokes every other session and writes the audit/receipt through central Drizzle builders; the receipt completeness trigger still rolls back ignored effects. Password change, other-session revocation and the ten-minute session-bound confirmation post through the typed Hono client with the page's expected-actor header under a no-retry mutation; the rows/inputs of each editing task are owned by one shared Form, and the confirmation dialog returns to the caller's review before any explicit submit. A lost response keeps its original operation reference and is settled only by a fresh reconciliation read. Browser recovery stores operation metadata only — never passwords — and the deferred email/per-device management surfaces remain unavailable.
- **Assisted accounts (Slice 2 T04):** `/staff/accounts` reuses canonical creation and configured native hashing for approved accounts, password reset and explicit reissue. Current eligible Staff/Admin authority and a ten-minute session-bound password confirmation are checked at the mutation boundary. Generated temporary passwords expire after seven days, force first change and are returned only on the first committed response for private manual handover; receipts never replay plaintext. Recovery advances the credential revision and revokes target sessions without clearing bans or deactivation. Face-to-face shared-phone exceptions and pre-existing verified recovery phones remain distinct from editable contact data. A final batch receipt assertion rolls back ignored receipt writes across all account writers.
- **Applicant maintenance (Slice 2 T07):** `/application` permits never-approved members to correct name/email/unique phone, withdraw Pending applications and append a resubmission on the same account. Durable approval and assisted-creation history prevent deactivated members from regaining applicant privileges. Username claims and decisions remain retained; changed email loses verification. A D1 batch checks the current session, eligibility and latest application before writing, then asserts complete identity/state/audit/receipt effects. Append-only D1 ordering keeps current state independent of timestamp ties without inventing future submission times. Browser recovery retains only actor/action/application/key metadata.
- **Identity maintenance (Slice 2 T08, #56):** approved holders update only their unique phone through `/account?task=phone`; `/staff/accounts?task=identity` provides current authorised Staff/Admin with verified identity and recorded shared-phone corrections. One live TanStack Form owns the edit values per task and freezes an immutable review snapshot from the same existing field defaults; the ten-minute session-bound password confirmation stays composed from #51. Both commands post through the typed `hc<AppType>` client with the page's expected-actor header inside a no-retry/no-replay Mutation, and only `action`/`actorUserId`/`key`/`targetUserId` are retained for reconciliation. `src/features/account/account-guards.ts` now owns the shared sensitive Staff assertion plus audit/receipt guard (`sensitiveStaffAssertion`, `recordAccountChange`, `findAccountChange`) as lazy Drizzle batch items for the identity, restriction and deletion writers, reusing the shared `canonicalNameKey` name key; the native statement pair now has no production consumer and #60 contracts it after tracing consumers. Native name/Username lookups and display forms change together, existing permanent Username reservation triggers are reused, and email changes lose verification without mail work. Editable contacts never overwrite the separate trusted recovery channel. Initial authority/snapshot assertions and final identity/audit/receipt assertions run in the one ordered D1 batch; a lost response stays UNKNOWN until the original actor reconciles the original operation.
- **Eligible deletion (Slice 2 T11, #58):** `/staff/accounts?task=deletion` keeps the same reviewed destruction checkbox, then reuses #51's ten-minute session-bound password confirmation in-task before the one explicit final submit; the checkbox, review and dirty-return protection are owned by one TanStack Form. The delete command posts through the typed `hc<AppType>` client with the page's expected-actor header inside a no-retry/no-replay Mutation, and only `action`/`actorUserId`/`key`/`targetUserId` are retained for reconciliation. `src/features/account/deletion.ts` writes through the shared `sensitiveStaffAssertion`/`recordAccountChange` Drizzle batch contract — authority assertion, current-state and stored-history snapshot assertion, schema-bound `DELETE FROM user`, required audit/receipt writes and the final no-half-deleted assertion — so native identity/credentials/sessions disappear together with their retained claims/history/receipts or not at all. `deletion-contract.ts` owns the client-safe request/local-metadata/receipt Zod shapes. A lost response stays UNKNOWN and is only settled by the original actor's fresh reconciliation, including after the target has left the roster; roster absence never claims success or auto-selects another account.
- **Staff authority:** `person_profile.account_role` has fixed `member`/`staff`/`admin` values, defaulting to member. Department Manager assignment does not imply church-wide account management. Ordinary Staff cannot manage self, Staff or Admin; routine approval does not require sensitive-action password confirmation. No role-assignment UI is introduced. Any production Staff/Admin bootstrap needs separately authorised operator-controlled provisioning; local fixtures are not a production role migration.
- **Candidate check workflow:** `.github/workflows/checks.yml` gates pull requests and pushes to `main` on lint/format checks (`pnpm check`), typecheck (`pnpm typecheck`) and unit tests (`pnpm test`, Vitest), using pinned Node/pnpm versions. Worker/D1 browser acceptance and production build remain available as local commands.
- **Unit discovery:** Vitest collects `tests/worker/**/*.test.ts`, `tests/ui/**/*.test.tsx` and `tests/shared/**/*.test.ts`, including Church Time. `tests/types/business-api.ts` remains a compile-only contract, not a runtime test.
- **Shared UI:** `src/components/ui` holds the light-theme Base UI primitives (17px body text, 44px targets and visible focus). Lifecycle pages reuse native labelled forms, fresh status rechecks and history-restore revalidation. `src/components/unavailable-view.tsx` uses an exact protected retry destination and native GET form; denied and unavailable states never expose partial private content.
- **Shared Form composition:** `src/components/ui/app-form.tsx` binds `createFormHookContexts`/`createFormHook` to the existing Base UI text fields, labels, descriptions, errors and submit controls. SignInForm is the first consumer; `useAppForm`, `withForm` and `withFieldGroup` let later tickets share one live form owner. Field validators and payload normalization remain feature-owned. Existing primitives and unmigrated Form/request owners remain compatible until their ticket cutover. Native status revalidation, retry GET forms and input-free actions do not manufacture editing state or browser queries.
- **Synthetic setup:** `src/app/api/internal/test-setup/route.ts` creates disposable local accounts through Better Auth's trusted server API and upserts the Department/Program/Event/enrolment/invitation fixtures the tests need. It returns 404 unless the `SEED_TOKEN` from the gitignored `.dev.vars` is presented, and it is never part of committed Worker configuration.

### Local acceptance

```bash
cp .dev.vars.example .dev.vars   # set local secret/token; keep the :5199 origin
pnpm db:reset:local              # recreate the local D1 schema
pnpm dev --port 5199             # matches the example trusted origin
pnpm test                        # Vitest contract tests
pnpm test:e2e                    # resets local D1 and runs the Playwright suite
pnpm check                       # Ultracite lint/format checks
pnpm typecheck                   # wrangler types && tsc --noEmit
pnpm build                       # production Worker build
```

Local D1 state lives in `.wrangler/state/v3/d1`; migrations are generated into `migrations/` from `src/server/db/schema` and applied with `pnpm db:migrate:local`. Resolved local runtime versions are recorded as workerd `1.20260930.2` and Miniflare `5.20260930.0-alpha` (Wrangler `4.145.0`, Vite `8.3.2`, vinext `1.0.0`, Better Auth `1.7.7`, Drizzle ORM `0.45.3`). `wrangler types` generates the Worker binding/runtime declarations in the ignored `worker-configuration.d.ts`; Wrangler `4.145.0` reports that this supersedes the standalone `@cloudflare/workers-types` package, so the generated runtime types are the typecheck source.

The API-only subprocess in `tests/e2e/zz-worker-faults.spec.ts` overrides Wrangler's production `dist/client` assets path with an empty temporary directory and removes it after shutdown. The fault regression therefore runs from a fresh checkout without `pnpm build`; the production assets configuration is unchanged.

This is a fresh rebuild, not an import or upgrade of production data. `0000_access_foundation.sql` establishes the foundation; `0001_account_application.sql` adds contact constraints, permanent Username claims and self-applications; `0002_application_decisions.sql` adds fixed account roles, Approved state, immutable decisions and atomic-write guards. Review generated rebuild copies and preserve custom creation/decision/terminal-state triggers in later migrations. Local acceptance uses disposable D1; no production migration rehearsal is claimed.

### Final qualification scope

The locked candidate stack includes Node `24.21.0` / pnpm `10.33.2`, React/React DOM/React Server Components `19.3.0`, Vite `8.3.2`, vinext `1.0.0`, Cloudflare Vite plugin `1.62.3`, Wrangler `4.145.0`, Better Auth `1.7.7`, Drizzle ORM/Kit `0.45.3` / `0.31.11`, Hono `4.13.12`, Zod `4.6.5`, TanStack Form `1.33.5`, Tailwind `4.3.3`, Base UI `1.8.0`, Vitest `5.0.3`, Playwright `1.63.0`, TypeScript `7.0.2`, and webpack `5.105.4` for the required RSC peer.

Desktop and browser acceptance ran on Chromium Headless Shell `153.0.8010.12`. Phone coverage is explicitly **emulation only**: CSS viewport `412 × 915`, DPR `2.625`, touch/mobile flags, Pixel 7 / Android 14 user-agent string. Automated checks cover 17px body text, 44px control targets, representative AA color pairs, keyboard focus, paste/autocomplete, loading, rate limiting, session loss, empty/denied/unavailable outcomes, and the complete login/status/sign-out paths. No physical Android device or one-handed usability session was available, so emulation is not reported as physical-device evidence.

The worker-fault and guard-fault specs deliberately damage and restore disposable local D1 objects (`program_event`, the `person_profile` column name, the `session` table) to exercise the generic unavailable state, the shared retry surface and the typed API error at real Worker/D1 boundaries. The membership regressions also inject an unsupported membership value through the per-connection `PRAGMA ignore_check_constraints` seam to prove fail-closed behaviour, not legacy-data migration. These are labelled injected local failures, not simulation or proof of a Cloudflare production outage.

Foundation qualification on macOS arm64 passed `pnpm check`, `pnpm typecheck`, `pnpm test` (5 tests), `pnpm build` and `pnpm test:e2e` on the pinned tooling. The build's vinext code-splitting notices do not prevent the Worker build. Each subsequent lifecycle ticket records its own revision, failure/race/browser evidence and review separately; foundation results do not qualify later credential-reset/deletion operations, deferred email, production CDN behaviour or release acceptance.

## Folder structure

```text
src/
├── app/                 # Pages, layouts and thin API entry points
├── features/            # Feature-owned contracts, queries, UI and operations
│   ├── account/
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

Slice 1 Home reads Drizzle through authorised server-side feature queries and renders on the server, without an HTTP loopback to its own API. TanStack Query owns the explicit uncertain-sign-out verdict read; Home does not introduce a duplicate client-owned data cache.

Sign-in accepts username and full Chinese name only, following the owner's Slice 1 grilling correction on 1 October 2026 and complete Revision 4 confirmation on 2 October 2026. The canonical issues and [Access foundation specification](https://github.com/Noahlw/efcc-system/issues/8) reflect this policy; email verification and recovery remain separate account-lifecycle requirements. Better Auth's Username plugin owns username/password sign-in, and Chinese-name sign-in must reuse Better Auth's credential verification rather than introduce another verifier. Removing email sign-in from the UI alone is insufficient: its public auth endpoint must also be blocked.

Business API errors under `/api/v2` use a consistent typed JSON shape with `error.code` and `error.message` plus the appropriate HTTP status. Expected failures are explicit responses; one global handler handles unexpected exceptions with a generic response. Better Auth `/api/auth` retains its native protocol.

Sign-in rate limiting uses Better Auth's database storage rather than per-instance memory. Both public sign-in paths must be protected, including full-Chinese-name lookup, and the local acceptance environment explicitly enables the limiter. Limits are tuned with measured shared-IP scenarios; D1 behaviour and bypass resistance remain proof gates. No account lockout is introduced.

Session idle expiry is 90 days from the last valid session use, not an interval-based approximation. The selected Better Auth policy refreshes on every use (`updateAge: 0`), with cookie session caching disabled and database-backed session and business-access checks on each protected request. Cookie renewal, next-request revocation and D1 read/write cost require proof on the pinned runtime; no custom session engine is introduced.

The renewal seam is an uncached, response-capable vinext request guard before protected page, status and business-API dispatch. It forwards Better Auth's returned Set-Cookie headers; RSC reads do not own renewal. Native auth endpoints keep their cookie handling, and the Next-specific cookie bridge is not selected. The local acceptance suite exercises full-page, RSC, status and API renewal; production caching remains unqualified.

## Libraries

Installed Slice 1 libraries are pinned in `package.json` and `pnpm-lock.yaml`; libraries listed for later slices are not installed until needed.

- Tooling: project pins pnpm 10.33.2 and Node.js 24.21.0 LTS in package metadata and `.nvmrc`; activate the project Node version before running commands
- Code quality: Oxlint, Oxfmt, Ultracite, Husky, lint-staged, commitlint
- Frontend: vinext 1.0.0 / App Router with Vite 8.3.2, React/React DOM 19.3.0, Tailwind CSS 4.3.3, shadcn/ui (Base UI primitives), TanStack Query, TanStack Form
- API: Hono, hono/client, Zod
- Testing: Vitest, Testing Library, Playwright; MSW for isolated presentation where appropriate

- Acceptance: real application pages with isolated seeded scenarios; no Storybook or component catalogue
- Database: Drizzle ORM, Drizzle Kit, Cloudflare D1
- Auth: Better Auth 1.7.7 with its Drizzle adapter and Username plugin; a namespaced plugin endpoint owns full-Chinese-name sign-in

The public application is the reference integration for the installed form and request libraries: shared components wrap TanStack Form, client-safe account schemas live in `application-contract.ts`, and `business-rpc.ts` binds Hono RPC to the server route type without importing its runtime. Submission is a no-retry mutation; only status reconciliation uses a fresh TanStack Query read. The write remains server-owned in the account service, using a Drizzle D1 batch with an explicit required-application receipt.

Applicant correction, withdrawal and resubmission reuse that seam for the signed-in applicant: one TanStack Form owns the edit fields with a frozen review payload, `/api/v2/applications/actions` and its reconciliation are typed RPC calls that carry `x-efcc-expected-actor-id` per request from the document's original actor, and the eligibility, approval-history, target-ownership and contact-conflict predicates stay in one Drizzle D1 batch whose receipts must commit or roll back together. Applicant reads and receipts never select Staff notes.

## External Service

- Cloudflare Workers — application runtime and hosting
- Cloudflare D1 — one database per environment
- Selected stable tooling path: Cloudflare Vite plugin 1.62.3 + Wrangler 4.145.0, with `wrangler.jsonc`; no `cf` beta config path

vinext owns the main Worker. Thin App Router API handlers delegate to Hono and Better Auth directly using Web Request/Response, while Home reads authorised feature queries directly. The implemented stack has passed local build/workerd/browser qualification; remote resources and deployment remain out of scope.

For Slice 1, the public auth handler only allows the selected Username/name POST paths, get-session GET and sign-out POST. Other auth paths/methods return 404 until their slice implements the required policy; trusted server APIs remain available for synthetic setup.

Slice 1 supplies the light-theme Username/full-Chinese-name sign-in and read-only personal Home projection. Programs/Events, current participation, valid invitations and authorised notices retain their foundation rules. Slice 2 extends restricted status with only delivered own-application/inbox reads and adds authorised Staff review/audit screens; it does not expose future business actions. Failure feedback distinguishes denied, conflict, rate-limited, unavailable and unconfirmed results; neither an unknown sign-out nor an unknown decision is reported as successful.

Staff account restrictions keep membership deactivation and safety bans independent. Native sign-in remains available so restricted holders can read status and use permitted security actions; every protected request reads current D1 state. Changes require a current privileged session and recent password confirmation, retain an immutable audit/receipt, and cannot remove the last effective Admin. Existing sessions are not a condition for counting another effective Admin. `/staff/accounts?task=restrictions` keeps the four explicit ban/unban/deactivate/reactivate operations with their review, dirty protection and the shared session-bound confirmation, posts through the typed `hc<AppType>` client inside a no-retry Mutation, and writes through the shared Drizzle guard/receipt batch (`src/features/account/restrictions.ts`, `restriction-contract.ts`). No role-management surface or new permission cache is introduced.

Eligible Staff deletion removes the live native identity, credentials and sessions together with a retained deletion audit/receipt. Application, decision and security history and every Username claim survive. Any stored enrolment, invitation, department membership or manager assignment blocks hard deletion; use deactivation instead. The reviewed action reuses the shared in-task password confirmation and the typed client/Query recovery; the delete and its audit/receipt effects commit or roll back in one ordered D1 batch. Lost-response lookup remains available when the deleted target has left the account roster.

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
