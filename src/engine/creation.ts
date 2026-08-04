import { evaluate } from "mathjs";
import { rollDice } from "@/engine/dice";
import type {
  AttributeDef,
  CharacterSchemaState,
  CreationMode,
  CreationModeConfig,
  GameSystemID,
  PointBuyConfig,
  UniversalCharacterSheet,
} from "@/types/game";

export const DND_POINT_BUY_COST: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export function defaultAttributeDefs(systemId: GameSystemID): AttributeDef[] {
  if (systemId === "DND_5E") {
    return [
      { key: "STR", label: "力量", dice_formula: "4d6dl1" },
      { key: "DEX", label: "敏捷", dice_formula: "4d6dl1" },
      { key: "CON", label: "體質", dice_formula: "4d6dl1" },
      { key: "INT", label: "智力", dice_formula: "4d6dl1" },
      { key: "WIS", label: "感知", dice_formula: "4d6dl1" },
      { key: "CHA", label: "魅力", dice_formula: "4d6dl1" },
    ];
  }
  return [
    { key: "STR", label: "力量", dice_formula: "3d6x5" },
    { key: "CON", label: "體質", dice_formula: "3d6x5" },
    { key: "SIZ", label: "體型", dice_formula: "2d6+6x5" },
    { key: "DEX", label: "敏捷", dice_formula: "3d6x5" },
    { key: "APP", label: "外貌", dice_formula: "3d6x5" },
    { key: "INT", label: "智力", dice_formula: "2d6+6x5" },
    { key: "POW", label: "意志", dice_formula: "3d6x5" },
    { key: "EDU", label: "教育", dice_formula: "2d6+6x5" },
  ];
}

/** 依 key 取得繁中屬性名（藍圖優先，否則系統預設） */
export function resolveAttributeLabel(
  systemId: GameSystemID,
  key: string,
  defs?: AttributeDef[] | null,
): string {
  const fromDefs = defs?.find((d) => d.key === key)?.label?.trim();
  if (fromDefs) return fromDefs;
  const fallback = defaultAttributeDefs(systemId).find((d) => d.key === key);
  return fallback?.label ?? key;
}

/** 解析屬性定義（含 dice_formula），供 tooltip 使用 */
export function resolveAttributeDef(
  systemId: GameSystemID,
  key: string,
  defs?: AttributeDef[] | null,
): AttributeDef {
  const fromDefs = defs?.find((d) => d.key === key);
  if (fromDefs) return fromDefs;
  return (
    defaultAttributeDefs(systemId).find((d) => d.key === key) ?? {
      key,
      label: key,
    }
  );
}

export function defaultStandardArray(systemId: GameSystemID): number[] {
  // 規格：D&D [15,14,13,12,10,8]；CoC [80,70,60,60,50,50,40,40]
  return systemId === "DND_5E"
    ? [15, 14, 13, 12, 10, 8]
    : [80, 70, 60, 60, 50, 50, 40, 40];
}

/**
 * ARRAY 模式：陣列長度必須等於屬性數（D&D 6／CoC 8）。
 * AI 常誤給 D&D [15,14,…] 給 CoC；長度不符時改用系統預設。
 */
export function resolveStandardArray(opts: {
  systemId: GameSystemID;
  attributeCount: number;
  candidate?: number[] | null;
}): {
  array: number[];
  source: "ai" | "default" | "corrected";
} {
  const { systemId, attributeCount, candidate } = opts;
  const fallback = defaultStandardArray(systemId);
  const cleaned = (candidate ?? []).filter(
    (n) => typeof n === "number" && Number.isFinite(n),
  );

  if (attributeCount > 0 && cleaned.length === attributeCount) {
    return { array: cleaned.slice(), source: "ai" };
  }

  if (attributeCount > 0 && fallback.length === attributeCount) {
    return {
      array: fallback.slice(),
      source: cleaned.length > 0 ? "corrected" : "default",
    };
  }

  // 自訂屬性數：有候選且長度對得上已在上方處理；否則裁切／補齊預設
  const base = cleaned.length > 0 ? cleaned : fallback;
  if (attributeCount <= 0) {
    return {
      array: base.slice(),
      source: cleaned.length > 0 ? "ai" : "default",
    };
  }
  if (base.length >= attributeCount) {
    return {
      array: base.slice(0, attributeCount),
      source: cleaned.length === attributeCount ? "ai" : "corrected",
    };
  }
  const padded = base.slice();
  const padValue =
    systemId === "DND_5E" ? 10 : Math.round((fallback[4] ?? 50) / 10) * 10;
  while (padded.length < attributeCount) padded.push(padValue);
  return { array: padded, source: "corrected" };
}

