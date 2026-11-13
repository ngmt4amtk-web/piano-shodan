import { DATA } from "./config.mjs";
import { pieceKey } from "./state.mjs";
import { highlightNote, insertScoreLayer, addBassNames } from "./score-frame.mjs";
const NS = "http://www.w3.org/2000/svg";
const cache = new Map();
const node = (tag, attrs) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
export async function score(
  container,
  song,
  k,
  { easy = false, stage = 0, store, onFinger = () => {}, signal, segment } = {},
) {
  const useEasy = easy && !!k.svgEasy,
    path = useEasy ? k.svgEasy : k.svg;
  let source = cache.get(path);
  if (!source) {
    const r = await fetch(new URL(path, DATA), { signal });
    if (!r.ok) throw Error("楽ふを読みこめませんでした");
    source = await r.text();
    cache.set(path, source);
  }
  if (signal?.aborted || !container.isConnected) return;
  const svg = new DOMParser().parseFromString(
    source,
    "image/svg+xml",
  ).documentElement;
  if (svg.localName !== "svg") throw Error("楽ふを読みこめませんでした");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${song.ja}の楽ふ`);
  svg.classList.add("music-svg");
  const partialLabel = container.querySelector(".partial-label");
  container.replaceChildren(...(partialLabel ? [partialLabel] : []), svg);
  const notes = useEasy ? k.notesEasy : k.notes,
    staff = useEasy ? k.staffYEasy : k.staffY;
  const staffLines = n => n.hand === "L" ? [staff.down[0], 0, 0, 0, staff.down[1]] : [staff.up[0], 0, 0, 0, staff.up[1]];
  const vb = svg.viewBox.baseVal;
  addBassNames(svg, notes, store.state.shodan.bassNames !== false, [staff.down[0], staff.down[1]]);
  const durations = notes.map(
    (n) =>
      (n.hand === "L" && useEasy ? song.Leasy : song[n.hand]).find(
        (event) => Math.abs(event.t - n.t) < 1e-6 && event.m === n.m,
      )?.d ?? 0.0625,
  );
  // The original notes index stays the persistent key, also in an easy layout.
  const originalIndex = (n, i) =>
    useEasy && n.hand === "L"
      ? `easy-${i}`
      : useEasy
        ? k.notes.findIndex(
            (o) =>
              o.hand === n.hand && Math.abs(o.t - n.t) < 1e-6 && o.m === n.m,
          )
        : i;
  const from = segment?.representativeStart ?? k.start,
    to = from + (segment ? segment.end - segment.start : k.end - k.start);
  const included = (n) =>
    (n.gt ?? n.t) >= from - 1e-7 && (n.gt ?? n.t) < to - 1e-7;
  if (stage < 2) {
    const range = staff[stage === 0 ? "down" : "up"];
    const box = svg.viewBox.baseVal;
    svg.append(
      node("rect", {
        x: box.x,
        y: range[0] - 2.8,
        width: box.width,
        height: range[1] - range[0] + 5.6,
        fill: "white",
        "fill-opacity": ".76",
        "pointer-events": "none",
        class: "hand-mask",
      }),
    );
  }
  const fingers = node("g", { class: "fingers", "pointer-events": "none" }),
    ranges = node("g", { class: "score-ranges", "pointer-events": "none" }),
    markers = node("g", { class: "markers", "pointer-events": "none" }),
    targets = node("g", { class: "finger-targets" });
  insertScoreLayer(svg, ranges);
  insertScoreLayer(svg, markers);
  svg.append(fingers, targets);
  function drawFingers() {
    fingers.replaceChildren();
    const saved = store.state.fingers[pieceKey(song.no, k)] || {};
    notes.forEach((n, i) => {
      const num = saved[originalIndex(n, i)];
      if (num) {
        const t = node("text", {
          x: n.x,
          y: n.y - 3,
          "font-size": "2.8",
          "font-weight": "bold",
          "text-anchor": "middle",
          fill: "#17384b",
          stroke: "white",
          "stroke-width": ".35",
          "paint-order": "stroke",
        });
        t.textContent = num;
        fingers.append(t);
      }
    });
  }
  drawFingers();
  let press = null;
  if (segment && (from > k.start + 1e-7 || to < k.end - 1e-7)) {
    svg.setAttribute("aria-label", `${song.ja}の一ぶ。色の音ぷだけひこう`);
    for (const n of notes) {
      if (included(n))
        ranges.append(highlightNote(n, staffLines(n), true));
    }
  }
  const nearest = (e) => {
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    );
    return notes
      .map((n, i) => ({ n, i, d: Math.hypot(n.x - point.x, n.y - point.y) }))
      .sort((a, b) => a.d - b.d)[0];
  };
  notes.forEach((n, i) => {
    const index = originalIndex(n, i);
    if (index < 0 || !included(n)) return;
    const target = node("rect", {
      x: n.x - 2.1,
      y: n.y - 2.1,
      width: 4.2,
      height: 4.2,
      fill: "transparent",
      class: "note-target",
      "data-note-index": index,
    });
    targets.append(target);
    target.addEventListener("pointerdown", (e) => {
      const x = e.clientX,
        y = e.clientY;
      clearTimeout(press);
      const chosen = nearest(e);
      press = setTimeout(() => {
        press = null;
        if (chosen && included(chosen.n))
          onFinger({
            song,
            k,
            index: originalIndex(chosen.n, chosen.i),
            n: chosen.n,
            draw: drawFingers,
          });
      }, 550);
      target.onpointermove = (ev) => {
        if (Math.hypot(ev.clientX - x, ev.clientY - y) > 8) clearTimeout(press);
      };
    });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    target.addEventListener("pointerup", () => {
      if (press) {
        markers.replaceChildren(highlightNote(n, staffLines(n)));
        clearTimeout(press);
        press = null;
      }
    });
    target.addEventListener("pointercancel", () => clearTimeout(press));
  });
  // Explicit control in the score menu gives keyboard / screen reader users the same edit.
  return {
    svg,
    notes,
    k,
    drawFingers,
    mark(t) {
      markers.replaceChildren();
      if (t == null) return;
      for (const [i, n] of notes.entries()) {
        if (!included(n) || n.t > t + 0.015 || t >= n.t + durations[i])
          continue;
        const marker = highlightNote(n, staffLines(n));
        marker.classList.add("play-marker", n.hand === "R" ? "right" : "left");
        markers.append(marker);
      }
    },
  };
}
