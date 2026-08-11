import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useRepeatPress } from "@/hooks/useRepeatPress";
import type { RecommendedSkill, UniversalCharacterSheet } from "@/types/game";
import type { CharacterCreationDraft } from "@/types/party";
import {
  buildAttributesAfterAgeMod,
  describeCocAgeBand,
  emptyAllocation,
  isCocAgeModComplete,
  maxAllocatableForKey,
  parseAgeYears,
  resolveCocAgeBand,
  rollLuckForAge,
  runEduImprovementChecks,
  sumAllocation,
} from "@/engine/cocAgeModifiers";
import {
  evalAttrFormula,
  normalizeCreationMode,
  pointBuyCost,
  resolveSkillBaseValue,
  resolveStandardArray,
  resolvePointBuyConfig,
  rollCreationFormula,
  totalPointBuySpent,
  COC_CREATION_SKILL_CAP,
  listCocSkillCatalog,
  enrichCharacterSheetMeta,
  resolveSkillDescription,
  clampSkillsToSystemBases,
} from "@/engine/creation";
import {
  draftFromUi,
  hydrateUiFromDraft,
  type SkillSpend,
} from "@/engine/creationDraft";
import { buildPartyNarrativeDesignContext } from "@/engine/partyNarrativeBrief";
import {
  CREDIT_LIFESTYLE_BANDS,
  CREDIT_RATING_TOOLTIP,
  bandForCredit,
  creditConsistencyWarning,
  suggestedWealthCopy,
} from "@/engine/creditRatingGuide";
import {
  attributeTooltipContent,
  buildDerivedTooltipRows,
  buildFixedAttrTooltipRows,
  skillPoolFormulaTooltip,
} from "@/engine/statTooltips";
import { getActiveSession, sendGmText } from "@/lib/pedelec/createGameSession";
import {
  exportCharacterJson,
  saveCharacterToLibrary,
} from "@/lib/storage";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