export function defaultPointBuy(systemId: GameSystemID): PointBuyConfig {
  if (systemId === "DND_5E") {
    return { budget: 27, min_score: 8, max_score: 15 };
  }
  return { budget: 460, min_score: 40, max_score: 90 };
}

export function defaultModeConfig(systemId: GameSystemID): CreationModeConfig {
  if (systemId === "DND_5E") {
    return {
      point_buy_pool: 27,
      standard_array: defaultStandardArray("DND_5E"),
      min_score: 8,
      max_score: 15,
    };
  }
  return {
    point_buy_pool: 460,
    standard_array: defaultStandardArray("COC_7E"),
    occupational_point_formula: "EDU * 4",
    interest_point_formula: "INT * 2",
    min_score: 40,
    max_score: 90,
  };
}

export function defaultHookCategories(systemId: GameSystemID): string[] {
  if (systemId === "DND_5E") {
    return ["個性特質", "理想", "羈絆", "缺點"];
  }
  return ["信念/信仰", "重要之人", "意義非凡的地點", "珍視之物"];
}

export function defaultBackgroundQuestions(
  systemId: GameSystemID,
): import("@/types/game").BackstoryHookQuestion[] {
  if (systemId === "DND_5E") {
    return [
      {
        id: "traits",
        category: "個性特質",
        question: "你有哪些顯而易見的個性特質？（言談、習慣、舉止）",
      },
      {
        id: "ideals",
        category: "理想",
        question: "你追求什麼理想？什麼原則會讓你破例或堅持到底？",
      },
      {
        id: "bonds",
        category: "羈絆",
        question: "你最在意的人、地或事物是什麼？它如何牽動你的行動？",
      },
      {
        id: "flaws",
        category: "缺點",
        question: "你最大的弱點或盲點是什麼？壓力下會暴露什麼？",
      },
    ];
  }
  return [
    {
      id: "belief",
      category: "信念/信仰",
      question: "你堅信什麼？這信念來自何處，又如何影響你面對未知？",
    },
    {
      id: "person",
      category: "重要之人",
      question: "誰對你最重要？你們的關係如何，對方如今身在何處？",
    },
    {
      id: "place",
      category: "意義非凡的地點",
      question: "哪個地方對你意義重大？為何它會在夢中或回憶裡反覆出現？",
    },
    {
      id: "treasure",
      category: "珍視之物",
      question: "你最珍視的物品是什麼？失去它會對你造成什麼打擊？",
    },
  ];
}

/** 相容 AI 回傳 string[] 或結構化物件 */
export function normalizeBackgroundQuestions(
  raw: unknown,
  systemId: GameSystemID,
): import("@/types/game").BackstoryHookQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaultBackgroundQuestions(systemId);
  }
  return raw.map((item, i) => {
    if (typeof item === "string") {
      const cats = defaultHookCategories(systemId);
      return {
        id: `q${i}`,
        category: cats[i] ?? "背景",
        question: item,
      };
    }
    const obj = item as {
      id?: string;
      category?: string;
      question?: string;
    };
    return {
      id: obj.id || `q${i}`,
      category: obj.category || "背景",
      question: obj.question || String(item),
    };
  });
}

/** 解析：4d6dl1 | 3d6x5 | 2d6+6x5 | NdM */
export function rollCreationFormula(formula: string): {
  total: number;
  detail: string;
} {
  const f = formula.trim().toLowerCase().replace(/\s+/g, "");

  const dl = f.match(/^(\d*)d(\d+)dl(\d+)$/);
  if (dl) {
    const count = Number(dl[1] || 1);
    const sides = Number(dl[2]);
    const drop = Number(dl[3]);
    const rolls = Array.from(
      { length: count },
      () => Math.floor(Math.random() * sides) + 1,
    ).sort((a, b) => a - b);
    const kept = rolls.slice(drop);
    const total = kept.reduce((s, n) => s + n, 0);
    return {
      total,
      detail: `${formula} [${rolls.join(",")}]→[${kept.join(",")}] = ${total}`,
    };
  }

  const mul = f.match(/^(\d*)d(\d+)(?:\+(\d+))?x(\d+)$/);
  if (mul) {
    const count = Number(mul[1] || 1);
    const sides = Number(mul[2]);
    const add = Number(mul[3] || 0);
    const times = Number(mul[4]);
    const rolled = rollDice(`${count}d${sides}`);
    const inner = rolled.total + add;
    const total = inner * times;
    return {
      total,
      detail: `${formula} (${rolled.detail}${add ? `+${add}` : ""})×${times} = ${total}`,
    };
  }

  const plain = rollDice(f.includes("d") ? f : "3d6");
  return { total: plain.total, detail: plain.detail };
}

