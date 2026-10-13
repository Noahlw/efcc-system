# N14 / #80 acceptance evidence

## Source and boundaries

- Live ticket #80 was read before implementation; it remained OPEN. This work belongs to `codex/testing-foundation-n14` in `/Users/noah.wong/.codex/worktrees/efcc-native-n14`.
- N14 source commit containing the final origin-probe isolation fix: `47ac4db2f78736f1c31e804a8a13d825bcee4585`.
- Qualification also used the NativeJourneys-owned `tests/e2e/r11-presentation.ts` source from `d64c1d8fe166bc94932feed02d003c4d479eeedb`. That change is intentionally not part of the N14 commit; the parent owns syncing it. The browser cases exercised this helper as present in the N14 worktree.
- Fault injection is confined to fresh, harness-owned disposable native stores using the original migrations. No personal `.wrangler` store, remote D1, production data, or external service was used. The provision RPC remains only for synthetic test accounts. Business-fault requests traverse the actual app ingress; no direct handler invocation or replacement Worker router is used.
- Native app-error behavior is a separate SSR unit test, not counted as a browser pass.

## Claim-to-case disposition

| Original claim | Preserved evidence |
| --- | --- |
| D1 CHECK constraints reject unsupported writes without changing valid stored state; invalid Home domain states and notice targets are rejected. | `guard-failures.spec.ts`: “normal D1 writes reject unsupported membership values” checks both the constraint failure and that the stored membership remains `active`; “Home domain writes reject invalid states and notice targets” checks the D1 write constraints and target invariants. These run through the app-owned native D1 binding. |
| Unsupported persisted membership fails closed, reports typed status, and recovers after restoring the original row. | “unsupported membership fails closed until corrected” introduces `legacy_unknown` only in its fresh case store with `PRAGMA ignore_check_constraints`, verifies the `/` redirect, denied `/api/v2/me`, and unavailable status reasons (including the combined ban case), restores `membership_status` and `banned_at` in `finally`, then verifies the restored row and successful `/api/v2/me`. |
| Access-guard schema read failure yields a safe typed API error, safe unavailable UI, and usable recovery. | “an access-guard D1 fault yields a typed API error and the retry page” renames the real `session` table in a dedicated store, asserts private/no-store typed API failure and safe redirects, checks that rendered UI hides username/SQL/schema details, restores the table in `finally`, then verifies API and browser retry recovery. The presentation contract retains explicit critical action, draft, and focus qualification; it also checks 320px/200% no-overflow and the 1440px desktop sidebar geometry. |
| Real address-limiting cannot be bypassed by spoofing `X-Forwarded-For`; recovery is observed with real time. | “rotating x-forwarded-for cannot evade the username limiter” and “…the name limiter” exercise actual native auth requests and real limiter windows, then verify release/recovery. No clock mocking, mutation retries, or hidden skips are used. |
| Evil Origins and spoofed internal identity headers cannot authenticate or impersonate a user. | `zz-worker-faults.spec.ts`: “native auth origins reject evil origins and unmatched paths” checks four cross-origin username/name and trailing-slash requests for 403/no session cookie, successful same-origin normalized and exact sign-in with cookies, forbidden cross-origin sign-out, and that spoofed `x-efcc-*` headers do not change the authenticated account identity. The trailing slash is accepted by the production route when same-origin; the test records that observed behavior rather than claiming a 404. |
| A genuine post-guard identity-read D1 fault is generic and contained, with an unaffected-store control and restored recovery. | “real production ingress contains the post-guard identity read fault” renames `person_profile.account_role` after access guard success, expects the production `/api/v2/me` generic 500/private-no-store response, and proves an independently provisioned account in the unaffected Worker store still reads successfully during the fault. It checks private Worker log messages for the expected error events and absence of SQL/schema diagnostics and the session token. The original column is restored in `finally`, then the affected session succeeds again. |
| Auth session-read failure is generic, private, and recovers after schema restoration. | “auth session read failure stays generic and recovers after schema restore” renames `session` in a fresh store, checks the production Better Auth ingress returns a generic error without a redirect or private diagnostic/session token in logs, restores the table in `finally`, and verifies a successful subsequent session read. The auth route has only the narrow production 5xx sanitization seam required for this behavior. |
| Browser-facing D1 read failures hide private diagnostics and recover. | “injected local D1 read failure shows generic unavailable recovery” and “a status read failure exposes no SQL and retry reloads current status” run in the required Chromium, iPhone WebKit, and Pixel Chromium browser projects. They use actual D1 faults, inspect safe UI/no SQL exposure, restore the source schema, and verify retry/current-status recovery. |
| App-error SSR markup remains safe and semantic without implying browser coverage. | `tests/ui/app-error.test.tsx` renders the real `AppError` to static markup; checks compact recovery actions on Auth routes and `main`, `h1`, `role=alert`, localized retry/account links, and omission of private exception text. It does not add a QueryProvider or claim browser behavior. |

