import {
  listCocSkillCatalog,
  resolveSkillBaseValue,
} from "@/engine/creation";
import type { RecommendedSkill, UniversalCharacterSheet } from "@/types/game";
import type { CharacterCreationDraft } from "@/types/party";

export type SkillSpend = Record<string, { occ: number; interest: number }>;

/** 從角色卡技能值反推配點（無草稿時的後備，職業技優先算入 occ） */
export function inferSkillSpendFromSheet(
  sheet: UniversalCharacterSheet,
  skills: RecommendedSkill[],
): SkillSpend {
  const spend: SkillSpend = {};
  for (const sk of skills) {
    const base = resolveSkillBaseValue(
      sheet.system_id,
      sk.name,
      sk.base_value,
    );
    const val = sheet.skills[sk.name] ?? base;
    const extra = Math.max(0, Math.floor(val - base));
    if (extra <= 0) {
      spend[sk.name] = { occ: 0, interest: 0 };
      continue;
    }
    if (sk.is_occupational) {
      spend[sk.name] = { occ: extra, interest: 0 };
    } else {
      spend[sk.name] = { occ: 0, interest: extra };
    }
  }
  return spend;
}

/** 卡片上有、藍圖沒有的技能 → 還原為自行加入的 extraSkills */
export function inferExtraSkillsFromSheet(
  sheet: UniversalCharacterSheet,
  schemaSkills: RecommendedSkill[],
): RecommendedSkill[] {
  const schemaNames = new Set(schemaSkills.map((s) => s.name));
  const catalog = new Map(
    listCocSkillCatalog().map((s) => [s.name, s.base_value] as const),
  );
  const extras: RecommendedSkill[] = [];
  for (const name of Object.keys(sheet.skills)) {
    if (schemaNames.has(name)) continue;
    const catalogBase = catalog.get(name);
    const base =
      catalogBase ??
      resolveSkillBaseValue(sheet.system_id, name, undefined);
    extras.push({
      name,
      base_value: base,
      description: "玩家自行加入的職業／個人技能",
      is_occupational: (sheet.skills[name] ?? 0) > base,
    });
  }
  return extras;
}

export function draftFromUi(state: {
  skillSpend: SkillSpend;
  occOverrides: Record<string, boolean>;
  extraSkills: RecommendedSkill[];
  assignments: Record<string, number | "">;
  rolledPool: number[];
}): CharacterCreationDraft {
  return {
    skillSpend: state.skillSpend,
    occOverrides: state.occOverrides,
    extraSkills: state.extraSkills,
    assignments: state.assignments,
    rolledPool: state.rolledPool,
  };
}

export function hydrateUiFromDraft(
  draft: CharacterCreationDraft | undefined,
  sheet: UniversalCharacterSheet,
  schemaSkills: RecommendedSkill[],
): {
  skillSpend: SkillSpend;
  occOverrides: Record<string, boolean>;
  extraSkills: RecommendedSkill[];
  assignments: Record<string, number | "">;
  rolledPool: number[];
} {
  const extraSkills =
    draft?.extraSkills?.length
      ? draft.extraSkills
      : inferExtraSkillsFromSheet(sheet, schemaSkills);

  const mergedForInfer: RecommendedSkill[] = [
    ...schemaSkills,
    ...extraSkills.filter((ex) => !schemaSkills.some((s) => s.name === ex.name)),
  ].map((sk) => ({
    ...sk,
    is_occupational:
      draft?.occOverrides?.[sk.name] !== undefined
        ? draft.occOverrides[sk.name]
        : Boolean(sk.is_occupational),
  }));

  const hasSpend =
    draft?.skillSpend && Object.keys(draft.skillSpend).length > 0;

  return {
    skillSpend: hasSpend
      ? draft!.skillSpend!
      : inferSkillSpendFromSheet(sheet, mergedForInfer),
    occOverrides: draft?.occOverrides ?? {},
    extraSkills,
    assignments: draft?.assignments ?? {},
    rolledPool: draft?.rolledPool ?? [],
  };
}

/** 姓名＋屬性皆就緒 → 視為此席已建完（顯示用） */
export function isPartyMemberCreationComplete(
  sheet: UniversalCharacterSheet | undefined | null,
  creationComplete?: boolean,
  attrKeys: string[] = [],
): boolean {
  if (creationComplete) return true;
  if (!sheet?.name?.trim()) return false;
  if (!attrKeys.length) return Boolean(sheet.name?.trim());
  return attrKeys.every((k) => (sheet.attributes[k] ?? 0) > 0);
}
