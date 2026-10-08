# EFCC combined UI and feature/API foundation — ownership proposal

5 October 2026 · R11 understanding confirmed in Q23; Q21 combined planning scope (“一併規劃”) is preserved. Detailed module placements below are proposals. This is architecture grilling, not an invoked implementation plan. Existing URLs, HTTP contracts, policies and all retained UI decisions remain authoritative.

## Evidence and scope

Candidate: local `feat/ui-rework` at `ebb06a299fc70863b478d8eaf9091e8b78c6e961`; the production baseline was unchanged from main `100bde89af5b8177e7625bd9b36580c0ab254c43` when this proposal was written. This is historical pre-implementation architecture work; the #46 tickets later implemented the delivered account integration. Use the root README and the current sections in `foundation.md` for delivered ownership. The former R9 packet remains recoverable from Git history.

[Research](architecture-research.md#ticket-grounded-scale-up-structure) contains refreshed official Next.js/vinext/Context7/Hono guidance and live issue evidence. CBM project discovery found no exact index among all 94 registrations; current-generation/path coverage is unavailable. Current source reads traced frame, navigation, actor, confirmation and API callers; this is not a complete backend audit.

## Route/layout/frame ownership

One root `app/layout.tsx` keeps html/body/global style. Optional `(public)` and `(app)` groups preserve current URLs. Their proposed responsibilities differ:

- Public shared layout may own the compact Auth canvas geometry. Page/flow owns its title, fields, validation and truthful result. Branding cannot be duplicated above the page's Return/title row.
- Protected shared layout owns genuinely persistent infrastructure such as restored-private-document revalidation. It does not permanently mount a role-dependent menu, data cache or management sidebar around all descendants. Current page/feature inputs still determine permitted destinations.
- Shared frame module owns geometry: title alignment, width/gutters, responsive sidebar, root bottom-nav reservation, scrolling, natural height, focus/accessibility presentation and root/task/Auth roles. Features supply current authorized navigation and work context.
- Feature client work owns transitions between root, person/task, review, dialog and outcome. An inherited layout cannot be used to force the same navigation into these different states.

Suggested narrow presentation interface (conceptual, not approved code): Root frame takes title/current permitted destinations/content; Task frame takes title/safe return/current context/content; Auth canvas takes auth content and branding where appropriate. These are three delivered modes, not a growing collection of boolean layout flags. Static presentation remains server-capable; browser interaction stays in small client owners. Server-rendered children may be passed as slots rather than importing all data modules into a client shell.

Sign-out is an important stress case: current `SignOutButton` owns POST, pending state, authoritative get-session follow-up and unconfirmed outcome. That feature must still own the truth while presenting pending/unknown inside the compact Auth canvas. Returning from uncertainty requires fresh access validation; do not simply restore cached private children. Likewise, routine Account root→task transitions preserve the same actor and current work while changing navigation presentation.

## Existing owner → proposed owner

| Actual source responsibility | Proposed location/responsibility | Preserve |
| --- | --- | --- |
| app pages, primary-navigation, globals | Thin route adapters; navigation/frame module under existing components roots | URLs, current identity/access inputs, status-only/temp-password gates, permitted links |
| UI button/input/field and repeated summary/dialog/result visuals | Existing UI controls plus a small shared presentation module | Explicit field labels, rem roles, target sizes, focus and Q14/Q16 rules; installed Base UI/Tailwind |
| Public application, applicant maintenance, decision review/inbox reads | Account application journey group; retain individual operation/flow owners | Required inputs, private/internal-note separation, ordinary-approval policy, actor/reference-bound uncertainty |
| security-form and security operations | Account security flow + actual shared session/confirmation functions | Native current-session/credential proof, 10 minutes, explicit final submission, original operation recovery |
| staff account selection/creation/recovery/handover | Account person workspace and assisted-account flow | Same-name selection, same target, verification method, seven-day temporary credentials, one-time handover |
| identity/restrictions/deletion forms and server operations | Related account journey groups; existing common account-change/reconciliation responsibility retained | Independent membership/ban, target protection, eligible deletion/history, authoritative per-action errors |
| accountActor in decisions, consumed by approval page and security | Candidate extraction of header/expected-actor context to a small server/auth request-actor module | Header context is not fresh authorization; preserve expected-actor conflict and all subsequent D1/session checks |
| requireStaff in decisions, used by decisions/staff accounts/account changes/restrictions/deletion | Shared current Staff eligibility responsibility may be relocated without changing policy | Never substitute this Staff rule for future Department Manager/Program Leader permission rules |
| server/api/app.ts current route registrations and exported AppType | Hono root composition + actual feature router modules | `/api/v2` URLs/methods, parent error/not-found/private response policy, same error constructor/codes, chained type inference |
| Better Auth access/config, D1 client/schema, time helper and revalidator; the actor-bound `postAccountOperation` adapter at the R11 baseline | Retain the current auth/database/revalidation owners; T13 later removed `postAccountOperation` after its callers migrated to typed Hono RPC | No second auth authority/client, cached role proof, generic recovery workflow or dependency upgrade |

Grouping does not mean introducing a `server.ts`, `client.ts`, `contracts.ts`, repository interface and factory for every feature. Use explicit server imports, actual client flow modules and pure contracts only when they have real consumers. Current `import type` usage is erased and does not demonstrate a server-code leak. Server-only/client-only import guards are supported by installed vinext source; their real build/test compatibility remains an implementation check.

## Hono composition seam

`app/api/v2/[[...route]]/route.ts` remains the framework bridge to `handleBusinessRequest`. Current `businessApi` owns the `/api/v2` base, safe errors, not-found and `AppType`. Existing account operations already live behind functions used by routes/pages.

The first meaningful split is account route registrations as a feature group. Identity/status reads can stay at the root until another actual group warrants movement. Within Account, application, security, assisted-account and account-change clusters may be grouped privately where it improves ownership; do not create a controller layer for every endpoint. Future Roles/Programs routers are mounted when their tickets are delivered. Preserve root composition's inferred route types rather than widening to an untyped Hono instance.

Server Components call the same authorized feature read functions directly. They should not fetch the app's own `/api/v2` endpoint just to cross a second HTTP hop. Client submissions retain the existing HTTP/expected-actor contract and each flow's persistence/reconciliation rules. API structural polish does not convert account mutations to Server Actions or alter D1 atomicity.

## Shared presentation versus feature-owned state

| Shared presentation | Feature-owned behavior |
| --- | --- |
| Person name/Username context, selector styling, list/detail frame | Permitted search results/fields, selected target, protected/self-target rules. Future role search must not inherit staff contact/recovery information. |
| Field labels, input wrappers, validation-message placement | Public versus assisted requirements, authoritative server validation, derived review data and deliberate empty/false values |
| Confirmation dialog, progress, cancel/Escape/focus return | Password-confirmation request/truth, actor/session/action/target, expiry and separate final submit |
| Review/summary/action layout | Action semantics, draft state, snapshots, current eligible target and final command |
| Result/unavailable/retry visuals | Which retry is permitted, original reference, denied/rejected/unknown/completed truth, storage failures and one-time secret behavior |

Each work has one state owner. Moving JSX must not introduce global per-person drafts, reset React state on unrelated frame changes or clear a submitted reference with an unsent-draft warning. Account search/scroll and Home date/week context retain their settled behavior.

## Future tickets as extension cases

- #29 Roles adds its own fixed-role/scoped-authority functions and permitted person-first work. A Global Member with Department Manager authority may get role work; ordinary Staff alone does not get a role-management entry. Common frames/context/confirmation presentation are reusable, while search data and rules remain role-owned.
- #1/#2 Slice 4 adds Department membership separately from church membership and work-role assignment. Slice 5 adds Program/Event management; Activity remains an umbrella term, not an extra module/entity.
- Slice 6 owns Program enrolment/capacity/waitlist. Slice 7 owns Event attendance/QR and scoped Care reads; later QR qualification remains required.
- Slice 8 adds notice authoring/visibility, authorized Home surfacing and in-app notification work. Sharing presentation does not select an event bus/queue architecture.
- #6 remains deferred verification/reset mail qualification. Do not enable mail routes or select provider/automatic durable queue during the UI foundation work.

Slices 4–8 do not yet have full child specifications. Record their likely ownership without creating URLs, schema, commands or empty directories now. All 40 delivered R9 screens remain in scope; adding future features is separate delivery.

## Observable implementation checks to retain

The proposed observable checks were subsequently exercised at the delivered source boundaries by #48–#59 and the full #60 candidate gates. Use the issue-specific ledgers and T13 exact-SHA record for those results; this historical proposal does not itself establish production acceptance.

This file records design-time proposals and is not a current plan or implementation checklist. #46 Revision 1 and its delivered source supersede its candidate workflow; do not infer current PR state, approval, merge, deployment or release from this historical proposal.
