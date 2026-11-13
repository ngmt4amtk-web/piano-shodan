// Include the marker and its stroke at both extremes (C4 ledger line and high LH).
export const MARKER_RADIUS = 1;
export function scoreFrame(layout) {
  const [x, y, w, h] = layout.viewBox;
  const margin = MARKER_RADIUS + .25;
  const top = Math.min(y, ...layout.notes.map(n => n.y - margin));
  const bottom = Math.max(y + h, ...layout.notes.map(n => n.y + margin));
  return [x, top, w, bottom - top];
}
// Keep all notes at one onset together when paging chords and both hands.
export function scorePages(events, limit) {
  const pages = [[]];
  for (const event of events) {
    const page = pages.at(-1);
    if (page.length >= limit && page.at(-1).t !== event.t) pages.push([]);
    pages.at(-1).push(event);
  }
  return pages.filter(page => page.length);
}

// 問題画面の縦の範囲。五線と見えている音だけを囲み、楽譜を大きく見せる。
// 指番号を出す時は、右手は上、左手は下の数字の段まで含める。
export function tightFrame(layout, notes, withoutFingers) {
  const [x, y, w, h] = scoreFrame(layout);
  const lines = layout.staffLines || [];
  if (lines.length !== 5 || !notes.length) return [x, y, w, h];
  const heads = notes.map(n => n.y);
  const margin = 2.6;
  let top = Math.max(y, Math.min(lines[0], ...heads) - margin);
  let bottom = Math.min(y + h, Math.max(lines[4], ...heads) + margin);
  if (!withoutFingers) {
    if (notes[0].hand === "L") bottom = y + h;
    else top = y;
  }
  return [x, top, w, bottom - top];
}

const NS = "http://www.w3.org/2000/svg";
const svgNode = (tag, attrs) => {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
// Add highlights before the printed staff and notes so their lines stay legible.
export function insertScoreLayer(svg, layer) {
  svg.insertBefore(layer, [...svg.children].find(el => !["style", "defs", "title", "desc"].includes(el.localName)) || null);
}
export function highlightNote(n, lines, done = false) {
  const staff = lines?.length === 10 ? (n.hand === "L" ? lines.slice(5) : lines.slice(0, 5)) : lines;
  const top = Math.min(n.y - .8, staff?.[0] ?? n.y - 2);
  const bottom = Math.max(n.y + .8, staff?.[4] ?? n.y + 2);
  return svgNode("rect", { class: "score-highlight", x: n.x - 1.25, y: top, width: 2.5, height: bottom - top, rx: .5, fill: done ? "#9be3b9" : "#ffe14d", "fill-opacity": done ? .35 : .55, "pointer-events": "none" });
}
export function addBassNames(svg, notes, enabled = true, lines = null) {
  if (!enabled) return;
  const names = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
  const bass = notes.filter(n => n.hand === "L");
  if (!bass.length) return;
  // 歌詞のように、ヘ音記号の五線の下へ1列で書く。和音は高い音から縦に重ねる。
  const staffBottom = Array.isArray(lines) && lines.length ? lines[lines.length - 1] : Math.max(...bass.map(n => n.y));
  const columns = new Map();
  for (const n of bass) {
    const key = Math.round(n.x * 2) / 2;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(n);
  }
  // 左手の指番号（五線の下）よりさらに下へ置き、数字と重ねない。
  const staffTop = Array.isArray(lines) && lines.length >= 5 ? lines[lines.length - 5] : staffBottom - 4;
  const fingers = [...svg.querySelectorAll('[aria-label="ゆびばんごう"] text')]
    .map(t => Number(t.getAttribute("y"))).filter(y => Number.isFinite(y) && y > staffTop);
  const lowest = Math.max(staffBottom, ...bass.map(n => n.y + .6), ...fingers.map(y => y + .3));
  const top = lowest + 1.9;
  const step = 1.65;
  const group = svgNode("g", { class: "bass-names", "pointer-events": "none" });
  let bottom = top;
  for (const column of columns.values()) {
    const seen = new Set();
    const chord = column.sort((a, b) => b.m - a.m).filter(n => !seen.has(n.m) && seen.add(n.m));
    chord.forEach((n, i) => {
      const y = top + i * step;
      const label = svgNode("text", { class: "bass-name", x: n.x, y, "font-size": 1.5, "font-family": "Hiragino Maru Gothic ProN, sans-serif", "font-weight": "bold", "text-anchor": "middle", fill: "#2b4a9a" });
      label.textContent = names[(n.m % 12 + 12) % 12];
      group.append(label);
      bottom = Math.max(bottom, y + .5);
    });
  }
  svg.append(group);
  const box = (svg.getAttribute("viewBox") || "").split(/[ ,]+/).map(Number);
  if (box.length === 4 && box.every(Number.isFinite) && bottom > box[1] + box[3]) {
    box[3] = bottom - box[1];
    svg.setAttribute("viewBox", box.join(" "));
    if (svg.hasAttribute("height")) svg.setAttribute("height", box[3]);
  }
}
