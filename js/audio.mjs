const SAMPLE_NAMES = [];
for (let o = 1; o <= 7; o++)
  for (const [name, p] of [
    ["C", 0],
    ["Ds", 3],
    ["Fs", 6],
    ["A", 9],
  ])
    SAMPLE_NAMES.push({ name: `${name}${o}`, m: (o + 1) * 12 + p });
SAMPLE_NAMES.push({ name: "C8", m: 108 });
// All times below are whole-note units until converted with `unit`.
export function meterPlan(song, count) {
  const [top, bottom] = song.time;
  const beat = top === 6 && bottom === 8 ? 3 / 8 : bottom === 8 ? 1 / 8 : 1 / 4;
  const three = top === 3;
  const pattern = count || (top === 2 || top === 6 ? "1212" : "1234");
  const labels = three
    ? ["1", "2", "3"]
    : pattern === "1212"
      ? ["1", "2", "1", "2"]
      : pattern === "1234"
        ? ["1", "2", "3", "4"]
        : ["1", "2", "1", "ハイ"];
  return {
    beat,
    labels,
    selectable: !three,
    defaultCount: top === 2 || top === 6 ? "1212" : "1234",
  };
}

export function playbackPlan(
  song,
  segments,
  { stage = 0, speed = 0.5, easy = false, count, model = false } = {},
) {
  const unit = 240 / (song.tempo * speed),
    meter = meterPlan(song, count);
  const beatSeconds = meter.beat * unit,
    countEnd = meter.labels.length * beatSeconds;
  const pickup = segments[0].start === 0 ? song.partial : 0;
  let offset = countEnd - pickup * unit;
  const planned = segments.map((seg, index) => {
    const duration = (seg.end - seg.start) * unit;
    const result = { ...seg, index, offset, duration };
    offset += duration;
    return result;
  });
  const events = meter.labels.map((label, i) => ({
    s: i * beatSeconds,
    type: "count",
    strong: i === 0,
    label,
  }));
  // Adjacent source intervals form one timeline: a tie is scheduled once.
  const runs = [];
  for (const seg of planned) {
    const last = runs.at(-1);
    if (last && Math.abs(last.end - seg.start) < 1e-7) last.end = seg.end;
    else runs.push({ start: seg.start, end: seg.end, offset: seg.offset });
  }
  const hands = model
    ? ["R", "L"]
    : stage === 0
      ? ["L"]
      : stage === 1
        ? ["R"]
        : [];
  for (const run of runs) {
    for (const hand of hands) {
      const notes = hand === "L" && easy ? song.Leasy : song[hand];
      for (const n of notes || []) {
        const anchor = n.gt ?? n.t;
        const active = n.g
          ? anchor >= run.start - 1e-7 && anchor < run.end - 1e-7
          : n.t < run.end - 1e-7 && n.t + n.d > run.start + 1e-7;
        if (!active) continue;
        const from = n.g ? n.t : Math.max(n.t, run.start),
          end = Math.min(n.t + n.d, run.end);
        events.push({
          s: run.offset + (from - run.start) * unit,
          type: "note",
          hand,
          m: n.m,
          d: (end - from) * unit,
          v: hand === "R" ? 0.65 : 0.53,
          t: from,
        });
      }
    }
    if (!model && stage >= 2) {
      for (const bar of song.bars) {
        // The pickup's beat grid leads backwards from the first full downbeat.
        const head = bar.i === 0 && song.partial ? bar.end : bar.start;
        let t = head;
        while (t - meter.beat >= bar.start - 1e-7) t -= meter.beat;
        for (; t < bar.end - 1e-7; t += meter.beat) {
          if (t < run.start - 1e-7 || t >= run.end - 1e-7) continue;
          const s = run.offset + (t - run.start) * unit;
          if (
            events.some((e) => e.type === "count" && Math.abs(e.s - s) < 1e-7)
          )
            continue;
          events.push({
            s,
            type: "click",
            strong:
              Math.abs(t - bar.start) < 1e-7 && !(bar.i === 0 && song.partial),
            t,
          });
        }
      }
    }
  }
  events.sort((a, b) => a.s - b.s);
  return {
    unit,
    meter,
    beatSeconds,
    countEnd,
    segments: planned,
    events,
    duration: offset,
  };
}

