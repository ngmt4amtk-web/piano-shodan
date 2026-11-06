// Short lessons are assembled from the unchanged drill events.
export const QUESTION_TYPES = ["play", "mimic", "finger", "note", "listen", "rhythm", "teacher"];

export const BUDDY_LINES = [
  "やるじゃん。", "ふーん、できるんだ。", "今の、いい音。", "もう1こ、いく？",
  "ぼくも本気出すか。", "そのゆび、いいね。", "あ、そろった。", "きみのばんだよ。",
  "ちょっと聞かせて。", "つぎ、まかせた。", "ぼくの耳はごまかせない。", "今の、すき。",
  "おっ、上がった。", "下がるのも、いいね。", "左手、起きたね。", "右手、のってるね。",
  "その音、もう1回。", "あわてなくていいよ。", "ぼくはここにいるよ。", "ちょっとずつ、いこう。",
  "そのちょうし。", "よし、いっしょに。", "耳の出番だ。", "ゆびの出番だ。",
  "先生に見せちゃお。", "ぼくよりうまいかも。", "もう聞こえてるよ。", "お、つながった。",
  "そのリズム、もらった。", "きみが決めて。", "今日はどっち？", "いいこと思いついた？",
  "ぼくもまねしていい？", "なんだ、できるじゃん。", "おっと、見てたよ。", "いっしょなら、いける。"
];

export const WORLDS = [
  { name: "はじまりの音の丘", color: "coral", boss: "boss-tanuki-1", hurt: "boss-tanuki-3", down: "boss-tanuki-4", title: "タクトだぬき" },
  { name: "ねむねむの森", color: "purple", boss: "boss-lefthand-1", hurt: "boss-lefthand-4", down: "boss-lefthand-5", title: "ねぼすけの左手" },
  { name: "わおんのどうくつ", color: "gold", boss: "boss-set1-1", hurt: "boss-set1-2", down: "boss-set1-2", title: "三つ首ドラゴン" },
  { name: "ふたごのビーチ", color: "blue", boss: "boss-set1-3", hurt: "boss-set1-4", down: "boss-set1-4", title: "ふたごのカニ" },
  { name: "ドンドコの山", color: "coral", boss: "boss-set1-5", hurt: "boss-set1-6", down: "boss-set1-6", title: "ドンドコゴリラ" },
  { name: "おひっこしの島", color: "gold", boss: "boss-set2-1", hurt: "boss-set2-2", down: "boss-set2-2", title: "おひっこしヤドカリ" },
  { name: "リズムの空", color: "blue", boss: "boss-set2-3", hurt: "boss-set2-4", down: "boss-set2-4", title: "おしゃべりムクドリ" },
  { name: "星のむこう", color: "purple", boss: "boss-set2-5", hurt: "boss-set2-6", down: "boss-set2-6", title: "星のおばけ" },
  { name: "きょくのたから島", color: "gold" }
];

export function adventureState(shodan) {
  const original = shodan.adventure;
  const a = original && typeof original === "object" && !Array.isArray(original) ? original : {};
  const record = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  a.completed = record(a.completed);
  // v2 progress always survives, including a previously created empty v3 map.
  for (const [key, value] of Object.entries(shodan.done || {}))
    if (value === true) a.completed[key.split(":")[0]] = true;
  a.bosses = record(a.bosses);
  a.bossNames = record(a.bossNames);
  a.discoveries = Array.isArray(a.discoveries) ? a.discoveries.filter(x => x && typeof x.text === "string") : [];
  a.compositions = Array.isArray(a.compositions) ? a.compositions.filter(x => x && Array.isArray(x.notes) && x.notes.length === 8 && x.notes.every(n => Number.isInteger(n) && n >= 21 && n <= 108)) : [];
  a.weeks = Array.isArray(a.weeks) ? a.weeks.filter(Number.isInteger) : [];
  a.xp = Number.isSafeInteger(a.xp) && a.xp >= 0 ? a.xp : 0;
  a.buddy = typeof a.buddy === "string" ? a.buddy.slice(0, 20) : "ポチ";
  a.dailyDraws = Number.isSafeInteger(a.dailyDraws) && a.dailyDraws >= 0 ? a.dailyDraws : 0;
  a.breaks = Number.isSafeInteger(a.breaks) && a.breaks >= 0 ? a.breaks : 0;
  a.input = ["mic", "keys", "teacher"].includes(a.input) ? a.input : "mic";
  if (!a.resume || typeof a.resume.id !== "string" || !Number.isInteger(a.resume.index) || a.resume.index < 0 || a.resume.index > 6) a.resume = null;
  if (a.resume) {
    for (const field of ["combo", "best", "correct"]) {
      if (!Number.isInteger(a.resume[field]) || a.resume[field] < 0 || a.resume[field] > 7) a.resume[field] = 0;
    }
  }
  if (!Number.isFinite(a.restUntil) || a.restUntil < 0) a.restUntil = 0;
  a.restUntil = Math.min(a.restUntil, Date.now() + 30000);
  shodan.adventure = a;
  return a;
}

