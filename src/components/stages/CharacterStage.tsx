import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  evalAttrFormula,
  normalizeCreationMode,
  pointBuyCost,
  resolveSkillBaseValue,
  rollCreationFormula,
  totalPointBuySpent,
  COC_CREATION_SKILL_CAP,
  listCocSkillCatalog,
} from "@/engine/creation";
import type { RecommendedSkill } from "@/types/game";
import { migrateCharacterSheet } from "@/engine/formulas";
import {
  CREDIT_LIFESTYLE_BANDS,
  CREDIT_RATING_TOOLTIP,
  bandForCredit,
  creditConsistencyWarning,
} from "@/engine/creditRatingGuide";
import {
  attributeTooltipContent,
  buildDerivedTooltipRows,
  buildFixedAttrTooltipRows,
  skillPoolFormulaTooltip,
} from "@/engine/statTooltips";
import { getActiveSession } from "@/lib/pedelec/createGameSession";
import {
  exportCharacterJson,
  loadCharacterLibrary,
  saveCharacterToLibrary,
} from "@/lib/storage";
import { useGameStore } from "@/store/useGameStore";
import type { UniversalCharacterSheet } from "@/types/game";

type SkillSpend = Record<string, { occ: number; interest: number }>;

function buildSkillSpendFromSheet(
  sheet: UniversalCharacterSheet,
  skills: { name: string; base_value: number; is_occupational?: boolean }[],
): SkillSpend {
  const spend: SkillSpend = {};
  for (const sk of skills) {
    const final = sheet.skills[sk.name] ?? sk.base_value;
    const extra = Math.max(0, Math.floor(final - sk.base_value));
    if (extra <= 0) {
      spend[sk.name] = { occ: 0, interest: 0 };
    } else if (sk.is_occupational) {
      spend[sk.name] = { occ: extra, interest: 0 };
    } else {
      spend[sk.name] = { occ: 0, interest: extra };
    }
  }
  return spend;
}

function buildArrayAssignmentsFromSheet(
  attrs: Record<string, number>,
  keys: string[],
  arrayValues: number[],
): Record<string, number | ""> {
  const used = new Set<number>();
  const next: Record<string, number | ""> = {};
  for (const key of keys) {
    const val = attrs[key];
    if (val == null || val <= 0) {
      next[key] = "";
      continue;
    }
    const idx = arrayValues.findIndex((v, i) => v === val && !used.has(i));
    if (idx >= 0) {
      used.add(idx);
      next[key] = idx;
    } else {
      next[key] = "";
    }
  }
  return next;
}