export function CharacterStage({
  allowLibrarySave = true,
  onSlotSaved,
}: {
  /** AI 隊友席次禁止寫入角色庫 */
  allowLibrarySave?: boolean;
  /** 多人隊伍：本席存好後回調（不立刻開打時） */
  onSlotSaved?: () => void;
} = {}) {
  const character = useGameStore((s) => s.character);
  const schema = useGameStore((s) => s.characterSchema);
  const script = useGameStore((s) => s.script);
  const partySize = useGameStore((s) => s.partySize);
  const party = useGameStore((s) => s.party);
  const editingPartySlotIndex = useGameStore((s) => s.editingPartySlotIndex);
  const updateCharacterField = useGameStore((s) => s.updateCharacterField);
  const upsertPartyMemberAtSlot = useGameStore(
    (s) => s.upsertPartyMemberAtSlot,
  );
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
  const [generatingNarrative, setGeneratingNarrative] = useState(false);

  const mode = normalizeCreationMode(
    schema?.creation_mode ?? script.recommended_creation_mode,
    schema?.system_id ?? script.system_id ?? character?.system_id,
  );
  const defs = schema?.attribute_defs ?? [];
  const attrKeys = defs.map((d) => d.key);

  const [rolledPool, setRolledPool] = useState<number[]>([]);
  const [rollLog, setRollLog] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, number | "">>(
    {},
  );
  const [skillSpend, setSkillSpend] = useState<SkillSpend>({});
  const skillSpendRef = useRef<SkillSpend>({});
  skillSpendRef.current = skillSpend;
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
  /** ARRAY：手中點選的陣列索引（點屬性列放入） */
  const [pickedArrayIdx, setPickedArrayIdx] = useState<number | null>(null);
  /** 背包 textarea 編輯草稿（聚焦時用本地字串，才能穩定換行） */
  const [inventoryDraft, setInventoryDraft] = useState<string | null>(null);
  const inventoryDraftRef = useRef<string | null>(null);
  inventoryDraftRef.current = inventoryDraft;

  const occOverridesRef = useRef(occOverrides);
  occOverridesRef.current = occOverrides;
  const extraSkillsRef = useRef(extraSkills);
  extraSkillsRef.current = extraSkills;
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  const rolledPoolRef = useRef(rolledPool);
  rolledPoolRef.current = rolledPool;

  const slotDraftKeyRef = useRef(
    `${editingPartySlotIndex}:${character?.id ?? ""}`,
  );

  useEffect(() => {
    setInventoryDraft(null);
  }, [character?.id, editingPartySlotIndex]);

  const commitInventoryDraft = (raw?: string) => {
    const text = raw ?? inventoryDraftRef.current;
    if (text == null) return;
    const inventory = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    setInventoryDraft(null);
    updateCharacterField((s) => ({ ...s, inventory }));
  };

  const buildCurrentDraft = (): CharacterCreationDraft =>
    draftFromUi({
      skillSpend: skillSpendRef.current,
      occOverrides: occOverridesRef.current,
      extraSkills: extraSkillsRef.current,
      assignments: assignmentsRef.current,
      rolledPool: rolledPoolRef.current,
    });

  const persistDraftToSlot = (
    slotIndex: number,
    sheet: typeof character,
    draft: CharacterCreationDraft,
    extra?: { creationComplete?: boolean },
  ) => {
    if (!sheet) return;
    const editing = useGameStore
      .getState()
      .party.find((m) => m.slotIndex === slotIndex);
    upsertPartyMemberAtSlot(slotIndex, sheet, {
      controller: editing?.controller,
      roleHint: editing?.roleHint,
      creationDraft: draft,
      ...extra,
    });
  };

  const applyHydratedDraft = (
    draft: ReturnType<typeof hydrateUiFromDraft>,
  ) => {
    skillSpendRef.current = draft.skillSpend;
    setSkillSpend(draft.skillSpend);
    setOccOverrides(draft.occOverrides);
    setExtraSkills(draft.extraSkills);
    setAssignments(draft.assignments);
    setRolledPool(draft.rolledPool);
    setRollLog([]);
    setHighSkillWarned(new Set());
    setAddSkillPick("");
    setPickedArrayIdx(null);
  };

  /** 換席／換角色卡：先把上一席配點草稿寫回 party，再還原目前席 */
  useLayoutEffect(() => {
    const nextKey = `${editingPartySlotIndex}:${character?.id ?? ""}`;
    const prevKey = slotDraftKeyRef.current;
    if (prevKey !== nextKey) {
      const prevSlot = Number(prevKey.split(":")[0]);
      const prevId = prevKey.slice(prevKey.indexOf(":") + 1);
      if (prevId) {
        const prevSheet =
          useGameStore
            .getState()
            .party.find((m) => m.slotIndex === prevSlot)?.sheet ??
          (useGameStore.getState().character?.id === prevId
            ? useGameStore.getState().character
            : null);
        if (prevSheet) {
          persistDraftToSlot(prevSlot, prevSheet, buildCurrentDraft());
        }
      }
      slotDraftKeyRef.current = nextKey;
    }

    if (!character) return;
    const schemaSkills = (schema?.recommended_skills ?? []).map((sk) => ({
      ...sk,
      base_value: resolveSkillBaseValue(
        character.system_id,
        sk.name,
        sk.base_value,
        character.attributes,
      ),
    }));
    const member = useGameStore
      .getState()
      .party.find((m) => m.slotIndex === editingPartySlotIndex);
    const hydrated = hydrateUiFromDraft(
      member?.creationDraft,
      character,
      schemaSkills,
    );
    applyHydratedDraft(hydrated);

    // 以草稿配點覆寫 sheet.skills，避免換席後只剩敘事、技能被還原成基礎值
    const mergedSkills = [
      ...schemaSkills,
      ...hydrated.extraSkills.filter(
        (ex) => !schemaSkills.some((s) => s.name === ex.name),
      ),
    ];
    if (mergedSkills.length && Object.keys(hydrated.skillSpend).length) {
      const spend = hydrated.skillSpend;
      useGameStore.getState().updateCharacterField((sheet) => {
        if (sheet.id !== character.id) return sheet;
        const skills = { ...sheet.skills };
        for (const sk of mergedSkills) {
          const base = resolveSkillBaseValue(
            sheet.system_id,
            sk.name,
            sk.base_value,
            sheet.attributes,
          );
          const extra = spend[sk.name] ?? { occ: 0, interest: 0 };
          skills[sk.name] = base + extra.occ + extra.interest;
        }
        return { ...sheet, skills };
      });
    }
    // 僅在席次／角色 id／藍圖技能列表變更時重載，避免配點時被覆寫
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [
    character?.id,
    editingPartySlotIndex,
    schema?.creation_mode,
    schema?.recommended_skills?.length,
  ]);

  /** 離開創角頁時也寫回配點草稿，避免只改敘事就返回而遺失。
   * 必須鎖定「掛載時」的席次與角色 id，不可讀離開當下的 editingPartySlotIndex
   *（完成席次後會先切到下一席再 unmount，否則會把席次1的卡寫進席次2）。 */
  useEffect(() => {
    const mountedSlot = editingPartySlotIndex;
    const mountedId = character?.id ?? null;
    return () => {
      if (!mountedId) return;
      const st = useGameStore.getState();
      const sheet =
        st.character?.id === mountedId
          ? st.character
          : (st.party.find((m) => m.slotIndex === mountedSlot)?.sheet ??
            null);
      if (!sheet || sheet.id !== mountedId) return;
      // 若此 id 已在「其他已完成席次」落地，勿再覆寫到 mountedSlot
      const ownedElsewhere = st.party.find(
        (m) =>
          m.slotIndex !== mountedSlot &&
          m.creationComplete &&
          (m.id === mountedId || m.sheet.id === mountedId),
      );
      if (ownedElsewhere) return;

      const editing = st.party.find((m) => m.slotIndex === mountedSlot);
      st.upsertPartyMemberAtSlot(mountedSlot, sheet, {
        controller: editing?.controller,
        roleHint: editing?.roleHint,
        creationDraft: draftFromUi({
          skillSpend: skillSpendRef.current,
          occOverrides: occOverridesRef.current,
          extraSkills: extraSkillsRef.current,
          assignments: assignmentsRef.current,
          rolledPool: rolledPoolRef.current,
        }),
      });
    };
    // 僅在掛載時鎖定席次／id
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount capture
  }, []);

  const modeConfig = schema?.mode_config;
  const pointBuy = useMemo(() => {
    if (mode !== "POINT_BUY") return schema?.point_buy ?? null;
    const sid =
      character?.system_id ??
      schema?.system_id ??
      script.system_id ??
      "COC_7E";
    return resolvePointBuyConfig(
      sid === "DND_5E" ? "DND_5E" : "COC_7E",
      schema?.point_buy,
      schema?.mode_config,
    );
  }, [
    mode,
    character?.system_id,
    schema?.system_id,
    schema?.point_buy,
    schema?.mode_config,
    script.system_id,
  ]);

  // AI 若給錯 CoC 購點下限（如 15），校正設定後把低於下限的特性抬到 min
  useEffect(() => {
    if (mode !== "POINT_BUY" || !pointBuy || !character) return;
    const sid = character.system_id;
    if (sid !== "COC_7E" && sid !== "DND_5E") return;
    let dirty = false;
    const next = { ...character.attributes };
    for (const k of attrKeys) {
      const v = next[k] ?? 0;
      if (v < pointBuy.min_score) {
        next[k] = pointBuy.min_score;
        dirty = true;
      } else if (v > pointBuy.max_score) {
        next[k] = pointBuy.max_score;
        dirty = true;
      }
    }
    if (!dirty) return;
    updateCharacterField((s) => ({ ...s, attributes: next }));
  }, [
    mode,
    pointBuy?.min_score,
    pointBuy?.max_score,
    pointBuy?.budget,
    attrKeys.join(","),
    character?.id,
  ]);
  const resolvedArray = useMemo(() => {
    if (!character) {
      return { array: [] as number[], source: "default" as const };
    }
    return resolveStandardArray({
      systemId: character.system_id,
      attributeCount: defs.length,
      candidate:
        schema?.standard_array ?? modeConfig?.standard_array ?? null,
    });
  }, [
    character,
    defs.length,
    schema?.standard_array,
    modeConfig?.standard_array,
  ]);
  const arrayValues = resolvedArray.array;

  // AI 給錯長度的陣列被校正後，清掉舊的互斥指派以免索引對到錯誤分數
  useEffect(() => {
    if (resolvedArray.source !== "corrected") return;
    setAssignments({});
  }, [resolvedArray.source, arrayValues.join(",")]);

  const spentPoints = useMemo(() => {
    if (!pointBuy || !character) return 0;
    const scores =
      character.coc_age_mod?.baseAttributes ?? character.attributes;
    return totalPointBuySpent(
      scores,
      attrKeys,
      pointBuy,
      character.system_id,
    );
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
        character.attributes,
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
            character.attributes,
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

  const setCreditRating = (n: number | undefined, opts?: { fillWealth?: boolean }) => {
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
      let wealth = s.wealth ?? "";
      let cash_assets = s.profile_coc?.cash_assets ?? "";
      if (opts?.fillWealth !== false && clamped != null) {
        const band = bandForCredit(clamped);
        if (band) {
          const suggested = suggestedWealthCopy(band);
          // 空白或仍是先前區間自動文案時，依信用評級覆寫建議敘事
          const allSuggested = CREDIT_LIFESTYLE_BANDS.map((b) =>
            suggestedWealthCopy(b),
          );
          const wealthIsAuto =
            !wealth.trim() ||
            allSuggested.some((x) => x.wealth === wealth.trim());
          const cashIsAuto =
            !cash_assets.trim() ||
            allSuggested.some((x) => x.cash_assets === cash_assets.trim());
          if (wealthIsAuto) wealth = suggested.wealth;
          if (cashIsAuto) cash_assets = suggested.cash_assets;
        }
      }
      return {
        ...s,
        skills,
        wealth,
        profile_coc: {
          ...(s.profile_coc ?? {}),
          cash_assets,
        },
      };
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

    const partyContext = buildPartyNarrativeDesignContext({
      party,
      partySize,
      editingSlotIndex: editingPartySlotIndex,
      roleHints: script.party_role_hints,
      protagonistRole: script.public_summary.protagonist_role,
    });

    setGeneratingNarrative(true);
    appendSystem(
      partySize > 1
        ? "正在請 AI 依劇本、藍圖與現有隊友設定，設計不重複且互補的角色敘事…"
        : "正在請 AI 依劇本與藍圖完整填寫角色敘事欄位…",
    );
    try {
      await sendGmText(
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
          partyContext,
          "請讓角色貼合上述定位與氛圍，文字一律繁體中文，內容具體可用。",
          partySize > 1
            ? "若上方有已完成隊友：務必避免撞名、撞職、撞背景；職能與個性應互補以平衡隊伍。"
            : "",
          "backstory_hooks 的 id 必須完全對應下列問題（每一題都要有答案）：",
          hooksList,
          "填完工具後用一句繁中 player_note 說明設計概念即可（可簡述如何與隊友互補）。",
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
    updateCharacterField((s) => {
      // 改動基礎屬性時撤銷年齡修正，並先還原套用前快照
      const restored = s.coc_age_mod?.baseAttributes
        ? { ...s.coc_age_mod.baseAttributes }
        : { ...s.attributes };
      if (s.coc_age_mod?.luckChosen != null) {
        delete restored.LUCK;
      }
      return {
        ...s,
        attributes: { ...restored, ...next },
        coc_age_mod: undefined,
        derived: {
          ...s.derived,
          hp: { current: 0, max: 0 },
          mp_or_slots: { current: 0, max: 0 },
          san: { current: 0, max: 0 },
        },
      };
    });
  };

  const writeSheetWithAgeMod = (
    attributes: Record<string, number>,
    coc_age_mod: NonNullable<UniversalCharacterSheet["coc_age_mod"]>,
  ) => {
    updateCharacterField((s) => ({
      ...s,
      attributes,
      coc_age_mod,
      derived: {
        ...s.derived,
        hp: { current: 0, max: 0 },
        mp_or_slots: { current: 0, max: 0 },
        san: { current: 0, max: 0 },
      },
    }));
  };

  const applyCocAgeModifiers = () => {
    if (!character || !isCoc) return;
    const ageYears = parseAgeYears(character.age);
    if (ageYears == null) {
      appendSystem("請先在身分資料填寫有效年齡（例如 28 或 約28歲）。");
      return;
    }
    if (ageYears < 15) {
      appendSystem("CoC 創角年齡修正適用 15 歲以上。");
      return;
    }
    const band = resolveCocAgeBand(ageYears);
    if (!band) {
      appendSystem("無法解析年齡帶。");
      return;
    }

    const baseRaw = character.coc_age_mod?.baseAttributes
      ? { ...character.coc_age_mod.baseAttributes }
      : { ...character.attributes };
    delete baseRaw.LUCK;

    let edu = baseRaw.EDU ?? 0;
    const eduLog: string[] = [];
    if (band.eduFlatPenalty > 0) {
      const before = edu;
      edu = Math.max(1, edu - band.eduFlatPenalty);
      eduLog.push(`年輕組：EDU ${before} − ${band.eduFlatPenalty} → ${edu}`);
    }
    if (band.eduChecks > 0) {
      const ran = runEduImprovementChecks(edu, band.eduChecks);
      edu = ran.edu;
      eduLog.push(...ran.log);
    }

    const luck = rollLuckForAge(band.luckRollTwice);
    const allocation = emptyAllocation(band.allocateKeys);
    const built = buildAttributesAfterAgeMod({
      baseAttributes: baseRaw,
      band,
      allocation,
      finalEdu: edu,
      luck: luck.chosen,
    });

    const complete = band.allocatePool <= 0 && built.errors.length === 0;
    writeSheetWithAgeMod(built.attributes, {
      bandId: band.id,
      appliedAge: ageYears,
      baseAttributes: baseRaw,
      allocation,
      eduLog,
      finalEdu: edu,
      luckRolls: luck.rolls,
      luckChosen: luck.chosen,
      movPenalty: band.movPenalty,
      complete,
    });

    const luckMsg = band.luckRollTwice
      ? `幸運兩骰 [${luck.rolls.join(", ")}] → ${luck.chosen}`
      : `幸運 ${luck.chosen}（${luck.details[0] ?? ""}）`;
    appendSystem(
      `已套用年齡修正（${band.label}）：${describeCocAgeBand(band)}。${luckMsg}` +
        (band.allocatePool > 0
          ? `請分配 ${band.allocatePool} 點扣減於 ${band.allocateKeys.join("／")}。`
          : "無需分配扣點。"),
    );
  };

  const adjustAgeAllocation = (key: string, delta: number) => {
    if (!character?.coc_age_mod || !isCoc) return;
    const mod = character.coc_age_mod;
    const band = resolveCocAgeBand(mod.appliedAge);
    if (!band || !band.allocateKeys.includes(key)) return;

    const cur = mod.allocation[key] ?? 0;
    const poolUsed = sumAllocation(mod.allocation);
    const maxForKey = maxAllocatableForKey(
      mod.baseAttributes[key] ?? 0,
      0,
    );
    let nextVal = cur + delta;
    if (nextVal < 0) nextVal = 0;
    if (nextVal > maxForKey) nextVal = maxForKey;
    if (delta > 0 && poolUsed - cur + nextVal > band.allocatePool) {
      nextVal = cur + (band.allocatePool - (poolUsed - cur));
    }
    const allocation = { ...mod.allocation, [key]: nextVal };
    const built = buildAttributesAfterAgeMod({
      baseAttributes: mod.baseAttributes,
      band,
      allocation,
      finalEdu: mod.finalEdu,
      luck: mod.luckChosen,
    });
    const complete =
      sumAllocation(allocation) === band.allocatePool &&
      built.errors.length === 0;
    writeSheetWithAgeMod(built.attributes, {
      ...mod,
      allocation,
      complete,
    });
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
      isCoc
        ? "已擲骰產生特性並鎖定。請填年齡並套用年齡修正後，再分配職業／興趣技能點。"
        : "已完成擲骰並鎖定屬性。若要重骰可再按一次。",
    );
  };

  /** ARRAY：指派分數索引到屬性（互斥）；未指派者屬性清 0 */
  const commitArrayAssignments = (
    nextAssign: Record<string, number | "">,
  ) => {
    setAssignments(nextAssign);
    const next: Record<string, number> = {};
    for (const k of attrKeys) {
      const v = nextAssign[k];
      if (v === "" || v == null) next[k] = 0;
      else next[k] = arrayValues[Number(v)] ?? 0;
    }
    applyAttributes(next);
  };

  const setArrayAssignment = (key: string, idxOrEmpty: number | "") => {
    commitArrayAssignments({ ...assignments, [key]: idxOrEmpty });
  };

  /** 點陣列池中的分數：拿起／放下 */
  const pickArrayScore = (idx: number) => {
    if (usedArrayIndices.has(idx)) return;
    setPickedArrayIdx((cur) => (cur === idx ? null : idx));
  };

  /** 點屬性列：放入手中分數，或拿起／交換已指派分數 */
  const onArrayAttrClick = (key: string) => {
    const cur = assignments[key];
    const curIdx = cur === "" || cur == null ? null : Number(cur);

    if (pickedArrayIdx != null) {
      const next: Record<string, number | ""> = { ...assignments };
      // 若其他屬性誤持同一索引則清掉
      for (const k of attrKeys) {
        if (k !== key && next[k] === pickedArrayIdx) next[k] = "";
      }
      next[key] = pickedArrayIdx;
      commitArrayAssignments(next);
      // 原本在此列的分數回到手中（交換）
      if (curIdx != null && curIdx !== pickedArrayIdx) {
        setPickedArrayIdx(curIdx);
      } else {
        setPickedArrayIdx(null);
      }
      return;
    }

    if (curIdx != null) {
      setPickedArrayIdx(curIdx);
      setArrayAssignment(key, "");
    }
  };

  const clearAllArrayAssignments = () => {
    const empty = Object.fromEntries(
      attrKeys.map((k) => [k, "" as const]),
    ) as Record<string, number | "">;
    commitArrayAssignments(empty);
    setPickedArrayIdx(null);
  };

  const canPointBuyAdjust = (key: string, newScore: number) => {
    if (!pointBuy) return false;
    if (newScore < pointBuy.min_score || newScore > pointBuy.max_score) {
      return false;
    }
    const sheet = useGameStore.getState().character;
    if (!sheet) return false;
    // 購點永遠以「年齡修正前」基礎屬性計算，避免 APP/EDU 被改後鎖死按鈕
    const base = sheet.coc_age_mod?.baseAttributes ?? sheet.attributes;
    const trial = { ...base, [key]: newScore };
    return (
      totalPointBuySpent(trial, attrKeys, pointBuy, sheet.system_id) <=
      pointBuy.budget
    );
  };

  const adjustPointBuy = (key: string, score: number) => {
    if (!canPointBuyAdjust(key, score)) return;
    const hadAge = Boolean(useGameStore.getState().character?.coc_age_mod);
    applyAttributes({ [key]: score });
    if (hadAge) {
      appendSystem("已改動購點基礎屬性，年齡修正已撤銷；請用完購點後重新套用。");
    }
  };

  const adjustPointBuyBy = (key: string, delta: number) => {
    if (!pointBuy) return;
    const sheet = useGameStore.getState().character;
    if (!sheet) return;
    const base = sheet.coc_age_mod?.baseAttributes ?? sheet.attributes;
    const current = base[key] || pointBuy.min_score;
    adjustPointBuy(key, current + delta);
  };

  const syncSkillsFromSpend = (spend: SkillSpend) => {
    updateCharacterField((sheet) => {
      const skills = { ...sheet.skills };
      for (const sk of allocSkills) {
        const extra = spend[sk.name] ?? { occ: 0, interest: 0 };
        skills[sk.name] = sk.base_value + extra.occ + extra.interest;
      }

      let wealth = sheet.wealth ?? "";
      let cash_assets = sheet.profile_coc?.cash_assets ?? "";
      const credit = skills["信用評級"];
      if (
        sheet.system_id === "COC_7E" &&
        credit != null &&
        Number.isFinite(credit)
      ) {
        const band = bandForCredit(credit);
        if (band) {
          const suggested = suggestedWealthCopy(band);
          const allSuggested = CREDIT_LIFESTYLE_BANDS.map((b) =>
            suggestedWealthCopy(b),
          );
          const wealthIsAuto =
            !wealth.trim() ||
            allSuggested.some((x) => x.wealth === wealth.trim());
          const cashIsAuto =
            !cash_assets.trim() ||
            allSuggested.some((x) => x.cash_assets === cash_assets.trim());
          if (wealthIsAuto) wealth = suggested.wealth;
          if (cashIsAuto) cash_assets = suggested.cash_assets;
        }
      }

      return {
        ...sheet,
        skills,
        wealth,
        profile_coc: {
          ...(sheet.profile_coc ?? {}),
          cash_assets,
        },
      };
    });
  };

  const maxAffordableFor = (
    name: string,
    pool: "occ" | "interest",
    spend: SkillSpend = skillSpendRef.current,
  ): number => {
    const sk = allocSkills.find((s) => s.name === name);
    const cur = spend[name] ?? { occ: 0, interest: 0 };
    const otherPool = pool === "occ" ? cur.interest : cur.occ;
    const base = sk?.base_value ?? 0;
    // 創角單技總值不可超過 99%：此池最多還能再加多少
    const roomUnderCap = Math.max(
      0,
      COC_CREATION_SKILL_CAP - base - otherPool,
    );
    const usedOcc = Object.values(spend).reduce((a, x) => a + (x?.occ ?? 0), 0);
    const usedInterest = Object.values(spend).reduce(
      (a, x) => a + (x?.interest ?? 0),
      0,
    );
    const byBudget =
      pool === "occ"
        ? Math.max(0, occBudget - (usedOcc - cur.occ))
        : Math.max(0, interestBudget - (usedInterest - cur.interest));
    return Math.min(byBudget, roomUnderCap);
  };

  /** 直接設定某技能在點池上花費的點數（自動 clamp 到剩餘預算與創角上限） */
  const setSkillPool = (
    name: string,
    pool: "occ" | "interest",
    requested: number,
  ) => {
    if (name === "克蘇魯神話") {
      appendSystem("創角時「克蘇魯神話」固定為 0；開場後才可經遭遇成長。");
      return;
    }
    const sk = allocSkills.find((s) => s.name === name);
    if (!sk) return;
    if (pool === "occ" && !sk.is_occupational) {
      appendSystem("職業點只能花在職業技能上。");
      return;
    }
    const skillSpend = skillSpendRef.current;
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
    skillSpendRef.current = trial;
    setSkillSpend(trial);
    syncSkillsFromSpend(trial);
  };

  const adjustSkill = (
    name: string,
    pool: "occ" | "interest",
    delta: number,
  ) => {
    const cur = skillSpendRef.current[name] ?? { occ: 0, interest: 0 };
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

  const ageYears = isCoc ? parseAgeYears(character.age) : null;
  const ageBand = ageYears != null ? resolveCocAgeBand(ageYears) : null;
  const ageMod = character.coc_age_mod;
  const ageModReady = Boolean(
    isCoc &&
      ageYears != null &&
      isCocAgeModComplete(ageMod) &&
      ageMod?.appliedAge === ageYears,
  );

  /** CoC：屬性＋年齡修正完成後才開放職業／興趣技能點 */
  const showSkillAlloc = Boolean(schema && attrsReady && isCoc && ageModReady);

  /** 技能點：不可超支，且須用完（若職業點因上限花不完則須花到吸滿） */
  const skillsAllocationReady = useMemo(() => {
    if (!showSkillAlloc) return true;
    if (occUsed > occBudget || interestUsed > interestBudget) return false;
    const occDone =
      occUsed === occBudget || (occRemaining > 0 && occRoomLeft === 0);
    const interestDone = interestUsed === interestBudget;
    return occDone && interestDone;
  }, [
    showSkillAlloc,
    occUsed,
    occBudget,
    interestUsed,
    interestBudget,
    occRemaining,
    occRoomLeft,
  ]);

  const pointBuyReady =
    mode !== "POINT_BUY" ||
    (pointBuy != null && spentPoints === pointBuy.budget);

  const canConfirm =
    Boolean(character.name.trim()) &&
    Boolean(character.role_title.trim()) &&
    attrsReady &&
    hooksReady &&
    pointBuyReady &&
    (!isCoc || ageModReady) &&
    skillsAllocationReady;

  const creationWarnings = useMemo(() => {
    if (!character) return [] as string[];
    const warns: string[] = [];
    if (isCoc) {
      if (!ageModReady) {
        warns.push(
          ageYears == null
            ? "請填寫年齡並套用年齡修正。"
            : ageMod && ageMod.appliedAge !== ageYears
              ? "身分年齡已變更，請重新套用年齡修正。"
              : ageMod && !ageMod.complete
                ? "年齡修正的物理扣點尚未分配完畢。"
                : "請套用年齡修正後再分配技能點。",
        );
      }
      const edu = character.attributes.EDU ?? 0;
      const role = `${character.role_title} ${character.profile_coc?.occupation ?? ""}`;
      if (
        edu > 0 &&
        edu < 50 &&
        /調查|學者|教授|研究員|圖書館|神秘|人類學|歷史/.test(role)
      ) {
        warns.push(
          `教育（EDU ${edu}）偏低，與「${character.role_title || "調查員／學者"}」敘事不太相符；建議提高 EDU 或調整職稱。`,
        );
      }
      if (showSkillAlloc && occUsed > occBudget) {
        warns.push(
          `職業技能點超支（${occUsed}/${occBudget}），請減少配點。`,
        );
      } else if (
        showSkillAlloc &&
        occBudget > 0 &&
        occUsed < occBudget &&
        occRoomLeft > 0
      ) {
        warns.push(
          `職業技能點尚餘 ${occBudget - occUsed}（預算 ${occBudget}），請用完再確認席次。`,
        );
      } else if (
        showSkillAlloc &&
        occBudget > 0 &&
        occUsed < occBudget &&
        occRoomLeft === 0
      ) {
        warns.push(
          `職業點還剩 ${occBudget - occUsed} 但已達技能上限吸滿；可新增／標更多職業技能再花，或維持現況。`,
        );
      }
      if (showSkillAlloc && interestUsed > interestBudget) {
        warns.push(
          `興趣技能點超支（${interestUsed}/${interestBudget}），請減少配點。`,
        );
      } else if (
        showSkillAlloc &&
        interestBudget > 0 &&
        interestUsed < interestBudget
      ) {
        warns.push(
          `興趣技能點尚餘 ${interestBudget - interestUsed}（預算 ${interestBudget}），請用完再確認席次。`,
        );
      }
      for (const [name, val] of Object.entries(character.skills)) {
        const base = resolveSkillBaseValue(character.system_id, name, undefined);
        if (val < base) {
          warns.push(
            `「${name}」目前 ${val}% 低於系統基礎 ${base}%（確認時會自動抬升）。`,
          );
        }
      }
    }
    if (
      mode === "POINT_BUY" &&
      pointBuy &&
      spentPoints !== pointBuy.budget
    ) {
      warns.push(
        spentPoints > pointBuy.budget
          ? `購點超支（${spentPoints}/${pointBuy.budget}）。`
          : `購點尚未用完（${spentPoints}/${pointBuy.budget}），請用完再確認。`,
      );
    }
    return warns;
  }, [
    character,
    isCoc,
    ageModReady,
    ageYears,
    ageMod,
    showSkillAlloc,
    occBudget,
    occUsed,
    occRoomLeft,
    interestBudget,
    interestUsed,
    mode,
    pointBuy,
    spentPoints,
  ]);

  const adventureCta = (() => {
    if (partySize > 1) {
      const st = useGameStore.getState();
      const named = st.party.filter((m) => m.sheet.name?.trim()).length;
      const willCompleteCurrent = Boolean(character?.name?.trim());
      const projected = Math.max(
        named,
        willCompleteCurrent ? named + (st.party.some((m) => m.slotIndex === editingPartySlotIndex && m.sheet.name?.trim()) ? 0 : 1) : named,
      );
      if (projected < partySize || st.party.length < partySize) {
        return `完成隊員${editingPartySlotIndex + 1}，繼續組隊`;
      }
      return script.public_summary?.title
        ? `隊伍就緒，開始《${script.public_summary.title}》`
        : "隊伍就緒，開始冒險";
    }
    return script.public_summary?.title
      ? `踏上「${script.public_summary.title}」`
      : "確認角色，開始冒險";
  })();

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      {(schema && mode === "POINT_BUY" && pointBuy) || showSkillAlloc ? (
        <div className="z-10 shrink-0 space-y-2 border-b border-border/70 bg-surface/95 px-1 py-2 backdrop-blur-sm">
          {schema && mode === "POINT_BUY" && pointBuy ? (
            <div className="rounded border border-border/70 bg-bg/40 p-2">
              <SkillPoolMeter
                label="購點總池"
                used={spentPoints}
                budget={pointBuy.budget}
                tooltip={`屬性範圍 ${pointBuy.min_score}–${pointBuy.max_score}`}
              />
            </div>
          ) : null}
          {showSkillAlloc ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/40 p-2">
              <div className="text-[11px] font-medium text-ink">技能點池</div>
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
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
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
          onClick={() =>
            exportCharacterJson(enrichCharacterSheetMeta(character, schema))
          }
          disabled={!attrsReady}
        >
          匯出 JSON
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!attrsReady || !character.name || !allowLibrarySave}
          title={
            allowLibrarySave
              ? "存入本機角色檔案庫"
              : "AI 隊友席次不會寫入角色庫"
          }
          onClick={() => {
            if (!allowLibrarySave) return;
            saveCharacterToLibrary(enrichCharacterSheetMeta(character, schema));
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
              ["age", isCoc ? "年齡（必填，如 28）" : "年齡"],
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
                  ? "由信用評級對應後可自動帶入，亦可手改"
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
                正規流程：先配「信用評級」技能％，再對應此敘事。
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
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <HoverTooltip
                  header="信用評級（技能％）"
                  content={CREDIT_RATING_TOOLTIP}
                >
                  <Label className="text-xs underline decoration-dotted decoration-muted underline-offset-2">
                    信用評級（技能％）
                  </Label>
                </HoverTooltip>
                <span className="text-[10px] text-muted">
                  用職業／興趣點配置；決定生活水準
                </span>
              </div>
              <p className="text-[10px] text-muted">
                依職業建議區間配置此技能（下方技能點池亦可）。快捷按鈕會寫入建議％並帶入資產敘事，之後仍可用點數微調。
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
                      title={`建議區間 ${b.min}–${b.max}%（中值 ${b.mid}）· ${b.hint}`}
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
                    對應生活水準：{creditBand.label}（{creditBand.hint}）
                  </span>
                ) : (
                  <span className="text-[11px] text-muted">尚未設定信用評級</span>
                )}
              </div>
              {creditWarning ? (
                <p className="text-[11px] text-amber-400/95">{creditWarning}</p>
              ) : null}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">現金／資產細節</Label>
              <Textarea
                rows={2}
                placeholder="依信用評級自動帶入建議，可再細修"
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
            </div>
            {attrsReady ? (
              <div className="rounded border border-border/70 bg-bg/20 p-2 text-xs text-muted sm:col-span-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide">
                  CoC 延伸／連動（唯讀）
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {derivedRows
                    .filter((r) =>
                      ["san", "mythos", "mov", "build_db"].includes(r.id),
                    )
                    .map((r) => (
                      <HoverTooltip
                        key={r.id}
                        header={r.label}
                        content={r.content}
                      >
                        <span className="underline decoration-dotted decoration-muted underline-offset-2 text-ink/90">
                          {r.id === "mov"
                            ? `MOV ${r.display}`
                            : r.id === "mythos"
                              ? `克蘇魯神話 ${r.display}`
                              : r.id === "san"
                                ? `SAN ${r.display}`
                                : r.display}
                        </span>
                      </HoverTooltip>
                    ))}
                </div>
                <p className="mt-1.5 text-[10px] text-muted">
                  克蘇魯神話創角固定 0；冒險中上升會降低 SAN 上限（99−神話）。
                </p>
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

          {schema && mode === "DICE" ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs">
                  {isCoc ? "擲骰決定特性（結果鎖定）" : "物理擲骰（結果鎖定）"}
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
            <div className="space-y-3 rounded border border-border/70 bg-bg/20 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs">
                  {isCoc
                    ? "快速創角（點選分數 → 點特性放入；再點可拿起／交換）"
                    : "標準陣列（點選分數 → 點屬性放入；再點屬性可拿起／交換）"}
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[10px]"
                  onClick={clearAllArrayAssignments}
                >
                  清空重配
                </Button>
              </div>
              {(resolvedArray.source === "corrected" ||
                schema.standard_array_source === "corrected") && (
                <p className="text-xs text-accent-2">
                  AI 提供的陣列長度與屬性數不符，已改用系統預設（
                  {character.system_id === "COC_7E"
                    ? "CoC Quick-Fire 八項陣列"
                    : "D&D 六項陣列"}
                  ）。
                </p>
              )}
              <div>
                <p className="mb-1.5 text-[11px] text-muted">
                  可用分數
                  {pickedArrayIdx != null
                    ? ` · 手中：${arrayValues[pickedArrayIdx]}（點屬性放入）`
                    : " · 先點一顆分數"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {arrayValues.map((v, idx) => {
                    const used = usedArrayIndices.has(idx);
                    const picked = pickedArrayIdx === idx;
                    if (used) return null;
                    return (
                      <button
                        key={`pool-${idx}`}
                        type="button"
                        onClick={() => pickArrayScore(idx)}
                        className={cn(
                          "min-w-[2.5rem] cursor-pointer rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors",
                          picked
                            ? "border-accent bg-accent/20 text-accent-2 ring-1 ring-accent/40"
                            : "border-border bg-surface text-ink hover:border-accent/50 hover:bg-accent/10",
                        )}
                      >
                        {v}
                      </button>
                    );
                  })}
                  {arrayValues.every((_, idx) => usedArrayIndices.has(idx)) ? (
                    <span className="text-[11px] text-muted">
                      分數已全部分配
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {defs.map((d) => {
                  const assigned = assignments[d.key];
                  const has =
                    assigned !== "" &&
                    assigned != null &&
                    Number.isFinite(Number(assigned));
                  const score = has
                    ? (arrayValues[Number(assigned)] ?? 0)
                    : 0;
                  const waiting = pickedArrayIdx != null;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => onArrayAttrClick(d.key)}
                      className={cn(
                        "flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                        has
                          ? "border-border bg-surface/80 hover:border-accent/40"
                          : waiting
                            ? "border-dashed border-accent/45 bg-accent/5 hover:bg-accent/10"
                            : "border-dashed border-border/80 bg-bg/40 hover:border-border",
                      )}
                    >
                      <HoverTooltip header={d.label} content={attrTip(d)}>
                        <span className="text-xs text-muted underline decoration-dotted decoration-muted underline-offset-2">
                          {d.label}
                        </span>
                      </HoverTooltip>
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          has ? "text-ink" : "text-muted",
                        )}
                      >
                        {has ? score : waiting ? "放入…" : "—"}
                        {has &&
                        isDnd &&
                        character.attribute_modifiers?.[`${d.key}_MOD`] !=
                          null
                          ? `（${(character.attribute_modifiers[`${d.key}_MOD`] ?? 0) >= 0 ? "+" : ""}${character.attribute_modifiers[`${d.key}_MOD`]}）`
                          : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {schema && mode === "POINT_BUY" && pointBuy ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <Label className="text-xs">
                購點制屬性（範圍 {pointBuy.min_score}–{pointBuy.max_score}
                {isCoc
                  ? "；花費＝特性值，八項合計須用完預算"
                  : "；花費依官方累進表"}
                ）
              </Label>
              {character.coc_age_mod ? (
                <p className="text-[10px] text-muted">
                  下方數字與花費為年齡修正前的購點基礎值（總池仍應為{" "}
                  {pointBuy.budget}
                  ）。加減會撤銷年齡修正；實際檢定用數值以年齡修正後為準。
                </p>
              ) : null}
              <div className="grid gap-2">
                {defs.map((d) => {
                  const baseScores =
                    character.coc_age_mod?.baseAttributes ??
                    character.attributes;
                  const score = baseScores[d.key] || pointBuy.min_score;
                  const agedScore = character.coc_age_mod
                    ? character.attributes[d.key]
                    : undefined;
                  const canMinus = canPointBuyAdjust(d.key, score - 1);
                  const canPlus = canPointBuyAdjust(d.key, score + 1);
                  return (
                    <PointBuyRow
                      key={d.key}
                      label={d.label}
                      tip={attrTip(d)}
                      score={score}
                      cost={pointBuyCost(
                        score,
                        pointBuy,
                        character.system_id,
                      )}
                      afterAgeScore={
                        agedScore != null && agedScore !== score
                          ? agedScore
                          : undefined
                      }
                      canMinus={canMinus}
                      canPlus={canPlus}
                      onMinus={() => adjustPointBuyBy(d.key, -1)}
                      onPlus={() => adjustPointBuyBy(d.key, 1)}
                    />
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
                            content={
                              sk.description?.trim() ||
                              resolveSkillDescription(sk.name, {
                                systemId: character.system_id,
                                sheetDescriptions: character.skill_descriptions,
                                schemaSkills: schema?.recommended_skills,
                              })
                            }
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

          {schema && isCoc && attrsReady && pointBuyReady ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs">年齡修正（Age Modifiers）</Label>
                <Button
                  type="button"
                  size="sm"
                  onClick={applyCocAgeModifiers}
                  disabled={ageYears == null || ageYears < 15}
                >
                  {ageMod ? "重新套用" : "套用年齡修正"}
                </Button>
              </div>
              <p className="text-[10px] text-muted">
                請先在上方身分資料填寫年齡。規則書：依年齡帶調整 EDU／物理特性／MOV；15–19
                另擲幸運兩次取高。改屬性會清除已套用的修正。
              </p>
              {ageYears == null ? (
                <p className="text-[11px] text-amber-400/95">
                  尚未解析到有效年齡數字。
                </p>
              ) : ageYears < 15 ? (
                <p className="text-[11px] text-amber-400/95">
                  年齡修正適用 15 歲以上（目前 {ageYears}）。
                </p>
              ) : ageBand ? (
                <p className="text-[11px] text-muted">
                  {ageBand.label}：{describeCocAgeBand(ageBand)}
                </p>
              ) : null}

              {ageMod ? (
                <div className="space-y-2 rounded border border-border/50 bg-surface/40 p-2 text-[11px]">
                  <div className="text-ink">
                    已套用 {ageMod.appliedAge} 歲
                    {ageMod.appliedAge !== ageYears
                      ? `（身分年齡已改為 ${ageYears ?? "—"}，請重新套用）`
                      : ""}
                    {ageModReady ? " · 完成" : " · 待分配扣點"}
                  </div>
                  {ageMod.luckChosen != null ? (
                    <div className="text-muted">
                      幸運 LUCK {ageMod.luckChosen}
                      {ageMod.luckRolls && ageMod.luckRolls.length > 1
                        ? `（兩骰 ${ageMod.luckRolls.join(" / ")}）`
                        : ""}
                    </div>
                  ) : null}
                  {ageMod.eduLog.length ? (
                    <ul className="space-y-0.5 text-muted">
                      {ageMod.eduLog.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  ) : null}
                  {ageMod.movPenalty > 0 ? (
                    <div className="text-muted">
                      MOV −{ageMod.movPenalty}（已反映在衍生值）
                    </div>
                  ) : null}

                  {ageBand && ageBand.allocatePool > 0 ? (
                    <div className="space-y-1.5 border-t border-border/40 pt-2">
                      <div className="text-ink">
                        分配扣點 {sumAllocation(ageMod.allocation)}/
                        {ageBand.allocatePool}（
                        {ageBand.allocateKeys.join("／")}）
                      </div>
                      {ageBand.allocateKeys.map((key) => {
                        const taken = ageMod.allocation[key] ?? 0;
                        const base = ageMod.baseAttributes[key] ?? 0;
                        const maxTake = maxAllocatableForKey(base, 0);
                        const poolLeft =
                          ageBand.allocatePool -
                          sumAllocation(ageMod.allocation);
                        const canMinus = taken > 0;
                        const canPlus = taken < maxTake && poolLeft > 0;
                        const label =
                          defs.find((d) => d.key === key)?.label ?? key;
                        return (
                          <div
                            key={key}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span className="w-14 text-muted">{label}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!canMinus}
                              onClick={() => adjustAgeAllocation(key, -1)}
                            >
                              −
                            </Button>
                            <span className="w-16 text-center tabular-nums text-ink">
                              −{taken}→{base - taken}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!canPlus}
                              onClick={() => adjustAgeAllocation(key, 1)}
                            >
                              +
                            </Button>
                            <span className="text-[10px] text-muted">
                              基礎 {base}
                            </span>
                          </div>
                        );
                      })}
                      {ageBand.appFlatPenalty > 0 ? (
                        <p className="text-muted">
                          APP 固定 −{ageBand.appFlatPenalty}（已套用）
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {schema && isCoc && !attrsReady ? (
            <p className="text-xs text-muted">請先完成屬性，再開啟年齡修正與技能分配。</p>
          ) : null}
          {schema &&
          isCoc &&
          attrsReady &&
          !pointBuyReady ? (
            <p className="text-xs text-muted">
              請先用完購點預算，再套用年齡修正。
            </p>
          ) : null}
          {schema && isCoc && attrsReady && pointBuyReady && !ageModReady ? (
            <p className="text-xs text-muted">
              請填寫年齡並完成年齡修正（含扣點分配）後，再開啟技能分配。
            </p>
          ) : null}

          {attrsReady ? (
            <div className="space-y-2 rounded border border-border bg-surface-2 p-2 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted">
                衍生數值
                <span className="ml-1 font-normal normal-case tracking-normal">
                  （游標移上可看公式）
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {derivedRows.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                  >
                    <HoverTooltip header={r.label} content={r.content}>
                      <span className="underline decoration-dotted decoration-muted underline-offset-2">
                        {r.label}
                      </span>
                    </HoverTooltip>
                    <span className="tabular-nums text-ink">{r.display}</span>
                  </div>
                ))}
              </div>
              {fixedAttrRows.length ? (
                <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2">
                  <div className="text-[10px] text-muted">
                    系統固定參數（影響 HP／AC／熟練）
                  </div>
                  {fixedAttrRows.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                    >
                      <HoverTooltip header={r.label} content={r.content}>
                        <span className="underline decoration-dotted decoration-muted underline-offset-2">
                          {r.label}
                        </span>
                      </HoverTooltip>
                      <span className="tabular-nums text-ink">{r.display}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!isCoc && schemaSkills.length ? (
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
            <Label className="text-xs">背包（每行一項）</Label>
            <Textarea
              rows={4}
              placeholder={"手電筒\n筆記本\n護身符"}
              value={
                inventoryDraft ??
                (character?.inventory ?? []).join("\n")
              }
              onFocus={() => {
                if (inventoryDraft == null) {
                  setInventoryDraft((character?.inventory ?? []).join("\n"));
                }
              }}
              onChange={(e) => setInventoryDraft(e.target.value)}
              onBlur={(e) => commitInventoryDraft(e.target.value)}
            />
          </div>
        </section>
      </div>

      {creationWarnings.length ? (
        <div className="space-y-1 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink">
          <div className="font-medium text-accent-2">創角提醒（仍可開始）</div>
          {creationWarnings.map((w) => (
            <p key={w} className="text-muted">
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] text-muted">
        鉤子會成為冒險中的情緒錨點——GM 會在關鍵時刻回扣它們。填完後，準備踏入劇本舞台。
      </p>

      <Button
        disabled={!canConfirm}
        onClick={() => {
          if (!character) return;
          commitInventoryDraft();
          // 確認前強制把目前配點寫進角色卡
          syncSkillsFromSpend(skillSpendRef.current);
          updateCharacterField((s) => ({
            ...s,
            skills: clampSkillsToSystemBases(s.system_id, s.skills),
          }));
          const latest = useGameStore.getState().character;
          if (!latest) return;
          const editing = useGameStore
            .getState()
            .party.find((m) => m.slotIndex === editingPartySlotIndex);
          const draft = buildCurrentDraft();
          upsertPartyMemberAtSlot(editingPartySlotIndex, latest, {
            controller: editing?.controller,
            roleHint: editing?.roleHint,
            creationComplete: true,
            creationDraft: draft,
          });

          const st = useGameStore.getState();
          const allSlotsReady = Array.from(
            { length: st.partySize },
            (_, i) => st.party.find((m) => m.slotIndex === i),
          ).every((m) => Boolean(m?.creationComplete));
          const ready =
            st.party.length >= st.partySize &&
            allSlotsReady &&
            st.party.some((m) => m.controller === "player");

          if (ready) {
            confirmCharacterAndPlay();
          } else {
            appendSystem(
              `隊員${editingPartySlotIndex + 1}「${latest.name}」已就緒（屬性／技能配點已保存）。請繼續完成其餘隊員。`,
            );
            onSlotSaved?.();
          }
        }}
      >
        {adventureCta}
      </Button>
      {!canConfirm ? (
        <p className="text-xs text-muted">
          需填寫姓名／職稱、完成屬性規則，並寫完所有劇情鉤子
          {isCoc
            ? "；須完成年齡修正；技能點不可超支且須用完（職業點若因上限花不完除外）"
            : ""}
          {mode === "POINT_BUY" ? "；購點須用完預算" : ""}
          。
        </p>
      ) : null}
      </div>
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

function PointBuyRow({
  label,
  tip,
  score,
  cost,
  afterAgeScore,
  canMinus,
  canPlus,
  onMinus,
  onPlus,
}: {
  label: string;
  tip: string;
  score: number;
  cost: number;
  /** 年齡修正後的實際特性（僅顯示；購點加減仍針對基礎 score） */
  afterAgeScore?: number;
  canMinus: boolean;
  canPlus: boolean;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const minusPress = useRepeatPress(onMinus, { disabled: !canMinus });
  const plusPress = useRepeatPress(onPlus, { disabled: !canPlus });

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <HoverTooltip header={label} content={tip}>
        <span className="w-14 underline decoration-dotted decoration-muted underline-offset-2">
          {label}
        </span>
      </HoverTooltip>
      <Button
        size="sm"
        variant="secondary"
        disabled={!canMinus}
        {...minusPress}
        aria-label={`${label}減 1`}
      >
        −
      </Button>
      <span className="w-8 text-center text-ink">{score}</span>
      <Button
        size="sm"
        variant="secondary"
        disabled={!canPlus}
        {...plusPress}
        aria-label={`${label}加 1`}
      >
        +
      </Button>
      <span className="text-muted">花費 {cost}</span>
      {afterAgeScore != null ? (
        <span className="text-[10px] text-accent-2">
          年齡後 {afterAgeScore}
        </span>
      ) : null}
    </div>
  );
}

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
  const canMinus = value > 0;
  const canPlus = remainingBudget > 0 && value < max;
  const minusPress = useRepeatPress(() => onAdjust(-1), {
    disabled: !canMinus,
  });
  const plusPress = useRepeatPress(() => onAdjust(1), { disabled: !canPlus });

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

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
        disabled={!canMinus}
        {...minusPress}
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
        onBlur={commitDraft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            if (canPlus) onAdjust(1);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (canMinus) onAdjust(-1);
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
        disabled={!canPlus}
        {...plusPress}
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
