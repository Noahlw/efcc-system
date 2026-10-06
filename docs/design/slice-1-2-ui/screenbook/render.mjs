import {
  getScreen,
  recoverable,
  recoveryVariants,
  restrictionAfter,
  rootScreens,
  screenLayout,
  escape as e,
} from "./screens.mjs";

const defaultRenderContext = { id: "identity", result: "success" };

export const icon = (name) =>
  `<img class="icon" src="assets/${name}.svg" alt="" aria-hidden="true">`;
export const link = (label, id, state = "", cls = "") =>
  `<a class="${cls}" href="app.html?screen=${id}${state ? `&state=${state}` : ""}" data-go="${id}" data-state="${state}">${label}</a>`;
const button = (label, id, state = "", cls = "") =>
  link(label, id, state, `button ${cls}`);
const badge = (text, tone = "") => `<span class="badge ${tone}">${text}</span>`;
const notice = (title, text, tone = "") =>
  `<div class="notice ${tone}" role="status"><strong>${title}</strong>${text}</div>`;
const heading = (title, sub = "", back = "") =>
  `<header class="page-heading ${back ? "has-back" : ""}"><div class="title-row">${back ? link(icon("ArrowLeft"), back, "", "back").replace("<a ", '<a aria-label="返回" ') : ""}<h1>${title}</h1></div></header>${sub ? `<p class="page-intro">${sub}</p>` : ""}`;
