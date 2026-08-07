import { abilityModifier } from "@/engine/formulas";
import type {
  AttributeDef,
  GameSystemID,
  UniversalCharacterSheet,
} from "@/types/game";

const COC_ATTR: Record<string, string> = {
  STR: "力量：影響近戰傷害、舉重、扭打與體格／傷害加值（與 SIZ 合計查表）。",
  CON: "體質：影響生命值上限與抵抗傷害／疾病的韌性（與 SIZ 合計決定 HP）。",
  SIZ: "體型：身高體重的綜合；影響 HP、傷害加值／體格，並參與移動力比較。",
  DEX: "敏捷：影響閃避基礎值（floor(DEX/2)）、先攻與靈巧相關檢定。",
  APP: "外貌：第一印象與魅力社交；不直接進入 HP／SAN 公式。",
  INT: "智力：影響點子點／興趣技能點池（常見公式 INT×2）與理解推論。",
  POW: "意志：等於起始 SAN，並決定魔力點 MP＝floor(POW/5)。",
  EDU: "教育：學識與職業技能點池（常見公式 EDU×4）。",
  LUCK: "幸運：常以擲骰產生；可用於抵銷失敗或改善結果（依房規）。",
};

const DND_ATTR: Record<string, string> = {
  STR: "力量：近戰攻擊／傷害、運動與負重；調整值＝floor((分數−10)/2)。",
  DEX: "敏捷：AC、先攻、遠程與靈巧豁免；調整值影響無甲 AC。",
  CON: "體質：生命值與專注豁免；HP 公式會加上 CON 調整值。",
  INT: "智力：知識、調查與部分施法職關鍵屬性。",
  WIS: "感知：洞察、醫療、求生與牧師／遊俠等關鍵屬性。",
  CHA: "魅力：社交、欺瞞、威嚇與術士／吟遊詩人等關鍵屬性。",
  LEVEL: "等級：創角預設 1。影響熟練加值與生命值成長（每升一級加生命骰平均＋CON）。",
  HIT_DIE: "生命骰面數：由職業決定（戰士 d10、法師 d6 等）。創角預設 10，可之後依職業調整。1 級 HP＝生命骰最大值＋CON 調整值。",
  ARMOR_BONUS: "護甲加值：疊在基礎 AC（10＋DEX 調整）上。創角預設 0，穿上護甲或持盾後再改。",
};

/** 解釋創角擲骰公式字串（給玩家看） */
export function describeDiceFormula(formula?: string): string {
  if (!formula?.trim()) return "";
  const f = formula.toLowerCase().replace(/\s/g, "");
  if (f === "4d6dl1") {
    return "公式 4d6dl1：擲 4 顆 d6，去掉最低一顆後加總（D&D 常見擲骰創角）。";
  }
  if (f === "3d6x5") {
    return "公式 3d6×5：擲 3d6 加總後再 ×5，得到克蘇魯神話的百分制特性。";
  }
  if (f === "2d6+6x5" || f === "(2d6+6)x5") {
    return "公式 (2d6+6)×5：下限較高的百分制特性（常用於體型／智力／教育）。";
  }
  if (/^\d+d\d+dl\d+$/.test(f)) {
    return `公式 ${formula}：多顆骰去掉若干最低後加總。`;
  }
  if (/x\d+$/.test(f)) {
    return `公式 ${formula}：先依骰式結算，再乘上尾數倍率。`;
  }
  return `擲骰公式：${formula}`;
}

export function attributeMeaning(
  systemId: GameSystemID,
  key: string,
): string {
  if (systemId === "DND_5E") return DND_ATTR[key] ?? `屬性 ${key}。`;
  return COC_ATTR[key] ?? `特性 ${key}。`;
}

