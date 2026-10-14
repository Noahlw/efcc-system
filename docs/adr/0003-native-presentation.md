# 0003 — Native qualification presentation and artifacts (N02 / #68)

## Decision

Playwright owns screenshot buffers, original-byte locator masks, attachments and list/JSON/HTML reports. `qualifyPresentation(page, testInfo, screen, { drafts, criticalAction, masks?, focus? })` requires explicit domain locators. All original eight responsive/root-font contexts plus the project's original viewport are asserted before optional capture begins. No screenshot, animation suppression or network-idle operation synchronizes behavioral assertions. Success attachments require `EFCC_CAPTURE_SUCCESS=1`; failures retain private native traces. Unmasked failure logs/traces are never publishable. No Design Book or accepted comparison pack changes.

Source provenance enters once through `EFCC_TEST_SOURCE` in native config metadata, supplied by the Git gate. There is no import-time Git execution, custom writer, image hash, gallery or custom reporter.

## Scope and claim disposition

All five original qualification cases remain real browser cases: numerical typography/44px controls/contrast/focus/actual clipboard paste and keyboard login; actual shared limiter denial/window/recovery; aborted-network safe message; real `route.fetch()` response held for 500ms and duplicate prevention; phone username/name active/pending login, logout and overflow. Canonical per-case RPC prerequisites replace shared roster, seed and ordinary shared-bucket pacing. The limiter test keeps the same intended IP identity for failed HTTP requests and browser denial/recovery, observes its actual app D1 bucket, and waits for that bucket's real window without resetting it. The sixth case explicitly exercises draft/focus/action across all contexts and proves original masked PNG bytes do not change when a visible secret changes.

`playwright.features.config.ts` now discovers all migrated feature families. Cases use `@native` and exactly one of `@browser` / `@http`. Chromium runs all browser cases; iPhone WebKit393×852/DPR3 and Pixel Chromium412×915/DPR2.625 select `@mobile-critical`. HTTP runs once. Clipboard/desktop numerical baseline is Chromium-only. Viewport/root-font and phone profiles are emulation, not physical-device/native-zoom proof. The old Vite default config and its import-time environment owner were deleted in N18; the necessary dev hydration claim has its own native config.

Native feature evidence is worktree-local ignored `test-results/native-features/{capture-off,capture-on}`. Reporters preserve discovered/executed case/project scope and failures; retries are disabled, any diagnostic repair run must be disclosed. N19 owns complete final-candidate qualification, not this slice.

## Completed bridge contraction

N03–N15 migrated every presentation consumer to native fixtures and explicit draft/critical-action locators. N18 removed the optional fourth argument and last-visible-control inference; TypeScript now checks the contract for every caller. Existing screen-specific assertions, including `phone` metadata-label wrapping, remain. Default masks cover current/new-password inputs and one-time temporary-password output, including revealed passwords; additional feature secrets use explicit masks.

## Alternatives

Retaining JSON/hash/gallery/filesystem plumbing duplicates native ownership and is rejected. Automatically choosing the last visible control for new callers is rejected: it does not establish the intended critical action. Using screenshot animation-disable or capture completion as assertion readiness is rejected: capture-off must exercise the same behavior. A general page-object/testing framework is unnecessary; explicit locators are the only retained EFCC assertion seam.

## Executed slice evidence (2026-10-13)

Baseline `55d9b8f62d9b3539401728282efdae40050a9e9c`; Node 24.21.0 / pnpm 10.33.2 / Playwright 1.63.0 / Wrangler 4.145.0, macOS arm64. Frozen/prefer-offline install, native-test production build, provision Worker dry-run and native Chromium/WebKit installation succeeded. Native discovery selected exactly 16 executions: six Chromium and five per phone engine; no N02 HTTP-only execution.

First capture-off run: 11 passed / 5 failed / 0 skipped / 0 retries. Three failures were the test's unnormalized IPv6 D1-key expectation; pinned native source demonstrated expanded /64 normalization. Two were original-PNG comparison with unequal input focus states on mobile. Repair preserved the same intended request identity and compared masked bytes with equal focus/scroll state; no production or assertion threshold change.

Settled full slice: capture-off 16/16 (34.1s), capture-on 16/16 (32.0s), zero failures/skips/retries/flaky cases. Native JSON scope assertions confirmed 6/5/5 counts, browser/native tags and zero off / 54 on PNG attachments (nine contexts × two viewpoints × three engines). The initial report-parser experiment incorrectly expected `@` prefixes in JSON tags; native reporters emit bare tag names. Corrected scope assertions passed; this was not an application/test failure.

Private local evidence: `test-results/native-features/first-failure`, `capture-off`, and `capture-on` native reports/artifacts. First-failure traces remain preserved rather than overwritten by repairs. These paths are private, ignored and worktree-owned; raw diagnostics must not be published. Independent source/spec review, legacy-bridge workflows, final integration and N19 whole-Spec qualification are not claimed by this slice.