const summary = (rows) =>
  `<dl class="summary">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const fieldDescription = (name, hint, error) => {
  if (!hint && !error) {
    return "";
  }
  const ids = [];
  if (hint) {
    ids.push(`hint-${name}`);
  }
  if (error) {
    ids.push(`error-${name}`);
  }
  return `aria-describedby="${ids.join(" ")}"`;
};
const inputLimits = (name, type) => {
  if (name === "username") {
    return 'minlength="3" maxlength="30" pattern="[A-Za-z0-9_.]{3,30}"';
  }
  if (name === "fullName") {
    return 'maxlength="200"';
  }
  if (name === "email") {
    return 'maxlength="254"';
  }
  if (type === "tel") {
    return 'maxlength="40"';
  }
  return 'maxlength="500"';
};
const inputAutocomplete = (name, type) => {
  if (type === "tel") {
    return 'autocomplete="tel"';
  }
  if (name === "email") {
    return 'autocomplete="email"';
  }
  if (name === "fullName") {
    return 'autocomplete="name"';
  }
  return "";
};
const fieldControl = (label, name, value, hint, type, error, optional) => {
  const description = fieldDescription(name, hint, error);
  const required = optional ? "" : "required";
  if (type === "textarea") {
    return `<textarea aria-label="${e(label)}" ${description} maxlength="500" name="${name}" ${required}>${e(value)}</textarea>`;
  }
  if (type === "password") {
    const autocomplete =
      name === "currentPassword" ? "current-password" : "new-password";
    const minLength = name === "currentPassword" ? "1" : "8";
    return `<div class="password"><input aria-label="${e(label)}" ${description} name="${name}" type="password" value="${e(value)}" autocomplete="${autocomplete}" ${required} minlength="${minLength}" maxlength="128"><button class="icon-button" type="button" data-eye aria-label="顯示${label}">${icon("Eye")}</button></div>`;
  }
  const invalid = error ? 'aria-invalid="true"' : "";
  return `<input aria-label="${e(label)}" ${description} name="${name}" type="${type}" value="${e(value)}" ${inputLimits(name, type)} ${required} ${inputAutocomplete(name, type)} ${invalid}>`;
};
const field = (
  label,
  name,
  value = "",
  hint = "",
  type = "text",
  error = "",
  optional = false
) => {
  const optionalLabel = optional ? ' <span class="muted">（選填）</span>' : "";
  const control = fieldControl(label, name, value, hint, type, error, optional);
  const hintText = hint
    ? `<span class="hint" id="hint-${name}">${hint}</span>`
    : "";
  const errorText = error
    ? `<span class="error" id="error-${name}">${error}</span>`
    : "";
  return `<label class="field"><span>${label}${optionalLabel}</span>${control}${hintText}${errorText}</label>`;
};
const check = (label, name = "verified", checked = false) =>
  `<label class="check"><input name="${name}" type="checkbox" ${checked ? "checked" : ""} required><span>${label}</span></label>`;
const form = (body, label, id, state = "", busy = false) =>
  `<form data-submit="${id}" data-state="${state}">${body}<div class="actions"><button class="button full" type="submit" ${busy ? "disabled" : ""}>${busy ? "正在處理…" : label}</button></div></form>`;
const row = (title, sub, ico, id, state = "") =>
  link(
    `${ico ? `<span class="icon-well">${icon(ico)}</span>` : ""}<span class="row-copy"><strong>${title}</strong>${sub ? `<small>${sub}</small>` : ""}</span>${icon("ChevronRight")}`,
    id,
    state,
    "row"
  );
const empty = (title, text, ico = "CalendarDays", action = "") =>
  `<div class="empty">${icon(ico)}<h2>${title}</h2><p>${text}</p>${action}</div>`;
const target = (
  name = "黃大明",
  username = "wong.tai.ming",
  switchable = true
) =>
  `<div class="target"><div><strong>${name}</strong><small>${username}</small></div>${switchable ? link("更換對象", "accounts") : ""}</div>`;
const profile = (
  name = "黃大明",
  username = "wong.tai.ming",
  state = "會籍已批准",
  tone = ""
) =>
  `<div class="profile"><span class="avatar">${name.slice(0, 1)}</span><div><h2>${name}</h2><p>${username}</p><div class="badges">${badge(state, tone)}</div></div></div>`;
const success = (
  title,
  text,
  action = "返回帳戶",
  id = "account",
  state = ""
) =>
  `<section class="result"><div class="status-mark">${icon("CircleCheck")}</div>${heading(title, text)}<div class="actions">${button(action, id, state)}</div></section>`;
const loading = () =>
  `<div class="loading" role="status"><p>正在載入，請稍候。</p><div class="skeleton"></div><div class="skeleton large"></div><div class="skeleton"></div></div>`;
const unavailable = (title = "暫時未能載入資料", id = "home") =>
  `${["accounts", "applications", "audit"].includes(id) ? `<h2 class="state-title">${title}</h2><p class="page-intro">我們未能確認最新資料。請稍後重試。</p>` : heading(title, "我們未能確認最新資料。請稍後重試。")}<div class="status-mark amber">${icon("RefreshCw")}</div><div class="actions">${button("重新載入", id)}${button("登出", "signout", "", "secondary")}</div>`;
const tabs = (selected) =>
  `<nav class="management-tabs" aria-label="管理工作">${[
    ["accounts", "帳戶"],
    ["applications", "審批"],
    ["audit", "紀錄"],
  ]
    .map(([id, title]) =>
      link(title, id, "", id === selected ? "selected" : "")
    )
    .join("")}</nav>`;
const people = () =>
  `<div class="people"><label class="field"><span>搜尋帳戶</span><input type="search" placeholder="姓名或 Username" data-search="people"></label><div class="result-count">3 個帳戶</div>${[
    ["黃大明", "wong.tai.ming"],
    ["黃大明", "wong.tm.02"],
    ["李小恩", "lee.siu.yan"],
  ]
    .map(
      ([name, username], i) =>
        `<a class="row ${i === 0 ? "selected" : ""}" href="app.html?screen=person" data-go="person" data-person="${name}|${username}" data-searchable="${name} ${username}"><span class="avatar">${name[0]}</span><span class="row-copy"><strong>${name}</strong><small>${username}</small></span>${icon("ChevronRight")}</a>`
    )
    .join(
      ""
    )}<p class="hint" data-search-empty hidden>沒有符合搜尋的帳戶。</p></div>`;
const narrow = (html) => `<div class="content-narrow">${html}</div>`;
const staffLayout = (html) =>
  `${tabs("accounts")}<div class="management-layout"><aside class="desktop-people">${people()}</aside><div class="main-workspace">${html}</div></div>`;
const authShell = (body) =>
  `<div class="auth" data-layout="auth"><main class="main"><div class="auth-canvas" data-content="compact"><header class="auth-brand"><div class="wordmark">顯恩堂</div><div class="church-name">中國基督教播道會顯恩堂</div></header>${body}</div></main></div>`;
const statusData = {
  active: ["帳戶可正常使用", "你的帳戶目前可使用教會功能。", ""],
  banned: [
    "帳戶已暫停使用",
    "你的帳戶已被暫停使用。解除暫停不會自動恢復會籍。",
    "red",
  ],
  deactivated: [
    "會籍已停用",
    "你的會籍已停用，因此未能使用教會功能。",
    "amber",
  ],
  missing: [
    "會籍狀態待確認",
    "我們未能確認你的會籍狀態，請聯絡教會同工。",
    "amber",
  ],
  pending: [
    "會籍待批核",
    "你的會籍仍在批核中。你可以查看或修正申請，並留意收件匣的審批決定。",
    "amber",
  ],
};
const operationCopy = {
  actor: [
    "需要原職員登入",
    "這次操作由另一個職員帳戶提交。請使用原職員帳戶登入後查核；查核資料會保留。",
  ],
  checking: ["正在查核原操作", "請稍候。我們會用原本的查核資料確認結果。"],
  confirmed: [
    "已確認操作完成",
    "此紀錄證明原操作已完成。臨時密碼不會再次顯示；如未完成交收，請重新核實身份後重新發出。",
  ],
  denied: [
    "目前未能查核",
    "你的權限或帳戶狀態已改變。查核資料已保留，請聯絡具權限的同工協助。",
  ],
  retry: [
    "未找到已完成紀錄",
    "目前未找到這次操作的完成紀錄。可使用同一操作重新嘗試；不代表先前已成功。",
  ],
  storage: [
    "未能保存查核資料",
    "這次操作尚未送出。請確認瀏覽器可使用本機儲存後重試。",
  ],
  unknown: [
    "操作結果未確認",
    "你剛才的要求可能已經送出。請先查核原操作，暫時不要重複提交。",
  ],
};
const home = (state) => {
  if (state === "unavailable") {
    return unavailable("暫時未能載入主頁", "home");
  }
  if (state === "loading") {
    return heading("我的主頁") + loading();
  }
  const isEmpty = state === "empty";
  const isDay = state === "date" || state === "emptyday";
  const emptyAgenda = {
    empty: empty(
      "下一次相聚，從這裏開始",
      "當有即將參與的聚會，時間及安排會顯示在這裏。"
    ),
    emptyday: empty(
      "這一天沒有聚會",
      "試試其他日期，或查看所有即將參與的聚會。",
      "CalendarDays",
      button("查看全部", "home", "", "secondary")
    ),
    noevents: empty(
      "暫未有即將舉行的聚會",
      "你已獲批准的 Program 會顯示在參與狀態。"
    ),
  }[state];
  const agenda =
    emptyAgenda ??
    `<article class="event"><div class="event-date"><strong>11</strong>週日</div><div class="event-body"><h3>主日崇拜</h3><p>10:30 · 敬拜部</p>${badge("報名已批准")}</div></article>${isDay ? "" : `<article class="event"><div class="event-date"><strong>18</strong>週日</div><div class="event-body"><h3>主日崇拜</h3><p>10:30 · 敬拜部</p>${badge("報名已批准")}</div></article>`}`;
  return `${heading("我的主頁", "大明，早晨。")}<div class="home-grid"><div><div class="date-controls"><span data-month>2026 年 10 月</span><div><button class="text-button ${isDay ? "" : "selected"}" data-go="home" aria-pressed="${!isDay}">全部</button><button class="icon-button" data-week="-1" aria-label="上一週" disabled>${icon("ChevronLeft")}</button><button class="icon-button" data-week="1" aria-label="下一週">${icon("ChevronRight")}</button></div></div><div class="week">${["一", "二", "三", "四", "五", "六", "日"].map((d, i) => `<button class="day ${i === 0 ? "today" : ""} ${isDay && i === (state === "date" ? 6 : 1) ? "selected" : ""}" data-day="${i + 5}" aria-pressed="${isDay && i === (state === "date" ? 6 : 1)}" ${i === 6 ? 'data-event="true"' : ""}><small>${d}</small><span>${i + 5}</span></button>`).join("")}</div><section class="section"><div class="section-heading"><h2>${isDay ? `${state === "date" ? "10 月 11 日" : "10 月 6 日"}的聚會` : "即將參與"}</h2><span class="hint">香港時間</span></div><div data-agenda>${agenda}</div></section>${isEmpty ? "" : button("查看參與狀態", "home", "", "plain full").replace('data-go="home"', 'data-scroll="participation"')}</div><div class="home-secondary"><section class="section" id="participation"><div class="section-heading"><h2>參與狀態</h2></div>${isEmpty ? `<p class="muted">目前未有參與紀錄。</p>` : `${state === "noevents" ? `<article class="participation"><h3>讀經小組</h3>${badge("報名已批准")}<p>暫未有即將舉行的聚會。</p></article>` : ""}<article class="participation"><h3>青年小組</h3>${badge("待批核", "amber")}<p>審批後才會確認參與。</p></article><article class="participation"><h3>週六團契</h3>${badge("候補中", "gray")}<p>目前仍在候補名單。</p></article>`}</section><section class="section"><div class="section-heading"><h2>有效邀請</h2></div>${isEmpty ? `<p class="muted">目前沒有有效邀請。</p>` : `<div class="panel"><h3>新朋友聚會</h3><p class="hint">聚會邀請 · 有效至 10 月 20 日</p><p class="hint" style="margin-top:10px">邀請並不代表報名已批准。</p></div>`}</section><section class="section"><div class="section-heading"><h2>教會消息</h2></div>${isEmpty ? `<p class="muted">目前沒有教會消息。</p>` : `<details><summary><span>${icon("FileText")} 教會週報</span>${icon("ChevronRight")}</summary><p>本週主日崇拜安排已更新。請按教會公佈的安排參與。</p><p>10 月 4 日</p></details>`}</section></div></div>`;
};
const signin = (state) => {
  const name = ["name", "ambiguous", "nameinvalid"].includes(state);
  const alerts = {
    ambiguous: [
      "有多個帳戶使用這個姓名",
      "請改用你的 Username 登入。姓名相同不代表同一個帳戶。",
    ],
    auth: ["請重新登入", "為保障你的帳戶，請重新登入後繼續。"],
    expired: ["臨時密碼已到期", "請聯絡職員重新發出臨時密碼。"],
    invalid: ["未能登入", "請檢查登入資料及密碼後再試。"],
    nameinvalid: ["未能登入", "請檢查登入資料及密碼後再試。"],
    network: ["無法連接系統", "請檢查網絡後再試。"],
    rate: ["請稍後再試", "登入嘗試次數較多，請稍候再試。"],
    system: ["系統暫時無法登入", "請稍後再試。"],
  };
  return authShell(
    `${heading("登入", "回到你的教會生活。")}${alerts[state] ? notice(...alerts[state], state === "auth" ? "" : "amber") : ""}<div class="tabs" aria-label="登入方式">${link("Username", "signin", "", `${name ? "" : "selected"}`)}${link("中文全名", "signin", "name", name ? "selected" : "")}</div>${form(`${field(name ? "中文全名" : "Username", name ? "fullName" : "username", "", name ? "輸入申請時填寫的完整姓名。" : "你的專屬使用者名稱。")}${field("密碼", "currentPassword", "", "", "password")}`, state === "submitting" ? "登入中…" : "登入", "home", "", state === "submitting")}${state === "ambiguous" ? `<div class="actions">${button("改用使用者名稱", "signin", "", "secondary full")}</div>` : ""}<p class="auth-foot">第一次使用？ ${link("申請帳戶", "apply")}</p><p class="foot-note">忘記登入資料或需要協助，請聯絡教會同工。</p>`
  );
};
const renderApplicationConflict = () =>
  authShell(
    `${heading(
      "申請資料需要查核",
      "這次提交的結果尚未確認。請先查核原申請，避免重複提交。"
    )}${summary([["查核編號", "AP-DEMO-001"]])}<div class="actions">${button("重新查核申請結果", "apply-result", "unknown")}</div>`
  );
const apply = (state) => {
  if (state === "conflict") {
    return renderApplicationConflict();
  }
  if (state === "security") {
    return authShell(
      heading("未能提交申請", "安全檢查未能通過，這次申請沒有提交。") +
        button("重新載入", "apply", "", "secondary")
    );
  }

  const alerts = {
    conflict: [
      "未能提交申請",
      "部分資料未能使用。請檢查資料；如需共用電話，請聯絡同工協助。",
    ],
    rate: ["請稍後再試", "提交次數較多，請稍候再試。"],
    security: ["未能通過安全檢查", "請重新載入申請頁面後再試。"],
  };
  return authShell(
    `${heading("申請帳戶", "填寫資料，讓教會同工認識你。", "signin")}${state === "retry" ? notice("正在重試原申請", "保留 AP-DEMO-001，請重新填寫同一份申請資料。", "amber") : ""}${alerts[state] ? notice(...alerts[state], "amber") : ""}${form(`${field("电话號碼".replace("电话", "電話"), "phone", "", "香港本地或國際格式，例如 +852 6000 0001。", "tel", state === "validation" ? "請輸入有效的電話號碼。" : "")}${field("中文全名", "fullName", "", "請填寫你的完整中文姓名。", "text", state === "validation" ? "請填寫完整中文姓名。" : "")}${field("Username", "username", "", "3–30 個英文字母、數字、底線或點。", "text", state === "validation" ? "Username 只可使用指定字元，至少 3 個。" : "")}${field("電郵地址", "email", "", "只作聯絡資料，目前未提供電郵確認或密碼重設。", "email", state === "validation" ? "請輸入有效的電郵地址。" : "")}${field("設定密碼", "password", "", "8–128 個字元。", "password", state === "validation" ? "密碼至少需要 8 個字元。" : "")}<details><summary>其他資料（選填）${icon("ChevronRight")}</summary>${field("介紹人", "referral", "", "", "text", "", true)}${field("小組", "group", "", "", "text", "", true)}${field("申請原因或補充資料", "intent", "", "", "textarea", "", true)}</details>`, "提交申請", "apply-result", "success", state === "submitting")}<p class="auth-foot">已經有帳戶？ ${link("登入", "signin")}</p>`
  );
};
const applyResult = (state) => {
  if (state === "storageunknown") {
    return authShell(
      heading(
        "未能確認原申請記錄",
        "瀏覽器無法讀取之前的查核資料。未確認前，不能開始另一份申請。"
      ) +
        notice(
          "請先恢復原申請查核",
          "保留此瀏覽器資料，不要清除儲存或重新申請。",
          "amber"
        ) +
        button("重新查核裝置記錄", "apply-result", "unknown", "full")
    );
  }
  if (state === "conflict") {
    return renderApplicationConflict();
  }

  if (state === "success") {
    return authShell(
      `${success("已收到你的申請", "教會同工會審閱你的資料。你可以登入查看申請進度。", "前往登入", "signin")}<div class="receipt">${summary(
        [
          ["申請人", "黃大明"],
          ["Username", "wong.tai.ming"],
          ["狀態", badge("待批核", "amber")],
        ]
      )}</div><p class="hint">提交申請後尚未登入，亦未獲批使用教會功能。</p><div class="actions">${button("清除此裝置記錄，開始另一份申請", "apply", "", "secondary full").replace("data-go=", 'data-reset-application="true" data-go=')}</div>`
    );
  }
  const data =
    state === "rate"
      ? ["暫時未能查核", "查核次數較多，請稍候再試。原有查核資料會保留。"]
      : operationCopy[state] || operationCopy.unknown;
  const primaryButton =
    {
      default: button("查核之前的申請", "apply-result", "checking"),
      retry: button("以原操作重新嘗試", "apply", "retry"),
      storage: button("返回申請表", "apply"),
    }[state] ?? button("查核之前的申請", "apply-result", "checking");
  const followupButton =
    state === "storage"
      ? ""
      : button("稍後繼續查核", "apply-result", "unknown", "secondary");
  const actions =
    state === "checking"
      ? loading()
      : `<div class="actions vertical">${primaryButton}${followupButton}</div>`;
  const receipt =
    state === "storage"
      ? ""
      : `<div class="receipt">${summary([
          ["操作", "提交會籍申請"],
          ["查核編號", "AP-DEMO-001"],
        ])}</div>`;
  return authShell(`${heading(data[0], data[1])}${receipt}${actions}`);
};
const account = (state, context) => {
  const pending = ["restricted", "pendingbanned"].includes(state);
  const noPhone = pending || state === "missing";
  const statusByState = {
    default: "active",
    pendingbanned: "pendingbanned",
    restricted: "pending",
    staff: "active",
  };
  const status = statusByState[state] ?? state;
  let label = "會籍已批准";
  if (pending) {
    label = "會籍待批核";
  } else if (["deactivated", "combined"].includes(state)) {
    label = "會籍已停用";
  } else if (state === "missing") {
    label = "會籍待確認";
  }
  return `${heading("帳戶", "你的資料與帳戶設定。")}${profile("黃大明", "wong.tai.ming", label, pending || ["deactivated", "combined", "missing"].includes(state) ? "amber" : "")}${["banned", "combined", "pendingbanned"].includes(state) ? notice("帳戶已暫停使用", "保安限制與會籍狀態分開處理。", "red") : ""}<div class="grid two"><section class="section"><h2>個人資料</h2>${summary(
    [
      ["中文全名", "黃大明"],
      ["Username", "wong.tai.ming"],
      ["電郵", "demo@example.com"],
      ["聯絡電話", e(context.phone || "+852 6000 0001")],
    ]
  )}${noPhone ? "" : row("更新聯絡電話", "需要改姓名或電郵？請聯絡教會同工。", "Smartphone", "phone")}</section><section class="section"><h2>我的帳戶</h2><div class="list">${row("帳戶狀態", "查看目前會籍及限制", "UserRound", "status", status)}${row("我的申請", "查看申請資料及審批狀態", "FileText", "application", pending ? "pending" : "approved")}${row("帳戶安全", "密碼、装置登入及敏感操作確認".replace("装置", "裝置"), "ShieldCheck", "security")}</div>${link(`${icon("LogOut")} 登出`, "signout", "", "button secondary full sign-out")}</section></div>`;
};
const security = (state) =>
  narrow(
    `${heading("帳戶安全", "管理你的登入與安全設定。", "account")}${state === "confirmed" ? notice("目前密碼已確認", "此登入的確認有效至 10:40（香港），敏感操作仍會再次檢查。") : notice("尚未確認目前密碼", "有需要時，可在原本工作內完成確認。", "gray")}<div class="list">${row("更改密碼", "保留目前登入，登出其他裝置", "KeyRound", "password")}${row("登出其他裝置", "結束其他登入，保留此裝置", "LogOut", "sessions")}${row("確認目前密碼", "敏感操作確認，有效十分鐘", "ShieldCheck", "confirm")}</div>`
  );
const password = (state, temp = false) => {
  if (state === "success") {
    return narrow(
      success(
        "密碼已更改",
        `目前登入已保留，其他裝置將在下次請求時登出。${temp ? "原有會籍及保安限制維持不變。" : ""}`,
        temp ? "查看帳戶狀態" : "返回帳戶安全",
        temp ? "status" : "security",
        temp ? "pending" : ""
      )
    );
  }
  if (state === "expired") {
    return narrow(
      `${heading("臨時密碼已到期", "請聯絡職員重新發出；目前不能更改密碼或使用其他功能。")}<div class="status-mark amber">${icon("KeyRound")}</div>${button("登出", "signout", "", "secondary full")}`
    );
  }
  return narrow(
    `${heading(temp ? "設定你的新密碼" : "更改密碼", temp ? "完成後，便可按目前會籍狀態繼續使用。" : "保留目前登入，其他裝置會在下次請求時登出。", temp ? "" : "security")}${temp ? notice("請先更改臨時密碼", "臨時密碼有效至 2026 年 10 月 12 日 10:20（香港）。", "amber") : ""}${form(`${field(temp ? "臨時密碼" : "目前密碼", "currentPassword", "", "", "password")}${field("新密碼", "newPassword", "", "8–128 個字元。", "password")}${field("再次輸入新密碼", "confirmPassword", "", "", "password", state === "validation" ? "兩次輸入的新密碼不相符。" : "")}`, "更改密碼", temp ? "temp-password" : "password", "success", state === "submitting")}${temp ? `<div class="actions">${button("登出", "signout", "", "plain")}</div>` : ""}`
  );
};
const phone = (state, context) => {
  if (state === "success") {
    return narrow(
      success(
        "電話已更新",
        `你的聯絡電話已更新為 ${e(context.phone || "+852 6000 0002")}。`
      )
    );
  }
  return narrow(
    `${heading("更新聯絡電話", "姓名及 Username 維持不變。", "account")}${state === "conflict" ? notice("這個電話未能使用", "請檢查電話；如需要共用家庭電話，請聯絡同工協助。", "amber") : ""}${summary(
      [
        ["帳戶", "黃大明 · wong.tai.ming"],
        ["目前電話", e(context.phone || "+852 6000 0001")],
      ]
    )}${form(field("新電話號碼", "phone", "+852 6000 0002", "香港本地或國際格式。", "tel", state === "validation" ? "請輸入有效的電話號碼。" : ""), "儲存電話", "phone", "success")}`
  );
};
const application = (state) => {
  const actual = state.startsWith("ineligible")
    ? state.slice("ineligible".length)
    : state;
  if (state === "none") {
    return narrow(
      `${heading("我的申請", "", "account")}${empty("目前沒有申請紀錄", "你的帳戶可能由教會同工協助建立。請查看帳戶狀態。", "FileText", button("帳戶狀態", "status", "active", "secondary"))}`
    );
  }
  const statuses = {
    approved: ["已批准", ""],
    pending: ["待批核", "amber"],
    rejected: ["已拒絕", "red"],
    withdrawn: ["已撤回", "gray"],
  };
  const [label, tone] = statuses[actual] || statuses.pending;
  const eligible = ["pending", "rejected", "withdrawn"].includes(state);
  let decisionNotice = "";
  if (state === "rejected") {
    decisionNotice = notice(
      "審批說明",
      "請補充與教會聯繫的資料後重新提交。",
      "amber"
    );
  } else if (state === "approved") {
    decisionNotice = notice(
      "申請已獲批准",
      "這是申請的審批結果。請查看帳戶狀態了解目前可用功能。"
    );
  } else if (state.startsWith("ineligible")) {
    decisionNotice = notice(
      "目前不能自行修改",
      "此帳戶不符合申請人自助修正條件。已完成的操作仍可查核。",
      "gray"
    );
  }
  return narrow(
    `${heading("我的申請", "申請資料與最新審批進度。", "account")}<div class="badges">${badge(label, tone)}</div><div class="section">${summary(
      [
        ["中文全名", "黃大明"],
        ["Username", "wong.tai.ming"],
        ["電郵", "demo@example.com"],
        ["電話", "+852 6000 0001"],
        ["提交時間", "2026 年 10 月 4 日<br>15:20（香港）"],
      ]
    )}</div>${decisionNotice}${eligible ? `<div class="list section">${row("修正申請資料", "姓名、電郵及電話；Username 不變", "FileText", "app-edit")}</div><div class="actions">${state === "pending" ? button("撤回申請", "app-withdraw", "", "secondary") : button("重新提交申請", "app-resubmit", state === "withdrawn" ? "withdrawn" : "")}</div>` : ""}<div class="inline-links">${link("查看帳戶狀態", "status", actual === "approved" ? "active" : "pending")}${link("查看審批決定", "inbox", actual === "rejected" ? "rejected" : "default")}</div>`
  );
};
const applicantAction = (id, state, context = {}) => {
  let currentStatus = "已拒絕";
  if (id === "app-withdraw") {
    currentStatus = "待批核";
  } else if (state === "withdrawn") {
    currentStatus = "已撤回";
  }
  if (state === "success") {
    const copy = {
      "app-edit": [
        "申請資料已更新",
        "更改已保存，申請狀態保持不變。",
        context.applicationStatus || "pending",
      ],
      "app-resubmit": [
        "申請已重新提交",
        "教會同工會重新審閱，請留意收件匣。",
        "pending",
      ],
      "app-withdraw": [
        "申請已撤回",
        "會籍維持待批核。你可隨時檢查資料後重新提交。",
        "withdrawn",
      ],
    }[id];
    return narrow(
      success(copy[0], copy[1], "返回我的申請", "application", copy[2])
    );
  }
  if (id === "app-edit") {
    return narrow(
      `${heading("修正申請資料", "Username 維持 wong.tai.ming。", "application")}${form(`${field("中文全名", "fullName", "黃大明")}${field("電郵", "email", "demo@example.com", "電郵仍未經驗證，不會啟用電郵復原。", "email", state === "validation" ? "請輸入有效的電郵地址。" : "")}${field("電話", "phone", "+852 6000 0001", "", "tel")}`, "儲存更改", id, "success")}`
    );
  }
  return narrow(
    `${heading(id === "app-withdraw" ? "撤回這份申請？" : "重新提交申請", "請先核對以下資料。", "application")}${summary(
      [
        ["申請人", "黃大明"],
        ["Username", "wong.tai.ming"],
        ["目前狀態", currentStatus],
      ]
    )}<div class="section">${notice(id === "app-withdraw" ? "這不會刪除你的帳戶" : "提交後需等候審批", id === "app-withdraw" ? "這份申請會移出待批核名單，之後可重新提交。" : "同工會再次審閱。重新提交不代表會籍已批准。", "amber")}</div><div class="actions">${button(id === "app-withdraw" ? "確認撤回" : "確認重新提交", id, "success", id === "app-withdraw" ? "danger" : "")}${button("返回我的申請", "application", "", "secondary")}</div>`
  );
};
const inbox = (state) => {
  const rejected = state === "rejected" || state === "noreason";
  if (state === "unavailable") {
    return unavailable("暫時未能載入收件匣", "inbox");
  }
  const decisionHeading = rejected ? "會籍申請已被拒絕" : "會籍申請已獲批准";
  const rejectionTextByState = {
    noreason: "這份決定沒有附加可見原因。",
    rejected: "請補充與教會聯繫的資料後重新提交。",
  };
  const decisionText = rejected
    ? rejectionTextByState[state]
    : "歡迎你！你可以查看帳戶狀態，了解目前可用功能。";
  const decisionAction = rejected
    ? button("查看我的申請", "application", "rejected", "secondary")
    : "";
  const article = `<article class="panel white"><div class="section-heading">${badge(rejected ? "申請已拒絕" : "會籍已批准", rejected ? "red" : "")}<span class="hint">10 月 5 日</span></div><h2>${decisionHeading}</h2><p class="hint" style="margin-top:8px">2026 年 10 月 5 日 09:30（香港）</p><p class="section">${decisionText}</p>${decisionAction ? `<div class="actions">${decisionAction}</div>` : ""}</article>`;
  const content =
    state === "empty"
      ? empty(
          "目前沒有審批決定",
          "當你的申請完成審批，決定會顯示在這裏。",
          "Mail"
        )
      : article;
  return narrow(
    `${heading("收件匣", "你的會籍審批決定，保留在這裏。")}${content}<p class="foot-note">決定紀錄不代表帳戶目前的使用權限；會籍及保安限制以帳戶狀態為準。</p><div class="actions">${button("重新檢查帳戶狀態", "status", rejected ? "pending" : "active", "secondary")}</div>`
  );
};
const status = (state) => {
  const pairedStatusByState = {
    combined: [statusData.deactivated, statusData.banned],
    pendingbanned: [statusData.pending, statusData.banned],
  };
  const entries = pairedStatusByState[state] || [
    statusData[state] || statusData.pending,
  ];
  return narrow(
    `${heading("帳戶狀態", "黃大明 · wong.tai.ming", "account")}${entries.map(([title, text, tone]) => `<article class="panel section"><div class="badges">${badge(title, tone)}</div><p style="margin-top:14px">${text}</p></article>`).join("")}<div class="actions vertical">${state === "rechecking" ? `<button class="button" disabled>正在重新檢查…</button>` : button("重新檢查狀態", "status", "rechecking", "secondary")}${state === "active" ? button("前往主頁", "home") : button("查看我的申請", "application", "", "secondary")}${button("登出", "signout", "", "plain")}</div>`
  );
};
const verifyIdentity = (verifiedPhone = false) =>
  `<section class="section"><h2>核實本人身份</h2><label class="radio-choice"><input type="radio" name="identityCheck" value="face_to_face" checked><span><strong>親身核實</strong><small>與帳戶本人當面確認身份。</small></span></label><label class="radio-choice"><input type="radio" name="identityCheck" value="verified_phone" ${verifiedPhone ? "" : "disabled"}><span><strong>教會原有已核實電話</strong><small>${verifiedPhone ? "由職員主動聯絡 +852 6000 0099。" : "此示例帳戶未有可用核實紀錄。"}</small></span></label>${check("已按以上方式核實本人；新聯絡資料沒有用作復原憑證。")}</section>`;
const reviewFooter = (id, result = "success", danger = false) =>
  `<div class="notice gray" data-confirmation-note>提交前需要確認目前密碼。完成後會返回這裏，再由你確認提交。</div><div class="actions"><button class="button ${danger ? "danger" : ""}" data-sensitive="${id}" data-result="${result}">確認目前密碼</button>${button("返回修改", id, "default", "secondary")}</div>`;
const management = () =>
  `${heading("管理", "陳同工，請選擇要處理的工作。")}<div class="grid two"><section><h2>帳戶與會籍</h2><div class="list section">${row("帳戶管理", "先選擇一個人，再進行需要的操作", "UsersRound", "accounts")}${row("會籍申請審批", "檢視目前待批核的申請", "FileText", "applications")}${row("建立帳戶", "協助已核實身份的人建立帳戶", "Plus", "create")}</div></section><section><h2>查閱紀錄</h2><div class="list section">${row("帳戶操作紀錄", "會籍決定、修正及帳戶安全紀錄", "ShieldCheck", "audit")}</div><p class="foot-note">只顯示你目前有權使用的工作。</p></section></div>`;
const accountsContent = (state) => {
  if (state === "unavailable") {
    return unavailable("暫時未能載入帳戶", "accounts");
  }
  if (state === "loading") {
    return loading();
  }
  if (state === "empty") {
    return `${field("搜尋帳戶", "query", "chan", "姓名或 Username。", "search")}${empty("沒有符合搜尋的帳戶", "檢查姓名或 Username，再試一次。", "Search", button("清除搜尋", "accounts", "", "secondary"))}`;
  }
  return `<p class="intro">先選擇一個人，處理他的帳戶。</p><div class="people full-list">${people()}</div>`;
};
const accounts = (state) =>
  `<div class="management-heading"><h1>帳戶管理</h1>${button(`${icon("Plus")} 建立帳戶`, "create", "", "compact")}</div>${tabs("accounts")}${accountsContent(state)}`;
const person = (state) =>
  `${heading("帳戶詳情", "", "accounts")}${staffLayout(
    `${target().replace("</small>", `</small><div class="badges">${badge(["deactivated", "combined"].includes(state) ? "會籍已停用" : "會籍已批准", ["deactivated", "combined"].includes(state) ? "amber" : "")}</div>`)}${profile("黃大明", "wong.tai.ming", ["deactivated", "combined"].includes(state) ? "會籍已停用" : "會籍已批准", ["deactivated", "combined"].includes(state) ? "amber" : "")}${["banned", "combined"].includes(state) ? notice("帳戶已暫停使用", "會籍與保安限制兩項狀態分開管理。", "red") : ""}${state === "protected" ? notice("無法管理此帳戶", "你目前沒有權限操作這個對象。請按目前角色及對象資格處理。", "amber") : `<h2 class="section">你想處理甚麼？</h2><div class="list">${row("修正身份資料", "姓名、Username、電郵及電話", "FileText", "identity")}${row("帳戶復原", "核實身份後重設或重新發出臨時密碼", "KeyRound", "recovery")}${row("會籍與限制", "會籍狀態及帳戶保安暫停", "ShieldCheck", "restrictions", state === "default" ? "default" : state)}</div>`}<section class="section"><h2>帳戶資料</h2>${summary(
      [
        ["電郵", "demo@example.com"],
        ["電話", "+852 6000 0001"],
        ["共用電話", "否"],
      ]
    )}</section>${state === "protected" ? "" : `<details class="section"><summary>其他操作${icon("ChevronRight")}</summary>${row("刪除合資格帳戶", "需符合現行刪除政策", "Trash2", "deletion", "default")}</details>`}`
  )}`;
const create = (state) => {
  if (state === "review") {
    return narrow(
      `${heading("檢查新帳戶", "核對資料後才建立。", "create")}${summary([
        ["中文全名", "李小恩"],
        ["Username", "lee.siu.yan"],
        ["電郵", "未提供"],
        ["電話", "+852 6000 0003"],
        ["會籍", "建立為已批准帳戶"],
        ["身份核實", "已親身核實"],
      ])}<div class="section">${notice("下一步會產生臨時密碼", "請準備安全交給本人。成功回應中的臨時密碼只顯示一次。", "amber")}</div>${reviewFooter("create", "handover")}`
    );
  }
  return narrow(
    `${heading("建立帳戶", "協助已核實身份的人開始使用。", "accounts")}${state === "validation" ? notice("請修正以下資料", "Username 或電話未能使用，請檢查後再試。", "amber") : ""}${form(`${field("中文全名", "fullName", "李小恩")}${field("Username", "username", "lee.siu.yan", "3–30 個英文字母、數字、底線或點。", "text", state === "validation" ? "此 Username 未能使用。" : "")}${field("電郵", "email", "", "沒有電郵可留空。", "email", "", true)}${field("電話", "phone", "+852 6000 0003", "", "tel")}<label class="check"><input type="checkbox" name="sharedPhone" ${state === "shared" ? "checked" : ""}><span>已核實共用電話例外</span></label>${state === "shared" ? notice("共用電話已核實", "只用於經核實的家庭共用電話情況。", "amber") : ""}${check("我已核實此人的身份，可以協助建立已批准帳戶。")}`, "檢查資料", "create", "review", state === "submitting")}`
  );
};
const handover = (state) => {
  const headingByState = {
    created: "帳戶已建立",
    reissued: "臨時密碼已重新發出",
    reset: "密碼已重設",
  };
  const title = headingByState[state] ?? "操作已完成";
  const instruction =
    state === "receipt"
      ? "已查核原操作的完成紀錄。"
      : "請將以下登入資料安全交給本人。";
  const newAccount = state === "created";
  const accountTarget = newAccount
    ? target("李小恩", "lee.siu.yan", false)
    : target("黃大明", "wong.tai.ming", false);
  const username = newAccount ? "lee.siu.yan" : "wong.tai.ming";
  let credentials = `<div class="receipt"><h2>一次性顯示</h2><p class="hint">Username</p><strong>${username}</strong><p class="hint section">臨時密碼 · 示範資料</p><div class="code">Demo-only!26</div><p class="hint">有效至 2026 年 10 月 12 日 10:20（香港）</p></div>${notice("首次登入需更改密碼", "離開此頁後，臨時密碼不會再次顯示。此畫面只供安全交收，不要加入紀錄或截圖轉發。", "amber")}${check("我已完成安全交收，明白離開後不能再次查看。", "handover")}<div class="actions">${button("完成交收", "person", "", "full")}</div>`;
  if (state === "receipt") {
    credentials = `${notice("臨時密碼不能再次顯示", "如果本人尚未收到密碼，請重新核實身份，再明確重新發出。", "amber")}${button("重新核實身份", "recovery", "temporary", "full")}`;
  }
  return narrow(
    `${heading(title, instruction)}${accountTarget}${credentials}<p class="foot-note">會籍及保安限制以目前帳戶狀態為準。</p>`
  );
};
const recovery = (state, context = {}) => {
  if (state === "ineligible") {
    return narrow(
      `${heading("帳戶復原", "", "person")}${target()}${notice("目前不能處理此帳戶", "此帳戶不符合你的操作權限或復原條件。", "amber")}${button("返回帳戶", "person", "", "secondary")}`
    );
  }
  if (state === "review" || state === "reissue") {
    return narrow(
      `${heading(state === "review" ? "檢查重設密碼" : "檢查重新發出", "身份核實已完成。", "recovery")}${target()}${summary(
        [
          ["本人核實", "親身核實"],
          [
            "操作",
            state === "review" ? "重設密碼並登出所有裝置" : "重新發出臨時密碼",
          ],
          ["會籍與限制", "保持目前狀態"],
        ]
      )}<div class="section">${notice("請准备安全交收".replace("准备", "準備"), "這次操作會產生新臨時密碼。本人需要使用新密碼登入並更改。", "amber")}</div>${reviewFooter("recovery", state === "review" ? "reset" : "reissued")}`
    );
  }
  return narrow(
    `${heading("帳戶復原", "本人身份核實後，再選擇需要的操作。", "person")}${target()}${summary(
      [
        ["會籍", "已批准"],
        ["保安暫停", "沒有"],
        [
          "已核實復原電話",
          state === "verifiedphone" ? "+852 6000 0099" : "未有紀錄",
        ],
      ]
    )}${form(`${verifyIdentity(state === "verifiedphone" || context.verifiedPhone)}<div class="section"><h2>需要處理的工作</h2><label class="radio-choice"><input type="radio" name="recoveryAction" value="review" checked><span><strong>重設密碼</strong><small>發出臨時密碼，登出所有裝置。</small></span></label><label class="radio-choice"><input type="radio" name="recoveryAction" value="reissue" ${state === "temporary" || context.temporaryGate ? "" : "disabled"}><span><strong>重新發出臨時密碼</strong><small>${state === "temporary" || context.temporaryGate ? "臨時密碼過期或未完成交收時使用。" : "目前沒有臨時密碼，不能使用此操作。"}</small></span></label></div>`, "檢查操作", "recovery", "review")}`
  );
};
const identity = (state, context = {}) => {
  if (state === "success") {
    return narrow(
      success(
        "身份資料已更新",
        "黃大明的資料已修正。請提醒本人使用更新後的 Username 登入。",
        "返回帳戶",
        "person"
      )
    );
  }
  if (state === "review") {
    return narrow(
      `${heading("檢查身份修正", "同一個人，同一次更改。", "identity")}${target()}${summary(
        [
          ["中文全名", "黃大明"],
          ["Username", "wong.tai.ming"],
          ["新電郵", "demo@example.com"],
          ["新電話", "+852 6000 0002"],
          ["共用電話", "否"],
          ["核實方式", "親身核實"],
        ]
      )}<div class="section">${notice("聯絡資料不會成為復原憑證", "電郵仍未經驗證；新電話沒有用來核實這次身份。", "gray")}</div>${reviewFooter("identity")}`
    );
  }
  return narrow(
    `${heading("修正身份資料", "先核實本人，才更改資料。", "person")}${target()}${form(`${field("中文全名", "fullName", "黃大明")}${field("Username", "username", "wong.tai.ming", "更改後，本人需用新的 Username 登入。")}${field("電郵", "email", "demo@example.com", "沒有電郵可留空。", "email", "", true)}${field("修正電話", "phone", "+852 6000 0002", "", "tel", state === "validation" ? "請輸入有效電話，並確認共用電話情況。" : "")}<label class="check"><input type="checkbox" name="sharedPhone"><span>已核實共用電話例外</span></label>${verifyIdentity(state === "verifiedphone" || context.verifiedPhone)}`, "檢查更改", "identity", "review")}`
  );
};
const restrictions = (state) => {
  const deactivated = state === "deactivated" || state === "combined";
  const banned = state === "banned" || state === "combined";
  const noticeByState = {
    lastadmin: notice(
      "不能限制最後一位有效管理員",
      "目前沒有其他有效 Admin；這項操作未完成。",
      "amber"
    ),
    protected: notice(
      "此對象受到保護",
      "你目前沒有權限操作這個對象；所有角色都不能管理自己的帳戶。",
      "amber"
    ),
  };
  const restrictedNotice = noticeByState[state];
  const controls =
    restrictedNotice ??
    `<section class="panel"><div class="section-heading"><h2>會籍</h2>${badge(deactivated ? "已停用" : "已批准", deactivated ? "amber" : "")}</div><p class="hint">${deactivated ? "會籍停用期間不能使用教會功能。" : "會籍已批准；是否可使用功能仍須符合帳戶保安狀態。"}</p><div class="actions">${button(deactivated ? "重新啟用會籍" : "停用會籍", deactivated ? "reactivate" : "deactivate", "", "secondary")}</div></section><section class="panel section"><div class="section-heading"><h2>帳戶保安</h2>${badge(banned ? "已暫停" : "沒有暫停", banned ? "red" : "")}</div><p class="hint">${banned ? "解除暫停不會重新啟用已停用的會籍。" : "暫停帳戶不會改變會籍狀態。"}</p><div class="actions">${button(banned ? "解除暫停" : "暫停帳戶", banned ? "unban" : "ban", "", "secondary")}</div></section>`;
  return narrow(
    `${heading("會籍與限制", "兩項狀態分開管理。", "person")}${target()}${controls}`
  );
};
const restrictionActions = {
  ban: [
    "暫停帳戶使用",
    "此人不能使用教會功能；會籍狀態不變。",
    "已暫停帳戶",
    "會籍保持已批准。",
    "banned",
  ],
  deactivate: [
    "停用會籍",
    "此人不能使用教會功能；帳戶與歷史紀錄會保留。",
    "會籍已停用",
    "帳戶保安限制維持原狀。",
    "deactivated",
  ],
  reactivate: [
    "重新啟用會籍",
    "這不會解除獨立的帳戶保安暫停。",
    "會籍已重新啟用",
    "帳戶仍有保安暫停，需要另行處理。",
    "banned",
  ],
  unban: [
    "解除帳戶暫停",
    "這不會重新啟用已停用的會籍。",
    "已解除帳戶暫停",
    "會籍仍已停用，需要另行重新啟用。",
    "deactivated",
  ],
};
const restrictionAction = (id, state, context = {}) => {
  const [title, impact, done] = restrictionActions[id];
  const prior = context.restriction || {
    banned: id === "unban",
    deactivated: id === "reactivate",
  };
  const next = restrictionAfter(prior, id);
  let result = "default";
  if (next.banned && next.deactivated) {
    result = "combined";
  } else if (next.banned) {
    result = "banned";
  } else if (next.deactivated) {
    result = "deactivated";
  }
  if (state === "success") {
    return narrow(
      `${success(done, "只更新這一項狀態，其餘限制保持原狀。", "查看最新狀態", "restrictions", result)}${summary(
        [
          ["會籍", next.deactivated ? "已停用" : "已批准"],
          ["帳戶保安", next.banned ? "已暫停" : "沒有暫停"],
        ]
      )}`
    );
  }
  return narrow(
    `${heading(title, state === "review" ? "提交前，再核對一次對象及影響。" : "請先確認這是你要處理的帳戶。", "restrictions")}${target()}${summary(
      [
        ["操作", title],
        ["對象", "黃大明 · wong.tai.ming"],
        ["目前會籍", prior.deactivated ? "已停用" : "已批准"],
        ["目前帳戶保安", prior.banned ? "已暫停" : "沒有暫停"],
      ]
    )}<div class="section">${notice("這次操作的影響", impact, ["ban", "deactivate"].includes(id) ? "amber" : "gray")}</div>${state === "review" ? reviewFooter(id, "success", ["ban", "deactivate"].includes(id)) : `<div class="actions">${button("繼續檢查", id, "review")}${button("取消", "restrictions", "", "secondary")}</div>`}`
  );
};
const deletion = (state) => {
  if (state === "success") {
    return narrow(
      success(
        "帳戶已永久刪除",
        "登入資料、密碼及工作階段已移除。歷史紀錄及 Username 保留，不會釋放。",
        "返回帳戶列表",
        "accounts"
      )
    );
  }
  let deleteDetails;
  if (state === "lastadmin") {
    deleteDetails = notice(
      "不能刪除最後一個可用管理員",
      "請先保留另一個可管理系統的管理員。這次操作未完成，亦不能改以停用繞過保護。",
      "amber"
    );
  } else if (state === "denied") {
    deleteDetails = `${notice("這個帳戶不可刪除", "此帳戶有教會業務紀錄或不符合現行刪除条件。請使用會籍停用。".replace("条件", "條件"), "amber")}<div class="actions">${button("查看會籍與限制", "restrictions", "", "secondary")}</div>`;
  } else {
    const acknowledgment =
      state === "review"
        ? `${check("我理解帳戶將永久刪除，歷史紀錄及 Username 不會刪除或釋放。", "deleteAcknowledged")}${reviewFooter("deletion", "success", true)}`
        : `<div class="actions">${button("檢查刪除", "deletion", "review", "secondary")}</div>`;
    deleteDetails = `${notice("這項操作不能復原", "登入、密碼及工作階段會移除。會籍決定、安全紀錄及所有 Username 保留。", "red")}${summary(
      [
        ["對象", "李小恩 · lee.siu.yan"],
        ["刪除資格", "提交時會再檢查"],
        ["業務紀錄", "有紀錄時必須使用會籍停用"],
      ]
    )}${acknowledgment}`;
  }
  return narrow(
    `${heading("永久刪除帳戶", "請仔細核對對象及刪除影響。", "person")}${target("李小恩", "lee.siu.yan")}${deleteDetails}`
  );
};
const applicationsContent = (state) => {
  if (state === "unavailable") {
    return unavailable("暫時未能載入待批申請", "applications");
  }
  if (state === "empty") {
    return empty(
      "所有待批申請已處理",
      "有新的待批核申請時，會顯示在這裏。",
      "CircleCheck"
    );
  }
  return `<div class="content-narrow"><div class="section-heading"><h2>待批核</h2><span class="small-count">2 份申請</span></div><div class="list">${row("李小恩", "lee.siu.yan · 10 月 4 日提交", "UserRound", "application-review")}${row("陳小明", "chan.siu.ming · 10 月 3 日提交", "UserRound", "application-review")}</div><p class="foot-note">只列出目前仍待批，而且你有權處理的申請。</p></div>`;
};
const applications = (state) =>
  `${heading("會籍申請審批", "逐份審閱，讓每個決定清楚可追溯。")}${tabs("applications")}${applicationsContent(state)}`;
const applicationReview = (state) => {
  if (["approved", "rejected"].includes(state)) {
    return narrow(
      `${success(state === "approved" ? "會籍申請已批准" : "會籍申請已拒絕", "決定已記錄，申請人可在收件匣查看。", "返回待批清單", "applications")}${summary(
        [
          ["申請人", "李小恩"],
          ["Username", "lee.siu.yan"],
          ["決定", state === "approved" ? "批准" : "拒絕"],
          ["決定識別碼", "decision-demo-001"],
        ]
      )}`
    );
  }
  if (state === "stale") {
    return narrow(
      `${heading("這份申請已被處理")}${notice("沒有再次提交決定", "申請狀態已改變。請回到待批清單查看最新資料。", "amber")}${button("返回待批清單", "applications", "", "secondary")}`
    );
  }
  const reject = state === "reject";
  return narrow(
    `${heading("審閱申請", "李小恩 · lee.siu.yan", "applications")}<div class="badges">${badge("待批核", "amber")}</div>${summary(
      [
        ["電郵", "demo@example.com"],
        ["電話", "+852 6000 0003"],
        ["所屬組別", "青年小組"],
        ["介紹人", "黃大明"],
        ["申請意向", "希望參與教會聚會，認識更多弟兄姊妹。"],
      ]
    )}<section class="section"><h2>審批決定</h2><div class="tabs">${link("批准申請", "application-review", "approve", reject ? "" : "selected")}${link("拒絕申請", "application-review", "reject", reject ? "selected" : "")}</div>${form(`${reject ? field("拒絕原因（申請人可見）", "visibleReason", "", "最多 500 字，會顯示在申請人的收件匣。", "textarea") : notice("批准這份會籍申請", "提交後，申請人會收到批准紀錄；獨立的保安限制仍然適用。", "gray")}${field("內部備註", "internalNote", "", "最多 500 字；申請人不可見。", "textarea", "", true)}`, reject ? "確認拒絕申請" : "確認批准申請", "application-review", reject ? "rejected" : "approved")}</section>`
  );
};
const auditContent = (state) => {
  if (state === "unavailable") {
    return unavailable("暫時未能載入帳戶紀錄", "audit");
  }
  if (state === "empty") {
    return empty("目前沒有帳戶紀錄", "已記錄的操作會顯示在這裏。", "FileText");
  }
  return `<div class="content-narrow"><div class="section-heading"><h2>最近紀錄</h2><span class="hint">香港時間</span></div>${[
    ["職員核實修正身份資料", "10 月 5 日 · 10:20", "default"],
    ["職員協助重設密碼", "10 月 5 日 · 10:05", "handover"],
    ["批准會籍申請", "10 月 4 日 · 16:30", "default"],
  ]
    .map(([title, time, resultState]) =>
      link(
        `<span class="icon-well">${icon("FileText")}</span><span class="row-copy"><h3>${title}</h3><small>${time}</small><p>操作者：staff-demo-01<br>對象：member-demo-01</p></span>${icon("ChevronRight")}`,
        "audit-detail",
        resultState,
        "audit-row"
      )
    )
    .join(
      ""
    )}<p class="foot-note">唯讀紀錄。帳戶刪除後，操作者及對象識別碼仍會保留。</p></div>`;
};
const audit = (state) =>
  `${heading("帳戶操作紀錄", "查看已記錄的帳戶及會籍操作。")}${tabs("audit")}${auditContent(state)}`;
const auditDetail = (state) =>
  narrow(
    `${heading("操作紀錄", "", "audit")}<div class="status-mark">${icon("FileText")}</div><h2>${state === "handover" ? "職員協助重設密碼" : "職員核實修正身份資料"}</h2><p class="hint">2026 年 10 月 5 日 10:20（香港）</p><section class="section">${summary(
      [
        ["操作者帳戶", "staff-demo-01"],
        ["對象帳戶", "member-demo-01"],
        ["紀錄識別碼", "audit-demo-001"],
      ]
    )}</section><p class="foot-note">紀錄不可修改或刪除。${state === "handover" ? "臨時密碼不會儲存在紀錄中。" : ""}</p>`
  );
const operation = (state) => {
  const [title, text] = operationCopy[state] || operationCopy.unknown;
  const recoveryBodyByState = {
    actor: button("使用原職員帳戶登入", "signin", "auth", "full"),
    checking: loading(),
    confirmed: `<div class="actions vertical">${button("完成，開始另一項操作", "person")}${button("重新核實及發出臨時密碼", "recovery", "", "secondary")}</div>`,
    denied: notice(
      "查核資料已保留",
      "請勿改用另一個人或另開相同操作。",
      "amber"
    ),
    storage: button("返回原操作", "recovery", "", "secondary full"),
  };
  const recoveryBody =
    recoveryBodyByState[state] ??
    `<div class="actions vertical">${button("查核之前的操作", "operation", "checking")}${state === "retry" ? button("以原操作重新嘗試", "recovery", "review", "secondary") : ""}</div>`;
  const footer =
    state === "storage"
      ? "尚未提交操作。"
      : "已提交的操作不屬於未儲存草稿。查核資料會保留至確認結果。";
  return narrow(
    `${heading(title, text)}<div class="receipt">${summary([
      ["操作", "職員協助重設密碼"],
      ["對象", "黃大明 · wong.tai.ming"],
      ["原職員", "staff-demo-01"],
      ["查核編號", "OP-DEMO-001"],
    ])}</div>${recoveryBody}<p class="foot-note">${footer}</p>`
  );
};
const modal = (body) =>
  `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${body}</section></div>`;
const actionNames = {
  "app-edit": "修正申請資料",
  "app-resubmit": "重新提交申請",
  "app-withdraw": "撤回申請",
  "application-review": "批准會籍申請",
  ban: "暫停帳戶",
  create: "協助建立帳戶",
  deactivate: "停用會籍",
  deletion: "永久刪除帳戶",
  identity: "修正身份資料",
  password: "更改密碼",
  phone: "更改自己的電話",
  reactivate: "重新啟用會籍",
  recovery: "重設密碼及登出全部裝置",
  sessions: "登出其他裝置",
  "temp-password": "更改臨時密碼",
  unban: "解除帳戶暫停",
};
const actionRecovery = (id, state) => {
  const staff = getScreen(id).group.startsWith("03");
  const name = actionNames[id];
  const targetName =
    id === "create" || id === "application-review"
      ? "李小恩 · lee.siu.yan"
      : "黃大明 · wong.tai.ming";
  const copy = {
    actor: [
      "請使用原帳戶登入",
      "這次操作屬於另一個登入帳戶。原查核資料會保留，不會由目前帳戶清除。",
    ],
    checking: ["正在查核原操作", "使用原本的查核資料確認結果。"],
    deniedoperation: [
      "目前未能查核",
      "權限或帳戶狀態已改變。原查核資料會保留，請聯絡同工協助。",
    ],
    receipt: ["已確認操作完成", "已找到原操作的完成紀錄。"],
    rejectedoperation: [
      "這次操作未完成",
      "伺服器已明確拒絕本次操作。請檢查最新資料及權限後重新處理。",
    ],
    retrying: [
      "尚未找到完成紀錄",
      "不能當作已成功。請以同一操作、同一對象及相同資料重試。",
    ],
    storage: [
      "這次操作尚未送出",
      "未能保存查核資料。請先確認瀏覽器儲存可用，再重試。",
    ],
    unknown: [
      "結果尚未確認",
      "要求可能已送出。請先查核這次操作，不要重複提交。",
    ],
  }[state];
  const tempReceipt =
    staff && ["create", "recovery"].includes(id) && state === "receipt";
  let completedScreen = "account";
  if (staff) {
    completedScreen = "person";
  } else if (id.startsWith("app-")) {
    completedScreen = "application";
  } else if (id === "temp-password") {
    completedScreen = "status";
  }
  const receiptBody = `<div class="actions">${button("完成，開始另一項操作", completedScreen, id === "temp-password" ? "pending" : "")}</div>`;
  const fallbackRetry =
    state === "retrying"
      ? button("以原操作重新嘗試", id, "default", "secondary").replace(
          "data-go=",
          'data-retry="true" data-go='
        )
      : "";
  const recoveryBodyByState = {
    actor: button("使用原帳戶登入", "signin", "auth", "full"),
    checking: loading(),
    deniedoperation: notice(
      "已保留原操作資料",
      "這並不代表操作成功或失敗。",
      "amber"
    ),
    receipt: receiptBody,
    rejectedoperation: button("返回原工作", id, "default", "secondary full"),
    storage: button("返回原工作", id, "default", "secondary full"),
  };
  const recoveryBody =
    recoveryBodyByState[state] ??
    `<div class="actions vertical">${button("查核之前的操作", id, "checking")}${fallbackRetry}</div>`;
  const receiptNotice = tempReceipt
    ? notice(
        "臨時密碼不會再次顯示",
        "若交收未完成，需重新核實身份後明確重新發出。",
        "amber"
      )
    : "";
  const footer =
    state === "storage"
      ? "尚未建立提交紀錄。"
      : "查核只確認歷史操作結果，不代表目前權限或密碼確認仍然有效。";
  return narrow(
    `${heading(copy[0], copy[1])}<div class="receipt">${summary([
      ["操作", name],
      ["對象", targetName],
      ["原操作者", staff ? "staff-demo-01" : "member-demo-01"],
      ["查核編號", "OP-DEMO-001"],
    ])}</div>${receiptNotice}${recoveryBody}<p class="foot-note">${footer}</p>`
  );
};
const confirmationWorkRenderers = {
  ban: (state, context) => restrictionAction("ban", state, context),
  create,
  deactivate: (state, context) =>
    restrictionAction("deactivate", state, context),
  deletion,
  identity,
  reactivate: (state, context) =>
    restrictionAction("reactivate", state, context),
  recovery,
  unban: (state, context) => restrictionAction("unban", state, context),
};
const renderConfirmationWork = (id, state, context) => {
  if (recoverable.has(id) && recoveryVariants.has(state)) {
    return actionRecovery(id, state);
  }
  const renderer = confirmationWorkRenderers[id];
  if (!renderer) {
    throw new Error(`Unmapped screen ${id}`);
  }
  return renderer(state, context);
};

const renderSessions = (state) =>
  narrow(
    state === "success"
      ? success(
          "已登出其他裝置",
          "目前登入保持有效。其他装置会在下次請求時登出。".replace(
            "装置会",
            "裝置會"
          ),
          "返回帳戶安全",
          "security"
        )
      : `${heading("登出其他裝置？", "目前這個登入會保留。", "security")}${notice("其他裝置將需要重新登入", "提交後，其他登入會在下次請求時失效。", "gray")}<div class="actions">${button("登出其他裝置", "sessions", "success")}${button("取消", "security", "", "secondary")}</div>`
  );
const renderLeave = () =>
  identity("default") +
  modal(
    `<h2 id="modal-title">放棄未提交的更改？</h2><p>你正在修改黃大明（wong.tai.ming）的資料。離開後，這些未送出的更改不會保留。</p><div class="actions">${button("繼續編輯", "identity", "", "full")}${button("放棄更改並離開", "accounts", "", "secondary full")}</div>`
  );
const renderUnavailable = (state) => {
  const titleByState = {
    auth: "暫時未能確認登入狀態",
    home: "暫時未能載入主頁",
  };
  return narrow(
    unavailable(titleByState[state], state === "auth" ? "signin" : "home")
  );
};
const renderError = () =>
  narrow(
    `${heading("這頁暫時未能開啟", "請重試；如持續出現問題，請聯絡同工。")}<div class="actions">${button("重試", "home").replace("data-go=", 'data-retry-page="true" data-go=')}${button("登出", "signout", "", "secondary")}</div>`
  );
const renderDenied = () =>
  narrow(
    `${heading("你沒有帳戶管理權限", "目前無法使用這個管理工作區。")}<div class="status-mark amber">${icon("ShieldCheck")}</div><div class="actions">${button("返回個人主頁", "home")}${button("查看帳戶狀態", "status", "active", "secondary")}</div>`
  );
const renderSignout = (state) =>
  narrow(
    state === "unknown"
      ? `${heading("未能確認登出", "目前不能確認登入是否已結束。請重試。")}<div class="actions">${button("重試登出", "signout").replace("data-go=", 'data-retry-signout="true" data-go=')}${button("返回帳戶", "account", "", "secondary")}</div>`
      : `${heading("正在登出", "正在結束這個登入，請稍候。")}${loading()}`
  );
const confirmation = (state, context = defaultRenderContext) => {
  if (state === "confirmed" && context.id === "security") {
    return narrow(
      `${heading("已查核密碼確認", "這是原操作的完成紀錄；目前的確認是否仍有效，需要重新檢查。")}${notice("不會提交任何 Staff 操作", "此操作只確認目前登入者的密碼。", "gray")}<div class="actions">${button("重新檢查確認狀態", "security", "default", "secondary")}</div>`
    );
  }
  if (state === "confirmed") {
    return narrow(
      `${heading("已查核密碼確認", "這是原確認操作的完成紀錄；目前是否仍然有效，需要重新檢查。")}${context.id === "create" || context.id === "deletion" ? target("李小恩", "lee.siu.yan", false) : target("黃大明", "wong.tai.ming", false)}${summary(
        [
          ["原工作", getScreen(context.id).title],
          ["結果", "已找到確認紀錄"],
          ["目前有效性", "需要重新檢查"],
        ]
      )}<div class="actions">${button("返回原工作，檢查目前確認", context.id, context.reviewState || "review", "secondary full")}</div>`
    );
  }
  const securityContext = context.id === "security";
  const work = securityContext
    ? security("default")
    : renderConfirmationWork(
        context.id,
        context.reviewState || "review",
        context
      );
  let targetDetails = "";
  if (!securityContext) {
    targetDetails = ["create", "deletion"].includes(context.id)
      ? target("李小恩", "lee.siu.yan", false)
      : target("黃大明", "wong.tai.ming", false);
  }
  const title = state === "expired" ? "請再次確認密碼" : "確認目前密碼";
  const noticeByState = {
    checking: notice(
      "確認結果尚未確定",
      "先查核這次密碼確認，暫時不能提交原操作。",
      "amber"
    ),
    expired: notice(
      "上次確認已過期",
      "請重新確認；原本更改尚未提交。",
      "amber"
    ),
    invalid: notice("密碼未能確認", "請檢查目前密碼後再試。", "red"),
    unknown: notice(
      "確認結果尚未確定",
      "先查核這次密碼確認，暫時不能提交原操作。",
      "amber"
    ),
  };
  let unresolvedAction = "";
  if (["unknown", "checking"].includes(state)) {
    unresolvedAction = button("查核密碼確認", "confirm", "checking", "full");
    if (state === "checking") {
      unresolvedAction = loading();
    }
  }
  const hasUnresolvedResult = ["unknown", "checking"].includes(state);
  const confirmationForm = hasUnresolvedResult
    ? `${noticeByState[state]}${unresolvedAction}`
    : `${noticeByState[state] ?? ""}${form(field("目前密碼", "currentPassword", "", "只在此登入內有效十分鐘。", "password"), "確認並返回檢查", "confirm", "confirmed")}`;
  return `${work}${modal(`<h2 id="modal-title">${title}</h2><p>確認目前登入者的身份。完成後會返回同一項工作讓你檢查。</p>${targetDetails}${confirmationForm}<div class="actions">${button("返回原工作", context.id, context.id === "security" ? "default" : context.reviewState || "review", "secondary full")}</div>`)}`;
};
const screenBodyRenderers = {
  account,
  accounts,
  "app-edit": (state, context) => applicantAction("app-edit", state, context),
  "app-resubmit": (state, context) =>
    applicantAction("app-resubmit", state, context),
  "app-withdraw": (state, context) =>
    applicantAction("app-withdraw", state, context),
  application,
  "application-review": applicationReview,
  applications,
  apply,
  "apply-result": applyResult,
  audit,
  "audit-detail": auditDetail,
  ban: (state, context) => restrictionAction("ban", state, context),
  confirm: (state, context) => confirmation(state, context),
  create,
  deactivate: (state, context) =>
    restrictionAction("deactivate", state, context),
  deletion,
  denied: renderDenied,
  error: renderError,
  handover,
  home,
  identity,
  inbox,
  leave: renderLeave,
  management,
  operation,
  password: (state) => password(state),
  person,
  phone,
  reactivate: (state, context) =>
    restrictionAction("reactivate", state, context),
  recovery,
  restrictions,
  security,
  sessions: renderSessions,
  signin,
  signout: renderSignout,
  status,
  "temp-password": (state) => password(state, true),
  unavailable: renderUnavailable,
  unban: (state, context) => restrictionAction("unban", state, context),
};
export const renderBody = (id, state, context = defaultRenderContext) => {
  if (recoverable.has(id) && recoveryVariants.has(state)) {
    return actionRecovery(id, state);
  }
  const renderer = screenBodyRenderers[id];
  if (!renderer) {
    throw new Error(`Unmapped screen ${id}`);
  }
  return renderer(state, context);
};
const accountDestinations = new Set([
  "phone",
  "security",
  "password",
  "sessions",
  "application",
  "app-edit",
  "app-withdraw",
  "app-resubmit",
  "status",
  "temp-password",
]);
const rootDestinations = new Set(["home", "inbox", "account"]);

const isStaffNavigation = (id, state, context) =>
  getScreen(id).group.startsWith("03") ||
  (["confirm", "leave", "operation"].includes(id) &&
    context.id !== "security") ||
  state === "staff" ||
  context.role === "staff";

const isRestrictedNavigation = (id, state, context) =>
  context.access === false ||
  (id === "status" && state !== "active") ||
  (id === "account" &&
    [
      "restricted",
      "deactivated",
      "banned",
      "combined",
      "missing",
      "pendingbanned",
    ].includes(state));

const navigationItems = (temp, restricted, staff) =>
  temp
    ? [["account", "帳戶", "UserRound"]]
    : [
        ...(restricted ? [] : [["home", "主頁", "House"]]),
        ["inbox", "收件匣", "Mail"],
        ...(staff ? [["management", "管理", "Settings2"]] : []),
        ["account", "帳戶", "UserRound"],
      ];

const renderNavigation = (items, active, temp, restricted, staff) =>
  items
    .map(([destination, label, iconName]) => {
      let destinationState = "";
      if (restricted && destination === "account") {
        destinationState = "restricted";
      } else if (staff && rootDestinations.has(destination)) {
        destinationState = "staff";
      }
      return link(
        icon(iconName) + label,
        temp ? "temp-password" : destination,
        destinationState,
        active === destination ? "active" : ""
      );
    })
    .join("");

const renderAuthScreen = (id, state, context) => {
  const body = renderBody(id, state, context);
  return (id === "signout" ? authShell(body) : body).replace(
    '<div class="auth"',
    `<div class="auth" data-auth-screen="${id}"`
  );
};

const renderApplicationShell = (id, state, context, layout) => {
  const staff = isStaffNavigation(id, state, context);
  const temp = id === "temp-password";
  const restricted = isRestrictedNavigation(id, state, context);
  let active = id;
  if (accountDestinations.has(id)) {
    active = "account";
  }
  if (staff && !rootDestinations.has(id)) {
    active = "management";
  }
  const items = navigationItems(temp, restricted, staff);
  const navLinks = renderNavigation(items, active, temp, restricted, staff);
  const accountRoute = temp ? "temp-password" : "account";
  const accountState = restricted ? "restricted" : "";
  const accountLink = link(
    icon("CircleUserRound"),
    accountRoute,
    accountState,
    "icon-button"
  ).replace("<a ", '<a aria-label="帳戶" ');

  return `<div class="shell ${rootScreens.has(id) ? "root-screen" : "focused"} ${id === "home" ? "home" : ""}" data-layout="${layout.family}"><aside class="sidebar"><div class="wordmark">顯恩堂</div><div class="subtitle">中國基督教播道會顯恩堂</div><nav aria-label="主要導覽">${navLinks}</nav><div class="signed-as"><strong>${staff ? "陳同工" : "黃大明"}</strong>${staff ? "職員 · 個人帳戶" : "wong.tai.ming"}</div></aside><header class="mobile-head"><div class="wordmark">顯恩堂</div>${accountLink}</header><main class="main"><div class="page-content" data-content="${layout.content}">${renderBody(id, state, context)}</div></main><nav class="bottom-nav" aria-label="主要導覽">${navLinks}</nav></div>`;
};

export const renderScreen = (id, state, context = defaultRenderContext) => {
  const layout = screenLayout(id);
  if (layout.family === "auth") {
    return renderAuthScreen(id, state, context);
  }
  return renderApplicationShell(id, state, context, layout);
};
