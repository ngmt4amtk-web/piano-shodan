import { COLORS, STAGES, COUNTS, DATA } from "./config.mjs";
import {
  Store,
  progress,
  complete,
  review,
  duePiece,
  learningOrder,
  pieceKey,
  validate,
} from "./state.mjs";
import { Piano, meterPlan } from "./audio.mjs";
import { DATA_VERSION } from "./version.mjs";
import { childWords } from "./child-text.mjs";
import { score } from "./score.mjs";
import { Games } from "./games.mjs";

const root = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
const store = new Store(),
  piano = new Piano(),
  songs = new Map();
let index = [],
  song,
  view = "home",
  k,
  stage = 0,
  speed = 0.5,
  easy = false,
  repeat = false,
  reviewing = false,
  backView = "home",
  models = [],
  segments = [],
  renderAbort,
  game,
  finished = false,
  range = [],
  rangeMode = false,
  mapRevealed = false,
  mapTimer,
  forcedUntil = 0,
  forceTick,
  rolling = false,
  navSerial = 0,
  forceRemaining = 0,
  forceLast = 0,
  offlineSongs = [];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const B = (label, a, cls = "", extra = "") =>
  `<button type="button" class="${cls}" data-act="${a}" ${extra}>${label}</button>`;
const pkey = () => pieceKey(song.no, k);
const setText = (el, text) => {
  if (el && el.textContent !== text) el.textContent = text;
};
const color = (i) =>
  i < 8
    ? COLORS[i]
    : `color-mix(in srgb, ${COLORS[i % 8]} ${i < 16 ? 72 : 48}%, #173c4e)`;
