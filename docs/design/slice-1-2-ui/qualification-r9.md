# R9 all-screen design qualification

5 October 2026 · synthetic prototype · owner-confirmed whole Slice 1–2 foundation.

## Changes and observed repairs

One frame stylesheet now owns scroll regions, content widths, title/header rules, navigation reservation, form/control sizing, spacing and responsive grids across all 40 subflows. Narrow tasks are centred on desktop. Auth is a compact central canvas; selected-person desktop work uses list/detail, while Home and Account adapt to usable container width. Historical duplicate frame declarations were removed from component decoration.

Initial 200% text inspection exposed seven root-screen observations: wrapped navigation exceeded fixed reserved space, Home grid min-content escaped the narrow viewport, and management tabs could not wrap. One shared repair made the footer's intrinsic size reserve its space, gave grid children zero minimum width and allowed tabs to wrap. Current confirmation records have no geometry flags. `geometry-pass1.json` retains initial and confirmation observations; `geometry.json` contains the final 320 records. An evidence collector originally retained old array entries; the final file was selected from the actual post-fix observations, not inferred from the first pass.

Native Home flow verification also exposed missing semantic selection state. Calendar and All buttons now expose `aria-pressed`; Home captures, eight viewport/text cases and all eight Home states were refreshed. Other frame observations remain valid because this correction only changes Home selection semantics.

## Current evidence

- 240 primary viewport cases: all 40 at 320×568, 390×844, 768×1024, 1024×768, 1440×1024 and 844×390.
- 80 enlarged-text cases: all 40 at 320×568 and 1440×1024 with body 34px (200% root-font fixture).
- 306 selectable states at 320×568: overflow, main clipping, effective target sizes, title count, navigation reservation and dialog bounds.
- 80 primary screenshots and DOM snapshots: every screen at phone 390 and desktop 1440. Six desktop before captures preserve the actual pre-R9 layout for comparison.
- 21 native fixture interaction checks: same-name selection/target context, deliberate empty email/false shared phone, modal keyboard/cancel/Escape, confirmation then separate submit, dirty warning/discard, list search restoration, Home future date/All, original-reference reconciliation/retry, compact sign-out retry, Inbox decision privacy, read-only audit, one-time handover, independent restrictions, blocked deletion and public form validation.
- 40 final-control reachability checks at 320×568 with 200% text. Audit cards can exceed the visible main height: native End scrolling proves the final card bottom can pass above navigation. Natural scrolling is retained rather than imposing fixed-height cards.
- Saved runtime warnings/errors for these synthetic runs are empty. `node check.mjs` checks all fixtures and actual shared rendering invariants. `node audit-r9/verify.mjs` verifies source/evidence identity and coverage after extraction.

## Limits

The preview has no API/D1 integration, actual permission changes or durable reconciliation. Native browser checks are not physical-device PWA, soft-keyboard, OS zoom, Safari or assistive technology qualification. The installed design detector initializes overlays through `document.createElement`, which the available read-only CUA evaluator does not expose; its final pass is unperformed. Geometry and interaction evidence are independent of that limitation. Production qualification remains required on the eventual implementation candidate.

The source/evidence manifest is candidate-bound. Changed rendering invalidates affected screenshots/flows; saved proof does not automatically apply to production. This is design/reference qualification, not implementation approval, merge, deployment or release.
