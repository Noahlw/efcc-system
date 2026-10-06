import { renderScreen, icon } from "./render.mjs";
import {
  getScreen,
  defaultState,
  weekDates,
  previewPhone,
  recoverable,
  rootScreens,
  identityValues,
} from "./screens.mjs";

const query = new URLSearchParams(location.search);
const root = document.querySelector("#app");
// Preview-only text enlargement; physical browser/system scaling still needs device qualification.
if (query.get("textScale") === "200") {
  document.documentElement.style.fontSize = "200%";
}
let current = getScreen(query.get("screen") || "home").id;
let state = query.get("state") || defaultState(current);
let dirty = false;
let week = 0;
let role = "member";
let applicationStatus =
  current === "application" ? state.replace("ineligible", "") : "pending";
let originalOperation = false;
let person = null;
let restriction = null;
const verifiedPhone = state === "verifiedphone";
const temporaryGate = current === "recovery" && state === "temporary";
let access = !(
  (current === "status" && state !== "active") ||
  (current === "account" &&
    [
      "restricted",
      "deactivated",
      "banned",
      "combined",
      "missing",
      "pendingbanned",
    ].includes(state)) ||
  (["application", "app-edit", "app-withdraw", "app-resubmit"].includes(
    current
  ) &&
    !["approved", "none", "ineligibleapproved"].includes(state))
);
let sensitive = { id: "identity", result: "success" };
let confirmationValid = current === "security" && state === "confirmed";
let pendingNavigation = null;
let confirmationUntil = confirmationValid ? Date.now() + 600_000 : 0;
let actionTimer = null;
let phone = null;
let submitting = false;
let handoverAvailable = true;
let navigationDepth = 0;
let confirmationReturn = null;
let navigationFrom = null;
let checkedStatus =
  current === "status" && state !== "rechecking" ? state : "pending";
const accountStateFor = (value) =>
  ({ active: "default", pending: "restricted" })[value] ?? value;
let ownAccountState = "restricted";
if (current === "account") {
  ownAccountState = state;
} else if (current === "status") {
  ownAccountState = accountStateFor(state);
} else if (access) {
  ownAccountState = "default";
}
const retryPage = getScreen(query.get("returnTo") || "home").id;
// Synthetic actors only; this preview never authenticates with the application.
const previewAccounts = new Map([
  [
    "wong.tai.ming",
    {
      email: "demo@example.com",
      fullName: "黃大明",
      membership: "active",
      password: "Demo-only!26",
      phone: "+85260000001",
      role: "member",
    },
  ],
  [
    "wong.tm.02",
    {
      email: "second@example.com",
      fullName: "黃大明",
      membership: "active",
      password: "Demo-only!26",
      phone: "+85260000002",
      role: "member",
    },
  ],
  [
    "ui.staff",
    {
      email: "staff@example.com",
      fullName: "陳同工",
      membership: "active",
      password: "Demo-only!26",
      phone: "+85260000009",
      role: "staff",
    },
  ],
]);
let actorUsername = "wong.tai.ming";
const correctedPeople = new Map();
// ponytail: synthetic in-memory drafts only; real persistence/reconciliation remains a production concern.
const drafts = new Map();
const rootViews = new Map();
let confirmationFocus = null;
let leaveFocus = null;
let pendingFocus = null;
let selectedDay = null;
const captureDraft = (form) => {
  if (!form) {
    return;
  }
  const values = {};
  for (const input of form.querySelectorAll(
    "input[name],textarea[name],select[name]"
  )) {
    if (
      /password/iu.test(input.name) ||
      (input.type === "radio" && !input.checked)
    ) {
      continue;
    }
    values[input.name] =
      input.type === "checkbox" ? input.checked : input.value;
  }
  drafts.set(current, values);
};
const filterAccounts = (term) => {
  let count = 0;
  for (const row of root.querySelectorAll("[data-searchable]")) {
    row.hidden = !row.dataset.searchable
      .toLowerCase()
      .includes(term.trim().toLowerCase());
    if (!row.hidden) {
      count += 1;
    }
  }
  const counter = root.querySelector(".result-count");
  if (counter) {
    counter.textContent = `${count} 個帳戶`;
  }
  const none = root.querySelector("[data-search-empty]");
  if (none) {
    none.hidden = count !== 0;
  }
};
const showWeek = () => {
  const dates = weekDates(week);
  const days = root.querySelectorAll(".day");
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const date = dates[index];
    day.dataset.day = date;
    day.querySelector("span").textContent = Number(date.slice(8));
    day.classList.toggle("today", week === 0 && index === 0);
    day.classList.remove("selected");
    day.setAttribute("aria-pressed", "false");
    if (["2026-10-11", "2026-10-18"].includes(date)) {
      day.dataset.event = "true";
    } else {
      delete day.dataset.event;
    }
  }
  const first = new Date(`${dates[0]}T00:00:00Z`);
  const last = new Date(`${dates.at(-1)}T00:00:00Z`);
  const firstYear = first.getUTCFullYear();
  const lastYear = last.getUTCFullYear();
  const firstMonth = first.getUTCMonth() + 1;
  const lastMonth = last.getUTCMonth() + 1;
  let monthLabel = `${firstYear} 年 ${firstMonth} 月`;
  if (firstYear === lastYear && firstMonth !== lastMonth) {
    monthLabel = `${firstYear} 年 ${firstMonth}–${lastMonth} 月`;
  } else if (firstYear !== lastYear) {
    monthLabel = `${firstYear} 年 ${firstMonth} 月 – ${lastYear} 年 ${lastMonth} 月`;
  }
  root.querySelector("[data-month]").textContent = monthLabel;
  root.querySelector('[data-week="-1"]').disabled = week === 0;
};

