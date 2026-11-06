import { ready, store, piano, openLegacy, leaveLegacy } from "./legacy.mjs";
import { childWords } from "./child-text.mjs";
import { keyboard } from "./games.mjs";
import { stagesFor, drawGacha, dailyRemaining, rewardStage, ratesFor, RARITIES, PITY } from "./gacha.mjs";
import { Practice, noteName } from "./practice.mjs";
import { Adventure } from "./adventure.mjs";
import { adventureState } from "./journey.mjs";
import { day } from "./state.mjs";

const root = document.querySelector("#app");
const esc = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const button = (text, action, className = "", extra = "") =>
  `<button class="${className}" data-action="${action}" ${extra}>${text}</button>`;
const words = value => esc(childWords(value));
const places = { C: "ド", G: "ソ", F: "ファ", D: "レ", A: "ラ" };
const tempos = { turtle: [60, "かめ"], rabbit: [90, "うさぎ"], cheetah: [120, "チーター"] };
let catalog;
let adventure;
let songIndex;
let screen = "home";
let chapter = 0;
let drill;
let options;
let layout;
let practice;
let sequence = 0;
let running = false;
let awarded = false;
let gachaDay;
let resumeAfterHidden = false;
let keyboardBase = 60;
// A question stays intact until the child leaves it or reaches its result.
window.shodanUpdateSafe = () => !running && !practice?.active &&
  adventure?.route !== "lesson" && !adventure?.battle?.active;
const cache = new Map();
const state = () => store.state.shodan;

function notify(text) {
  const el = document.querySelector("#toast");
  el.textContent = childWords(text);
  el.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.remove("show"), 3000);
}

async function json(path) {
  const r = await fetch(new URL("../data/" + path, import.meta.url));
  if (!r.ok) throw Error("れんしゅうがとどきません。電ぱをたしかめて、もう1回ひらいてね。");
  return r.json();
}

function shell(title, body, back = "home", home = false) {
  document.body.dataset.screen = screen;
  root.innerHTML = `<header class="sh-header">
    ${home ? '<span class="sh-brand">ピアノ初段</span>' : button("‹ もどる", back, "quiet")}
    ${home ? button("先生の部屋", "settings", "quiet") : '<span class="sh-brand small-brand">ピアノ初段</span>'}
  </header><main class="sh-main"><h1 tabindex="-1">${words(title)}</h1>${body}</main>`;
}

function stop() {
  sequence++;
  practice?.stop();
  practice = null;
  running = false;
  adventure?.leave();
  leaveLegacy();
}

function navigate(route) {
  if (location.hash.slice(1) === route) renderRoute();
  else location.hash = route;
}

async function renderRoute() {
  stop();
  window.scrollTo(0, 0);
  const [route, id] = location.hash.slice(1).split("/");
  screen = route || "home";
  try {
    if (["home", "lesson", "boss", "create", "collection", "found", "rest"].includes(screen)) {
      await adventure.show(screen, id);
    } else if (screen === "chapter") {
      chapter = Math.max(0, Math.min(8, Number(id) || 0));
      renderChapter();
    } else if (screen === "drill") {
      drill = catalog.drills.find(d => d.id === id) || catalog.drills[0];
      chapter = drill.ch;
      const saved = state().options[drill.id] || {};
      const stages = stagesFor(drill);
      options = {
        pos: drill.pos.includes(saved.pos) ? saved.pos : drill.pos[0],
        stage: stages.some(s => s.id === saved.stage) ? saved.stage : stages[0].id,
        tempo: saved.tempo in tempos ? saved.tempo : "turtle",
        input: ["mic", "keys", "teacher"].includes(saved.input) ? saved.input : "mic",
        companion: !!saved.companion
      };
      state().lastDrill = drill.id;
      saveOptions();
      await renderDrill();
    } else if (screen === "gacha") {
      renderGacha();
    } else if (screen === "settings") {
      await openLegacy("settings");
      teacherExtras();
    } else if (screen === "song") {
      await openLegacy("map", { no: Number(id) || 1 });
    } else if (screen === "play") {
      await openLegacy("play");
    } else {
      screen = "home";
      renderHome();
    }
    root.querySelector("h1")?.focus({ preventScroll: true });
  } catch (error) {
    shell("まだとどいていません", `<p role="alert">${esc(error.message)}</p>${button("もう1回ひらく", "retry", "primary")}`);
  }
}

