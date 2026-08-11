import { evaluate } from "mathjs";
import {
  clampSkillsToSystemBases,
  createEmptyCharacterShell,
} from "@/engine/creation";
import type { GameSystemID, UniversalCharacterSheet } from "@/types/game";

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function computeAttributeModifiers(
  attributes: Record<string, number>,
): Record<string, number> {
  const mods: Record<string, number> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (["LEVEL", "HIT_DIE", "ARMOR_BONUS"].includes(key)) continue;
    if (!Number.isFinite(value) || value <= 0) continue;
    mods[`${key}_MOD`] = abilityModifier(value);
  }
  return mods;
}

export function evaluateFormula(
  expression: string,
  scope: Record<string, number> = {},
): number {
  const result = evaluate(expression, scope);
  const num = typeof result === "number" ? result : Number(result);
  return Number.isFinite(num) ? Math.floor(num) : 0;
}

/** CoC 7e：依 STR / DEX / SIZ 簡表推算移動力 */
export function cocMoveRate(str: number, dex: number, siz: number): number {
  if (str <= 0 || dex <= 0 || siz <= 0) return 0;
  if (str < siz && dex < siz) return 7;
  if (str > siz && dex > siz) return 9;
  return 8;
}

/** CoC 7e：依 STR+SIZ 簡表推算體格與傷害加值 */
export function cocBuildAndDamageBonus(
  str: number,
  siz: number,
): { build: number; damage_bonus: string } {
  const sum = str + siz;
  if (str <= 0 || siz <= 0) return { build: 0, damage_bonus: "0" };
  if (sum <= 64) return { build: -2, damage_bonus: "-2" };
  if (sum <= 84) return { build: -1, damage_bonus: "-1" };
  if (sum <= 124) return { build: 0, damage_bonus: "0" };
  if (sum <= 164) return { build: 1, damage_bonus: "+1D4" };
  if (sum <= 204) return { build: 2, damage_bonus: "+1D6" };
  if (sum <= 284) return { build: 3, damage_bonus: "+2D6" };
  if (sum <= 364) return { build: 4, damage_bonus: "+3D6" };
  if (sum <= 444) return { build: 5, damage_bonus: "+4D6" };
  // 每再多 80 點（或不足）再 +1 build、+1D6（445–524 → +5D6 / build 6）
  const steps = Math.ceil((sum - 444) / 80);
  return {
    build: 5 + steps,
    damage_bonus: `+${4 + steps}D6`,
  };
}

export function recomputeDerived(
  sheet: UniversalCharacterSheet,
): UniversalCharacterSheet {
  const attrs = sheet.attributes;
  if (sheet.system_id === "DND_5E") {
    const mods = computeAttributeModifiers(attrs);
    const conMod = mods.CON_MOD ?? 0;
    const level = Number(attrs.LEVEL ?? 1);
    const hitDie = Number(attrs.HIT_DIE ?? 10);
    const hasScores = (attrs.CON ?? 0) > 0;
    // Lvl1 HP = Hit Die Max + CON mod；之後每級平均
    const finalMax = hasScores
      ? evaluateFormula(
          `${hitDie}+${conMod}+(${level}-1)*(floor(${hitDie}/2)+1+${conMod})`,
        )
      : 0;
    const dexMod = mods.DEX_MOD ?? 0;
    const armorBonus = Number(attrs.ARMOR_BONUS ?? 0);
    const ac =
      (attrs.DEX ?? 0) > 0
        ? evaluateFormula(`10+${dexMod}+${armorBonus}`)
        : 10;
    const proficiency = evaluateFormula(`2+floor((${level}-1)/4)`);

    return {
      ...sheet,
      attribute_modifiers: mods,
      derived: {
        ...sheet.derived,
        hp: {
          current: finalMax
            ? Math.min(sheet.derived.hp.current || finalMax, finalMax)
            : 0,
          max: finalMax,
        },
        ac,
        proficiency_bonus: proficiency,
      },
    };
  }

  if (sheet.system_id === "COC_7E") {
    const con = attrs.CON ?? 0;
    const siz = attrs.SIZ ?? 0;
    const pow = attrs.POW ?? 0;
    const dex = attrs.DEX ?? 0;
    const str = attrs.STR ?? 0;
    const ready = con > 0 && siz > 0 && pow > 0;
    // 專業 CoC 7e：HP = floor((CON+SIZ)/10)
    const maxHp = ready ? evaluateFormula(`floor((${con}+${siz})/10)`) : 0;
    const maxMp = ready ? evaluateFormula(`floor(${pow}/5)`) : 0;
    const mythos = Math.max(
      0,
      Math.floor(Number(sheet.skills["克蘇魯神話"] ?? 0) || 0),
    );
    // CoC 7e：起始 SAN＝POW；SAN 上限＝99−克蘇魯神話
    const maxSan = ready ? Math.max(0, 99 - mythos) : 0;
    const startingSan = ready ? Math.min(pow, maxSan) : 0;
    const dodge = dex > 0 ? evaluateFormula(`floor(${dex}/2)`) : 0;
    const baseMov = cocMoveRate(str, dex, siz);
    const ageMovPenalty = Math.max(
      0,
      Math.floor(Number(sheet.coc_age_mod?.movPenalty ?? 0) || 0),
    );
    const mov =
      baseMov > 0 ? Math.max(1, baseMov - ageMovPenalty) : 0;
    const { build, damage_bonus } = cocBuildAndDamageBonus(str, siz);

    /** 資源池同步：首次初始化或原本已滿 → 補滿；已消耗則保留並 clamp */
    const syncResource = (
      prevCurrent: number | undefined,
      prevMax: number | undefined,
      nextMax: number,
    ) => {
      if (nextMax <= 0) return 0;
      const cur = prevCurrent ?? 0;
      const max = prevMax ?? 0;
      if (max <= 0) return nextMax;
      if (cur >= max) return nextMax;
      return Math.min(cur, nextMax);
    };

    /** SAN：上限變大時不自動回滿（避免舊存檔 max=POW 被抬到 99 時整池補滿） */
    const syncSan = (
      prevCurrent: number | undefined,
      prevMax: number | undefined,
      nextMax: number,
      initial: number,
    ) => {
      if (nextMax <= 0) return 0;
      const max = prevMax ?? 0;
      if (max <= 0) return Math.min(initial, nextMax);
      const cur = prevCurrent ?? initial;
      return Math.min(cur, nextMax);
    };

    const skills = { ...sheet.skills };
    if (dodge > 0) {
      // 閃避基礎＝DEX/2；可用職業／興趣點再提升，不可被 derived 重算蓋掉
      const current = skills["閃避"];
      if (current == null || current < dodge) {
        skills["閃避"] = dodge;
      }
    }
    // 創角／重算時確保神話技能欄存在（預設 0）
    if (skills["克蘇魯神話"] == null) {
      skills["克蘇魯神話"] = 0;
    }

    return {
      ...sheet,
      skills,
      derived: {
        ...sheet.derived,
        hp: {
          current: syncResource(
            sheet.derived.hp.current,
            sheet.derived.hp.max,
            maxHp,
          ),
          max: maxHp,
        },
        mp_or_slots: {
          current: syncResource(
            sheet.derived.mp_or_slots?.current,
            sheet.derived.mp_or_slots?.max,
            maxMp,
          ),
          max: maxMp,
        },
        san: {
          current: syncSan(
            sheet.derived.san?.current,
            sheet.derived.san?.max,
            maxSan,
            startingSan,
          ),
          max: maxSan,
        },
        dodge,
        mov,
        build,
        damage_bonus,
      },
    };
  }

  return sheet;
}

