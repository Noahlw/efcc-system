# R11 presentation reference and delivered integration notes

The prototype consolidates frame rules in `foundation.css`; `app.css` retains component decoration. `screenbook/screens.mjs` selects layouts from screen and state; `screenLayout()` assigns each delivered subflow a presentation role. Existing `render.mjs` field/summary/notice/target/result helpers are reused. This is a synthetic design seam; it does not prescribe copying the prototype renderer into React.

| Role | Shared rules |
| --- | --- |
| App roots | Mobile navigation anchored at viewport bottom; intrinsic footer height reserves space even when labels wrap. Main is the scroll region. Desktop sidebar and wide content up to 72rem. |
| Focused task | One return/title row, no mobile bottom nav. Work up to 40rem, centred on desktop; selected-person list/detail up to 64rem. Context and final controls remain reachable. |
| Auth | Central compact single-column canvas up to 28rem; no management sidebar. Sign-in, sign-out pending/unknown and authentication-unavailable share branding and controls; unverified authentication exposes no identity or protected navigation. Long public application grows and scrolls. Account security remains a task. |
| Type | Body 17, label 16, metadata 14, section 20, task 22, root 28/Home 32. rem roles scale; no fixed content height. |
| Controls | Phone primary/fields 52, secondary 48, effective targets ≥44×44. Explicit labels and keyboard focus; dialog cancel/Escape/focus-return retain current work. |
| Lists/forms/outcomes | Common gaps, summaries, notices and action groups. Field descriptors and existing review helpers remain useful; feature-owned validation, actor/target/action, reconciliation and one-time secrets remain distinct. |