function renderHome() {
  adventure.show("home");
}

function renderChapter() {
  if (chapter === 8) {
    adventure.songMap();
    return;
  }
  const drills = catalog.drills.filter(d => d.ch === chapter);
  shell(`第${chapter + 1}章　${catalog.chapters[chapter][0]}`,
    `<p class="sh-intro">${words(catalog.chapters[chapter][1])}</p><div class="sh-list">${drills.map(d => {
      const done = stagesFor(d).filter(s => state().done[d.id + ":" + s.id]).length;
      return button(`<span><strong>${words(d.title)}</strong><small>${words(d.sub)}</small></span>
        <span class="sh-progress" aria-label="できた ${done} / ${stagesFor(d).length}">${done ? "✓ " + done + "/" + stagesFor(d).length : "›"}</span>`,
      "drill/" + d.id, "sh-row", `data-drill="${d.id}"`);
    }).join("")}</div>`);
}

function saveOptions() {
  state().options[drill.id] = { ...options };
  store.save();
}

const chosenStage = () => stagesFor(drill).find(s => s.id === options.stage);

function choice(field, values) {
  return `<div class="sh-choices" role="group" aria-label="${field === "pos" ? "ひくところ" : "はやさ"}">${values.map(([v, title]) =>
    button(esc(title), "option", options[field] === v ? "selected" : "",
      `data-field="${field}" data-value="${v}" aria-pressed="${options[field] === v}"`)).join("")}</div>`;
}

async function loadLayout() {
  const position = drill.positions[options.pos];
  const stage = chosenStage();
  const hand = position.layouts[stage.hand] ? stage.hand : Object.keys(position.layouts)[0];
  const key = position.layouts[hand];
  if (!cache.has(key)) {
    const data = await json("drills/" + key);
    const response = await fetch(new URL("../data/drills/" + data.svg, import.meta.url));
    if (!response.ok) throw Error("楽ふがとどきません。もう1回ひらいてね。");
    cache.set(key, { ...data, source: await response.text() });
  }
  return cache.get(key);
}

async function renderDrill() {
  const token = ++sequence;
  const stage = chosenStage();
  screen = "drill";
  shell(drill.title, `<p class="drill-sub">${words(drill.sub)}</p>
    <section class="sh-drill">
      <div class="sh-drill-options">
        <label class="sh-field"><span>ひく手</span><select id="drill-stage" aria-label="ひく手と段">${stagesFor(drill).map(s =>
          `<option value="${s.id}" ${s.id === options.stage ? "selected" : ""}>${state().done[drill.id + ":" + s.id] ? "✓ " : ""}${s.label}</option>`).join("")}</select></label>
        <div class="sh-field"><span>ひくところ</span>${choice("pos", [...drill.pos].map(p => [p, places[p]]))}</div>
        <div class="sh-field"><span>はやさ</span>${choice("tempo", Object.entries(tempos).map(([v, [, text]]) => [v, text]))}</div>
      </div>
      <div class="sh-score-wrap"><div id="drill-score" role="status">楽ふをひらいています…</div></div>
      <div class="sh-drill-start">
        <label class="sh-field"><span>ひき方</span><select id="drill-input">
          <option value="mic" ${options.input === "mic" ? "selected" : ""}>ピアノでひく（マイク）</option>
          <option value="keys" ${options.input === "keys" ? "selected" : ""}>画面のけんばんでひく</option>
          <option value="teacher" ${options.input === "teacher" ? "selected" : ""}>先生とひく（マイクなし）</option>
        </select></label>
        ${drill.hands === "B" && stage.hand !== "B" ? `<label class="sh-check"><input type="checkbox" id="companion" ${options.companion ? "checked" : ""}>${stage.hand === "L" ? "右手" : "左手"}をアプリにひいてもらう</label>` : ""}
        <p class="sh-hint">${stage.metro ? `${tempos[options.tempo][0]}のはやさで、数えてはじめるよ。` : stage.hand === "B" || drill.ch === 2 || drill.id === "s-gis-l" ? "ひけたら先生が「できた」をおしてね。" : "音があうまで、まってくれるよ。"}</p>
        ${button("はじめる", "start", "primary sh-start", 'id="drill-start" disabled')}
        ${button("ガチャでひく手をえらぶ", "gacha", "sh-start")}
      </div>
    </section>
    ${drill.song ? `<p class="sh-song-link">つながるきょく：${words(drill.song)}</p>` : ""}`, "chapter/" + drill.ch);
  try {
    const data = await loadLayout();
    if (token !== sequence) return;
    layout = data;
    mountScore();
    root.querySelector("#drill-start").disabled = false;
  } catch (error) {
    if (token !== sequence) return;
    root.querySelector("#drill-score").innerHTML = `<p role="alert">${esc(error.message)}</p>${button("もう1回ひらく", "retry")}`;
  }
}