/** 主屬性列的完整 tooltip（意義＋來源公式） */
export function attributeTooltipContent(
  systemId: GameSystemID,
  def: AttributeDef,
  opts?: {
    mode?: string;
    score?: number;
    modifier?: number;
    /** 預設 true；冒險進行中可關，不顯示創角擲骰公式 */
    includeDiceFormula?: boolean;
  },
): string {
  const lines: string[] = [attributeMeaning(systemId, def.key)];

  if (opts?.includeDiceFormula !== false) {
    const dice = describeDiceFormula(def.dice_formula);
    if (dice) lines.push(dice);
  }

  if (opts?.mode === "ARRAY") {
    lines.push("標準陣列：從此模式提供的互斥分數中擇一指派，不可重複使用同一格。");
  } else if (opts?.mode === "POINT_BUY") {
    lines.push("購點制：在預算內調整分數；花費依分數表計算，較高分數較貴。");
  } else if (opts?.mode === "DICE" || opts?.mode === "SKILL_ALLOC") {
    lines.push("擲骰鎖定：結果由骰式產生後寫入角色卡，不可任意手填。");
  }

  if (
    systemId === "DND_5E" &&
    opts?.score != null &&
    opts.score > 0 &&
    !["LEVEL", "HIT_DIE", "ARMOR_BONUS"].includes(def.key)
  ) {
    const mod = opts.modifier ?? abilityModifier(opts.score);
    lines.push(
      `目前分數 ${opts.score} → 調整值 ${mod >= 0 ? "+" : ""}${mod}（floor((分數−10)/2)）。`,
    );
  }

  if (
    systemId === "COC_7E" &&
    opts?.score != null &&
    opts.score > 0
  ) {
    const half = Math.floor(opts.score / 2);
    const fifth = Math.floor(opts.score / 5);
    lines.push(
      `百分制檢定參考：一般難度 ≤${opts.score}；困難難度 ≤${half}；極限難度 ≤${fifth}。成功品質另依骰值：普通／困難級（半值）／極限級（⅕）。`,
    );
  }

  return lines.join("\n\n");
}

export type DerivedTooltipRow = {
  id: string;
  label: string;
  display: string;
  content: string;
};

