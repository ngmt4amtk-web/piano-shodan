import { CLEFS } from "./clefs.mjs";
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const playerName = state => state.name ? esc(state.name) + "さん" : "じぶん";
const NAT = [0, 2, 4, 5, 7, 9, 11],
  NAMES = ["ド", "レ", "ミ", "ファ", "ソ", "ラ", "シ"];
export function keyboard(base = 60) {
  return `<div class="keyboard" aria-label="2オクターブのけんばん">${[0, 12]
    .map(
      (off) =>
        `<div class="octave">${NAT.map((n, i) => `<button class="key white" data-key="${base + off + n}" aria-label="${NAMES[i]} ${Math.floor((base + off + n) / 12) - 1}">${NAMES[i]}${i === 0 ? `<small>${Math.floor((base + off + n) / 12) - 1}</small>` : ""}</button>`).join("")}${[
          1, 3, 6, 8, 10,
        ]
          .map(
            (
              n,
              i,
            ) => `<button class="key black" style="left:calc(${([1, 2, 4, 5, 6][i] * 100) / 7}% - max(22px, 4.5%))" data-key="${base + off + n}" aria-label="${NAMES[[0, 1, 3, 4, 5][i]]}のシャープ ${Math.floor((base + off + n) / 12) - 1}">
  </button>`,
          )
          .join("")}</div>`,
    )
    .join("")}</div>`;
}
export function noteStaff(m, clef) {
  const diatonic = (m) => Math.floor(m / 12) * 7 + NAT.indexOf(m % 12),
    bottom = clef === "bass" ? 43 : 64,
    y = 83 - (diatonic(m) - diatonic(bottom)) * 6;
  let ledger = "";
  for (let p = 95; p <= y; p += 12) ledger += `<path d="M222 ${p}h36"/>`;
  for (let p = 23; p >= y; p -= 12) ledger += `<path d="M222 ${p}h36"/>`;
  return `<svg class="game-staff" viewBox="0 0 440 145" role="img" aria-label="${clef === "bass" ? "ヘ音記号" : "ト音記号"}の音ぷ。けんばんで答えてね" data-midi="${m}">
  <g stroke="#183c4e" stroke-width="1.2">${[35, 47, 59, 71, 83].map((y) => `<path d="M30 ${y}H410"/>`).join("")}${ledger}</g>
  <g transform="translate(45 ${clef === "bass" ? 47 : 71}) scale(12)">
  <path transform="scale(.004,-.004)" d="${CLEFS[clef]}" fill="#183c4e"/>
  </g>
  <ellipse cx="240" cy="${y}" rx="10" ry="7" transform="rotate(-18 240 ${y})" fill="#183c4e"/>
  <path d="M249 ${y}v-36" stroke="#183c4e" stroke-width="2"/>
  </svg>`;
}
export function matchResult(a, b) {
  const diff = a.total - b.total;
  return Math.abs(diff) <= 2
    ? "引き分け"
    : diff < 0
      ? "生徒のかち"
      : "先生のかち";
}
export class Games {
  constructor({ host, piano, store, index, getSong, toast }) {
    Object.assign(this, { host, piano, store, index, getSong, toast });
    this.abort = new AbortController();
    this.base = 60;
    this.mode = "menu";
    this.clef = "treble";
    this.host.addEventListener("click", (e) => this.click(e), {
      signal: this.abort.signal,
    });
    this.host.addEventListener("pointerdown", (e) => this.down(e), {
      signal: this.abort.signal,
    });
    for (const ev of ["pointerup", "pointercancel"])
      window.addEventListener(ev, (e) => this.up(e), {
        signal: this.abort.signal,
      });
    this.host.addEventListener(
      "change",
      (e) => {
        if (e.target.id === "clef") this.clef = e.target.value;
      },
      { signal: this.abort.signal },
    );
    this.voices = new Map();
  }
  destroy() {
    this.abort.abort();
    clearInterval(this.timer);
    this.piano.stop();
  }
  mount(mode = "menu") {
    this.mode = mode;
    this.render();
  }
  render() {
    const b = (label, a, cls = "") =>
      `<button class="${cls}" data-game="${a}">${label}</button>`;
    if (this.mode === "menu") {
      this.host.innerHTML = `<div class="page-intro">
  <div class="tag">ひとやすみも、音楽。</div>
  <h2>今日は、何してあそぶ？</h2>
  </div>
  <div class="play-menu">${b('<span class="symbol">♩</span><strong>音ぷタイム勝負</strong><small>同じ10問で、先生と勝負。</small>', "quiz-setup")}${b('<span class="symbol"><span class="lens" aria-hidden="true"></span></span><strong> 曲当て</strong><small>さいしょの音で、わかるかな。</small>', "detective-setup")}${b('<span class="symbol">♬</span><strong>けんばんであそぶ</strong><small>好きな音をならしてみよう。</small>', "keyboard")}</div>`;
    }
    if (this.mode === "quiz-setup")
      this.host.innerHTML = `<div class="stack">
  <h2>音ぷタイム勝負</h2>
  <p>10この音ぷを、けんばんで答えてね。<br>次は先生が同じ問題にちょうせん。</p>
  <label>音ぷをえらぶ<select id="clef">
  <option value="treble" ${this.clef === "treble" ? "selected" : ""}>ト音記号</option>
  <option value="bass" ${this.clef === "bass" ? "selected" : ""}>ヘ音記号</option>
  <option value="both" ${this.clef === "both" ? "selected" : ""}>両方</option>
  </select>
  </label>
  <p class="muted">ミスは1回で2秒。2秒以内の差なら引き分け。</p>${b(`${playerName(this.store.state)}がはじめる`, "quiz-start", "primary")}</div>`;
    if (this.mode === "quiz") {
      const q = this.questions[this.q];
      this.base = q.m < 60 ? 36 : 60;
      this.host.innerHTML = `<div class="game-bar">
  <h2>${this.round === 0 ? playerName(this.store.state) : "先生"}のばん</h2>
  <span class="question-progress">${this.q + 1} / 10</span>
  <span id="game-time">0.0秒</span>
  <span id="game-misses">ミス ${this.misses}回</span>
  </div>${noteStaff(q.m, q.clef)}<div class="game-prompt" role="status">
  <p id="quiz-hint">この音は、どの音？</p>
  </div>${keyboard(this.base)}<div class="flex" style="margin-top:16px">${b("勝負をやめる", "quiz-cancel", "quiet")}</div>`;
    }
    if (this.mode === "between")
      this.host.innerHTML = `<div class="result stack">
  <h2>${playerName(this.store.state)}、できた。</h2>
  <p>${this.results[0].elapsed.toFixed(1)}秒 ＋ ミス${this.results[0].misses}回 × 2秒<br>
  <strong>${this.results[0].total.toFixed(1)}秒</strong>
  </p>
  <p>先生も同じ10問。音ぷはまだひみつ。</p>${b("先生がはじめる", "teacher-start", "primary")}</div>`;
    if (this.mode === "quiz-result") {
      const title = matchResult(...this.results);
      this.host.innerHTML = `<div class="result">
  <div class="tag">音ぷタイム勝負</div>
  <h2 class="result-title">${title === "生徒のかち" ? playerName(this.store.state) + "のかち" : title}</h2>
  <div class="result-times">${this.results
    .map(
      (
        r,
        i,
      ) => `<div>${i === 0 ? playerName(this.store.state) : "先生"}<strong>${r.total.toFixed(1)}秒</strong>
  <small>ミス ${r.misses}回 · 弾いた時間 ${r.elapsed.toFixed(1)}秒</small>
  </div>`,
    )
    .join("")}</div>
  <p>次は、あわてずにひとつずつ。</p>
  <div class="flex" style="justify-content:center;margin-top:16px">${b("もう一度あそぶ", "quiz-setup", "primary")}${b("あそびにもどる", "menu")}</div>
  </div>`;
    }
    if (this.mode === "keyboard")
      this.host.innerHTML = `<div class="page-intro">
  <h2>音をつくってみよう</h2>
  <p class="muted">ふたつの音を、いっしょに鳴らしてもいいよ。</p>
  </div>
  <div class="keyboard-tools">${b("← 低くする", "lower")}<span>${Math.floor(this.base / 12) - 1}〜${Math.floor(this.base / 12)}</span>${b("高くする →", "higher")}</div>${keyboard(this.base)}<div style="margin-top:20px">${b("あそびにもどる", "menu", "quiet")}</div>`;
    if (this.mode === "detective-setup")
      this.host.innerHTML = `<div class="stack">
  <h2> ${playerName(this.store.state)}</h2>
  <p>曲のはじまりをきいて、名前を見つけよう。全部で3問。</p>${b("曲をきいてはじめる", "detective-start", "primary")}</div>`;
    if (this.mode === "detective-loading")
      this.host.innerHTML = '<p role="status">曲をよういしています…</p>';
    if (this.mode === "detective") {
      this.host.innerHTML = `<div class="game-bar">
  <h2>どの曲かな？</h2>
  <span>${this.dq + 1} / 3</span>${b("もう一度きく", "detective-listen")}</div>
  <p id="detective-status" class="game-prompt" role="status">カウントのあと、よくきいてね。</p>
  <div class="answer-grid">${this.choices.map((n) => b(esc(this.index.find((s) => s.no === n).ja), `answer-${n}`)).join("")}</div>`;
    }
    if (this.mode === "detective-result")
      this.host.innerHTML = `<div class="result stack">
  <div class="lens" style="margin:auto" aria-hidden="true">
  </div>
  <h2>3問中 ${this.correct}問、見つけた。</h2>
  <p>きいたことのある曲が、ふえてきたね。</p>${b("もう一度あそぶ", "detective-start", "primary")}${b("あそびにもどる", "menu")}</div>`;
  }
  down(e) {
    const key = e.target.closest("[data-key]");
    if (!key) return;
    e.preventDefault();
    key.setPointerCapture(e.pointerId);
    key.classList.add("pressed");
    this.piano
      .unlock()
      .then(() => {
        if (key.classList.contains("pressed"))
          this.voices.set(
            e.pointerId,
            this.piano.note(+key.dataset.key, undefined, 2),
          );
      })
      .catch(() => this.toast("音が止まっています。もう1回おしてね。"));
    this.answer(+key.dataset.key);
  }
  up(e) {
    const key = e.target.closest("[data-key]");
    key?.classList.remove("pressed");
    const v = this.voices.get(e.pointerId);
    if (v) {
      const t = this.piano.context.currentTime;
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, 0.025);
        v.source.stop(t + 0.15);
      } catch {}
      this.voices.delete(e.pointerId);
    }
  }
  async click(e) {
    const key = e.target.closest("[data-key]");
    if (key && e.detail === 0) {
      try {
        await this.piano.unlock();
      } catch {
        this.toast("音が止まっています。もう1回おしてね。");
        return;
      }
      this.piano.note(+key.dataset.key);
      this.answer(+key.dataset.key);
      return;
    }
    const a = e.target.closest("[data-game]")?.dataset.game;
    if (!a) return;
    if (["menu", "quiz-setup", "keyboard", "detective-setup"].includes(a)) {
      this.piano.stop();
      clearInterval(this.timer);
      this.mode = a;
      this.render();
      return;
    }
    if (a === "quiz-cancel") {
      clearInterval(this.timer);
      this.mode = "quiz-setup";
      this.render();
      return;
    }
    if (a === "lower" || a === "higher") {
      this.base = Math.max(
        24,
        Math.min(84, this.base + (a === "lower" ? -12 : 12)),
      );
      this.render();
    }
    if (a === "quiz-start") {
      this.questions = Array.from({ length: 10 }, () => {
        const clef =
            this.clef === "both"
              ? Math.random() < 0.5
                ? "treble"
                : "bass"
              : this.clef,
          base = clef === "bass" ? 36 : 60;
        return {
          clef,
          m:
            base +
            NAT[Math.floor(Math.random() * 7)] +
            (Math.random() < 0.35 ? 12 : 0),
        };
      });
      this.results = [];
      this.round = 0;
      this.startRound();
    }
    if (a === "teacher-start") {
      this.round = 1;
      this.startRound();
    }
    if (a === "detective-start") {
      this.dq = 0;
      this.correct = 0;
      this.pool = [];
      const played = new Set(
        Object.keys(this.store.state.progress).map((k) => +k.split(":")[0]),
      );
      for (const s of this.index) {
        this.pool.push(s.no);
        if (played.has(s.no)) this.pool.push(s.no, s.no, s.no);
      }
      this.detectiveAsked = new Set();
      await this.nextDetective();
    }
    if (a === "detective-listen") this.listen();
    if (a.startsWith("answer-") && !this.answered) {
      this.answered = true;
      this.piano.stop();
      const right = +a.slice(7) === this.target;
      if (right) this.correct++;
      document.querySelector("#detective-status").textContent = right
        ? "そう、その曲。"
        : "この曲は「" + this.detectiveSong.ja + "」。もう一度きいてみよう。";
      const answers = this.host.querySelectorAll('[data-game^="answer-"]');
      answers.forEach((b) => (b.disabled = true));
      const next = document.createElement("button");
      next.textContent = this.dq === 2 ? "けっかを見る" : "次の曲をきく";
      next.className = "primary";
      next.style.marginTop = "20px";
      next.dataset.game = "detective-next";
      this.host.append(next);
    }
    if (a === "detective-next") {
      this.dq++;
      if (this.dq >= 3) {
        this.mode = "detective-result";
        this.render();
      } else await this.nextDetective();
    }
  }
  startRound() {
    this.q = 0;
    this.misses = 0;
    this.mode = "quiz";
    this.started = performance.now();
    this.render();
    this.busy = false;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      const el = this.host.querySelector("#game-time");
      if (el)
        el.textContent =
          ((performance.now() - this.started) / 1000).toFixed(1) + "秒";
    }, 100);
  }
  answer(m) {
    if (this.mode !== "quiz" || this.busy) return;
    if (m !== this.questions[this.q].m) {
      this.misses++;
      this.host.querySelector("#game-misses").textContent =
        `ミス ${this.misses}回`;
      this.host.querySelector("#quiz-hint").textContent =
        "もう一回、見てみよう。";
      return;
    }
    this.q++;
    if (this.q === 10) {
      clearInterval(this.timer);
      const elapsed = (performance.now() - this.started) / 1000;
      this.results.push({
        elapsed,
        misses: this.misses,
        total: elapsed + this.misses * 2,
      });
      this.mode = this.round === 0 ? "between" : "quiz-result";
      this.render();
    } else {
      this.busy = true;
      queueMicrotask(() => {
        if (this.mode === "quiz") {
          this.render();
          this.busy = false;
        }
      });
    }
  }
  async nextDetective() {
    this.mode = "detective-loading";
    this.render();
    const pool = this.pool.filter((n) => !this.detectiveAsked.has(n));
    this.target = pool[Math.floor(Math.random() * pool.length)];
    this.detectiveAsked.add(this.target);
    try {
      const song = await this.getSong(this.target);
      if (this.abort.signal.aborted) return;
      this.detectiveSong = song;
      this.choices = [
        this.target,
        ...this.index
          .filter((s) => s.no !== this.target)
          .sort(() => Math.random() - 0.5)
          .slice(0, 3)
          .map((s) => s.no),
      ].sort(() => Math.random() - 0.5);
      this.answered = false;
      this.mode = "detective";
      this.render();
      this.listen();
    } catch {
      if (!this.abort.signal.aborted) {
        this.mode = "detective-setup";
        this.render();
        this.toast("曲が届きませんでした。もう一度ためしてね。");
      }
    }
  }
  listen() {
    const song = this.detectiveSong;
    this.piano
      .play(
        song,
        [
          {
            start: song.bars[0].start,
            end: song.bars[Math.min(3, song.bars.length - 1)].end,
          },
        ],
        {
          stage: 3,
          speed: 0.75,
          model: true,
          count: this.store.state.count,
          onFrame: (f) => {
            const el = this.host.querySelector("#detective-status");
            if (el && !this.answered)
              el.textContent = f.count
                ? f.count
                : f.stopped
                  ? "もう一度きいてもいいよ。"
                  : "よくきいてね。";
          },
        },
      )
      .catch(() => this.toast("音が止まっています。もう1回おしてね。"));
  }
}