function mountScore() {
  const host = root.querySelector("#drill-score");
  const svg = new DOMParser().parseFromString(layout.source, "image/svg+xml").documentElement;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", childWords(drill.title) + "の楽ふ");
  svg.classList.add("drill-svg");
  if (chosenStage().hand !== "B" && matchMedia("(orientation: portrait)").matches) {
    const original = svg.cloneNode(true);
    svg.replaceChildren();
    const [x, y, width, height] = layout.viewBox;
    const lastBar = Math.max(...layout.notes.map(n => n.bar));
    let top = 0;
    for (let bar = 0; bar <= lastBar; bar += 2) {
      const boundary = b => {
        if (b <= 0) return x;
        if (b > lastBar) return x + width;
        const previous = layout.notes.filter(n => n.bar < b);
        const next = layout.notes.filter(n => n.bar >= b);
        return (Math.max(...previous.map(n => n.x)) + Math.min(...next.map(n => n.x))) / 2;
      };
      const left = boundary(bar), right = boundary(bar + 2);
      const rowHeight = height * width / (right - left);
      const system = original.cloneNode(true);
      system.classList.remove("drill-svg");
      system.classList.add("sh-score-system");
      system.setAttribute("x", 0);
      system.setAttribute("y", top);
      system.setAttribute("width", width);
      system.setAttribute("height", rowHeight);
      system.setAttribute("viewBox", `${left} ${y} ${right - left} ${height}`);
      system.dataset.bars = `${bar}-${Math.min(bar + 1, lastBar)}`;
      svg.append(system);
      top += rowHeight + 3;
    }
    svg.setAttribute("viewBox", `0 0 ${width} ${top}`);
    svg.classList.add("sh-wrapped-score");
  }
  host.replaceChildren(svg);
  host.removeAttribute("role");
}

function paintScore(index, target) {
  const svg = root.querySelector(".drill-svg");
  if (!svg) return;
  svg.querySelectorAll(".sh-markers").forEach(g => g.remove());
  const ns = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(ns, "g");
  group.classList.add("sh-markers");
  const events = practice.events;
  for (const n of layout.notes) {
    const done = events.slice(0, index).some(e => e.m === n.m && Math.abs((e.gt ?? e.t) - n.t) < .0001);
    const current = target && n.m === target.m && Math.abs(n.t - (target.gt ?? target.t)) < .0001;
    if (!done && !current) continue;
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", n.x);
    circle.setAttribute("cy", n.y);
    circle.setAttribute("r", current ? 1.65 : 1.15);
    circle.setAttribute("fill", current ? "#3158b7" : "#167143");
    circle.setAttribute("fill-opacity", ".35");
    circle.setAttribute("stroke", current ? "#3158b7" : "#167143");
    circle.setAttribute("stroke-width", ".25");
    group.append(circle);
  }
  for (const system of svg.querySelectorAll(".sh-score-system")) system.append(group.cloneNode(true));
  if (!svg.querySelector(".sh-score-system")) svg.append(group);
  // 演奏中は今の小節を大きく。全体は停止すると同じ画面で見られる。
  const n = target && layout.notes.find(n => n.m === target.m && Math.abs(n.t - (target.gt ?? target.t)) < .0001);
  if (running && n && !svg.querySelector(".sh-score-system")) {
    const bar = layout.notes.filter(v => v.bar === n.bar);
    const left = n.bar === 0 ? layout.viewBox[0] : Math.min(...bar.map(v => v.x)) - 6;
    const right = Math.max(...bar.map(v => v.x)) + 7;
    svg.setAttribute("viewBox", `${left} ${layout.viewBox[1]} ${right - left} ${layout.viewBox[3]}`);
  }
}

