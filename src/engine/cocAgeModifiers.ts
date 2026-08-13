import { rollCreationFormula } from "@/engine/creation";

/** CoC 7e 創角年齡帶（Investigator Handbook） */
export type CocAgeBandId =
  | "15-19"
  | "20-39"
  | "40-49"
  | "50-59"
  | "60-69"
  | "70-79"
  | "80+";

export interface CocAgeBandRules {
  id: CocAgeBandId;
  label: string;
  minAge: number;
  maxAge: number;
  /** EDU 增長檢定次數（擲 1D100＞目前 EDU 則 +1D10，上限 99） */
  eduChecks: number;
  /** 年輕組：EDU 直接 −5 */
  eduFlatPenalty: number;
  /** 需由玩家分配的扣點總額 */
  allocatePool: number;
  /** 可分配扣點的特性 */
  allocateKeys: readonly string[];
  /** APP 固定扣除（40+） */
  appFlatPenalty: number;
  /** MOV 減值 */
  movPenalty: number;
  /** 15–19：幸運擲兩次取高 */
  luckRollTwice: boolean;
}

/**
 * 創角年齡修正表。
 * 40+：APP 為固定扣除；STR/CON/DEX 池由玩家自行分配。
 * 15–19：STR/SIZ 合計 −5、EDU −5、幸運取高。
 */
export const COC_AGE_BANDS: readonly CocAgeBandRules[] = [
  {
    id: "15-19",
    label: "15–19 歲",
    minAge: 15,
    maxAge: 19,
    eduChecks: 0,
    eduFlatPenalty: 5,
    allocatePool: 5,
    allocateKeys: ["STR", "SIZ"],
    appFlatPenalty: 0,
    movPenalty: 0,
    luckRollTwice: true,
  },
  {
    id: "20-39",
    label: "20–39 歲",
    minAge: 20,
    maxAge: 39,
    eduChecks: 1,
    eduFlatPenalty: 0,
    allocatePool: 0,
    allocateKeys: [],
    appFlatPenalty: 0,
    movPenalty: 0,
    luckRollTwice: false,
  },
  {
    id: "40-49",
    label: "40–49 歲",
    minAge: 40,
    maxAge: 49,
    eduChecks: 2,
    eduFlatPenalty: 0,
    allocatePool: 5,
    allocateKeys: ["STR", "CON", "DEX"],
    appFlatPenalty: 5,
    movPenalty: 1,
    luckRollTwice: false,
  },
  {
    id: "50-59",
    label: "50–59 歲",
    minAge: 50,
    maxAge: 59,
    eduChecks: 3,
    eduFlatPenalty: 0,
    allocatePool: 10,
    allocateKeys: ["STR", "CON", "DEX"],
    appFlatPenalty: 10,
    movPenalty: 2,
    luckRollTwice: false,
  },
  {
    id: "60-69",
    label: "60–69 歲",
    minAge: 60,
    maxAge: 69,
    eduChecks: 4,
    eduFlatPenalty: 0,
    allocatePool: 20,
    allocateKeys: ["STR", "CON", "DEX"],
    appFlatPenalty: 15,
    movPenalty: 3,
    luckRollTwice: false,
  },
  {
    id: "70-79",
    label: "70–79 歲",
    minAge: 70,
    maxAge: 79,
    eduChecks: 4,
    eduFlatPenalty: 0,
    allocatePool: 40,
    allocateKeys: ["STR", "CON", "DEX"],
    appFlatPenalty: 20,
    movPenalty: 4,
    luckRollTwice: false,
  },
  {
    id: "80+",
    label: "80 歲以上",
    minAge: 80,
    maxAge: 199,
    eduChecks: 4,
    eduFlatPenalty: 0,
    allocatePool: 80,
    allocateKeys: ["STR", "CON", "DEX"],
    appFlatPenalty: 25,
    movPenalty: 5,
    luckRollTwice: false,
  },
] as const;

