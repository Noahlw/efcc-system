# Whole Slice 1–2 presentation foundation — R9

The prototype consolidates frame rules in `foundation.css`; `app.css` retains component decoration. `screenLayout()` assigns each delivered subflow a presentation role. Existing `render.mjs` field/summary/notice/target/result helpers are reused. This is a synthetic design seam; it does not prescribe copying the prototype renderer into React.

| Role | Shared rules |
| --- | --- |
| App roots | Mobile navigation anchored at viewport bottom; intrinsic footer height reserves space even when labels wrap. Main is the scroll region. Desktop sidebar and wide content up to 72rem. |
| Focused task | One return/title row, no mobile bottom nav. Work up to 40rem, centred on desktop; selected-person list/detail up to 64rem. Context and final controls remain reachable. |
| Auth | Central compact single-column canvas up to 28rem; no management sidebar. Sign-in, sign-out pending/unknown share branding and controls. Long public application grows and scrolls. Account security remains a task. |
| Type | Body 17, label 16, metadata 14, section 20, task 22, root 28/Home 32. rem roles scale; no fixed content height. |
| Controls | Phone primary/fields 52, secondary 48, effective targets ≥44×44. Explicit labels and keyboard focus; dialog cancel/Escape/focus-return retain current work. |
| Lists/forms/outcomes | Common gaps, summaries, notices and action groups. Field descriptors and existing review helpers remain useful; feature-owned validation, actor/target/action, reconciliation and one-time secrets remain distinct. |

Production reuse should deepen existing UI modules with a small shared frame/control seam, preserve server-capable presentation and client interactive leaves, and use installed Base UI/Tailwind/TanStack adapters. CVA remains conditional on real repeated variants; no dependency was added. Role-aware navigation uses current authorized functionality, not a duplicated UI per role. Route Groups may organize shared layouts without changing URLs, but never replace data/action authorization. See [the assessment](architecture-research.md#route-groups-shared-nested-layouts-and-roles--assessment).

The 40 rows below map every design subflow exactly once to its current owner family. Owner paths refer to production baseline `100bde89af5b8177e7625bd9b36580c0ab254c43`. They are not 40 standalone routes. [Census](ui-architecture-census.json) records the complete 31-TSX inventory; [coverage inside the current archive](design-book-revision-9.zip) lists all 306 states. Each row has primary mobile/desktop evidence under `audit-r9/after/<id>-mobile.jpg` and `-desktop.jpg`.

| Screen/subflow | Shared presentation | Current production owners | Unique preserved behavior |
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
