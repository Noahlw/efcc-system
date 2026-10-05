# R11 design qualification

5 October 2026 · Synthetic prototype boundary only. The corrected state is `unavailable/auth`.

## Newly exercised R11 evidence

- `node screenbook/check.mjs`: 40 screens / 306 states render; destinations, assets, headings, descriptions and critical design boundaries pass. Authentication-unavailable exposes no signed-in frame/navigation across default, Staff and restricted contexts.
- [Render comparison](verification/render-comparison.json): 918 state/context comparisons; only authentication-unavailable changes in the three contexts, with 915 unchanged results. This preserves the other rendered fixture states; it does not prove their production behavior.
- [Native responsive results](verification/responsive.json): 320×740, 390×844, 768×1024, 1280×720, 1920×1080 and 812×375, plus 200% root text at phone/desktop sizes. No horizontal overflow or unverified identity/navigation; controls remain reachable. Enlarged text is a preview fixture, not physical OS/browser zoom qualification.
- [Native interactions](verification/interaction-checks.json): retry reaches the sign-in fixture; sign-out reaches its pending fixture; keyboard Tab reaches the final sign-out action at 200% text. These are real browser interactions with synthetic actions, not authenticated service calls.
- [Runtime logs](verification/runtime-logs.json) are empty; the one mechanical detector pass returned [no findings](verification/detector.json).

## Implementation-turn browser spot checks

- In the local R11 screenbook, synthetic Staff sign-in reached personal Home; Management opened the account list, then a selected-person detail and identity review.
- Typing into the identity form and following its Return link showed the unsent-change dialog. Continue editing returned to the form with the edit intact.
- The in-work password confirmation opened as a task-focused dialog and returned to the same identity/review route without submitting. The local preview then showed the original profile name instead of the edited name. This is a known pre-existing reference limitation, reproduced against the archived R9 preview; child [#39](https://github.com/Noahlw/efcc-system/issues/39) owns preserving identity edits through the production confirmation/review flow.
- At the screenbook's 320px fixture with 200% root text, the preview remained 320px wide (`scrollWidth` 320px; root font 32px). Authentication-unavailable showed retry and sign-out only, without signed-in identity or protected navigation. Ten visible overview images loaded successfully.
- The CUA browser log returned one `MutationObserver.observe` TypeError without a source URL or stack on both the R11 tab and an archived R9 tab. The screenbook source contains no `MutationObserver` use, so it is not attributed to the candidate; this spot check is not reported as a clean browser-console run.

## Still-valid historical evidence

The retained 80 primary phone/desktop captures are from R9. They remain default-screen references because none of those rendered defaults changed; the corrected alternative authentication-unavailable state has separate new captures. [Historical summary](verification/prior-r9-summary.json) identifies 320 geometry cases (240 normal, 80 enlarged text), 306 state geometry cases, 21 native interactions and 40 end-control checks. These were not rerun wholesale for R11.

The original R9 archive is recoverable from commit `ebb06a299fc70863b478d8eaf9091e8b78c6e961` at `docs/design/slice-1-2-ui/design-book-revision-9.zip`. Its identity is retained in the summary. Repeated raw capture folders and superseded active archives are removed; historical proof is not relabelled as a new run.

## Candidate and limits

The [manifest](manifest.json) identifies this current reference's files. Production source remains at baseline `100bde89af5b8177e7625bd9b36580c0ab254c43`. No production test run, physical PWA/keyboard/OS zoom qualification, completed independent code acceptance, merge, deployment or release is claimed. Real authority/recovery evidence remains necessary during eventual implementation.