export function createBlankCharacter(
  systemId: GameSystemID,
  name = "",
): UniversalCharacterSheet {
  const sheet = createEmptyCharacterShell(systemId);
  return recomputeDerived({ ...sheet, name });
}

/** 相容舊存檔 backgroundAnswers → backstory_hooks；補齊身分／系統專屬空殼 */
export function migrateCharacterSheet(
  raw: unknown,
): UniversalCharacterSheet {
  const sheet = raw as UniversalCharacterSheet & {
    backgroundAnswers?: Record<string, string>;
  };
  const hooks =
    sheet.backstory_hooks && Object.keys(sheet.backstory_hooks).length
      ? sheet.backstory_hooks
      : (sheet.backgroundAnswers ?? {});
  const { backgroundAnswers: _drop, ...rest } = sheet;
  void _drop;

  const identityDefaults = {
    age: sheet.age ?? "",
    gender: sheet.gender ?? "",
    appearance: sheet.appearance ?? "",
    residence: sheet.residence ?? "",
    birthplace: sheet.birthplace ?? "",
    languages: sheet.languages ?? "",
    personal_bio: sheet.personal_bio ?? "",
    wealth: sheet.wealth ?? "",
  };

  const profilePatch =
    sheet.system_id === "COC_7E"
      ? {
          profile_coc: {
            occupation: sheet.profile_coc?.occupation ?? "",
            cash_assets: sheet.profile_coc?.cash_assets ?? "",
          },
        }
      : sheet.system_id === "DND_5E"
        ? {
            profile_dnd: {
              race: sheet.profile_dnd?.race ?? "",
              class_name: sheet.profile_dnd?.class_name ?? "",
              background: sheet.profile_dnd?.background ?? "",
              alignment: sheet.profile_dnd?.alignment ?? "",
              speed: sheet.profile_dnd?.speed ?? 30,
              proficiencies: sheet.profile_dnd?.proficiencies ?? "",
              features: sheet.profile_dnd?.features ?? "",
            },
          }
        : {};

  return recomputeDerived({
    ...rest,
    ...identityDefaults,
    ...profilePatch,
    backstory_hooks: hooks,
    backstory_hook_questions: sheet.backstory_hook_questions,
    inventory: sheet.inventory ?? [],
    skills: clampSkillsToSystemBases(
      sheet.system_id,
      sheet.skills ?? {},
    ),
    skill_descriptions: sheet.skill_descriptions,
  });
}

export function themeForSystem(
  systemId: GameSystemID | null,
): "neutral" | "coc" | "dnd" {
  if (systemId === "COC_7E") return "coc";
  if (systemId === "DND_5E") return "dnd";
  return "neutral";
}

/** 進入冒險前：克蘇魯神話強制 0；閃避不得低於 DEX/2（可保留創角加點） */
export function normalizeCocCreationSheet(
  sheet: UniversalCharacterSheet,
): { sheet: UniversalCharacterSheet; forcedMythosToZero: boolean } {
  if (sheet.system_id !== "COC_7E") {
    return { sheet, forcedMythosToZero: false };
  }
  const forcedMythosToZero = (sheet.skills["克蘇魯神話"] ?? 0) > 0;
  const skills: Record<string, number> = {
    ...sheet.skills,
    克蘇魯神話: 0,
  };
  const dex = sheet.attributes.DEX ?? 0;
  const dodgeBase = Math.floor(dex / 2);
  if (dodgeBase > 0) {
    skills["閃避"] = Math.max(skills["閃避"] ?? 0, dodgeBase);
  }
  return {
    sheet: recomputeDerived({ ...sheet, skills }),
    forcedMythosToZero,
  };
}