async function startPractice(model = false) {
  practice?.stop();
  running = true;
  awarded = false;
  document.body.dataset.screen = "perform";
  const stage = chosenStage();
  keyboardBase = stage.hand === "L" ? 48 : Math.min(72, Math.max(48,
    Math.floor(Math.min(...layout.notes.map(n => n.m)) / 12) * 12));
  shell(drill.title, `<section class="sh-performance">
    <div class="sh-playing-head"><span>${esc(stage.label)} · ${places[options.pos]}のところ</span><span id="drill-progress">0</span></div>
    <div class="sh-score-wrap"><div id="drill-score"></div></div>
    <p id="drill-status" role="status" aria-live="polite"></p>
    ${options.input === "keys" ? `<div class="sh-keyboard">${keyboard(keyboardBase)}</div>
      <div class="sh-key-range">${button("低い音へ", "keys-lower")}${button("高い音へ", "keys-higher")}</div>` : ""}
    <div class="sh-transport">${button("止める", "stop", "", 'id="drill-stop"')}${button("おてほん", "model")}${button("ひき方をかえる", "setup")}</div>
    <div class="sh-teacher" aria-label="先生のボタン">${button("できた", "done", "primary", 'id="drill-done"')}${button("もう1回", "again")}</div>
    <p class="sh-hint">先生のボタンは、いつでもつかえるよ。</p>
  </section>`, "chapter/" + drill.ch);
  document.body.dataset.screen = "perform";
  mountScore();
  practice = new Practice({
    drill, position: drill.positions[options.pos], stage, piano,
    bpm: tempos[options.tempo][0], input: options.input,
    companion: options.companion, count: store.state.count,
    onStatus(text, kind) {
      const el = root.querySelector("#drill-status");
      if (!el) return;
      if (el.textContent !== text) el.textContent = text;
      el.dataset.kind = kind;
    },
    onProgress(index, total, target) {
      const el = root.querySelector("#drill-progress");
      if (!el) return;
      el.textContent = `${index} / ${total}`;
      el.dataset.index = index;
      paintScore(index, target);
    },
    onEnd() {
      const el = root.querySelector("#drill-stop");
      if (el) el.textContent = "はじめから";
    }
  });
  if (model) await practice.model();
  else await practice.start();
}

function completeDrill() {
  if (awarded) return;
  practice?.stop();
  awarded = true;
  state().done[drill.id + ":" + options.stage] = true;
  state().credits++;
  store.save();
  root.querySelector(".sh-teacher").innerHTML = `<span class="sh-done-note">✓ できた！ ガチャが1回ふえたよ。</span>
    ${button("つぎの段へ", "next", "primary")}${button("ガチャ", "gacha")}`;
  root.querySelector("#drill-status").textContent = "先生が「できた」をつけたよ。";
}