const filterDay = (raw) => {
  const date = raw.includes("-") ? raw : `2026-10-${raw.padStart(2, "0")}`;
  selectedDay = date;
  const day = Number(date.slice(8));
  const month = Number(date.slice(5, 7));
  for (const button of root.querySelectorAll(".day")) {
    const selected = button.dataset.day === date;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  root
    .querySelector('.date-controls [data-go="home"]')
    .setAttribute("aria-pressed", "false");
  root.querySelector("[data-agenda]").innerHTML = [
    "2026-10-11",
    "2026-10-18",
  ].includes(date)
    ? `<article class="event"><div class="event-date"><strong>${day}</strong>週日</div><div class="event-body"><h3>主日崇拜</h3><p>10:30 · 敬拜部</p><span class="badge">報名已批准</span></div></article>`
    : `<div class="empty">${icon("CalendarDays")}<h2>這一天沒有聚會</h2><p>試試其他日期，或查看全部即將參與的聚會。</p><button class="button secondary" data-go="home">查看全部</button></div>`;
  root
    .querySelector("[data-agenda]")
    .previousElementSibling.querySelector(
      "h2"
    ).textContent = `${month} 月 ${day} 日的聚會`;
};

const personScreens = new Set([
  "person",
  "identity",
  "recovery",
  "restrictions",
  "ban",
  "unban",
  "deactivate",
  "reactivate",
  "confirm",
  "handover",
  "operation",
  "deletion",
]);
const staffIdentityScreens = new Set([
  "home",
  "inbox",
  "account",
  "security",
  "password",
  "sessions",
  "phone",
]);
const memberIdentityScreens = new Set([
  "home",
  "inbox",
  "account",
  "security",
  "phone",
  "password",
  "sessions",
  "status",
  "application",
  "app-edit",
  "app-withdraw",
  "app-resubmit",
]);

const ensurePreviewPerson = () => {
  if (!personScreens.has(current) || person) {
    return;
  }
  const account = previewAccounts.get("wong.tai.ming");
  person = {
    email: account.email,
    name: account.fullName,
    originalUsername: "wong.tai.ming",
    phone: account.phone,
    sharedPhone: false,
    username: "wong.tai.ming",
  };
};

const replaceTextNodes = (replacements, excludedSelector = "") => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (excludedSelector && node.parentElement.closest(excludedSelector)) {
      continue;
    }
    for (const [search, value] of replacements) {
      node.textContent = node.textContent.replaceAll(search, value);
    }
  }
};

const updatePersonIdentity = () => {
  if (!person || !personScreens.has(current)) {
    return;
  }
  const deleting = current === "deletion";
  replaceTextNodes(
    [
      [deleting ? "李小恩" : "黃大明", person.name],
      [deleting ? "lee.siu.yan" : "wong.tai.ming", person.username],
    ],
    ".desktop-people,.sidebar,.bottom-nav"
  );
  for (const input of root.querySelectorAll("input[name=fullName]")) {
    input.value = person.name;
  }
  for (const input of root.querySelectorAll("input[name=username]")) {
    input.value = person.username;
  }
};

const updateStaffIdentity = () => {
  if (role !== "staff" || !staffIdentityScreens.has(current)) {
    return;
  }
  replaceTextNodes([
    ["黃大明", "陳同工"],
    ["wong.tai.ming", "ui.staff"],
    ["大明，早晨。", "同工，早晨。"],
  ]);
};

const updateMemberIdentity = () => {
  if (role === "staff" || !memberIdentityScreens.has(current)) {
    return;
  }
  const actor = previewAccounts.get(actorUsername);
  replaceTextNodes([
    ["黃大明", actor.fullName],
    ["wong.tai.ming", actorUsername],
    ["demo@example.com", actor.email],
  ]);
  if (current === "app-edit") {
    for (const name of ["fullName", "email", "phone"]) {
      for (const input of root.querySelectorAll(`[name="${name}"]`)) {
        input.value = actor[name];
      }
    }
  }
};