The replaced copied business-fault Worker owner was deleted (`tests/worker/business-fault.ts`). Assigned fault cases no longer carry a private process manager, assets/ports/health/control route, copied auth/header/error routing, or direct handler proof. Test mutations, schema restores, and HTTP/browser assertions use the native harness and real application pipeline. Shared Playwright config/fixtures and parent-owned scenario owners were not edited. `tests/worker/provision.ts` and `dedicatedApp` remain because the normal native fixture needs synthetic account provisioning and isolated test stores.

## Qualification performed

Pinned runtime: Node `24.21.0`, pnpm `10.33.2`.

Command sequence:

```text
pnpm build:native
pnpm build:test-provision
pnpm exec playwright test --config .scratch/playwright.n14.config.ts
pnpm exec vitest run tests/ui/app-error.test.tsx
```

- Native production build passed; `build:test-provision` completed Wrangler dry-run with the app-owned D1 binding.
- Focused Playwright matrix: **17 passed**, 0 failed, no skipped or retried cases reported, 2 workers. Projects: `features-http` 8/8; `features-chromium` 3/3; `features-iphone-webkit` 3/3; `features-pixel-chromium` 3/3. The `@mobile-critical` UI scenarios ran under the configured iPhone 15 Pro WebKit and Pixel 7 Chromium profiles. Final private transcript: `artifact://829`; private artifact directory: `/tmp/efcc-testing-foundation-n14-evidence/final4/artifacts`.
- App-error SSR fast test: **1 file / 5 tests passed** (`pnpm exec vitest run tests/ui/app-error.test.tsx`). This is separate from the 17 browser/HTTP cases.
- The `.scratch` Playwright config is ignored and temporary; it imported the shared native feature config, selected only the assigned `guard-failures.spec.ts` and `zz-worker-faults.spec.ts`, and wrote artifacts outside the repository.

Earlier failed evidence is retained privately and is not counted as acceptance:

- `artifact://609`: 15/17. The initial origin expectation treated a trailing slash as an unmatched 404, while the actual route accepted the normalized path; the auth session fault also exposed Better Auth's returned failure rather than the intended generic response.
- `artifact://615`: 15/17. Subsequent origin/cache assertions still mismatched actual production behavior (cross-origin trailing-path requests returned 403, and the cache header was `no-store`, not the asserted exact `private, no-store`).
- `artifact://624`: 16/17. A repeated same-account sign-in hit the real limiter (429). The final origin scenario provisions a separate synthetic account for the normalized trailing-path success and separates its trusted test IP from the exact-path account, avoiding a shared rate bucket rather than weakening the production limiter.
- A prior 17/17 attempt (`artifact://626`) is also not used in place of the final `artifact://829` run on the recorded source. Raw traces and error contexts remain private; none are committed or published.

## Separate parent-owned changed-path evidence

Main first replaced the N14 local auth-route implementation with the shared generic response helper in `90e7097`. Then, on integration source `64f1b24`, Main reported fresh native/provision builds passed and `tests/e2e/zz-worker-faults.spec.ts:308` ran **1/1** for the generic auth session fault/restore path (private run reference `artifact://809`, terminal output referenced as `artifact://808`). This is a separate parent-owned changed-path result, not part of the N14 17-case matrix or a substitute for it. The combined final review remains parent-owned. Artifact and `/tmp` references are local-only evidence, not portable proof.
