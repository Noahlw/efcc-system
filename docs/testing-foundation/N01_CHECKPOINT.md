# N01 portable recovery checkpoint — locally accepted

This file preserves sanitized recovery history and the resumed bounded N01 acceptance record. It is not whole-Spec or final-candidate qualification. No tracker issue has been closed; the integration parent owns publication on existing PR #47.

Read the integration entrypoint [HANDOFF](HANDOFF.md) first; it owns the transfer prompt, publication identity and whole-spec continuation. The integration parent also recovered the independent candidate disposition; no candidate patch is accepted by this checkpoint.

## Identity and recovery

- Integration base: `d897393d86a070960bfb3f91339262a30279449a`.
- Source branch: `codex/testing-foundation-n01`.
- Recovery worktree: `/home/ubuntu/gh-repo/efcc-testing-foundation-n01-recovery`.
- The original clean exact-base worktree `/tmp/efcc-testing-foundation-n01` and `/tmp/efcc-testing-foundation-authority` vanished during host/runtime restart, before any N01 commit. Git retained only the base branch reference.
- Eleven implementation/config/ADR files were recovered from retained tool write/read/edit transcripts. Whitespace/formatting bytes may differ from the original. No candidate patch was applied. The enhanced real Playwright failed-worker replacement assertion was recovered, but its last original check had no recoverable completion result.
- Lost: original build output/dependency tree, temporary D1/runtime stores, native traces, original `/tmp` authority/evidence JSON files, and original `bg_13` completion. Historical session output survives at `artifact://62`, but do not assume session artifact URLs are portable.
- Recovery used `git worktree add --force` at a persistent new path; it did not prune/reset/clean another worktree or modify personal/remote resources.

## Recovered files and contracts

1. `tests/support/fixtures.ts`: named `NativeApp`, `openApp`, Playwright `test`; worker-owned `app`, case-owned `dedicatedApp`/account, `signedInRequest`, Staff account plus genuine HTTP confirmation, dynamic exact-origin headers.
2. `tests/worker/provision.ts`: test-only default RPC `account(ProvisionAccount)`; genuine production Better Auth signup plus EFCC profile/role/name-key/timestamps/phone. No HTTP provisioning/reset/fake hash.
3. `tests/worker/provision.jsonc`: same D1 identity inside the same native harness.
4. `tests/worker/tsconfig.json`: local inherited TS configuration.
5. `tests/e2e/testing-foundation.spec.ts`: eight independent native ingress/D1/isolation/lifecycle claims.
6. `tests/support/lifecycle-child.spec.ts`: intentional failure/SIGINT and actual native failed-worker replacement probes; not ordinary suite cases.
7. `playwright.native.config.ts`: ordinary native project adjustable two workers, lifecycle fault-child project one worker after native project.
8. `playwright.lifecycle.config.ts`: fault-child runner only.
9. `playwright.config.ts`: temporary legacy lane excludes native proof.
10. `package.json`: `build:test-provision` dry-run and `test:native` expansion.
11. `docs/adr/0002-native-testing-runtime.md`: ownership/alternatives/temporary consumers/evidence limits.

The old seed route/token, CLI SQL helpers, legacy Staff/local-env/limiter and twenty family suites remain explicit temporary consumers for downstream migration/N18 contraction. They were intentionally not deleted before replacement acceptance. No production auth construction or business behavior was changed.

## Historical observations — do not relabel as recovered-source results

- Exact initial branch/base was clean at the full base SHA above.
- Pinned Node 24.21.0 / pnpm 10.33.2 frozen/prefer-offline install succeeded; original production and test-provision builds succeeded; generated types/typecheck and scoped native lint/format completed.
- Original single-worker native run: **7/7 passed**, including completed assertion-failure and SIGINT teardown/replacement, before two workers were enabled (`artifact://52`).
- First expanded two-worker run: **6/8 passed, 2 failed**. Concurrent nested lifecycle child startup timed out before readiness (`artifact://57`). No timeout increase/waiver; the lifecycle project was separated using native Playwright dependencies/one worker.
- That project change yielded **8/8 passed** (`artifact://60`). A subsequent full production/provision build plus typecheck/eight-case run yielded **8/8 passed** (`artifact://62`, independently read by the integration parent).
- Last enhancement explicitly checks Playwright's replacement worker after an intentional assertion failure, in addition to listener teardown/fresh harness replacement. Its original finite `bg_13` result is unknown because of the restart. Recovered-source full qualification is still required.
- Earlier first failures: restricted PATH omitted pnpm; Wrangler relative tsconfig/outdir handling needed correction; initially missing prebuilt provision output; pinned Chromium missing and installed; UI logout test initially looked on Home instead of navigating to Account. These are diagnostic failures, not green results.
- Known baseline full `pnpm check` handoff formatting failure in `SOURCE_OF_TRUTH.md` was reported by the parent and not rerun/waived here.

## Resume commands and acceptance

