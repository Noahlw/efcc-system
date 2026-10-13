# EFCC Testing Foundation — Consolidated Knowledge Handoff

**Document role:** One self-contained, evidence-grounded **knowledge baseline and recommendations** for a separate agent to produce its **own architecture decision and implementation plan**. This is not an approved migration design, a command to edit the repository, a replacement for actual source, or a passing-test certificate.

**Research snapshot:** 2026-10-13, GitHub `Noahlw/efcc-system`, [PR #47](https://github.com/Noahlw/efcc-system/pull/47), remote head **`ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf`** at the time of audit. PR open, not merged. **Agent Revision 5**: user-supplied draft _EFCC Test Foundation｜共同理解 Brief_, status **DRAFT / Grilling**, with an uncommitted experimental `codex/efcc-testing-foundation` worktree. This handoff **does not inspect that local worktree**. It must not overwrite or clean uncommitted changes.

**Toolchain inspected:** Node `24.21.0`, pnpm `10.33.2`, Wrangler `4.145.0`, `@cloudflare/vite-plugin 1.62.3`, Playwright `1.63.0`, Vitest `5.0.3`, vinext `1.0.0`, Better Auth `1.7.7`, Drizzle `0.45.3`, TypeScript `7.0.2`. These values come from the pinned EFCC package/lockfile snapshot, _not_ a claim of future compatibility.

**Evidence labels used below:**

- **[OWNER]** Explicit user preferences / draft-agent understanding, subject to user confirmation where marked.
- **[REPO]** Checked-in source at the above SHA. Remote baseline only; agent must reconcile newer head and private worktree delta.
- **[PINNED]** Exact Wrangler `4.145.0` upstream code/API; not EFCC runtime feasibility.
- **[DOC]** Official tool guidance; available capability, not integration success.
- **[ASSESSMENT]** Engineering inference or suggested architecture, **not** measured or approved implementation.
- **[VERIFY]** Important uncertainty that actually needs a contained EFCC test.

---

## 1. Authority and operating contract

### Source-of-truth _hierarchy_

1. **Most recent explicit owner decisions**, including scope, slim CI preference, and **aggressive library-first cleanup**. If new messages supersede Revision 5, follow the user.
2. **Actual current repository/worktree**, including existing uncommitted changes. The branch's current source beats this remote snapshot. **Do not touch, reset, stash, clean, or commit** unknown user work without approval.
3. [REPO] Verified remote SHA and source evidence linked here.
4. [PINNED] Library source for exact versions, plus [DOC] intended tool behavior.
5. [ASSESSMENT] Handoff alternatives and migration suggestions. Agent can reject a choice with specific evidence.

**“Source of truth” here means a trustworthy knowledge starting point, not the authority to override newer code or the owner.** Record stale evidence as superseded; don't quietly rewrite provenance.

### Owner goals and scope [OWNER]

- **Whole-repo, long-lived Testing Foundation**, not a small one-off pilot. Pilots validate options; the final proposal must address all existing tests, fixtures, runtime, DB ownership, test selection, local gates, artifacts, commands, and maintainer documentation. Migration may be staged.
- **Library-first / Ponytail / Native Ownership First, Minimal EFCC Seams**: if maintained native APIs can own a generic responsibility while preserving behavioral evidence, favor **removing** redundant custom code—even when one-time migration has a cost. **Do not hide legacy code behind a new wrapper or permanently keep duplicate equivalent implementations.** Retain only genuinely EFCC-specific domain data, invariants and indispensable causal fault controls.
- Preferred platform: **existing Wrangler `createTestHarness()` + existing Playwright / Vitest** wherever evidence supports it; allow a narrow alternative if real EFCC behavior or net complexity is worse. Do **not** pursue tool uniformity as a performance KPI independent of code ownership, fidelity and maintainability.
- **CI is deliberately slim**: existing `pnpm check`, `pnpm typecheck`, fast Node Vitest. Heavy Worker/D1/browser/resilience/presentation qualification belongs to the **local workflow**, with strong owner interest in **risk-based pre-commit**. Compare practical pre-commit vs local candidate qualification ergonomics; **do not silently expand GitHub Actions**.
- **Fast, trustworthy affected-feature feedback** plus an explicit full candidate qualification path; reduce unnecessary setup/auth waiting, repeated CLI process launches, duplicate browser engines and successful PNG generation, **not security assertions**.
- Supports macOS + Linux/cloud **as design command contracts**; per Agent Revision 5 Q19, **do not add a new cross-OS full-qualification matrix or comparative benchmark** just for this migration. Report only actually tested platforms.
- Existing PR #47 changes / UI closeout are a separate subject. Revision 5 says last UI fixes were accepted, whereas the remote PR description still says **owner visual acceptance pending**. **Do not assert it is accepted or reopen UI scope** without reconciling with owner. Revision 5 prefers continuing in PR #47, but the remote PR is already large; confirm branch/PR placement at planning time rather than automatically writing there.
- Current user asks for **knowledge + one prompt**, with **actual implementation planning owned by the agent**. This packet is **read-only research handoff**; no authority to run destructive commands, implement, create remote tickets, merge, or deploy.

### What the planning agent should deliver

A substantive ADR and implementation proposal with: selected architecture and alternatives, owned runtime/data/session/capture boundaries, entire case/claim migration inventory, **custom code removal register**, pilot/rejection gates, benchmark method, local gate vs slim CI decision, stages/tickets/dependencies, risk/rollback, and final acceptance evidence. **Do not jump directly into code.**

---

## 2. Verified baseline and historical evidence [REPO]

| Area | Current snapshot | Why it matters |
| --- | --- | --- |
| Playwright | [`playwright.config.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/playwright.config.ts): `workers:1`, `fullyParallel:false`, dev `vite` webServer, primary Chromium plus file-matched iPhone WebKit/Pixel Chromium, `trace:retain-on-failure` | Intentionally serialized shared mutable D1; HTTP-only cases in matching files may run multiple times. Config import calls `ensureLocalEnv()` with file side effect. |
| Existing fast runner | [`vitest.config.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/vitest.config.ts): Node, collects `tests/shared`, `tests/ui` and `tests/worker/**/*.test.ts` | “worker” is misleading for one pure allowlist unit test; `tests/ui` are static SSR tests, not browser interaction. |
| Runtime/config | [`vite.config.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/vite.config.ts) vinext/Cloudflare `rsc` with `ssr` child; [`wrangler.jsonc`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/wrangler.jsonc) `main:vinext/server/fetch-handler`, D1 binding `DB`, migrations dir `migrations`, assets | Don't assume official example generated paths equal EFCC. Need inspect actual `pnpm build` output in an owned workspace. |
| D1 access | [`tests/e2e/seed.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/e2e/seed.ts) `queryLocalSql` and `runLocalSql` each start `wrangler d1 execute --local` using `execFileSync` | Large potential repeated overhead; DB reads may also block Node event loop. Needs quantified timing and parity. |
| Rate-limit helper | [`tests/scenarios/limiter.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/scenarios/limiter.ts) synchronously queries all limiter rows and waits up to 10s window + 350ms by path suffix | Unrelated tests may pace against globally shared sign-in path even if different test identity/IP. Preserve actual rate-limit tests. |
| Env helper | [`tests/scenarios/local-env.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/scenarios/local-env.ts) defaults port `5199`, can create `.dev.vars`, supplies `connection:close` workaround | Tests/discovery mutate config on import; workaround was based on synchronous-CLI pooled-socket failures and may become unnecessary after removing event-loop blocking. Prove before deleting. |
| Presentation | [`tests/e2e/r11-presentation.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/e2e/r11-presentation.ts): eight viewport/root-font contexts, review projects add original; two masked PNG calls per context, geometry/final control/draft assertions, JSON metadata, import-time `git diff HEAD` | Successful artifact cost fused with assertions; source-git call may break in a staged exported workspace without `.git`. `controls.last()` is not necessarily the critical Submit. |
| Test-only provisioning | [`src/app/api/internal/test-setup/route.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/src/app/api/internal/test-setup/route.ts) ~454 lines, `SEED_TOKEN`-gated, returns 404 without token, creates native Better Auth credentials / profiles and domain fixtures | Candidate to move fixture provisioning outside shipped route tree, **but never replace authentic password creation with arbitrary fake hash** or expose privileged fixture access. No actual security defect proven by file presence. |
| Staff fixtures | [`tests/e2e/staff-fixture.ts`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/e2e/staff-fixture.ts): synthetic person, SQL role change, API login/password confirmation, caller closes contexts | Keep domain scenario logic; move runtime/session lifetime to owned Playwright fixtures, unify same D1, don't create public Staff bootstrap API. |
| Git hooks | [`.husky/pre-commit`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.husky/pre-commit) runs lint-staged then Ultracite; [`.lintstagedrc.json`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.lintstagedrc.json) formats staged files | Heavy pre-commit gate is **not yet checked in**. Local hook execution can be bypassed; staged-tree correctness is not automatic. |
| GitHub CI | [`.github/workflows/checks.yml`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.github/workflows/checks.yml) only install/check/typecheck/fast Vitest | **Intentional slim policy**; no browser/D1 qualification claim from successful CI. |
| Destructive local script | [`package.json`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/package.json): `test:e2e = pnpm db:reset:local && playwright test`; `db:reset:local` removes `.wrangler/state/v3/d1` | Never invoke in a personal repo without explicit owned state and consent; target disposable test environments. |

**Inventory size at this snapshot:** 20 Playwright `.spec.ts` files, 11 Vitest `.test.ts/.tsx`, 1 type-only consumer, 11 non-test support modules under `tests/` = **43 paths**. Static source scans previously observed roughly **201 `queryLocalSql`, 141 `runLocalSql`, 59 `waitForSignInWindow`, 47 `qualifyPresentation` call sites** across the 20 Playwright spec files; these are approximate _static references_, **not runtime invocation counts or timed hot spots**. `account-assisted.spec.ts` ~2,349 lines; `account-identity.spec.ts` ~1,503; `account-application.spec.ts` ~1,350. No reason to expect a file rename itself speeds up execution.

**Historical qualification:** PR describes **389/389 cases green, ~1.9 hours** at **older SHA `97abecb`** (309 primary Chromium, 40 iPhone WebKit, 40 Pixel Chromium). Latest `ba8126d` has fast CI success (check/typecheck/56 Vitest); owner-approved affected E2E runs across different SHAs were _not_ a complete current-head 389-case run. Do not sum separate partial invocations or relabel old green results. [PR evidence](https://github.com/Noahlw/efcc-system/pull/47).

---

## 3. Confirmed official runtime/tool capabilities and limits [PINNED][DOC]

### Wrangler `createTestHarness`: high-confidence library candidate

**Confirmed in exact pinned `wrangler@4.145.0`:** It is exported from [`src/api/index.ts`](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.145.0/packages/wrangler/src/api/index.ts), and implemented in [`src/api/test-harness.ts`](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.145.0/packages/wrangler/src/api/test-harness.ts). Its API has:

- `createTestHarness({ workers:[...], root? })` for Wrangler config(s), including generated Vite config(s); `prebuiltWorkerDir` on supported config inputs.
- `listen()` returning a URL; `fetch()` for routed requests; `getWorker(name).fetch()` for direct Worker dispatch; `getWorker(name).getEnv()` to access its **real configured** bindings.
- `getWorker(name).applyD1Migrations(bindingName)`, using Wrangler migration discovery and existing SQL migrations, not a parallel hand-written schema.
- `update(...)`, `reset()`, `close()` and diagnostics (`getLogs`, `clearLogs`, `debug`). Overrides for `vars`, `secrets` and supported **service** bindings. Browser still executed by Playwright.
- Pinned implementation configures `watch:false`, `persist:false`, an ephemeral local URL/port. `reset()` **tears down the session, recreates storage, restarts, and may change URL**. Never use `reset()` to prove **persistent Worker restart**; re-obtain handles, reapply migrations, reseed and reauthenticate after reset.
- **`bindingOverrides` is not an arbitrary D1 batch-interception hook.** Exact Worker/D1 deadline and credential-proof race conditions need EFCC-specific causal controls or a genuinely equivalent proven seam.

Official sources: [overview](https://developers.cloudflare.com/workers/testing/test-harness/), [get started](https://developers.cloudflare.com/workers/testing/test-harness/get-started/), [configure](https://developers.cloudflare.com/workers/testing/test-harness/configure/), [prepare state](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/), [interact](https://developers.cloudflare.com/workers/testing/test-harness/interact-with-workers/), [integrations](https://developers.cloudflare.com/workers/testing/test-harness/integrations/), [pinned Playwright fixture](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.145.0/fixtures/create-test-harness-example/tests/playwright.test.ts).

**Not proved:** The actual EFCC vinext/RSC emitted Worker config and assets work correctly with this harness; exact trusted-origin bootstrap during dynamic port/update; canonical auth/cookie/session behaviors; isolation/cleanup and relative performance after build+reset+migrations. These are bounded runtime validation tasks, **not grounds to redo generic API research**.

### Alternatives and complementarity

| Tool option | Best role | Major caveat / initial view |
| --- | --- | --- |
| **Playwright + Wrangler Harness** | Preferred consolidation candidate for suitable built-app HTTP/Worker/D1/browser tests | Verify actual EFCC build/origin/DB/fault parity and cold/warm cost. |
| **Existing Playwright + Vite dev** | Keep as fallback / required dev-specific hydration lane | Does not natively remove repeated CLI/DB setup or isolate stores. |
| **Workers Vitest integration** | Alternative for selected source-level Worker tests | Per-file storage isolation, separate configuration/runtime; avoid adding duplicate environment without concrete advantage. [Cloudflare isolation](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/), [known issues](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/). |
| **Playwright native** | Browser/API testing, fixtures, projects, sharding/reporters, screenshot masks, attachments | Does **not** supply EFCC-specific DB atomicity or fault injection. [Playwright fixtures](https://playwright.dev/docs/test-fixtures), [API testing](https://playwright.dev/docs/api-testing), [sharding](https://playwright.dev/docs/test-sharding). |
| **Git + Husky + lint-staged + pnpm** | Staged-index operations, hooks, selected formatting, locked dependencies | Hooks bypassable; partial staging must be handled; do not invent custom stash/CI scheduler. [Git index export](https://git-scm.com/docs/git-checkout-index), [Git hooks](https://git-scm.com/docs/githooks), [lint-staged](https://github.com/lint-staged/lint-staged). |

**Library-first policy:** Native capability should take over duplicated generic infrastructure; require a **retirement decision** for every old custom helper. Still preserve independent domain assertions, which **cannot** be delegated to the library merely because it hosts tests.

---

## 4. First-round custom-maintenance removal register [REPO][ASSESSMENT]

This is a **specific starting register**, not an automatic delete list. One native owner per generic responsibility is the target. For each entry the agent must choose **REPLACE+DELETE**, **MINIMAL KEEP**, or **BLOCKED WITH EVIDENCE**, with a proof of parity and deleted consumer references. Do not finish with duplicate equivalent old/new stacks.

| ID | Exact owner(s) | Current behavior / cross-file dependency | Library-first candidate and retirement gate |
| --- | --- | --- | --- |
| **CF01** | `tests/e2e/seed.ts` | `runLocalSql`/`queryLocalSql` spawn Wrangler for each SQL; imported across many E2E suites | [PINNED] `getWorker().getEnv().DB` for async `prepare().bind().all()/run()`; prove **same D1 as app** and independent expectations; switch consumers then delete CLI wrappers. No `Promise.all` across causal observation points. |
| **CF02** | `tests/scenarios/limiter.ts` | Full `rate_limit` scan + latest by suffix path + explicit delay; normal login setup can wait on unrelated bucket | Prefer unique, owned synthetic limiter identity/IP and D1 binding reads; retain genuine `rate-limit.spec.ts` window assertions. Verify CF client IP and origin semantics, not bypass security. Delete obsolete shared pacing after consumers migrated. |
| **CF03** | `tests/scenarios/local-env.ts` + `playwright.config.ts` | Import-time `.dev.vars` creation; fixed localhost:5199 and custom socket `connection:close` | Harness `vars/secrets` + ephemeral URL; Playwright worker fixtures and exact-origin bootstrap. `connection:close` may be unnecessary after synchronous-CLI removal; benchmark/reproduce before retiring. Never use wildcard trusted origins. |
| **CF04** | `package.json` (`test:e2e`, `db:reset:local`), personal `.wrangler` | Script deletes local D1 before tests, tied to developer state | Disposable harness/test storage; keep explicit dev-only migrate/reset commands separately. Test scripts must not silently delete personal D1. `reset()` has lifecycle cost and doesn't preserve restart state. |
| **CF05** | `tests/e2e/staff-fixture.ts` + duplicate spec-local auth setup | Pure data, API context, seed, Staff role via SQL, auth, 10-min confirmation, teardown owned by callers | Playwright worker/test fixtures for scoped lifetime + small EFCC-specific builders/scenarios; don't remove real login/proof or introduce public Staff bootstrap. Make async DB binding and teardown explicit. |
| **CF06** | `tests/worker/business-fault.ts` | Manually hosts auth and a hand-built guard, alters production D1 schema for read failure, restores | Harness owned auxiliary Worker/runtime if required; seek production ingress first; preserve actual fault and cleanup. Avoid duplicate guard semantics in new code. |
| **CF07** | `tests/worker/clock-matrix.ts` | Custom `/arm` `/held` `/release` plus a test-only `env.DB.batch` wrapper; **duplicates** parts of `src/proxy.ts` auth/decision/header routing | Harness may own start/lifecycle; EFCC still owns precision batch barrier until equivalent supported interception exists. Preserve last-moment authority/deadline positive/negative controls. Prove full ingress seam if removing duplicated guard. |
| **CF08** | `tests/worker/credential-race.ts` | Wraps **Better Auth internal** `getAuth().$context.password.verify` and pause-after-success; manual Worker lifecycle | High upgrade fragility. Search for a stable native/DI seam **without editing business behavior**; if none, keep minimal pinned-version adapter plus compatibility test. Don't replace real verifier with fake return value. |
| **CF09** | `src/app/api/internal/test-setup/route.ts` | ~454-line token-gated test-only provisioning endpoint under app route tree; canonical Better Auth creation and domain seed | Evaluate moving test provisioning out of app routes if harness can seed equivalent genuine state. **Do not simply delete** if browser/SSR scenarios still depend on it; prove canonical credential, role, profile, name key, timestamps. Absence of `SEED_TOKEN` -> 404 remains required if route retained. |
| **CF10** | `tests/e2e/r11-presentation.ts` + R11 spec users | Eight contexts; 2 masked PNGs/context, layout/draft checks, metadata; import-time `git diff HEAD` | Keep layout/draft/critical-control assertions; separate successful evidence opt-in using Playwright screenshots/attachments/reporters; eliminate redundant gallery/metadata plumbing. Handle Git-free staged export provenance. |
| **CF11** | Whole-file `testMatch` in `playwright.config.ts`, mixed `name-sign-in`/`restricted-status` etc | API-only cases may repeat across review engines; `r11-ui` 35 presentation call sites | Classify cases by seam; Playwright projects/case tags/feature-based selection; preserve mobile-specific browser coverage, not API duplicates. |
| **CF12** | `.husky/pre-commit`, `.lintstagedrc.json`, local selection/reporting not yet implemented | Checked-in hook = formatting/lint only; Slim CI = check/typecheck/Vitest | Prefer native Git index/Husky/lint-staged/Playwright tools; small selector/gate coordinator only if necessary. Verify staged-red/unstaged-green, rename/delete, drift, offline dependency cost; don't create private CI framework. |
| **CF13** | `tests/scenarios/accounts.ts`, `activities.ts`, `notices.ts`; `tests/types/business-api.ts`; `tests/shared/*.test.ts` | Pure domain examples, compile contract, independent assertions | **KEEP** as EFCC-owned meaning; reorganize only if useful. No generalized factory framework, no rewriting expected effects from production implementation. |
| **CF14** | `tests/ui/*.test.tsx`; `tests/worker/public-auth-boundary.test.ts` | Node-rendered SSR/component and pure allowlist, not real worker/browser | **KEEP/RECLASSIFY**; don't mislabel static markup tests as interactive UI; add component testing only for focused gap. |

### High-risk cross-file call chains the agent must explicitly reconcile

1. `playwright.config.ts` → `tests/scenarios/local-env.ts#ensureLocalEnv` → `.dev.vars` → Vite server → auth origin. A test discovery/list can trigger writes before an actual test runs.
2. `tests/e2e/*.spec.ts` → `staff-fixture.ts` / `seed.ts` → `postSeed()` → `src/app/api/internal/test-setup/route.ts` → `getAuth()` / Drizzle → canonical credential/profile. Removal of seed route needs real replacement for the full chain.
3. `tests/e2e/*.spec.ts` → `runLocalSql/queryLocalSql` → Wrangler separate process → `.wrangler` shared D1. The new harness DB must be _the same_ store both API and test observe.
4. `tests/e2e/account-clock-matrix.spec.ts` → separate `wrangler dev` / `tests/worker/clock-matrix.ts` → test-owned `DB.batch` gate → true SQL write-time current authority. Can't claim replay after harness reset is a persistent restart.
5. `tests/e2e/account-assisted.spec.ts` + `account-security.spec.ts` → spawned `tests/worker/credential-race.ts` → Better Auth verifier monkeypatch → concurrent password/reset flow. Keep verification-before-revision race semantics.
6. `tests/e2e/guard-failures.spec.ts` / `zz-worker-faults.spec.ts` → manually modified/renamed schema and fault Worker → browser safe unavailable response. Test-only HTTP routing that copies `src/proxy.ts` can drift from production behavior.
7. `tests/e2e/r11-ui.spec.ts` and other affected tests → `qualifyPresentation()` → eight viewports, two images each, masking and git SHA metadata. For staged-index export, there may be no `.git` path.
8. Git index → `lint-staged` re-staging → subsequent full checkout tests see unstaged changes → risk of approving different tree. Native index export must retain inputs, provenance and drift checks.
9. `src/proxy.ts` authenticates/renews sessions and strips untrusted actor/session/access headers; `tests/worker/clock-matrix.ts` reconstructs parts of that logic. A `getWorker().fetch()` direct call can **bypass routed ingress**; preserve appropriate native HTML/RSC/HTTP seam, not just handler status.

---

## 5. Existing test ownership: complete 20-spec first-pass map [REPO][ASSESSMENT]

**Important:** This assigns **review directions**, not an already verified case-by-case migration. Test case names generated by loops, current row count and project-specific collection need actual runner discovery. A file can contain different layers; **do not move entire file as a unit by name**.

| Existing `tests/e2e/<file>` | Principal concerns / how to divide | Critical evidence not to lose |
| --- | --- | --- |
| `access-foundation.spec.ts` | HTTP/auth guard vs browser navigation | Origin, allowed routes, real sign-in, private cache/cookie boundaries. |
| `account-applicant.spec.ts` | HTTP/account applicant + browser review + resilience | Actor-key binding, multi-stage correction/withdraw/resubmit, immutable receipts, private decision separation. |
| `account-application.spec.ts` | Public HTTP application + browser forms + resilience | No session on application, duplicate username/phone, bounded input, valid Pending, rollback. |
| `account-assisted.spec.ts` | API/creation/reissue + browser handover + verifier race/fault | One-time secret, expiry, exact original key, late response, non-replay, canonical Better Auth credentials. |
| `account-clock-matrix.spec.ts` | Isolated resilience | Park before actual DB batch; expired session/confirmation at execution, positive controls. |
| `account-decisions.spec.ts` | API review/decision + browser + fault | Private notes, approvals/rejections, current Staff authority, receipt completeness, independent audits. |
| `account-deletion.spec.ts` | HTTP restrictions + D1 fault family + actual UI | `ABORT`/`IGNORE`, retained history/username, last-effective Admin, explicit review/confirmation/submit, non-half-delete. |
| `account-identity.spec.ts` | Own vs Staff identity, server claims, form/recovery, concurrency | Empty/false edits, actor/target, verified-phone caveat, stale guards, idempotency. |
| `account-restrictions.spec.ts` | Current-state HTTP guards + review + fault/concurrent | Membership vs ban independence, last-admin, pending UNKNOWN, keyed retry. |
| `account-security.spec.ts` | Native password/session HTTP + confirmation/browser + fault/race | Current session retained, others revoked, proof revision, 10-minute confirmation, privacy. |
| `guard-failures.spec.ts` | Negative guard/DB fault + visible recovery | Fail closed, unavailable != signed out, SQL never shown, session truth. |
| `home-notices.spec.ts` | Server-authorized query semantics + browser rendered notices | Scope, Department vs Program, visibility after revocation, no fake new API. |
| `home-participation.spec.ts` | Data scope + browser Home/calendar | Upcoming order, HK time, pending/waitlist, no unrelated account data. |
| `name-sign-in.spec.ts` | Native HTTP identifier contracts + browser name/login modes | Ambiguous full name must not enumerate, NFKC/case normalization, real login and rate limit. |
| `qualification.spec.ts` | Auth interaction + presentation/accessible feedback | Focus, contrast, paste, network failure, sign-in limiter and safe recovery. |
| `r11-ui.spec.ts` | R11 multi-feature browser journeys + extensive responsive/capture | Keep essential end-to-end journeys and focus/draft/secret/operation; decouple opt-in PNG. |
| `rate-limit.spec.ts` | Auth HTTP limiter resilience | Real shared buckets/windows, rejection and recovery; don't fake time. |
| `restricted-status.spec.ts` | Status current-authority HTTP + browser | Pending/deactivated/banned, fresh recheck, no member access. |
| `session-renewal.spec.ts` | True browser/native cookie/document + some HTTP | 90-day renewal/cookies, BFCache/history conceal and full-document revalidation. |
| `zz-worker-faults.spec.ts` | Exclusive Worker/DB fault + browser safe-state | Read faults, schema rename/drop, safe failures, retry and cleanup. |

### Static call-site profile — audit triage aid

This table is **a lexical/source-level inventory at `ba8126d`**, not test duration, call frequency, precise collected-case count, nor proof the helper executes for every case. `qSQL` = approximate `queryLocalSql` call sites; `wSQL` = `runLocalSql`; `wait` = `waitForSignInWindow`; `view` = `qualifyPresentation`. These counts tell the agent **which owners to inspect first**, without a blind full rescan. Recalculate only for modified source or when establishing case-level coverage.

| `tests/e2e/*.spec.ts` | Lines | qSQL | wSQL | wait | view |
| --- | --: | --: | --: | --: | --: |
| `access-foundation` | 312 | 0 | 0 | 5 | 0 |
| `account-applicant` | 1217 | 28 | 16 | 0 | 0 |
| `account-application` | 1350 | 12 | 3 | 4 | 0 |
| `account-assisted` | 2349 | 35 | 24 | 0 | 5 |
| `account-clock-matrix` | 956 | 27 | 4 | 0 | 0 |
| `account-decisions` | 1110 | 9 | 12 | 7 | 3 |
| `account-deletion` | 886 | 23 | 16 | 0 | 0 |
| `account-identity` | 1503 | 32 | 17 | 2 | 2 |
| `account-restrictions` | 841 | 16 | 12 | 0 | 0 |
| `account-security` | 1158 | 9 | 13 | 4 | 0 |
| `guard-failures` | 357 | 2 | 5 | 4 | 0 |
| `home-notices` | 268 | 1 | 3 | 1 | 0 |
| `home-participation` | 458 | 0 | 0 | 1 | 0 |
| `name-sign-in` | 626 | 0 | 5 | 10 | 1 |
| `qualification` | 302 | 0 | 0 | 9 | 0 |
| `r11-ui` | 657 | 4 | 2 | 1 | 35 |
| `rate-limit` | 83 | 0 | 0 | 4 | 0 |
| `restricted-status` | 264 | 0 | 0 | 2 | 1 |
| `session-renewal` | 541 | 2 | 1 | 2 | 0 |
| `zz-worker-faults` | 304 | 1 | 8 | 3 | 0 |
| **Total approximate static call sites** | — | **201** | **141** | **59** | **47** |

### Other 23 test/support paths

- **Eight `tests/shared/*.test.ts`**: application, church-time, decision, deletion, identity, restriction, security and staff-account contracts. Keep as fast Vitest, possibly rename to `tests/unit/contracts`.
- **One `tests/worker/public-auth-boundary.test.ts`**: pure Node allowlist test, _not_ Worker runtime integration.
- **Two `tests/ui/*.test.tsx`**: static SSR AppError / QueryProvider, not hydrated browser interactions.
- **One `tests/types/business-api.ts`**: compile-only typed Hono client; preserve `tsc` discovery.
- **Three `tests/e2e` support files**: `seed.ts`, `staff-fixture.ts`, `r11-presentation.ts`.
- **Five `tests/scenarios`**: `accounts.ts`, `activities.ts`, `notices.ts`, `limiter.ts`, `local-env.ts`.
- **Three `tests/worker` entrypoints**: `business-fault.ts`, `clock-matrix.ts`, `credential-race.ts`.

---

## 6. Test semantics that must survive consolidation [OWNER][REPO]

**Preserve actual claims, not necessarily old filenames or implementation shape.** Consolidation may split/merge cases with proven equivalence, but the final case/claim mapping must be complete.

| Family | Required independent evidence / invalid shortcut |
| --- | --- |
| Native auth/session | Real Better Auth credential verification, cookie/CSRF/origin, 90-day renewal, no raw credential logging; no fake authenticated session in tests intended to prove native auth. |
| Access & privacy | Fresh D1 membership/ban authority, no client-forged actor/session headers, no applicant-visible private Staff notes, no cross-target leaks. |
| D1 write completeness | Original migrations/triggers, atomic audits/receipts, `ABORT` and `IGNORE` rollback, no half-effects, username reservation/history retention. |
| Concurrency/replay | Duplicate race, original operation key, immutable Review → explicit Submit, reconciled UNKNOWN, no extra effect on retry. |
| One-time credentials | Actual issuance expiry, no plaintext replay on reload/late response/receipt, current native revision and session revocations. |
| Clock/causality | SQL execution-time expiration and both expired/fresh control outcomes; JS fake timers or `reset()` do not prove persisted D1 time. |
| Browser | Real UI input, focus, dialogs, dirty-exit, history/BFCache, responsive draft preservation, primary final actions. Browser coverage is not replaced by API-only tests. |
| Presentation | Responsive/200% root-font assertions independent of capture-off; masks and provenance in opt-in PNG, private traces restricted. |
| Fault cleanup | If assertion fails or request aborts, no triggers, schema renames, held gates, sockets, ports or worker processes contaminate next test. |

**Testing must remain independent.** Example: the `account-deletion.spec.ts` 6-table × `ABORT`/`IGNORE` matrix must preserve each fault condition _and_ one real original-key retry after removing the fault. A browser test may retain an independent D1 effect check; not all DB reads automatically mean a case is “integration only”.

---

## 7. Slim CI, local gate, staged fidelity and cache [OWNER][REPO][ASSESSMENT]

### Current real state

- GitHub Actions **deliberately slim**: [`checks.yml`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.github/workflows/checks.yml) runs check, typecheck, Node-fast Vitest. Do not add broad E2E jobs by default.
- Checked-in hook **not yet heavy**: [`.husky/pre-commit`](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.husky/pre-commit) runs `lint-staged` then `ultracite check`; `commit-msg` uses commitlint.
- Historical `pnpm test:e2e` **deletes local D1**; design new commands to only use disposable owned runtime.

### Policy tradeoff to put before owner

Compare: (A) **risk-based heavy test selection at pre-commit**; (B) fast pre-commit plus **separate required local candidate qualification**; (C) **hybrid**. Owner prefers meaningful pre-commit protection; it must not run entire 2-hour suite for docs-only changes. A long _required_ case is not silently skipped on a budget: fail with explanation or request approved scope change.

### Staged-tree correctness

**A passing working-tree run may not qualify the staged commit.** A staged bug may be hidden by an unstaged fix. Native Git-index export is a candidate: identify staged changes including rename/deletion; `git write-tree` identity; export to owned isolated working directory via `git checkout-index --all --prefix=<owned-empty-dir>/`, arrange locked offline dependencies; run against exported staged source; detect index drift; never clean/stash/reset the developer checkout. **Feasibility/cost must be measured**. Generated snapshot may lack `.git`; screenshot helper's import-time `git rev-parse`/`git diff` needs provenance supplied by the local gate instead of fabricating a HEAD.

No auto-stage of generated output, no exposure of real `.dev.vars`, no silent prerequisite skip, no arbitrary remote D1, and no pretend remote attestation: Git hooks can be bypassed. If staging fidelity isn't supported yet, fail-closed dirty-input limitation is better than a false “staged green”.

### Cache guidance

- Reuse **immutable build/dependencies** where fingerprint actually matches: production source/asset/config + lockfile/toolchain + relevant synthetic env.
- **Validation identity** additionally includes tests/fixtures/migrations/selector/config/required cases/projects/capture mode.
- Do not cache DB state, login sessions, secrets, or a previous partial green as proof. No elaborate cached-pass platform. Never use mtime as sole equivalence check.

### Test selection and diagnostics

Use Playwright native projects/fixtures/reporters and a small feature/risk map. Affected selection should account for **feature-branch vs PR base plus outstanding uncommitted changes** during iteration, versus **staged index only** when qualifying a specific commit. Unknown/shared auth/DB/harness changes conservatively escalate. Record expected & executed cases/projects and outcome per exact source identity; keep raw traces/logs private and masked PNG opt-in.

---

## 8. Eight bounded EFCC-specific validation decisions [VERIFY]

Only execute the smallest experiments that affect the selected architectural path. **Pilot results don't complete the whole-repo migration.** Each check has a pass condition and a fallback; the agent should turn these into a testable plan, not another generic “research library options” assignment.

| ID | Exact question | Minimum acceptable evidence | If fails |
| --- | --- | --- | --- |
| **V1** | Can pinned Harness host EFCC's emitted vinext/RSC app? | Real build config path, assets, SSR protected redirect, hydrated browser action through harness origin. | Keep relevant Vite lane, show minimal reproduction; don't change app architecture or upgrade silently. |
| **V2** | Can dynamic exact origins preserve native auth? | Allowed native sign-in, cookies, CSRF rejected Origin, reset/update with refreshed contexts; no wildcard. | Do not migrate auth/browser lane until fixed. |
| **V3** | Do app and harness observe the **same D1**, and migrations match? | Run original migrations (including triggers) twice for correct tracking; create via app→read binding; controlled fixture mutate binding→observe app. | No separate fake schema/DB; resolve identity/path mismatch. |
| **V4** | Is isolation robust under failure? | Two harness instances with colliding synthetic identities; one changes role/schema; other unaffected. Confirm reset, after-failure cleanup and original developer vars/D1 untouched. | Stay single worker; do not claim isolated parallel. |
| **V5** | Can ABORT/IGNORE, clock and credential races retain _causal_ proof? | Original-key retry; true held batch past deadline with fresh/expired control; verifier race; persistent restart proof not replaced by reset. | Retain narrow legacy causal fixture, document exception; don't mock away invariant. |
| **V6** | Can presentation test work without success PNG? | Capture-off/on run with **same** overflow, draft/important-control coverage; opt-in PNG secret masking and correct provenance. | Restore original path; don't silently shorten assertion matrix. |
| **V7** | Does local gate prove the staged tree? | Staged-red/unstaged-green, rename/deletion, selector drift, missing prerequisites, index changes, no developer-state mutation. | Explicit fail-closed limitation; no passing claim on wrong tree. |
| **V8** | Does migration lower net cost at same claims/engines? | Old vs new case/project matched wall clock, CLI startups, auth waits, build/reset/migrations, PNGs, CPU/memory; single vs two truly isolated workers. | Keep cheaper valid path for tiny loops; fix measured hotspots. |

**Additional focus from this audit:** canonical Better Auth provisioning **outside production route** (CF09), test-only guard parity (CF06/CF07), Better Auth private verifier patch (CF08), source provenance in Git-index exports (CF10/CF12), and removal of legacy helpers as migration acceptance. These can be added as explicit sub-checks when relevant.

---

## 9. Recommended planning questions / design quality gate [ASSESSMENT]

The agent should make its **own** plan and priorities. It must explain:

1. Which native APIs will own Worker lifecycle, D1, migrations, vars/secrets, ports, API contexts, browser projects, reporting and capture; which old helper is deleted in each phase. If retaining custom, **name the missing library capability and the preserved invariant**.
2. What is the correct runtime mode per test: production-built app via harness, explicit Vite-dev-only regression, and rare auxiliary causal Worker? Avoid duplicate generic runtimes at end state.
3. Why selected reset strategy does not destroy causal state or accidentally assert against another DB; who owns before/after trigger snapshots and failures.
4. How agent will reconcile uncommitted `codex/efcc-testing-foundation` worktree and latest PR head **before** any implementation. Treat local candidate as **unaccepted**, not as proof; never discard edits.
5. What the complete case/claim migration ledger looks like—including loop-generated cases and browser projects—versus this first-pass file table.
6. Whether common happy-path authentication can use isolated fixtures without global limiter waits while preserving true limiter tests, cookie/CSRF and session mutation semantics.
7. How local pre-commit + slim CI balance speed, staged fidelity, and bypass risk without running all cases for docs-only edits; how developer commands remain understandable.
8. Whether a new Programs/Attendance fixture can use shared primitives without writing a new runtime, DB reset, auth helper or screenshot driver.
9. How to measure **net deleted custom infrastructure and duplicate owners**, not only elapsed time and moved files; for example maintain one owner each for runtime, D1, fixture reset, report output.
10. What exact reasons would justify rejecting or narrowing native Harness adoption after EFCC-specific pilots, and what evidence permits retiring legacy Worker managers.

### Definition of done for future implementation (proposed, not already achieved)

- Every original **case / critical claim / browser project / fault permutation** accounted for by latest runner discovery; removed duplicates justified, no silent reduction in effective guarantees.
- A normal developer test never touches private `.wrangler`, `.dev.vars`, real accounts, production D1; failures and interrupts clean up only owned resources.
- Library owners replace generic infrastructure; **superseded custom helpers and imports actually deleted**; exceptions small and documented with an API gap and exact invariant.
- Actual EFCC SSR/RSC, auth/cookie/CSRF, D1 migrations/triggers, business API ingress, presentation and resilience remain verified, not mock equivalents.
- Local staged-tree tests are truthful; fast GitHub Actions unchanged unless owner decides otherwise; required tests cannot be silently dropped or bypassed without an explicit caveat.
- Test-run report states actual SHA/index tree, build identity, selected and executed cases/projects, failures/skips, real durations, privacy classification; historical baseline never misrepresented.
- A new feature consumes a small documented example of fixtures without new runtime/DB/port/capture plumbing. Full source and runner docs updated when implementation approved.

---

## 10. References for the agent (start here; do not repeat solved API research)

### EFCC current-branch sources (pinned to audited SHA)

- [PR #47](https://github.com/Noahlw/efcc-system/pull/47), [package.json](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/package.json), [lockfile](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/pnpm-lock.yaml), [README](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/README.md)
- [playwright.config.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/playwright.config.ts), [vitest.config.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/vitest.config.ts), [wrangler.jsonc](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/wrangler.jsonc), [vite.config.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/vite.config.ts)
- [seed.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/e2e/seed.ts), [staff-fixture.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/e2e/staff-fixture.ts), [local-env.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/scenarios/local-env.ts), [limiter.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/scenarios/limiter.ts)
- [r11-presentation.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/e2e/r11-presentation.ts), [test-setup route](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/src/app/api/internal/test-setup/route.ts), [production proxy](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/src/proxy.ts)
- [business-fault.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/worker/business-fault.ts), [clock-matrix.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/worker/clock-matrix.ts), [credential-race.ts](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/tests/worker/credential-race.ts), [auth implementation](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/src/server/auth/index.ts)
- [.husky/pre-commit](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.husky/pre-commit), [.lintstagedrc.json](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.lintstagedrc.json), [.github/workflows/checks.yml](https://github.com/Noahlw/efcc-system/blob/ba8126d960d02b29fe74ec8b2bcc9085ad86f1cf/.github/workflows/checks.yml)

### Upstream library authorities

- [Pinned Wrangler export](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.145.0/packages/wrangler/src/api/index.ts), [pinned `test-harness.ts`](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.145.0/packages/wrangler/src/api/test-harness.ts), [pinned Playwright example](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.145.0/fixtures/create-test-harness-example/tests/playwright.test.ts)
- [Cloudflare Harness overview](https://developers.cloudflare.com/workers/testing/test-harness/), [configuration](https://developers.cloudflare.com/workers/testing/test-harness/configure/), [test state/migrations](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/), [Worker interaction](https://developers.cloudflare.com/workers/testing/test-harness/interact-with-workers/)
- [Playwright fixture lifecycle](https://playwright.dev/docs/test-fixtures), [API testing](https://playwright.dev/docs/api-testing), [parallelization/sharding](https://playwright.dev/docs/test-sharding), [Git index export](https://git-scm.com/docs/git-checkout-index), [Git hooks](https://git-scm.com/docs/githooks)

### Evidence caveats

This handoff was prepared from the cited remote commit, the owner's supplied Revision 5 draft, the earlier research packet, and first-round source inspection. **No local `codex/efcc-testing-foundation` worktree read, build, benchmark, new E2E, clean final matrix, or migration was performed.** Library support is confirmed at API/source level; **EFCC feasibility remains empirical**. Security-sensitive source readings should be rechecked only if the HEAD/candidate differs, rather than performing an aimless full rescan.

**End of knowledge handoff. The next step is agent-owned PLANNING with explicit owner review, not autonomous implementation.**
