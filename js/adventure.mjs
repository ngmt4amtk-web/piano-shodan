import { scoreFrame, tightFrame, scorePages, MARKER_RADIUS } from "./score-frame.mjs";
import { Practice, noteName } from "./practice.mjs";
import { childWords } from "./child-text.mjs";
import { day } from "./state.mjs";
import { adventureState, BUDDY_LINES, WORLDS, buildLesson, needsBreak,
  battleResult, weekNumber, streak } from "./journey.mjs";

const esc = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const words = value => esc(childWords(value));
const image = (name, cls = "", alt = "") =>
  `<img class="art ${cls}" src="./art/${name}.webp" alt="${esc(alt)}" draggable="false">`;
const B = (label, action, cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-game="${action}" ${extra}>${label}</button>`;
const TITLES = {
  play: "ピアノでひこう", mimic: "まねしてひこう", finger: "どのゆび？",
  note: "この音、どこ？", listen: "どっちが高い？", rhythm: "リズムをたたこう", teacher: "先生に聞いてもらおう"
};
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const RULES = ["ミス5回でまけ", "速いほうが勝ち", "先生は左手だけ", "先生は目をつぶる", "先生はしゃべりながら", "1回だけやり直し"];

export class Adventure {
  constructor({ root, store, piano, catalog, songs, navigate, notify }) {
    Object.assign(this, { root, store, piano, catalog, songs, navigate, notify });
    this.cache = new Map();
    this.serial = 0;
    root.addEventListener("click", event => {
      const el = event.target.closest("[data-game]");
      if (!el || el.disabled) return;
      this.act(el.dataset.game, el).catch(error => this.fail(error));
    });
    root.addEventListener("input", event => this.input(event.target));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.practice?.stop();
        this.modelToken = (this.modelToken || 0) + 1;
        if (this.lesson && this.route === "lesson") this.persistLesson();
      } else if (this.lesson && this.route === "lesson") {
        this.renderQuestion(true).catch(error => this.fail(error));
      }
    });
    window.addEventListener("pagehide", () => {
      this.practice?.stop();
      if (this.lesson && this.route === "lesson") this.persistLesson();
    });
    this.tick = setInterval(() => this.clock(), 250);
  }

  get a() { return adventureState(this.store.state.shodan); }
  save() { this.store.save(); }
  buddy() {
    const n = Object.keys(this.a.bosses).length;
    return `buddy-dog-${n === 0 ? 1 : n === 1 ? 2 : n < 4 ? 4 : n < 7 ? 5 : 6}`;
  }
  line(index = Math.floor(Math.random() * BUDDY_LINES.length)) { return BUDDY_LINES[index % BUDDY_LINES.length]; }
  say(text, picture = this.buddy()) {
    return `<div class="buddy-says">${image(picture, "buddy-portrait")}<div class="bubble" role="status">${esc(text)}</div></div>`;
  }
  shell(title, body, cls = "", back = "home") {
    document.body.dataset.screen = this.route;
    document.body.classList.add("adventure");
    this.root.innerHTML = `<header class="ad-header">${B("‹ マップ", "nav:" + back, "small-button")}
      <span class="ad-wordmark">ピアノ初段<span class="wordmark-dot">●</span></span>
      <span class="mini-xp">★ ${this.a.xp}</span></header>
      <main class="ad-main ${cls}"><h1 tabindex="-1">${esc(title)}</h1>${body}</main>`;
  }
  leave() {
    if (this.lesson && this.route === "lesson") this.persistLesson();
    this.lesson = null;
    this.serial++;
    this.practice?.stop();
    this.practice = null;
    this.modelToken = (this.modelToken || 0) + 1;
    clearTimeout(this.transition);
    clearTimeout(this.autoReturn);
    clearTimeout(this.maskTimer);
    this.route = null;
    this.busy = false;
    document.body.classList.remove("adventure");
  }
  async show(route, id) {
    this.route = route;
    document.body.classList.add("adventure");
    if (route === "home") this.map();
    if (route === "lesson") await this.startLesson(id);
    if (route === "boss") this.bossSetup(Number(id) || 0);
    if (route === "create") this.create();
    if (route === "collection") this.collection();
    if (route === "found") this.found();
    if (route === "rest") this.rest(() => this.navigate("home"));
  }
  fail(error) {
    this.notify(error.message || "もう1回ためしてね。");
    this.busy = false;
    if (this.lesson && this.route === "lesson") {
      this.shell("もう1回ひらこう", `<p role="alert">楽ふがとどきませんでした。</p>
        ${B("もう1回ひらく", "retry-question", "big-button")}`, "center-stage");
    }
  }

  map() {
    const current = this.catalog.drills.find(d => d.id === this.a.resume?.id) ||
      this.catalog.drills.find(d => !this.a.completed[d.id]) || this.catalog.drills.at(-1);
    const openCh = Math.max(current.ch, this.catalog.drills.find(d => !this.a.completed[d.id])?.ch ?? 8);
    this.shell("音のぼうけん", `<div class="map-motto"><span>きょうは、どこまで？</span><span class="map-counter">${Object.keys(this.a.completed).length} / 42</span></div>
      <div class="trail-worlds">${WORLDS.map((world, ch) => {
        const drills = this.catalog.drills.filter(d => d.ch === ch);
        const done = drills.filter(d => this.a.completed[d.id]).length;
        const path = ["M 190 28"];
        for (let i = 1; i < drills.length + 2; i++) {
          const from = [190, 275, 190, 105][(i - 1) % 4];
          const to = [190, 275, 190, 105][i % 4];
          const y = (i - 1) * 124 + 28;
          path.push(`C ${from} ${y + 75}, ${to} ${y + 49}, ${to} ${y + 124}`);
        }
        return `<section class="trail-world world-${world.color}" id="world-${ch}" aria-label="${esc(world.name)}">
          <div class="world-banner"><span class="world-number">${String(ch + 1).padStart(2, "0")}</span><div><small>${ch === 8 ? "きょく" : "音のぼうけん"}</small><h2>${esc(world.name)}</h2></div><span>${ch === 8 ? "18曲" : `${done}/${drills.length}`}</span></div>
          ${ch === 8 ? `<div class="song-island">${image("journey-3", "piano-house")}<h3>すきなきょくに、会いにいこう。</h3>${B("18きょくの地図へ", "nav:chapter/8", "big-button")}</div>` :
          `<div class="trail" style="--steps:${drills.length + 2}">
            <svg class="trail-line" viewBox="0 0 380 ${(drills.length + 1) * 124 + 28}" preserveAspectRatio="none" aria-hidden="true"><path d="${path.join(" ")}"/></svg>
            ${drills.map((d, i) => {
              const x = [50, 72.4, 50, 27.6][i % 4];
              const completed = !!this.a.completed[d.id];
              const locked = ch > openCh;
              return `<div class="trail-stop ${i % 4 === 1 ? "stop-right" : i % 4 === 3 ? "stop-left" : ""} ${d.id === current.id ? "current-stop" : ""}" style="--x:${x}%;--row:${i}" data-stop="${d.id}">
                ${d.id === current.id ? `<div class="map-buddy">${image(this.a.lastPlayed && Date.now() - this.a.lastPlayed > 14 * 86400000 ? "buddy-dog-3" : this.buddy(), "bouncing")}<span class="bubble">${esc(this.a.resume ? "つづき、いこ。" : "ちょっとひいて。")}</span></div>` : ""}
                ${B(completed ? "✓" : locked ? "·" : "♪", "step:" + d.id, `step ${completed ? "completed" : ""} ${d.id === current.id ? "current" : ""}`,
                  `data-step="${d.id}" aria-label="${words(d.title)}${completed ? "、できた" : ""}" aria-expanded="false" ${locked ? 'aria-disabled="true"' : ""}`)}
                <span class="step-name">${words(d.title)}</span><div class="step-ticket" hidden></div>
              </div>`;
            }).join("")}
            <div class="trail-chest" style="--row:2">${B(image("fx-3"), "chest:" + ch, "art-button", 'aria-label="たからばこをのぞく"')}</div>
            <div class="trail-scenery scenery-one" aria-hidden="true">${image("journey-4")}</div>
            <div class="trail-scenery scenery-two" aria-hidden="true">${image("journey-5")}</div>
            <div class="boss-stop" style="--row:${drills.length}">${B(image(world.boss) + `<span>${esc(this.a.bossNames[ch] || world.title)}</span>`, "boss-door:" + ch, "boss-door", `aria-label="${esc(world.title)}とたいけつ"`)}
            <span class="boss-step-caption">${this.a.bosses[ch] ? "✓ なかまになった！" : "先生とたいけつ"}</span></div>
            ${ch < 7 ? `<div class="fork-stop" style="--row:${drills.length + 1}"><span>つぎ、どっち？</span>${B("音の道", "branch:" + (ch + 1), "small-button")}${B("リズムの道", "rhythm-branch:" + (ch + 1), "small-button")}</div>` : ""}
          </div>`}</section>`;
      }).join("")}</div>
      <button class="force-tag" data-act="forced">60びょう ひこう</button>
      <nav class="map-nav" aria-label="あそび">${B("♪ つくる", "nav:create")}${B("ずかん", "nav:collection")}${B("音ぷ・きょくあて", "nav:play")}</nav>`, "map-main");
    const header = this.root.querySelector(".ad-header");
    header.innerHTML = `<span class="weekly-streak" aria-label="れんぞく${streak(this.a.weeks)}しゅう"><span class="streak-mark" aria-hidden="true">◈</span><span><small>れんぞく</small><strong>${streak(this.a.weeks)} しゅう</strong></span></span>
      <span class="mini-xp">★ ${this.a.xp}</span>${B(image("fx-5") + "ガチャ", "nav:gacha", "header-gacha")}${B("⚙", "nav:settings", "gear", 'aria-label="先生の部屋"')}`;
    if (this.a.lastCompleted) {
      this.root.querySelector(`[data-step="${this.a.lastCompleted}"]`)?.classList.add("just-completed");
    }
    requestAnimationFrame(() => {
      if (openCh === 8 && !this.a.resume) this.root.querySelector("#world-8")?.scrollIntoView({ block: "start" });
      else this.revealStop(this.root.querySelector(".current-stop"));
    });
  }

  ticket(id) {
    const d = this.catalog.drills.find(d => d.id === id);
    const stop = this.root.querySelector(`[data-stop="${id}"]`);
    if (!d || !stop) return;
    const locked = stop.querySelector(".step").getAttribute("aria-disabled") === "true";
    if (locked) return this.notify("先生のへやからも、ひらけるよ。");
    this.root.querySelectorAll(".step-ticket").forEach(el => { el.hidden = true; });
    this.root.querySelectorAll(".step[aria-expanded]").forEach(el => el.setAttribute("aria-expanded", "false"));
    const ticket = stop.querySelector(".step-ticket");
    ticket.hidden = false;
    stop.querySelector(".step").setAttribute("aria-expanded", "true");
    ticket.innerHTML = `<strong>${words(d.title)}</strong>${!this.a.introduced ?
      `<label>なんてよぶ？<input id="first-name" maxlength="40" autocomplete="off" placeholder="よび名" value="${esc(this.store.state.name)}"></label>` : ""}
      ${B(this.a.resume?.id === id ? "つづける" : "はじめる", "start:" + id, "big-button")}`;
    requestAnimationFrame(() => this.revealStop(stop));
  }
  revealStop(stop) {
    if (!stop || this.route !== "home") return;
    const targets = [...stop.querySelectorAll(".step, .step-ticket:not([hidden])")];
    const rects = targets.map(el => el.getBoundingClientRect());
    const top = this.root.querySelector(".ad-header").getBoundingClientRect().bottom + 10;
    const bottom = Math.min(innerHeight, ...[...document.querySelectorAll(".map-nav, .sh-clock")]
      .map(el => el.getBoundingClientRect().top)) - 10;
    const first = Math.min(...rects.map(r => r.top));
    const last = Math.max(...rects.map(r => r.bottom));
    window.scrollBy(0, last > bottom ? last - bottom : first < top ? first - top : 0);
  }

  songMap() {
    this.route = "song-islands";
    this.shell("18きょくのたから島", `${this.say("ひける音で、きょくに会おう。", "journey-2")}
      <div class="song-path">${this.store.state.order.map((no, i) => {
        const song = this.songs.find(s => s.no === no);
        return `<div class="song-landmark world-${WORLDS[i % 8].color}" style="--side:${i % 2 ? 1 : -1}">
          ${B(image(i % 3 === 0 ? "journey-3" : i % 3 === 1 ? "journey-5" : "journey-6") + `<span class="song-number">${i + 1}</span><strong>${words(song.ja)}</strong>`, "nav:song/" + no, "song-landmark-button", `data-song="${no}"`)}
        </div>`;
      }).join("")}</div>`, "songs-map-main");
  }

  async startLesson(id) {
    this.serial++;
    this.busy = false;
    const drill = this.catalog.drills.find(d => d.id === id) || this.catalog.drills[0];
    const previous = this.catalog.drills[Math.max(0, this.catalog.drills.indexOf(drill) - 1)];
    const resume = this.a.resume?.id === drill.id ? this.a.resume : null;
    const questions = buildLesson(drill, previous);
    const branch = resume?.branch || this.a.branch;
    if (branch === "rhythm") {
      [questions[1], questions[5]] = [questions[5], questions[1]];
      this.a.branch = null;
    }
    this.lesson = { id: drill.id, drill, questions, branch, index: resume ? Math.max(0, Math.min(6, resume.index || 0)) : 0,
      combo: resume?.combo || 0, best: resume?.best || 0, correct: resume?.correct || 0 };
    this.a.introduced = true;
    this.store.state.shodan.lastDrill = drill.id;
    if (!this.store.state.lessonStart || Date.now() - this.store.state.lessonStart > 1800000 || this.a.sessionEnded) {
      this.store.state.lessonStart = Date.now();
      this.a.breaks = 0;
      this.a.sessionEnded = false;
      this.store.state.shodan.lessonNotice = 0;
    }
    this.persistLesson();
    await this.renderQuestion();
  }
  persistLesson() {
    const { id, index, combo, best, correct, branch } = this.lesson;
    this.a.resume = { id, index, combo, best, correct, branch };
    this.save();
  }
  q() { return this.lesson.questions[this.lesson.index]; }
  async layoutFor(q) {
    const d = this.catalog.drills.find(d => d.id === q.drillId) || this.lesson.drill;
    const p = d.positions[d.pos[0]];
    const key = p.layouts[d.hands === "B" && q.type === "teacher" ? "B" : q.hand];
    if (!this.cache.has(key)) {
      const response = await fetch(new URL("../data/drills/" + key, import.meta.url));
      if (!response.ok) throw Error("楽ふがとどきません。もう1回ひらこう。");
      const layout = await response.json();
      const svg = await fetch(new URL("../data/drills/" + layout.svg, import.meta.url));
      if (!svg.ok) throw Error("楽ふがとどきません。もう1回ひらこう。");
      this.cache.set(key, { ...layout, source: await svg.text() });
    }
    return this.cache.get(key);
  }
  async renderQuestion(resuming = false) {
    this.practice?.stop();
    this.busy = false;
    this.modelToken = (this.modelToken || 0) + 1;
    const token = ++this.serial;
    if (needsBreak(this.a, this.store.state.lessonStart) || this.a.restUntil > Date.now()) {
      return this.rest(() => this.renderQuestion());
    }
    this.route = "lesson";
    const q = this.q();
    q.type = q.originalType || q.type;
    this.shell(TITLES[q.type], `<div class="lesson-top"><div class="lesson-progress" role="progressbar" aria-label="レッスンのすすみぐあい" aria-valuemin="0" aria-valuemax="7" aria-valuenow="${this.lesson.index}"><span style="width:${this.lesson.index / 7 * 100}%"></span></div><strong>${this.lesson.index + 1}/7</strong><span class="combo">${this.lesson.combo} れんぞく</span></div>
      <section class="question-stage" data-type="${q.type}">
        <div class="question-buddy">${this.say(q.finale ? "さいご、つなげてみよ。" : q.warmup ? "まず、4つひこう。" : this.line(this.lesson.index + this.a.xp))}</div>
        <div class="question-content"><div class="question-caption">${q.hand === "B" ? "りょう手" : q.hand === "L" ? "左手" : "右手"}${q.finale ? "・さいごまで" : ""}</div>
          <div id="question-score" class="question-score" aria-label="楽ふをよみこみ中" role="status">楽ふをひらいてるよ…</div>
          <div id="note-trail" class="note-trail"></div><p id="question-status" role="status" aria-live="polite"></p>
          <div id="question-controls"></div><div class="question-tools">${B("おてほん", "model", "small-button")}${B("ヒント", "hint", "small-button")}${B("もう1回", "repeat", "small-button")}</div>
          <details class="input-options"><summary>ひき方をかえる</summary><div>${B("ピアノ・マイク", "input:mic")}${B("画面のけんばん", "input:keys")}${B("先生チェック", "input:teacher")}</div></details>
        </div>
      </section>`, "lesson-main");
    this.layout = await this.layoutFor(q);
    if (token !== this.serial) return;
    this.noteIndex = 0;
    this.scorePage = 0;
    this.paintScore(0);
    this.controls();
    if (q.type === "listen") {
      this.root.querySelector("#question-score").innerHTML = '<div class="listening-notes" aria-hidden="true"><span>1 ♪</span><span>2 ♪</span></div>';
      this.root.querySelector("#note-trail").hidden = true;
    }
    this.persistLesson();
    window.scrollTo(0, 0);
    this.root.querySelector("h1")?.focus({ preventScroll: true });
    if (["play", "mimic"].includes(q.type)) {
      if (this.a.input === "teacher") this.teacherFallback();
      else if (q.type === "mimic" && !resuming) await this.model(true);
      else await this.listenForNotes();
    } else if (q.type === "listen") {
      await this.listenPair();
    } else if (q.type === "rhythm") {
      this.startRhythm();
    }
  }

  paintScore(index) {
    this.noteIndex = index;
    const host = this.root.querySelector("#question-score");
    if (!host || !this.layout) return;
    const q = this.q();
    const events = q.events;
    const chunkSize = host.clientWidth < 440 ? 4 : 8;
    const pages = scorePages(events, chunkSize);
    const selected = q.type === "teacher" ? Math.min(this.scorePage || 0, pages.length - 1) :
      pages.findIndex(page => page.includes(events[Math.min(index, events.length - 1)]));
    const visible = pages[Math.max(0, selected)];
    const chunk = events.indexOf(visible[0]);
    const notes = this.layout.notes.filter(n => visible.some(e => e.m === n.m && Math.abs((e.gt ?? e.t) - n.t) < .0001));
    const svg = new DOMParser().parseFromString(this.layout.source, "image/svg+xml").documentElement;
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${q.hand === "L" ? "左手" : "右手"}の楽ふ。${visible.map(n => noteName(n.m)).join("、")}`);
    if (["finger", "note"].includes(q.type)) svg.querySelector('[aria-label="ゆびばんごう"]')?.remove();
    const stripped = ["finger", "note"].includes(q.type);
    const [x, , w] = scoreFrame(this.layout);
    const [, y, , h] = tightFrame(this.layout, notes, stripped);
    if (notes.length) {
      const firstX = Math.min(...notes.map(n => n.x));
      const lastX = Math.max(...notes.map(n => n.x));
      const before = this.layout.notes.filter(n => n.x < firstX - .01);
      const after = this.layout.notes.filter(n => n.x > lastX + .01);
      const left = before.length ? (Math.max(...before.map(n => n.x)) + firstX) / 2 : x;
      const right = after.length ? (Math.min(...after.map(n => n.x)) + lastX) / 2 : x + w;
      svg.setAttribute("viewBox", `${left} ${y} ${right - left} ${h}`);
      svg.setAttribute("width", right - left);
      svg.setAttribute("height", h);
      const ns = "http://www.w3.org/2000/svg";
      for (const n of notes) {
        const eventIndex = events.findIndex((e, i) => i >= chunk && e.m === n.m && Math.abs((e.gt ?? e.t) - n.t) < .0001);
        if (eventIndex > index) continue;
        const circle = document.createElementNS(ns, "circle");
        for (const [key, value] of Object.entries({ cx: n.x, cy: n.y, r: MARKER_RADIUS,
          fill: eventIndex < index ? "#21a6a0" : "#ff735e", "fill-opacity": .4,
          stroke: eventIndex < index ? "#147771" : "#bd3c2c", "stroke-width": .25 })) circle.setAttribute(key, value);
        svg.append(circle);
      }
    }
    host.replaceChildren(svg);
    if (q.type === "teacher" && pages.length > 1) {
      const pager = document.createElement("nav");
      pager.className = "score-pages";
      pager.setAttribute("aria-label", "楽ふをおくる");
      pager.innerHTML = `${B("まえ", "score-page:-1", "small-button", selected === 0 ? "disabled" : "")}
        <span>${selected + 1}/${pages.length}</span>${B("つぎ", "score-page:1", "small-button", selected === pages.length - 1 ? "disabled" : "")}`;
      host.append(pager);
    }
    host.removeAttribute("role");
    host.removeAttribute("aria-label");
    const trail = this.root.querySelector("#note-trail");
    trail.dataset.index = index;
    trail.innerHTML = visible.map((n, i) => `<span class="note-pebble ${chunk + i < index ? "played" : ""}" ${chunk + i === index ? 'aria-current="step"' : ""}>${chunk + i < index ? "✓" : q.type === "note" ? "？" : noteName(n.m)}</span>`).join("");
    const target = events[index];
    const keyboard = this.root.querySelector("#question-controls .ad-keyboard");
    if (keyboard && target && !keyboard.querySelector(`[data-midi="${target.m}"]`)) {
      this.root.querySelector("#question-controls").innerHTML = this.keys("key", Math.floor(target.m / 12) * 12);
    }
  }

  keys(action = "key", base) {
    base ??= Math.floor(this.q().events[0].m / 12) * 12;
    const white = WHITE.map((n, i) => B(`<span>${noteName(base + n)}</span>`, action + ":" + (base + n), "piano-white", `data-midi="${base + n}" style="--key:${i}" aria-label="${noteName(base + n)}、${Math.floor((base + n) / 12) - 1}オクターブ"`)).join("");
    const blacks = [1, 3, 6, 8, 10].map((n, i) => B("", action + ":" + (base + n), "piano-black", `data-midi="${base + n}" style="--black:${[1, 2, 4, 5, 6][i]}" aria-label="${noteName(base + n)}"`)).join("");
    return `<div class="ad-keyboard" role="group" aria-label="画面のけんばん">${white}${blacks}</div>`;
  }
  controls() {
    const q = this.q();
    const host = this.root.querySelector("#question-controls");
    if (["play", "mimic"].includes(q.type)) {
      host.innerHTML = this.a.input === "keys" ? this.keys() :
        `<div class="mic-listening"><span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>ピアノの音を聞くよ</span></div>${B("先生チェックにする", "fallback", "small-button")}`;
    } else if (q.type === "finger") {
      const correct = q.events[0].f || 1;
      const choices = [1, 2, 3, 4, 5].filter(n => n !== (correct === 5 ? 1 : 5));
      host.innerHTML = `<div class="finger-answers" role="group" aria-label="ゆびをえらぶ">${choices.map(n => B(`<strong>${n}</strong><span>${["", "おやゆび", "ひとさしゆび", "中ゆび", "くすりゆび", "小ゆび"][n]}</span>`, "answer:" + n, "finger-choice")).join("")}</div>`;
      this.setStatus("この音は、何ばんのゆび？");
    } else if (q.type === "note") {
      host.innerHTML = this.keys();
      this.setStatus("楽ふの音を、けんばんでおそう。");
    } else if (q.type === "listen") {
      host.innerHTML = `<div class="listen-answers">${B("1こめ", "answer:first", "big-button")}${B("2こめ", "answer:second", "big-button")}</div>`;
    } else if (q.type === "rhythm") {
      host.innerHTML = `<div class="beat-dots" aria-hidden="true">${q.events.map(() => "<i></i>").join("")}</div>${B("トン！", "tap", "tap-drum", 'aria-label="リズムをたたく"')}`;
    } else {
      host.innerHTML = `<p class="teacher-label">先生、どうだった？</p><div class="teacher-answers">${B("○ できた", "judge:yes", "big-button")}${B("× もう1回", "judge:no", "light-button")}</div>`;
      this.setStatus("ひいたら、先生が○か×をおしてね。");
    }
  }
  setStatus(text, kind = "") {
    const el = this.root.querySelector("#question-status");
    if (el) { el.textContent = text; el.dataset.kind = kind; }
  }
  teacherFallback() {
    const q = this.q();
    if (q.type !== "teacher") q.originalType = q.type;
    q.type = "teacher";
    this.practice?.stop();
    this.root.querySelector(".question-stage").dataset.type = "teacher";
    this.root.querySelector("h1").textContent = TITLES.teacher;
    this.controls();
    this.paintScore(0);
  }
  async listenForNotes() {
    const stage = this.root.querySelector(".question-stage");
    if (stage) stage.dataset.phase = "waiting";
    const q = this.q();
    const offset = q.events[0].t;
    const events = q.events.map(n => ({ ...n, t: n.t - offset }));
    const end = Math.max(...events.map(n => n.t + n.d));
    this.practice = new Practice({ drill: this.lesson.drill,
      position: { events: { [q.hand]: events }, end },
      stage: { hand: q.hand, metro: false }, piano: this.piano, bpm: 90,
      input: this.a.input || "mic",
      onStatus: (text, kind) => {
        if (kind === "teacher") return this.teacherFallback();
        if (kind === "wrong") { this.wrong("もう1回。音をさがそう。"); return; }
        if (kind === "loading") this.setStatus("マイクの用意中。先生チェックでもいけるよ。");
        else this.setStatus(this.a.input === "keys" ? "楽ふの音をひこう。" : "ピアノで、ひいてみよう。");
      },
      onProgress: index => {
        this.paintScore(index);
        if (index > 0) this.sound("note");
      },
      onEnd: () => this.correct()
    });
    await this.practice.start();
  }
  async sound(kind = "tap") {
    try {
      await this.piano.unlock();
      const c = this.piano.context;
      const complete = kind === "complete";
      const success = kind === "success" || complete;
      const pitches = complete ? [72, 76, 79, 84, 88] : success ? [76, 79, 84] : kind === "wrong" ? [55, 53] : kind === "hit" ? [43, 36] : kind === "note" ? [88] : [81];
      pitches.forEach((m, i) => this.piano.note(m, c.currentTime + i * (complete ? .16 : .075),
        complete ? .38 : success ? .18 : .07, success ? .3 : .16));
    } catch { /* Visual response and teacher input remain available. */ }
  }
  async model(thenListen = false) {
    this.practice?.stop();
    const q = this.q();
    const token = this.modelToken = (this.modelToken || 0) + 1;
    this.setStatus("まず、聞いてね。");
    const stage = this.root.querySelector(".question-stage");
    if (stage) stage.dataset.phase = "model";
    this.root.querySelectorAll("#question-controls button").forEach(el => { el.disabled = true; });
    this.root.querySelector(".buddy-portrait")?.classList.add("bouncing");
    try { await this.piano.unlock(); } catch { return this.teacherFallback(); }
    const events = q.events;
    const offset = events[0].t;
    const start = this.piano.context.currentTime;
    const unit = 1.5;
    events.forEach(n => this.piano.note(n.m, start + (n.t - offset) * unit, Math.min(.65, (n.soundD ?? n.d) * unit)));
    const duration = (Math.max(...events.map(n => n.t + n.d)) - offset) * unit * 1000;
    await new Promise(resolve => setTimeout(resolve, duration + 100));
    if (token !== this.modelToken || this.route !== "lesson") return;
    this.root.querySelector(".buddy-portrait")?.classList.remove("bouncing");
    this.setStatus("こんどは、きみのばん。");
    if (stage) stage.dataset.phase = "waiting";
    this.root.querySelectorAll("#question-controls button").forEach(el => { el.disabled = false; });
    if (["play", "mimic"].includes(q.type) || thenListen) await this.listenForNotes();
  }
  async listenPair() {
    const q = this.q();
    const first = q.events[0].m;
    const other = q.events[1]?.m;
    q.listenNotes = [first, other !== undefined && other !== first ? other : first + 2];
    q.answer = q.listenNotes[0] > q.listenNotes[1] ? "first" : "second";
    this.setStatus("どっちが高い？ 聞き直してもいいよ。");
    try {
      await this.piano.unlock();
      q.listenNotes.forEach((n, i) => this.piano.note(n, this.piano.context.currentTime + i * .65, .4));
    } catch { this.setStatus("音を出すには「おてほん」をおしてね。"); }
  }
  startRhythm() {
    this.rhythm = { index: 0, start: null, modelAt: performance.now() };
    this.setStatus("音のまねで、トン、トン。");
    const q = this.q();
    this.piano.unlock().then(() => {
      q.events.forEach((n, i) => this.piano.click(this.piano.context.currentTime + (n.t - q.events[0].t) * 2, i === 0));
    }).catch(() => {});
  }
  tap() {
    if (this.busy) return;
    const q = this.q();
    const r = this.rhythm;
    if (r.start === null) r.start = performance.now();
    const expected = (q.events[r.index].t - q.events[0].t) * 2000;
    const elapsed = performance.now() - r.start;
    const gaps = q.events.slice(1).map((n, i) => (n.t - q.events[i].t) * 2000).filter(gap => gap > 0);
    const tolerance = Math.min(380, ...gaps.map(gap => gap / 2));
    if (r.index && Math.abs(elapsed - expected) > tolerance) {
      this.wrong("音といっしょに、もう1回。");
      this.startRhythm();
      this.root.querySelectorAll(".beat-dots i").forEach(el => el.classList.remove("beat-hit"));
      return;
    }
    this.root.querySelectorAll(".beat-dots i")[r.index]?.classList.add("beat-hit");
    this.paintScore(++r.index);
    if (r.index === q.events.length) this.correct();
  }
  wrong(text = "もう1回、さがそう。") {
    this.lesson.combo = 0;
    this.setStatus(text, "wrong");
    this.sound("wrong");
    const stage = this.root.querySelector(".question-stage");
    stage?.classList.remove("wiggle");
    requestAnimationFrame(() => stage?.classList.add("wiggle"));
    this.persistLesson();
  }
  correct() {
    if (this.busy || this.route !== "lesson") return;
    this.busy = true;
    this.practice?.stop();
    this.sound("success");
    this.lesson.correct++;
    this.lesson.combo++;
    this.lesson.best = Math.max(this.lesson.best, this.lesson.combo);
    this.root.querySelector(".question-stage")?.classList.add("question-correct");
    this.setStatus("✓ " + this.line(this.lesson.correct + 2), "correct");
    this.root.querySelectorAll("#question-controls button, .question-tools button, .input-options button").forEach(el => { el.disabled = true; });
    const index = this.lesson.index + 1;
    this.transition = setTimeout(() => {
      if (index >= this.lesson.questions.length) this.finishLesson();
      else {
        this.lesson.index = index;
        this.persistLesson();
        this.renderQuestion().catch(error => this.fail(error));
      }
    }, 650);
  }
  finishLesson() {
    const l = this.lesson;
    const xp = 10 + l.best;
    this.a.completed[l.id] = true;
    this.a.lastCompleted = l.id;
    this.a.xp += xp;
    this.a.lastPlayed = Date.now();
    const week = weekNumber();
    if (!this.a.weeks.includes(week)) this.a.weeks.push(week);
    this.a.resume = null;
    this.store.state.shodan.done[l.id + ":" + (l.drill.hands === "L" ? "L" : l.drill.hands === "B" ? "B" : "R")] = true;
    this.store.state.shodan.credits++;
    const surprise = Object.keys(this.a.completed).length % 3 === 0 && this.a.surpriseAt !== Object.keys(this.a.completed).length;
    if (surprise) this.a.surpriseAt = Object.keys(this.a.completed).length;
    this.save();
    this.route = "complete";
    this.shell("ひけたじゃん！", `<div class="finish-scene">${image("fx-4", "finish-stars")}${image(this.buddy(), "finish-buddy")}</div>
      <div class="finish-numbers"><span><strong>+${xp}</strong>ほし</span><span><strong>${l.best}</strong>れんぞく</span></div>
      <p class="finish-line">${esc(this.line(l.best))}</p><p class="auto-label">マップへもどるよ</p>`, "finish-main");
    this.sound("complete");
    this.lesson = null;
    this.autoReturn = setTimeout(() => surprise ? this.surprise() : this.navigate("home"), surprise ? 800 : 2300);
  }
  surprise() {
    this.route = "surprise";
    this.shell("あ、何か見つけた。", `${image("fx-3", "surprise-chest")}<p>たからばこに、きらきらの音！</p>`, "center-stage");
    this.sound("success");
    this.autoReturn = setTimeout(() => this.navigate("home"), 1200);
  }

  bossSetup(ch) {
    this.bossCh = Math.max(0, Math.min(7, ch));
    this.battle = null;
    const world = WORLDS[this.bossCh];
    const choices = [RULES[this.bossCh % RULES.length], RULES[(this.bossCh + 2) % RULES.length], RULES[(this.bossCh + 4) % RULES.length]];
    this.rule = this.rule || choices[0];
    this.shell("先生とたいけつ", `<div class="boss-intro">${image(world.boss, "boss-intro-art")}<div><span class="eyebrow">BOSS ${this.bossCh + 1}</span><h2>${esc(this.a.bossNames[this.bossCh] || world.title)}</h2><p>きみと${esc(this.a.buddy)}で、いくぞ。</p></div></div>
      <div class="boss-rules"><h3>ルールは、きみが決める。</h3><div class="rule-choices">${choices.map(rule => B(esc(rule), "rule:" + rule, this.rule === rule ? "selected" : "", `aria-pressed="${this.rule === rule}"`)).join("")}</div>
        <label class="custom-rule-label">自分のルール<input id="custom-rule" maxlength="60" placeholder="こんなルールはどう？" value="${esc(this.customRule || "")}"></label>
        ${B("たいけつする", "battle-start", "big-button")}
        <p class="boss-fineprint">3回ずつ。2点さまでは引き分け。<br>時間切れは先生の勝ち。</p></div>`, "boss-setup");
  }
  startBattle() {
    this.practice?.stop();
    this.battle = { child: 0, teacher: 0, turn: "child", round: 0, childMiss: 0, teacherMiss: 0,
      until: Date.now() + 90000, maskUntil: 0, used: { child: false, teacher: false }, attempts: { child: 0, teacher: 0 }, active: true };
    this.battleDrill = this.catalog.drills.filter(d => d.ch === this.bossCh).at(-1);
    this.battleEvents = this.battleDrill.positions[this.battleDrill.pos[0]].events[this.battleDrill.hands === "L" ? "L" : "R"].slice(0, 4);
    this.renderBattle();
  }
  renderBattle() {
    this.practice?.stop();
    const b = this.battle;
    const world = WORLDS[this.bossCh];
    const child = b.turn === "child";
    this.shell("先生とたいけつ", `<div class="battle-hud"><div><span>${esc(this.a.buddy)}ときみ</span><strong>${b.child}</strong><meter max="12" value="${Math.max(0, 12 - b.teacher)}" aria-label="きみの体力"></meter></div>
      <strong class="battle-time" role="timer">${Math.ceil((b.until - Date.now()) / 1000)}</strong><div><span>${esc(this.a.bossNames[this.bossCh] || world.title)}</span><strong>${b.teacher}</strong><meter max="12" value="${Math.max(0, 12 - b.child)}" aria-label="ボスの体力"></meter></div></div>
      <div class="battle-scene">${image(this.buddy(), "fighter buddy-fighter")}${image(world.boss, "fighter boss-fighter")}<span class="versus">VS</span><div class="hit-fx" hidden>${image("fx-1")}${image("fx-2")}</div></div>
      <div class="battle-controls"><p class="battle-turn">${child ? "きみのばん！" : "先生のばん。きみがしんぱん！"} <small>${Math.floor(b.round / 2) + 1}/3</small></p>
      <div class="battle-score" aria-label="たいけつの楽ふ"><img src="./data/drills/${this.battleDrill.positions[this.battleDrill.pos[0]].layouts[this.battleDrill.hands === "B" ? "B" : this.battleDrill.hands === "L" ? "L" : "R"].replace(".json", ".svg")}" alt="${words(this.battleDrill.title)}の楽ふ"><span class="score-mask" hidden>見えなくなった！</span></div>
      <div class="battle-judges">${child ? '<span class="teacher-label">先生がはんてい</span>' : ""}${B("○ ひけた", "battle-judge:yes", "big-button")}${B("× もう1回", "battle-judge:no", "light-button")}</div>
      ${B(child ? "先生：じゃまする" : "きみ：じゃまする", "interfere", "interfere", b.used[child ? "teacher" : "child"] ? 'disabled title="もうつかったよ"' : "")}<p class="battle-rule">${esc(this.customRule || this.rule)}</p><p class="battle-mic-status" role="status"></p></div>`, "battle-main");
    window.scrollTo(0, 0);
    this.paintBattleScore(b.round).catch(error => this.notify(error.message));
    if (child && this.a.input !== "teacher" && this.battleDrill.hands !== "B") this.battleListen();
  }
  async paintBattleScore(round) {
    const hand = this.battleDrill.hands === "L" ? "L" : "R";
    const layout = await this.layoutFor({ drillId: this.battleDrill.id, hand,
      type: this.battleDrill.hands === "B" ? "teacher" : "play" });
    if (this.route !== "boss" || this.battle?.round !== round) return;
    const svg = new DOMParser().parseFromString(layout.source, "image/svg+xml").documentElement;
    const notes = layout.notes.filter(n => this.battleEvents.some(e => n.m === e.m && Math.abs(n.t - (e.gt ?? e.t)) < .0001));
    const lastX = Math.max(...notes.map(n => n.x));
    const next = layout.notes.filter(n => n.x > lastX + .01);
    const right = next.length ? (Math.min(...next.map(n => n.x)) + lastX) / 2 : layout.viewBox[0] + layout.viewBox[2];
    const [, y, , h] = tightFrame(layout, notes, false);
    svg.setAttribute("viewBox", `${layout.viewBox[0]} ${y} ${right - layout.viewBox[0]} ${h}`);
    svg.setAttribute("width", right - layout.viewBox[0]);
    svg.setAttribute("height", h);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${childWords(this.battleDrill.title)}、はじめの4音`);
    const host = this.root.querySelector(".battle-score");
    const mask = host.querySelector(".score-mask");
    host.replaceChildren(svg, mask);
  }
  async battleListen() {
    const hand = this.battleDrill.hands === "L" ? "L" : "R";
    this.practice = new Practice({ drill: this.battleDrill,
      position: { events: { [hand]: this.battleEvents }, end: 2 },
      stage: { hand, metro: false }, piano: this.piano, input: "mic", bpm: 90,
      onStatus: (text, kind) => {
        const status = this.root.querySelector(".battle-mic-status");
        if (status) status.textContent = kind === "teacher" ? "先生の○×でも、いけるよ。" : kind === "wrong" ? "もう1回、音をさがそう。" : "ピアノの音を聞いているよ。";
      },
      onProgress: index => {
        const score = this.root.querySelector(".battle-score");
        if (score) score.dataset.index = index;
        if (index) this.sound("note");
      },
      onEnd: () => this.battleJudge(true)
    });
    await this.practice.start();
  }
  battleJudge(ok) {
    const b = this.battle;
    if (!b?.active || this.busy) return;
    if (Date.now() >= b.until) return this.endBattle(true);
    this.practice?.stop();
    const turn = b.turn;
    if (!ok) {
      b[turn + "Miss"]++;
      this.sound("wrong");
      if ((this.customRule || this.rule) === "ミス5回でまけ" && b[turn + "Miss"] >= 5) {
        b[turn === "child" ? "teacher" : "child"] = 12;
        b[turn] = 0;
        return this.endBattle(false);
      }
      if ((this.customRule || this.rule) === "ミス5回でまけ") {
        this.notify(`ミス ${b[turn + "Miss"]} / 5。もう1回いこう。`);
        this.renderBattle();
        return;
      }
      if ((this.customRule || this.rule) === "1回だけやり直し" && b.attempts[turn]++ === 0) {
        this.notify("もう1回、いけるよ。");
        this.renderBattle();
        return;
      }
    } else {
      b[turn] += 4;
      this.sound("hit");
      const target = this.root.querySelector(turn === "child" ? ".boss-fighter" : ".buddy-fighter");
      target?.classList.add("wiggle");
      this.root.querySelector(".hit-fx").hidden = false;
      if (turn === "child") target.src = `./art/${WORLDS[this.bossCh].hurt}.webp`;
    }
    if ((this.customRule || this.rule) === "速いほうが勝ち" && ok) b[turn] += Math.max(0, 2 - Math.floor((Date.now() - (b.turnStart || b.until - 90000)) / 10000));
    b.round++;
    b.turn = turn === "child" ? "teacher" : "child";
    b.maskUntil = 0;
    this.busy = true;
    this.transition = setTimeout(() => {
      this.busy = false;
      if (!b.active) return;
      if (b.round >= 6) this.endBattle(false);
      else { b.turnStart = Date.now(); this.renderBattle(); }
    }, 550);
  }
  endBattle(timedOut) {
    const b = this.battle;
    if (!b?.active) return;
    b.active = false;
    this.practice?.stop();
    clearTimeout(this.transition);
    this.busy = false;
    const result = battleResult(b.child, b.teacher, timedOut);
    this.route = "boss-result";
    if (result === "win") {
      this.a.bosses[this.bossCh] = true;
      this.a.sessionEnded = true;
      this.a.xp += 30;
      this.a.resume = null;
      this.store.state.lessonStart = null;
      this.save();
    }
    this.shell(result === "win" ? "やった！ 今日はおしまい。" : result === "draw" ? "引き分け！" : "今日は先生の勝ち。",
      `${image(result === "win" ? this.buddy() : WORLDS[this.bossCh].boss, "result-buddy")}
       <p class="result-score">${b.child} : ${b.teacher}</p><p>${result === "win" ? `あれ？ ${esc(this.a.buddy)}のすがたが…！` : timedOut ? "時間切れ。またいっしょに、いこう。" : result === "draw" ? "もう1回、いく？" : "いっしょに、またやろう。"}</p>
       ${result === "draw" ? B("もう1回たいけつ", "battle-start", "big-button") : ""}${B(result === "win" ? "マップへ" : "今日はおしまい", "battle-finish", "light-button")}`, "center-stage");
    if (result === "win") this.sound("complete");
    if (result !== "draw") {
      this.a.sessionEnded = true;
      this.store.state.lessonStart = null;
      this.save();
      this.autoReturn = setTimeout(() => this.navigate("home"), 2600);
    }
  }
  rest(resume) {
    this.practice?.stop();
    this.resumeRest = resume;
    this.route = "rest";
    if (!(this.a.restUntil > Date.now())) {
      this.a.breaks++;
      this.a.restUntil = Date.now() + 30000;
      this.save();
    }
    this.shell("きゅうけい", `${image("journey-1", "sleeping-buddy")}<p>手も、耳も、ひとやすみ。</p><strong class="rest-seconds" role="timer">${Math.ceil((this.a.restUntil - Date.now()) / 1000)}</strong>
      <p>何もしなくていいよ。</p><details class="rest-teacher"><summary>先生のボタン</summary>${B("きゅうけいをとばす", "rest-skip", "small-button")}</details>`, "center-stage rest-main");
    this.sound("note");
  }
  clock() {
    if (this.route === "rest") {
      const left = Math.max(0, Math.ceil((this.a.restUntil - Date.now()) / 1000));
      const timer = this.root.querySelector(".rest-seconds");
      if (timer) timer.textContent = left;
      if (!left) {
        this.a.restUntil = 0;
        this.save();
        this.route = "lesson";
        this.resumeRest?.();
      }
    }
    const b = this.battle;
    if (this.route !== "boss" || !b?.active) return;
    const left = Math.max(0, Math.ceil((b.until - Date.now()) / 1000));
    const el = this.root.querySelector(".battle-time");
    if (el) el.textContent = left;
    if (!left) this.endBattle(true);
    const mask = this.root.querySelector(".score-mask");
    if (mask) mask.hidden = b.maskUntil <= Date.now();
  }

  create() {
    this.composing = this.composing || [];
    this.shell("きみの8音", `${this.say("こんどは、きみが先生。", "journey-2")}
      <div class="compose-slots" aria-label="作っている8音">${Array.from({ length: 8 }, (_, i) => `<span class="${this.composing[i] ? "filled" : ""}">${this.composing[i] ? noteName(this.composing[i]) : "·"}</span>`).join("")}</div>
      ${this.keys("compose-key", 60)}<p class="compose-status" role="status">${this.composing.length === 8 ? "8音できた！ 聞いてみよう。" : `あと${8 - this.composing.length}音、おいてね。`}</p>
      <div class="compose-tools compose-play-tools">${B("1音もどす", "compose-undo", "small-button", this.composing.length ? "" : "disabled")}${B("聞いてみる", "compose-play", "big-button", this.composing.length ? "" : "disabled")}</div>
      <label class="composition-name">きょくの名前<input id="composition-name" maxlength="40" value="${esc(this.compositionName || "")}" placeholder="ぼくのメロディー"></label>
      <div class="compose-tools compose-save-tools">${B("ほぞんする", "compose-save", "big-button", this.composing.length === 8 ? "" : "disabled")}${B("先生に出す", "compose-challenge", "light-button", this.composing.length === 8 ? "" : "disabled")}</div>
      <div id="compose-judge" role="status"></div>`, "create-main");
  }
  playComposition(notes) {
    this.piano.unlock().then(() => notes.forEach((n, i) => this.piano.note(n, this.piano.context.currentTime + i * .32, .25))).catch(() => this.notify("もう1回「聞いてみる」をおしてね。"));
    this.root.querySelector(".buddy-portrait")?.classList.add("bouncing");
    clearTimeout(this.compositionAnimation);
    this.compositionAnimation = setTimeout(() => this.root.querySelector(".buddy-portrait")?.classList.remove("bouncing"), notes.length * 320);
  }
  collection() {
    const bosses = Object.keys(this.a.bosses).map(Number).filter(n => n >= 0 && n < 8);
    this.shell("見つけたもの", `<div class="collection-buddy">${this.say("きみだけの、たからもの。")}</div>
      <h2>なかまになったボス</h2>${bosses.length ? `<div class="boss-collection">${bosses.map(ch => `<label>${image(WORLDS[ch].boss)}名前をかえる<input data-boss-name="${ch}" maxlength="24" value="${esc(this.a.bossNames[ch] || WORLDS[ch].title)}"></label>`).join("")}</div>` : `<div class="empty-illustration">${image("boss-tanuki-1")}<p>先生とたいけつすると、ここに。</p></div>`}
      <h2>見つけたこと</h2>${this.a.discoveries.length ? `<ul class="discovery-list">${this.a.discoveries.map(x => `<li><span class="discovery-star">✦</span><span>${esc(x.text)}</span></li>`).join("")}</ul>` : "<p>気づいたことがあったら、先生に話してね。</p>"}
      <h2>きみのきょく</h2>${this.a.compositions.length ? this.a.compositions.map((x, i) => B(`<strong>${esc(x.name)}</strong><span>${x.notes.map(noteName).join(" ")}</span>`, "saved-song:" + i, "saved-composition")).join("") : B("はじめの8音をつくる", "nav:create", "big-button")}`, "collection-main");
  }
  found() {
    this.shell("見つけた！", `${this.say("何に気づいたの？")}
      <label class="found-label">先生：見つけたことを一言で<textarea id="discovery-text" maxlength="100" rows="3" placeholder="たとえば、左手も同じ形だった">${esc(this.discoveryText || "")}</textarea></label>
      <p id="discovery-error" role="alert"></p>${B("見つけたことをのこす", "found-save", "big-button")}`, "found-main", "settings");
  }
  input(el) {
    if (el.id === "first-name") { this.store.state.name = el.value.slice(0, 40); this.save(); }
    if (el.id === "custom-rule") this.customRule = el.value.slice(0, 60);
    if (el.id === "composition-name") this.compositionName = el.value.slice(0, 40);
    if (el.id === "discovery-text") this.discoveryText = el.value.slice(0, 100);
    if (el.dataset.bossName !== undefined) { this.a.bossNames[el.dataset.bossName] = el.value.slice(0, 24); this.save(); }
    if (el.id === "buddy-name") { this.a.buddy = el.value.slice(0, 20) || "ポチ"; this.save(); }
  }

  async act(action, el) {
    const [kind, ...parts] = action.split(":");
    const value = parts.join(":");
    if (kind === "score-page") {
      this.scorePage = Math.max(0, (this.scorePage || 0) + Number(value));
      return this.paintScore(this.noteIndex);
    }
    if (kind === "nav") return this.navigate(value);
    if (kind === "step") return this.ticket(value);
    if (kind === "start") return this.navigate("lesson/" + value);
    if (kind === "retry-question") return this.renderQuestion();
    if (kind === "boss-door") {
      const drills = this.catalog.drills.filter(d => d.ch === Number(value));
      if (!drills.every(d => this.a.completed[d.id])) return this.notify("道の音をひくと、たいけつできるよ。");
      this.rule = null;
      return this.navigate("boss/" + value);
    }
    if (kind === "chest") { this.sound("success"); return this.notify("中で、音がした。"); }
    if (kind === "branch" || kind === "rhythm-branch") {
      this.a.branch = kind === "rhythm-branch" ? "rhythm" : "notes";
      this.save();
      const next = this.catalog.drills.filter(d => d.ch === Number(value));
      const d = next[kind === "rhythm-branch" && next.length > 1 ? 1 : 0];
      return this.navigate("lesson/" + d.id);
    }
    if (kind === "fallback") { this.a.input = "teacher"; this.save(); return this.teacherFallback(); }
    if (kind === "input") { this.a.input = value; this.save(); return this.renderQuestion(true); }
    if (kind === "model") return this.q().type === "listen" ? this.listenPair() : this.q().type === "rhythm" ? this.startRhythm() : this.model();
    if (kind === "repeat") return this.renderQuestion(true);
    if (kind === "hint") {
      const q = this.q();
      const target = q.events[this.noteIndex]?.m || q.events[0].m;
      this.setStatus(q.type === "finger" ? `ヒント：${q.events[0].f || 1}ばん。` : `ヒント：「${noteName(target)}」だよ。`);
      this.root.querySelector(`[data-midi="${target}"]`)?.classList.add("key-hint");
      this.piano.note(target);
      return;
    }
    if (kind === "key") {
      if (this.busy) return;
      const midi = Number(value);
      this.piano.note(midi);
      if (this.q().type === "note") return midi === this.q().events[0].m ? this.correct() : this.wrong();
      this.practice?.hear(midi);
      return;
    }
    if (kind === "answer") {
      if (this.busy) return;
      const q = this.q();
      const correct = q.type === "finger" ? Number(value) === (q.events[0].f || 1) : value === q.answer;
      return correct ? this.correct() : this.wrong();
    }
    if (kind === "tap") return this.tap();
    if (kind === "judge") return value === "yes" ? this.correct() : this.wrong("もう1回、先生とひこう。");
    if (kind === "rule") { this.rule = value; this.customRule = ""; this.bossSetup(this.bossCh); return; }
    if (kind === "battle-start") { this.route = "boss"; return this.startBattle(); }
    if (kind === "battle-judge") return this.battleJudge(value === "yes");
    if (kind === "interfere") {
      const b = this.battle;
      const user = b.turn === "child" ? "teacher" : "child";
      if (b.used[user]) return;
      b.used[user] = true;
      b.maskUntil = Date.now() + 3000;
      clearTimeout(this.maskTimer);
      this.maskTimer = setTimeout(() => this.clock(), 3000);
      el.disabled = true;
      this.clock();
      this.sound("hit");
      return;
    }
    if (kind === "battle-finish") {
      this.a.sessionEnded = true;
      this.store.state.lessonStart = null;
      this.save();
      return this.navigate("home");
    }
    if (kind === "rest-skip") { this.a.restUntil = Date.now(); return this.clock(); }
    if (kind === "compose-key") {
      this.piano.note(Number(value));
      if (this.composing.length >= 8) return this.notify("8音できてるよ。「1音もどす」でかえられるよ。");
      this.composing.push(Number(value));
      this.create();
      return;
    }
    if (kind === "compose-undo") { this.composing.pop(); this.create(); return; }
    if (kind === "compose-play") return this.playComposition(this.composing);
    if (kind === "compose-save") {
      if (this.composing.length !== 8) return;
      this.a.compositions.push({ name: this.compositionName?.trim() || "ぼくのメロディー", notes: [...this.composing], at: Date.now() });
      this.save();
      this.sound("success");
      this.notify("きみのきょくを、ずかんにのこしたよ。");
      return;
    }
    if (kind === "compose-challenge") {
      this.root.querySelector("#compose-judge").innerHTML = `<p>先生のばん。きみがしんぱん！</p>${B("○ ひけた", "compose-judge:yes", "big-button")}${B("× もう1回", "compose-judge:no", "light-button")}`;
      return;
    }
    if (kind === "compose-judge") {
      this.notify(value === "yes" ? "先生、やるじゃん。" : "もう1回、きみのきょくを聞こう。");
      if (value === "no") this.playComposition(this.composing);
      else this.root.querySelector("#compose-judge").innerHTML = "<p>✓ 先生もひけた！</p>";
      return;
    }
    if (kind === "saved-song") return this.playComposition(this.a.compositions[Number(value)].notes);
    if (kind === "found-save") {
      const text = this.discoveryText?.trim();
      if (!text) { this.root.querySelector("#discovery-error").textContent = "見つけたことを一言、書いてね。"; return; }
      this.a.discoveries.push({ text, at: Date.now() });
      this.discoveryText = "";
      this.save();
      this.shell("見つけた！", `${this.say(`${text}って見つけたの、すごい。`)}${image("fx-4", "discovery-sparkles")}`, "center-stage");
      this.sound("success");
      this.autoReturn = setTimeout(() => this.navigate("collection"), 2400);
    }
  }
}
