# R11 readiness review

5 October 2026 · **READY for requirements synthesis**. Complete R11 understanding confirmed in Q23; Q22 selected no automatic draft persistence. Scope and confirmed behavior are in [the single brief](understanding.md). Current prototype evidence is in [qualification](qualification.md).

| Review lens | Conclusion |
| --- | --- |
| Outcome and scope | All delivered Slice 1–2 families remain in scope; Auth is one family. Future behavior is owned by its tickets. |
| Architecture and reuse | Shared root/task/Auth frames with feature-owned state, thin route/layout ownership and existing controls are viable. Exact module edit paths can wait for planning. |
| Dependencies and integration | Retain the installed Next.js/vinext, Better Auth, UI/form and Hono stack. Email remains deferred in #6. No new external prerequisite is required for the chosen UI architecture. |
| State and failure | Actor/session/target/action and submitted references remain distinct. Q22 resolves mobile forced-close behavior without adding saved drafts. |
| Security and data | Route grouping does not grant access. Existing server authority remains required; unverified authentication now renders a neutral frame without identity or protected navigation. |
| UI and accessibility | Shared size rules, natural growth, root-only navigation and task focus remain agreed. The corrected state passes the focused native responsive/text/keyboard check; physical-device and production acceptance remain later work. |
| Verification and review | Fixture checks and historical default captures are identified separately from new R11 evidence. No completed independent code review or real service acceptance is inferred. |
| Operations and performance | Reuse current Worker/D1 behavior and restoration safeguards; no new cache, queue, experimental framework API or rollout system is needed to define this foundation. |

## Material findings closed

**B1 — Incorrect authenticated shell during unresolved authentication.** The prior fixture displayed an identity/sidebar while saying “暫時未能確認登入狀態”. The shared screen/state layout decision now selects the compact neutral Auth family. Protected navigation and identity are absent; supported retry/sign-out remain. New [desktop](verification/desktop.png), [phone](verification/phone-320.png) and [responsive results](verification/responsive.json) verify the corrected fixture. Current production fallback already uses a neutral presentation; this was not a demonstrated production authorization vulnerability.

**B2 — Universal dirty-form warning was unspecified at forced closure.** Q22 accepts app-controlled Continue/Discard, browser-native warning where permitted and possible unsent-data loss on forced closure. Passwords stay unpersisted; submitted references keep separate protection. This resolves the browser limitation documented in [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

## Preservation and handoff

Keep state identity stable across frame changes; register protection/safe returns/current navigation/data/action checks for future routes; publish this current reference before implementation assignment. These are preservation obligations, not new architecture layers. [Research](architecture-research.md) links the primary docs supporting the ownership choices.

The consequential grilling frontier is empty, and the known prototype correction has been checked. The owner invoked `to-spec`; #30 now contains the complete Revision 11 spec. The next `to-tickets` stage remains separately invoked. Readiness is not production code acceptance, implementation approval, merge, deployment or release.
