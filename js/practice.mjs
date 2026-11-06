import { createMic, createHolder, detect, judgeNote, TOL } from "./pitch.js";

export const noteName = m =>
  ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"][m % 12];
export function heardName(midi, target) {
  return (Math.floor(midi / 12) > Math.floor(target / 12) ? "高い" :
    Math.floor(midi / 12) < Math.floor(target / 12) ? "ひくい" : "") + noteName(midi);
}
const ALL_KEYS = Array.from({ length: 88 }, (_, i) => i + 21);

export class Practice {
  constructor({ drill, position, stage, piano, bpm, input, companion, count,
    onStatus, onProgress, onEnd }) {
    Object.assign(this, { drill, position, stage, piano, bpm, input, companion,
      count, onStatus, onProgress, onEnd });
    const events = position.events;
    this.events = stage.hand === "B" ?
      [...(events.R || []), ...(events.L || [])] : (events[stage.hand] || []);
    this.events.sort((a, b) => a.t - b.t || a.m - b.m);
    this.waitable = !stage.metro && stage.hand !== "B" &&
      new Set(this.events.map(n => n.t)).size === this.events.length;
    this.index = 0;
    this.active = false;
    this.completed = false;
    this.token = 0;
  }

  async start() {
    this.stop();
    const token = ++this.token;
    this.active = true;
    this.completed = false;
    this.index = 0;
    this.onProgress(0, this.events.length, this.events[0]);
    if (this.stage.metro) {
      await this.timed(false, token);
      return;
    }
    if (!this.waitable) {
      this.onStatus("先生とひこう。ひけたら「できた」をおしてね。", "teacher");
      return;
    }
    if (this.input === "keys") {
      this.onStatus("けんばんで「" + noteName(this.events[0].m) + "」をひこう。", "wait");
      return;
    }
    if (this.input === "teacher") {
      this.onStatus("先生とひこう。マイクなしでつづけられるよ。", "teacher");
      return;
    }
    this.onStatus("マイクをよういしています。先生のボタンでもつづけられるよ。", "loading");
    try {
      const mic = await createMic();
      if (token !== this.token || !this.active) {
        mic.close();
        return;
      }
      this.mic = mic;
      this.holder = createHolder(TOL.loose);
      this.onStatus("「" + noteName(this.events[0].m) + "」をまっているよ。", "wait");
      const frame = () => {
        if (!this.active || token !== this.token) return;
        if (this.piano.micBlocked()) {
          this.holder.reset();
          this.raf = requestAnimationFrame(frame);
          return;
        }
        const x = mic.read();
        let det = detect(x, mic.sampleRate);
        // 移植元は150Hzから。周波数の単位だけ倍にして低いピアノ音も調べる。
        // pitch.js本体と判定の許容幅は変えない。
        const low = detect(x, mic.sampleRate * 2);
        if (low.f > 0 && low.f / 2 < 180 && low.conf > det.conf) {
          det = { ...low, f: low.f / 2 };
        }
        const result = this.holder.feed(performance.now(), det);
        if (result) {
          const judged = judgeNote({ freq: result.freq,
            targetMidi: this.events[this.index].m, candidates: ALL_KEYS,
            cfg: TOL.loose });
          this.hear(judged.ok ? this.events[this.index].m : judged.heard.midi);
          this.holder.reset();
        }
        if (this.active) this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    } catch {
      if (token !== this.token) return;
      this.onStatus("マイクはつかえません。先生の「できた」でつづけられるよ。", "teacher");
    }
  }

  hear(midi) {
    if (!this.active || !this.waitable || !this.events[this.index]) return false;
    const target = this.events[this.index];
    if (midi !== target.m) {
      this.onStatus(heardName(midi, target.m) + "に聞こえた。" + noteName(target.m) + "をひこう。", "wrong");
      return false;
    }
    if (this.companion) {
      const other = this.stage.hand === "R" ? "L" : "R";
      for (const n of this.position.events[other] || []) {
        if (n.t >= target.t - 1e-7 && n.t < target.t + target.d - 1e-7)
          this.piano.note(n.m, undefined, (n.soundD ?? n.d) * 240 / this.bpm);
      }
    }
    this.index++;
    this.onProgress(this.index, this.events.length, this.events[this.index]);
    if (this.index === this.events.length) {
      this.finish();
    } else {
      this.onStatus("あった！ つぎは「" + noteName(this.events[this.index].m) + "」。", "correct");
    }
    return true;
  }

  async timed(model = false, token = this.token) {
    try {
      await this.piano.unlock();
    } catch {
      if (token === this.token)
        this.onStatus("音が出せません。先生のボタンでつづけられるよ。", "teacher");
      return;
    }
    if (token !== this.token) return;
    const unit = 240 / this.bpm;
    const three = this.drill.time.startsWith("3/");
    const labels = three ? ["1", "2", "3"] :
      this.count === "1212" ? ["1", "2", "1", "2"] :
      this.count === "1・2・1・ハイ" ? ["1", "2", "1", "ハイ"] : ["1", "2", "3", "4"];
    const start = this.piano.context.currentTime + .06;
    const lead = model ? 0 : labels.length * 60 / this.bpm;
    const queue = [];
    if (!model) {
      labels.forEach((label, i) => queue.push({ at: start + i * 60 / this.bpm,
        click: true, strong: i === 0 }));
      for (let t = 0; t < this.position.end - 1e-7; t += .25)
        queue.push({ at: start + lead + t * unit, click: true,
          strong: Math.abs(t % (Number(this.drill.time.split("/")[0]) / 4)) < 1e-7 });
    }
    const other = this.stage.hand === "R" ? "L" : "R";
    for (const [h, notes] of Object.entries(this.position.events)) {
      if (!model && !(this.companion && this.stage.hand !== "B" && h === other)) continue;
      for (const n of notes)
        queue.push({ at: start + lead + n.t * unit, m: n.m, d: (n.soundD ?? n.d) * unit });
    }
    queue.sort((a, b) => a.at - b.at);
    let cursor = 0;
    const frame = () => {
      if (token !== this.token || !this.active) return;
      const now = this.piano.context.currentTime;
      while (cursor < queue.length && queue[cursor].at <= now + .12) {
        const e = queue[cursor++];
        if (e.click) this.piano.click(e.at, e.strong);
        else this.piano.note(e.m, e.at, e.d);
      }
      const elapsed = now - start;
      if (elapsed < lead) {
        this.onStatus(labels[Math.max(0, Math.floor(elapsed * this.bpm / 60))] || labels[0], "count");
      } else {
        const t = (elapsed - lead) / unit;
        this.index = this.events.filter(n => n.t <= t).length;
        this.onProgress(this.index, this.events.length,
          this.events.find(n => n.t + n.d > t));
        this.onStatus(model ? "おてほんをきいてね。" : "いっしょにひこう。", "playing");
        if (t >= this.position.end) {
          this.finish(model);
          return;
        }
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  async model() {
    this.stop();
    this.active = true;
    const token = ++this.token;
    await this.timed(true, token);
  }

  finish(model = false) {
    this.stop();
    this.completed = !model;
    const message = model ? "こんどはひいてみよう。" :
      this.waitable ? "さいごまでひけた！ 先生、できたかな？" :
        "さいごまで進んだよ。先生、できたかな？";
    this.onStatus(message, "done");
    this.onEnd(model);
  }

  stop() {
    this.token++;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.mic?.close();
    this.mic = null;
    this.piano.stop();
  }
}
