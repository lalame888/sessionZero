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
): string {
  if (targetValue == null) return "ROLLED";

  const isD100 = diceType.toLowerCase().includes("100");
  if (isD100) {
    if (total === 1) return "CRITICAL_SUCCESS";
    if (total >= 96) return "FUMBLE";
    if (total <= Math.floor(targetValue / 5)) return "EXTREME_SUCCESS";
    if (total <= Math.floor(targetValue / 2)) return "HARD_SUCCESS";
    if (total <= targetValue) return "SUCCESS";
    return "FAILURE";
  }

  // d20: meet or beat
  if (total === 20 + (parseDiceType(diceType).modifier || 0) && parseDiceType(diceType).sides === 20) {
    // natural 20 approximated when total rolls include 20 - handled loosely
  }
  if (total >= targetValue) return "SUCCESS";
  return "FAILURE";
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
