# ADR 0004 — Native effect-instance batch controls

## Decision

N12 uses the native Wrangler harness and a test-only default `WorkerEntrypoint` as BOTH the HTTP effect service and RPC control service. Thin `scripts/build-causal.ts` assembly places a stripped test entry beside the actual emitted vinext `index.js` and changes only `main` in a copy of the emitted config. Assets, module graph, bindings, compatibility settings and original migrations remain generated production inputs. This is not a second bundler, runtime manager or cache.

Before dynamically importing the emitted app, the entry installs the sole `env.DB.batch` barrier. `getDb()` reads that binding; module-evaluated `authOptions` captures its adapter only after installation. HTTP fetch delegates unchanged to the emitted default fetch with the native environment and execution context. No direct route invocation, copied auth/header/error guards, HTTP controls or sidecar effect dispatch survives in the clock module.

`getExport()` accesses the actual default class, whose RPC `arm/held/release` observes the same module state as HTTP batches. Double arm fails. The keepalive timer is strictly causal: a real held request must survive until another RPC releases it. Polling in the spec observes the held effect and D1 real-clock expiry; it is not runtime readiness. Cleanup releases on all failure paths and closes the native harness. Every causal test has a fresh owned store; no reset occurs during a sequence. The canonical provisioning sidecar creates prerequisites only; independent observations use the app's `getEnv().DB` and original migrations.

## Claim disposition

The previous 14 clock tests become 20 deadline cases: all eight transaction recipes have expired/fresh session controls; Staff identity additionally has expired/fresh ten-minute confirmation controls; password change additionally has expired/fresh seven-day temporary-credential controls. Own phone, Staff identity, restriction, password, revoke-other-sessions, confirmation, decision and applicant correction retain independent durable-state assertions. Expired tests compare all account/profile/credential/session-proof/application/audit/operation effects, omitting only deliberately changed deadline and renewal fields. Positive tests observe the concrete field effects and one operation receipt.

Sixteen additional cases inject real ABORT/IGNORE at each recipe's receipt insertion, with whole-effect rollback observation and trigger restoration. Two composition/control cases cover forged authority headers, native auth Origin denial, private cache headers, HTML/assets, safe guard errors, double arm and release after failure. All 38 cases run once in the HTTP causal project, without retries or silent skips; native feature/risk tags carry selection intent. Deadline windows and SQL are unchanged; only persisted prerequisite timestamps cross actual time.

### Baseline 14-entry crosswalk

No baseline deadline permutation is retired. Each row maps the original case to the current native title and independent observation; denial cases additionally compare the entire durable-effect snapshot.

| Baseline case | Current native case | Preserved independent effect |
| --- | --- | --- |
| Own phone rejects expired session | own phone change: session expired | Original phone; no change receipt; no actor audit |
| Staff identity rejects expired session | Staff identity correction: session expired | Original target name; no change receipt |
| Staff identity rejects stale confirmation | Staff identity correction: confirmation expired | 403 confirmation-required; original name; no receipt |
| Restriction rejects expired session | restriction change: session expired | Null ban; active membership; no receipt |
| Password rejects expired temporary credential | password change: temporary credential expired | Denial; revision zero; temporary expiry retained; no security receipt |
| Password rejects expired session | password change: session expired | 401; revision zero; no security receipt |
| Revoke-others rejects expired session | revoking other sessions: session expired | 401; both sessions retained; no security receipt |
| Confirmation rejects expired session | password confirmation: session expired | 401; null confirmation reference/timestamp; no security receipt |
| Decision rejects expired session | application decision: session expired | Denial; pending application/profile; no decision |
| Applicant correction rejects expired session | applicant correction: session expired | 401; original email/name; no receipt or correction audit |
| Own phone commits fresh batch | own phone change: session fresh | 201; canonical phone; one receipt |
| Staff identity commits fresh proof | Staff identity correction: session fresh AND confirmation fresh | 201; corrected name/email; one receipt |
| Decision commits fresh batch | application decision: session fresh | 201; approved application/profile; one decision |
| Applicant correction commits fresh batch | applicant correction: session fresh | 201; corrected email/name; one receipt |

All positive controls additionally assert exactly one authoritative audit row linked to the operation receipt, with the independently declared action and actor/target IDs. Six added positive deadline permutations fill the original missing fresh controls (restriction, password/session, password/temporary credential, revoke-others, confirmation, and distinct Staff confirmation). Canonical active-member prerequisites replace the old preliminary approval sequence only where approval itself is not the deadline claim; application decision and applicant creation still traverse production HTTP.

Removed consumers: inline spawn, port 5344, assets directory ownership, health polling, process signals/log accumulation, HTTP arm/held/release, SQL CLI/seed transport imports and shared-store setup. Existing unrelated legacy consumers are outside N12 ownership and remain for their assigned migrations.

## Extension boundary and alternatives

The class can later expose native verifier controls, but a separately imported SOURCE auth module would be a second module instance relative to the emitted graph. N11 must supply a public verifier construction seam in the actual emitted auth graph before claiming that proof. N12 does not implement that seam or claim verifier-race acceptance.

A binding override to a sidecar is not arbitrary D1 interception. Rebundling the emitted app or calling the business handler directly is rejected because it obscures module identity or bypasses the production pipeline. If the dynamic emitted-module composition fails actual qualification, the known legacy lane remains historical source at the pinned base; retirement is blocked, not accepted merely because native RPC APIs exist.

## Qualification

Run in a tracked-only synthetic worktree with Node 24.21.0 and pnpm 10.33.2:

```
pnpm install --frozen-lockfile --prefer-offline
pnpm exec vite build --mode native-test
pnpm build:test-provision
node scripts/build-causal.ts
pnpm exec playwright test --config playwright.causal.config.ts --list
pnpm exec playwright test --config playwright.causal.config.ts
```

Native JSON reporting preserves selected/executed scope, first failures and skips; raw diagnostics stay in ignored local `test-results/n12-*`. Source implementation and observed qualification results are separate; this ADR does not assert a pass.

Observed local N12 qualification (2026-10-13, base `55d9b8f`, parent docs tip `a5e1dda`): native discovery selected 38 cases in one HTTP project. The first complete execution had 29 passes and 9 failures: eight application prerequisites incorrectly used a UUID instead of the existing 64-hex application key contract; the double-arm assertion assumed a native RPC error could not throw synchronously. Both causes were repaired in test inputs/assertion invocation, without changing production validation or expected effects. First-run JSON/traces are retained privately under `test-results/n12-first/`; raw console evidence is `artifact://82`. A new complete execution, with retries disabled, passed all 38 cases, zero skipped (`artifact://96`, `test-results/n12-causal-report.json`). This is N12 scoped real-boundary evidence, not full Spec #66 qualification or independent acceptance.
