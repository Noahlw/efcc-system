# N04 — restricted status, renewal and native dev readiness

## Source and claim disposition

The restricted-status and session-renewal migrations are integrated in `c64555c`, using the settled source from `2dedbbb1bfac38302eaba314294b132e1a605039`. Shared provisioning is integrated separately in `ce02aea`; it changes exactly the requested synthetic account's membership through the actual app D1 binding.

Pending, deactivated and banned status remain separate authority boundaries. The migrated cases retain fresh status/business denial, truthful current-session sign-out, 90-day renewal, RSC/private-cache/revocation/history and independent second actor/page behavior. Browser transitions remain actual browser transitions rather than substituted API contexts.

Native history observations and injected persisted `pageshow` controls are separate. A native history traversal reporting `persisted: false` is not BFCache-restoration proof; protected content concealment and fresh document authority remain mandatory. The injected control independently exercises synchronous concealment and document revalidation.

The native dev case retains only the existing Vite hydration/readiness claim. Playwright's stock `webServer` owns Vite; Vite owns the app and provisioning auxiliary Worker with one D1 binding. A test-only Wrangler service-binding driver exposes canonical provisioning RPC without a control HTTP endpoint or second DB owner. Its native disposal runs in `finally`.

Both `MINIFLARE_REGISTRY_PATH` and `WRANGLER_REGISTRY_PATH` must reference the same private registry; the pinned packages use different variable names. `EFCC_NATIVE_DEV_ROOT` is inherited across config reloads so the registry is stable. `scripts/assert-native-dev-root.ts` atomically acquires a fresh exact owned `.scratch/native-dev-<UUID>` directory before any local migration. Foreign, stale and symbolic-link roots are refused. No developer variable values or personal/remote D1 stores are read.

## Observed scoped evidence

The implementation owner executed the settled source: **46/46 built executions** (HTTP 4; Chromium 14; iPhone WebKit 14; Pixel Chromium 14), zero failures/skips/retries, plus **1/1 actual Vite-dev execution** and **2/2 query-provider SSR Node cases**. This is scoped source evidence, not final whole-Spec qualification.

Integration `64f1b24` wires the stock dev runner into `test:e2e`, adds `test:dev`, and excludes `@dev` from the built features runner. Its check/typecheck and normal commit hooks passed. Direct Node 24 root-acquisition controls returned fresh=0, stale=1, foreign=1 and symlink=1, before any Wrangler migration. A tracked-only worktree at that exact commit passed frozen install, **1/1 actual dev Chromium case**, native app/provisioner builds and **1/1 actual auth session schema-failure/recovery HTTP case**. The latter exercises the generic private-error implementation integrated in `90e7097`; no historical result substitutes for this changed-path smoke. Raw reports remain private in the owned qualification worktree.

The owner requested one combined independent review after all tickets are implemented. No additional intermediate review is scheduled. Final candidate execution and review remain N19 obligations.
