# Slice 1–2 UI reference — Revision 11

The owner confirmed the complete R11 understanding in Q23. This is the current whole Slice 1–2 design and architecture reference for the existing feature draft [PR #31](https://github.com/Noahlw/efcc-system/pull/31): 40 screens/subflows and 306 synthetic states. Auth is one of the delivered families.

## Open or run

From this directory:

```sh
node screenbook/serve.mjs
```

Open the printed local URL. The [design book](screenbook/index.html) provides all screens, states, phone/tablet/desktop fixtures and text enlargement. [Overview](screenbook/gallery.html) links the 40 primary phone references; retained mobile/desktop captures live in `screenbook/captures/`. These default captures are unchanged from R9; the corrected authentication-unavailable state has new [phone](verification/phone-320.png), [desktop](verification/desktop.png) and [200% text](verification/phone-text-200.png) proof.

## Current authority

- [Confirmed understanding](understanding.md) — all accepted behavior, Q22 lifecycle boundary and Q23 confirmation.
- [Presentation foundation](foundation.md), [module ownership proposal](module-ownership.md), [official-docs architecture research](architecture-research.md) and [31-module census](ui-architecture-census.json).
- [Readiness review](readiness-review.md), [qualification](qualification.md) and [file hashes](manifest.json).

[Issue #30](https://github.com/Noahlw/efcc-system/issues/30) is now the published Revision 11 spec, rewritten in full on 5 October 2026 from the confirmed understanding. Detailed module placements remain proposals; this packet does not start production implementation. Future features follow their tickets. Local `feat/ui-rework` retains remote `codex/ui-redesign-grilling` to preserve #31.

## Check the reference

```sh
node screenbook/check.mjs
```

This checks all 306 fixture states, headings, destinations, assets and critical design boundaries, including unverified-authentication navigation. It does not exercise production services. The [qualification report](qualification.md) distinguishes historical all-screen R9 evidence from the newly exercised R11 state.

All names, credentials and operations are synthetic. The preview has no API/D1 integration. Production source baseline is `100bde89af5b8177e7625bd9b36580c0ab254c43`. Production code, dependencies, policies, migration and deployment are outside this change. Superseded packets and working drafts have been removed from the active reference; prior committed references remain recoverable from Git history.