Production reuse should deepen existing UI modules with a small shared frame/control seam, preserve server-capable presentation and client interactive leaves, and use installed Base UI/Tailwind/TanStack adapters. CVA remains conditional on real repeated variants; no dependency was added. Role-aware navigation uses current authorized functionality, not a duplicated UI per role. Route Groups may organize shared layouts without changing URLs, but never replace data/action authorization. See [the assessment](architecture-research.md#route-groups-shared-nested-layouts-and-roles).

The 40 rows below are the R11 design-to-code map frozen at production baseline `100bde89af5b8177e7625bd9b36580c0ab254c43`; their owner paths are historical, not a claim that these remain current source files. They are 40 subflows, not 40 standalone routes. The [production qualification map](production-qualification.md) records the matching R11 IDs, entry points and test families; its execution record is the earlier #45 candidate, not #46 final qualification. The census records the 31-TSX inventory and the screenbook records 306 synthetic states.

| Screen/subflow | Shared presentation | R11 baseline owners | Unique preserved behavior |
| --- | --- | --- | --- |
| home · 個人 Home | App / wide | `src/app/page.tsx`, `src/app/inbox/page.tsx`, `src/app/account/page.tsx`, `src/app/status/page.tsx` | 日期只篩選現有、已授權嘅未來聚會。待批核及候補獨立顯示；「報名已批准」不代表出席。 |
| inbox · 收件匣 | App / wide | `src/app/page.tsx`, `src/app/inbox/page.tsx`, `src/app/account/page.tsx`, `src/app/status/page.tsx` | 只呈現既有會籍審批紀錄；沒有新增未讀標記或通知訂閱。 |
| account · 帳戶總覽 | App / wide | `src/app/page.tsx`, `src/app/inbox/page.tsx`, `src/app/account/page.tsx`, `src/app/status/page.tsx` | 將姓名、Username、會籍、我的申請及安全設定集中；保留原有可用目的地。 |
| phone · 更新聯絡電話 | Task / work | `src/features/account/security-form.tsx`, `src/features/account/identity-form.tsx` | 只有現行政策允許嘅帳戶可自行改電話；姓名與電郵修正由符合資格嘅申請人或 Staff 處理。 |
| security · 帳戶安全選單 | Task / work | `src/features/account/security-form.tsx`, `src/features/account/identity-form.tsx` | 清楚分開更改密碼、登出其他裝置、敏感操作密碼確認。 |
| password · 更改密碼 | Task / work | `src/features/account/security-form.tsx`, `src/features/account/identity-form.tsx` | 保留目前登入，其他裝置下次請求時登出；無 email reset。 |
| sessions · 登出其他裝置 | Task / work | `src/features/account/security-form.tsx`, `src/features/account/identity-form.tsx` | 沒有虛構裝置列表；保留目前登入。 |
| application · 我的申請 | Task / work | `src/app/application/page.tsx`, `src/features/account/applicant-form.tsx` | 申請狀態與目前會籍／保安限制不同；只有符合既有 never-approved 條件嘅申請人可維護。 |
| app-edit · 修正申請資料 | Task / work | `src/app/application/page.tsx`, `src/features/account/applicant-form.tsx` | Username 固定；電郵改動不會啟用電郵驗證或復原。 |
| app-withdraw · 撤回申請 | Task / work | `src/app/application/page.tsx`, `src/features/account/applicant-form.tsx` | 只供符合資格嘅待批核申請人。撤回後可重新提交，並非刪除帳戶。 |
| app-resubmit · 重新提交申請 | Task / work | `src/app/application/page.tsx`, `src/features/account/applicant-form.tsx` | 拒絕或撤回後重新進入審批，並非自動批准。 |
| signin · 登入 | Auth / compact | `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-form.tsx`, `src/features/account/application-form.tsx`, `src/features/auth/sign-out-button.tsx` | Username 為預設；中文全名同名時轉用 Username。不新增 email、SSO 或忘記密碼流程。 |
| apply · 申請帳戶 | Auth / compact | `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-form.tsx`, `src/features/account/application-form.tsx`, `src/features/auth/sign-out-button.tsx` | 公眾申請需電話、中文全名、Username、電郵及密碼；其他資料選填；不設公眾共用電話例外。 |
| apply-result · 申請提交結果 | Auth / compact | `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-form.tsx`, `src/features/account/application-form.tsx`, `src/features/auth/sign-out-button.tsx` | 提交不會自動登入。未確認結果必須先查核原操作，避免重複申請。 |
| status · 帳戶狀態 | Task / work | `src/app/page.tsx`, `src/app/inbox/page.tsx`, `src/app/account/page.tsx`, `src/app/status/page.tsx` | 會籍與保安限制獨立；解除暫停不會重新啟用會籍。受限用戶仍可到收件匣及帳戶。 |
| temp-password · 首次更改臨時密碼 | Task / work | `src/features/account/security-form.tsx`, `src/features/account/identity-form.tsx` | 此時只顯示帳戶安全及登出。改密碼不改變會籍或保安限制。 |
| management · 管理入口 | App / wide | `src/app/staff/accounts/page.tsx`, `src/features/account/staff-accounts-form.tsx` | 由個人 Home 進入管理；只列 Slice 1–2 已提供且有權限嘅工作。 |
| accounts · 搜尋及選擇帳戶 | App / wide | `src/app/staff/accounts/page.tsx`, `src/features/account/staff-accounts-form.tsx` | 安全身份資料（姓名、Username）用於區分同名；建立帳戶是獨立工作。 |
| person · 帳戶工作總覽 | Task / split | `src/app/staff/accounts/page.tsx`, `src/features/account/staff-accounts-form.tsx` | 先選人再選操作。Desktop 列表／詳細資料並排；手機逐步進入。所有操作仍由 server 判定。 |
| create · 職員協助建立帳戶 | Task / work | `src/app/staff/accounts/page.tsx`, `src/features/account/staff-accounts-form.tsx` | 不新增角色配置；臨時密碼只於成功回應顯示一次，必須安全交收。 |
| handover · 臨時密碼交收 | Task / work | `src/app/staff/accounts/page.tsx`, `src/features/account/staff-accounts-form.tsx` | 成功收據不會再次揭露臨時密碼。若交收未完成，需重新核實並明確重新發出。 |
| recovery · 帳戶復原 | Task / work | `src/app/staff/accounts/page.tsx`, `src/features/account/staff-accounts-form.tsx` | 核實渠道受現行政策限制；不可用嘅電話核實方式清楚禁用。 |
| identity · 職員修正身份資料 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 固定同一人及操作；檢查所提交的資料及身份核實。 |
| restrictions · 會籍與限制 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 兩種獨立狀態分列，每項操作說明實際影響。 |
| ban · 暫停帳戶使用 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 不改變會籍狀態；保留現有不可操作對象保護。 |
| unban · 解除帳戶暫停 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 不會自動恢復已停用會籍。 |
| deactivate · 停用會籍 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 保留帳戶及紀錄；有清楚嘅結果與下一步。 |
| reactivate · 重新啟用會籍 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 不會解除獨立嘅保安暫停。 |
| deletion · 刪除合資格帳戶 | Task / work | `src/features/account/identity-form.tsx`, `src/features/account/restrictions-form.tsx`, `src/features/account/deletion-form.tsx` | 僅限現行政策下無教會業務紀錄且有權管理嘅帳戶。不可逆操作需明確確認。 |
| applications · 會籍申請審批列表 | App / wide | `src/app/staff/applications/page.tsx`, `src/features/account/decision-review.tsx` | 只呈現現有待批核申請，進入單一申請作決定。 |
| application-review · 審閱及決定 | Task / work | `src/app/staff/applications/page.tsx`, `src/features/account/decision-review.tsx` | 申請人可見原因與內部理由分開；一般審批沿用現有規則，不要求再次確認密碼。 |
| audit · 帳戶操作紀錄 | App / wide | `src/app/staff/account-audit/page.tsx` | 唯讀，不新增 export、編輯、過濾後端或刪除紀錄功能。 |
| audit-detail · 操作紀錄內容 | Task / work | `src/app/staff/account-audit/page.tsx` | 既有紀錄嘅展開視圖；永不顯示密碼、session 或其他秘密。 |
| confirm · 原工作內密碼確認 | Task / work | `src/features/account/security-form.tsx`, `src/components/unavailable-view.tsx`, `src/features/home/unavailable.tsx`, `src/app/error.tsx`, `src/app/primary-navigation.tsx`, `src/features/auth/restored-page-revalidator.tsx` | 保持職員、目標人及原操作。確認成功後仍需明確提交；10 分鐘政策不變。 |
| leave · 尚未提交：離開提醒 | Task / work | `src/features/account/security-form.tsx`, `src/components/unavailable-view.tsx`, `src/features/home/unavailable.tsx`, `src/app/error.tsx`, `src/app/primary-navigation.tsx`, `src/features/auth/restored-page-revalidator.tsx` | 此提示只處理未送出草稿，不清走已提交但未知結果嘅 reference。 |
| operation · 已提交：查核與復原 | Task / work | `src/features/account/security-form.tsx`, `src/components/unavailable-view.tsx`, `src/features/home/unavailable.tsx`, `src/app/error.tsx`, `src/app/primary-navigation.tsx`, `src/features/auth/restored-page-revalidator.tsx` | 以原操作 reference 查核；不提供換人、另開操作或丟棄 reference 捷徑。 |
| unavailable · 資料暫時無法載入 | Task / work | `src/features/account/security-form.tsx`, `src/components/unavailable-view.tsx`, `src/features/home/unavailable.tsx`, `src/app/error.tsx`, `src/app/primary-navigation.tsx`, `src/features/auth/restored-page-revalidator.tsx` | 不把讀取失敗呈現成空資料；只重試已交付嘅受保護目的地。 |
| error · 頁面發生錯誤 | Task / work | `src/features/account/security-form.tsx`, `src/components/unavailable-view.tsx`, `src/features/home/unavailable.tsx`, `src/app/error.tsx`, `src/app/primary-navigation.tsx`, `src/features/auth/restored-page-revalidator.tsx` | 不展示 stack trace 或內部診斷。 |
| denied · 沒有此操作權限 | Task / work | `src/features/account/security-form.tsx`, `src/components/unavailable-view.tsx`, `src/features/home/unavailable.tsx`, `src/app/error.tsx`, `src/app/primary-navigation.tsx`, `src/features/auth/restored-page-revalidator.tsx` | 不顯示受保護人物資料；返回有權使用嘅個人目的地。 |
| signout · 登出 | Auth / compact | `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-form.tsx`, `src/features/account/application-form.tsx`, `src/features/auth/sign-out-button.tsx` | 未確認登出時不能聲稱已登出。 |

## Current Staff account integration (#53)

`src/app/staff/accounts/page.tsx` remains the server route and authority boundary. It reads the roster through `getStaffAccounts` in `src/features/account/staff-accounts.ts` (Drizzle) and serializes task context. `staff-management-workspace.tsx` owns person-first search/selection; `staff-task-contract.ts` defines client-safe actor/target/return context and operation-reference binding, not authorization.

`StaffAccountsForm` keeps the shared create/recovery React workflow, with explicit editing, review, operation/handover and #51 in-task confirmation phases rather than a shared view-prop bag. Other selected-person tasks consume `StaffPersonTaskContext`; `StaffTaskFrame` and task dirty-return protection remain in use. Server reads and mutations still check current authority, and a missing target renders the existing missing-target state without selecting another person.

## Assisted creation and one-time handover (#54)

The `create` phase owns one live `useAppForm` with shared Base UI fields; the submission-boundary parse produces the reviewed payload and explicit request. Creation and recovery both use the typed Hono client and fresh Query reconciliation. `post-operation.ts` was removed by #60 after the current source and graph showed no production consumers.

On the server, `createAssistedAccount` executes one ordered Drizzle batch (user, credential, profile, audit, `staff_account_operation`, then `requireDrizzleWrittenReceipt` as the last item) with the unchanged authority/identity predicates, fingerprint and duplicate/conflict recovery; `requireSensitiveStaff`, `findOperation` and the conflict check use the same builders. The `handover` phase presents the receipt and the one-time credential for the original actor only — the credential is never replayed from reconciliation or storage, and a lost handover requires an explicit re-verification and reissue. `resetStaffPassword` was migrated to builders and the shared sensitive-staff assertion by #55 (see below).

## Verified recovery, password reset and temporary reissue (#55)

The `recovery` phase owns exactly one live Form (`useAppForm`, the same narrow composition as creation) whose submission-boundary parse (`staffRecoveryFormSchema`) produces the reviewed identity method and target: the acknowledgement checkbox, target selection and verification method are Form values, while the review snapshot, #51 in-task confirmation and the unresolved operation reference stay feature-owned React state. Both 檢查 buttons keep their distinct reset/reissue modes and the review confirmation re-submits the reviewed action; reset and reissue travel through the typed Hono client (`businessRpc`, per-request `x-efcc-expected-actor-id`) inside the existing no-retry Mutation, so a lost response stays UNKNOWN and reconciles with the original reference. Sensitive Form/mutation state resets at submit settle, discard and completion without clearing unresolved metadata.

On the server, `resetStaffPassword` executes one ordered Drizzle batch: the shared `sensitiveStaffAssertion` first, the credential-revision- and identity-evidence-conditioned account update, the conditioned session revocation, the conditioned audit insert and the receipt insert, ending with `requireDrizzleWrittenReceipt`. The `staff_account_operation_requires_complete_write` trigger still enforces credential revision, temporary-expiry equality, session invalidation and audit/receipt completeness, so D1 commits or rolls back the whole operation; `requireManagedAccount` now reads the current target eligibility through the same builders and the native `receiptStatement` adapter was removed.

## Current identity/contact integration (#56)

`src/features/account/identity-form.tsx` keeps one live TanStack Form owner per task, with explicit edit/review steps, an immutable review snapshot taken from the same existing field defaults, the #51 session-bound confirmation dialog and the original-operation UNKNOWN/reconcile flow. Own-phone and Staff-identity commands travel through the typed `hc<AppType>` client inside a no-retry Mutation; only action/actor/target/key metadata is retained locally, and the Staff task still renders through `StaffIdentityCorrections` with `StaffPersonTaskContext`.

`account-guards.ts` owns the shared Drizzle `sensitiveStaffAssertion`, `recordAccountChange` and `findAccountChange` items used by identity, restriction and deletion writers in the same ordered batches. #60 removed the native assertion/record pair after the migrations left it with zero consumers; the Drizzle helpers and independent durable-effect assertions remain.

## Eligible deletion integration (#58)

`src/features/account/deletion-form.tsx` keeps one live TanStack Form owning the destruction checkbox (shared Base UI `CheckboxField` plus its explicit acknowledgement validator) and its review, then reuses the #51 session-bound confirmation dialog before the one explicit final submit; the checkbox/review snapshot, original-operation UNKNOWN/reconcile flow and the target-left-roster recovery state are driven by the same DOM it always rendered. The delete command travels through the typed `hc<AppType>` client inside a no-retry Mutation with the page's expected-actor header, and only action/actor/target/key metadata is retained locally. A missing target never auto-selects another account or claims success.

`src/features/account/deletion.ts` writes through the shared `sensitiveStaffAssertion`/`recordAccountChange` Drizzle contract in one ordered batch: Staff authority assertion, current-state/history snapshot assertion, schema-bound `DELETE FROM user`, required audit plus account-change receipt (with its completeness assertion), and the final no-half-deleted assertion. The history pre-read keeps its existing predicate, and the last-effective-Admin catch comparison now uses the same builder helper as the restriction writer; the request/local/receipt shapes live in the client-safe `deletion-contract.ts`.

`tests/e2e/staff-fixture.ts` consolidates the repeated synthetic Staff setup/session/confirmation protocol consumed by the identity, restriction and deletion suites; each suite keeps its own actor/target differences and independent D1 effect assertions.

## Current restriction integration (#57)

`src/features/account/restrictions-form.tsx` keeps each of the four independent operations explicit (ban, unban, deactivate, reactivate) with the existing review/Back/Cancel/dirty protection, the #51 session-bound confirmation dialog and the original-operation UNKNOWN/reconcile flow. Commands travel through the typed `hc<AppType>` client inside a no-retry Mutation with the expected-actor header, and `src/features/account/restriction-contract.ts` owns the client-safe payload/receipt/stored-reference schemas shared with the server parser.

`src/features/account/restrictions.ts` now writes the restriction effect through the shared Drizzle guard/receipt contract in one ordered `db.batch`: `sensitiveStaffAssertion`, current-state snapshot assertion, conditional `person_profile` update, `recordAccountChange` and the final completeness assertion. The authority/state-change conflict and last-effective-Admin checks are unchanged; the durable Admin eligibility read (stored password, no temporary-password window; never live sessions) uses the central builders through `otherEffectiveAdminExists`, which the deletion writer now shares.

## Whole-repo contract and qualification (#60)

T13 removed the zero-consumer `post-operation.ts` and native account-change guard pair; native `requireWrittenReceipt`, `receiptStatement`, `recoveryReviewFromFields` and `StaffAccountsFormView` had already been removed by their owning tickets after their consumers migrated. Remaining Drizzle receipt assertions and same-batch account-change guards stay because current writers use them to roll back incomplete effects.

Durable account writers evaluate session, temporary-credential and sensitive-Staff confirmation deadlines against SQLite's execution-time clock; JS timestamps remain bound for recorded effects. Applicant retries preserve the original normalized parser serialization used by stored fingerprints. Business JSON validation uses the shared bounded reader, including parameterized JSON media types.

Staff identity refresh clears an unavailable verification method and its acknowledgement without discarding other draft values or unresolved references. Decision review uses the shared Form schema for field errors while retaining the explicit normalized review snapshot; approval does not require a rejection reason.

Staff creation, reset and reissue invalidate the pending one-time handover on hide or task exit. A late successful response cannot restore its plaintext even after returning to the page; the committed receipt and original-actor reference remain available, and a replacement credential requires explicit verification/reissue.

The T13 ledger is the candidate-bound record for exact SHA, commands, counts and log locators; earlier-SHA evidence does not qualify this checkout. #45 physical-device/native-enlargement qualification remains separate.
