import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { renderScreen } from "./render.mjs";
import {
  screens,
  weekDates,
  restrictionAfter,
  previewPhone,
  identityValues,
  screenLayout,
} from "./screens.mjs";

const ids = new Set(screens.map((s) => s.id));
assert.equal(ids.size, screens.length);
let states = 0;
for (const screen of screens) {
  for (const [state] of screen.variants) {
    const html = renderScreen(screen.id, state);
    const layout = screenLayout(screen.id);
    assert.equal(
      [...html.matchAll(/<h1[\s>]/gu)].length,
      1,
      `Repeated main title: ${screen.id}/${state}`
    );
    assert.ok(html.includes(`data-layout="${layout.family}"`));
    assert.ok(html.includes(`data-content="${layout.content}"`));
    if (layout.family === "auth") {
      assert.ok(!html.includes('class="sidebar"'));
    }
    assert.ok(
      html.includes("<h1>") || html.includes("<h2"),
      `Missing screen heading ${screen.id}/${state}`
    );
    assert.ok(
      !/undefined|\[object Object\]/u.test(html),
      `Unrendered content ${screen.id}/${state}`
    );
    for (const match of html.matchAll(/data-go="(?<destination>[^"]+)"/gu)) {
      assert.ok(
        ids.has(match.groups.destination),
        `Broken destination ${match.groups.destination}`
      );
    }
    for (const match of html.matchAll(/src="(?<asset>assets\/[^"]+)"/gu)) {
      assert.ok(
        existsSync(new URL(match[1], import.meta.url)),
        `Missing icon ${match[1]}`
      );
    }
    const renderedIds = new Set(
      [...html.matchAll(/\bid="(?<id>[^"]+)"/gu)].map(
        (match) => match.groups.id
      )
    );
    for (const ref of html.matchAll(/aria-describedby="(?<ids>[^"]+)"/gu)) {
      for (const id of ref.groups.ids.split(/\s+/u)) {
        assert.ok(
          renderedIds.has(id),
          `Missing description ${screen.id}/${state}/${id}`
        );
      }
    }
    states += 1;
  }
}
const pending = renderScreen("status", "pending");
assert.ok(!pending.includes('data-go="home"'), "Restricted state exposes Home");
const temporary = renderScreen("temp-password", "default");
assert.ok(
  !temporary.includes('data-go="inbox"'),
  "Temporary-password nav exposes Inbox"
);
const unknown = renderScreen("operation", "unknown");
assert.ok(unknown.includes("查核之前的操作"));
assert.ok(!unknown.includes("data-sensitive="));
const review = renderScreen("application-review", "reject");
assert.ok(review.includes("拒絕原因（申請人可見）"));
assert.ok(
  !review.includes("data-sensitive="),
  "Routine decision incorrectly requires password confirmation"
);
console.log(
  `${screens.length} screen designs / ${states} states rendered; destinations, assets and critical design boundaries passed.`
);

assert.deepEqual(weekDates(4), [
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-08",
]);
for (const before of [
  { banned: false, deactivated: false },
  { banned: true, deactivated: false },
  { banned: false, deactivated: true },
  { banned: true, deactivated: true },
]) {
  for (const action of ["ban", "unban", "deactivate", "reactivate"]) {
    const after = restrictionAfter(before, action);
    let expectedBanned = before.banned;
    if (action === "ban") {
      expectedBanned = true;
    } else if (action === "unban") {
      expectedBanned = false;
    }
    assert.equal(after.banned, expectedBanned);
    let expectedDeactivated = before.deactivated;
    if (action === "deactivate") {
      expectedDeactivated = true;
    } else if (action === "reactivate") {
      expectedDeactivated = false;
    }
    assert.equal(after.deactivated, expectedDeactivated);
  }
}
for (const id of [
  "phone",
  "password",
  "sessions",
  "app-edit",
  "app-withdraw",
  "app-resubmit",
]) {
  const html = renderScreen(id, "unknown");
  assert.ok(html.includes("查核之前的操作"));
  assert.ok(!html.includes("職員協助重設密碼"));
}
assert.ok(!renderScreen("apply", "conflict").includes("<form"));
assert.ok(
  !renderScreen("apply-result", "storageunknown").includes('data-go="apply"')
);
console.log(
  "Date rollover, independent restrictions, member reconciliation and application uncertainty checks passed."
);

for (const [value, expected] of [
  ["6000 1234", "+85260001234"],
  ["+852 6000 1234", "+85260001234"],
  ["+1 (415) 555-2671", "+14155552671"],
  ["abc", null],
  ["12345678", null],
  ["+852 1000 0001", null],
  ["+852 6000", null],
]) {
  assert.equal(previewPhone(value), expected);
}
assert.ok(
  renderScreen("phone", "success", { phone: "+85260001234" }).includes(
    "+85260001234"
  )
);
assert.ok(!renderScreen("account", "pendingbanned").includes('data-go="home"'));
console.log(
  "Phone input/result, description references and pending+ban design boundaries passed."
);
const secondPerson = {
  email: "second@example.com",
  name: "黃大明",
  phone: "+85260000002",
  sharedPhone: true,
  username: "wong.tm.02",
};
assert.deepEqual(
  identityValues(secondPerson, {
    email: "",
    fullName: "陳覆核示例",
    sharedPhone: false,
  }),
  {
    email: "",
    fullName: "陳覆核示例",
    identityCheck: "face_to_face",
    phone: "+85260000002",
    sharedPhone: false,
    username: "wong.tm.02",
  }
);
assert.equal(
  identityValues({ name: "李小恩", username: "lee.siu.yan" }).email,
  ""
);
console.log(
  "Selected-person identity values preserve unchanged, empty and false edits."
);