const draftScreenForCurrent = () => {
  if (current === "confirm") {
    return sensitive.id;
  }
  if (current === "apply-result") {
    return "apply";
  }
  if (current === "handover" && state === "created") {
    return "create";
  }
  return current;
};

const currentDraftValues = () => {
  const valueScreen = draftScreenForCurrent();
  if (valueScreen === "identity") {
    return identityValues(
      person || {
        name: "黃大明",
        username: "wong.tai.ming",
        ...previewAccounts.get("wong.tai.ming"),
      },
      drafts.get("identity")
    );
  }
  return drafts.get(valueScreen) || {};
};

const updatePersonSummary = () => {
  if (current !== "person" || !person) {
    return;
  }
  const avatar = root.querySelector(".main .avatar");
  if (avatar) {
    avatar.textContent = person.name.slice(0, 1);
  }
  let sharedPhone;
  if (person.sharedPhone !== undefined) {
    sharedPhone = person.sharedPhone ? "是" : "否";
  }
  const contacts = {
    共用電話: sharedPhone,
    電話: person.phone,
    電郵: person.email,
  };
  for (const row of root.querySelectorAll(".summary>div")) {
    const value = contacts[row.querySelector("dt")?.textContent];
    if (value !== undefined) {
      row.querySelector("dd").textContent = value || "未提供";
    }
  }
};

const updateSummaryValues = (values) => {
  const fieldMap = {
    Username: "username",
    中文全名: "fullName",
    修正電話: "phone",
    共用電話: "sharedPhone",
    新電話: "phone",
    新電郵: "email",
    本人核實: "identityCheck",
    核實方式: "identityCheck",
    申請人: "fullName",
    電話: "phone",
    電郵: "email",
  };
  for (const row of root.querySelectorAll(".summary>div")) {
    const key = fieldMap[row.querySelector("dt")?.textContent];
    if (!key || !Object.hasOwn(values, key)) {
      continue;
    }
    let value = values[key] || "未提供";
    if (key === "identityCheck") {
      value =
        values[key] === "verified_phone"
          ? "職員主動聯絡教會原有已核實電話"
          : "親身核實";
    } else if (key === "sharedPhone") {
      value = values[key] ? "是" : "否";
    }
    row.querySelector("dd").textContent = value;
  }
};

const updateCreatedHandover = (values) => {
  if (current !== "handover" || state !== "created") {
    return;
  }
  if (values.fullName) {
    root.querySelector(".target strong").textContent = values.fullName;
  }
  if (values.username) {
    root.querySelector(".target small").textContent = values.username;
    root.querySelector(".receipt > strong").textContent = values.username;
  }
};

const updatePeopleRows = () => {
  for (const row of root.querySelectorAll("[data-person]")) {
    const [, original] = row.dataset.person.split("|");
    row.dataset.originalUsername = original;
    const correction = correctedPeople.get(original);
    if (!correction) {
      continue;
    }
    row.querySelector(".row-copy strong").textContent = correction.name;
    row.querySelector(".row-copy small").textContent = correction.username;
    row.dataset.person = `${correction.name}|${correction.username}`;
    row.dataset.searchable = `${correction.name} ${correction.username}`;
  }
  if (!person) {
    return;
  }
  for (const row of root.querySelectorAll("[data-person]")) {
    const [, username] = row.dataset.person.split("|");
    row.classList.toggle("selected", username === person.username);
  }
};

const updateDraftInputs = (values) => {
  for (const [name, value] of Object.entries(
    current === "identity" ? values : drafts.get(current) || {}
  )) {
    if (/password/iu.test(name)) {
      continue;
    }
    for (const element of root.querySelectorAll(`[name="${name}"]`)) {
      if (element.type === "checkbox") {
        element.checked = value === true;
      } else if (element.type === "radio") {
        element.checked = element.value === value;
      } else {
        element.value = value;
      }
    }
  }
};

const updateConfirmationContent = () => {
  if (confirmationValid && Date.now() < confirmationUntil) {
    for (const element of root.querySelectorAll("[data-confirmation-note]")) {
      element.textContent =
        "目前密碼已確認，操作尚未提交。核對資料後，請再次明確提交。";
    }
    for (const element of root.querySelectorAll("[data-sensitive]")) {
      element.textContent = "確認提交";
    }
  }
  if (current === "confirm" && sensitive.id !== "identity") {
    for (const element of root.querySelectorAll(".summary dd")) {
      if (element.textContent === "修正身份資料") {
        element.textContent = getScreen(sensitive.id).title;
      }
    }
  }
};