Use pinned Node 24.21.0 and pnpm 10.33.2; regenerate all immutable outputs on the new machine:

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm exec playwright install chromium
pnpm typecheck
pnpm test:native
```

For one real built-app boundary smoke after recovery:

```sh
pnpm build
pnpm build:test-provision
pnpm exec playwright test --config playwright.native.config.ts --project native --grep V1 --workers 1
```

## Current-machine bounded check

After recovery, pinned frozen/prefer-offline install, `pnpm typecheck`, production `pnpm build`, test-only provisioning dry-run build, and the exact single-worker V1 native boundary smoke above **all passed**. The browser case passed in 3.8 seconds; runner reported **1 passed (16.9s)**. Observed command output is `artifact://75` (session-local, not a public evidence URL). This checked genuine RPC credentials, built HTML/assets/hydration, native cookies, real UI login, RSC navigation/logout and disabled legacy seed ingress. It did **not** execute all eight recovered cases or the enhanced replacement assertion, and does not convert historical 8/8 into recovered-source full acceptance.

The publication parent normalized recovered source formatting and ran integrated pinned-Node `pnpm check`, `pnpm typecheck` and `pnpm test`: all passed, with **11 Vitest files / 56 tests**. Full recovered native qualification and independent recovered-source review remain pending. The known handoff formatting issue was repaired separately by the parent, not waived. The initial source checkpoint commit bypassed hooks (`HUSKY=0`) for the owner-requested urgent transfer; this is disclosed, not an attestation that its hooks ran. Parent publication commits use normal hooks.

Do not invoke the temporary legacy `test:e2e` reset command against personal state. Native fixtures use disposable stores, native listen/getEnv/migrations/close and no developer `.dev.vars` file ownership. Browser traces/DB/auth state/secrets remain private and must not be published.

On resume, finish N01 acceptance/review against live Spec #66/#67, with current candidate identity and all eight cases (including enhanced failed-worker replacement), before retiring dependent consumers. Then continue #68–85 according to native dependencies. This checkpoint does not mark any tracker issue closed and is not whole-Spec acceptance.

## Resumed N01 qualification — 2026-10-13, macOS

Remote refresh confirmed integration and PR head `3caa0e44b9a2e3fbbeeb8d0501fad1749f43fcad`, a clean index/working tree, pinned Node 24.21.0 and pnpm 10.33.2. Live #66–#85 were OPEN with no comments; native blocker relationships matched the published index. The owner interactively approved destructive operations only in this invocation's harness-owned disposable synthetic stores.

The first recovered-source invocation executed all eight cases successfully, including failed-worker replacement and SIGINT, but Vite loaded existing developer `.dev.vars` into its generated output. That invocation is **not privacy-boundary qualification**. No variable contents were read for evidence or published. The shell's optimized `git worktree add` also cloned ignored state; it was not used for qualification. Explicit `/usr/bin/git worktree add` produced a tracked-only owned workspace with no variables, D1 state, dependencies or build output.

Independent Standards and Spec source reviews of `d897393…3caa0e4` identified fallible setup before auxiliary-harness cleanup guards and restoration failures that could bypass disposal. Spec also required reusable authenticated-browser setup rather than manual state transfer in the proof case. The repair nests acquired-resource cleanup and supplies `signedInPage` using genuine HTTP-login state in a fresh native context; UI-login cases keep the unauthenticated `page`.

Native builds now use `native-test` mode with Vite env-file loading disabled. A narrow filename-only guard refuses local `.dev.vars`/`.env` variants in the source, provisioning-config and emitted-app directories before native Vite/Worker startup; it never reads values or removes developer files. Production/default build behavior is unchanged. A synthetic `.dev.vars` counterexample made the actual native build fail before bundling with exit 1; only that owned sentinel was removed afterward.

The repaired tracked-only source then executed all eight cases successfully (six native/two lifecycle, two ordinary workers, zero retries/skips; 17.5 seconds runner time). Original migrations/triggers, exact-origin HTTP/browser auth, authenticated fixture state, actual app D1, ABORT/IGNORE, session fault/restore, colliding stores and failure/interrupt/replacement all executed. This was bounded N01 evidence, not whole-Spec completion; independent review and pinned-candidate verification followed below before dependent migration.

### Accepted pinned candidate and independent evidence

Source `b58f0e555089069a7017375f487a83308e94ca5e`, integrated without source changes as `55d9b8f`, passed pinned `pnpm check`, `pnpm typecheck` and all 11 fast files/56 tests. The first repair check failed `sort-keys` in fixture assembly; it was corrected before the normal-hook repair commit and complete checks. No check was waived.

Fresh-context Standards and Spec reviewers separately found zero remaining actionable findings on `d897393…b58f0e5`. The Spec verifier independently ran one complete `pnpm test:native`: **8 required/8 executed/8 passed, zero failed/skipped/retries**, 16.7 seconds runner time, 21.62 seconds command wall time. Filename-only inspection before/after found no local variable files or emitted `.dev.vars`; values were not read. Runtime: macOS arm64, Node 24.21.0, pnpm 10.33.2, Wrangler 4.145.0, Vite 8.3.2. The six native and two lifecycle cases exercised all bounded V1–V4 claims described above, including the previously unqualified real failed-worker replacement assertion.

Delivery owner accepts #67 locally on that exact source and evidence. #68 and #78 may proceed; downstream V5–V7, full browser matrix, staged/cache/contraction and whole #66 remain unqualified. The existing legacy bridge is intentionally temporary until its claim-preserving downstream migration.