function renderGacha() {
  const left = dailyRemaining(state());
  gachaDay = day();
  const d = catalog.drills.find(d => d.id === state().lastDrill) || catalog.drills[0];
  const saved = state().lastReward;
  const reward = saved?.drill === d.id && (saved.rarity === "UR" ||
    stagesFor(d).some(s => s.id === saved.stage && s.rarity === saved.rarity)) ? saved : null;
  if (reward?.rarity === "UR") {
    reward.label = "すきなきょくを1曲";
    reward.stage = "song";
  }
  const rates = ratesFor(d, state().rates);
  adventure.route = "gacha";
  adventure.shell("ガチャ", `${adventure.say("何が出るかな？")}
    <p class="sh-intro">「${words(d.title)}」を、どの手でひくかきめよう。</p>
    <p class="sh-pity">あと${Math.max(1, PITY - state().sinceRare)}回で UR</p>
    <div class="sh-gacha-choice"><img class="gacha-art" src="./art/fx-5.webp" alt="ガチャのカプセル">
      <div class="sh-gacha-result" role="status" aria-live="polite">${reward ?
        `<span class="sh-rarity">${reward.rarity}</span><h2>${esc(reward.label)}</h2>${reward.guaranteed ? '<p>やくそくの UR！</p>' : ""}` : '<p>何が出るかな？</p>'}</div>
      ${reward ? reward.stage === "song" ?
        button("先生：とじる", "close-reward", "primary sh-reward sh-start") :
        button("ひく", "reward", "primary sh-reward sh-start") : ""}
    </div>
    <div class="sh-gacha-tools"><p>あと <strong>${state().credits}</strong> 回まわせるよ</p>
    <p class="daily-gacha">今日はあと ${left} 回</p>
    ${button(reward ? "つぎへすすむよ" : left ? "ガチャをまわす" : "今日はおしまい", "draw", "primary", state().credits > 0 && left > 0 && !reward ? "" : "disabled")}
    ${state().credits && left ? "" : `<p class="sh-hint">${left ? "今はからっぽ。またあとで、のぞこう。" : "また明日、のぞこう。"}</p>${button("マップにもどる", "home")}`}
    <div class="sh-rates" aria-label="出るわりあい">${RARITIES.map((r, i) => rates[i] > 0 ? `<span>${r} ${Math.max(1, Math.round(rates[i]))}%</span>` : "").join("")}</div>
    <p class="sh-hint">これまで ${state().draws} 回</p></div>`, "gacha-main");
  clearTimeout(adventure.autoReturn);
  if (reward) {
    adventure.autoReturn = setTimeout(() => {
      state().lastReward = null;
      store.save();
      if (reward.stage === "song") navigate("chapter/8");
      else {
        state().options[d.id] = { ...state().options[d.id], stage: reward.stage };
        store.save();
        navigate("drill/" + d.id);
      }
    }, 2200);
  }
}

function draw() {
  const d = catalog.drills.find(d => d.id === state().lastDrill) || catalog.drills[0];
  const result = drawGacha(state(), Math.random, d);
  if (!result) return;
  const reward = rewardStage(d, result.rarity);
  state().lastReward = { ...result, stage: reward.id, label: reward.label, drill: d.id };
  store.save();
  renderGacha();
  adventure.sound("success");
  window.scrollTo(0, 0);
}

function teacherExtras() {
  if (screen !== "settings" || root.querySelector("#shodan-settings")) return;
  const settings = document.createElement("section");
  settings.id = "shodan-settings";
  settings.innerHTML = `<h2>ぼうけんの設定</h2>
    <label>相棒の名前<input id="buddy-name" maxlength="20" value="${esc(adventure.a.buddy)}"></label>
    <nav class="sh-tools">${button("見つけた！", "found")}${button("つくる", "create")}${button("きゅうけい", "rest")}<button data-act="forced">むりやり弾かせるモード</button></nav>
    <details><summary>どのステップへでも進む</summary><div class="teacher-chapters">${[...catalog.chapters.map(c => c[0]), "曲"].map((title, ch) => `<section><h3>${ch + 1}. ${esc(title)}</h3>${button("章をひらく", "chapter/" + ch, "", `data-chapter="${ch}"`)}${catalog.drills.filter(d => d.ch === ch).map(d => button(words(d.title), "lesson/" + d.id)).join("")}${ch < 8 ? button("ボスとたいけつ", "boss/" + ch) : ""}</section>`).join("")}</div></details>
    <h2>練習とガチャ</h2><p>ガチャは1日5回まで。</p>
    <p>片手の単音は「とてもゆるい」で判定。オクターブ違いは通しません。和音・両手・メトロノームは先生が判定します。</p>
    <form id="gacha-settings"><div class="sh-settings-rates">${RARITIES.map((r, i) =>
      `<label>${r} %<input name="rate-${i}" type="number" min="0" max="100" step="0.1" value="${state().rates[i]}" required></label>`).join("")}</div>
    <p>8回目はかならずUR。URが出ると数え直します。</p>
    <p id="gacha-settings-error" role="alert"></p><button class="primary" type="submit">確率と天井を保存する</button></form>
    <p>合計100%、URを0より大きくしてください。出せる物だけで確率を割り直します。URが出ると天井までの回数を数え直します。</p>
    ${store.unreadable ? button("読めなかった保存を書き出す", "export-unreadable") : ""}
    <p>できた段：${Object.keys(state().done).length} / ${catalog.drills.reduce((n, d) => n + stagesFor(d).length, 0)}。ガチャ：${state().draws}回。</p>`;
  root.querySelector("main.settings")?.prepend(settings);
}

