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
