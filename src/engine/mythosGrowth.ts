import { canonicalCocSkillName, normalizeSkillKey } from "@/engine/skillCheck";

export const CTHULHU_MYTHOS_SKILL = "克蘇魯神話";

const MYTHOS_NAME_KEYS = new Set(
  ["克蘇魯神話", "克苏鲁神话", "cthulhu mythos", "cthulhumythos"].map(
    normalizeSkillKey,
  ),
);

/** 是否為克蘇魯神話技能欄（不含「神話學」＝神秘學別名） */
export function isCthulhuMythosSkillName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (canonicalCocSkillName(trimmed) === CTHULHU_MYTHOS_SKILL) return true;
  return MYTHOS_NAME_KEYS.has(normalizeSkillKey(trimmed));
}

export function isSanStatKey(key: string): boolean {
  const k = key.trim().toUpperCase();
  return k === "SAN" || k === "理智" || k === "SANITY";
}

/** 神話遭遇／禁書／儀式等 SAN 損失 reason */
const MYTHOS_SAN_REASON =
  /克蘇魯|克苏鲁|cthulhu|mythos|古神|舊日支配者|外神|深潛者|禁書|秘典|邪典|異界|不可名狀|非歐幾里得|神話真相|神話生物|目睹神話|接觸神話|閱讀.*秘|讀.*禁書|(?<!神)神話/;

export function isMythosSanLossReason(reason: string): boolean {
  return MYTHOS_SAN_REASON.test(reason.trim());
}

export function clampCthulhuMythos(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, Math.floor(value)));
}

/**
 * CoC 7e：因神話扣 SAN 時，克蘇魯神話即時 + 等量％。
 * 若同一批 stat_changes 已顯式加了克蘇魯神話（禁書精讀等），只補差額、不重複加。
 */
export function computeAutoMythosGain(
  changes: { key: string; change_amount: number; reason: string }[],
): number {
  let sanLostFromMythos = 0;
  let explicitMythosGain = 0;
  for (const ch of changes) {
    if (
      isSanStatKey(ch.key) &&
      ch.change_amount < 0 &&
      isMythosSanLossReason(ch.reason)
    ) {
      sanLostFromMythos += Math.abs(Math.floor(ch.change_amount));
    }
    if (isCthulhuMythosSkillName(ch.key) && ch.change_amount > 0) {
      explicitMythosGain += Math.floor(ch.change_amount);
    }
  }
  return Math.max(0, sanLostFromMythos - explicitMythosGain);
}