export function pointBuyCost(score: number, config: PointBuyConfig): number {
  if (config.cost_table && config.cost_table[String(score)] != null) {
    return Number(config.cost_table[String(score)]);
  }
  if (DND_POINT_BUY_COST[score] != null) return DND_POINT_BUY_COST[score];
  return Math.max(0, score - config.min_score);
}

export function totalPointBuySpent(
  scores: Record<string, number>,
  keys: string[],
  config: PointBuyConfig,
): number {
  return keys.reduce(
    (sum, key) => sum + pointBuyCost(scores[key] ?? config.min_score, config),
    0,
  );
}

/** 安全評估如 EDU*4、INT*2 */
export function evalAttrFormula(
  formula: string,
  attributes: Record<string, number>,
): number {
  try {
    const result = evaluate(formula, attributes);
    const n = typeof result === "number" ? result : Number(result);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function createEmptyCharacterShell(
  systemId: GameSystemID,
  defs?: AttributeDef[],
): UniversalCharacterSheet {
  const attrs: Record<string, number> = {};
  const list = defs?.length ? defs : defaultAttributeDefs(systemId);
  for (const d of list) {
    attrs[d.key] = 0;
  }
  if (systemId === "DND_5E") {
    attrs.LEVEL = 1;
    attrs.HIT_DIE = 10;
    attrs.ARMOR_BONUS = 0;
  }

  return {
    id: crypto.randomUUID(),
    system_id: systemId,
    name: "",
    role_title: "",
    attributes: attrs,
    derived: {
      hp: { current: 0, max: 0 },
      mp_or_slots: { current: 0, max: 0 },
      ...(systemId === "COC_7E"
        ? { san: { current: 0, max: 0 }, dodge: 0, mov: 0, build: 0, damage_bonus: "0" }
        : { ac: 10 }),
    },
    skills: {},
    markedSkillsForGrowth: [],
    inventory: [],
    backstory_hooks: {},
    age: "",
    gender: "",
    appearance: "",
    residence: "",
    birthplace: "",
    languages: "",
    personal_bio: "",
    wealth: "",
    ...(systemId === "COC_7E"
      ? { profile_coc: { occupation: "", cash_assets: "" } }
      : {
          profile_dnd: {
            race: "",
            class_name: "",
            background: "",
            alignment: "",
            speed: 30,
            proficiencies: "",
            features: "",
          },
        }),
  };
}

export function normalizeCreationMode(
  mode: string | undefined | null,
): CreationMode {
  const m = (mode ?? "DICE").toUpperCase();
  if (
    m === "ARRAY" ||
    m === "POINT_BUY" ||
    m === "SKILL_ALLOC" ||
    m === "DICE"
  ) {
    return m;
  }
  return "DICE";
}

export const CREATION_MODE_LABELS: Record<CreationMode, string> = {
  DICE: "物理擲骰",
  ARRAY: "標準陣列",
  POINT_BUY: "購點制",
  SKILL_ALLOC: "技能分配",
};

export const CREATION_MODE_HINTS: Record<CreationMode, string> = {
  DICE: "以系統公式擲出屬性；結果鎖定不可手改（D&D 可再分配擲出池）。",
  ARRAY: "從固定陣列互斥分配到各屬性，每個分數只能用一次。",
  POINT_BUY: "在預算內加減屬性；超出區間的按鈕會停用。",
  SKILL_ALLOC: "先備妥屬性後，分別花費職業點與興趣點提升技能。",
};

/** CoC 常見技能預設基礎值；AI 若回傳 0 則回退到此表 */
export const COC_SKILL_BASE_DEFAULTS: Record<string, number> = {
  會計: 5,
  人類學: 1,
  鑑定: 5,
  考古學: 1,
  藝術: 5,
  工藝: 5,
  魅惑: 15,
  攀爬: 20,
  信用評級: 0,
  克蘇魯神話: 0,
  喬裝: 5,
  閃避: 0, // 由 DEX/2 覆蓋
  駕駛: 20,
  電器維修: 10,
  電子學: 1,
  話術: 5,
  格鬥: 25,
  射擊: 20,
  急救: 30,
  歷史: 5,
  恐嚇: 15,
  跳躍: 20,
  法律: 5,
  圖書館使用: 20,
  聆聽: 20,
  鎖匠: 1,
  機械維修: 10,
  醫學: 1,
  自然: 10,
  導航: 10,
  神秘學: 5,
  操作重機: 1,
  說服: 10,
  精神分析: 1,
  心理學: 10,
  騎術: 5,
  科學: 1,
  妙手: 10,
  偵查: 25,
  潛行: 20,
  生存: 10,
  游泳: 20,
  投擲: 20,
  追蹤: 10,
  語言: 1,
};

/** 創角時單技上限（％）。規則未強制，但大師級描述止於 99%；>100% 多為遊玩後成長。 */
export const COC_CREATION_SKILL_CAP = 99;

export function resolveSkillBaseValue(
  systemId: GameSystemID,
  name: string,
  baseValue: number | undefined,
): number {
  if (typeof baseValue === "number" && baseValue > 0) return baseValue;
  if (systemId !== "COC_7E") return Math.max(0, baseValue ?? 0);
  // 模糊匹配：技能名包含預設表 key（如「語言(古希臘語)」→「語言」）
  for (const [key, val] of Object.entries(COC_SKILL_BASE_DEFAULTS)) {
    if (name === key || name.startsWith(key)) return val;
  }
  return 5;
}

/** 創角可新增的 CoC 技能目錄（名稱＋基礎％） */
export function listCocSkillCatalog(): { name: string; base_value: number }[] {
  return Object.entries(COC_SKILL_BASE_DEFAULTS)
    .map(([name, base_value]) => ({ name, base_value }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

/**
 * CoC 系統常駐技能說明（不依賴 AI 藍圖）。
 * - 閃避：幾乎每張卡都有，基礎＝floor(DEX/2)
 * - 信用評級：社會地位／金錢信用技能，基礎 0，用職業／興趣點配置
 */
export const COC_SYSTEM_SKILL_DESCRIPTIONS: Record<string, string> = {
  閃避: [
    "閃避：迴避近戰攻擊等危險的技能。",
    "系統常駐：創角時基礎值自動設為 floor(DEX/2)；可用職業／興趣點再提升。",
    "檢定用途：被打時選擇閃避、某些需要靈活躲閃的場面。",
  ].join("\n\n"),
  信用評級: [
    "信用評級：社會地位與可動用金錢／信用的技能（％），不是自由描述欄。",
    "系統常駐：基礎通常為 0，依職業包建議範圍用職業／興趣點配置。",
    "檢定用途：借錢、打通關係、被當成「有頭有臉」時。",
    "請與「現金／資產」「資產概況」敘事大致對齊。",
    "常見區間：落魄 0–5、溫飽 6–15、一般 16–39、小康 40–59、富裕 60–79、名流 80–99。",
  ].join("\n\n"),
};

/** 解析技能說明：角色卡 → 藍圖 → 系統常駐 */
export function resolveSkillDescription(
  skillName: string,
  opts?: {
    systemId?: GameSystemID;
    sheetDescriptions?: Record<string, string> | null;
    schemaSkills?: { name: string; description?: string }[] | null;
  },
): string {
  const fromSheet = opts?.sheetDescriptions?.[skillName]?.trim();
  if (fromSheet) return fromSheet;

  const fromSchema = opts?.schemaSkills?.find((s) => s.name === skillName)
    ?.description?.trim();
  if (fromSchema) return fromSchema;

  if (opts?.systemId === "COC_7E" || opts?.systemId == null) {
    const system = COC_SYSTEM_SKILL_DESCRIPTIONS[skillName];
    if (system) return system;
  }
  return "";
}

/**
 * 把藍圖上的技能敘述、鉤子問題全文寫入角色卡，
 * 供檔案庫／匯出／冒險中完整角色卡顯示（不依賴當下藍圖仍在）。
 */
export function enrichCharacterSheetMeta(
  sheet: UniversalCharacterSheet,
  schema: CharacterSchemaState | null | undefined,
): UniversalCharacterSheet {
  const skill_descriptions: Record<string, string> = {
    ...(sheet.skill_descriptions ?? {}),
  };
  for (const sk of schema?.recommended_skills ?? []) {
    const desc = sk.description?.trim();
    if (!desc) continue;
    skill_descriptions[sk.name] = desc;
  }

  // 補上系統常駐技能說明（藍圖未提供時）
  if (sheet.system_id === "COC_7E") {
    for (const name of Object.keys(sheet.skills ?? {})) {
      if (skill_descriptions[name]?.trim()) continue;
      const systemDesc = COC_SYSTEM_SKILL_DESCRIPTIONS[name];
      if (systemDesc) skill_descriptions[name] = systemDesc;
    }
    // 即使尚未出現在 skills 也預寫（信用評級／閃避常為系統固定）
    for (const [name, desc] of Object.entries(COC_SYSTEM_SKILL_DESCRIPTIONS)) {
      if (!skill_descriptions[name]?.trim()) skill_descriptions[name] = desc;
    }
  }

  const backstory_hook_questions: Record<string, string> = {
    ...(sheet.backstory_hook_questions ?? {}),
  };
  for (const q of schema?.background_questions ?? []) {
    const question = q.question?.trim();
    if (!question) continue;
    const category = q.category?.trim();
    backstory_hook_questions[q.id] = category
      ? `${category}：${question}`
      : question;
  }

  return {
    ...sheet,
    skill_descriptions,
    backstory_hook_questions,
  };
}