export function CharacterStage() {
  const character = useGameStore((s) => s.character);
  const schema = useGameStore((s) => s.characterSchema);
  const script = useGameStore((s) => s.script);
  const setCharacter = useGameStore((s) => s.setCharacter);
  const updateCharacterField = useGameStore((s) => s.updateCharacterField);
  const confirmCharacterAndPlay = useGameStore((s) => s.confirmCharacterAndPlay);
  const appendSystem = useGameStore((s) => s.appendSystem);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const isTyping = useGameStore((s) => s.isTyping);
  const latestSystemNotice = useGameStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) {
      const m = s.messages[i];
      if (m?.role === "system") return m.content;
    }
    return null;
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(() => loadCharacterLibrary());
  const [generatingNarrative, setGeneratingNarrative] = useState(false);

  const mode = normalizeCreationMode(
    schema?.creation_mode ?? script.recommended_creation_mode,
  );
  const defs = schema?.attribute_defs ?? [];
  const attrKeys = defs.map((d) => d.key);

  const [rolledPool, setRolledPool] = useState<number[]>([]);
  const [rollLog, setRollLog] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, number | "">>(
    {},
  );
  const [skillSpend, setSkillSpend] = useState<SkillSpend>({});
  const [highSkillWarned, setHighSkillWarned] = useState<Set<string>>(
    () => new Set(),
  );
  /** 玩家覆寫：哪些技能可花職業點（補足 AI 職業包過少） */
  const [occOverrides, setOccOverrides] = useState<Record<string, boolean>>(
    {},
  );
  /** 玩家自行加入的技能（不在藍圖列表內） */
  const [extraSkills, setExtraSkills] = useState<RecommendedSkill[]>([]);
  const [addSkillPick, setAddSkillPick] = useState("");

  useEffect(() => {
    setRolledPool([]);
    setRollLog([]);
    setAssignments({});
    setSkillSpend({});
    setHighSkillWarned(new Set());
    setOccOverrides({});
    setExtraSkills([]);
    setAddSkillPick("");
  }, [schema?.creation_mode, schema?.recommended_skills?.length]);

  const modeConfig = schema?.mode_config;
  const pointBuy = schema?.point_buy;
  const arrayValues =
    schema?.standard_array ?? modeConfig?.standard_array ?? [];

  const spentPoints = useMemo(() => {
    if (!pointBuy || !character) return 0;
    return totalPointBuySpent(character.attributes, attrKeys, pointBuy);
  }, [character, attrKeys, pointBuy]);

  const occBudget = useMemo(() => {
    if (!character) return 0;
    const formula =
      modeConfig?.occupational_point_formula ??
      (character.system_id === "COC_7E" ? "EDU * 4" : "");
    if (!formula) return schema?.skill_points ?? 0;
    return evalAttrFormula(formula, character.attributes);
  }, [character, modeConfig, schema?.skill_points]);

  const interestBudget = useMemo(() => {
    if (!character) return 0;
    const formula =
      modeConfig?.interest_point_formula ??
      (character.system_id === "COC_7E" ? "INT * 2" : "");
    if (!formula) return 0;
    return evalAttrFormula(formula, character.attributes);
  }, [character, modeConfig]);

  const occUsed = useMemo(
    () => Object.values(skillSpend).reduce((a, b) => a + b.occ, 0),
    [skillSpend],
  );
  const interestUsed = useMemo(
    () => Object.values(skillSpend).reduce((a, b) => a + b.interest, 0),
    [skillSpend],
  );

  const usedArrayIndices = useMemo(() => {
    const used = new Set<number>();
    for (const v of Object.values(assignments)) {
      if (v !== "" && v != null) used.add(Number(v));
    }
    return used;
  }, [assignments]);

  const schemaSkills = useMemo(() => {
    if (!schema?.recommended_skills?.length || !character) return [];
    return schema.recommended_skills.map((sk) => ({
      ...sk,
      base_value: resolveSkillBaseValue(
        character.system_id,
        sk.name,
        sk.base_value,
      ),
    }));
  }, [schema?.recommended_skills, character]);

  const allocSkills = useMemo(() => {
    if (!character) return [];
    const merged: RecommendedSkill[] = [...schemaSkills];
    for (const ex of extraSkills) {
      if (!merged.some((s) => s.name === ex.name)) {
        merged.push({
          ...ex,
          base_value: resolveSkillBaseValue(
            character.system_id,
            ex.name,
            ex.base_value,
          ),
        });
      }
    }
    return merged.map((sk) => ({
      ...sk,
      is_occupational:
        occOverrides[sk.name] !== undefined
          ? occOverrides[sk.name]
          : Boolean(sk.is_occupational),
    }));
  }, [character, schemaSkills, extraSkills, occOverrides]);

  /** 職業技能目前最多還能再吃多少職業點（受創角 99% 上限與興趣點佔用影響） */
  const occAbsorbCap = useMemo(() => {
    return allocSkills
      .filter((sk) => sk.is_occupational)
      .reduce((sum, sk) => {
        const interest = skillSpend[sk.name]?.interest ?? 0;
        return (
          sum +
          Math.max(0, COC_CREATION_SKILL_CAP - sk.base_value - interest)
        );
      }, 0);
  }, [allocSkills, skillSpend]);

  const occRemaining = Math.max(0, occBudget - occUsed);
  const occRoomLeft = Math.max(0, occAbsorbCap - occUsed);
  const occUnspendable = Math.max(0, occRemaining - occRoomLeft);
  const occSkillCount = allocSkills.filter((s) => s.is_occupational).length;

  const cocCatalogOptions = useMemo(() => {
    if (!character || character.system_id !== "COC_7E") return [];
    const have = new Set(allocSkills.map((s) => s.name));
    return listCocSkillCatalog().filter((s) => !have.has(s.name));
  }, [character, allocSkills]);

  const hookQuestions = schema?.background_questions ?? [];

  const hooksReady = useMemo(() => {
    if (!character || !hookQuestions.length) return true;
    return hookQuestions.every((q) =>
      (character.backstory_hooks[q.id] ?? "").trim(),
    );
  }, [character, hookQuestions]);

  const attrsReadyForTips = useMemo(() => {
    if (!character || !attrKeys.length) return false;
    return attrKeys.every((k) => (character.attributes[k] ?? 0) > 0);
  }, [character, attrKeys]);

  const derivedRows = useMemo(() => {
    if (!character || !attrsReadyForTips) return [];
    return buildDerivedTooltipRows(character);
  }, [character, attrsReadyForTips]);

  const fixedAttrRows = useMemo(() => {
    if (!character || character.system_id !== "DND_5E") return [];
    return buildFixedAttrTooltipRows(character);
  }, [character]);

  const creditScore = character?.skills["信用評級"];
  const creditBand = useMemo(
    () =>
      creditScore != null && Number.isFinite(creditScore)
        ? bandForCredit(creditScore)
        : null,
    [creditScore],
  );
  const creditWarning = useMemo(() => {
    if (!character || character.system_id !== "COC_7E") return null;
    return creditConsistencyWarning(
      character.skills["信用評級"],
      character.wealth ?? "",
      character.profile_coc?.cash_assets ?? "",
    );
  }, [character]);

  const setCreditRating = (n: number | undefined) => {
    const clamped =
      n == null || !Number.isFinite(n)
        ? undefined
        : Math.max(0, Math.min(99, Math.floor(n)));

    updateCharacterField((s) => {
      const skills = { ...s.skills };
      if (clamped == null) {
        delete skills["信用評級"];
      } else {
        skills["信用評級"] = clamped;
      }
      return { ...s, skills };
    });

    // 與技能雙點池 UI 對齊（若藍圖有此技能）
    const sk = allocSkills.find((s) => s.name === "信用評級");
    if (!sk) return;
    const final = clamped ?? sk.base_value;
    const extra = Math.max(0, final - sk.base_value);
    setSkillSpend((prev) => ({
      ...prev,
      信用評級: sk.is_occupational
        ? { occ: extra, interest: 0 }
        : { occ: 0, interest: extra },
    }));
  };

  const requestAiNarrative = async () => {
    if (!character) return;
    const session = getActiveSession();
    if (!session || session.getStatus() !== "idle") {
      appendSystem("Session 未就緒，無法請 AI 設計角色敘事。");
      return;
    }
    if (!script.public_summary) {
      appendSystem("尚無劇本公開設定，請先完成 Session 0。");
      return;
    }
    if (!schema) {
      appendSystem("尚無創角藍圖，請先產生 generate_character_schema。");
      return;
    }

    const hooksList = hookQuestions.length
      ? hookQuestions
          .map(
            (q) =>
              `- id="${q.id}"（${q.category}）：${q.question}`,
          )
          .join("\n")
      : "（無鉤子問題；可省略 backstory_hooks 或回傳空陣列）";

    const systemFields =
      character.system_id === "COC_7E"
        ? [
            "系統 COC_7E：必須完整填 profile_coc.occupation、profile_coc.cash_assets。",
            "不要填 profile_dnd；不要給任何屬性數字、技能％、信用評級％。",
          ].join("\n")
        : [
            "系統 DND_5E：必須完整填 profile_dnd 全部子欄：",
            "race、class_name、background、alignment、speed、proficiencies、features。",
            "不要填 profile_coc；不要給任何屬性數字或技能配點。",
          ].join("\n");

    const fieldChecklist = [
      "【必須一次填齊的欄位清單——不可省略、不可留空】",
      "共通：name、role_title、age、gender、appearance、residence、birthplace、languages、personal_bio、wealth",
      "劇情鉤子：backstory_hooks 必須包含下列每一個 id 的非空 answer",
      "背包：inventory 至少數件具體物品",
      systemFields,
    ].join("\n");

    setGeneratingNarrative(true);
    appendSystem("正在請 AI 依劇本與藍圖完整填寫角色敘事欄位…");
    try {
      await session.sendText(
        [
          "此步驟是創角頁「請 AI 設計角色敘事」。請立刻呼叫工具 fill_character_narrative。",
          "目標：除屬性與技能配點外，前端已開放的敘事／身分欄位全部填寫完整。",
          fieldChecklist,
          `劇本標題：${script.public_summary.title}`,
          `類型：${script.public_summary.genre}`,
          `主角定位：${script.public_summary.protagonist_role}`,
          `公開背景：${script.public_summary.background}`,
          script.public_summary.player_hook
            ? `玩家鉤子：${script.public_summary.player_hook}`
            : "",
          schema.role_title_suggestion
            ? `藍圖建議職稱：${schema.role_title_suggestion}`
            : "",
          schema.starting_inventory?.length
            ? `藍圖建議背包可參考：${schema.starting_inventory.join("、")}`
            : "",
          "請讓角色貼合上述定位與氛圍，文字一律繁體中文，內容具體可用。",
          "backstory_hooks 的 id 必須完全對應下列問題（每一題都要有答案）：",
          hooksList,
          "填完工具後用一句繁中 player_note 說明設計概念即可。",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      appendSystem(
        `請 AI 設計角色敘事失敗：${
          err instanceof Error ? err.message : "未知錯誤"
        }`,
      );
    } finally {
      setGeneratingNarrative(false);
    }
  };

  if (!character) {
    return <p className="text-sm text-muted">等待劇本與創角規則…</p>;
  }

  const isDnd = character.system_id === "DND_5E";
  const isCoc = character.system_id === "COC_7E";
  const attrsReady = attrsReadyForTips;

  const attrTip = (d: (typeof defs)[number]) =>
    attributeTooltipContent(character.system_id, d, {
      mode,
      score: character.attributes[d.key],
      modifier: character.attribute_modifiers?.[`${d.key}_MOD`],
    });

  const applyAttributes = (next: Record<string, number>) => {
    updateCharacterField((s) => ({
      ...s,
      attributes: { ...s.attributes, ...next },
      // 屬性重算時重置衍生資源 max，讓 recomputeDerived 重新灌滿 current
      derived: {
        ...s.derived,
        hp: { current: 0, max: 0 },
        mp_or_slots: { current: 0, max: 0 },
        san: { current: 0, max: 0 },
      },
    }));
  };

  const rollAllDice = () => {
    const pool: number[] = [];
    const logs: string[] = [];
    for (const def of defs) {
      const formula = def.dice_formula || (isDnd ? "4d6dl1" : "3d6x5");
      const r = rollCreationFormula(formula);
      pool.push(r.total);
      logs.push(`${def.label}: ${r.detail}`);
    }
    setRolledPool(pool);
    setRollLog(logs);
    setAssignments({});
    // DICE：直接鎖定套用，不可手改
    const next: Record<string, number> = {};
    attrKeys.forEach((k, i) => {
      next[k] = pool[i] ?? 0;
    });
    applyAttributes(next);
    appendSystem(
      mode === "SKILL_ALLOC"
        ? "已擲骰產生基礎屬性（鎖定），接著分配職業／興趣技能點。"
        : "已完成擲骰並鎖定屬性。若要重骰可再按一次。",
    );
  };

  /** ARRAY：選擇時即時套用，互斥 */
  const setArrayAssignment = (key: string, idxOrEmpty: number | "") => {
    const nextAssign = { ...assignments, [key]: idxOrEmpty };
    setAssignments(nextAssign);
    const next: Record<string, number> = {};
    let complete = true;
    for (const k of attrKeys) {
      const v = nextAssign[k];
      if (v === "" || v == null) {
        complete = false;
        continue;
      }
      next[k] = arrayValues[Number(v)] ?? 0;
    }
    if (complete && Object.keys(next).length === attrKeys.length) {
      applyAttributes(next);
    }
  };

  const canPointBuyAdjust = (key: string, newScore: number) => {
    if (!pointBuy) return false;
    if (newScore < pointBuy.min_score || newScore > pointBuy.max_score) {
      return false;
    }
    const trial = { ...character.attributes, [key]: newScore };
    return totalPointBuySpent(trial, attrKeys, pointBuy) <= pointBuy.budget;
  };

  const adjustPointBuy = (key: string, score: number) => {
    if (!canPointBuyAdjust(key, score)) return;
    applyAttributes({ [key]: score });
  };

  const syncSkillsFromSpend = (spend: SkillSpend) => {
    updateCharacterField((sheet) => {
      const skills = { ...sheet.skills };
      for (const sk of allocSkills) {
        const extra = spend[sk.name] ?? { occ: 0, interest: 0 };
        skills[sk.name] = sk.base_value + extra.occ + extra.interest;
      }
      return { ...sheet, skills };
    });
  };

  /** 完整帶入檔案庫／JSON：屬性、技能、背包、鉤子，並還原本機分配 UI 狀態 */
  const importCharacterSheet = (
    raw: UniversalCharacterSheet,
    sourceLabel: string,
  ) => {
    const sheet = migrateCharacterSheet(raw);
    setCharacter(sheet);

    const spend = buildSkillSpendFromSheet(sheet, allocSkills);
    setSkillSpend(spend);

    const attrPool = attrKeys.map((k) => sheet.attributes[k] ?? 0);
    setRolledPool(attrPool);
    setRollLog(
      defs.map((d) => {
        const v = sheet.attributes[d.key];
        return `${d.label}: ${v != null && v > 0 ? v : "—"}（自${sourceLabel}帶入）`;
      }),
    );
    setAssignments(
      buildArrayAssignmentsFromSheet(
        sheet.attributes,
        attrKeys,
        arrayValues,
      ),
    );

    const warned = new Set<string>();
    for (const sk of allocSkills) {
      const v = sheet.skills[sk.name] ?? sk.base_value;
      if (v > 80) warned.add(sk.name);
    }
    setHighSkillWarned(warned);

    if (
      schema?.system_id &&
      sheet.system_id &&
      schema.system_id !== sheet.system_id
    ) {
      appendSystem(
        `已帶入「${sheet.name}」的完整數值，但系統（${sheet.system_id}）與目前劇本（${schema.system_id}）不同，請留意規則是否相容。`,
      );
    } else {
      appendSystem(
        `已從${sourceLabel}完整帶入「${sheet.name}」：屬性、技能、背包與劇情鉤子。`,
      );
    }
  };

  const maxAffordableFor = (
    name: string,
    pool: "occ" | "interest",
  ): number => {
    const sk = allocSkills.find((s) => s.name === name);
    const cur = skillSpend[name] ?? { occ: 0, interest: 0 };
    const otherPool = pool === "occ" ? cur.interest : cur.occ;
    const base = sk?.base_value ?? 0;
    // 創角單技總值不可超過 99%：此池最多還能再加多少
    const roomUnderCap = Math.max(
      0,
      COC_CREATION_SKILL_CAP - base - otherPool,
    );
    const byBudget =
      pool === "occ"
        ? Math.max(0, occBudget - (occUsed - cur.occ))
        : Math.max(0, interestBudget - (interestUsed - cur.interest));
    return Math.min(byBudget, roomUnderCap);
  };

  /** 直接設定某技能在點池上花費的點數（自動 clamp 到剩餘預算與創角上限） */
  const setSkillPool = (
    name: string,
    pool: "occ" | "interest",
    requested: number,
  ) => {
    const sk = allocSkills.find((s) => s.name === name);
    if (!sk) return;
    if (pool === "occ" && !sk.is_occupational) {
      appendSystem("職業點只能花在職業技能上。");
      return;
    }
    const cur = skillSpend[name] ?? { occ: 0, interest: 0 };
    const maxAffordable = maxAffordableFor(name, pool);
    const raw = Number.isFinite(requested) ? Math.floor(requested) : 0;
    const nextVal = Math.max(0, Math.min(raw, maxAffordable));
    if (nextVal === cur[pool]) {
      if (raw > maxAffordable) {
        const otherPool = pool === "occ" ? cur.interest : cur.occ;
        const atCap =
          sk.base_value + otherPool + maxAffordable >= COC_CREATION_SKILL_CAP &&
          sk.base_value + cur.occ + cur.interest >= COC_CREATION_SKILL_CAP;
        appendSystem(
          atCap || sk.base_value + otherPool >= COC_CREATION_SKILL_CAP
            ? `「${name}」創角上限為 ${COC_CREATION_SKILL_CAP}%（大師級上限；更高數值留給遊玩後成長）。`
            : pool === "occ"
              ? `職業點不足（已用 ${occUsed}/${occBudget}，此技此池最多 ${maxAffordable}）。`
              : `興趣點不足（已用 ${interestUsed}/${interestBudget}，此技此池最多 ${maxAffordable}）。`,
        );
      }
      return;
    }
    const trial = { ...skillSpend, [name]: { ...cur, [pool]: nextVal } };
    const finalSkill = sk.base_value + trial[name].occ + trial[name].interest;
    if (finalSkill > 80 && !highSkillWarned.has(name)) {
      appendSystem(
        `注意：${name} 將達 ${finalSkill}%（>80）。高技能在 CoC 極具優勢，但也更難成長。`,
      );
      setHighSkillWarned((s) => new Set(s).add(name));
    }
    setSkillSpend(trial);
    syncSkillsFromSpend(trial);
  };

  const adjustSkill = (
    name: string,
    pool: "occ" | "interest",
    delta: number,
  ) => {
    const cur = skillSpend[name] ?? { occ: 0, interest: 0 };
    setSkillPool(name, pool, cur[pool] + delta);
  };

  const toggleOccupational = (name: string) => {
    const sk = allocSkills.find((s) => s.name === name);
    if (!sk) return;
    const next = !sk.is_occupational;
    setOccOverrides((prev) => ({ ...prev, [name]: next }));
    if (!next) {
      const cur = skillSpend[name] ?? { occ: 0, interest: 0 };
      if (cur.occ > 0) {
        // 取消職業標記時，職業點改丟回池（興趣點保留）
        const cleared = { ...skillSpend, [name]: { occ: 0, interest: cur.interest } };
        setSkillSpend(cleared);
        syncSkillsFromSpend(cleared);
        appendSystem(
          `已取消「${name}」的職業技能標記，該技職業點已退回點池。`,
        );
      }
    }
  };

  const addCatalogSkill = () => {
    if (!addSkillPick || !character) return;
    const cat = listCocSkillCatalog().find((s) => s.name === addSkillPick);
    if (!cat) return;
    if (allocSkills.some((s) => s.name === cat.name)) {
      appendSystem(`「${cat.name}」已在列表中。`);
      return;
    }
    const dodgeBase =
      cat.name === "閃避"
        ? Math.floor((character.attributes.DEX ?? 0) / 2)
        : cat.base_value;
    setExtraSkills((prev) => [
      ...prev,
      {
        name: cat.name,
        base_value: dodgeBase,
        description: "玩家自行加入的職業／個人技能",
        is_occupational: true,
      },
    ]);
    setOccOverrides((prev) => ({ ...prev, [cat.name]: true }));
    setAddSkillPick("");
    appendSystem(`已加入「${cat.name}」並標為職業技能，可用職業點分配。`);
  };

  const canConfirm =
    Boolean(character.name.trim()) &&
    Boolean(character.role_title.trim()) &&
    attrsReady &&
    hooksReady &&
    (mode !== "POINT_BUY" ||
      (pointBuy != null && spentPoints <= pointBuy.budget)) &&
    ((mode !== "SKILL_ALLOC" && !isCoc) ||
      (occUsed <= occBudget && interestUsed <= interestBudget));

  /** CoC 無論屬性模式為何，創角後都應可分配職業／興趣技能點 */
  const showSkillAlloc = Boolean(
    schema && attrsReady && (mode === "SKILL_ALLOC" || isCoc),
  );

  return (
    <div className="space-y-4 overflow-y-auto p-1 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={
            generatingNarrative ||
            isTyping ||
            sessionStatus === "running" ||
            !schema ||
            !script.public_summary
          }
          onClick={() => void requestAiNarrative()}
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {generatingNarrative || isTyping
            ? "AI 設計中…"
            : "請 AI 設計角色敘事"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => exportCharacterJson(character)}
          disabled={!attrsReady}
        >
          匯出 JSON
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
          匯入 JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const parsed = JSON.parse(text) as UniversalCharacterSheet;
              importCharacterSheet(parsed, "JSON 檔");
            } catch {
              appendSystem("匯入失敗：JSON 格式無效。");
            }
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!attrsReady || !character.name}
          onClick={() => {
            saveCharacterToLibrary(character);
            setLibrary(loadCharacterLibrary());
            appendSystem("已存入本機角色檔案庫。");
          }}
        >
          存入檔案庫
        </Button>
      </div>
      {generatingNarrative ||
      sessionStatus === "running" ||
      latestSystemNotice ? (
        <p className="text-xs text-muted">
          {generatingNarrative || sessionStatus === "running"
            ? "AI 設計中，完成後會自動帶入身分／鉤子／背包欄位（不會改配點）。"
            : latestSystemNotice}
        </p>
      ) : null}

      {library.length ? (
        <div className="space-y-1">
          <Label>本機檔案庫</Label>
          <div className="flex flex-wrap gap-2">
            {library.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="ghost"
                onClick={() => importCharacterSheet(c, "本機檔案庫")}
              >
                {c.name}（{c.system_id}）
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>姓名</Label>
          <Input
            value={character.name}
            onChange={(e) =>
              updateCharacterField((s) => ({ ...s, name: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label>{isCoc ? "顯示別名（可選）" : "職稱／顯示名"}</Label>
          <Input
            value={character.role_title}
            placeholder={
              isDnd
                ? schema?.role_title_suggestion ||
                  "例如：人類 戰士"
                : schema?.role_title_suggestion ||
                  (isCoc ? "例如：夜班記者" : "")
            }
            onChange={(e) =>
              updateCharacterField((s) => ({ ...s, role_title: e.target.value }))
            }
          />
        </div>
      </div>

      {/* 身分資料（共通） */}
      <section className="space-y-3 rounded-lg border border-border p-3">
        <div>
          <div className="text-sm font-medium text-ink">身分資料</div>
          <p className="text-[11px] text-muted">
            建議填寫；不強制，但有助 GM 敘事與外貌描寫。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {(
            [
              ["age", "年齡"],
              ["gender", "性別／認同"],
              ["residence", "現居／活動地"],
              ["birthplace", "出生地"],
              ["languages", "語言"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                value={character[key] ?? ""}
                onChange={(e) =>
                  updateCharacterField((s) => ({
                    ...s,
                    [key]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label className="text-xs">資產概況</Label>
            <Input
              value={character.wealth ?? ""}
              placeholder={
                isCoc
                  ? "例如：薪水溫飽、小康存款…"
                  : "生活水準／經濟狀況"
              }
              onChange={(e) =>
                updateCharacterField((s) => ({
                  ...s,
                  wealth: e.target.value,
                }))
              }
            />
            {isCoc ? (
              <p className="text-[10px] text-muted">
                文字描述；請與下方信用評級區間大致相符。
              </p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">外貌</Label>
          <Textarea
            rows={2}
            placeholder="髮色、穿著、顯著特徵…"
            value={character.appearance ?? ""}
            onChange={(e) =>
              updateCharacterField((s) => ({
                ...s,
                appearance: e.target.value,
              }))
            }
          />
        </div>

        {isCoc ? (
          <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">職業（CoC）</Label>
              <Input
                value={character.profile_coc?.occupation ?? ""}
                placeholder="正式職業名，例如：私家偵探、圖書館員"
                onChange={(e) => {
                  const occupation = e.target.value;
                  updateCharacterField((s) => ({
                    ...s,
                    profile_coc: {
                      ...(s.profile_coc ?? {}),
                      occupation,
                    },
                    // 若別名空白，同步為職業名方便側欄顯示
                    role_title:
                      !s.role_title.trim() ||
                      s.role_title === (s.profile_coc?.occupation ?? "")
                        ? occupation
                        : s.role_title,
                  }));
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">現金／資產細節</Label>
              <Textarea
                rows={2}
                placeholder="現金、存款、房產等（請與下方信用評級大致對齊）"
                value={character.profile_coc?.cash_assets ?? ""}
                onChange={(e) =>
                  updateCharacterField((s) => ({
                    ...s,
                    profile_coc: {
                      ...(s.profile_coc ?? {}),
                      cash_assets: e.target.value,
                    },
                  }))
                }
              />
              <p className="text-[10px] text-muted">
                自由文字即可；生活水準應和信用評級區間說得通。
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <HoverTooltip
                  header="信用評級（技能％）"
                  content={CREDIT_RATING_TOOLTIP}
                >
                  <Label className="text-xs underline decoration-dotted decoration-muted underline-offset-2">
                    信用評級（技能％・社會地位）
                  </Label>
                </HoverTooltip>
                <span className="text-[10px] text-muted">
                  與技能列表同一欄；非自由描述
                </span>
              </div>
              <p className="text-[10px] text-muted">
                先選生活水準帶入建議值，再用技能點微調亦可。不強制，但建議填。
              </p>
              <div className="flex flex-wrap gap-1.5">
                {CREDIT_LIFESTYLE_BANDS.map((b) => {
                  const active = creditBand?.id === b.id;
                  return (
                    <Button
                      key={b.id}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "secondary"}
                      className="h-7 text-[10px]"
                      title={`${b.hint}（建議 ${b.min}–${b.max}%，中值 ${b.mid}）`}
                      onClick={() => setCreditRating(b.mid)}
                    >
                      {b.label} {b.min}–{b.max}
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={99}
                  className="w-28"
                  value={creditScore ?? ""}
                  placeholder="0–99"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      setCreditRating(undefined);
                      return;
                    }
                    const n = Number(raw);
                    if (!Number.isFinite(n)) return;
                    setCreditRating(n);
                  }}
                />
                <span className="text-xs text-muted">%</span>
                {creditBand ? (
                  <span className="text-[11px] text-ink/80">
                    目前：{creditBand.label}（{creditBand.hint}）
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">尚未設定</span>
                )}
              </div>
              {creditWarning ? (
                <p className="text-[11px] text-amber-400/95">{creditWarning}</p>
              ) : null}
            </div>
            {attrsReady ? (
              <div className="rounded border border-border/70 bg-bg/20 p-2 text-xs text-muted sm:col-span-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide">
                  CoC 衍生（唯讀）
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {derivedRows
                    .filter((r) => ["mov", "build_db"].includes(r.id))
                    .map((r) => (
                      <HoverTooltip
                        key={r.id}
                        header={r.label}
                        content={r.content}
                      >
                        <span className="underline decoration-dotted decoration-muted underline-offset-2 text-ink/90">
                          {r.id === "mov" ? `MOV ${r.display}` : r.display}
                        </span>
                      </HoverTooltip>
                    ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isDnd ? (
          <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2 md:grid-cols-3">
            {(
              [
                ["race", "種族"],
                ["class_name", "職業"],
                ["background", "背景"],
                ["alignment", "陣營"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  value={character.profile_dnd?.[key] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateCharacterField((s) => {
                      const profile = {
                        ...(s.profile_dnd ?? { speed: 30 }),
                        [key]: val,
                      };
                      // 提示用：種族＋職業可回填顯示名（僅當空白或先前聯動）
                      let role = s.role_title;
                      if (key === "race" || key === "class_name") {
                        const race =
                          key === "race" ? val : (profile.race ?? "");
                        const cls =
                          key === "class_name"
                            ? val
                            : (profile.class_name ?? "");
                        const suggested = [race, cls]
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .join(" ");
                        const prevSuggested = [
                          s.profile_dnd?.race ?? "",
                          s.profile_dnd?.class_name ?? "",
                        ]
                          .map((x) => x.trim())
                          .filter(Boolean)
                          .join(" ");
                        if (
                          !role.trim() ||
                          role.trim() === prevSuggested
                        ) {
                          role = suggested;
                        }
                      }
                      return {
                        ...s,
                        profile_dnd: profile,
                        role_title: role,
                      };
                    });
                  }}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">速度（英尺）</Label>
              <Input
                type="number"
                min={0}
                value={character.profile_dnd?.speed ?? 30}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  updateCharacterField((s) => ({
                    ...s,
                    profile_dnd: {
                      ...(s.profile_dnd ?? {}),
                      speed: Number.isFinite(n) ? n : 30,
                    },
                  }));
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2 md:col-span-3">
              <Label className="text-xs">熟練（技能／工具／豁免／武器護甲）</Label>
              <Textarea
                rows={2}
                value={character.profile_dnd?.proficiencies ?? ""}
                onChange={(e) =>
                  updateCharacterField((s) => ({
                    ...s,
                    profile_dnd: {
                      ...(s.profile_dnd ?? { speed: 30 }),
                      proficiencies: e.target.value,
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2 md:col-span-3">
              <Label className="text-xs">特性摘要（種族／職業／背景）</Label>
              <Textarea
                rows={3}
                value={character.profile_dnd?.features ?? ""}
                onChange={(e) =>
                  updateCharacterField((s) => ({
                    ...s,
                    profile_dnd: {
                      ...(s.profile_dnd ?? { speed: 30 }),
                      features: e.target.value,
                    },
                  }))
                }
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* ═══ 雙軌：Stats | Hooks ═══ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stats track */}
        <section className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <div className="text-sm font-medium text-ink">數值面板</div>
            <p className="text-[11px] text-muted">
              依規則分配屬性／技能；衍生值由 MathJS 即時計算。
            </p>
          </div>

          {schema && (mode === "DICE" || mode === "SKILL_ALLOC") ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs">
                  {mode === "DICE" ? "物理擲骰（結果鎖定）" : "基礎屬性擲骰"}
                </Label>
                <Button size="sm" onClick={rollAllDice}>
                  {rolledPool.length ? "重新擲骰" : "開始擲骰"}
                </Button>
              </div>
              {rollLog.length ? (
                <ul className="space-y-0.5 text-[10px] text-muted">
                  {rollLog.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {defs.map((d) => (
                  <div
                    key={d.key}
                    className="rounded bg-bg/40 px-2 py-1 text-xs"
                  >
                    <HoverTooltip header={d.label} content={attrTip(d)}>
                      <div className="text-muted underline decoration-dotted decoration-muted underline-offset-2">
                        {d.label}
                        <span className="ml-1 opacity-60 no-underline">
                          {d.dice_formula}
                        </span>
                      </div>
                    </HoverTooltip>
                    <div className="text-ink">
                      {character.attributes[d.key] != null &&
                      character.attributes[d.key]! > 0
                        ? character.attributes[d.key]
                        : "—"}
                      {isDnd &&
                      character.attribute_modifiers?.[`${d.key}_MOD`] != null
                        ? `（${(character.attribute_modifiers[`${d.key}_MOD`] ?? 0) >= 0 ? "+" : ""}${character.attribute_modifiers[`${d.key}_MOD`]}）`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {schema && mode === "ARRAY" ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <Label className="text-xs">
                標準陣列（互斥）[{arrayValues.join(", ")}]
              </Label>
              <div className="grid gap-2">
                {defs.map((d) => (
                  <div key={d.key} className="flex items-center gap-2">
                    <HoverTooltip header={d.label} content={attrTip(d)}>
                      <span className="w-14 shrink-0 text-xs underline decoration-dotted decoration-muted underline-offset-2">
                        {d.label}
                      </span>
                    </HoverTooltip>
                    <select
                      className="h-9 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                      value={assignments[d.key] ?? ""}
                      onChange={(e) =>
                        setArrayAssignment(
                          d.key,
                          e.target.value === ""
                            ? ""
                            : Number(e.target.value),
                        )
                      }
                    >
                      <option value="">選擇分數</option>
                      {arrayValues.map((v, idx) => {
                        const taken =
                          usedArrayIndices.has(idx) &&
                          assignments[d.key] !== idx;
                        return (
                          <option
                            key={`${d.key}-${idx}`}
                            value={idx}
                            disabled={taken}
                          >
                            {v}
                            {taken ? "（已用）" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {schema && mode === "POINT_BUY" && pointBuy ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <Label className="text-xs">
                購點制：已用 {spentPoints} / {pointBuy.budget}（
                {pointBuy.min_score}–{pointBuy.max_score}）
              </Label>
              <div className="grid gap-2">
                {defs.map((d) => {
                  const score =
                    character.attributes[d.key] || pointBuy.min_score;
                  const canMinus = canPointBuyAdjust(d.key, score - 1);
                  const canPlus = canPointBuyAdjust(d.key, score + 1);
                  return (
                    <div
                      key={d.key}
                      className="flex items-center gap-2 text-xs"
                    >
                      <HoverTooltip header={d.label} content={attrTip(d)}>
                        <span className="w-14 underline decoration-dotted decoration-muted underline-offset-2">
                          {d.label}
                        </span>
                      </HoverTooltip>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canMinus}
                        onClick={() => adjustPointBuy(d.key, score - 1)}
                      >
                        −
                      </Button>
                      <span className="w-8 text-center text-ink">{score}</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canPlus}
                        onClick={() => adjustPointBuy(d.key, score + 1)}
                      >
                        +
                      </Button>
                      <span className="text-muted">
                        花費 {pointBuyCost(score, pointBuy)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showSkillAlloc ? (
            <div className="space-y-3 rounded border border-border/70 bg-bg/20 p-2">
              <div className="space-y-2">
                <Label className="text-xs">技能雙點池</Label>
                <p className="text-[10px] text-muted">
                  職業點只能花在「職業」技能上；興趣點可花在任何技能。單技創角上限{" "}
                  {COC_CREATION_SKILL_CAP}% 。若職業點花不完，請把更多技能標成職業，或從目錄新增技能。
                </p>
                <SkillPoolMeter
                  label="職業"
                  used={occUsed}
                  budget={occBudget}
                  tooltip={skillPoolFormulaTooltip(
                    "職業",
                    modeConfig?.occupational_point_formula ??
                      (isCoc ? "EDU * 4" : ""),
                    character.attributes,
                    occBudget,
                  )}
                />
                {interestBudget > 0 ? (
                  <SkillPoolMeter
                    label="興趣"
                    used={interestUsed}
                    budget={interestBudget}
                    tooltip={skillPoolFormulaTooltip(
                      "興趣",
                      modeConfig?.interest_point_formula ??
                        (isCoc ? "INT * 2" : ""),
                      character.attributes,
                      interestBudget,
                    )}
                  />
                ) : null}
                <p className="text-[10px] text-muted">
                  職業技能 {occSkillCount} 項 · 職業點可吸收上限約{" "}
                  {occAbsorbCap}（已用 {occUsed}）
                </p>
                {occUnspendable > 0 ? (
                  <p className="text-[11px] text-amber-400/95">
                    職業點還剩 {occRemaining}，但目前職業技能最多只能再吸收{" "}
                    {occRoomLeft}（單技上限{" "}
                    {COC_CREATION_SKILL_CAP}%）。請將更多技能標為「職業」，或下方新增技能。
                  </p>
                ) : null}
                {isCoc && cocCatalogOptions.length ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-8 min-w-[10rem] flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                      value={addSkillPick}
                      onChange={(e) => setAddSkillPick(e.target.value)}
                    >
                      <option value="">新增技能（標為職業）…</option>
                      {cocCatalogOptions.map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}（基礎 {s.base_value}%）
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!addSkillPick}
                      onClick={addCatalogSkill}
                    >
                      加入
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                {allocSkills.map((sk) => {
                  const spend = skillSpend[sk.name] ?? { occ: 0, interest: 0 };
                  const value = character.skills[sk.name] ?? sk.base_value;
                  const over80 = value > 80;
                  return (
                    <div
                      key={sk.name}
                      className="rounded bg-bg/30 px-2 py-2"
                    >
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <HoverTooltip
                            header={sk.name}
                            content={sk.description ?? ""}
                          >
                            <div className="text-xs text-ink underline decoration-dotted decoration-muted underline-offset-2">
                              {sk.name}
                            </div>
                          </HoverTooltip>
                          <Button
                            type="button"
                            size="sm"
                            variant={sk.is_occupational ? "default" : "secondary"}
                            className="h-6 px-2 text-[10px]"
                            onClick={() => toggleOccupational(sk.name)}
                          >
                            {sk.is_occupational ? "職業 ✓" : "標為職業"}
                          </Button>
                        </div>
                        <div className="text-[10px] text-muted">
                          基礎 {sk.base_value}
                          <span
                            className={`ml-2 text-sm font-medium ${over80 ? "text-amber-400" : "text-ink"}`}
                          >
                            → {value}%
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {sk.is_occupational ? (
                          <SkillPoolControls
                            label="職業"
                            value={spend.occ}
                            max={maxAffordableFor(sk.name, "occ")}
                            remainingBudget={occBudget - occUsed}
                            onSet={(n) => setSkillPool(sk.name, "occ", n)}
                            onAdjust={(d) => adjustSkill(sk.name, "occ", d)}
                          />
                        ) : null}
                        {interestBudget > 0 ? (
                          <SkillPoolControls
                            label="興趣"
                            value={spend.interest}
                            max={maxAffordableFor(sk.name, "interest")}
                            remainingBudget={interestBudget - interestUsed}
                            onSet={(n) =>
                              setSkillPool(sk.name, "interest", n)
                            }
                            onAdjust={(d) =>
                              adjustSkill(sk.name, "interest", d)
                            }
                          />
                        ) : null}
                      </div>
                      {value >= COC_CREATION_SKILL_CAP ? (
                        <p className="mt-1.5 text-[10px] text-accent-2">
                          已達創角上限 {COC_CREATION_SKILL_CAP}%（大師級）。更高數值請留給遊玩後成長。
                        </p>
                      ) : over80 ? (
                        <p className="mt-1.5 text-[10px] text-amber-400/90">
                          警告：超過 80%，成長檢定將更困難。
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {schema &&
          (mode === "SKILL_ALLOC" || isCoc) &&
          !attrsReady ? (
            <p className="text-xs text-muted">請先完成屬性，再開啟技能分配。</p>
          ) : null}

          {attrsReady ? (
            <div className="space-y-2 rounded border border-border bg-surface-2 p-2 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted">
                衍生數值
                <span className="ml-1 font-normal normal-case tracking-normal">
                  （游標移上可看公式）
                </span>
              </div>
              <div className="space-y-1">
                {derivedRows.map((r) => (
                  <HoverTooltip
                    key={r.id}
                    header={r.label}
                    content={r.content}
                  >
                    <div className="underline decoration-dotted decoration-muted underline-offset-2">
                      {r.label} {r.display}
                    </div>
                  </HoverTooltip>
                ))}
              </div>
              {fixedAttrRows.length ? (
                <div className="space-y-1 border-t border-border/50 pt-2">
                  <div className="text-[10px] text-muted">
                    系統固定參數（影響 HP／AC／熟練）
                  </div>
                  {fixedAttrRows.map((r) => (
                    <HoverTooltip
                      key={r.id}
                      header={r.label}
                      content={r.content}
                    >
                      <div className="underline decoration-dotted decoration-muted underline-offset-2">
                        {r.label} {r.display}
                      </div>
                    </HoverTooltip>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!isCoc &&
          mode !== "SKILL_ALLOC" &&
          schemaSkills.length ? (
            <div className="space-y-1 text-xs text-muted">
              <div>推薦技能基礎值：</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {schemaSkills.map((s) => (
                  <HoverTooltip
                    key={s.name}
                    header={s.name}
                    content={s.description ?? ""}
                  >
                    <span className="underline decoration-dotted decoration-muted underline-offset-2 text-ink/90">
                      {s.name} {s.base_value}
                    </span>
                  </HoverTooltip>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Hooks track */}
        <section className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <div className="text-sm font-medium text-ink">劇情鉤子</div>
            <p className="text-[11px] text-muted">
              {isCoc
                ? "狂氣發作時 GM 會讀取這些錨點發動精神衝擊。"
                : "GM 依特質／理想／羈絆／缺點頒發靈感與觸發專屬 NPC。"}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">背景短述</Label>
            <Textarea
              rows={3}
              placeholder="一句到一段的人物背景…"
              value={character.personal_bio ?? ""}
              onChange={(e) =>
                updateCharacterField((s) => ({
                  ...s,
                  personal_bio: e.target.value,
                }))
              }
            />
          </div>

          {hookQuestions.length ? (
            <div className="space-y-3">
              {hookQuestions.map((q) => (
                <div key={q.id} className="space-y-1">
                  <Label className="text-xs">
                    <span className="text-accent-2">{q.category}</span>
                    <span className="ml-1 font-normal text-muted">
                      — {q.question}
                    </span>
                  </Label>
                  <Textarea
                    rows={3}
                    placeholder={`寫下你的「${q.category}」…`}
                    value={character.backstory_hooks[q.id] ?? ""}
                    onChange={(e) =>
                      updateCharacterField((s) => ({
                        ...s,
                        backstory_hooks: {
                          ...s.backstory_hooks,
                          [q.id]: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">
              選擇創角方式後，將產生系統對應的鉤子問題。
            </p>
          )}

          <div className="space-y-1 border-t border-border/60 pt-3">
            <Label className="text-xs">起始背包</Label>
            <Textarea
              rows={3}
              value={character.inventory.join("\n")}
              onChange={(e) =>
                updateCharacterField((s) => ({
                  ...s,
                  inventory: e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                }))
              }
            />
          </div>
        </section>
      </div>

      <Button disabled={!canConfirm} onClick={() => confirmCharacterAndPlay()}>
        確認角色，開始冒險
      </Button>
      {!canConfirm ? (
        <p className="text-xs text-muted">
          需填寫姓名／職稱、完成屬性規則，並寫完所有劇情鉤子
          {isCoc || mode === "SKILL_ALLOC"
            ? "（技能點不可超支）"
            : ""}
          。
        </p>
      ) : null}
    </div>
  );
}

function SkillPoolMeter({
  label,
  used,
  budget,
  tooltip,
}: {
  label: string;
  used: number;
  budget: number;
  tooltip?: string;
}) {
  const remaining = Math.max(0, budget - used);
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const over = used > budget;
  const title = (
    <span className="text-muted">
      {tooltip ? (
        <span className="underline decoration-dotted decoration-muted underline-offset-2">
          {label}
        </span>
      ) : (
        label
      )}
    </span>
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        {tooltip ? (
          <HoverTooltip header={`${label}點池`} content={tooltip}>
            {title}
          </HoverTooltip>
        ) : (
          title
        )}
        <span className={over ? "text-amber-400" : "text-ink"}>
          {used}/{budget}
          <span className="ml-1.5 text-muted">剩 {remaining}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-[width] ${over ? "bg-amber-400" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const QUICK_STEPS = [5, 10, 20] as const;

function SkillPoolControls({
  label,
  value,
  max,
  remainingBudget,
  onSet,
  onAdjust,
}: {
  label: string;
  value: number;
  max: number;
  remainingBudget: number;
  onSet: (n: number) => void;
  onAdjust: (delta: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commitDraft = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === "") {
      setDraft(String(value));
      return;
    }
    onSet(Math.floor(n));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] text-muted">{label}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 w-8 px-0"
        disabled={value <= 0}
        onClick={() => onAdjust(-1)}
        aria-label={`${label}減 1`}
      >
        −
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commitDraft();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-16 px-2 text-center tabular-nums"
        aria-label={`${label}點數`}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 w-8 px-0"
        disabled={remainingBudget <= 0 || value >= max}
        onClick={() => onAdjust(1)}
        aria-label={`${label}加 1`}
      >
        +
      </Button>
      {QUICK_STEPS.map((step) => (
        <Button
          key={step}
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 px-2"
          disabled={remainingBudget <= 0}
          onClick={() => onAdjust(step)}
        >
          +{step}
        </Button>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-muted"
        disabled={value <= 0}
        onClick={() => onSet(0)}
      >
        清空
      </Button>
    </div>
  );
}