const focusRenderedDialog = () => {
  const dialog = root.querySelector("[role=dialog]");
  if (dialog) {
    const backdrop = dialog.parentElement;
    for (const sibling of backdrop.parentElement.children) {
      if (sibling !== backdrop) {
        sibling.inert = true;
      }
    }
    for (const element of root.querySelectorAll(
      ".sidebar,.mobile-head,.bottom-nav"
    )) {
      element.inert = true;
    }
    (dialog.querySelector("input,button,a") || dialog).focus();
  } else if (pendingFocus) {
    root.querySelector(pendingFocus)?.focus();
    pendingFocus = null;
  }
};

const restoreRenderedView = () => {
  const view = rootViews.get(current);
  if (current === "home" && root.querySelector("[data-month]")) {
    week = view?.week ?? 0;
    selectedDay =
      view?.day ?? root.querySelector(".day.selected")?.dataset.day ?? null;
    showWeek();
    if (selectedDay) {
      filterDay(selectedDay);
    }
  }
  if (view) {
    const search = root.querySelector("[data-search]");
    if (search) {
      search.value = view.search || "";
      filterAccounts(search.value);
    }
    const main = root.querySelector(".main");
    if (main) {
      main.scrollTop = view.scrollTop;
    }
  }
};

const render = () => {
  ensurePreviewPerson();
  root.innerHTML = renderScreen(current, state, {
    ...sensitive,
    access,
    applicationStatus,
    ownAccountState,
    phone,
    restriction,
    role,
    temporaryGate,
    verifiedPhone,
  });
  if (originalOperation && current !== "confirm") {
    root
      .querySelector("main")
      ?.insertAdjacentHTML(
        "afterbegin",
        '<div class="notice amber"><strong>重試原操作 · OP-DEMO-001</strong>請填寫相同資料。這次重試會沿用原查核編號。</div>'
      );
  }
  updatePersonIdentity();
  updateStaffIdentity();
  updateMemberIdentity();
  const values = currentDraftValues();
  updatePersonSummary();
  updateSummaryValues(values);
  updateCreatedHandover(values);
  updatePeopleRows();
  document.title = `${getScreen(current).title} · 顯恩堂 Design preview`;
  root.dataset.screen = current;
  root.dataset.state = state;
  updateDraftInputs(values);
  updateConfirmationContent();
  focusRenderedDialog();
  restoreRenderedView();
  window.scrollTo(0, 0);
};

const showLeave = () => {
  leaveFocus = document.activeElement;
  root.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-backdrop" data-live-dialog><section class="modal" role="dialog" aria-modal="true" aria-labelledby="unsent-title"><h2 id="unsent-title">放棄未提交的更改？</h2><p>這些更改尚未送出。離開後，需要重新填寫。</p><div class="actions"><button class="button" data-keep>繼續編輯</button><button class="button secondary" data-discard>放棄更改並離開</button></div></section></div>`
  );
  root.querySelector("[data-keep]").focus();
  for (const sibling of root.children) {
    if (!Object.hasOwn(sibling.dataset, "liveDialog")) {
      sibling.inert = true;
    }
  }
};
const saveCurrentRootView = () => {
  if (!rootScreens.has(current)) {
    return;
  }
  rootViews.set(current, {
    day: selectedDay,
    scrollTop: root.querySelector(".main")?.scrollTop || 0,
    search: root.querySelector("[data-search]")?.value || "",
    week,
  });
};

const returnFromConfirmation = (id, nextState, replace) => {
  if (current !== "confirm" || id !== sensitive.id) {
    return false;
  }
  dirty = false;
  pendingFocus =
    confirmationFocus ||
    `[data-sensitive="${sensitive.id}"],[data-go="confirm"]`;
  if (navigationDepth <= 0 || navigationFrom !== id || replace) {
    return false;
  }
  confirmationReturn = { screen: id, state: nextState || defaultState(id) };
  history.back();
  return true;
};

const requestNavigationAfterDecision = (
  id,
  nextState,
  force,
  selectedPerson,
  replace
) => {
  if (!dirty || force) {
    return false;
  }
  pendingNavigation = [id, nextState, selectedPerson, replace];
  showLeave();
  return true;
};

const resolveNavigationState = (id, nextState) => {
  if (id === "handover" && !handoverAvailable) {
    return "receipt";
  }
  if (id === "account" && (!nextState || nextState === "restricted")) {
    return ownAccountState;
  }
  return nextState;
};

const selectNavigationPerson = (selectedPerson) => {
  if (!selectedPerson) {
    return;
  }
  if (person?.username !== selectedPerson.username) {
    for (const draftScreen of [
      "identity",
      "recovery",
      "ban",
      "unban",
      "deactivate",
      "reactivate",
      "deletion",
    ]) {
      drafts.delete(draftScreen);
    }
  }
  person = selectedPerson;
};