/** 依目前角色卡組出衍生數值列＋公式說明（含代入） */
export function buildDerivedTooltipRows(
  sheet: UniversalCharacterSheet,
): DerivedTooltipRow[] {
  const a = sheet.attributes;
  const rows: DerivedTooltipRow[] = [];

  if (sheet.system_id === "COC_7E") {
    const con = a.CON ?? 0;
    const siz = a.SIZ ?? 0;
    const pow = a.POW ?? 0;
    const dex = a.DEX ?? 0;
    const str = a.STR ?? 0;
    const hpMax = sheet.derived.hp.max;
    const mpMax = sheet.derived.mp_or_slots?.max ?? 0;
    const sanMax = sheet.derived.san?.max ?? 0;
    const dodge = sheet.derived.dodge ?? 0;
    const mov = sheet.derived.mov ?? 0;
    const build = sheet.derived.build ?? 0;
    const db = sheet.derived.damage_bonus ?? "0";

    rows.push({
      id: "hp",
      label: "HP",
      display: `${sheet.derived.hp.current}/${hpMax}`,
      content: [
        "生命值：承受傷害的上限。",
        `公式：floor((CON＋SIZ)/10)`,
        `代入：floor((${con}＋${siz})/10)＝${hpMax}`,
      ].join("\n"),
    });
    rows.push({
      id: "san",
      label: "SAN",
      display: `${sheet.derived.san?.current ?? 0}/${sanMax}`,
      content: [
        "理智值：面對超自然衝擊時消耗；歸零會陷入崩潰。",
        "公式：起始 SAN＝POW（最大值通常亦為 POW）",
        `代入：POW ${pow} → SAN 上限 ${sanMax}`,
      ].join("\n"),
    });
    rows.push({
      id: "mp",
      label: "MP",
      display: `${sheet.derived.mp_or_slots?.current ?? 0}/${mpMax}`,
      content: [
        "魔力點：施法／神話力量消耗。",
        "公式：floor(POW/5)",
        `代入：floor(${pow}/5)＝${mpMax}`,
      ].join("\n"),
    });
    rows.push({
      id: "dodge",
      label: "閃避",
      display: String(dodge),
      content: [
        "閃避基礎％：創角時若技能尚未分配，會同步寫入技能「閃避」。",
        "公式：floor(DEX/2)",
        `代入：floor(${dex}/2)＝${dodge}`,
      ].join("\n"),
    });
    rows.push({
      id: "mov",
      label: "MOV",
      display: String(mov || "—"),
      content: [
        "移動力：戰鬥／追逐中的每回合移動距離等級。",
        "簡表：",
        "• STR 與 DEX 都＜SIZ → MOV 7",
        "• STR 與 DEX 都＞SIZ → MOV 9",
        "• 其餘（含相等）→ MOV 8",
        `代入：STR ${str}、DEX ${dex}、SIZ ${siz} → MOV ${mov || "—"}`,
      ].join("\n"),
    });
    rows.push({
      id: "build",
      label: "體格",
      display: String(build),
      content: [
        "體格：用於摔角、擒抱等體型對抗。",
        "依 STR＋SIZ 查表（節錄）：",
        "≤64 → −2　≤84 → −1　≤124 → 0",
        "≤164 → +1　≤204 → +2　≤284 → +3 …",
        `代入：STR＋SIZ＝${str}+${siz}＝${str + siz} → 體格 ${build}`,
      ].join("\n"),
    });
    rows.push({
      id: "db",
      label: "DB",
      display: String(db),
      content: [
        "傷害加值（Damage Bonus）：近戰成功時加在傷害骰上。",
        "依 STR＋SIZ 查表（節錄）：",
        "≤64 → −2　≤84 → −1　≤124 → 0",
        "≤164 → +1D4　≤204 → +1D6　≤284 → +2D6 …",
        `代入：STR＋SIZ＝${str}+${siz}＝${str + siz} → DB ${db}`,
      ].join("\n"),
    });
    return rows;
  }

  if (sheet.system_id === "DND_5E") {
    const level = Number(a.LEVEL ?? 1);
    const hitDie = Number(a.HIT_DIE ?? 10);
    const armorBonus = Number(a.ARMOR_BONUS ?? 0);
    const con = a.CON ?? 0;
    const dex = a.DEX ?? 0;
    const conMod = abilityModifier(con);
    const dexMod = abilityModifier(dex);
    const hpMax = sheet.derived.hp.max;
    const ac = sheet.derived.ac ?? 10;
    const prof = sheet.derived.proficiency_bonus ?? 2;
    const avgPerLevel = Math.floor(hitDie / 2) + 1 + conMod;

    rows.push({
      id: "hp",
      label: "HP",
      display: `${sheet.derived.hp.current}/${hpMax}`,
      content: [
        "生命值：1 級為生命骰最大值＋CON 調整；之後每級約為「骰面平均＋CON」。",
        "公式：HIT_DIE＋CON_MOD＋(LEVEL−1)×(floor(HIT_DIE/2)＋1＋CON_MOD)",
        `代入：${hitDie}＋${conMod}＋(${level}−1)×(${Math.floor(hitDie / 2)}＋1＋${conMod})`,
        `＝${hitDie + conMod}＋${Math.max(0, level - 1)}×${avgPerLevel}＝${hpMax}`,
      ].join("\n"),
    });
    rows.push({
      id: "ac",
      label: "AC",
      display: String(ac),
      content: [
        "護甲等級：被命中的難度。",
        "公式（無甲簡化）：10＋DEX_MOD＋ARMOR_BONUS",
        `代入：10＋${dexMod}＋${armorBonus}＝${ac}`,
      ].join("\n"),
    });
    rows.push({
      id: "prof",
      label: "熟練加值",
      display: `+${prof}`,
      content: [
        "熟練加值：加在熟練的攻擊、豁免、技能與工具檢定上。",
        "公式：2＋floor((LEVEL−1)/4)",
        `代入：2＋floor((${level}−1)/4)＝${prof}`,
      ].join("\n"),
    });
    if (sheet.profile_dnd?.speed != null) {
      rows.push({
        id: "speed",
        label: "速度",
        display: String(sheet.profile_dnd.speed),
        content:
          "步行速度（英尺／回合）。多數種族預設 30；由種族／特性決定，非屬性公式自動算出。",
      });
    }
  }

  return rows;
}

/** D&D 系統固定參數（非六維配點） */
export function buildFixedAttrTooltipRows(
  sheet: UniversalCharacterSheet,
): DerivedTooltipRow[] {
  if (sheet.system_id !== "DND_5E") return [];
  const keys: { key: string; label: string }[] = [
    { key: "LEVEL", label: "等級" },
    { key: "HIT_DIE", label: "生命骰" },
    { key: "ARMOR_BONUS", label: "護甲加值" },
  ];
  return keys.map(({ key, label }) => {
    const v = sheet.attributes[key];
    return {
      id: key,
      label,
      display: v != null ? String(v) : "—",
      content: attributeTooltipContent("DND_5E", {
        key,
        label,
      }),
    };
  });
}

/** 技能點池公式說明 */
export function skillPoolFormulaTooltip(
  label: "職業" | "興趣",
  formula: string,
  attributes: Record<string, number>,
  budget: number,
): string {
  const scope = Object.entries(attributes)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join("，");
  return [
    `${label}技能點池由屬性公式決定，配點時請參考此上限。`,
    `公式：${formula || "（藍圖未提供）"}`,
    scope ? `目前屬性：${scope}` : "屬性尚未就緒。",
    `計算結果：${budget}`,
  ].join("\n");
}
