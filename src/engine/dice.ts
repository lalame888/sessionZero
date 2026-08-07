export type AdvantageMode = "normal" | "advantage" | "disadvantage";

export interface DiceRollResult {
  diceType: string;
  rolls: number[];
  total: number;
  detail: string;
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function parseDiceType(diceType: string): {
  count: number;
  sides: number;
  modifier: number;
} {
  const cleaned = diceType.trim().toLowerCase().replace(/\s+/g, "");
  const match = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) {
    if (cleaned.includes("100")) return { count: 1, sides: 100, modifier: 0 };
    return { count: 1, sides: 20, modifier: 0 };
  }
  return {
    count: match[1] ? Number(match[1]) : 1,
    sides: Number(match[2]),
    modifier: match[3] ? Number(match[3]) : 0,
  };
}

export function rollDice(
  diceType: string,
  advantageMode: AdvantageMode = "normal",
): DiceRollResult {
  const { count, sides, modifier } = parseDiceType(diceType);

  if (sides === 20 && count === 1 && advantageMode !== "normal") {
    const a = rollDie(20);
    const b = rollDie(20);
    const chosen = advantageMode === "advantage" ? Math.max(a, b) : Math.min(a, b);
    const total = chosen + modifier;
    return {
      diceType,
      rolls: [a, b],
      total,
      detail: `${advantageMode} [${a}, ${b}] → ${chosen}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ""} = ${total}`,
    };
  }

  const rolls = Array.from({ length: count }, () => rollDie(sides));
  const sum = rolls.reduce((acc, n) => acc + n, 0) + modifier;
  return {
    diceType,
    rolls,
    total: sum,
    detail: `[${rolls.join(", ")}]${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ""} = ${sum}`,
  };
}

export function resolveCheckOutcome(
  diceType: string,
  total: number,
  targetValue?: number,
  /** CoC：完整技能％（用於大失敗門檻與成功等級）；缺省則用 targetValue */
  fullSkillValue?: number,
): string {
  if (targetValue == null) return "ROLLED";

  const isD100 = diceType.toLowerCase().includes("100");
  if (isD100) {
    return resolveCocPercentileOutcome(
      total,
      fullSkillValue ?? targetValue,
      targetValue,
    );
  }

  if (total >= targetValue) return "SUCCESS";
  return "FAILURE";
}

/**
 * CoC 7e 百分骰：
 * - 成功條件：roll ≤ 本次門檻（一般=技能，困難=⌊技能/2⌋，極限=⌊技能/5⌋）
 * - 成功品質仍以完整技能切分：≤⌊技能/5⌋ 極限級成功、≤⌊技能/2⌋ 困難級成功、否則普通成功
 *   （與「檢定難度」分開：難度是事先門檻，品質是骰完後的等級）
 * - 大成功 01；大失敗：技能&lt;50 → 96–100，技能≥50 → 僅 100
 */
export function resolveCocPercentileOutcome(
  total: number,
  skill: number,
  threshold: number,
): string {
  if (total === 1) return "CRITICAL_SUCCESS";
  const fumbleFloor = skill >= 50 ? 100 : 96;
  if (total >= fumbleFloor) return "FUMBLE";
  if (total > threshold) return "FAILURE";
  if (total <= Math.floor(skill / 5)) return "EXTREME_SUCCESS";
  if (total <= Math.floor(skill / 2)) return "HARD_SUCCESS";
  return "SUCCESS";
}

export function resolveD20Outcome(
  natural: number,
  total: number,
  targetValue?: number,
): string {
  if (natural === 20) return "CRITICAL_SUCCESS";
  if (natural === 1) return "FUMBLE";
  if (targetValue == null) return "ROLLED";
  return total >= targetValue ? "SUCCESS" : "FAILURE";
}
