# R11 foundation architecture research

5 October 2026 · Complete understanding confirmed in Q23. This is the documentation basis for the existing application's UI/feature foundation, not an implementation plan or a production migration.

## Authority and source boundary

The [R11 understanding](understanding.md) records the confirmed design decisions. At the time of this 5 October 2026 research, #30 was Revision 8; it was later published as Revision 11. #46 Revision 1 now governs the library integration. #29 specifies future Roles/delegation; #1/#2 supply the later feature roadmap. Detailed feature behavior comes from its ticket, rather than hypothetical scaffolding.

The [31-module census](ui-architecture-census.json) and [40-subflow map](foundation.md) trace the existing Slice 1–2 interface against production baseline `100bde89af5b8177e7625bd9b36580c0ab254c43`. Repeated navigation, sign-out/revalidation placement, frame geometry and form/review/result presentation are real shared responsibilities. Validation, actor/session/target/action ownership and submitted-operation reconciliation belong to their current feature flows.

CBM discovery returned 94 registered projects with no EFCC System match. Source reads are the structural evidence; no graph coverage or full backend audit is claimed. Current official guidance was queried through Context7 and primary documentation during the R9–R11 discussion. Documentation establishes feasibility, while [qualification](qualification.md) records the narrower exercised prototype boundary.

## Route Groups, shared nested layouts and roles

[Next.js Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) and [vinext routing](https://github.com/cloudflare/vinext#routing) support organizing routes without changing public URLs. Retain one html/body root. Optional public/app groups are presentation organization; they do not determine who may read data or perform an action.

[Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication#layouts-and-auth-checks) explains why persistent layouts are not a sufficient authorization boundary. Better Auth keeps identity/session responsibilities; the existing proxy/access resolver keeps current EFCC access resolution; feature data reads and mutations keep their specific authority checks. Do not add another session lookup merely to paint a shell or move permission checks into a persistent layout.

Roles/delegation remain compatible with one route tree. Navigation reflects current permitted destinations, not a static member/staff label. Future #29 work must retain its specific effective-authority rules; it does not require a folder tree or duplicate page for every role. New protected destinations must account for current proxy matching, safe-return whitelist, permitted navigation and data/action checks.

The root/task/Auth frame choice belongs to the active work's verified access and state. A nested layout must not force bottom navigation into focused forms or a sidebar around unresolved authentication/sign-out. The R11 corrected authentication-unavailable variant demonstrates the agreed compact neutral family; it displays no unverified identity or protected destinations.

## Shared presentation and state

[React state preservation](https://react.dev/learn/preserving-and-resetting-state) depends on component identity and position. Keep feature work owners stable when changing the frame or opening a dialog. Reset deliberately for actor/target changes after the agreed draft warning; do not create global drafts merely to compensate for remounting.

[Next.js server/client composition](https://nextjs.org/docs/app/getting-started/server-and-client-components) supports passing server-rendered content through a client wrapper. Keep static presentation server-capable and interactive leaves client-owned; do not promote the whole application to one client component to share navigation.

Use the installed Base UI, Tailwind and TanStack adapters. Share actual repeated fields, buttons, summaries, notices, target context and outcome geometry while preserving feature validation and operation contracts. [Base UI](https://base-ui.com/react/overview/about) supplies interaction primitives; [Tailwind theme variables](https://tailwindcss.com/docs/theme) supply common visual roles. [CVA](https://cva.style/docs/getting-started/variants) is conditional on real repeated typed variants, not a reason to introduce an abstraction or dependency for every control. Existing form ownership and validation remain authoritative; no form-library replacement is proposed.

Shared size rules mean common widths, spacing, type and controls with natural height. They do not force every screen to a fixed box. Root-only mobile navigation, one task return/title row, rem-based text and reachable final controls remain the confirmed outcomes. [WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) informs later production accessibility acceptance; synthetic viewport captures alone do not certify it.

## Ticket-grounded scale-up structure

Retain one application and the existing app/components/features/server/shared roots. The [ownership proposal](module-ownership.md) gives concrete current seams and illustrative future feature placement. Feature folders are code ownership, not new domain contexts. Server operations, client flow owners and genuinely shared pure contracts can be separated where actual consumers require them; avoid adding every layer to every small feature.

[Hono's larger-application guidance](https://hono.dev/docs/guides/best-practices#building-a-larger-application) supports actual feature routers composed with `.route()`. Preserve the current `/api/v2` bridge, endpoints, error/status/JSON contracts, middleware authority and inferred types. No controller/factory framework or Server Actions migration is proposed.

Future Roles, activity, participation and other roadmap capabilities appear when their tickets deliver them. [#6](https://github.com/Noahlw/efcc-system/issues/6) still defers real email delivery; lifecycle completion does not authorize a mail provider or generic queue. Do not build empty modules, an independent role engine, generic recovery framework, event bus or outbox as part of this UI foundation.

## Lifecycle and evidence limits

Q22 explicitly bounds unsent-work warnings. [MDN beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event) documents mobile hard-close cases that skip the event and browser-owned dialog behavior. Keep custom Continue/Discard within app-controlled navigation; use the native warning when allowed; forced closure may lose unsent fields. No automatic drafts or password persistence are added. Submitted references retain their separate existing protection and storage-failure handling.

At the time of this R11 research, production authentication and Worker/D1 behavior still required implementation evidence. The later #46 tickets delivered those flows and T13 owns the whole-repo candidate qualification; this dated research and the prototype qualification are not that evidence. Physical PWA lifecycle/device checks and release remain separate.
