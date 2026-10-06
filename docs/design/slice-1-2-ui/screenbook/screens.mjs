// Design-only fixtures. No auth, persistence, API calls or real member records.
// State arrays are intentional: the first option is the screenbook default.
const entry = (id, title, group, route, variants, note = "") => ({
  group,
  id,
  note,
  route,
  title,
  variants,
});
export const screens = [
  entry(
    "home",
    "個人 Home",
    "01 · 日常使用",
    "/",
    [
      ["default", "全部即將聚會"],
      ["staff", "職員個人 Home"],
      ["date", "按日期篩選"],
      ["emptyday", "當日沒有聚會"],
      ["empty", "未有參與資訊"],
      ["noevents", "已批准但未有聚會"],
      ["loading", "載入中"],
      ["unavailable", "讀取失敗"],
    ],
    "日期只篩選現有、已授權嘅未來聚會。待批核及候補獨立顯示；「報名已批准」不代表出席。"
  ),
  entry(
    "inbox",
    "收件匣",
    "01 · 日常使用",
    "/inbox",
    [
      ["default", "會籍批准紀錄"],
      ["staff", "職員收件匣"],
      ["rejected", "拒絕及可見原因"],
      ["noreason", "拒絕紀錄沒有可見原因"],
      ["empty", "未有決定"],
      ["unavailable", "讀取失敗"],
    ],
    "只呈現既有會籍審批紀錄；沒有新增未讀標記或通知訂閱。"
  ),
  entry(
    "account",
    "帳戶總覽",
    "01 · 日常使用",
    "/account · /status · /application",
    [
      ["default", "完整權限"],
      ["staff", "職員帳戶"],
      ["restricted", "會籍待批核"],
      ["deactivated", "會籍已停用"],
      ["banned", "帳戶暫停（會籍已批准）"],
      ["pendingbanned", "待批核及帳戶暫停"],
      ["combined", "停用及暫停"],
      ["missing", "會籍待確認"],
    ],
    "將姓名、Username、會籍、我的申請及安全設定集中；保留原有可用目的地。"
  ),
  entry(
    "phone",
    "更新聯絡電話",
    "01 · 日常使用",
    "/account",
    [
      ["default", "編輯電話"],
      ["validation", "格式錯誤"],
      ["conflict", "電話衝突"],
      ["success", "已更新"],
    ],
    "只有現行政策允許嘅帳戶可自行改電話；姓名與電郵修正由符合資格嘅申請人或 Staff 處理。"
  ),
  entry(
    "security",
    "帳戶安全選單",
    "01 · 日常使用",
    "/account",
    [
      ["default", "未確認目前密碼"],
      ["confirmed", "十分鐘確認有效"],
    ],
    "清楚分開更改密碼、登出其他裝置、敏感操作密碼確認。"
  ),
  entry(
    "password",
    "更改密碼",
    "01 · 日常使用",
    "/account",
    [
      ["default", "輸入密碼"],
      ["validation", "兩次密碼不同"],
      ["submitting", "提交中"],
      ["success", "已更改"],
    ],
    "保留目前登入，其他裝置下次請求時登出；無 email reset。"
  ),
  entry(
    "sessions",
    "登出其他裝置",
    "01 · 日常使用",
    "/account",
    [
      ["default", "確認操作"],
      ["success", "已處理"],
    ],
    "沒有虛構裝置列表；保留目前登入。"
  ),
  entry(
    "application",
    "我的申請",
    "01 · 日常使用",
    "/application",
    [
      ["pending", "待批核"],
      ["rejected", "已拒絕"],
      ["withdrawn", "已撤回"],
      ["approved", "已批准"],
      ["none", "沒有申請"],
      ["ineligiblepending", "待批核：不可自行處理"],
      ["ineligiblerejected", "已拒絕：不可自行處理"],
      ["ineligiblewithdrawn", "已撤回：不可自行處理"],
      ["ineligibleapproved", "已批准：不可自行處理"],
    ],
    "申請狀態與目前會籍／保安限制不同；只有符合既有 never-approved 條件嘅申請人可維護。"
  ),
  entry(
    "app-edit",
    "修正申請資料",
    "01 · 日常使用",
    "/application",
    [
      ["default", "編輯資料"],
      ["validation", "資料未完整"],
      ["success", "已修正"],
    ],
    "Username 固定；電郵改動不會啟用電郵驗證或復原。"
  ),
  entry(
    "app-withdraw",
    "撤回申請",
    "01 · 日常使用",
    "/application",
    [
      ["default", "確認撤回"],
      ["success", "已撤回"],
    ],
    "只供符合資格嘅待批核申請人。撤回後可重新提交，並非刪除帳戶。"
  ),
  entry(
    "app-resubmit",
    "重新提交申請",
    "01 · 日常使用",
    "/application",
    [
      ["default", "拒絕後重交"],
      ["withdrawn", "撤回後重交"],
      ["success", "已重新提交"],
    ],
    "拒絕或撤回後重新進入審批，並非自動批准。"
  ),
  entry(
    "signin",
    "登入",
    "02 · 登入與申請",
    "/sign-in",
    [
      ["default", "Username 登入"],
      ["name", "中文全名登入"],
      ["ambiguous", "同名提示"],
      ["invalid", "資料不符"],
      ["nameinvalid", "中文全名資料不符"],
      ["rate", "請求過多"],
      ["expired", "臨時密碼已到期"],
      ["auth", "需要重新登入"],
      ["network", "無法連接系統"],
      ["system", "系統暂時無法登入"],
      ["submitting", "登入中"],
    ],
    "Username 為預設；中文全名同名時轉用 Username。不新增 email、SSO 或忘記密碼流程。"
  ),
  entry(
    "apply",
    "申請帳戶",
    "02 · 登入與申請",
    "/apply",
    [
      ["default", "申請表"],
      ["retry", "原申請重新嘗試"],
      ["validation", "欄位錯誤"],
      ["conflict", "資料衝突"],
      ["rate", "請求過多"],
      ["security", "安全檢查未通過"],
      ["submitting", "提交中"],
    ],
    "公眾申請需電話、中文全名、Username、電郵及密碼；其他資料選填；不設公眾共用電話例外。"
  ),
  entry(
    "apply-result",
    "申請提交結果",
    "02 · 登入與申請",
    "/apply",
    [
      ["success", "已收到申請"],
      ["unknown", "結果未確認"],
      ["checking", "查核中"],
      ["retry", "未找到紀錄"],
      ["rate", "查核暫受限制"],
      ["storage", "尚未提交：儲存失敗"],
      ["storageunknown", "原申請 reference 無法確認"],
      ["conflict", "申請資料需要查核"],
    ],
    "提交不會自動登入。未確認結果必須先查核原操作，避免重複申請。"
  ),
  entry(
    "status",
    "帳戶狀態",
    "02 · 登入與申請",
    "/status",
    [
      ["pending", "會籍待批核"],
      ["active", "可使用"],
      ["deactivated", "會籍已停用"],
      ["banned", "帳戶已暫停"],
      ["combined", "停用及暫停"],
      ["pendingbanned", "待批核及暫停"],
      ["missing", "會籍待確認"],
      ["rechecking", "重新檢查中"],
    ],
    "會籍與保安限制獨立；解除暫停不會重新啟用會籍。受限用戶仍可到收件匣及帳戶。"
  ),
  entry(
    "temp-password",
    "首次更改臨時密碼",
    "02 · 登入與申請",
    "/account",
    [
      ["default", "臨時密碼仍有效"],
      ["expired", "臨時密碼到期"],
      ["validation", "密碼不相符"],
      ["submitting", "提交中"],
      ["success", "已更改"],
    ],
    "此時只顯示帳戶安全及登出。改密碼不改變會籍或保安限制。"
  ),
  entry(
    "management",
    "管理入口",
    "03 · Staff 工作區",
    "Existing staff destinations",
    [["default", "可用工作"]],
    "由個人 Home 進入管理；只列 Slice 1–2 已提供且有權限嘅工作。"
  ),
  entry(
    "accounts",
    "搜尋及選擇帳戶",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "帳戶列表"],
      ["empty", "沒有符合搜尋"],
      ["loading", "載入中"],
      ["unavailable", "未能讀取"],
    ],
    "安全身份資料（姓名、Username）用於區分同名；建立帳戶是獨立工作。"
  ),
  entry(
    "person",
    "帳戶工作總覽",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "已批准 Member"],
      ["deactivated", "會籍停用"],
      ["banned", "帳戶暫停"],
      ["combined", "會籍停用及帳戶暫停"],
      ["protected", "目前無權操作"],
    ],
    "先選人再選操作。Desktop 列表／詳細資料並排；手機逐步進入。所有操作仍由 server 判定。"
  ),
  entry(
    "create",
    "職員協助建立帳戶",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "填寫及身份核實"],
      ["shared", "共用電話例外"],
      ["validation", "資料待修正"],
      ["review", "提交前檢查"],
      ["submitting", "正在建立"],
    ],
    "不新增角色配置；臨時密碼只於成功回應顯示一次，必須安全交收。"
  ),
  entry(
    "handover",
    "臨時密碼交收",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["created", "建立成功"],
      ["reset", "復原成功"],
      ["reissued", "重新發出成功"],
      ["receipt", "已完成但密碼不可重顯"],
    ],
    "成功收據不會再次揭露臨時密碼。若交收未完成，需重新核實並明確重新發出。"
  ),
  entry(
    "recovery",
    "帳戶復原",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "核實身份"],
      ["review", "檢查重設密碼"],
      ["reissue", "檢查重新發出"],
      ["temporary", "目前有臨時密碼"],
      ["verifiedphone", "有原有已核實電話"],
      ["ineligible", "帳戶不符合資格"],
    ],
    "核實渠道受現行政策限制；不可用嘅電話核實方式清楚禁用。"
  ),
  entry(
    "identity",
    "職員修正身份資料",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "編輯姓名／Username／電郵／電話"],
      ["verifiedphone", "有原有已核實電話"],
      ["validation", "資料錯誤"],
      ["review", "檢查更改"],
      ["success", "已更新"],
    ],
    "固定同一人及操作；檢查所提交的資料及身份核實。"
  ),
  entry(
    "restrictions",
    "會籍與限制",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "正常帳戶"],
      ["deactivated", "會籍已停用"],
      ["banned", "帳戶已暫停"],
      ["combined", "兩項限制並存"],
      ["protected", "受保護對象"],
      ["lastadmin", "最後有效 Admin 保護"],
    ],
    "兩種獨立狀態分列，每項操作說明實際影響。"
  ),
  entry(
    "ban",
    "暫停帳戶使用",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "對象與操作影響"],
      ["review", "最終檢查"],
      ["success", "已暫停"],
    ],
    "不改變會籍狀態；保留現有不可操作對象保護。"
  ),
  entry(
    "unban",
    "解除帳戶暫停",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "對象與操作影響"],
      ["review", "最終檢查"],
      ["success", "已解除"],
    ],
    "不會自動恢復已停用會籍。"
  ),
  entry(
    "deactivate",
    "停用會籍",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "對象與操作影響"],
      ["review", "最終檢查"],
      ["success", "已停用"],
    ],
    "保留帳戶及紀錄；有清楚嘅結果與下一步。"
  ),
  entry(
    "reactivate",
    "重新啟用會籍",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "對象與操作影響"],
      ["review", "最終檢查"],
      ["success", "已重新啟用"],
    ],
    "不會解除獨立嘅保安暫停。"
  ),
  entry(
    "deletion",
    "刪除合資格帳戶",
    "03 · Staff 工作區",
    "/staff/accounts",
    [
      ["default", "資格與影響"],
      ["review", "刪除前檢查"],
      ["success", "已刪除"],
      ["denied", "有教會業務紀錄"],
      ["lastadmin", "最後有效 Admin 保護"],
    ],
    "僅限現行政策下無教會業務紀錄且有權管理嘅帳戶。不可逆操作需明確確認。"
  ),
  entry(
    "applications",
    "會籍申請審批列表",
    "03 · Staff 工作區",
    "/staff/applications",
    [
      ["default", "待批核列表"],
      ["empty", "暫無待批核"],
      ["unavailable", "未能讀取"],
    ],
    "只呈現現有待批核申請，進入單一申請作決定。"
  ),
  entry(
    "application-review",
    "審閱及決定",
    "03 · Staff 工作區",
    "/staff/applications",
    [
      ["default", "申請詳細資料"],
      ["approve", "檢查批准"],
      ["reject", "填寫拒絕原因"],
      ["stale", "申請已被處理"],
      ["approved", "批准完成"],
      ["rejected", "拒絕完成"],
    ],
    "申請人可見原因與內部理由分開；一般審批沿用現有規則，不要求再次確認密碼。"
  ),
  entry(
    "audit",
    "帳戶操作紀錄",
    "03 · Staff 工作區",
    "/staff/account-audit",
    [
      ["default", "最近紀錄"],
      ["empty", "未有紀錄"],
      ["unavailable", "未能讀取"],
    ],
    "唯讀，不新增 export、編輯、過濾後端或刪除紀錄功能。"
  ),
  entry(
    "audit-detail",
    "操作紀錄內容",
    "03 · Staff 工作區",
    "/staff/account-audit",
    [
      ["default", "操作及識別碼"],
      ["handover", "臨時密碼操作"],
    ],
    "既有紀錄嘅展開視圖；永不顯示密碼、session 或其他秘密。"
  ),
  entry(
    "confirm",
    "原工作內密碼確認",
    "04 · 共用狀態與復原",
    "/account security + current workflow",
    [
      ["default", "確認目前密碼"],
      ["invalid", "密碼不正確"],
      ["expired", "確認有效期已過"],
      ["checking", "查核確認中"],
      ["unknown", "確認结果未知"],
      ["confirmed", "確認收據：檢查目前有效性"],
    ],
    "保持職員、目標人及原操作。確認成功後仍需明確提交；10 分鐘政策不變。"
  ),
  entry(
    "leave",
    "尚未提交：離開提醒",
    "04 · 共用狀態與復原",
    "Shared unsent forms",
    [["default", "繼續或放棄"]],
    "此提示只處理未送出草稿，不清走已提交但未知結果嘅 reference。"
  ),
  entry(
    "operation",
    "已提交：查核與復原",
    "04 · 共用狀態與復原",
    "Existing reconciliation endpoints",
    [
      ["unknown", "結果未確認"],
      ["checking", "正在查核"],
      ["retry", "未找到已完成紀錄"],
      ["confirmed", "已確認完成"],
      ["actor", "需原職員登入"],
      ["denied", "權限改變"],
      ["storage", "無法保存查核資料"],
    ],
    "以原操作 reference 查核；不提供換人、另開操作或丟棄 reference 捷徑。"
  ),
  entry(
    "unavailable",
    "資料暫時無法載入",
    "04 · 共用狀態與復原",
    "/unavailable",
    [
      ["default", "重新載入"],
      ["home", "Home 讀取失敗"],
      ["auth", "登入狀態未能確認"],
    ],
    "不把讀取失敗呈現成空資料；只重試已交付嘅受保護目的地。"
  ),
  entry(
    "error",
    "頁面發生錯誤",
    "04 · 共用狀態與復原",
    "src/app/error.tsx",
    [["default", "重試頁面"]],
    "不展示 stack trace 或內部診斷。"
  ),
  entry(
    "denied",
    "沒有此操作權限",
    "04 · 共用狀態與復原",
    "Staff protected routes",
    [["default", "存取被拒絕"]],
    "不顯示受保護人物資料；返回有權使用嘅個人目的地。"
  ),
  entry(
    "signout",
    "登出",
    "04 · 共用狀態與復原",
    "Shared sign-out",
    [
      ["default", "正在登出"],
      ["unknown", "未能確認登出"],
    ],
    "未確認登出時不能聲稱已登出。"
  ),
];
export const recoverable = new Set([
  "phone",
  "password",
  "temp-password",
  "sessions",
  "app-edit",
  "app-withdraw",
  "app-resubmit",
  "create",
  "recovery",
  "identity",
  "ban",
  "unban",
  "deactivate",
  "reactivate",
  "deletion",
  "application-review",
]);
export const recoveryVariants = new Map([
  ["unknown", "結果未確認"],
  ["checking", "正在查核"],
  ["retrying", "未找到紀錄：原操作重試"],
  ["receipt", "已確認完成紀錄"],
  ["actor", "需要原帳戶登入"],
  ["deniedoperation", "目前無權查核"],
  ["storage", "尚未提交：儲存失敗"],
  ["rejectedoperation", "操作明確未完成"],
]);
for (const screen of screens) {
  if (recoverable.has(screen.id)) {
    for (const variant of recoveryVariants) {
      if (!screen.variants.some((v) => v[0] === variant[0])) {
        screen.variants.push(variant);
      }
    }
  }
}
export const weekDates = (offset) =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2026, 9, 5 + offset * 7 + i)).toISOString().slice(0, 10)
  );
