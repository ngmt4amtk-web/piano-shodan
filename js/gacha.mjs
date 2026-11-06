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

export function drawGacha(state, random = Math.random, drill = { hands: "B" }) {
  if (!dailyRemaining(state)) return null;
  const daily = adventureState(state);
  if (state.credits < 1) return null;
  const guaranteed = state.sinceRare + 1 >= PITY;
  const rarity = guaranteed ? "UR" : sampleRarity(ratesFor(drill, state.rates), random);
  state.credits--;
  state.draws++;
  daily.dailyDraws++;
  state.sinceRare = rarity === "UR" ? 0 : state.sinceRare + 1;
  return { rarity, guaranteed };
}

export function rewardStage(drill, rarity, random = Math.random) {
  if (rarity === "UR") return { id: "song", label: "すきなきょくを1曲" };
  const stages = stagesFor(drill);
  const candidates = stages.filter(s => s.rarity === rarity);
  return candidates[Math.floor(random() * candidates.length)] || null;
}