function tileInk(i) {
  const rgb = COLORS[i % 8]
      .slice(1)
      .match(/../g)
      .map((n) => parseInt(n, 16)),
    ratio = i < 8 ? 1 : i < 16 ? 0.72 : 0.48,
    dark = [23, 60, 78];
  const linear = rgb
      .map((n, j) => (n * ratio + dark[j] * (1 - ratio)) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)),
    luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? "#000" : "#fff";
}
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = view === "settings" ? message : childWords(message);
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2400);
}
function status() {
  return `<div class="statusline">
  <span class="dot" aria-hidden="true">
  </span>
  <span id="save-status">${saveLabel()}</span>
  <span id="audio-status">${audioLabel()}</span>
  <span id="offline-status">${offlineLabel()}</span>
  </div>`;
}
function saveLabel() {
  if (!store.ready) return "ノートをもどしています";
  if (!store.localOK && !store.remoteOK)
    return "まだのこせていません。先生、書き出してください。";
  if (!store.localOK) return "箱にのこしました。このスマホにはのこせません。";
  if (store.status === "saving") return "ノートを箱にも写しています";
  if (store.status === "saved") return "ノートを保存しました";
  if (store.status === "invalid")
    return "ノートが読めません。先生の部屋でたしかめてください。";
  return "このスマホにのこしています";
}
function saveWarning() {
  let banner = root.querySelector("#save-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "save-banner";
    banner.setAttribute("role", "status");
    root.prepend(banner);
  }
  const failed = !store.localOK && !store.remoteOK;
  banner.hidden = !failed;
  banner.innerHTML = failed
    ? `<span>まだノートをのこせていません。先生、書き出してください。</span>${B("書き出す", "export")}`
    : "";
}
function offlineLabel() {
  return offlineSongs.length
    ? `電ぱなしでひらけるきょく：${offlineSongs.filter((x) => x.ready).length} / 18`
    : "電ぱなしのようい中（ひらいた楽ふはのこるよ）";
}
function warm() {
  navigator.serviceWorker?.controller?.postMessage({
    type: "warm",
    no: store.state.currentSong,
  });
}
function audioLabel() {
  return piano.loaded < 29
    ? `音をよういしています ${piano.loaded} / 29`
    : piano.failed
      ? "とどかない音は、かわりの音で鳴るよ"
      : "音のよういができました";
}
function header(title, back = "home", extra = "") {
  return `<header class="topbar">${B("‹ もどる", `go-${back}`, "quiet")}<div class="heading">
  <div class="eyebrow">ピアノ初段</div>
  <h1 tabindex="-1">${esc(title)}</h1>
  </div>${extra}</header>`;
}
async function getSong(no) {
  if (!songs.has(no)) {
    const promise = fetch(new URL(`${String(no).padStart(2, "0")}.json`, DATA))
      .then((r) => {
        if (!r.ok) throw Error("曲が届きませんでした");
        return r.json();
      })
      .catch((e) => {
        songs.delete(no);
        throw e;
      });
    songs.set(no, promise);
  }
  return songs.get(no);
}
function cleanup() {
  if (forcedUntil && document.fullscreenElement)
    document.exitFullscreen?.().catch(() => {});
  piano.stop();
  renderAbort?.abort();
  game?.destroy();
  game = null;
  clearTimeout(mapTimer);
  clearInterval(forceTick);
  forcedUntil = 0;
  forceRemaining = 0;
  root.classList.remove("forced");
  dialog.close();
}
async function go(next, options = {}) {
  if (next === "home" || next === "gacha") {
    cleanup();
    view = "external";
    window.dispatchEvent(new CustomEvent("shodan-nav", { detail: next }));
    return;
  }
  document.body.dataset.screen = next;
  const serial = ++navSerial;
  cleanup();
  try {
    if (options.no && song?.no !== options.no) song = await getSong(options.no);
    if (serial !== navSerial) return;
    if (options.no) {
      store.state.currentSong = options.no;
      store.save();
    }
    view = next;
    reviewing = !!options.review;
    if (next === "piece") {
      k =
        options.k ||
        song.kakera.find(
          (x) =>
            x.id === store.state.lastPiece?.id &&
            song.no === store.state.lastPiece?.no,
        ) ||
        learningOrder(song)[0];
      backView = options.back || "home";
      const stars = progress(store.state, song.no, k).stars;
      stage = Math.max(
        0,
        stars.findIndex((v) => !v),
      );
      if (!k.notes.some((n) => n.hand === "R")) stage = 1;
      if (!k.notes.some((n) => n.hand === "L")) stage = 0;
      if (reviewing) stage = 3;
      speed = stage === 3 ? 0.75 : 0.5;
      easy = false;
      repeat = false;
      finished = false;
      segments = options.segments || [{ ...k }];
      store.state.lastPiece = { no: song.no, id: k.id };
      store.save();
    }
    if (next === "map") {
      range = [];
      rangeMode = !!options.rangeMode;
      mapRevealed = false;
    }
    render();
    window.scrollTo(0, 0);
    if (next !== "home")
      root.querySelector("h1")?.focus({ preventScroll: true });
  } catch (e) {
    if (serial !== navSerial) return;
    root.innerHTML =
      header("まだ届いていません") +
      `<main>
  <div class="error">
  <h2>曲をひらけませんでした</h2>
  <p>電波のあるところで、もう一度ひらいてください。</p>${B("もう一度ひらく", "retry", "primary")}</div>
  </main>`;
  }
}
function render() {
  renderAbort?.abort();
  renderAbort = new AbortController();
  models = [];
  if (view === "home") renderHome();
  if (view === "map") renderMap();
  if (view === "piece") renderPiece();
  if (view === "new") renderNew();
  if (view === "play") {
    root.innerHTML = header("あそび") + '<main id="game-host"></main>';
    game = new Games({
      host: root.querySelector("#game-host"),
      piano,
      store,
      index,
      getSong,
      toast,
    });
    game.mount();
  }
  if (view === "settings") renderSettings();
  saveWarning();
}
function miniMap() {
  return `<div class="mini-tiles" aria-label="曲の進み具合">${song.barKakera
    .map((i) => {
      const p = progress(store.state, song.no, song.kakera[i]),
        n = p.stars.filter(Boolean).length;
      return `<span class="mini-tile" style="${n ? `background:${color(i)};opacity:${p.stars.every(Boolean) ? 1 : 0.45}` : ""};${p.box >= 4 ? "outline:2px solid #b78620" : ""}">
  </span>`;
    })
    .join("")}</div>`;
}
function renderHome() {
  window.dispatchEvent(new CustomEvent("shodan-nav", { detail: "home" }));
}
function clockLabel() {
  const seconds = store.state.lessonStart
    ? Math.max(
        0,
        1800 - Math.floor((Date.now() - store.state.lessonStart) / 1000),
      )
    : 1800;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function shape(i) {
  return ["●", "▲", "■", "◆", "✦"][Math.floor(i / 8) % 5];
}
function tile(i, bar) {
  const p = progress(store.state, song.no, song.kakera[i]),
    n = p.stars.filter(Boolean).length;
  return B(
    `${shape(i)}<span class="tile-star">${p.box >= 4 ? "◆" : p.stars.every(Boolean) ? "★" : n ? "·" : ""}</span>`,
    `tile-${bar}`,
    `tile progress-${n} ${mapRevealed ? "identified" : ""} ${p.stars.every(Boolean) ? "independent" : ""} ${p.box >= 4 ? "settled" : ""} ${range.includes(bar) ? "range-selected" : ""}`,
    `style="--tile:${color(i)};--tile-ink:${tileInk(i)};--i:${bar}" data-kakera="${i}" data-color="${i}" aria-label="${bar + 1}番目の場所、かけら${i + 1}、星${n}こ" aria-pressed="${range.includes(bar)}"`,
  );
}
function renderMap() {
  root.innerHTML =
    header(song.ja, "home", B("曲をかえる", "choose-song", "quiet")) +
    `<main>
  <div class="map-head">
  <div>
  <div class="tag">曲の地図</div>
  <h2 id="shrink-summary" class="map-summary">${mapRevealed ? `${song.bars.length}小節 → ${song.kakera.length}かけら` : `${song.bars.length}小節。ひみつを見つけよう。`}</h2>
  <p class="muted" id="shrink-hint">${mapRevealed ? `弾くのは${song.kakera.length}こだけ。` : "同じ形が、かくれているよ。"}</p>
  </div>${B('<span class="lens tiny" aria-hidden="true"></span> ちぢめがねを使う', "shrink", "gold")}</div>
  <div class="map-board ${mapRevealed ? "identified folded" : ""}" aria-label="ひくじゅんばんのタイル">${mapRevealed ? song.kakera.map((piece, i) => tile(i, piece.bars[0])).join("") : song.barKakera.map((i, b) => tile(i, b)).join("")}</div>
  <div class="map-key">
  <span>灰：まだ</span>
  <span>うすい色：とちゅう</span>
  <span>こい色：ひとりで</span>
  <span>金のわく：覚えた</span>
  </div>
  <div class="notice" id="range-note">${range.length ? `かけら${song.barKakera[range[0]] + 1}をえらんだよ。` : rangeMode ? "はじめと、おわりをえらんでね。" : "タイルを押すと、かけらがひらくよ。"}</div>
  <div id="range-actions" class="flex">${rangeMode ? B(range.length === 2 ? "この間をつなげて弾く" : "えらんだかけらをひらく", "open-range", "primary", range.length ? "" : "disabled") : B("2つえらんでつなげる", "range-mode", "primary")}${B("さいしょから最後まで", "connect-all")}${range.length ? B("えらび直す", "clear-range", "quiet") : ""}</div>
  <hr class="rule">
  <h2 style="margin-bottom:12px">かけらをえらんで弾く</h2>
  <div class="piece-list">${learningOrder(song)
    .map((x) => {
      const p = progress(store.state, song.no, x);
      return B(
        `<span>
  <span class="piece-symbol" style="--tile:${color(song.kakera.indexOf(x))}">${shape(song.kakera.indexOf(x))}</span> <small>×${x.occurrences.length}</small>
  </span>
  <span class="star-text" aria-label="星${p.stars.filter(Boolean).length}こ">${p.stars.map((s) => (s ? "★" : "☆")).join("")}</span>`,
        `piece-${x.id}`,
        "piece-choice",
      );
    })
    .join("")}</div>
  </main>`;
  if (!store.state.seenMaps.includes(song.no))
    mapTimer = setTimeout(shrink, 350);
}
async function shrink() {
  if (view !== "map" || shrink.busy) return;
  clearTimeout(mapTimer);
  const board = root.querySelector(".map-board");
  if (mapRevealed) {
    mapRevealed = false;
    renderMap();
    return;
  }
  shrink.busy = true;
  mapRevealed = true;
  if (!store.state.seenMaps.includes(song.no)) {
    store.state.seenMaps.push(song.no);
    store.save();
  }
  const tiles = [...board.querySelectorAll(".tile")],
    positions = tiles.map((t) => t.getBoundingClientRect());
  tiles.forEach((t) => t.classList.add("identified"));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) {
    board.classList.add("coloring");
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  if (view !== "map" || !board.isConnected) {
    shrink.busy = false;
    return;
  }
  // Measure the actual final pile positions. Each original tile flies into
  // its own shape's pile, including all repeated occurrences at once.
  const oldHeight = board.offsetHeight;
  board.classList.add("folded");
  board.innerHTML = song.kakera
    .map((piece, i) => tile(i, piece.bars[0]))
    .join("");
  board
    .querySelectorAll(".tile")
    .forEach((t) => t.classList.add("identified", "pile"));
  const targets = [...board.children].map((t) => t.getBoundingClientRect());
  if (!reduced) {
    board.style.minHeight = oldHeight + "px";
    const layer = document.createElement("div");
    layer.className = "fold-layer";
    document.body.append(layer);
    const animations = tiles.map((tile, i) => {
      const source = positions[i],
        destination = targets[+tile.dataset.kakera];
      const clone = tile.cloneNode(true);
      clone.removeAttribute("data-act");
      clone.setAttribute("aria-hidden", "true");
      Object.assign(clone.style, {
        position: "fixed",
        left: source.left + "px",
        top: source.top + "px",
        width: source.width + "px",
        height: source.height + "px",
        margin: 0,
      });
      layer.append(clone);
      return clone
        .animate(
          [
            { transform: "translate(0,0)", opacity: 1 },
            {
              transform: `translate(${destination.left - source.left}px,${destination.top - source.top}px)`,
              opacity: 1,
            },
          ],
          {
            duration: 850,
            easing: "cubic-bezier(.4,0,.2,1)",
            fill: "forwards",
          },
        )
        .finished.catch(() => {});
    });
    await Promise.all(animations);
    layer.remove();
    board.style.minHeight = "";
  }
  if (board.isConnected) {
    root.querySelector("#shrink-summary").textContent =
      `${song.bars.length}小節 → ${song.kakera.length}かけら`;
    root.querySelector("#shrink-hint").textContent =
      `ひくのは${song.kakera.length}こだけ。もう一度で、ひくじゅんにひらくよ。`;
    root
      .querySelector('[data-act="shrink"]')
      .setAttribute("aria-pressed", "true");
  }
  shrink.busy = false;
}
function renderNew() {
  const choices = learningOrder(song)
    .filter((x) => !progress(store.state, song.no, x).stars.every(Boolean))
    .slice(0, 3);
  root.innerHTML =
    header("新しいかけら") +
    `<main>
  <div class="page-intro">
  <div class="tag">${esc(song.ja)}</div>
  <h2>${choices.length ? "同じ形が多いところから。" : "この曲の星が、全部そろった。"}</h2>
  <p class="muted">${choices.length ? "カードをえらぶ？ ルーレットにまかせる？" : "地図でつなげて弾いてみよう。"}</p>
  </div>
  <div class="candidate-grid">${choices
    .map((x, i) =>
      B(
        `<span class="color-dot" style="--tile:${color(song.kakera.indexOf(x))}">
  </span>
  <strong style="color:${color(song.kakera.indexOf(x))}">${shape(song.kakera.indexOf(x))}</strong>
  <span>${x.occurrences.length}回、出てくる</span>
  <span class="star-text">${progress(store.state, song.no, x)
    .stars.map((s) => (s ? "★" : "☆"))
    .join("")}</span>`,
        `candidate-${x.id}`,
        "candidate",
        `style="--tile:${color(song.kakera.indexOf(x))}" data-candidate="${i}"`,
      ),
    )
    .join("")}</div>
  <div style="margin-top:20px">${choices.length ? B("ルーレットでえらぶ", "roulette", "gold") : B("地図をひらく", "go-map", "primary")}</div>
  </main>`;
}
function stageButtons() {
  const p = progress(store.state, song.no, k);
  return STAGES.map((label, i) => {
    const empty =
      i < 2 &&
      !segments.some((seg) =>
        song.kakera
          .find((x) => x.id === seg.id)
          .notes.some((n) => n.hand === (i === 0 ? "R" : "L")),
      );
    return B(
      `<span class="star">${p.stars[i] ? "★" : "☆"}</span>${label}${empty ? "<small>音なし・できた</small>" : ""}`,
      `stage-${i}`,
      `stage ${i === stage ? "chosen" : ""}`,
      `aria-pressed="${i === stage}" ${empty ? "disabled" : ""}`,
    );
  }).join("");
}
function renderPiece() {
  renderAbort?.abort();
  renderAbort = new AbortController();
  models = [];
  const connected = segments.length > 1,
    partial = segments.some((seg) => !wholePiece(seg));
  const meter = meterPlan(song, store.state.count);
  const strip = `<div class="occurrence-strip" aria-label="同じ形のあるところ">${song.barKakera
    .map(
      (
        i,
      ) => `<span style="--tile:${color(i)}" class="${song.kakera[i].id === k.id ? "here" : ""}">
  </span>`,
    )
    .join("")}</div>`;
  root.innerHTML =
    header(
      `${song.ja}${connected ? " · つなげてひく" : ""}`,
      backView,
      `${strip}<label class="volume">音量<input id="volume" type="range" min="0" max="1" step="0.01" value="${store.state.volume}" aria-label="音量">
  </label>${forcedUntil ? '<strong id="force-seconds" class="forced-timer">' + Math.ceil(forceRemaining / 1000) + "</strong>" : B("先生のメニュー", "piece-menu", "quiet")}`,
    ) +
    `
  <main class="practice">
   <div class="practice-grid">
    <div class="score-column">
     <div class="practice-options">
      <div class="stage-buttons">${stageButtons()}</div>
      <div class="speed-row" aria-label="速さ">${[
        [0.5, "かめ"],
        [0.75, "うさぎ"],
        [1, "チーター"],
      ]
        .map(([n, label]) =>
          B(
            `${label}<small>${n * 100}%</small>`,
            `speed-${n}`,
            speed === n ? "selected" : "",
            `aria-pressed="${speed === n}"`,
          ),
        )
        .join("")}</div>
      ${
        meter.selectable
          ? `<label class="count-control">カウント<select id="count-pattern">${COUNTS.map((c) => `<option value="${c}" ${(store.state.count ?? meter.defaultCount) === c ? "selected" : ""}>${c}</option>`).join("")}</select>
  </label>`
          : '<span class="count-control">カウント 1 2 3</span>'
      }
      <label class="control-options">
  <input type="checkbox" id="easy" ${easy ? "checked" : ""} ${!segments.some((seg) => song.kakera.find((x) => x.id === seg.id).svgEasy) ? "disabled" : ""}>左手かんたん</label>
     </div>
     <div class="score-scroll" id="score-scroll">${segments
       .map(
         (
           seg,
           i,
         ) => `<div class="score-segment" id="score-${i}" data-segment="${i}">${wholePiece(seg) ? "" : '<span class="partial-label">色の音ぷだけひこう</span>'}<p class="score-loading" role="status">楽ふをひらいています…</p>
  </div>`,
       )
       .join("")}</div>
    </div>
    <aside class="practice-controls" aria-label="ひき方とさいせい">
     <div id="play-status" class="play-status" role="status">${finished ? "先生、できたかな？" : reviewing ? "前の音、おぼえているかな？" : stage === 0 ? "右手をひこう。左はアプリ。" : stage === 1 ? "左手をひこう。右はアプリ。" : "りょう手でひこう。アプリはリズムだけ。"}</div>
     <div id="action-slot" class="action-slot">
  </div>
     <div class="secondary-tools">${B("おてほんをきく", "model")}${B(repeat ? "くり返し：入" : "くり返し：切", "repeat", "", `aria-pressed="${repeat}"`)}</div>
     <small class="practice-hint">${partial ? "一ぶだけなので星はつかないよ。" : reviewing ? "さいごは先生がえらんでね。" : "ひいたら、先生が星をつけるよ。"}</small>
    </aside>
   </div>
  </main>`;
  updateActions();
  saveWarning();
  const signal = renderAbort.signal;
  segments.forEach(async (seg, i) => {
    const representative = song.kakera.find((x) => x.id === seg.id) || k;
    try {
      const model = await score(
        root.querySelector(`#score-${i}`),
        song,
        representative,
        { stage, easy, store, onFinger: openFinger, signal, segment: seg },
      );
      if (!signal.aborted && model) models[i] = model;
    } catch (error) {
      if (signal.aborted) return;
      const container = root.querySelector(`#score-${i}`);
      if (container)
        container.innerHTML = `<div class="error">
  <p>楽ふがとどきません。電ぱをたしかめてね。</p>${B("もう一度ひらく", "reload-score")}</div>`;
    }
  });
}
function wholePiece(seg) {
  const piece = song.kakera.find((x) => x.id === seg.id);
  return (
    Math.abs((seg.representativeStart ?? piece.start) - piece.start) < 1e-7 &&
    Math.abs(seg.end - seg.start - (piece.end - piece.start)) < 1e-7
  );
}
function updateActions() {
  const slot = root.querySelector("#action-slot");
  if (!slot) return;
  const controls = root.querySelector(".practice-controls");
  controls.classList.toggle("is-playing", piano.playing);
  if (piano.playing) {
    slot.innerHTML = B(
      "止める",
      "stop-play",
      "primary play-button",
      'id="main-play"',
    );
    return;
  }
  if (finished && reviewing) {
    slot.innerHTML = `<section class="review-panel">
  <h2>前の音、どうだった？</h2>${B("おぼえてた", "review-remember", "gold")}${B("あと少し", "review-almost")}${B("わすれた", "review-forgot")}</section>`;
  } else if (finished) {
    const canAward = segments.every(wholePiece);
    slot.innerHTML = `<div class="feedback" id="feedback">${B("できた ★", "award", "gold", canAward ? "" : "disabled")}${B("もう1回", "again")}</div>`;
  } else {
    slot.innerHTML = B(
      "カウントしてひく",
      "start-play",
      "primary play-button",
      'id="main-play"',
    );
  }
}
async function play(model = false) {
  if (models.filter(Boolean).length !== segments.length) {
    toast("楽ふをひらいています。少し待ってね。");
    return;
  }
  finished = false;
  try {
    const started = await piano.play(song, segments, {
      stage,
      speed,
      easy,
      count: store.state.count,
      model,
      loop: repeat || !!forcedUntil,
      onFrame: (frame) => {
        if (!["piece", "play"].includes(view)) return;
        const label = root.querySelector("#play-status");
        if (!label) return;
        if (frame.stopped) {
          models.forEach((m) => m?.mark(null));
          label.classList.remove("count-number");
          label.textContent = "止まりました";
          updateActions();
          return;
        }
        if (frame.count) {
          setText(label, frame.count);
          label.classList.add("count-number");
          models.forEach((m, i) =>
            m?.mark(
              frame.pickup && i === frame.segment
                ? frame.t -
                    segments[i].start +
                    (segments[i].representativeStart ?? m.k.start)
                : null,
            ),
          );
        } else {
          label.classList.remove("count-number");
          setText(label, model ? "おてほんをきいてね。" : "いっしょにひこう。");
          models.forEach((m, i) =>
            m?.mark(
              i === frame.segment
                ? frame.t -
                    segments[i].start +
                    (segments[i].representativeStart ?? m.k.start)
                : null,
            ),
          );
          root.querySelectorAll(".score-segment").forEach((el, i) => {
            const active = i === frame.segment;
            if (
              active &&
              !el.classList.contains("current-segment") &&
              segments.length > 1
            )
              root.querySelector("#score-scroll").scrollTo({
                top: el.offsetTop,
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
              });
            el.classList.toggle("current-segment", active);
          });
        }
      },
      onEnd: () => {
        if (!["piece", "play"].includes(view)) return;
        finished = !model;
        root.querySelector("#play-status").textContent = model
          ? "今度はひいてみよう。"
          : "先生、できたかな？";
        updateActions();
      },
    });
    if (started) {
      updateActions();
      if (forcedUntil) forceLast = performance.now();
    }
  } catch (error) {
    piano.stop();
    toast(error.message);
    updateActions();
  }
}
function openFinger({ song: s, k: piece, index, draw }) {
  piano.stop();
  dialog.innerHTML = `<h2>音ぷのすぐ上に指番号</h2>
  <p class="muted">かけら ${piece.id.slice(1)} · 音ぷ ${typeof index === "number" ? index + 1 : index}</p>
  <div class="flex">${[1, 2, 3, 4, 5].map((n) => B(String(n), `finger-${n}`)).join("")}${B("消す", "finger-0")}</div>
  <div class="flex">${B("とじる", "close-dialog", "quiet")}</div>`;
  openFinger.target = { s, piece, index, draw };
  dialog.showModal();
}
function teacherMenu() {
  dialog.innerHTML = `<h2>先生のメニュー</h2>
  <div class="stack">${B("指番号をえらんで足す", "finger-select")}${B("今の星を1つもどす", "undo-star")}${B("地図をひらく", "go-map")}${B("とじる", "close-dialog", "quiet")}</div>`;
  dialog.showModal();
}
function forecast() {
  const sessions = new Map();
  for (const h of store.state.history)
    if (h.action === "star") {
      const date = new Date(h.at).toLocaleDateString("sv-SE");
      if (!sessions.has(date)) sessions.set(date, new Set());
      sessions.get(date).add(`${h.no}:${h.id}`);
    }
  const mean =
    sessions.size >= 3
      ? [...sessions.values()].reduce((n, s) => n + s.size, 0) / sessions.size
      : 2;
  let cumulative = 0;
  return `<p class="muted">${sessions.size < 3 ? "3回未満なので、仮に1回2かけらで計算。" : `実績：1回あたり${mean.toFixed(1)}かけら。`}毎週1回の目安です。定着の復習は別に行います。</p>${store.state.order
    .map((no) => {
      const entry = index.find((s) => s.no === no),
        done = Object.entries(store.state.progress).filter(
          ([key, p]) => key.startsWith(no + ":") && p.stars.every(Boolean),
        ).length,
        remaining = Math.max(0, entry.kakera - done);
      cumulative += remaining;
      const lessons = Math.ceil(cumulative / mean),
        date = new Date(Date.now() + lessons * 7 * 86400000);
      return `<div class="forecast-row">
  <span>${esc(entry.ja)}</span>
  <span>${remaining === 0 ? "星がそろいました" : `${lessons}回め · ${date.getFullYear()}年${date.getMonth() + 1}月ごろ`}</span>
  </div>`;
    })
    .join("")}`;
}
function renderSettings() {
  root.innerHTML =
    header("先生の部屋") +
    `<main class="settings">${store.state.dataVersion !== DATA_VERSION ? '<div class="notice" role="status">楽譜データの版が記録と違います。星・指番号を確認してください。旧記録は自動で移し替えていません。</div>' : ""}<p class="muted">変更はこの端末に保存します。書き出して別の端末へ移せます。</p>
  <section>
  <h2>生徒の呼び名</h2>
  <label>呼び名<input id="student-name" type="text" maxlength="40" value="${esc(store.state.name)}" autocomplete="off">
  </label>
  </section>
  <section>
  <h2>音とカウント</h2>
  <div class="flex">
  <label>カウントの既定<select id="default-count"><option value="" ${store.state.count === null ? "selected" : ""}>拍子に合わせる</option>${COUNTS.map((c) => `<option ${store.state.count === c ? "selected" : ""}>${c}</option>`).join("")}</select>
  </label>
  <label>音量<input id="volume" type="range" min="0" max="1" step="0.01" value="${store.state.volume}">
  </label>
  </div>
  </section>
  <section>
  <h2>曲の順番</h2>
  <p class="muted">矢印で1曲ずつ動かせます。曲名を押すと、その曲の地図を開きます。</p>
  <div class="order-list">${store.state.order
    .map(
      (no, i) => `<div class="order-row">
  <span class="muted">${i + 1}</span>${B(esc(index.find((s) => s.no === no).ja), `song-${no}`, "quiet")}${B("↑", `order-up-${i}`, "", `aria-label="${esc(index.find((s) => s.no === no).ja)}を前へ" ${i === 0 ? "disabled" : ""}`)}${B("↓", `order-down-${i}`, "", `aria-label="${esc(index.find((s) => s.no === no).ja)}を後へ" ${i === 17 ? "disabled" : ""}`)}</div>`,
    )
    .join("")}</div>
  </section>
  <section>
  <h2>電波なしで使える曲</h2>
  <p id="offline-status">${offlineLabel()}</p>
  <p>${offlineSongs
    .filter((x) => x.ready)
    .map((x) => esc(index.find((s) => s.no === x.no)?.ja))
    .join("、")}</p>
  </section>
  <section>
  <h2>見通し</h2>${forecast()}</section>
  <section>
  <h2>これまでの記録</h2>${
    store.state.history.length
      ? store.state.history
          .slice()
          .reverse()
          .map(
            (h) =>
              `<div class="history-row">${new Date(h.at).toLocaleDateString("ja-JP")} · ${esc(index.find((s) => s.no === h.no)?.ja || "")} · かけら${esc(h.id?.slice(1))} · ${h.action === "star" ? esc(STAGES[h.stage]) + " ★" : h.action === "remember" ? "覚えていた" : h.action === "forgot" ? "忘れた" : "あと少し"}</div>`,
          )
          .join("")
      : '<p class="muted">まだ記録はありません。先生が星を付けると、ここに残ります。</p>'
  }</section>
  <section>
  <h2>ノートの書き出し・読み込み</h2>
  <div class="flex">${B("JSONを書き出す", "export", "primary")}<label>書き出したJSONを読み込む<input id="import-file" type="file" accept="application/json,.json" class="setting-file">
  </label>
  </div>
  <p class="muted">読み込み前のノートも書き出せます。読み込み内容を確かめてから入れ替えます。</p>${status()}</section>
  <section>
  <h2>出典</h2><p>画面の構成：<a href="https://ngmt4amtk-web.github.io/violin-shodan/">バイオリン初段</a>。音・かけら・保存・あそび：piano-himitsu。</p>
  <p>楽譜：<a href="https://www.mutopiaproject.org/" target="_blank" rel="noopener">Mutopia Project</a>（Public Domain、元は Collection Litolff）</p>
  <p>録音：Salamander Grand Piano · Alexander Holm<br>
  <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>。録音を切り出し、再生速度を変えて使用。</p>
  <p class="muted">練習の単音判定：fuyomi-piano の pitch.js。音は端末内で調べ、録音は保存・送信しません。和音と両手の合否は先生が決めます。</p>
  </section>
  </main>`;
}
async function resume(welcome = false) {
  const due = duePiece(store.state);
  if (due) {
    const [no, id] = due.split(":");
    const s = await getSong(+no);
    await go("piece", {
      no: +no,
      k: s.kakera.find((x) => x.id === id),
      review: true,
    });
  } else if (welcome) {
    dialog.innerHTML = `<h2>はじめてのレッスン</h2>
  <p>今日のおかえりは、まだないよ。<br>新しいかけらから、はじめよう。</p>
  <div class="flex">${B("かけらをひらく", "resume")}${B("とじる", "close-dialog", "quiet")}</div>`;
    dialog.showModal();
  } else {
    const last = store.state.lastPiece,
      s = last ? await getSong(last.no) : song;
    await go("piece", {
      no: s.no,
      k: s.kakera.find((x) => x.id === last?.id) || learningOrder(s)[0],
    });
  }
}
function buildSegments(first, last) {
  let list = [],
    b = first;
  while (b <= last) {
    const id = song.barKakera[b],
      piece = song.kakera[id],
      occ = piece.occurrences.find((o) => o.includes(b));
    const endBar = Math.min(last, occ.at(-1));
    list.push({
      ...piece,
      start: song.bars[b].start,
      end: song.bars[endBar].end,
      representativeStart:
        piece.start + song.bars[b].start - song.bars[occ[0]].start,
    });
    b = endBar + 1;
  }
  return list;
}
async function action(a, el) {
  if (a.startsWith("go-")) {
    await go(a.slice(3));
    return;
  }
  if (a === "resume") {
    await resume();
    return;
  }
  if (a === "welcome") {
    await resume(true);
    return;
  }
  if (a === "retry") {
    await go("home", { no: store.state.currentSong });
    return;
  }
  if (a === "start-lesson") {
    store.state.lessonStart = Date.now();
    store.state.lessonBaseline = store.state.earned;
    store.save();
    renderHome();
    return;
  }
  if (a === "end-lesson") {
    const gained = store.state.earned - store.state.lessonBaseline;
    store.state.lessonStart = null;
    store.save();
    renderHome();
    root.querySelector("#lesson-summary").innerHTML =
      `<p class="lesson-end">今日、星が${gained}こふえたよ。地図を見てみよう。</p>`;
    return;
  }
  if (a === "shrink") {
    shrink();
    return;
  }
  if (a === "choose-song") {
    dialog.innerHTML = `<h2>曲をえらぶ</h2>
  <div class="stack">${store.state.order.map((no) => B(esc(index.find((s) => s.no === no).ja), `song-${no}`, song.no === no ? "selected" : "")).join("")}${B("とじる", "close-dialog", "quiet")}</div>`;
    dialog.showModal();
    return;
  }
  if (a.startsWith("song-")) {
    await go("map", { no: +a.slice(5) });
    return;
  }
  if (a === "range-mode") {
    rangeMode = true;
    range = [];
    mapRevealed = false;
    renderMap();
    return;
  }
  if (a === "connect-map") {
    await go("map", { rangeMode: true });
    toast("はじめと、おわりのタイルをえらんでね。");
    return;
  }
  if (a.startsWith("tile-")) {
    const bar = +a.slice(5);
    if (!rangeMode) {
      await go("piece", { k: song.kakera[song.barKakera[bar]], back: "map" });
      return;
    }
    if (range.includes(bar)) range = range.filter((x) => x !== bar);
    else if (range.length < 2) range.push(bar);
    else range = [bar];
    renderMap();
    return;
  }
  if (a === "clear-range") {
    range = [];
    renderMap();
    return;
  }
  if (a === "open-range" && range.length) {
    if (range.length === 1)
      await go("piece", {
        k: song.kakera[song.barKakera[range[0]]],
        back: "map",
      });
    else {
      const [first, last] = [...range].sort((a, b) => a - b),
        list = buildSegments(first, last);
      await go("piece", {
        k: song.kakera[song.barKakera[first]],
        segments: list,
        back: "map",
      });
    }
    return;
  }
  if (a === "connect-all") {
    const list = buildSegments(0, song.bars.length - 1);
    await go("piece", { k: song.kakera[0], segments: list, back: "map" });
    return;
  }
  if (a.startsWith("piece-") && a !== "piece-menu") {
    await go("piece", {
      k: song.kakera.find((x) => x.id === a.slice(6)),
      back: "map",
    });
    return;
  }
  if (a.startsWith("candidate-")) {
    if (rolling) return;
    await go("piece", {
      k: song.kakera.find((x) => x.id === a.slice(10)),
      back: "new",
    });
    return;
  }
  if (a === "roulette") {
    if (rolling) return;
    rolling = true;
    const buttons = [...root.querySelectorAll("[data-candidate]")],
      chosen = Math.floor(Math.random() * buttons.length);
    el.disabled = true;
    const start = performance.now();
    await new Promise((resolve) => {
      const roll = () => {
        if (view !== "new") {
          resolve();
          return;
        }
        const elapsed = performance.now() - start,
          n =
            elapsed >= 1000
              ? chosen
              : Math.floor(elapsed / 95) % buttons.length;
        buttons.forEach((b, i) => b.classList.toggle("roulette", n === i));
        if (elapsed < 1100) requestAnimationFrame(roll);
        else resolve();
      };
      roll();
    });
    rolling = false;
    if (view === "new")
      await action(buttons[chosen].dataset.act, buttons[chosen]);
    return;
  }
  if (a.startsWith("stage-")) {
    piano.stop();
    stage = +a.slice(6);
    speed = stage === 3 ? 0.75 : 0.5;
    finished = false;
    renderPiece();
    return;
  }
  if (a.startsWith("speed-")) {
    piano.stop();
    speed = +a.slice(6);
    renderPiece();
    return;
  }
  if (a === "start-play" || a === "again") {
    play();
    return;
  }
  if (a === "model") {
    play(true);
    return;
  }
  if (a === "stop-play") {
    piano.stop();
    return;
  }
  if (a === "repeat") {
    repeat = !repeat;
    el.textContent = repeat ? "くり返し：入" : "くり返し：切";
    el.setAttribute("aria-pressed", repeat);
    if (piano.playing) play();
    return;
  }
  if (a === "award") {
    if (!finished || !segments.every(wholePiece)) return;
    const representatives = [
      ...new Map(
        segments.map((s) => [s.id, song.kakera.find((x) => x.id === s.id)]),
      ).values(),
    ];
    let count = 0;
    for (const p of representatives)
      if (complete(store.state, song.no, p, stage)) count++;
    store.state.shodan.credits++;
    store.save();
    toast(
      count
        ? `星が${count}こふえた。同じ形も色がついたよ。`
        : "この星は、もうついているよ。",
    );
    finished = false;
    renderPiece();
    return;
  }
  if (a.startsWith("review-")) {
    if (!finished) return;
    review(store.state, song.no, k, a.slice(7));
    store.save();
    reviewing = false;
    renderPiece();
    toast(
      a === "review-forgot"
        ? "ふつうの速さを、また一緒に。"
        : "次のおかえりまで、覚えておくね。",
    );
    return;
  }
  if (a === "piece-menu") {
    teacherMenu();
    return;
  }
  if (a === "close-dialog") {
    dialog.close();
    return;
  }
  if (a === "reload-score") {
    renderPiece();
    return;
  }
  if (a.startsWith("finger-") && /^finger-\d$/.test(a)) {
    const n = +a.slice(7),
      t = openFinger.target,
      key = pieceKey(t.s.no, t.piece);
    store.state.fingers[key] ||= {};
    if (n) store.state.fingers[key][t.index] = n;
    else delete store.state.fingers[key][t.index];
    store.save();
    models.forEach((m) => m?.drawFingers());
    dialog.close();
    return;
  }
  if (a === "finger-select") {
    const notes = easy && k.svgEasy ? k.notesEasy : k.notes;
    dialog.innerHTML = `<h2>指番号を足す音ぷ</h2>
  <label>音ぷをえらぶ<select id="finger-note">${notes.map((n, i) => `<option value="${i}">${i + 1} · ${n.hand === "R" ? "右" : "左"} · ${["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"][n.m % 12]}</option>`).join("")}</select>
  </label>
  <div class="flex">${B("この音ぷをえらぶ", "finger-picked", "primary")}${B("とじる", "close-dialog", "quiet")}</div>`;
    return;
  }
  if (a === "finger-picked") {
    const i = +dialog.querySelector("#finger-note").value,
      n = (easy && k.svgEasy ? k.notesEasy : k.notes)[i],
      index =
        easy && k.svgEasy && n.hand === "L"
          ? `easy-${i}`
          : easy && k.svgEasy
            ? k.notes.findIndex(
                (o) => o.hand === n.hand && o.t === n.t && o.m === n.m,
              )
            : i;
    dialog.close();
    openFinger({ song, k, index, draw: () => {} });
    return;
  }
  if (a === "undo-star") {
    const p = progress(store.state, song.no, k);
    dialog.innerHTML = `<h2>星をもどす</h2>
  <p>まちがえて付けた星をえらんでください。星をもどしても、手に入れた道具は残ります。</p>
  <div class="stack">${STAGES.map((s, i) => B(s, `undo-confirm-${i}`, "", p.stars[i] ? "" : "disabled")).join("")}${B("やめる", "close-dialog", "quiet")}</div>`;
    return;
  }
  if (a.startsWith("undo-confirm-")) {
    const i = +a.slice(13),
      p = progress(store.state, song.no, k);
    if (i < 2 && !k.notes.some((n) => n.hand === (i === 0 ? "R" : "L"))) {
      toast("この手には音がないよ。");
      return;
    }
    p.stars[i] = false;
    if (p.box > 0) {
      p.box = 0;
      p.due = "";
    }
    store.state.progress[pkey()] = p;
    store.save();
    dialog.close();
    renderPiece();
    return;
  }
  if (a === "forced") {
    await resume();
    const serial = navSerial;
    forcedUntil = 1;
    forceRemaining = 60000;
    forceLast = 0;
    root.classList.add("forced");
    renderPiece();
    await new Promise((resolve) => {
      const deadline = performance.now() + 8000;
      const check = () =>
        navSerial !== serial ||
        models.filter(Boolean).length ||
        performance.now() > deadline
          ? resolve()
          : setTimeout(check, 40);
      check();
    });
    if (!["piece", "play"].includes(view) || navSerial !== serial) return;
    if (!models.filter(Boolean).length) {
      forcedUntil = 0;
      root.classList.remove("forced");
      toast("楽ふをもう一度ひらいてね。");
      return;
    }
    await play();
    root.requestFullscreen?.().catch(() => {});
    forceTick = setInterval(() => {
      const now = performance.now(),
        running =
          !document.hidden &&
          piano.playing &&
          piano.context?.state === "running";
      if (running && forceLast)
        forceRemaining = Math.max(0, forceRemaining - (now - forceLast));
      forceLast = running ? now : 0;
      const label = root.querySelector("#force-seconds");
      if (label) label.textContent = String(Math.ceil(forceRemaining / 1000));
      if (forceRemaining === 0) {
        clearInterval(forceTick);
        forcedUntil = 0;
        piano.stop();
        root.classList.remove("forced");
        if (document.fullscreenElement)
          document.exitFullscreen?.().catch(() => {});
        finished = true;
        renderPiece();
        toast("60秒、よくひいた。");
      }
    }, 100);
    return;
  }
  if (a.startsWith("order-")) {
    const parts = a.split("-"),
      i = +parts[2],
      j = i + (parts[1] === "up" ? -1 : 1);
    if (j < 0 || j >= 18) return;
    [store.state.order[i], store.state.order[j]] = [
      store.state.order[j],
      store.state.order[i],
    ];
    store.save();
    const scroll = window.scrollY;
    renderSettings();
    window.dispatchEvent(new Event("shodan-settings"));
    window.scrollTo(0, scroll);
    root
      .querySelector(`[data-act="order-${parts[1]}-${j}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  if (a === "export") {
    const blob = new Blob([JSON.stringify(store.state, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `piano-shodan-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (a === "confirm-import") {
    store.import(action.pendingImport);
    action.pendingImport = null;
    dialog.close();
    song = await getSong(store.state.currentSong);
    renderSettings();
    window.dispatchEvent(new Event("shodan-settings"));
    toast("ノートを読みこみました。");
    return;
  }
  if (a === "retry-sync") {
    await store.sync();
    toast(saveLabel());
  }
}
document.addEventListener(
  "click",
  () => {
    piano.unlock().catch(() => {});
  },
  { capture: true },
);
document.addEventListener(
  "pointerdown",
  () => {
    piano.unlock().catch(() => {});
  },
  { capture: true },
);
for (const host of [root, dialog])
  host.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (store.ready && el && !el.disabled)
      Promise.resolve(action(el.dataset.act, el)).catch(() =>
        toast("うまくひらけませんでした。もう一度ためしてね。"),
      );
  });
root.addEventListener("input", (e) => {
  if (e.target.id === "volume") {
    store.state.volume = +e.target.value;
    piano.setVolume(+e.target.value);
    store.save();
  }
  if (e.target.id === "student-name") {
    store.state.name = e.target.value.slice(0, 40);
    store.save();
  }
});
root.addEventListener("change", async (e) => {
  const el = e.target;
  if (["count-pattern", "default-count"].includes(el.id)) {
    store.state.count = el.value || null;
    store.save();
    if (piano.playing) piano.stop();
  }
  if (el.id === "easy") {
    piano.stop();
    easy = el.checked;
    renderPiece();
  }
  if (el.id === "import-file" && el.files[0]) {
    try {
      const imported = validate(JSON.parse(await el.files[0].text()));
      action.pendingImport = imported;
      dialog.innerHTML = `<h2>このノートに入れ替えますか？</h2>
  <p>${esc(imported.name)}さん · 星 ${imported.earned}こ · 記録 ${imported.history.length}件</p>
  <p class="muted">今のノートは、入れ替える前に書き出せます。</p>
  <div class="flex">${B("今のノートを書き出す", "export")}${B("読みこんで入れ替える", "confirm-import", "primary")}${B("やめる", "close-dialog", "quiet")}</div>`;
      dialog.showModal();
    } catch (error) {
      toast(error.message || "読みこめませんでした。JSONを確かめてください。");
    }
    el.value = "";
  }
});
piano.addEventListener("load", () => {
  const el = document.querySelector("#audio-status");
  if (el) el.textContent = audioLabel();
});
store.addEventListener("status", () => {
  const el = document.querySelector("#save-status");
  if (el) el.textContent = saveLabel();
  saveWarning();
});
store.addEventListener("restore", async () => {
  if (!store.ready || !index.length) return;
  piano.setVolume(store.state.volume);
  if (view === "home") {
    song = await getSong(store.state.currentSong);
    renderHome();
  } else if (view === "piece" && !piano.playing) {
    renderPiece();
  }
});
window.addEventListener("online", () => {
  store.sync();
  warm();
});
function pause() {
  piano.stop();
  forceLast = 0;
}
window.addEventListener("pagehide", pause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
  else {
    store.sync();
    warm();
  }
});
piano.addEventListener("interrupted", () => {
  forceLast = 0;
  toast("音が止まりました。もう1回おしてね。");
});

