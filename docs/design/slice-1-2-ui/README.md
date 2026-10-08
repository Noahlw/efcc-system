# R11 UI design reference — historical prototype packet

This directory preserves the 40 screen/subflow and 306 synthetic-state reference for #30 Revision 11 and its original PR #31 design work. These artifacts record design intent and prototype evidence, not current source ownership or the whole-repo runtime state. #30 remains the visual/interaction authority; #46 Revision 1 governs the library integration.

## Open or run

From this directory:

```sh
node screenbook/serve.mjs
```

Open the printed local URL. The [design book](screenbook/index.html) provides all screens, states, phone/tablet/desktop fixtures and text enlargement. [Overview](screenbook/gallery.html) links the 40 primary phone references; retained mobile/desktop captures live in `screenbook/captures/`. These default captures are unchanged from R9; the corrected authentication-unavailable state has new [phone](verification/phone-320.png), [desktop](verification/desktop.png) and [200% text](verification/phone-text-200.png) proof.

## Reference scope and current implementation

- [Confirmed understanding](understanding.md) — accepted behavior, Q22 lifecycle boundary and Q23 confirmation.
- [Presentation foundation](foundation.md) — R11 map plus separately marked current integration notes.
- [Module ownership proposal](module-ownership.md) and [architecture research](architecture-research.md) — historical design-time proposals, not migration instructions.
- [Readiness review](readiness-review.md) and [qualification](qualification.md) — historical synthetic design/prototype evidence.

The R11 packet was created before the #46 production integration began; its branch and baseline references are provenance only. Current implementation status is in the repository [README](../../../README.md) and delivered source. The exact #60 candidate gates are in the local ticket ledger; they do not close #45's physical-device/native-enlargement gates.

## Check the reference

```sh
node screenbook/check.mjs
```

This checks all 306 fixture states, headings, destinations, assets and critical design boundaries, including unverified-authentication navigation. It does not exercise production services. The [qualification report](qualification.md) distinguishes historical all-screen R9 evidence from the newly exercised R11 state.

Names, credentials and operations in the preview are synthetic; the screenbook has no API/D1 integration. Production source baseline `100bde89af5b8177e7625bd9b36580c0ab254c43` is historical. This reference does not qualify production behavior; prior committed design artifacts remain recoverable from Git history.
