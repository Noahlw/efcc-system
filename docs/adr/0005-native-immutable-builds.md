# Immutable native build reuse

Authority: Spec #66, #83. N17 uses pinned Turborepo 2.11.7 local filesystem caching, not a custom cache engine. Production `build` is unchanged and uncached. `build:cached` and the Git snapshot gate share one native task, `build:testing`, containing the app, provisioning, causal entry and isolated credential graph. Outputs are only `dist/**`; runtime state, credentials, sessions, evidence and passing results are never task outputs.

## Inputs and ownership

`turbo.json` declares application/Worker source, migrations, assets, compiler/adapters, configuration, lockfile and toolchain files. Actual Node versions/platform/architecture and pnpm version join build environment inputs. The CLI verifies pinned Node/pnpm before execution. Source identity, cases/projects and capture mode remain validation identity, not compiled inputs. Assertion-only files are excluded only where they have no compiled consumer. Tailwind discovery is explicitly restricted to `src` for production and native builds by `src/app/globals.css`; no mode-specific stylesheet transform is retained. This boundary is necessary: the installed default scanner also consumed E2E assertion files. Future compiled helpers under `tests/worker` invalidate irrespective of filename suffix. Node-only auth-policy tests live under `tests/shared` and need no Worker-input exclusion.

The gate exports the actual immutable Git tree and bootstraps its locked dependencies. Public cached builds validate current source independently. Both validate privacy before cache restoration, including Turbo's resolved input map: ignored private files matched by explicit build globs must not enter artifacts. Native Vite rejects developer vars before startup. Do not run native commands in a checkout containing personal vars/state; use the snapshot gate instead.

Native Turbo strict environment and local-only cache mode are explicit. Cache storage is Git's common directory plus `efcc-native-build-cache`, outside disposable exports. Unavailable storage disables caching, not tests. Build failure blocks the dependent runner; it is not retried as an availability fallback. Owned `dist` is removed before restore because Turbo's existing-output fast path validates metadata rather than content. Missing/corrupt cache entries are rebuilt by Turbo. No custom hash/archive/eviction service is retained. `.turbo` summaries and failure evidence are private generated output, not source.

## Portable graph

`portable-build.ts` validates emitted Wrangler configuration and real paths before rewriting a single config. It preserves main, module rules, assets and D1 identity, and makes source/config/migrations pointers relative. Escaping pointers fail before any write. The credential adapter normalizes its independent graph; causal config reuses the normalized app graph. This is a narrow emitted-metadata seam, not a Worker owner. Wrangler owns load/listen/migrations/RPC/close.

## Alternatives and limitations

Uncached builds fail the cross-invocation reuse requirement. A custom cache duplicates provider integrity/restore maintenance. Splitting overlapping `dist` producers into independent tasks creates conflicting output ownership; one native task owns the emitted graph.

Source identity and fresh test execution remain separate from artifact reuse. Portable relative graph support does not prove another host/toolchain or production deployment. Historical hit/invalidation/corruption/relocation observations and their limits: [#83](https://github.com/Noahlw/efcc-system/issues/83#issuecomment-6165623956).
