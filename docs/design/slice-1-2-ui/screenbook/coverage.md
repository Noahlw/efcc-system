# EFCC Slice 1–2 design coverage

Revision 11 · 5 October 2026 · Synthetic design reference. The owner confirmed the complete understanding in Q23; Q20 whole Slice 1–2 scope remains preserved. Canonical issue #30 remains Revision 8 pending a separately invoked rewrite.

40 primary screens/subflows; 306 selectable fixture states share outcome templates. This does not mean 306 independently captured layouts. All 40 primary screens retain their unchanged R9 mobile/desktop reference captures. The R11 authentication-unavailable correction has new responsive evidence under ../verification/.

## 01 · 日常使用

| Screen | Current route or surface | Designed states |
| --- | --- | --- |
| [個人 Home](index.html#home) | / | 全部即將聚會 / 職員個人 Home / 按日期篩選 / 當日沒有聚會 / 未有參與資訊 / 已批准但未有聚會 / 載入中 / 讀取失敗 |
| [收件匣](index.html#inbox) | /inbox | 會籍批准紀錄 / 職員收件匣 / 拒絕及可見原因 / 拒絕紀錄沒有可見原因 / 未有決定 / 讀取失敗 |
| [帳戶總覽](index.html#account) | /account · /status · /application | 完整權限 / 職員帳戶 / 會籍待批核 / 會籍已停用 / 帳戶暫停（會籍已批准） / 待批核及帳戶暫停 / 停用及暫停 / 會籍待確認 |
| [更新聯絡電話](index.html#phone) | /account | 編輯電話 / 格式錯誤 / 電話衝突 / 已更新 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [帳戶安全選單](index.html#security) | /account | 未確認目前密碼 / 十分鐘確認有效 |
| [更改密碼](index.html#password) | /account | 輸入密碼 / 兩次密碼不同 / 提交中 / 已更改 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [登出其他裝置](index.html#sessions) | /account | 確認操作 / 已處理 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [我的申請](index.html#application) | /application | 待批核 / 已拒絕 / 已撤回 / 已批准 / 沒有申請 / 待批核：不可自行處理 / 已拒絕：不可自行處理 / 已撤回：不可自行處理 / 已批准：不可自行處理 |
| [修正申請資料](index.html#app-edit) | /application | 編輯資料 / 資料未完整 / 已修正 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [撤回申請](index.html#app-withdraw) | /application | 確認撤回 / 已撤回 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [重新提交申請](index.html#app-resubmit) | /application | 拒絕後重交 / 撤回後重交 / 已重新提交 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |

## 02 · 登入與申請

| Screen | Current route or surface | Designed states |
| --- | --- | --- |
| [登入](index.html#signin) | /sign-in | Username 登入 / 中文全名登入 / 同名提示 / 資料不符 / 中文全名資料不符 / 請求過多 / 臨時密碼已到期 / 需要重新登入 / 無法連接系統 / 系統暂時無法登入 / 登入中 |
| [申請帳戶](index.html#apply) | /apply | 申請表 / 原申請重新嘗試 / 欄位錯誤 / 資料衝突 / 請求過多 / 安全檢查未通過 / 提交中 |
| [申請提交結果](index.html#apply-result) | /apply | 已收到申請 / 結果未確認 / 查核中 / 未找到紀錄 / 查核暫受限制 / 尚未提交：儲存失敗 / 原申請 reference 無法確認 / 申請資料需要查核 |
| [帳戶狀態](index.html#status) | /status | 會籍待批核 / 可使用 / 會籍已停用 / 帳戶已暫停 / 停用及暫停 / 待批核及暫停 / 會籍待確認 / 重新檢查中 |
| [首次更改臨時密碼](index.html#temp-password) | /account | 臨時密碼仍有效 / 臨時密碼到期 / 密碼不相符 / 提交中 / 已更改 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |

## 03 · Staff 工作區

| Screen | Current route or surface | Designed states |
| --- | --- | --- |
| [管理入口](index.html#management) | Existing staff destinations | 可用工作 |
| [搜尋及選擇帳戶](index.html#accounts) | /staff/accounts | 帳戶列表 / 沒有符合搜尋 / 載入中 / 未能讀取 |
| [帳戶工作總覽](index.html#person) | /staff/accounts | 已批准 Member / 會籍停用 / 帳戶暫停 / 會籍停用及帳戶暫停 / 目前無權操作 |
| [職員協助建立帳戶](index.html#create) | /staff/accounts | 填寫及身份核實 / 共用電話例外 / 資料待修正 / 提交前檢查 / 正在建立 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [臨時密碼交收](index.html#handover) | /staff/accounts | 建立成功 / 復原成功 / 重新發出成功 / 已完成但密碼不可重顯 |
| [帳戶復原](index.html#recovery) | /staff/accounts | 核實身份 / 檢查重設密碼 / 檢查重新發出 / 目前有臨時密碼 / 有原有已核實電話 / 帳戶不符合資格 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [職員修正身份資料](index.html#identity) | /staff/accounts | 編輯姓名／Username／電郵／電話 / 有原有已核實電話 / 資料錯誤 / 檢查更改 / 已更新 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [會籍與限制](index.html#restrictions) | /staff/accounts | 正常帳戶 / 會籍已停用 / 帳戶已暫停 / 兩項限制並存 / 受保護對象 / 最後有效 Admin 保護 |
| [暫停帳戶使用](index.html#ban) | /staff/accounts | 對象與操作影響 / 最終檢查 / 已暫停 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [解除帳戶暫停](index.html#unban) | /staff/accounts | 對象與操作影響 / 最終檢查 / 已解除 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [停用會籍](index.html#deactivate) | /staff/accounts | 對象與操作影響 / 最終檢查 / 已停用 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [重新啟用會籍](index.html#reactivate) | /staff/accounts | 對象與操作影響 / 最終檢查 / 已重新啟用 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [刪除合資格帳戶](index.html#deletion) | /staff/accounts | 資格與影響 / 刪除前檢查 / 已刪除 / 有教會業務紀錄 / 最後有效 Admin 保護 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [會籍申請審批列表](index.html#applications) | /staff/applications | 待批核列表 / 暫無待批核 / 未能讀取 |
| [審閱及決定](index.html#application-review) | /staff/applications | 申請詳細資料 / 檢查批准 / 填寫拒絕原因 / 申請已被處理 / 批准完成 / 拒絕完成 / 結果未確認 / 正在查核 / 未找到紀錄：原操作重試 / 已確認完成紀錄 / 需要原帳戶登入 / 目前無權查核 / 尚未提交：儲存失敗 / 操作明確未完成 |
| [帳戶操作紀錄](index.html#audit) | /staff/account-audit | 最近紀錄 / 未有紀錄 / 未能讀取 |
| [操作紀錄內容](index.html#audit-detail) | /staff/account-audit | 操作及識別碼 / 臨時密碼操作 |

## 04 · 共用狀態與復原

| Screen | Current route or surface | Designed states |
| --- | --- | --- |
| [原工作內密碼確認](index.html#confirm) | /account security + current workflow | 確認目前密碼 / 密碼不正確 / 確認有效期已過 / 查核確認中 / 確認结果未知 / 確認收據：檢查目前有效性 |
| [尚未提交：離開提醒](index.html#leave) | Shared unsent forms | 繼續或放棄 |
| [已提交：查核與復原](index.html#operation) | Existing reconciliation endpoints | 結果未確認 / 正在查核 / 未找到已完成紀錄 / 已確認完成 / 需原職員登入 / 權限改變 / 無法保存查核資料 |
| [資料暫時無法載入](index.html#unavailable) | /unavailable | 重新載入 / Home 讀取失敗 / 登入狀態未能確認 |
| [頁面發生錯誤](index.html#error) | src/app/error.tsx | 重試頁面 |
| [沒有此操作權限](index.html#denied) | Staff protected routes | 存取被拒絕 |
| [登出](index.html#signout) | Shared sign-out | 正在登出 / 未能確認登出 |

## Authority and limits

The confirmed Revision 9 understanding, selected second visual direction and Q14 task-focused mobile navigation govern this design revision. Source authority remains current Slice 1–2 at 100bde8, the existing lifecycle/access contracts and the accepted decisions in ../understanding.md. See [the current R9 report](../qualification.md) for findings and evidence. Real authentication, authorization, reconciliation persistence and Worker/D1 behavior are not qualified by this prototype.