async function act(action, el) {
  if (action === "keys-lower" || action === "keys-higher") {
    keyboardBase = Math.max(21, Math.min(85, keyboardBase + (action === "keys-lower" ? -12 : 12)));
    // 鍵盤は白鍵のドを起点に描く。端はA0とC8を含むオクターブまで。
    keyboardBase = Math.floor(keyboardBase / 12) * 12;
    root.querySelector(".sh-keyboard").innerHTML = keyboard(keyboardBase);
    return;
  }
  if (action === "export-unreadable") {
    const url = URL.createObjectURL(new Blob([store.unreadable], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "piano-shodan-unreadable.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (action === "retry") {
    if (!adventure || !catalog) {
      location.reload();
      return;
    }
    return renderRoute();
  }
  if (action === "start" || action === "again") return startPractice();
  if (action === "model") return startPractice(true);
  if (action === "stop") {
    if (practice?.active) {
      practice.stop();
      root.querySelector("#drill-status").textContent = "止まったよ。「もう1回」で、はじめから。";
      mountScore();
    } else return startPractice();
    return;
  }
  if (action === "setup") {
    practice?.stop();
    running = false;
    return renderDrill();
  }
  if (action === "option") {
    options[el.dataset.field] = el.dataset.value;
    saveOptions();
    await renderDrill();
    root.querySelector(`[data-field="${el.dataset.field}"][data-value="${el.dataset.value}"]`)?.focus();
    return;
  }
  if (action === "done") return completeDrill();
  if (action === "next") {
    const stages = stagesFor(drill);
    options.stage = stages[(stages.findIndex(s => s.id === options.stage) + 1) % stages.length].id;
    saveOptions();
    running = false;
    return renderDrill();
  }
  if (action === "draw") return draw();
  if (action === "close-reward") {
    const id = state().lastReward.drill;
    state().lastReward = null;
    store.save();
    return navigate("drill/" + id);
  }
  if (action === "reward") {
    const reward = state().lastReward;
    if (reward.stage === "song") return;
    state().options[reward.drill] = { ...state().options[reward.drill], stage: reward.stage };
    store.save();
    return navigate("drill/" + reward.drill);
  }
  navigate(action);
}

root.addEventListener("click", event => {
  const el = event.target.closest("[data-action]");
  if (el && !el.disabled) act(el.dataset.action, el).catch(e => notify(e.message));
  const key = event.target.closest(".sh-keyboard [data-key]");
  if (key) {
    piano.note(Number(key.dataset.key));
    practice?.hear(Number(key.dataset.key));
  }
});

root.addEventListener("change", event => {
  const el = event.target;
  const field = { "drill-stage": "stage", "drill-input": "input", companion: "companion" }[el.id];
  if (!field) return;
  options[field] = el.type === "checkbox" ? el.checked : el.value;
  saveOptions();
  renderDrill().then(() => root.querySelector("#" + el.id)?.focus()).catch(e => notify(e.message));
});

// Every accepted press has both an audible and a visible acknowledgement.
document.addEventListener("click", event => {
  const target = event.target.closest("button, summary");
  if (!target || target.disabled) return;
  adventure?.sound("tap");
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    target.animate([{ transform: "translateY(3px)" }, { transform: "translateY(0)" }], { duration: 130 });
  }
}, { capture: true });
document.addEventListener("change", event => {
  if (event.target.matches("select, input[type=checkbox], input[type=range]")) adventure?.sound("tap");
});

root.addEventListener("submit", event => {
  if (event.target.id !== "gacha-settings") return;
  event.preventDefault();
  const data = new FormData(event.target);
  const rates = RARITIES.map((_, i) => Number(data.get("rate-" + i)));
  const pity = PITY;
  const error = root.querySelector("#gacha-settings-error");
  if (Math.abs(rates.reduce((a, b) => a + b, 0) - 100) > .001 || rates[4] <= 0) {
    error.textContent = "合計を100%にし、URを0より大きくしてください。";
    return;
  }
  state().rates = rates;
  state().pity = pity;
  state().sinceRare = Math.min(state().sinceRare, pity - 1);
  store.save();
  error.textContent = "保存しました。";
});

const clock = document.createElement("aside");
clock.className = "sh-clock";
clock.setAttribute("aria-label", "30分のレッスン");
document.body.append(clock);

function refreshGachaDay() {
  if (screen === "gacha" && gachaDay !== day()) renderGacha();
}
window.addEventListener("pageshow", refreshGachaDay);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshGachaDay();
});

