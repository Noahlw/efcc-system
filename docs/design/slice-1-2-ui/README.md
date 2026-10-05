# Slice 1–2 UI design reference — Revision 6

The owner selected the second calm-teal concept and confirmed this complete design book as the basis for a specification and implementation tickets on 5 October 2026. GitHub Issues are the canonical scope; this packet is the immutable visual/interaction reference.

The snapshot covers **40 primary screens/subflows** with **304 selectable fixture combinations** that reuse shared outcome designs. All data, credentials and operations are synthetic. The prototype has no application API/database integration and does not establish production acceptance.

## Inspect or run

- [Full runnable design book](design-book-revision-6.zip): extract, enter `screenbook`, run `node serve.mjs`, then open the printed local URL.
- [Coverage/QA](design-book-revision-6.zip): included inside the archive as `coverage.md` and `design-qa.md`, with primary mobile/desktop captures and selected-reference comparisons.
- [Confirmed understanding](understanding.md), [exact originally selected image](selected-home-v1.png), and [archive/file hashes](manifest.json).
- Contact sheets: [01–10](overview-1.jpg), [11–20](overview-2.jpg), [21–30](overview-3.jpg), [31–40](overview-4.jpg). They show upper screen regions; full forms and states are available in the design book.

## Authority

Accepted narrative behavior and the current issue spec take priority over illustrative data, generated copy and simplified mock interactions. Existing Slice 1–2 business/authorization contracts remain authoritative. Legacy UI is inspiration; no future Slice 3–8 capability or email verification/recovery is implied.

Source baseline: main `100bde89af5b8177e7625bd9b36580c0ab254c43`. Current planning lives in [the rebuild map](https://github.com/Noahlw/efcc-system/issues/2) and its linked specs/tickets. No production source, dependency, migration or deployment configuration is changed by this packet.

## Snapshot check

After extraction, run `node check.mjs`. It validates fixture rendering, internal links/assets and the bounded design rules; browser and business acceptance remain separate. Library icons and their licence are included.
