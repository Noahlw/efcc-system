# N11 — native account security and verifier construction

## Boundaries and retained seam

`src/server/auth/password-verification.ts` supplies trusted construction-only public Better Auth password options. Its production value is `undefined`: native hashing/verification, auth caching, hooks, guards, business routing, permissions and response behavior remain unchanged. No request header, environment flag or HTTP route selects a verifier.

Pinned Better Auth 1.7.7 exposes `emailAndPassword.password.verify({hash,password}): Promise<boolean>` and `better-auth/crypto` exports `verifyPassword`. Official pinned options: <https://github.com/better-auth/better-auth/blob/db02f233918ad1233bf0753e437e1c0da353273d/packages/core/src/types/init-options.ts>.

`node scripts/build-credential-race.ts` uses the existing native-test Vite configuration and Vite `createBuilder().buildApp()` to build the actual vinext RSC/client/SSR application. A test-only load plugin replaces only the trusted construction module with public verification delegating genuine `verifyPassword`; only successful verification calls the barrier. Artifact assembly adds a default RPC wrapper alongside unchanged emitted `index.js`, preserving emitted bindings, migrations, module rules and assets. The wrapper installs its test-only callback before dynamically importing that actual app and delegates fetch to its production entrypoint. The verifier and per-isolate cached auth effect are therefore in the same actual application isolate, not a same-D1 auth sidecar.

`CredentialControl` provides `arm()`, `verified()` → `{armed,held,verified,completed}`, and `release()`. One successful verification can be held; overlapping arm fails; other production requests continue. Release disarms or frees the held request, including failure cleanup. Native timers keep the held request alive; they do not fake time. The dedicated credential fixture owns native listen/update/migrations/getEnv/getExport/close and releases acquired controls before close. Parent may consolidate its emitted-config composition with N12; no separate runner/process/SQL owner is introduced.

## Original case-claim disposition

All 18 original selected cases remain, with six distinct fault permutations, rather than reducing the family to a pilot. HTTP cases run once; five original browser cases run Chromium, original iPhone 15 Pro WebKit and Pixel 7 Chromium (28 execution entries).

| Original case | Native layer and preserved independent claims |
| --- | --- |
| Own password change | HTTP: exact current session retained; every other session revoked; old/new credentials denied/allowed; independent session rows |
| Validation/replay/conflict | HTTP: wrong/short passwords, absent pre-effect receipt, identical replay, changed-payload conflict, exactly one audit/receipt |
| Logout other sessions | Browser ×3: requesting session retained; another-account targeting denied; other holder revoked, outsider unaffected; immutable replay and foreign receipt privacy |
| Confirmation | HTTP: current/session-bound native proof; exactly ten-minute receipt expiry; separate-session denial; expiry and database invalid receipt-window rejection |
| Account ABORT and IGNORE | Dedicated HTTP ×2: unchanged hash/revision, both sessions usable, zero audit/receipt, original-key recovery after fault removal |
| Audit ABORT and IGNORE | Dedicated HTTP ×2: same rollback and original-key recovery claims |
| Session ABORT and IGNORE | Dedicated HTTP ×2: same rollback and original-key recovery claims |
| Restricted holder controls | HTTP: restriction remains; Account controls allowed; exact negative Origin; four independent real limiter buckets; forbidden native endpoints unavailable |
| Stale proof insertion | HTTP plus actual binding: committed credential revision rejects independently inserted stale session |
| Username/name credential race | Dedicated production HTTP: armed wrong password does not park; genuine native success holds; overlapping arm rejects; current actor requests/password change continue; both stale proofs reject without cookies; one retained session; real session INSERT ABORT returns safe500/no SQL/hash log; release and subsequent login recover |
| Lost password response | Browser ×3: actual committed response dropped, UNKNOWN, no password in persisted metadata, reload/original receipt recovery, current session remains, subsequent confirmation |
| Temporary-password completion | Browser ×3: wrong-password failure; storage read-back failure prevents send; original-key reconcile/retry; secrets cleared and disabled in flight; one submission; authoritative restricted status remains; historical receipt cannot lift a later temporary gate |
| Draft Back/discard | Browser ×3: password/confirmation drafts retained until explicit discard, exact task navigation |
| Reconcile cancellation | Browser ×3: same captured request aborted before held sign-in document unload; native engine cancellation protocol accepted, not an unrelated subsequent request |
| Ignored credential write | Dedicated HTTP: safe failure; independent zero revision/audit/receipt; original-key recovery |
| Fast security contract | Existing Vitest file unchanged: four independent metadata/receipt grammar tests; no legacy infrastructure to remove |

## Retirement and remaining consumers

Account-security no longer imports seed/CLI SQL, shared limiter pacing, local variables/fixed origins or inline process/assets/ports/health/controlHTTP/kill. Credential Worker no longer imports a direct auth handler or patches private `$context.password.verify`. Actual app D1 `prepare/run/all/batch` owns setup, fault controls and independent observations; scenario state is not reset.

The original assisted-account family also consumed the old credential Worker; N13 must use this same public native control contract before integration retirement is complete. The parent exclusively owns shared fixture/package/Playwright configuration integration. Family discovery is `account-security.spec.ts`, `@native` plus `@http` or `@browser`, browser `@mobile-critical`, `@risk-auth`/`@risk-security`, and fault/race `@resilience`.

## Qualification and first failures

Environment: macOS arm64, Node24.21.0, pnpm10.33.2, Better Auth1.7.7, Wrangler4.145.0. Owned disposable synthetic harness stores only; no developer variables, personal `.wrangler` or remote D1 read.

- Locked frozen/prefer-offline install succeeded.
- Native production and provisioning builds succeeded. First injection experiment incorrectly used single-environment Vite `build()` and failed RSC assets-manifest construction; corrected to application `createBuilder().buildApp()`, preserving the actual pipeline.
- First full matrix executed28: 10passed/18failed, zero skips/retries. Native D1 `exec()` splits multiline SQL; corrected domain statements/triggers to native `prepare().run()` and coupled temporary setup to `batch()`. Native RPC throws synchronously on overlapping arm; assertion now captures that. Exact confirmation heading is scoped by level1 because the dialog includes its own heading.
- Second matrix executed28: 27passed/1failed, zero skips/retries. WebKit reports captured-request cancellation as `cancelled`, Chromium as `ABORTED`; preserved the actual cancellation and held-document causal claim across engines.
- Subsequent matrix: 28required/28executed/28passed, zero skips/retries; HTTP13, Chromium5, iPhone WebKit5, Pixel Chromium5. Typecheck passed and fast security contract4/4 passed. Final post-format qualification rebuilt native production/provisioning/injected actual app, passed typecheck and security contract4/4, then passed28/28 in27.9seconds with two workers, zero failures/skips/retries. The ignored temporary selection configuration was removed before commit. Delivery supplies the immutable commit identity.
- Private first/second failure reports retained under ignored `test-results/n11-first-failure` and `test-results/n11-second-failure`; never publish raw traces or session state.

A hashline-edit tool anomaly removed arbitrary characters from unchanged security source and reported 1647 parse diagnostics. Fresh raw read confirmed corruption before any build/test. The assigned file was recovered from tracked base bytes and replaced as a whole; this is a tooling incident, not an application regression or waived qualification failure. Independent review and whole-integration qualification remain the parent's responsibility; bounded N11 evidence is not whole-Spec66 acceptance.
