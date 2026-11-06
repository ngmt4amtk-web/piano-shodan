import { DATA_VERSION } from "./version.mjs";
import { DEFAULT_NAME, DEFAULT_ORDER } from "./config.mjs";
export const KEY = "piano-shodan-state-v1";
export function day(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function afterWeeks(weeks) {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  return day(date);
}
function validateShodan(value, fallback) {
  if (value === undefined) return fallback;
  if (!object(value) || !object(value.done) || !object(value.options))
    throw Error("練習の記録を読みこめませんでした");
  for (const field of ["credits", "draws", "sinceRare", "pity", "lessonNotice"])
    if (!Number.isSafeInteger(value[field]) || value[field] < 0)
      throw Error("ガチャの回数を読みこめませんでした");
  if (value.pity < 1 || value.pity > 100 ||
      !Array.isArray(value.rates) || value.rates.length !== 5 ||
      value.rates.some(n => !Number.isFinite(n) || n < 0) ||
      Math.abs(value.rates.reduce((a, b) => a + b, 0) - 100) > 0.001 ||
      value.rates[3] + value.rates[4] <= 0)
    throw Error("ガチャの確率を読みこめませんでした");
  if (Object.values(value.done).some(n => n !== true))
    throw Error("練習の進み具合を読みこめませんでした");
  return { ...fallback, ...value };
}
function dueDate(value) {
  if (value === 0 || value === "") return "";
  const date = typeof value === "number" ? day(new Date(value)) : value;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    day(new Date(date + "T12:00:00")) !== date
  )
    throw Error("復習の日付を読みこめませんでした");
  // Four weeks is the longest scheduled interval. Larger dates come back today.
  return date > afterWeeks(4) ? day() : date;
}
export function fresh() {
  return {
    version: 1,
    shodan: {
      done: {}, options: {}, lastDrill: "r-walk", credits: 0,
      draws: 0, sinceRare: 0, rates: [60, 25, 8, 5, 2], pity: 8,
      lessonNotice: 0, lastReward: null
    },
    rev: 0,
    dataVersion: DATA_VERSION,
    updatedAt: 0,
    name: DEFAULT_NAME,
    order: [...DEFAULT_ORDER],
    currentSong: 1,
    progress: {},
    fingers: {},
    history: [],
    collection: [],
    spent: 0,
    earned: 0,
    count: null,
    volume: 0.85,
    seenMaps: [],
    lastPiece: null,
    lessonStart: null,
    lessonBaseline: 0,
  };
}
const object = (x) => x && typeof x === "object" && !Array.isArray(x);
export function validate(x) {
  if (
    !object(x) ||
    x.version !== 1 ||
    !object(x.progress) ||
    !object(x.fingers) ||
    !Array.isArray(x.history) ||
    !Array.isArray(x.collection)
  )
    throw Error("形式がちがいます。書き出したJSONを選んでください");
  const b = fresh();
  if (x.rev !== undefined && (!Number.isSafeInteger(x.rev) || x.rev < 0))
    throw Error("保存番号を読みこめませんでした");
  if (x.dataVersion !== undefined && typeof x.dataVersion !== "string")
    throw Error("楽譜の版を読みこめませんでした");
  for (const k of ["updatedAt", "spent", "earned", "volume"])
    if (x[k] !== undefined && (!Number.isFinite(x[k]) || x[k] < 0))
      throw Error("数字を読みこめませんでした");
  for (const k of ["spent", "earned", "lessonBaseline"])
    if (x[k] !== undefined && !Number.isInteger(x[k]))
      throw Error("星の数を読みこめませんでした");
  if (
    x.history.some(
      (h) =>
        !object(h) ||
        !Number.isFinite(h.at) ||
        h.at < 0 ||
        !DEFAULT_ORDER.includes(h.no) ||
        !/^k[1-9]\d*$/.test(h.id) ||
        !["star", "remember", "almost", "forgot"].includes(h.action) ||
        (h.action === "star" &&
          (!Number.isInteger(h.stage) || h.stage < 0 || h.stage > 3)),
    )
  )
    throw Error("これまでの記録を読みこめませんでした");
  if (x.collection.some((n) => !Number.isInteger(n) || n < 0 || n >= 30))
    throw Error("道具の記録を読みこめませんでした");
  if (
    x.order &&
    (!Array.isArray(x.order) ||
      x.order.length !== 18 ||
      new Set(x.order).size !== 18 ||
      x.order.some((n) => !DEFAULT_ORDER.includes(n)))
  )
    throw Error("曲の順番を読みこめませんでした");
  for (const [k, p] of Object.entries(x.progress))
    if (
      !/^\d{1,2}:k\d+$/.test(k) ||
      !object(p) ||
      !Array.isArray(p.stars) ||
      p.stars.length !== 4 ||
      p.stars.some((v) => typeof v !== "boolean") ||
      !Number.isInteger(p.box) ||
      p.box < 0 ||
      p.box > 100 ||
      !["number", "string"].includes(typeof p.due) ||
      !Number.isFinite(p.lastReview)
    )
      throw Error("星の記録を読みこめませんでした");
  for (const [k, f] of Object.entries(x.fingers))
    if (
      !/^\d{1,2}:k\d+$/.test(k) ||
      !object(f) ||
      Object.entries(f).some(
        ([i, n]) =>
          !/^(?:easy-)?\d+$/.test(i) || !Number.isInteger(n) || n < 1 || n > 5,
      )
    )
      throw Error("指番号を読みこめませんでした");
  const normalizedProgress = Object.fromEntries(
    Object.entries(x.progress).map(([key, p]) => [
      key,
      { ...p, due: dueDate(p.due) },
    ]),
  );
  return {
    ...b,
    ...x,
    shodan: validateShodan(x.shodan, b.shodan),
    progress: normalizedProgress,
    dataVersion: x.dataVersion ?? (x.updatedAt ? "legacy" : DATA_VERSION),
    name: typeof x.name === "string" ? x.name.slice(0, 40) : b.name,
    currentSong: DEFAULT_ORDER.includes(x.currentSong) ? x.currentSong : 1,
    count: ["1234", "1212", "1・2・1・ハイ"].includes(x.count) ? x.count : null,
    volume: Math.min(1, x.volume ?? b.volume),
    collection: x.collection.filter(
      (n) => Number.isInteger(n) && n >= 0 && n < 30,
    ),
    seenMaps: Array.isArray(x.seenMaps)
      ? x.seenMaps.filter((n) => DEFAULT_ORDER.includes(n))
      : [],
    lastPiece:
      x.lastPiece &&
      DEFAULT_ORDER.includes(x.lastPiece.no) &&
      /^k\d+$/.test(x.lastPiece.id)
        ? x.lastPiece
        : null,
    lessonStart: Number.isFinite(x.lessonStart) ? x.lessonStart : null,
  };
}
const CONFLICT_KEY = KEY + ".conflicts";
const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class Store extends EventTarget {
  constructor() {
    super();
    this.state = fresh();
    this.status = "loading";
    this.ready = false;
    this.dirty = false;
    this.writing = false;
    this.baseRev = null;
    this.localOK = true;
    this.remoteOK = false;
    this.remoteEnabled = false;
    this.retryDelay = 1000;
    this.conflicts = [];
    this.unreadable = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.state = validate(JSON.parse(raw));
    } catch {
      this.localOK = false;
      this.invalid = true;
      try {
        this.unreadable = localStorage.getItem(KEY);
        if (this.unreadable) localStorage.setItem(KEY + "-unreadable", this.unreadable);
      } catch {}
    }
    try {
      this.conflicts = JSON.parse(localStorage.getItem(CONFLICT_KEY) || "[]");
    } catch {}
    window.addEventListener("storage", (event) => {
      if (event.key !== KEY || !event.newValue || !this.ready) return;
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return;
        const incoming = validate(JSON.parse(raw));
        const conflict = incoming.rev === this.state.rev && !identical(incoming, this.state);
        // Equal revisions go through the server's compare-and-swap. Never
        // write a storage notification back to localStorage.
        if (incoming.rev > this.state.rev) this.reconcile(incoming, false);
        this.dirty = this.dirty || conflict || this.state.rev > (this.baseRev ?? -1);
        this.queue();
        this.signal();
      } catch {}
    });
  }
  signal() {
    this.status = !this.ready
      ? "loading"
      : !this.localOK
        ? "full"
        : this.writing
          ? "saving"
          : this.remoteOK && !this.dirty
            ? "saved"
            : this.invalid
              ? "invalid"
              : "local";
    this.dispatchEvent(new Event("status"));
  }
  archive(value, persist = true) {
    if (!value || this.conflicts.some((x) => identical(x, value))) return;
    this.conflicts.push(structuredClone(value));
    if (!persist) return;
    try {
      localStorage.setItem(CONFLICT_KEY, JSON.stringify(this.conflicts));
    } catch {}
  }
  reconcile(remote, persist = true) {
    if (!remote || identical(remote, this.state)) return;
    if (remote.rev >= this.state.rev) {
      if (this.state.rev > 0 || this.state.updatedAt > 0)
        this.archive(this.state, persist);
      this.state = remote;
      if (persist) this.local();
      this.dispatchEvent(new Event("restore"));
    } else this.archive(remote, persist);
  }
  async restore() {
    if (this.restoring) return this.restoring;
    this.restoring = this.readRemote();
    try {
      await this.restoring;
    } finally {
      this.restoring = null;
      this.ready = true;
      this.signal();
      if (this.dirty || this.conflicts.length) this.queue();
    }
  }
  async readRemote() {
    if (!this.remoteEnabled) return;
    try {
      const response = await fetch("./api/state", {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw Error();
      const raw = await response.json(),
        remote = raw ? validate(raw) : null;
      this.baseRev = remote?.rev ?? 0;
      this.reconcile(remote);
      this.dirty = this.state.rev > this.baseRev;
      this.remoteOK = !this.dirty;
    } catch {
      this.remoteOK = false;
      this.dirty = this.state.rev > 0;
    }
  }
  local() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      this.localOK = true;
    } catch {
      this.localOK = false;
    }
  }
  save() {
    // The UI is inert until restore finishes. Also reject an early programmatic
    // save; it must never turn empty boot data into a newer revision.
    if (!this.ready) return false;
    this.state.rev++;
    this.state.updatedAt = Date.now();
    this.local();
    this.dirty = true;
    this.remoteOK = false;
    this.queue();
    this.signal();
    return true;
  }
  queue(delay = 180) {
    if (!this.remoteEnabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), delay);
  }
  async flushConflicts() {
    if (!this.conflicts.length) return;
    const pending = [...this.conflicts];
    const response = await fetch("./api/conflicts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ states: pending }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw Error();
    this.conflicts = this.conflicts.filter((x) => !pending.includes(x));
    try {
      localStorage.setItem(CONFLICT_KEY, JSON.stringify(this.conflicts));
    } catch {}
  }
  async sync() {
    if (!this.remoteEnabled) return;
    if (!this.ready || this.writing) return;
    clearTimeout(this.timer);
    this.writing = true;
    this.signal();
    let failed = false;
    try {
      if (this.baseRev === null || (this.dirty && this.state.rev <= this.baseRev))
        await this.readRemote();
      if (this.baseRev === null) throw Error();
      await this.flushConflicts();
      if (this.dirty) {
        const snapshot = structuredClone(this.state),
          baseRev = this.baseRev;
        const response = await fetch("./api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRev, state: snapshot }),
          signal: AbortSignal.timeout(4000),
        });
        if (response.status === 409) {
          const result = await response.json(),
            remote = result.state ? validate(result.state) : null;
          this.baseRev = remote?.rev ?? 0;
          this.reconcile(remote);
          this.dirty = this.state.rev > this.baseRev;
          this.remoteOK = !this.dirty;
          await this.flushConflicts();
        } else {
          if (!response.ok) throw Error();
          this.baseRev = snapshot.rev;
          this.dirty = this.state.rev > snapshot.rev;
          this.remoteOK = !this.dirty;
          if (
            this.state.rev === snapshot.rev &&
            !identical(this.state, snapshot)
          )
            await this.readRemote();
        }
      } else this.remoteOK = true;
      this.retryDelay = 1000;
    } catch {
      failed = true;
      this.remoteOK = false;
    } finally {
      this.writing = false;
      this.signal();
      if (failed || this.dirty || this.conflicts.length) {
        this.queue(failed ? this.retryDelay : 180);
        if (failed) this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      }
    }
  }
  import(value) {
    if (!this.ready) return;
    const incoming = validate(value),
      rev = this.state.rev;
    this.archive(this.state);
    this.state = { ...incoming, rev };
    this.save();
    this.dispatchEvent(new Event("restore"));
  }
}
export function pieceKey(no, k) {
  return `${no}:${typeof k === "string" ? k : k.id}`;
}
export function progress(state, no, k) {
  const key = pieceKey(no, k);
  const p = state.progress[key] || {
    stars: [false, false, false, false],
    box: 0,
    due: "",
    lastReview: 0,
  };
  const stars = [...p.stars];
  if (typeof k !== "string") {
    if (!k.notes.some((n) => n.hand === "R")) stars[0] = true;
    if (!k.notes.some((n) => n.hand === "L")) stars[1] = true;
  }
  return { ...p, stars };
}
export function complete(state, no, k, stage) {
  const p = progress(state, no, k);
  const added = !p.stars[stage];
  p.stars[stage] = true;
  if (added) {
    state.earned++;
    state.history.push({ at: Date.now(), no, id: k.id, stage, action: "star" });
  }
  if (p.stars.every(Boolean) && p.box === 0) {
    p.box = 1;
    p.lastReview = Date.now();
    p.due = afterWeeks(1);
  }
  state.progress[pieceKey(no, k)] = p;
  return added;
}
export function review(state, no, k, result) {
  const p = progress(state, no, k);
  if (result === "remember") p.box++;
  if (result === "forgot") {
    p.box = 1;
    p.stars[3] = false;
  }
  p.lastReview = Date.now();
  p.due = afterWeeks([0, 1, 2, 4][Math.min(p.box, 3)] || 1);
  state.progress[pieceKey(no, k)] = p;
  state.history.push({ at: Date.now(), no, id: k.id, action: result });
}
export function duePiece(state) {
  return Object.entries(state.progress)
    .filter(([, p]) => p.box > 0 && p.box < 4 && dueDate(p.due) <= day())
    .sort((a, b) => dueDate(a[1].due).localeCompare(dueDate(b[1].due)))[0]?.[0];
}
export function learningOrder(song) {
  return [...song.kakera].sort(
    (a, b) => b.occurrences.length - a.occurrences.length || a.start - b.start,
  );
}
