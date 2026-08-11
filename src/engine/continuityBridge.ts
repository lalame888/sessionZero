import type { AdventureRecord } from "@/types/characterLibrary";
import type { GameSystemID, UniversalCharacterSheet } from "@/types/game";

/** 銜接模式：連場／幕間／全新起點 */
export type ContinuityMode = "continual" | "interlude" | "fresh";

/**
 * 幕間間隔檔位（僅 interlude 使用）
 * - breath：數小時喘息（≈ D&D 短休／CoC 當夜）
 * - overnight：過夜（≈ D&D 長休／CoC 隔日）
 * - days：數日後勤
 * - weeks：數週休養
 */
export type ContinuityDuration = "breath" | "overnight" | "days" | "weeks";

export interface ContinuityBridgeChoice {
  mode: ContinuityMode;
  /** interlude 必填；continual／fresh 忽略 */
  duration?: ContinuityDuration | null;
}

export interface ContinuityApplyResult {
  sheet: UniversalCharacterSheet;
  lines: string[];
}

export interface ContinuityBridgeState {
  mode: ContinuityMode;
  duration: ContinuityDuration | null;
  /** 注入開場給 GM 的繁中前提 */
  premiseZh: string;
  appliedSummaries: {
    characterId: string;
    name: string;
    lines: string[];
  }[];
}

export const CONTINUITY_MODE_LABELS: Record<ContinuityMode, string> = {
  continual: "連續冒險（幾乎不恢復）",
  interlude: "幕間銜接（依間隔恢復）",
  fresh: "全新起點（滿狀態上場）",
};

export const CONTINUITY_DURATION_LABELS: Record<ContinuityDuration, string> = {
  breath: "喘息（數小時）",
  overnight: "過夜／隔日",
  days: "數日後勤",
  weeks: "數週休養",
};

export const CONTINUITY_MODE_HINTS: Record<ContinuityMode, string> = {
  continual: "地城中途、逃亡途中、同一案件下一段——傷勢與資源原樣進場。",
  interlude: "結案後過一段時間再接新案；依間隔恢復 HP／資源，SAN 休養最多回到 POW。",
  fresh:
    "同角換舞台或想清暫時狀態；HP／MP 回滿，SAN 回到 POW（起始理智），不會灌到 99。",
};

