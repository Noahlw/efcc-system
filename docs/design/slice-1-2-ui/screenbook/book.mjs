import { screens, getScreen, defaultState, escape as e } from "./screens.mjs";

const catalog = document.querySelector("#catalog");
for (const group of new Set(screens.map((screen) => screen.group))) {
  let entries = "";
  for (const [index, screen] of screens.entries()) {
    if (screen.group === group) {
      entries += `<a href="#${screen.id}" data-screen="${screen.id}"><small>${String(index + 1).padStart(2, "0")}</small>${e(screen.title)}</a>`;
    }
  }
  catalog.insertAdjacentHTML(
    "beforeend",
    `<section><h2 class="group-title">${e(group)}</h2>${entries}</section>`
  );
}
const stateSelect = document.querySelector("#state");
const frame = document.querySelector("#preview");
const textScale = document.querySelector("#text-scale");
let fromPreview = false;
let screen = "home";
let state = "default";
const render = () => {
  const [id, variant] = location.hash.slice(1).split("/");
  screen = getScreen(id || "home").id;
  const item = getScreen(screen);
  state = item.variants.some((v) => v[0] === variant)
    ? variant
    : defaultState(screen);
  stateSelect.innerHTML = item.variants
    .map(
      ([v, title]) =>
        `<option value="${v}" ${v === state ? "selected" : ""}>${e(title)}</option>`
    )
    .join("");
  document.querySelector("#screen-title").textContent = item.title;
  document.querySelector("#source-route").textContent = item.route;
  document.querySelector("#design-note").textContent = item.note;
  for (const anchor of catalog.querySelectorAll("a")) {
    anchor.setAttribute(
      "aria-current",
      anchor.dataset.screen === screen ? "page" : "false"
    );
  }
  const nextSrc = `app.html?screen=${screen}&state=${state}${textScale.value === "200" ? "&textScale=200" : ""}`;
  if (!fromPreview) {
    frame.src = nextSrc;
  }
  fromPreview = false;
  document.querySelector("#open-view").href = nextSrc;
  document.title = `${item.title} · EFCC Design Book`;
};
window.addEventListener("hashchange", render);
stateSelect.addEventListener(
  "change",
  () => (location.hash = `${screen}/${stateSelect.value}`)
);
for (const button of document.querySelectorAll("[data-size]")) {
  button.addEventListener("click", () => {
    document.body.classList.toggle("wide", button.dataset.size === "wide");
    frame.style.width = `${button.dataset.size === "wide" ? 1280 : button.dataset.size}px`;
    const heightBySize = { 768: 1024, wide: 900 };
    frame.style.height = `${heightBySize[button.dataset.size] ?? 844}px`;
    for (const sizeButton of document.querySelectorAll("[data-size]")) {
      sizeButton.setAttribute("aria-pressed", String(sizeButton === button));
    }
  });
}
const moveBy = (step) => {
  location.hash =
    screens[
      (screens.findIndex((item) => item.id === screen) +
        step +
        screens.length) %
        screens.length
    ].id;
};
document.querySelector("#previous").addEventListener("click", () => moveBy(-1));
document.querySelector("#next").addEventListener("click", () => moveBy(1));
window.addEventListener("message", (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== frame.contentWindow ||
    event.data?.type !== "screenbook"
  ) {
    return;
  }
  const next = getScreen(event.data.screen);
  fromPreview = true;
  const nextHash = `${next.id}/${next.variants.some((v) => v[0] === event.data.state) ? event.data.state : defaultState(next.id)}`;
  if (location.hash === `#${nextHash}`) {
    render();
  } else {
    location.hash = nextHash;
  }
});
render();

textScale.addEventListener("change", () => {
  fromPreview = false;
  render();
});
