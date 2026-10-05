# EFCC UI design QA — Revision 9

The [R9 report](audit-r9/report.md) records current source-bound captures, 240 normal viewport cases, 80 enlarged-text cases, 306 selectable states and 21 native fixture interaction checks. [End-control evidence](audit-r9/end-controls.json) covers all 40 screens at 320×568 with 200% root text. [The manifest](audit-r9/manifest.json) binds source and evidence; `node audit-r9/verify.mjs` checks it after extraction.

These are synthetic browser/DOM and source checks. They do not qualify real authentication, authorization, Worker/D1 persistence, physical PWA, virtual keyboard, OS zoom, Safari or assistive technology. The installed Impeccable browser detector requires `document.createElement`, unavailable in the CUA read-only evaluator; its final pass is unperformed. Geometry, native interactions and screenshot inspection are recorded separately.