function paintClock() {
  refreshGachaDay();
  const elapsed = store.state.lessonStart ? Math.floor((Date.now() - store.state.lessonStart) / 1000) : 0;
  const remaining = Math.max(0, 1800 - elapsed);
  const text = String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0");
  const content = `<span>のこり <strong>${text}</strong></span><button data-clock="toggle">${store.state.lessonStart ? "おわる" : "30分 はじめる"}</button>`;
  if (!clock.querySelector("strong")) clock.innerHTML = content;
  clock.querySelector("strong").textContent = text;
  const label = store.state.lessonStart ? "おわる" : "30分 はじめる";
  if (clock.querySelector("button").textContent !== label) clock.querySelector("button").textContent = label;
  if (store.state.lessonStart) {
    const milestone = elapsed >= 1680 ? 2 : elapsed >= 780 ? 1 : 0;
    if (milestone > state().lessonNotice) {
      state().lessonNotice = milestone;
      store.save();
      notify(milestone === 1 ? "13分。むりやりひかせるモードもつかえるよ。" : "28分。さいごに、りょう手でひこう。");
    }
  }
}

clock.addEventListener("click", event => {
  if (!event.target.closest("[data-clock]")) return;
  store.state.lessonStart = store.state.lessonStart ? null : Date.now();
  state().lessonNotice = 0;
  store.save();
  paintClock();
});

window.addEventListener("resize", () => {
  if ((screen === "drill") && layout && root.querySelector("#drill-score")) {
    mountScore();
    if (practice) paintScore(practice.index, practice.events[practice.index]);
  }
});
window.addEventListener("hashchange", renderRoute);
window.addEventListener("shodan-nav", event => navigate(event.detail));
window.addEventListener("shodan-settings", teacherExtras);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && practice?.active) {
    practice.stop();
    resumeAfterHidden = true;
  } else if (!document.hidden && resumeAfterHidden) {
    resumeAfterHidden = false;
    const el = root.querySelector("#drill-status");
    if (el) el.textContent = "音を止めたよ。「もう1回」でつづけよう。";
  }
});
window.addEventListener("pagehide", () => practice?.stop());

try {
  await ready;
  [catalog, songIndex] = await Promise.all([json("drills/index.json"), json("index.json")]);
  adventure = new Adventure({ root, store, piano, catalog, songs: songIndex, navigate, notify });
  await renderRoute();
  paintClock();
  setInterval(paintClock, 1000);
} catch (error) {
  shell("まだとどいていません", `<p role="alert">${esc(error.message)}</p>${button("もう1回ひらく", "retry")}`);
}
