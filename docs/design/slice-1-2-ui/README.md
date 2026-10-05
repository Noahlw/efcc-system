# Slice 1–2 UI design reference — Revision 9

Owner-confirmed R9 covers all 40 delivered Slice 1–2 screens/subflows and their reusable presentation foundation. The calm teal direction, role/access contracts, person-first Staff work, root-only mobile navigation and naturally expanding content remain the basis. Auth is one family within the complete scope.

## Inspect or run

- [Current runnable R9 design book](design-book-revision-9.zip): extract, enter `screenbook`, run `node serve.mjs`, then open the printed URL. The book contains 40 screens and 306 synthetic states, current mobile/desktop captures, shared-role mapping and before/after comparison.
- [Confirmed understanding](understanding.md), [whole UI foundation](foundation.md), [architecture research including Route Groups/roles](architecture-research.md), [qualification report](qualification-r9.md), [source and archive hashes](manifest.json).
- Current overview sheets: [01–10](overview-1.png), [11–20](overview-2.png), [21–30](overview-3.png), [31–40](overview-4.png). Long content and alternative states are available in the runnable book.
- After extraction, run `node check.mjs` and `node audit-r9/verify.mjs` inside `screenbook`. These check rendering contracts and saved evidence identity; they do not rerun a browser or prove real service behavior.

## Authority and delivery

Continue existing feature draft [PR #31](https://github.com/Noahlw/efcc-system/pull/31); local `feat/ui-rework` retains its remote head `codex/ui-redesign-grilling`. [Issue #30](https://github.com/Noahlw/efcc-system/issues/30) remains the published Revision 8 spec until the owner separately invokes its rewrite. R9 is the owner's newer confirmed design/architecture understanding, not a silently rewritten issue or launched implementation task.

The [R6 archive](design-book-revision-6.zip), [R6 manifest](manifest-revision-6.json), [R6 brief](understanding-revision-6.md) and old `.jpg` overview files are historical. Use the R9 archive and `.png` overviews for current work.

All people, credentials and operations are synthetic; the preview has no API/D1 integration. Source baseline is main `100bde89af5b8177e7625bd9b36580c0ab254c43`. No production code, dependency, policy, migration, deployment or remote member data is changed. Design qualification, independent review, owner approval and release remain separate.