const rememberStatusBeforeRecheck = (id, nextState) => {
  if (
    id === "status" &&
    nextState === "rechecking" &&
    current === "status" &&
    state !== "rechecking"
  ) {
    checkedStatus = state;
  }
};

const updateNavigationAccess = () => {
  if (
    current === "application" &&
    ["pending", "rejected", "withdrawn", "approved"].includes(state)
  ) {
    applicationStatus = state;
  }
  if (current === "status") {
    access = state === "active";
    if (state !== "rechecking") {
      ownAccountState = accountStateFor(state);
    }
  }
  if (current === "account") {
    ownAccountState = state;
  }
  if (current === "signin") {
    rootViews.clear();
    role = "member";
    access = true;
    confirmationValid = false;
    confirmationUntil = 0;
  }
  if (getScreen(current).group.startsWith("03") || state === "staff") {
    role = "staff";
  }
  if (current === "restrictions") {
    restriction = {
      banned: ["banned", "combined"].includes(state),
      deactivated: ["deactivated", "combined"].includes(state),
    };
  }
};

const updateNavigationHistory = (from, replace) => {
  if (!replace) {
    navigationDepth += 1;
  }
  navigationFrom = replace ? (history.state?.from ?? null) : from;
  history[replace ? "replaceState" : "pushState"](
    {
      depth: navigationDepth,
      from: navigationFrom,
      person,
      screen: current,
      state,
    },
    "",
    `?screen=${current}&state=${state}`
  );
};

const scheduleScreenTransition = (goTo) => {
  if (current === "signout" && state === "default") {
    actionTimer = setTimeout(() => goTo("signin", "", true), 350);
  }
  if (current === "status" && state === "rechecking") {
    actionTimer = setTimeout(() => goTo("status", checkedStatus, true), 350);
  }
  if (current === "operation" && state === "checking") {
    actionTimer = setTimeout(() => goTo("operation", "retry", true), 350);
  }
  if (current === "confirm" && state === "checking") {
    actionTimer = setTimeout(() => goTo("confirm", "expired", true), 350);
  }
  if (recoverable.has(current) && state === "checking") {
    const screen = current;
    actionTimer = setTimeout(() => goTo(screen, "retrying", true), 350);
  }
  if (current === "apply-result" && state === "checking") {
    actionTimer = setTimeout(() => goTo("apply-result", "retry", true), 350);
  }
};

const navigate = (
  id,
  nextState = "",
  force = false,
  selectedPerson = null,
  replace = false
) => {
  const from = current;
  if (returnFromConfirmation(id, nextState, replace)) {
    return;
  }
  if (
    requestNavigationAfterDecision(
      id,
      nextState,
      force,
      selectedPerson,
      replace
    )
  ) {
    return;
  }
  saveCurrentRootView();
  clearTimeout(actionTimer);
  if (current === "handover" && id !== "handover") {
    handoverAvailable = false;
  }
  const resolvedState = resolveNavigationState(id, nextState);
  selectNavigationPerson(selectedPerson);
  rememberStatusBeforeRecheck(id, resolvedState);
  current = getScreen(id).id;
  state = resolvedState || defaultState(current);
  dirty = false;
  updateNavigationAccess();
  updateNavigationHistory(from, replace);
  render();
  scheduleScreenTransition(navigate);
  if (parent !== window) {
    parent.postMessage(
      { screen: current, state, type: "screenbook" },
      location.origin
    );
  }
};