export function weekNumber(now = Date.now()) {
  // Monday-based weeks, without a dependence on ISO year boundaries.
  const date = new Date(now);
  const localMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((localMidnight + 3 * 86400000) / (7 * 86400000));
}

export function streak(weeks, now = Date.now()) {
  const current = weekNumber(now);
  let cursor = weeks.includes(current) ? current : current - 1;
  let count = 0;
  while (weeks.includes(cursor--)) count++;
  return count;
}

export function needsBreak(a, start, now = Date.now()) {
  return Number.isFinite(start) && start > 0 && now - start >= (a.breaks + 1) * 480000;
}

export function battleResult(child, teacher, timedOut = false) {
  if (timedOut) return "lose";
  if (Math.abs(child - teacher) <= 2) return "draw";
  return child > teacher ? "win" : "lose";
}

export function buildLesson(drill, previous = drill, pos = drill.pos[0]) {
  const position = drill.positions[pos];
  const hand = drill.hands === "L" ? "L" : "R";
  const source = position.events[hand];
  const earlyHand = previous.hands === "L" ? "L" : "R";
  const early = previous.positions[previous.pos[0]].events[earlyHand];
  const single = items => items.filter((n, i) => !items.slice(0, i).some(p => p.t === n.t));
  const question = (type, events, extra = {}) => ({ type, events: events.map(n => ({ ...n })), hand, ...extra });
  const simple = single(source);
  const chord = drill.hands === "B" || new Set(source.map(n => n.t)).size !== source.length;
  const allHands = drill.hands === "B" ? [...position.events.R, ...position.events.L].sort((a, b) => a.t - b.t || a.m - b.m) : source;
  const barTimes = [...new Set(source.map(n => Math.floor(n.gt ?? n.t)))];
  const firstGroups = (events, limit = 8) => {
    const times = [...new Set(events.map(n => n.t))];
    let count = 0;
    const chosen = [];
    for (const t of times) {
      const group = events.filter(n => n.t === t);
      if (count && count + group.length > limit) break;
      chosen.push(...group);
      count += group.length;
    }
    return chosen;
  };
  const middle = source.filter(n => Math.floor(n.gt ?? n.t) === (barTimes[1] ?? barTimes[0])).slice(0, 8);
  return [
    question("play", single(early).slice(0, 4), { hand: earlyHand, warmup: true, drillId: previous.id }),
    question(simple.some(n => n.f) ? "finger" : "note", [simple.find(n => n.f) || simple[0]]),
    question("listen", simple.slice(0, 2)),
    question(chord ? "teacher" : "note", chord ? firstGroups(allHands) : simple.slice(0, 1), { hand: drill.hands === "B" ? "B" : hand }),
    question(chord ? "teacher" : "mimic", chord ? firstGroups(allHands) : middle.length ? middle : source.slice(0, 4), { hand: drill.hands === "B" ? "B" : hand }),
    question("rhythm", simple.slice(0, 4)),
    question(chord ? "teacher" : "play", chord ? allHands : source, { finale: true, hand: drill.hands === "B" ? "B" : hand })
  ];
}