export const COC_ATTR_FLOOR = 1;
export const COC_EDU_CAP = 99;

/** 從「約28歲」「28」等文字解析年齡數字 */
export function parseAgeYears(ageText: string | undefined | null): number | null {
  if (!ageText?.trim()) return null;
  const m = ageText.match(/(\d{1,3})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function resolveCocAgeBand(ageYears: number): CocAgeBandRules | null {
  if (!Number.isFinite(ageYears) || ageYears < 15) return null;
  for (const band of COC_AGE_BANDS) {
    if (ageYears >= band.minAge && ageYears <= band.maxAge) return band;
  }
  return COC_AGE_BANDS[COC_AGE_BANDS.length - 1] ?? null;
}

export function describeCocAgeBand(band: CocAgeBandRules): string {
  const bits: string[] = [];
  if (band.eduFlatPenalty > 0) bits.push(`EDU −${band.eduFlatPenalty}`);
  if (band.eduChecks > 0) {
    bits.push(`EDU 增長檢定 ×${band.eduChecks}`);
  }
  if (band.allocatePool > 0) {
    bits.push(
      `於 ${band.allocateKeys.join("/")} 合計 −${band.allocatePool}`,
    );
  }
  if (band.appFlatPenalty > 0) bits.push(`APP −${band.appFlatPenalty}`);
  if (band.movPenalty > 0) bits.push(`MOV −${band.movPenalty}`);
  if (band.luckRollTwice) bits.push("幸運擲兩次取高");
  if (!bits.length) bits.push("無額外物理懲罰");
  return bits.join("；");
}

/** 創角頁「年齡修正」標題 hover 說明（含規則書要點） */
export function cocAgeModifiersTooltipContent(): string {
  return [
    "CoC 7e 創角依調查員年齡調整特性與移動力（Age Modifiers）。",
    "",
    "請先在上方身分資料填寫年齡，再按套用。",
    "規則書：依年齡帶調整 EDU／物理特性／MOV；15–19 另擲幸運兩次取高。改屬性會清除已套用的修正。",
    "",
    "年齡帶摘要：",
    "• 15–19：EDU −5；STR／SIZ 合計 −5；幸運擲兩次取高",
    "• 20–39：EDU 增長檢定 ×1",
    "• 40–49：EDU ×2；APP −5；STR／CON／DEX 合計 −5；MOV −1",
    "• 50–59：EDU ×3；APP −10；物理合計 −10；MOV −2",
    "• 60–69：EDU ×4；APP −15；物理合計 −20；MOV −3",
    "• 70–79：EDU ×4；APP −20；物理合計 −40；MOV −4",
    "• 80+：EDU ×4；APP −25；物理合計 −80；MOV −5",
    "",
    "EDU 增長：擲 1D100，若大於目前 EDU 則 +1D10（上限 99）。",
  ].join("\n");
}

export function rollEduImprovementCheck(currentEdu: number): {
  roll: number;
  success: boolean;
  gain: number;
  nextEdu: number;
  detail: string;
} {
  const roll = Math.floor(Math.random() * 100) + 1;
  const success = roll > currentEdu;
  let gain = 0;
  let nextEdu = currentEdu;
  if (success) {
    const d10 = Math.floor(Math.random() * 10) + 1;
    gain = d10;
    nextEdu = Math.min(COC_EDU_CAP, currentEdu + d10);
    gain = nextEdu - currentEdu;
  }
  return {
    roll,
    success,
    gain,
    nextEdu,
    detail: success
      ? `1D100=${roll}＞EDU ${currentEdu} → +${gain}（EDU ${nextEdu}）`
      : `1D100=${roll}≤EDU ${currentEdu} → 無增長`,
  };
}

export function runEduImprovementChecks(
  startingEdu: number,
  count: number,
): { edu: number; log: string[] } {
  let edu = startingEdu;
  const log: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = rollEduImprovementCheck(edu);
    log.push(`第 ${i + 1} 次：${r.detail}`);
    edu = r.nextEdu;
  }
  return { edu, log };
}

export function rollLuckValue(): { total: number; detail: string } {
  return rollCreationFormula("3d6x5");
}

export function rollLuckForAge(luckRollTwice: boolean): {
  chosen: number;
  rolls: number[];
  details: string[];
} {
  const first = rollLuckValue();
  if (!luckRollTwice) {
    return {
      chosen: first.total,
      rolls: [first.total],
      details: [first.detail],
    };
  }
  const second = rollLuckValue();
  const chosen = Math.max(first.total, second.total);
  return {
    chosen,
    rolls: [first.total, second.total],
    details: [first.detail, second.detail],
  };
}

/** 套用固定扣點後，各分配鍵還能再扣多少（不可低於地板） */
export function maxAllocatableForKey(
  baseScore: number,
  flatAlreadyTaken: number,
  floor = COC_ATTR_FLOOR,
): number {
  return Math.max(0, baseScore - flatAlreadyTaken - floor);
}

/**
 * 由基礎屬性 + 年齡帶 + 玩家分配扣點 → 最終屬性。
 * `allocation` 為各鍵扣除量（正數）；未列鍵為 0。
 */
export function buildAttributesAfterAgeMod(opts: {
  baseAttributes: Record<string, number>;
  band: CocAgeBandRules;
  allocation: Record<string, number>;
  /** 已跑完的 EDU 最終值（含 flat／檢定） */
  finalEdu: number;
  luck?: number | null;
}): { attributes: Record<string, number>; errors: string[] } {
  const { baseAttributes, band, allocation, finalEdu, luck } = opts;
  const errors: string[] = [];
  const next: Record<string, number> = { ...baseAttributes };

  next.EDU = Math.max(COC_ATTR_FLOOR, Math.min(COC_EDU_CAP, finalEdu));

  if (band.appFlatPenalty > 0) {
    const app = (baseAttributes.APP ?? 0) - band.appFlatPenalty;
    if (app < COC_ATTR_FLOOR) {
      errors.push(
        `APP 扣除 ${band.appFlatPenalty} 後低於下限 ${COC_ATTR_FLOOR}`,
      );
    }
    next.APP = Math.max(COC_ATTR_FLOOR, app);
  }

  let allocSum = 0;
  for (const key of band.allocateKeys) {
    const take = Math.max(0, Math.floor(allocation[key] ?? 0));
    allocSum += take;
    const base = baseAttributes[key] ?? 0;
    const after = base - take;
    if (after < COC_ATTR_FLOOR) {
      errors.push(`${key} 扣除後不可低於 ${COC_ATTR_FLOOR}`);
    }
    next[key] = Math.max(COC_ATTR_FLOOR, after);
  }

  if (band.allocatePool > 0 && allocSum !== band.allocatePool) {
    errors.push(
      `扣點分配須剛好 ${band.allocatePool}（目前 ${allocSum}）`,
    );
  }

  if (luck != null && Number.isFinite(luck) && luck > 0) {
    next.LUCK = Math.floor(luck);
  }

  return { attributes: next, errors };
}

export function emptyAllocation(
  keys: readonly string[],
): Record<string, number> {
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

export function sumAllocation(allocation: Record<string, number>): number {
  return Object.values(allocation).reduce((a, b) => a + Math.max(0, b), 0);
}

/** 創角完成前：已套用且扣點分配正確 */
export function isCocAgeModComplete(mod: {
  complete?: boolean;
  bandId?: string;
  allocation?: Record<string, number>;
} | null | undefined): boolean {
  if (!mod?.complete) return false;
  const band = COC_AGE_BANDS.find((b) => b.id === mod.bandId);
  if (!band) return false;
  if (band.allocatePool <= 0) return true;
  return sumAllocation(mod.allocation ?? {}) === band.allocatePool;
}