// Presentation validation for synthetic fixtures; server validation remains authoritative.
export const previewPhone = (value) => {
  const compact = value
    .normalize("NFKC")
    .trim()
    .replaceAll(/[ .()-]/gu, "");
  if (/^[2-9]\d{7}$/u.test(compact)) {
    return `+852${compact}`;
  }
  const hk = /^\+?852(?<local>[2-9]\d{7})$/u.exec(compact);
  if (hk) {
    return `+852${hk.groups.local}`;
  }
  if (/^\+?852/u.test(compact)) {
    return null;
  }
  return /^\+[1-9]\d{7,14}$/u.test(compact) ? compact : null;
};
export const rootScreens = new Set([
  "home",
  "inbox",
  "account",
  "management",
  "accounts",
  "applications",
  "audit",
]);
export const screenLayout = (id) => {
  if (["signin", "apply", "apply-result", "signout"].includes(id)) {
    return { content: "compact", family: "auth" };
  }
  if (rootScreens.has(id)) {
    return { content: "wide", family: "root" };
  }
  return { content: id === "person" ? "split" : "work", family: "task" };
};
export const identityValues = (person, edits = {}) => ({
  email: person.email ?? "",
  fullName: person.name,
  identityCheck: "face_to_face",
  phone: person.phone ?? "",
  sharedPhone: person.sharedPhone ?? false,
  username: person.username,
  ...edits,
});
export const restrictionAfter = (before, action) => {
  if (action === "ban") {
    return { ...before, banned: true };
  }
  if (action === "unban") {
    return { ...before, banned: false };
  }
  if (action === "deactivate") {
    return { ...before, deactivated: true };
  }
  return { ...before, deactivated: false };
};
export const getScreen = (id) => screens.find((s) => s.id === id) || screens[0];
export const defaultState = (id) => getScreen(id).variants[0][0];
export const escape = (value) =>
  String(value ?? "").replaceAll(
    /[&<>"']/gu,
    (c) =>
      ({ '"': "&quot;", "&": "&amp;", "'": "&#39;", "<": "&lt;", ">": "&gt;" })[
        c
      ]
  );
