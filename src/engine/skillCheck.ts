import type { UniversalCharacterSheet } from "@/types/game";

export type CheckDifficulty = "regular" | "hard" | "extreme";

/** 統一全形／異體字，方便「神秘學」對上「神祕學」 */
export function normalizeSkillKey(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "") // 去掉括號註記，如 Knowledge (Occult)
    .replace(/祕/g, "秘")
    .replace(/[\s\-_/·・]/g, "");
}

const SKILL_ALIASES: Record<string, string[]> = {
  神秘學: ["神祕學", "occult", "knowledgeoccult", "knowledge(occult)"],
  心理學: ["psychology"],
  偵查: ["侦查", "spothidden", "spothidden"],
  聆聽: ["listen"],
  圖書館使用: ["libraryuse", "library use"],
};

function aliasKeysFor(normalized: string): string[] {
  const keys = [normalized];
  for (const [canon, aliases] of Object.entries(SKILL_ALIASES)) {
    const group = [canon, ...aliases].map(normalizeSkillKey);
    if (group.includes(normalized)) {
      keys.push(...group);
    }
  }
  return [...new Set(keys)];
}

/** 從角色卡查找技能％；找不到回傳 null */
export function lookupCharacterSkill(
  sheet: UniversalCharacterSheet | null | undefined,
  checkName: string,
): { name: string; value: number } | null {
  if (!sheet) return null;
  const entries = Object.entries(sheet.skills);
  if (!entries.length) return null;

  const want = aliasKeysFor(normalizeSkillKey(checkName));

  // 精確／別名
  for (const [name, value] of entries) {
    const key = normalizeSkillKey(name);
    if (want.includes(key)) return { name, value };
  }

  // 包含關係（檢定名含技能名或反之）
  for (const [name, value] of entries) {
    const key = normalizeSkillKey(name);
    if (want.some((w) => w.includes(key) || key.includes(w))) {
      return { name, value };
    }
  }

  return null;
}

export function parseCheckDifficulty(
  raw?: string | null,
): CheckDifficulty {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "hard" || s === "困難" || s === "困难") return "hard";
  if (s === "extreme" || s === "極限" || s === "极限") return "extreme";
  return "regular";
}

/** CoC：一般＝技能，困難＝半值，極限＝五分之一（向下取整） */
export function cocSuccessThreshold(
  skill: number,
  difficulty: CheckDifficulty = "regular",
): number {
  const s = Math.max(0, Math.floor(skill));
  if (difficulty === "hard") return Math.floor(s / 2);
  if (difficulty === "extreme") return Math.floor(s / 5);
  return s;
}

export function difficultyLabel(d: CheckDifficulty): string {
  if (d === "hard") return "困難";
  if (d === "extreme") return "極限";
  return "一般";
}
