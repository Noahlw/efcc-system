# Testing workflow

Authority: [Spec #66](https://github.com/Noahlw/efcc-system/issues/66), tickets #67–85 and current source. Historical source-scoped evidence is indexed under [testing-foundation](testing-foundation/README.md); it is not qualification of later edits. Accepted product visuals and the Design Book are unchanged.

## Toolchain and commands

Use Node **24.21.0**, pnpm **10.33.2**, the checked-in lockfile and installed Playwright browsers. Bootstrap with `pnpm install --frozen-lockfile --prefer-offline`; missing locked packages may be downloaded. Install scripts are not globally disabled. CI runs locked install, check, typecheck and fast Node tests only.

| Command | Actual boundary |
| --- | --- |
| `pnpm test` | Fast Vitest Node contracts, SSR/static component tests and tooling tests; no interactive-browser claim |
| `pnpm test:e2e` | Complete live native foundation, HTTP/browser, causal and required dev lanes |
| `pnpm test:affected [--base origin/main]` | Branch vs PR base plus current uncommitted source, fail-closed source-impact selection |
| `pnpm test:staged [--full]` | Exact Git index including partial staging; explicit full permits otherwise unclassified paths |
| `pnpm test:qualify` | Complete immutable candidate check, typecheck, fast tests, production build and agreed native matrix |
| `pnpm test:native` | Cached native build plus built ingress/D1/auth/isolation/lifecycle compatibility cases |
| `pnpm test:features` | Cached native build plus feature HTTP/browser projects |
| `pnpm test:causal` | Cached native build plus execution-time deadlines, held writers and durable recovery |
| `pnpm test:dev` | Required native Vite hydration/status case; not the default runtime |
| `pnpm build:cached` | Immutable native artifact graph only; never cached test results |

Direct native commands require an owned clean checkout without local vars; the Git gate is the normal route from a developer checkout. It exports only the authoritative Git tree to a private disposable source, validates privacy, installs that snapshot's locked dependencies/config and executes its own policy. Do not move/delete personal `.dev.vars` or `.wrangler` to run tests. Tests do not invoke `db:reset:local`. That explicit destructive developer command and `db:migrate:local` operate on developer D1 and require separate authorization; they are not test setup.

## Gate, selection and evidence

One Husky pre-commit uses native lint-staged formatting and the staged gate. It neither custom-stashes nor auto-stages formatter output. Index drift fails closed. Unknown paths/renames/deletions require a mapping or explicit `--full`, not silent auto-full. One explicit source-area/risk map selects native tags/projects; required discovery must be nonempty and classified, and execution must match discovery with no skip/retry. Shared auth/DB inputs select independent semantic boundaries rather than one happy path per file. HTTP runs once; mobile projects select engine-sensitive cases.

The gate prints immutable source/base identity, changed paths, selection, toolchain, expected/executed native cases, failures/skips/retries and private evidence locations. Failure is not waived by CI, a historical run or a later retry. Preserve the first failure; after repair refresh the changed boundary and required final qualification. A bypass must be disclosed and qualified before delivery. No pre-push gate or cached-pass service exists.

Avoid redundant validation: during implementation use changed-path checks and distinct native counterexamples. Freeze the contracted candidate before the complete qualification. Do not chain full `qualify`, `affected` and `staged --full` merely because they are different aliases. Staged fidelity, selection, privacy and interruption have their own targeted counterexamples; passing results are never reusable cache artifacts.

## Runtime and scenarios

Wrangler `createTestHarness` owns Worker lifecycle, ephemeral ingress and original migrations. Playwright owns worker/test resources and fresh native contexts. Ordinary cases share one store per execution worker (default2) with case-owned users/rows/limiter identities; schema/global/race scenarios explicitly select a fresh dedicated store. No scenario resets tables halfway through. D1 assertions use the application's actual `getEnv().DB` statements/batches, not per-query Wrangler CLI or another proxy.

A test-only default Worker RPC creates genuine Better Auth credentials plus necessary EFCC domain prerequisites. Normal authenticated browser setup uses production HTTP login and native in-memory `storageState`; no synthetic cookies or saved auth files. Production has no seed route/token, Staff bootstrap or test control entry. Native verifier-success and actual D1 batch barriers retain their causal semantics; fault/deadline effects traverse the production guard/dispatch pipeline. Persistent Worker update tests preserve durable effects and rebuild execution state; harness reset is not a cold-crash guarantee.

See ADRs [runtime](adr/0002-native-testing-runtime.md), [presentation](adr/0003-native-presentation.md), [causal controls](adr/0004-native-causal-controls.md) and [immutable builds](adr/0005-native-immutable-builds.md) for retained narrow seams and limitations. Pure synthetic domain fixtures and independent business expectations remain EFCC-owned.

## Builds and privacy

Only the immutable app/provisioning/causal/credential `dist` graph is cached through pinned native Turbo local-only storage in Git's common directory. Inputs include compiled test helpers/controls, app source/assets/migrations, configs, lockfile, actual toolchain and build environment. Assertion-only changes can reuse output only without compiled consumers. Native Tailwind discovery is `src`-scoped; default production build is unchanged and uncached. Missing/corrupt cache rebuilds; unavailable storage executes uncached. A real build failure blocks tests. Native resolved inputs undergo source privacy checks before restore/publication, including ignored files captured by compiled globs.

No DB/cookies/sessions/passwords/member data/raw traces/results/pass are cache inputs/outputs. Generated dist and `.turbo` stay ignored. Emitted relative Wrangler metadata preserves assets/migrations/config graph portability; do not copy developer vars beside it. Private logs/traces/HTML reports are not publishable artifacts. Source privacy is fail-closed classification, not a general secret scanner; only synthetic data is permitted.

## Browser and presentation evidence

Chromium covers all browser journeys; iPhone WebKit and Pixel Chromium cover critical auth/review/restriction/recovery/cookie/history/secret/draft/mobile claims. HTTP-only cases run in one project. Required dev and causal configs remain separate. Viewports, root-font scaling and device profiles are emulation, not physical devices, system zoom, PWA or soft-keyboard proof.

`qualifyPresentation` requires explicit draft and critical-action locators (optional focus/masks). Layout, overflow, root-font, reachability, focus and draft invariants execute before optional capture at all eight contexts plus the project's original viewport. Success PNGs require `EFCC_CAPTURE_SUCCESS=1`; Playwright owns screenshots, original-byte masks, attachments and reporters. Capture off/on is a distinct equivalence check, not a reason to duplicate HTTP/deadline/dev runs. Secrets/password controls are masked in screenshot bytes; traces/logs may still contain private data. No custom gallery/writer/uploader or second workflow driver exists. Design Book reference/offline-gallery verification remains separate from application capture.

## Authorization and delivery

Destructive schema/row/credential/interruption and cache corruption probes need fresh, scoped approval and only harness-owned disposable synthetic stores/cache roots. Never personal/remote D1 or production data. No deployment, merge or force-push is implied. Final delivery records exact candidate identity, observed clean results, independent review, bypasses and unperformed gates; implementation, qualification, owner acceptance and release are separate states.