const closeLeave = () => {
  root.querySelector("[data-live-dialog]")?.remove();
  for (const element of root.querySelectorAll("[inert]")) {
    element.inert = false;
  }
  (leaveFocus?.isConnected
    ? leaveFocus
    : root.querySelector("input,textarea,select")
  )?.focus();
  leaveFocus = null;
};
const finishSensitive = () => {
  const { id, result } = sensitive;
  if (id === "create" || id === "recovery") {
    handoverAvailable = true;
  }
  if (id === "create") {
    const values = drafts.get("create") || {};
    person = {
      email: values.email,
      name: values.fullName || "李小恩",
      phone: previewPhone(values.phone),
      sharedPhone: values.sharedPhone || false,
      username: values.username || "lee.siu.yan",
    };
  }
  if (id === "identity") {
    const before = person || { name: "黃大明", username: "wong.tai.ming" };
    const values = identityValues(before, drafts.get("identity"));
    person = {
      ...before,
      email: values.email,
      name: values.fullName || before.name,
      phone: previewPhone(values.phone),
      sharedPhone: values.sharedPhone || false,
      username: values.username || before.username,
    };
    correctedPeople.set(before.originalUsername || before.username, person);
    drafts.delete("identity");
  }
  if (id === "create") {
    navigate("handover", "created", true);
  } else if (id === "recovery") {
    navigate("handover", result, true);
  } else {
    navigate(id, result, true);
  }
};
const fieldError = (input, message) => {
  const label = input.closest(".field");
  if (!label) {
    return;
  }
  let error = label.querySelector(".error");
  if (!error) {
    error = document.createElement("span");
    error.className = "error";
    error.id = `error-${input.name}`;
    error.setAttribute("role", "alert");
    label.append(error);
  }
  error.textContent = message;
  input.setAttribute("aria-invalid", "true");
  const refs = new Set(
    `${input.getAttribute("aria-describedby") || ""} ${error.id}`
      .split(" ")
      .filter(Boolean)
  );
  input.setAttribute("aria-describedby", [...refs].join(" "));
};
root.addEventListener(
  "invalid",
  (event) => {
    const input = event.target;
    let message = "請檢查輸入格式及長度。";
    if (input.validity.customError) {
      message = input.validationMessage;
    } else if (input.validity.valueMissing) {
      message = "請填寫此欄位。";
    }
    fieldError(input, message);
  },
  true
);
root.addEventListener("input", (event) => {
  const input = event.target;
  if (input.matches("[data-search]")) {
    filterAccounts(input.value);
    return;
  }
  if (input.matches("input,textarea,select")) {
    if (current === "handover") {
      return;
    }
    input.setCustomValidity?.("");
    input.removeAttribute("aria-invalid");
    const error = input.closest(".field")?.querySelector(".error");
    if (error) {
      const refs = (input.getAttribute("aria-describedby") || "")
        .split(" ")
        .filter((id) => id && id !== error.id);
      if (refs.length) {
        input.setAttribute("aria-describedby", refs.join(" "));
      } else {
        input.removeAttribute("aria-describedby");
      }
      error.remove();
    }
    dirty = true;
    captureDraft(input.form);
  }
});
root.addEventListener("change", (event) => {
  if (
    event.target.name === "identityCheck" ||
    event.target.name === "recoveryAction"
  ) {
    captureDraft(event.target.form);
  }
});
const submitSignIn = (form, data) => {
  const matches = [...previewAccounts].filter(([username, account]) =>
    data.has("fullName")
      ? account.fullName === data.get("fullName").trim()
      : username === data.get("username").trim().toLowerCase()
  );
  const [match] = matches;
  const [username, account] = match || [];
  const {
    membership,
    password,
    phone: accountPhone,
    role: accountRole,
  } = account || {};
  if (matches.length !== 1 || password !== data.get("currentPassword")) {
    dirty = false;
    let signInState = "invalid";
    if (matches.length > 1) {
      signInState = "ambiguous";
    } else if (data.has("fullName")) {
      signInState = "nameinvalid";
    }
    navigate("signin", signInState, true);
    return false;
  }
  actorUsername = username;
  role = accountRole;
  access = membership === "active";
  ownAccountState = "restricted";
  if (access) {
    ownAccountState = role === "staff" ? "staff" : "default";
  }
  form.dataset.submit = access ? "home" : "status";
  form.dataset.state =
    ownAccountState === "restricted" ? "pending" : ownAccountState;
  phone = accountPhone;
  return true;
};

const validateCurrentPassword = (form, data, actor) => {
  if (
    !data.has("currentPassword") ||
    data.get("currentPassword") === actor.password ||
    (current === "temp-password" &&
      data.get("currentPassword") === "Demo-only!26")
  ) {
    return true;
  }
  const field = form.querySelector('[name="currentPassword"]');
  field.setCustomValidity("目前密碼未能確認，請再輸入。");
  field.reportValidity();
  return false;
};

const validatePhoneInput = (form) => {
  const telephone = form.querySelector('input[type="tel"]');
  if (!telephone || previewPhone(telephone.value)) {
    return true;
  }
  telephone.setCustomValidity("請輸入有效的香港或國際電話號碼。");
  telephone.reportValidity();
  return false;
};

const validatePasswordMatch = (form, data) => {
  if (
    !data.has("newPassword") ||
    data.get("newPassword") === data.get("confirmPassword")
  ) {
    return true;
  }
  form
    .querySelector("[name=confirmPassword]")
    .setCustomValidity("兩次輸入的新密碼不相符。");
  form.reportValidity();
  return false;
};

const submitPasswordConfirmation = () => {
  if (current !== "confirm") {
    return false;
  }
  confirmationValid = true;
  confirmationUntil = Date.now() + 600_000;
  dirty = false;
  navigate(
    sensitive.id,
    sensitive.id === "security"
      ? "confirmed"
      : sensitive.reviewState || "review",
    true
  );
  return true;
};

const registerApplication = (data, telephone) => {
  const username = data.get("username").toLowerCase();
  if (previewAccounts.has(username)) {
    dirty = false;
    navigate("apply-result", "conflict", true);
    return false;
  }
  previewAccounts.set(username, {
    email: data.get("email"),
    fullName: data.get("fullName"),
    membership: "pending",
    password: data.get("password"),
    phone: previewPhone(telephone.value),
    role: "member",
  });
  return true;
};

