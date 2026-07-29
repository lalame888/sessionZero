import { evaluate } from "mathjs";
import { createEmptyCharacterShell } from "@/engine/creation";
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
    const ready = con > 0 && siz > 0 && pow > 0;
    // 專業 CoC 7e：HP = floor((CON+SIZ)/10)
    const maxHp = ready ? evaluateFormula(`floor((${con}+${siz})/10)`) : 0;
    const maxMp = ready ? evaluateFormula(`floor(${pow}/5)`) : 0;
    const maxSan = ready ? pow : 0;
    const dodge = dex > 0 ? evaluateFormula(`floor(${dex}/2)`) : 0;

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

    const skills = { ...sheet.skills };
    if (dodge > 0) {
      const prev = skills["閃避"];
      // 僅在尚未分配或仍等於舊基礎時，同步閃避基礎值
      if (prev == null || prev === 0) skills["閃避"] = dodge;
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
          current: syncResource(
            sheet.derived.san?.current,
            sheet.derived.san?.max,
            maxSan,
          ),
          max: maxSan,
        },
        dodge,
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

/** 相容舊存檔 backgroundAnswers → backstory_hooks */
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
  return recomputeDerived({
    ...rest,
    backstory_hooks: hooks,
    inventory: sheet.inventory ?? [],
    skills: sheet.skills ?? {},
  });
}

export function themeForSystem(
  systemId: GameSystemID | null,
): "neutral" | "coc" | "dnd" {
  if (systemId === "COC_7E") return "coc";
  if (systemId === "DND_5E") return "dnd";
  return "neutral";
}
