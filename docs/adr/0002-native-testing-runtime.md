# Native built-app testing runtime

Authority: Spec #66 and ticket #67. This decision covers the runtime/provisioning boundary, not whole-suite qualification or downstream family migration.

## Ownership and contract

`tests/support/fixtures.ts` exports `NativeApp`, `openApp()` and Playwright `test`. Wrangler `createTestHarness` owns ephemeral ports, workerd, storage, listen/update/close and original D1 migration application. `NativeApp.db` is obtained from **the app** `getEnv().DB`; consumers use native D1 statements directly, not a generic SQL facade. Playwright owns worker/test fixture lifetimes and fresh request/browser contexts. `app` reuses one store per execution worker; `dedicatedApp` owns a fresh store per case. Schema/global/race scenarios must use the latter. No scenario resets its store.

For migrated dedicated-store families, the test-scoped `caseApp` selects the resource target without adding a runtime owner: it defaults to worker-owned `app`, or native fixture overrides select `dedicatedApp`. Account provisioning, origin/headers, API login, Staff confirmation and authenticated browser state all depend on that same target. This composition is essential: aliasing dedicatedApp only in the test body leaves dependent account/request/context fixtures pointed at the worker store. A dedicated-store regression protects this invariant.

The app loads the actual `dist/server/wrangler.json` emitted by vinext, with portable relative metadata normalized by the build adapter (ADR0005). Asset/module/D1 identity remains intact. `listen()` establishes the exact origin; `update()` installs that origin before either auth isolate is used. Synthetic secrets are native overrides, never developer `.dev.vars`. The provisioning Worker has the same D1 identity in the same harness, not another platform proxy/runtime owner.

`tests/worker/provision.ts` is a test-only default `WorkerEntrypoint`. `getExport().account(input)` delegates credential creation to production `getAuth().api.signUpEmail`, then supplies only necessary EFCC profile/role/name-key/timestamps/phone prerequisites. It does not issue sessions, fake hashes, clear tables, expose an HTTP Staff bootstrap, or import the production seed handler. Production build does not import this entry. HTTP login and password confirmation remain real production ingress operations. Native in-memory `request.storageState()` transfers genuine cookies to fresh browser contexts; never write auth snapshots.

`pnpm test:native` builds app and provisioning artifacts and runs the native proof config. Provisioning uses Wrangler dry-run only, not deployment. Lifecycle child probes run in a one-worker project after the ordinary project closes its stores; parent test-output paths own child artifacts. Runtime tests always run; no mutable state or passing result is cached.

The resumed privacy check found that Cloudflare's normal build can copy developer variables into `dist/server/.dev.vars`; native secret overrides do not prevent loading that file. Native qualification therefore uses a tracked-only worktree and `native-test` build mode. Vite env loading is disabled, and a filename-only guard rejects local variable files before plugin/harness startup without reading or deleting them. This is a fail-closed expansion constraint until the authoritative staged-tree workspace takes over in N16, not a new snapshot/runtime owner. The explicit `signedInPage` fixture transfers the case's genuine HTTP-login state into a fresh browser context; unauthenticated UI-login proofs use `page`. Acquired auxiliary harness/context cleanup is nested so setup or restoration failures cannot skip native closure.

## Completed migration lane contraction

N03–N15 migrated all existing families in place while preserving independent business/causal assertions. N18 removed the obsolete default Vite Playwright config, production seed route/token, `seed.ts`, `staff-fixture.ts`, shared limiter pacing, `local-env.ts` and legacy source guard after their consumers migrated. No compatibility reexports or second suite remain. The required native Vite hydration/status case remains separately named, not a universal default runtime. Current workflow is [testing.md](../testing.md); the consolidated ownership disposition is ADR0006.

## Alternatives and constraints

Rejected: a second D1 proxy, SQL CLI wrappers, copied seed HTTP handler, custom process/port manager, fake cookies, global counters, shared-store serial assumptions, or resets masquerading as persistent restart. The minimal EFCC seam is provisioning domain prerequisites; native libraries do not know EFCC membership/role/name matching. Public auth construction is unchanged. Causal pipeline controls and persistent update/reload durability belong to later tickets and are not established by this RPC sidecar.

Historical source-scoped results and first failures: [#67](https://github.com/Noahlw/efcc-system/issues/67#issuecomment-6165611736). Current commands and extension guidance: [testing.md](../testing.md).