const updatePreviewFormValues = (form, data, actor, telephone) => {
  let nextState = form.dataset.state;
  if (current === "recovery") {
    nextState = data.get("recoveryAction") || nextState;
  }
  if (current === "phone") {
    phone = previewPhone(telephone.value);
    actor.phone = phone;
  }
  if (current === "app-edit") {
    for (const name of ["fullName", "email", "phone"]) {
      actor[name] =
        name === "phone" ? previewPhone(data.get(name)) : data.get(name);
    }
  }
  if (current === "password" || current === "temp-password") {
    actor.password = data.get("newPassword");
    confirmationValid = false;
    confirmationUntil = 0;
  }
  return nextState;
};

const startFormSubmission = (form, nextState) => {
  const destination = form.dataset.submit;
  dirty = false;
  submitting = true;
  form.setAttribute("aria-busy", "true");
  const submit = form.querySelector('[type="submit"]');
  for (const element of form.querySelectorAll("input,textarea,select,button")) {
    element.disabled = true;
  }
  submit.textContent = "正在處理…";
  setTimeout(() => {
    submitting = false;
    navigate(destination, nextState, true);
  }, 300);
};

root.addEventListener("submit", (event) => {
  event.preventDefault();
  if (submitting) {
    return;
  }
  const form = event.target;
  captureDraft(form);
  const data = new FormData(form);
  const actor = previewAccounts.get(
    role === "staff" ? "ui.staff" : actorUsername
  );
  if (current === "signin" && !submitSignIn(form, data)) {
    return;
  }
  if (current !== "signin" && !validateCurrentPassword(form, data, actor)) {
    return;
  }
  if (!validatePhoneInput(form) || !validatePasswordMatch(form, data)) {
    return;
  }
  if (submitPasswordConfirmation()) {
    return;
  }
  const telephone = form.querySelector('input[type="tel"]');
  if (current === "apply" && !registerApplication(data, telephone)) {
    return;
  }
  startFormSubmission(
    form,
    updatePreviewFormValues(form, data, actor, telephone)
  );
});

const handleEyeControl = (control) => {
  const input = control.parentElement.querySelector("input");
  input.type = input.type === "password" ? "text" : "password";
  control.setAttribute(
    "aria-label",
    control
      .getAttribute("aria-label")
      .replace(
        /^(?<visibility>顯示|隱藏)/u,
        input.type === "password" ? "顯示" : "隱藏"
      )
  );
};

const handleSensitiveControl = (control, event) => {
  event.preventDefault();
  const required = root.querySelector("input[name=deleteAcknowledged]");
  if (required && !required.checked) {
    required.reportValidity();
    return;
  }
  sensitive = {
    id: control.dataset.sensitive,
    result: control.dataset.result,
    reviewState: state,
  };
  confirmationFocus = `[data-sensitive="${sensitive.id}"]`;
  dirty = false;
  if (!confirmationValid || Date.now() >= confirmationUntil) {
    navigate("confirm", "default", true);
  } else {
    finishSensitive();
  }
};

const handleDirectControl = (control, event) => {
  if (Object.hasOwn(control.dataset, "eye")) {
    handleEyeControl(control);
    return true;
  }
  if (Object.hasOwn(control.dataset, "keep")) {
    closeLeave();
    return true;
  }
  if (Object.hasOwn(control.dataset, "discard")) {
    drafts.delete(current);
    dirty = false;
    const [id, nextState, selectedPerson, replace] = pendingNavigation;
    pendingNavigation = null;
    navigate(id, nextState, true, selectedPerson, replace);
    return true;
  }
  if (Object.hasOwn(control.dataset, "sensitive")) {
    handleSensitiveControl(control, event);
    return true;
  }
  if (Object.hasOwn(control.dataset, "finalSubmit")) {
    if (!confirmationValid || Date.now() >= confirmationUntil) {
      navigate("confirm", "expired", true);
    } else {
      finishSensitive();
    }
    return true;
  }
  if (
    control.classList.contains("back") &&
    navigationDepth > 0 &&
    navigationFrom === control.dataset.go
  ) {
    event.preventDefault();
    history.back();
    return true;
  }
  if (Object.hasOwn(control.dataset, "scroll")) {
    event.preventDefault();
    document
      .querySelector(`#${control.dataset.scroll}`)
      .scrollIntoView({ behavior: "smooth" });
    return true;
  }
  if (Object.hasOwn(control.dataset, "week")) {
    week = Math.max(0, week + Number(control.dataset.week));
    showWeek();
    return true;
  }
  if (Object.hasOwn(control.dataset, "day")) {
    filterDay(control.dataset.day);
    return true;
  }
  return false;
};

