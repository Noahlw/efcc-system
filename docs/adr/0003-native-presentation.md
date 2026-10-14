# 0003 — Native qualification presentation and artifacts (N02 / #68)

## Decision

Playwright owns screenshot buffers, original-byte locator masks, attachments and list/JSON/HTML reports. `qualifyPresentation(page, testInfo, screen, { drafts, criticalAction, masks?, focus? })` requires explicit domain locators. All original eight responsive/root-font contexts plus the project's original viewport are asserted before optional capture begins. No screenshot, animation suppression or network-idle operation synchronizes behavioral assertions. Success attachments require `EFCC_CAPTURE_SUCCESS=1`; failures retain private native traces. Unmasked failure logs/traces are never publishable. No Design Book or accepted comparison pack changes.

Source provenance enters once through `EFCC_TEST_SOURCE` in native config metadata, supplied by the Git gate. There is no import-time Git execution, custom writer, image hash, gallery or custom reporter.

## Completed bridge contraction

N03–N15 migrated every presentation consumer to native fixtures and explicit draft/critical-action locators. N18 removed the optional fourth argument and last-visible-control inference; TypeScript now checks the contract for every caller. Existing screen-specific assertions, including `phone` metadata-label wrapping, remain. Default masks cover current/new-password inputs and one-time temporary-password output, including revealed passwords; additional feature secrets use explicit masks.

## Alternatives

Retaining JSON/hash/gallery/filesystem plumbing duplicates native ownership and is rejected. Automatically choosing the last visible control for new callers is rejected: it does not establish the intended critical action. Using screenshot animation-disable or capture completion as assertion readiness is rejected: capture-off must exercise the same behavior. A general page-object/testing framework is unnecessary; explicit locators are the only retained EFCC assertion seam.

Historical case/engine/capture results, first failures and limitations: [#68](https://github.com/Noahlw/efcc-system/issues/68#issuecomment-6165612472). Current usage: [testing.md](../testing.md).
