import {
  listCocSkillCatalog,
  resolveCocCatalogSkillDescription,
  resolveSkillBaseValue,
} from "@/engine/creation";
import { canonicalCocSkillName } from "@/engine/skillCheck";
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
      sheet.attributes,
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
    const resolvedBase = resolveSkillBaseValue(
      sheet.system_id,
      name,
      catalogBase,
      sheet.attributes,
    );
    extras.push({
      name,
      base_value: resolvedBase,
      description: resolveCocCatalogSkillDescription(name),
      is_occupational: (sheet.skills[name] ?? 0) > resolvedBase,
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

/** 將 AI 為此席重推的技能包轉成草稿覆寫＋基礎技能值（不改屬性配點方式） */
export function buildSlotSkillBlueprint(
  sheet: UniversalCharacterSheet,
  schemaSkills: RecommendedSkill[],
  aiSkills: RecommendedSkill[],
): {
  extraSkills: RecommendedSkill[];
  occOverrides: Record<string, boolean>;
  skills: Record<string, number>;
} {
  const canon = (name: string) =>
    sheet.system_id === "COC_7E" ? canonicalCocSkillName(name) : name.trim();

  const normalize = (sk: RecommendedSkill): RecommendedSkill => {
    const name = canon(sk.name);
    return {
      ...sk,
      name,
      base_value: resolveSkillBaseValue(
        sheet.system_id,
        name,
        sk.base_value,
        sheet.attributes,
      ),
      is_occupational: Boolean(sk.is_occupational),
    };
  };

  const normalizedSchema = schemaSkills.map(normalize);
  const schemaNames = new Set(normalizedSchema.map((s) => s.name));

  const aiByName = new Map<string, RecommendedSkill>();
  for (const sk of aiSkills) {
    if (!sk.name?.trim()) continue;
    const next = normalize(sk);
    aiByName.set(next.name, next);
  }

  const extraSkills = [...aiByName.values()].filter(
    (sk) => !schemaNames.has(sk.name),
  );

  const occOverrides: Record<string, boolean> = {};
  for (const sk of normalizedSchema) {
    occOverrides[sk.name] = false;
  }
  for (const sk of aiByName.values()) {
    occOverrides[sk.name] = Boolean(sk.is_occupational);
  }

  const skills: Record<string, number> = {};
  for (const sk of normalizedSchema) {
    skills[sk.name] = sk.base_value;
  }
  for (const sk of extraSkills) {
    skills[sk.name] = sk.base_value;
  }

  return { extraSkills, occOverrides, skills };
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
