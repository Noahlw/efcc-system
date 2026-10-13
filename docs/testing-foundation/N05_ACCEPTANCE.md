# N05 / #71 Home claim disposition

Base: `8b6d6131c4078654502919853f3edd792351c5c2`. Scope: Home notices, Home participation, immutable activity/notice inputs and Church Time Node regression. No product UI changes.

## Original cases and replacement claims

All original case names remain discoverable; no original case was dropped or merged.

| Original family/case | Layer and preserved independent evidence |
| --- | --- |
| Notices: church audience/publication/expiry | Browser built server-rendered Church notice; unpublished/expired and unrelated Department/Program excluded |
| Notices: assigned Manager | Browser Department assignment without membership; owning Program included; unrelated Department excluded |
| Notices: member and enrolee | Separate native authenticated actors; member has Department but not Program; enrolee has Program but not Departments; first document excludes forbidden Program |
| Notices: assignment withdrawal | Dedicated D1 mutation; next render removes Department scope only; Church/Program and unrelated upcoming participation remain |
| Notices: inactive enrolment | Each withdrawn/rejected/cancelled transition observed on the first document, not polling away a leak; Church unaffected |
| Notices: Manager with inactive enrolment | First document retains Program through assignment, Church and unrelated pending participation |
| Notices: read-only counts | Independent actual app-D1 enrolment/invitation/notice counts before/after read |
| Notices: colliding Department/Program ID | Program label and audience preserved despite cross-table ID collision |
| Notices: malformed Church scope | Actual D1 CHECK bypass creates malformed row; first document and rendered notice exclude its content |
| Participation: approved/upcoming | Independent explicit Event sequence, Department/context/approval, HK 10:30 rather than UTC 02:30; approved past-only Program retains empty state |
| Participation: pending/waitlisted | Distinct labels/reasons; neither implies confirmed upcoming participation |
| Participation: excluded states/invitations | Own approved Program; valid invitation only, expired/revoked excluded |
| Participation: empty person | Successful empty upcoming/status/invitation lists |
| Participation: date filter/navigation | Real sequential week clicks, exact date filtering, reset, next January navigation loop, independent Monday/year/month date oracle and ordered reset |
| Participation: narrow/text reflow | Real 320px/200% root-font surface, 44px targets, local strip scroll and no document overflow |
| Participation: Account privacy/navigation | Home conceals email; real Account navigation exposes own details/status/application links; 320px/200% no overflow |
| Participation: two actors | Separate native cookie stores; participation/invitations do not cross actors |
| Participation: client identifiers | HTTP-only once; spoofed query identifiers cannot select another person; independent exact own profile expectation |
| Participation: next-read Event | Direct app-D1 new Event; next browser request shows third Event |
| Participation: global ordering | Dedicated store, cross-Program insertion; exact four-event chronology and first row Program/Department/approval |
| Church Time | Vitest discovery; explicit HK midnight boundary, Monday–Sunday year rollover/next week/negative offset, independent exact 24-hour timestamp for Date and numeric inputs |

## Owners removed and retained seams

Removed from both specs: global beforeAll provisioning, seed/token HTTP imports, SQL CLI imports, limiter pacing, spec-local sign-in/openHome helpers, resetActivities and finally baseline restoration. No scenario resets its store. No custom captures/reporters were introduced. Original migrations and native close remain shared fixture responsibilities.

`tests/support/home.ts` is a Home-only prerequisite fixture: immutable actor templates are copied into case-owned usernames/emails and explicit domain writes use only the selected app binding. Ordinary participation/status/calendar/next-read/privacy cases reuse the native worker store; every actual Department/Program/Event/enrolment/invitation ID and actor username/email is namespaced per case. They insert no Church notices or Department notice-scope rows. The empty-person case directly uses the native `account`/`signedInPage` fixtures without the Home four-actor prerequisite. Only notice/global-visibility/count/malformed/shared-ID cases and cross-Program global ordering select `dedicatedTest`, a fixture override selecting `dedicatedApp`; these isolated scenarios retain original domain IDs. Native API contexts own real login cookies; native browser contexts consume in-memory storageState and retain configured project defaults. Contexts close per case; worker stores close at worker teardown and dedicated stores at case teardown. There is no row cleanup/reset, generic seed/SQL/auth API or second D1 owner.

Inputs expose readonly arrays/rows; no account template is mutated. Church Time expectations are not derived from the helper under test.

Remaining baseline consumers outside N05: `guard-failures.spec.ts` and `zz-worker-faults.spec.ts` consume activity/notice inputs (N14 ownership); `seed.ts` consumes their types (N18 retirement). They require no input-value migration; the readonly types passed repository TypeScript qualification. No legacy consumer is imported by either Home spec or its prerequisite fixture.

## Qualification

