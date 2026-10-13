# PR #47 D01–D19 implementation record

Remote HEAD verified before work: `1fd5e1c563fd1f2da63b779213360448a128c49a` (2026-10-13). Source: owner-supplied **PR47_UI_Photo_Diff_Review.md**, D01–D19, its content-order proposals and missing-Book-state rule. The owner's implementation request approves the named fixes/extensions; the attachment's historical read-only/approval wording does not require another approval cycle. Owner explicitly overrides full E2E: run edited/affected gates only.

One-time decisions: native read-only disclosures after main controls; all changed/submitted values, actual safety impact and required verification remain primary; unchanged/technical data stays inspectable. Handover uses only the original in-memory issuance and committed expiry. Target switching reuses existing dirty navigation, preserves search and is disabled whenever an original operation is pending. Audit uses only its existing authorized projection: full actor/target IDs remain labelled/inspectable; no fabricated names or new queries. Dates use native Hong Kong calendar/24-hour display without timestamp changes. Existing SVG owner adds the Book plus glyph; no Lucide installation. D18 approved safe-frame variants and D19 correct screens receive verification, not redesign. No implementation blocker identified; owner appearance acceptance remains pending.

| Finding | Package | Approved reference / disposition | Existing owner |
| --- | --- | --- | --- |
| D01 | VF02 | Book handover + approved six-step credential order; receipt below main controls | staff-accounts-form.tsx |
| D02 | VF03 | Book ban/unban/deactivate/reactivate review + approved four-row review/detail grouping | restrictions-form.tsx |
| D03 | VF04 | Book deletion/review + secondary truthful missing-Username fallback and technical IDs | deletion-form.tsx |
| D04 | VF05 | Book identity/create/decision review; submitted changes/decision/private note stay primary | identity-form-views.tsx;staff-accounts-form.tsx;decision-review.tsx |
| D05 | VF06 | Book applications/default status/count/row roles, authorized real data only | decision-review.tsx |
| D06 | VF06 | Book audit/default/detail; labelled actor/target from existing ID-only projection | account-audit/page.tsx |
| D07 | VF06 | Book management/accounts; plus/shield SVG, search label, selection only when selected | staff-management-workspace.tsx;staff-people-list.tsx;icon.tsx |
| D08 | VF06 | Book target-card switch + approved existing dirty/pending protection | operation-presentation.tsx;existing task owners |
| D09 | VF06 | Book Hong Kong calendar/time display; same instant/time zone | church-time.ts;existing callers |
| D10 | VF05 | Book confirmation modal + approved compact immutable task context; precise action-specific errors | security-form-views.tsx;security-form.tsx |
| D11 | VF05 | Approved extension: Book Task tokens, changed current→new fields before unchanged disclosure | applicant-form.tsx |
| D12 | VF05 | Approved extension: existing reject segments/context, inline invalid outline/error/count/focus | decision-review.tsx;app-form.tsx |
| D13 | VF02 | Approved extension: copy failure beside live secret/Copy; manual selection, no reissue | staff-accounts-form.tsx |
| D14 | VF02 | Approved extension: compact original-operation uncertainty + original identity/details | staff-accounts-form.tsx |
| D15 | VF05 | Approved extension: applicant withdrawal UNKNOWN title, one reconcile CTA, original key disclosure | applicant-form.tsx |
| D16 | VF07 | Book inbox/empty; remove source divider/excess separation | inbox/page.tsx |
| D17 | VF07 | Book copy where same meaning; preserve actual Check/Review/Submit and cancellation | security-form-views.tsx;applicant-form.tsx |
| D18 | VF07 | Keep approved #30/#46 Auth/App/Task safe frames; verify existing responsive exits | unchanged safe-state owners |
| D19 | VF07 | Keep demonstrably correct geometries/data/focus/masking; no speculative redesign | unchanged correct screens |

## Package evidence

Implementation commits, targeted results/SHAs and original-byte affected Current before/after references are recorded in PR #47 and issue #46 after qualification. The immutable Book URLs remain the existing PR references; missing states are explicitly the approved extensions above, never invented Book parity. No package is visually accepted merely because tests pass.
