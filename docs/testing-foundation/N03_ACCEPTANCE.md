# N03 / #69 access, name sign-in and limiter claim disposition

Base: `8b6d6131c4078654502919853f3edd792351c5c2`. Scope: access-foundation, name-sign-in, real rate-limit denial/recovery, immutable account templates and the public-auth-boundary Node test. No product code or shared Playwright fixture/config was changed.

## Original claims and native replacements

All three original families remain executable; the selected native discovery contained 33 logical cases, with the 11 `@mobile-critical` browser cases also executed in both mobile projects.

| Original family / claim | Native evidence retained |
| --- | --- |
| Access: unused auth routes/methods | Unsupported endpoints and methods remain refused; usable session lookup remains available without a cookie. |
| Access: anonymous controls | Browser home/status remain anonymous; redirects and business-read denial are asserted with private/no-store cache controls and no session cookie. |
| Access: sign-in reason | Only the validated authentication reason is displayed; untrusted or duplicated query values disclose nothing. |
| Access: approved account | Real UI sign-in reaches Home, exposes only the actor's identity, preserves navigation/focus/target-size claims, and real sign-out invalidates the session. |
| Access: denied credentials and account state | Invalid credentials do not grant Home/business access; restricted actors can reach status while church-business access stays denied. |
| Access: actor isolation | Two case-owned accounts cannot read each other's identity. |
| Access: Origin/CSRF | Untrusted Origin sign-in/sign-out are refused; cookie/session state remains unchanged. |
| Name: draft and UI outcomes | Password reveal and unsent-draft navigation preserve drafts without submitting; permitted Staff reach Management through real UI navigation. |
| Name: identifiers and account state | Unique Chinese-name sign-in uses the Username credential engine; Username case is ignored while canonical identity is preserved; verified and unverified email states retain their supported identifier behavior. |
| Name: ambiguity and non-enumeration | Duplicate full names require Username, return the expected ambiguity result, disclose no account/email identifiers, and create no session. The deliberate collision is local to a dedicated store. |
| Name: canonicalization | Trimming, full-width forms and Latin case resolve to one account; repeated internal spaces, compatibility forms and Cyrillic case distinctions remain separate identities; Traditional and Simplified names remain distinct. |
| Name: denial and public boundary | Wrong password, unknown name, restricted status, method/path and untrusted-Origin cases remain fail-closed. |
| Name: browser flows and temporary credentials | The UI switches modes, falls back to Username for ambiguity, preserves the expected draft/navigation, reports expired temporary credentials in both modes, and recovers from injected rate-limit/network failures in both modes. |
| Rate limit: real denial and recovery | For Username and name entry separately, different account identifiers share the case's real IP bucket; three failed attempts are allowed, the fourth is denied, the actual D1 bucket is inspected, and valid sign-in recovers only after its observed real window. The name and Username paths remain separate buckets. |

## Store ownership and retired helpers

Ordinary accounts use fixture-generated unique identities; the native `extraHTTPHeaders` fixture emits a per-test randomized IPv6 /64. Static collision/global lookup cases and both real-window cases select `dedicatedApp`. The approved/restricted account arrays and every account template object are frozen; the intentional duplicate-name account exists only as an immutable scenario-local input. No generic pacing, limiter scan, seed HTTP, generic SQL wrapper, manual auth/context/origin owner, or custom capture plumbing remains in these three specs.

At the N03 source boundary, the legacy limiter owner had 11 callers outside these specs, explicitly recorded for N18 retirement in `docs/adr/0002-native-testing-runtime.md`: `account-application.spec.ts`, `account-decisions.spec.ts`, `account-identity.spec.ts`, `account-security.spec.ts`, `guard-failures.spec.ts`, `home-notices.spec.ts`, `home-participation.spec.ts`, `r11-ui.spec.ts`, `restricted-status.spec.ts`, `session-renewal.spec.ts`, and `zz-worker-faults.spec.ts`. Sibling ticket migrations retire their own callers; N18 removes the helper once the final source scan proves zero consumers. `tests/e2e/seed.ts` only received the readonly account-type contract; its legacy transport remains until its consumers migrate. No N03 feature test adds a legacy owner.

`tests/worker/public-auth-boundary.test.ts` remains a pure Node allowlist test, not Worker-ingress evidence. The N03 browser case uses the parent-owned N02 presentation helper correction from `d64c1d8`; no N15/R11 cases were imported.

The historical candidate disposition remains **do not adopt wholesale** in `CANDIDATE_DISPOSITION.md`. This implementation did not repeat that review or apply the packaged patch; the table above maps the replaced N03 claims to their native cases.

## Qualification

Pinned toolchain: Node 24.21.0, pnpm 10.33.2, Wrangler 4.145.0, Playwright 1.63.0, macOS arm64. The ignored selector imported the shared feature projects and selected exactly the three N03 spec files; it was removed before commit. The required suite discovery was 55 entries: HTTP 21, Chromium 12, iPhone 15 Pro WebKit 11, Pixel 7 Chromium 11. All projects used two workers, zero retries, and zero silent skips. The settled capture-off matrix passed **55/55** with zero failures/skips/retries. The pure Node public-auth test passed **5/5**.

Build and checks: `pnpm build:native` and `pnpm build:test-provision` passed before the initial feature run. After the test-only corrections, `pnpm check` and `pnpm typecheck` passed. No production source changed after those builds. Final native results are local at `.scratch/efcc-native-n03-results/capture-off/results.json`; raw invocation outputs are session-local (`artifact://647` first run; `artifact://667` settled run), not portable attestations. The matrix was capture-off; it did not generate success screenshots.

First full run: **51/55 passed, 4 failed, 0 skipped, 0 retries**. Both rate-limit claims reached the real fourth-attempt denial, then the test compared a compressed request IPv6 string with Better Auth's expanded, /64-masked D1 identity. The Chromium and Pixel approved-sign-in cases failed because Playwright `Response.headers()` omits cookie-related headers. The expected D1 key is now independently derived from the native fixture's four-hextet /64, and the UI assertion reads `Response.allHeaders()`; no application behavior was weakened. Fresh settled run: **55/55 passed**.