setInterval(() => {
  const clock = document.querySelector("#lesson-clock");
  if (clock) clock.textContent = clockLabel();
}, 500);
// Convert only child-facing DOM; teacher settings and teacher dialogs keep
// ordinary Japanese. Text and accessible names share the same reading.
const childObserver = new MutationObserver((records) => {
  if (view === "settings") return;
  for (const record of records) {
    const nodes =
      record.type === "characterData"
        ? [record.target]
        : [...record.addedNodes];
    for (const node of nodes) {
      const texts = node.nodeType === Node.TEXT_NODE ? [node] : [];
      if (node.nodeType === Node.ELEMENT_NODE) {
        const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) texts.push(walk.currentNode);
        for (const el of [node, ...node.querySelectorAll("[aria-label]")]) {
          const label = el.getAttribute("aria-label");
          if (label && childWords(label) !== label)
            el.setAttribute("aria-label", childWords(label));
        }
      }
      for (const text of texts) {
        const value = childWords(text.data);
        if (value !== text.data) text.data = value;
      }
    }
  }
});
childObserver.observe(root, {
  childList: true,
  subtree: true,
  characterData: true,
});
async function init() {
  try {
    const restoring = store.restore();
    const response = await fetch(new URL("index.json", DATA));
    if (!response.ok) throw Error();
    index = await response.json();
    await restoring;
    song = await getSong(store.state.currentSong);
    piano.setVolume(store.state.volume);
    view = "external";
    saveWarning();
    if ("serviceWorker" in navigator) {
      try {
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data?.type === "offline-status") {
            offlineSongs = event.data.songs;
            const label = root.querySelector("#offline-status");
            if (label) label.textContent = offlineLabel();
          }
        });
        const registration = await navigator.serviceWorker.register("./sw.js", {
          scope: "./",
          updateViaCache: "none",
        });
        let changed = false, reloading = false;
        const controlledAtBoot = !!navigator.serviceWorker.controller;
        const safe = () => !piano.playing && !forcedUntil &&
          !["piece", "play"].includes(view) && (window.shodanUpdateSafe?.() ?? true);
        const applyUpdate = () => {
          if (!safe()) return;
          if (changed && !reloading) {
            reloading = true;
            location.reload();
          } else registration.waiting?.postMessage({ type: "activate" });
        };
        navigator.serviceWorker.addEventListener("message", event => {
          if (event.data?.type === "update-ready")
            event.ports[0]?.postMessage({ busy: !safe() });
        });
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          // First installation claims this page too; it needs no reload.
          changed = controlledAtBoot;
          applyUpdate();
        });
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", applyUpdate);
        });
        setInterval(applyUpdate, 500);
        applyUpdate();
        if (navigator.serviceWorker.controller) warm();
        else
          navigator.serviceWorker.addEventListener("controllerchange", warm, {
            once: true,
          });
        setInterval(warm, 60000);
      } catch {}
    }
  } catch {
    root.innerHTML =
      '<main class="boot"><h1>ノートがまだとどいていません</h1><p>電ぱをたしかめて、もう一度ひらいてね。</p><button onclick="location.reload()">もう一度ひらく</button></main>';
  }
}
export const ready = init();
export { store, piano, getSong };
export async function openLegacy(next, options = {}) {
  await ready;
  await go(next, options);
}
export function leaveLegacy() {
  navSerial++;
  cleanup();
  view = "external";
}
