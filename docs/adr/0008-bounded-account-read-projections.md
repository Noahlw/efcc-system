# Bound account reads by their purpose

Status: accepted design from the foundation planning interview; implementation pending.

Staff account browsing, account audit, application review queues and applicant inboxes will use server-side bounded browsing, with every permitted record still reachable through explicit pagination or loading the next batch. A selected person or record is read and authorised independently of its presence in the current list page. This separates list payload growth from detail access and avoids loading broad sensitive records merely to render a list.

Apply the bounds to the exposed page and API readers, including `GET /staff/accounts`, rather than changing only the page while retaining a wholesale API response. Absence of an in-repository client is not authority to retire a mounted endpoint.

Each reader retains its own authority and projection contract, including private-note visibility, historical ordering, missing-target recovery and current-authority denial. A cursor identifies a position, not permission to read a record. Retained history remains reachable after an account is deleted.

## Staff search

Staff search remains live after a short typing pause and searches only full name and Username. It uses trimmed, case-insensitive literal substring matching without additional Unicode normalization; percent and underscore are ordinary characters. Queries support up to one hundred Unicode code points, with visible validation for longer input. Updating search preserves independently authorised selected detail and returns the result list to its first page.

An EFCC-owned derived search projection combines full name and display Username, using the same deterministic application case mapping for stored values and queries. It is separate from the exact-match sign-in lookup key, whose width conversion and identity semantics remain unchanged. Use native literal substring matching rather than a LIKE-pattern limit or SQL LOWER as a substitute for the agreed Unicode contract. Backfill existing rows with the same application rule and maintain the projection through every identity writer within its existing atomic write. Include populated upgrade rehearsal; add an index only when query-plan evidence justifies it.

## Account lists

Staff accounts, account audit, the application review queue and applicant inbox use twenty-five rows per page with previous/next navigation; total-page counts are not required. Preserve their existing primary order: Staff by name, pending reviews oldest first, audit and inbox newest first. Stable identifiers break equal-value ties. URLs retain search, pagination position and applicable selection/task state so returning from a detail or task restores the list position. New rows are discovered through navigation or explicit refresh rather than unsolicited background reordering during review.

## Home

Home preserves access to all current participation, valid invitations, future events and visible notices, initially reading twenty-five items per section with explicit next-batch loading. With no selected date, events remain a browsable list of future events; a selected date is filtered server-side. Preserve the week/date controls and retain their state and browsing positions in URLs. Notices continue to expand inline, and the participation anchor remains available. These bounds must not silently replace the existing visibility rules with an arbitrary time horizon.