Ticket selection imports shared `playwright.features.config.ts` projects with exactly the two Home spec paths. HTTP claims select `features-http` once; browser claims select Chromium; calendar navigation, narrow/text reflow and Account privacy/navigation additionally select the original iPhone 15 Pro WebKit and Pixel 7 Chromium profiles. Retries are zero. The ignored temporary config is removed before commit. Exact executed results and source commit are recorded in delivery evidence, not inferred from historical runs. Independent final integration review remains the parent’s responsibility.

First-failure evidence is retained in private invocation logs: initial 26/26 setup failures (four actors shared a sign-in bucket); a host-suffix-only IPv6 change also failed 26/26 because pinned Better Auth normalizes IPv6 to /64 (`normalizeIP` in installed `@better-auth/core` source). Actor identities now differ before the /64 boundary; no limiter row deletion, pacing or mutation retry is used. A separate intermediate typecheck found optional native headers and was repaired with an explicit missing-prerequisite failure. The next execution passed 24/26; both mobile Account cases exposed the original broad Account-link locator matching the mobile quick-link too. Exact accessible link selection fixes the locator, without changing UI or expected navigation. Scoped lint then identified construction/style errors; native autofixes plus directly initialized local actor pages repaired them without weakening assertions. These invocations are failures, not stitched acceptance.

After lint/typecheck repairs, another full run passed 24/26 and retained both mobile failures: `.first()` selected a hidden desktop-sidebar name instead of rendered Account details. The independent failure accessibility snapshot showed the correct visible name/Username/email in the `個人資料` region. Assertions now target that semantically named region (still requiring exact original values and visibility); no hidden-element exception, weaker matcher, UI change or engine exclusion was introduced.

Final settled-source qualification on macOS arm64, Node 24.21.0 / pnpm 10.33.2 / Wrangler 4.145.0 / Playwright 1.63.0: scoped lint passed, repository typecheck passed, Church Time **3/3 passed**, Home **26 required / 26 executed / 26 passed / 0 failed / 0 skipped / 0 retries**, two workers. Project breakdown: HTTP 1, Chromium 19, original iPhone WebKit 3, original Pixel Chromium 3. The exact final invocation is retained privately in `artifact://332`; earlier failed invocations are `artifact://269`, `artifact://280`, `artifact://289`, `artifact://293` and `artifact://327`. Artifact locators are session-local, not portable published attestations. Native app/provision builds passed before suite execution; subsequent changes were uncompiled specs/fixtures only. Self-review is not independent acceptance; parent integration qualification/review remains required.

## Resource-lifetime correction after initial delivery

Initial source `dd9c4c5bb568ebbef050b2971f85b2679e61a4ff` qualified 26/26 but over-selected dedicated stores for ordinary cases. Parent supplied the valid Spec resource-lifetime gap. The incremental correction above restores ordinary worker-store reuse with truly case-owned actor/row identities, preserves all original labels/date/ordering/privacy assertions, and keeps only global scenarios dedicated. The HTTP spoofed username now targets the actual other case actor rather than a nonexistent old unnamespaced username. No product changes or additional review jobs are introduced; the single combined final review remains at #85.

Correction first invocation: lint/typecheck and Church Time 3/3 passed; Home executed all 26 with **11 passed / 15 failed / zero skipped/retries**. Ordinary Home setup initially concatenated a 17-character namespace to the original actor Username; the canonical auth configuration limits usernames to 30, so the longest template exceeded the real contract. The corrected case-owned username is `home.<16-hex-case-namespace>.<actor-index>` (23 characters); dedicated scenarios retain their original usernames. This changes only prerequisites, not production rules, fixture templates or expected identity/privacy claims. No retries, length-rule relaxation or fallback was used.

Second correction invocation: lint/typecheck and Church Time 3/3 passed; **24/26 Home passed**, zero skips/retries. Chromium calendar encountered a native RPC fetch `ECONNRESET`; Pixel calendar’s first date click occurred while its rendered All state remained pressed, leaving two Events. The first migration had removed the original calendar `page.waitForLoadState("networkidle")`; that native built-client load observation is now restored before input. Real date/navigation actions and independent expected counts remain unchanged; no repeated clicks, mutation retries, arbitrary sleep or timeout increases were introduced. The failed invocation is not acceptance, and resource-load causality for the connection reset is not established.

Final correction invocation ran scoped lint, repository typecheck, Church Time Vitest and the complete shared-project Home selection on the settled repaired source: **all passed**. Home **26 required / 26 executed / 26 passed / zero failed, skipped or retries**, two workers; HTTP **1**, Chromium **19**, original iPhone WebKit **3**, original Pixel Chromium **3**. Church Time **3/3 passed**. Runner reported `26 passed (1.0m)`. Private native report: worktree-local `test-results/n05-ownership/results.json`; raw failure traces remain private and are not published evidence. The command had already started when the parent requested a quiet-window hold; parent was notified, the running command finished normally, and no additional matrix was launched. The ignored selector config is removed before the incremental normal-hook commit.
