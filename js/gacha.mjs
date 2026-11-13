import { adventureState } from "./journey.mjs";
import { day } from "./state.mjs";

export const RARITIES = ["N", "R", "SR", "SSR", "UR"];
export const PITY = 8;
export const DEFAULT_RATES = [60, 25, 8, 5, 2];

export function stagesFor(drill) {
  const hands = drill.hands === "R" ? ["R"] :
    drill.hands === "L" ? ["L"] : ["R", "L", "B"];
  return [false, true].flatMap(metro => hands.map(hand => ({
    id: hand + (metro ? "-metro" : ""),
    hand,
    metro,
    rarity: metro ? (hand === "B" ? "SSR" : "SR") :
      (hand === "B" ? "R" : "N"),
    label: (hand === "R" ? "右手" : hand === "L" ? "左手" : "りょう手") +
      (metro ? "・メトロノーム" : hand === "B" ? "" : "だけ")
  })));
}

// 天井を使わない基本抽選も公開し、確率そのものと天井を別に検証する。
export function sampleRarity(rates = DEFAULT_RATES, random = Math.random) {
  let pick = random() * rates.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rates.length; i++) {
    pick -= rates[i];
    if (pick < 0) return RARITIES[i];
  }
  return "UR";
}

export function ratesFor(drill, rates = DEFAULT_RATES) {
  const available = new Set([...stagesFor(drill).map(s => s.rarity), "UR"]);
  const weights = rates.map((rate, i) => available.has(RARITIES[i]) ? rate : 0);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(n => total ? n * 100 / total : 0);
}

export function dailyRemaining(state) {
  const daily = adventureState(state);
  // A clock rollback must not grant another set of draws.
  if (!daily.drawDay || daily.drawDay < day()) {
    daily.drawDay = day();
    daily.dailyDraws = 0;
  }
  return Math.max(0, 5 - daily.dailyDraws);
}

export function drawGacha(state, random = Math.random, drills = [{ hands: "B" }]) {
  const pool = Array.isArray(drills) ? drills : [drills];
  if (!pool.length || state.lastReward) return null;
  const choices = pool.flatMap(drill => stagesFor(drill).map(stage => ({ drill, stage })));
  const guaranteed = state.sinceRare + 1 >= PITY;
  const available = new Set(choices.map(item => item.stage.rarity));
  available.add("UR");
  const rates = state.rates.map((weight, i) => available.has(RARITIES[i]) ? weight : 0);
  let rarity;
  // 先生のガチャの決まり: 8回目はかならず UR。
  if (guaranteed) rarity = "UR";
  else rarity = sampleRarity(rates, random);
  const candidates = choices.filter(item => item.stage.rarity === rarity);
  const item = rarity === "UR" ? null : candidates[Math.floor(random() * candidates.length)];
  if (rarity !== "UR" && !item) return null;
  state.draws++;
  state.sinceRare = rarity === "UR" ? 0 : state.sinceRare + 1;
  return { rarity, guaranteed, drill: item?.drill.id, stage: item?.stage.id || "song",
    label: item?.stage.label || "すきなきょくを1曲" };
}

export function rewardStage(drill, rarity, random = Math.random) {
  if (rarity === "UR") return { id: "song", label: "すきなきょくを1曲" };
  const stages = stagesFor(drill);
  const candidates = stages.filter(s => s.rarity === rarity);
  return candidates[Math.floor(random() * candidates.length)] || null;
}