export class Piano extends EventTarget {
  constructor() {
    super();
    this.buffers = new Map();
    this.voices = new Set();
    this.loaded = 0;
    this.failed = 0;
    this.volume = 0.85;
    this.playing = false;
    this.generation = 0;
    this.createContext();
    this.ready = this.load();
  }
  createContext() {
    this.wave = null;
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -8;
      this.compressor.knee.value = 6;
      this.compressor.ratio.value = 20;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.16;
      this.master.gain.value = this.volume * 2.15;
      this.master.connect(this.compressor);
      // 譜面台のスマホでも届くよう、リミッターの後で持ち上げる。
      this.makeup = this.context.createGain();
      this.makeup.gain.value = 1.9;
      this.compressor.connect(this.makeup);
      this.makeup.connect(this.context.destination);
      this.context.addEventListener("statechange", () => {
        if (this.playing && this.context.state !== "running") {
          this.stop();
          this.dispatchEvent(new Event("interrupted"));
        }
      });
    } catch {
      this.context = null;
    }
  }
  async load() {
    let next = 0;
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < SAMPLE_NAMES.length) {
          const s = SAMPLE_NAMES[next++];
          try {
            const r = await fetch(
              new URL(`../sound/${s.name}.mp3`, import.meta.url),
            );
            if (!r.ok) throw Error();
            const raw = await r.arrayBuffer();
            if (this.context)
              this.buffers.set(s.m, await this.context.decodeAudioData(raw));
            else this.failed++;
          } catch {
            this.failed++;
          }
          this.loaded++;
          this.dispatchEvent(new Event("load"));
        }
      }),
    );
  }
  async unlock() {
    if (this.unlocking) return this.unlocking;
    this.unlocking = this.resumeAudio();
    try {
      return await this.unlocking;
    } finally {
      this.unlocking = null;
    }
  }
  async resumeAudio() {
    if (!this.context) this.createContext();
    if (!this.context) throw Error("音を出せません。もう一度ひらいてね。");
    try {
      // マイクを使っている間に "playback" にすると、iPhone はマイクの入力を止める。
      if (navigator.audioSession) navigator.audioSession.type = this.micActive ? "play-and-record" : "playback";
      else if (!this.silent) {
        const a = new Uint8Array(8044),
          v = new DataView(a.buffer);
        const word = (at, s) =>
          [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
        word(0, "RIFF");
        v.setUint32(4, 8036, true);
        word(8, "WAVE");
        word(12, "fmt ");
        v.setUint32(16, 16, true);
        v.setUint16(20, 1, true);
        v.setUint16(22, 1, true);
        v.setUint32(24, 8000, true);
        v.setUint32(28, 8000, true);
        v.setUint16(32, 1, true);
        v.setUint16(34, 8, true);
        word(36, "data");
        v.setUint32(40, 8000, true);
        a.fill(128, 44);
        this.silent = new Audio(
          URL.createObjectURL(new Blob([a], { type: "audio/wav" })),
        );
        this.silent.loop = true;
        this.silent.volume = 0.01;
        this.silent.setAttribute("playsinline", "");
      }
      this.silent?.play().catch(() => {});
    } catch {}
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await Promise.race([
          this.context.resume(),
          new Promise((_, reject) =>
            setTimeout(() => reject(Error("resume timeout")), 900),
          ),
        ]);
        if (this.context.state === "running") return true;
      } catch {}
      if (attempt === 0) {
        if (this.playing) this.stop();
        this.context.close().catch(() => {});
        this.createContext();
      }
    }
    throw Error("音が止まっています。もう1回おしてね。");
  }
  setVolume(n) {
    this.volume = n;
    if (this.master)
      this.master.gain.setTargetAtTime(
        n * 2.15,
        this.context.currentTime,
        0.02,
      );
  }
  excludeMicUntil(end) {
    this.micMutedUntil = Math.max(this.micMutedUntil || 0, end);
  }
  micBlocked() { return performance.now() < (this.micMutedUntil || 0); }
  note(
    m,
    when = this.context?.currentTime || 0,
    duration = 0.45,
    velocity = 0.6,
  ) {
    if (!this.context) return;
    const c = this.context,
      t = Math.max(when, c.currentTime),
      d = Math.max(0.008, duration),
      gain = c.createGain();
    this.excludeMicUntil(performance.now() + (t - c.currentTime + d + .1) * 1000 + 180);
    gain.connect(this.master);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(
      velocity * 0.56,
      t + Math.min(0.007, d / 2),
    );
    gain.gain.setValueAtTime(velocity * 0.56, t + d);
    gain.gain.linearRampToValueAtTime(0, t + d + 0.1);
    let source;
    if (this.buffers.size) {
      const nearest = [...this.buffers.keys()].reduce((a, b) =>
        Math.abs(b - m) < Math.abs(a - m) ? b : a,
      );
      source = c.createBufferSource();
      source.buffer = this.buffers.get(nearest);
      source.playbackRate.value = 2 ** ((m - nearest) / 12);
    } else {
      source = c.createOscillator();
      source.setPeriodicWave(
        (this.wave ??= c.createPeriodicWave(
          new Float32Array(6),
          new Float32Array([0, 1, 0.3, 0.14, 0.05, 0.02]),
        )),
      );
      source.frequency.value = 440 * 2 ** ((m - 69) / 12);
    }
    source.connect(gain);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
    source.start(t);
    source.stop(t + d + 0.11);
    return voice;
  }
  click(when, strong = false) {
    return this.note(strong ? 91 : 84, when, 0.045, strong ? 0.23 : 0.15);
  }
  stop() {
    this.generation++;
    clearInterval(this.interval);
    cancelAnimationFrame(this.frame);
    this.playing = false;
    // Canceled future notes no longer need to hold the microphone closed.
    this.micMutedUntil = performance.now() + 215;
    if (this.context) {
      const t = this.context.currentTime;
      for (const v of this.voices) {
        try {
          const level = v.gain.gain.value;
          if (v.gain.gain.cancelAndHoldAtTime)
            v.gain.gain.cancelAndHoldAtTime(t);
          else {
            v.gain.gain.cancelScheduledValues(t);
            v.gain.gain.setValueAtTime(level, t);
          }
          v.gain.gain.linearRampToValueAtTime(0, t + 0.025);
          v.source.stop(t + 0.035);
        } catch {}
      }
    }
    this.onFrame?.({ stopped: true });
  }
  async play(
    song,
    segments,
    {
      stage = 0,
      speed = 0.5,
      easy = false,
      count,
      model = false,
      loop = false,
      onFrame = () => {},
      onEnd = () => {},
    } = {},
  ) {
    this.stop();
    const generation = this.generation;
    await this.unlock();
    if (generation !== this.generation) return false;
    const plan = playbackPlan(song, segments, {
      stage,
      speed,
      easy,
      count,
      model,
    });
    Object.assign(this, {
      unit: plan.unit,
      events: plan.events,
      segments: plan.segments,
    });
    this.playing = true;
    this.onFrame = onFrame;
    this.cursor = 0;
    this.startAt = this.context.currentTime + 0.06;
    this.endAt = this.startAt + plan.duration;
    this.countEnd = this.startAt + plan.countEnd;
    this.markerUpdates = 0;
    const first = segments[0].start;
    const initialGrace = [...song.R, ...song.L].filter(
      (n) => n.g && Math.abs(n.gt - first) < 1e-7,
    );
    const firstMarker =
      plan.segments[0].offset +
      Math.min(0, ...initialGrace.map((n) => n.t - first)) * plan.unit;
    const schedule = () => {
      if (!this.playing) return;
      const now = this.context.currentTime;
      while (
        this.cursor < this.events.length &&
        this.startAt + this.events[this.cursor].s < now + 0.12
      ) {
        const e = this.events[this.cursor++],
          at = this.startAt + e.s;
        if (e.type === "note") this.note(e.m, at, e.d, e.v);
        else this.click(at, e.strong);
      }
      if (now >= this.endAt + 0.1) {
        if (loop) {
          this.play(song, segments, {
            stage,
            speed,
            easy,
            count,
            model,
            loop,
            onFrame,
            onEnd,
          }).catch(() => this.dispatchEvent(new Event("interrupted")));
          return;
        }
        this.stop();
        onEnd();
      }
    };
    const draw = () => {
      if (!this.playing) return;
      const elapsed = this.context.currentTime - this.startAt;
      const seg =
        this.segments.find(
          (s) => elapsed >= s.offset && elapsed < s.offset + s.duration,
        ) ||
        this.segments[elapsed < plan.countEnd ? 0 : this.segments.length - 1];
      const t = seg.start + (elapsed - seg.offset) / plan.unit;
      if (elapsed < plan.countEnd) {
        const i = Math.max(
          0,
          Math.min(
            plan.meter.labels.length - 1,
            Math.floor(elapsed / plan.beatSeconds),
          ),
        );
        onFrame({
          count: plan.meter.labels[i],
          pickup: elapsed >= firstMarker,
          segment: seg.index,
          t,
        });
      } else {
        this.markerUpdates++;
        onFrame({ segment: seg.index, t });
      }
      this.frame = requestAnimationFrame(draw);
    };
    schedule();
    this.interval = setInterval(schedule, 25);
    this.frame = requestAnimationFrame(draw);
    return true;
  }
}