const resetHomeForNavigation = (destination) => {
  if (current !== "home" || destination !== "home") {
    return;
  }
  selectedDay = null;
  week = 0;
  rootViews.delete("home");
  root.querySelector(".day.selected")?.classList.remove("selected");
  root.querySelector(".main").scrollTop = 0;
};

const selectedPersonFromControl = (control) => {
  if (!control.dataset.person) {
    return null;
  }
  const [name, username] = control.dataset.person.split("|");
  const originalUsername = control.dataset.originalUsername || username;
  const fixture = previewAccounts.get(originalUsername);
  const correction = correctedPeople.get(originalUsername) || {};
  return {
    email: Object.hasOwn(correction, "email")
      ? correction.email
      : (fixture?.email ?? ""),
    name,
    originalUsername,
    phone: Object.hasOwn(correction, "phone")
      ? correction.phone
      : (fixture?.phone ?? "+85260000003"),
    sharedPhone: Object.hasOwn(correction, "sharedPhone")
      ? correction.sharedPhone
      : false,
    username,
  };
};

const prepareApplicationReset = (control) => {
  if (!Object.hasOwn(control.dataset, "resetApplication")) {
    return;
  }
  drafts.delete("apply");
  drafts.delete("apply-result");
  originalOperation = false;
  dirty = false;
};

const validateHandoverNavigation = (control) => {
  if (current !== "handover" || control.dataset.go !== "person") {
    return true;
  }
  const acknowledged = root.querySelector("[name=handover]");
  if (!acknowledged || acknowledged.checked) {
    return true;
  }
  acknowledged.reportValidity();
  return false;
};

const handleNavigationControl = (control, event) => {
  if (!control.dataset.go) {
    return;
  }
  event.preventDefault();
  resetHomeForNavigation(control.dataset.go);
  prepareApplicationReset(control);
  const selectedPerson = selectedPersonFromControl(control);
  if (Object.hasOwn(control.dataset, "retry")) {
    originalOperation = true;
  }
  if (control.dataset.go === "confirm" && current === "security") {
    sensitive = { id: "security", result: "confirmed" };
    confirmationFocus = '[data-go="confirm"]';
  }
  if (!validateHandoverNavigation(control)) {
    return;
  }
  navigate(
    Object.hasOwn(control.dataset, "retryPage")
      ? retryPage
      : control.dataset.go,
    control.dataset.state || "",
    false,
    selectedPerson
  );
};

root.addEventListener("click", (event) => {
  const control = event.target.closest("a,button");
  if (!control) {
    return;
  }
  if (submitting) {
    event.preventDefault();
    return;
  }
  if (handleDirectControl(control, event)) {
    return;
  }
  handleNavigationControl(control, event);
});

document.addEventListener("keydown", (event) => {
  const dialog = root.querySelector("[role=dialog]");
  if (!dialog) {
    return;
  }
  const focusable = [
    ...dialog.querySelectorAll(
      "input:not(:disabled),button:not(:disabled),a[href],textarea,select"
    ),
  ];
  if (event.key === "Tab" && focusable.length) {
    const [first] = focusable;
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === "Escape") {
    if (root.querySelector("[data-live-dialog]")) {
      closeLeave();
    } else if (current === "confirm") {
      navigate(
        sensitive.id,
        sensitive.reviewState ||
          (sensitive.id === "security" ? "default" : "review"),
        true
      );
    } else if (current === "leave") {
      navigate("identity", "default", true);
    }
  }
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("popstate", (event) => {
  if (!event.state?.screen) {
    return;
  }
  const destination = event.state;
  if (dirty) {
    history.pushState(
      {
        depth: navigationDepth,
        from: navigationFrom,
        person,
        screen: current,
        state,
      },
      "",
      `?screen=${current}&state=${state}`
    );
    pendingNavigation = [
      destination.screen,
      destination.state,
      destination.person,
      false,
    ];
    showLeave();
    return;
  }
  navigationDepth = destination.depth || 0;
  const returnState =
    confirmationReturn?.screen === destination.screen
      ? confirmationReturn.state
      : destination.state;
  confirmationReturn = null;
  navigate(destination.screen, returnState, true, destination.person, true);
});
if (
  getScreen(current).group.startsWith("03") ||
  ["confirm", "leave", "operation"].includes(current) ||
  state === "staff"
) {
  role = "staff";
}
if (current === "restrictions") {
  restriction = {
    banned: ["banned", "combined"].includes(state),
    deactivated: ["deactivated", "combined"].includes(state),
  };
}
if (current === "handover" && state === "created") {
  person = {
    email: "",
    name: "李小恩",
    phone: "+85260000003",
    sharedPhone: false,
    username: "lee.siu.yan",
  };
}
history.replaceState(
  { depth: 0, from: null, person, screen: current, state },
  "",
  location.href
);
render();
