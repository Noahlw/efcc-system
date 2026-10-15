# ADR 0004 — Native effect-instance batch controls

## Decision

N12 uses the native Wrangler harness and a test-only default `WorkerEntrypoint` as BOTH the HTTP effect service and RPC control service. Thin `scripts/build-causal.ts` assembly places a stripped test entry beside the actual emitted vinext `index.js` and changes only `main` in a copy of the emitted config. Assets, module graph, bindings, compatibility settings and original migrations remain generated production inputs. This is not a second bundler, runtime manager or cache.

Before dynamically importing the emitted app, the entry installs the sole `env.DB.batch` barrier. `getDb()` reads that binding; module-evaluated `authOptions` captures its adapter only after installation. HTTP fetch delegates unchanged to the emitted default fetch with the native environment and execution context. No direct route invocation, copied auth/header/error guards, HTTP controls or sidecar effect dispatch survives in the clock module.

`getExport()` accesses the actual default class, whose RPC `arm/held/release` observes the same module state as HTTP batches. Double arm fails. The keepalive timer is strictly causal: a real held request must survive until another RPC releases it. Polling in the spec observes the held effect and D1 real-clock expiry; it is not runtime readiness. Cleanup releases on all failure paths and closes the native harness. Every causal test has a fresh owned store; no reset occurs during a sequence. The canonical provisioning sidecar creates prerequisites only; independent observations use the app's `getEnv().DB` and original migrations.

## Extension boundary and alternatives

The verifier-success control uses a separate credential graph and the public auth-construction option in the actual emitted auth module. A separately imported source auth module would create a second module instance relative to that graph. The batch-control entry alone cannot prove verifier races; its HTTP effect and RPC controls must observe the same instance, as must the credential entry.

A binding override to a sidecar is not arbitrary D1 interception. Rebundling the emitted app or calling the business handler directly is rejected because it obscures module identity or bypasses the production pipeline. If the dynamic emitted-module composition fails actual qualification, the known legacy lane remains historical source at the pinned base; retirement is blocked, not accepted merely because native RPC APIs exist.

Historical recipe/deadline/fault crosswalk and observed results: [#78](https://github.com/Noahlw/efcc-system/issues/78#issuecomment-6165619332). Current commands and resource rules: [testing.md](../testing.md).
