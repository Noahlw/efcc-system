# Bound account reads by their purpose

Status: implemented contract from the accepted foundation design. Current source-specific qualification is recorded in #95 / #96 / #97 / #106; aggregate qualification, independent review and owner acceptance remain separate.

Staff account browsing, account audit, application review queues and applicant inboxes use server-side bounded browsing, with every permitted record still reachable through explicit pagination or loading the next batch. A selected person or record is read and authorised independently of its presence in the current list page. This separates list payload growth from detail access and avoids loading broad sensitive records merely to render a list.

Apply the bounds to the exposed page and API readers, including `GET /staff/accounts`, rather than changing only the page while retaining a wholesale API response. Absence of an in-repository client is not authority to retire a mounted endpoint.

Each reader retains its own authority and projection contract, including private-note visibility, historical ordering, missing-target recovery and current-authority denial. A cursor identifies a position, not permission to read a record. Retained history remains reachable after an account is deleted.

The account Audit list selects only a `hasInternalNote` boolean; its API, server view model and rendered/RSC list never carry the note body. Full `internalNote` belongs only to the independently authorised selected-record detail, including when that record is outside the visible page. The applicant Inbox continues to exclude Staff notes entirely. This follows the W10.C02 Owner revision and Foundation CR-09 R2; current source-specific evidence and acceptance remain in #97 / #106.

Each Audit SQL read requires the current canonical credential, nonempty password, matching Session/credential revision, no temporary credential, and current Staff/Admin business authority. Session expiry uses SQL execution time. The reader rechecks current Staff authority before returning; a withdrawn permission is a denial, not a successful empty or missing-detail result. This remains feature-owned and preserves the bounded projections and lawful reads above.

## Staff search

Staff search remains live after a short typing pause and searches only full name and Username. It uses trimmed, case-insensitive literal substring matching without additional Unicode normalization; percent and underscore are ordinary characters. Queries support up to one hundred Unicode code points, with visible validation for longer input. Updating search preserves independently authorised selected detail and returns the result list to its first page.

An EFCC-owned derived search projection combines full name and display Username, using the same deterministic application case mapping for stored values and queries. It is separate from the exact-match sign-in lookup key, whose width conversion and identity semantics remain unchanged. Use native literal substring matching rather than a LIKE-pattern limit or SQL LOWER as a substitute for the agreed Unicode contract. Backfill existing rows with the same application rule and maintain the projection through every identity writer within its existing atomic write. Include populated upgrade rehearsal; add an index only when query-plan evidence justifies it.

## Account lists

Staff accounts, account audit, the application review queue and applicant inbox use twenty-five rows per page with previous/next navigation; total-page counts are not required. Preserve their existing primary order: Staff by name, pending reviews oldest first, audit and inbox newest first. Stable identifiers break equal-value ties. URLs retain search, pagination position and applicable selection/task state so returning from a detail or task restores the list position. New rows are discovered through navigation or explicit refresh rather than unsolicited background reordering during review.

## Home

Home preserves access to all current participation, valid invitations, future events and visible notices, initially reading twenty-five items per section with explicit next-batch loading. With no selected date, events remain a browsable list of future events; a selected date is filtered server-side. Preserve the week/date controls and retain their state and browsing positions in URLs. Notices continue to expand inline, and the participation anchor remains available. These bounds must not silently replace the existing visibility rules with an arbitrary time horizon.

## Current owners

The directory owner is `src/features/account/managed-accounts.ts`, with literal search/backfill owned by `staff-search.ts` and its contract. Audit, application/inbox and Home readers remain in their feature owners. Framework roots retain request composition; `src/shared/protected-pages.ts` filters permitted retry URL keys without granting authority. Current-authority checks and independent SQL-time command assertions remain separate from projections.

Completed Staff decisions display the authoritative command/reconciliation result without starting a background task refresh. Explicit completion compares and clears the resolved original key, then uses the existing canonical queue URL in a full native navigation. The fresh server read establishes the returned queue before another destination is chosen; an old task refresh cannot replace a newer page. UNKNOWN keys remain protected and failed local cleanup does not navigate.