function clampStat(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function healToward(
  current: number,
  max: number,
  amount: number,
): { next: number; gained: number } {
  const next = clampStat(current + amount, max);
  return { next, gained: next - current };
}

/**
 * CoC 休養／滿狀態的 SAN 回復上限。
 * SAN 絕對上限仍是 99−神話，但休息不該把人灌到 99；
 * 「滿狀態」對齊起始理智＝POW（再與 san.max 取較小）。
 */
function cocSanRestCap(sheet: UniversalCharacterSheet): number {
  const pow = Math.max(0, sheet.attributes.POW ?? 0);
  const sanMax = Math.max(0, sheet.derived.san?.max ?? 0);
  if (sanMax <= 0) return pow;
  return Math.min(pow, sanMax);
}

/** 依上一場結局類型建議預設銜接 */
export function suggestContinuityBridge(
  lastEndingType?: string | null,
): ContinuityBridgeChoice {
  const t = (lastEndingType ?? "").toUpperCase();
  if (
    t.includes("BAD") ||
    t.includes("DEATH") ||
    t.includes("INSANE") ||
    t.includes("CLIFF")
  ) {
    return { mode: "continual", duration: null };
  }
  if (t.includes("TRUE") || t.includes("NORMAL") || t.includes("GOOD")) {
    return { mode: "interlude", duration: "days" };
  }
  // 無履歷：預設幕間數日（帶傷上場仍可改成連續）
  if (!lastEndingType) {
    return { mode: "interlude", duration: "days" };
  }
  return { mode: "interlude", duration: "overnight" };
}

export function lastCareerEndingType(
  career: AdventureRecord[] | undefined | null,
): string | null {
  return career?.[0]?.endingType ?? null;
}

function applyCocRecovery(
  sheet: UniversalCharacterSheet,
  choice: ContinuityBridgeChoice,
): ContinuityApplyResult {
  const next = structuredClone(sheet);
  const lines: string[] = [];
  const hpMax = next.derived.hp.max;
  let hp = next.derived.hp.current;
  let san = next.derived.san?.current ?? null;
  const sanRestCap = cocSanRestCap(next);
  let mp = next.derived.mp_or_slots?.current ?? null;
  const mpMax = next.derived.mp_or_slots?.max ?? null;

  if (choice.mode === "continual") {
    lines.push("連續冒險：數值不恢復（承接上一場傷勢與資源）。");
    return { sheet: next, lines };
  }

  if (choice.mode === "fresh") {
    if (hp < hpMax) {
      lines.push(`HP ${hp}→${hpMax}`);
      hp = hpMax;
    }
    if (san != null && san < sanRestCap) {
      lines.push(`SAN ${san}→${sanRestCap}（回到 POW 起始理智）`);
      san = sanRestCap;
    } else if (san != null && sanRestCap > 0 && san >= sanRestCap) {
      // 已達或超過 POW（例如療程曾拉高）：滿狀態不灌到 99，也不強行砍低
      lines.push(`SAN 維持 ${san}（休養上限為 POW ${sanRestCap}）`);
    }
    if (mp != null && mpMax != null && mp < mpMax) {
      lines.push(`MP ${mp}→${mpMax}`);
      mp = mpMax;
    }
    if (!lines.length) lines.push("已是滿狀態。");
  } else {
    const dur = choice.duration ?? "days";
    // MP：隔日以上回滿；喘息回一半缺口
    if (mp != null && mpMax != null && mp < mpMax) {
      if (dur === "breath") {
        const { next: n, gained } = healToward(
          mp,
          mpMax,
          Math.ceil((mpMax - mp) / 2),
        );
        if (gained) {
          lines.push(`MP ${mp}→${n}（喘息回復）`);
          mp = n;
        }
      } else {
        lines.push(`MP ${mp}→${mpMax}`);
        mp = mpMax;
      }
    }

    // HP
    if (hp < hpMax) {
      let amount = 0;
      if (dur === "breath") amount = Math.max(1, Math.ceil(hpMax * 0.15));
      else if (dur === "overnight") amount = Math.max(2, Math.ceil(hpMax * 0.35));
      else if (dur === "days") amount = Math.max(3, Math.ceil(hpMax * 0.7));
      else amount = hpMax; // weeks → 近滿
      const { next: n, gained } = healToward(hp, hpMax, amount);
      if (gained) {
        lines.push(`HP ${hp}→${n}（${CONTINUITY_DURATION_LABELS[dur]}）`);
        hp = n;
      }
    }

    // SAN：慢回，且休養上限＝POW（不朝 99−神話灌滿）
    if (san != null && san < sanRestCap) {
      let amount = 0;
      if (dur === "breath") amount = 0;
      else if (dur === "overnight") amount = 1;
      else if (dur === "days") {
        amount = Math.max(1, Math.floor((sanRestCap - san) * 0.1));
      } else {
        amount = Math.max(2, Math.floor((sanRestCap - san) * 0.25));
      }
      if (amount > 0) {
        const { next: n, gained } = healToward(san, sanRestCap, amount);
        if (gained) {
          lines.push(`SAN ${san}→${n}（休養有限回復，上限 POW）`);
          san = n;
        }
      } else {
        lines.push("SAN 未恢復（間隔過短／克蘇魯節奏）。");
      }
    }

    if (!lines.length) {
      lines.push(`${CONTINUITY_DURATION_LABELS[dur]}：無需額外恢復。`);
    }
  }

  next.derived.hp.current = hp;
  if (next.derived.san && san != null) {
    // 仍不可超過絕對上限（99−神話）
    const absMax = next.derived.san.max;
    next.derived.san.current = clampStat(san, absMax > 0 ? absMax : san);
  }
  if (next.derived.mp_or_slots && mp != null) {
    next.derived.mp_or_slots.current = mp;
  }
  return { sheet: next, lines };
}

function applyDndRecovery(
  sheet: UniversalCharacterSheet,
  choice: ContinuityBridgeChoice,
): ContinuityApplyResult {
  const next = structuredClone(sheet);
  const lines: string[] = [];
  const hpMax = next.derived.hp.max;
  let hp = next.derived.hp.current;
  let slots = next.derived.mp_or_slots?.current ?? null;
  const slotsMax = next.derived.mp_or_slots?.max ?? null;

  if (choice.mode === "continual") {
    lines.push("連續冒險：數值不恢復（地城／逃亡途中常見）。");
    return { sheet: next, lines };
  }

  if (choice.mode === "fresh") {
    if (hp < hpMax) {
      lines.push(`HP ${hp}→${hpMax}`);
      hp = hpMax;
    }
    if (slots != null && slotsMax != null && slots < slotsMax) {
      lines.push(`法術位／資源 ${slots}→${slotsMax}`);
      slots = slotsMax;
    }
    if (!lines.length) lines.push("已是滿狀態。");
  } else {
    const dur = choice.duration ?? "overnight";
    if (dur === "breath") {
      // ≈ 短休：回復一半已失 HP，不回法術位
      const missing = hpMax - hp;
      if (missing > 0) {
        const { next: n, gained } = healToward(
          hp,
          hpMax,
          Math.max(1, Math.ceil(missing / 2)),
        );
        if (gained) {
          lines.push(`HP ${hp}→${n}（短休／喘息）`);
          hp = n;
        }
      } else {
        lines.push("短休：HP 已滿。");
      }
      if (slots != null && slotsMax != null && slots < slotsMax) {
        lines.push("法術位未恢復（短休）。");
      }
    } else {
      // overnight / days / weeks ≈ 長休＋
      if (hp < hpMax) {
        lines.push(`HP ${hp}→${hpMax}（長休）`);
        hp = hpMax;
      }
      if (slots != null && slotsMax != null && slots < slotsMax) {
        lines.push(`法術位／資源 ${slots}→${slotsMax}`);
        slots = slotsMax;
      }
      if (dur === "days" || dur === "weeks") {
        lines.push(
          dur === "weeks"
            ? "數週後勤：暫時狀態視為已清理（永久傷／劇情標記仍保留）。"
            : "數日後勤：可敘事購物／療傷，數值已按長休結算。",
        );
      }
      if (!lines.length) lines.push("長休後無需額外恢復。");
    }
  }

  next.derived.hp.current = hp;
  if (next.derived.mp_or_slots && slots != null) {
    next.derived.mp_or_slots.current = slots;
  }
  return { sheet: next, lines };
}

/** 對單張角色卡套用銜接恢復（不改屬性／技能） */
export function applyContinuityRecovery(
  sheet: UniversalCharacterSheet,
  choice: ContinuityBridgeChoice,
): ContinuityApplyResult {
  const system = sheet.system_id;
  if (system === "COC_7E") return applyCocRecovery(sheet, choice);
  if (system === "DND_5E") return applyDndRecovery(sheet, choice);
  // CUSTOM：比照幕間 overnight／fresh 簡單回血
  if (choice.mode === "continual") {
    return {
      sheet: structuredClone(sheet),
      lines: ["連續冒險：數值不恢復。"],
    };
  }
  const next = structuredClone(sheet);
  const lines: string[] = [];
  if (choice.mode === "fresh" || choice.duration !== "breath") {
    if (next.derived.hp.current < next.derived.hp.max) {
      lines.push(
        `HP ${next.derived.hp.current}→${next.derived.hp.max}`,
      );
      next.derived.hp.current = next.derived.hp.max;
    }
  } else {
    const missing = next.derived.hp.max - next.derived.hp.current;
    if (missing > 0) {
      const before = next.derived.hp.current;
      next.derived.hp.current = clampStat(
        before + Math.ceil(missing / 2),
        next.derived.hp.max,
      );
      lines.push(`HP ${before}→${next.derived.hp.current}`);
    }
  }
  if (!lines.length) lines.push("無需恢復。");
  return { sheet: next, lines };
}

/** 預覽恢復（不寫入） */
export function previewContinuityRecovery(
  sheet: UniversalCharacterSheet,
  choice: ContinuityBridgeChoice,
): ContinuityApplyResult {
  return applyContinuityRecovery(sheet, choice);
}

export function buildContinuityPremiseZh(input: {
  choice: ContinuityBridgeChoice;
  systemId: GameSystemID | null;
  partyLines: { name: string; lines: string[] }[];
}): string {
  const { choice, partyLines } = input;
  const modeLabel = CONTINUITY_MODE_LABELS[choice.mode];
  const durLabel =
    choice.mode === "interlude" && choice.duration
      ? CONTINUITY_DURATION_LABELS[choice.duration]
      : null;

  const header =
    choice.mode === "continual"
      ? "銜接前提：連續冒險——上一場結束後幾乎沒有休息，傷勢與資源原樣承接。"
      : choice.mode === "fresh"
        ? "銜接前提：全新起點——角色以休養／重整後上場：HP／MP 回滿，SAN 回到 POW 起始理智（不會灌到 99；永久後果仍可在敘事中呼應履歷）。"
        : `銜接前提：幕間銜接（${durLabel ?? "數日"}）——距上一場冒險已過一段時間，並已套用對應恢復。`;

  const body = partyLines
    .map((p) => `- ${p.name}：${p.lines.join("；")}`)
    .join("\n");

  return [
    "[CONTINUITY BRIDGE — OPENING PREMISE]",
    header,
    `模式：${modeLabel}${durLabel ? `／${durLabel}` : ""}`,
    "開場敘事必須呼應此銜接（時間間隔、傷勢殘留或已癒、物資狀態），勿無視角色當前 SSOT 數值。",
    "禁止替玩家決定行動；可描述他們帶傷／休養後抵達現場的可見狀態。",
    body ? `已套用恢復摘要：\n${body}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildContinuityBridgeState(
  choice: ContinuityBridgeChoice,
  systemId: GameSystemID | null,
  applied: ContinuityBridgeState["appliedSummaries"],
): ContinuityBridgeState {
  const duration =
    choice.mode === "interlude" ? (choice.duration ?? "days") : null;
  const normalized: ContinuityBridgeChoice = {
    mode: choice.mode,
    duration,
  };
  return {
    mode: normalized.mode,
    duration,
    premiseZh: buildContinuityPremiseZh({
      choice: normalized,
      systemId,
      partyLines: applied.map((a) => ({ name: a.name, lines: a.lines })),
    }),
    appliedSummaries: applied,
  };
}

/** interlude 時正規化 duration */
export function normalizeContinuityChoice(
  choice: ContinuityBridgeChoice,
): ContinuityBridgeChoice {
  if (choice.mode === "interlude") {
    return { mode: "interlude", duration: choice.duration ?? "days" };
  }
  return { mode: choice.mode, duration: null };
}
