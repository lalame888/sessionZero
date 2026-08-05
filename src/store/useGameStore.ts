import { create } from "zustand";
import type { PedelecSessionStatus, ProviderCode } from "@kaoruisaac/pedelec";
import {
  maybeCompressChapters,
} from "@/engine/contextAssembler";
import {
  createBlankCharacter,
  migrateCharacterSheet,
  recomputeDerived,
  themeForSystem,
} from "@/engine/formulas";
import {
  createEmptyCharacterShell,
  defaultAttributeDefs,
  defaultModeConfig,
  defaultPointBuy,
  enrichCharacterSheetMeta,
  filterKeyClueInventoryItems,
  clampSkillsToSystemBases,
  normalizeBackgroundQuestions,
  normalizeCreationMode,
  resolveSkillBaseValue,
  resolveStandardArray,
} from "@/engine/creation";
import {
  campaignTitleFromState,
  createEmptyCampaignPersist,
  type CampaignPersist,
} from "@/lib/campaignStorage";
import { isBlockedSocialSanLoss } from "@/lib/historyHygiene";
import { areDuplicateNarratives } from "@/lib/narrativeDedupe";
import type {
  ChapterSummary,
  CharacterSchemaState,
  ChatMessage,
  ClueItem,
  EndingState,
  GamePhase,
  GameSystemID,
  HistoryLog,
  HouseRuleConfig,
  MadnessStatus,
  NPCItem,
  PendingDice,
  PlayerNote,
  PreflightState,
  RetryAction,
  RuleLookupResult,
  ScenarioScale,
  SceneDirectorState,
  ScriptState,
  SessionErrorInfo,
  ThemeId,
  UniversalCharacterSheet,
} from "@/types/game";
import type { CharacterStatSnapshot } from "@/types/characterLibrary";
import { captureStatSnapshot } from "@/engine/adventureDossier";
import {
  bindCharacterToCampaign,
  getLibraryCharacter,
} from "@/lib/storage";
import { COC_HOUSE_PRESETS, DND_HOUSE_PRESETS } from "@/prompts/gmDirectives";
import {
  getActiveSession,
  sendOpeningNarration,
} from "@/lib/pedelec/createGameSession";
import { normalizeScenarioScale } from "@/engine/scenarioScale";

function snapshotOf(state: {
  character: UniversalCharacterSheet | null;
  clues: ClueItem[];
  playerNotes: PlayerNote[];
  npcs: NPCItem[];
  madness: MadnessStatus;
}): HistoryLog["snapshot"] {
  return {
    character: state.character
      ? structuredClone(state.character)
      : createBlankCharacter("COC_7E"),
    clues: structuredClone(state.clues),
    playerNotes: structuredClone(state.playerNotes),
    npcs: structuredClone(state.npcs),
    madness: structuredClone(state.madness),
  };
}

const initialScript: ScriptState = {
  system_id: null,
  public_summary: null,
  hidden_full_script: null,
  recommended_creation_mode: null,
  revealed: false,
  scenario_scale: "oneshot",
};

interface GameStore {
  campaignId: string;
  campaignCreatedAt: number;
  phase: GamePhase;
  theme: ThemeId;
  location: string;
  sceneDirector: SceneDirectorState;
  preflight: PreflightState;
  sessionStatus: PedelecSessionStatus | "disconnected";
  sessionError: SessionErrorInfo | null;
  retryAction: RetryAction | null;
  selectedProvider: ProviderCode | null;
  selectedModel: string;
  composerDraft: string;
  lastPlayerAction: string;
  suggestPlayerActions: boolean;
  showInstallGuide: boolean;
  showSettings: boolean;
  isTyping: boolean;
  secretRollActive: boolean;

  script: ScriptState;
  houseRules: HouseRuleConfig;
  character: UniversalCharacterSheet | null;
  characterSchema: CharacterSchemaState | null;
  /** 冒險開始時數值快照（結局履歷對照） */
  characterBaseline: CharacterStatSnapshot | null;
  /** 綁定檔案庫角色 ID */
  boundCharacterId: string | null;
  clues: ClueItem[];
  playerNotes: PlayerNote[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  history: HistoryLog[];
  chapterSummaries: ChapterSummary[];
  turn: number;
  messages: ChatMessage[];
  pendingDice: PendingDice | null;
  pendingRuleLookup: RuleLookupResult | null;
  ending: EndingState | null;
  /**
   * GM 已寫出結局口吻敘事但未呼叫 end_game_session 時，
   * 供玩家手動進入結算。
   */
  pendingManualEnding: {
    title: string;
    narrative: string;
  } | null;
  /** 結局頁已完成成長／儲存（再進入略過結算） */
  endingCharacterSettled: boolean;
  timelineIndex: number | null;

  diceResolver: ((result: {
    diceResult: number;
    outcome: string;
    detail: string;
    request_id: string;
  }) => void) | null;

  setPreflight: (p: PreflightState) => void;
  setSessionStatus: (s: GameStore["sessionStatus"]) => void;
  setSessionError: (e: SessionErrorInfo | null) => void;
  setRetryAction: (a: RetryAction | null) => void;
  setProvider: (p: ProviderCode | null) => void;
  setModel: (m: string) => void;
  setComposerDraft: (v: string) => void;
  setSuggestPlayerActions: (v: boolean) => void;
  setShowInstallGuide: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setIsTyping: (v: boolean) => void;
  setPhase: (p: GamePhase) => void;
  setLocation: (v: string) => void;
  setSceneDirector: (patch: Partial<SceneDirectorState>) => void;
  appendMessage: (msg: Omit<ChatMessage, "id" | "timestamp"> & { id?: string }) => string;
  updateMessage: (id: string, content: string) => void;
  appendSystem: (content: string) => void;
  /** 替換最近一則真正的 GM 敘事（重抽用） */
  replaceLastNarrative: (narrative: string) => void;
  /** 移除最近一則 agent 敘事訊息（重抽前） */
  removeLastAgentMessage: () => void;

  setupScript: (args: {
    system_id: string;
    public_summary: ScriptState["public_summary"];
    hidden_full_script: ScriptState["hidden_full_script"];
    recommended_creation_mode: string;
    scenario_scale?: string | null;
    tone_examples?: string[] | null;
  }) => void;
  setHouseRules: (rules: HouseRuleConfig) => void;
  setScenarioScale: (scale: ScenarioScale) => void;
  togglePresetRule: (rule: string) => void;
  setCharacterSchema: (schema: CharacterSchemaState) => void;
  setCharacter: (sheet: UniversalCharacterSheet) => void;
  updateCharacterField: (
    updater: (sheet: UniversalCharacterSheet) => UniversalCharacterSheet,
  ) => void;
  /** AI 填入敘事欄位；不更動屬性／技能配點 */
  applyCharacterNarrative: (payload: {
    name?: string;
    role_title?: string;
    age?: string;
    gender?: string;
    appearance?: string;
    residence?: string;
    birthplace?: string;
    languages?: string;
    personal_bio?: string;
    wealth?: string;
    profile_coc?: { occupation?: string; cash_assets?: string };
    profile_dnd?: {
      race?: string;
      class_name?: string;
      background?: string;
      alignment?: string;
      speed?: number;
      proficiencies?: string;
      features?: string;
    };
    backstory_hooks?: { id: string; answer: string }[];
    inventory?: string[];
    player_note?: string;
  }) => void;
  applyStatChanges: (
    changes: { key: string; change_amount: number; reason: string }[],
    inventory_add?: string[],
    inventory_remove?: string[],
  ) => void;
  markSkillSuccess: (skill_name: string) => void;
  recordClue: (clue: ClueItem) => void;
  addPlayerNote: (note: { title: string; content: string }) => string;
  updatePlayerNote: (
    note_id: string,
    patch: { title: string; content: string },
  ) => void;
  removePlayerNote: (note_id: string) => void;
  triggerMadness: (madness: MadnessStatus) => void;
  registerNpc: (npc: NPCItem) => void;
  setPendingDice: (dice: PendingDice | null, resolver?: GameStore["diceResolver"]) => void;
  clearDiceResolver: () => void;
  setSecretRollActive: (v: boolean) => void;
  setPendingRuleLookup: (r: RuleLookupResult | null) => void;
  recordHistoryTurn: (partial: {
    playerInput?: string;
    aiNarrative: string;
    diceRecord?: HistoryLog["diceRecord"];
  }) => void;
  narrateFromTool: (narrative: string, systemNotice?: string) => void;
  /** 合併同輪檢定後重寫的重複 GM 訊息 */
  collapseNarrativeRewrites: () => void;
  /** 玩家尚未行動時，清掉不完整開場敘事（供首次／重試開場） */
  clearIncompleteOpening: (mode?: "first" | "retry") => void;
  endGame: (ending: EndingState) => void;
  offerManualEnding: (offer: { title: string; narrative: string }) => void;
  clearManualEndingOffer: () => void;
  /** 玩家確認：依待進入結算的結局敘事（或傳入）進入 ENDING */
  confirmManualEnding: (override?: {
    title?: string;
    narrative?: string;
    ending_type?: string;
  }) => void;
  /** 標記結局角色結算＋存檔已完成 */
  markEndingCharacterSettled: () => void;
  undoLastTurn: () => void;
  setTimelineIndex: (idx: number | null) => void;
  confirmCharacterAndPlay: () => void;
  advanceToCharacterPhase: () => void;
  setLastPlayerAction: (action: string) => void;
  applyGrowthResult: (skill: string, gained: number) => void;

  toPersist: () => CampaignPersist;
  hydrateCampaign: (data: CampaignPersist) => void;
  startNewCampaign: () => CampaignPersist;
}

export const useGameStore = create<GameStore>((set, get) => ({
  campaignId: crypto.randomUUID(),
  campaignCreatedAt: Date.now(),
  phase: "PREFLIGHT",
  theme: "neutral",
  location: "未知之地",
  sceneDirector: {
    currentSceneId: null,
    sceneGoal: "",
    tension: "medium",
    notes: "",
  },
  preflight: { ready: false, reason: "CHECKING" },
  sessionStatus: "disconnected",
  sessionError: null,
  retryAction: null,
  selectedProvider: null,
  selectedModel: "",
  composerDraft: "",
  lastPlayerAction: "",
  suggestPlayerActions: true,
  showInstallGuide: false,
  showSettings: false,
  isTyping: false,
  secretRollActive: false,
  script: initialScript,
  houseRules: { preset_rules: [], custom_rules_text: "" },
  character: null,
  characterSchema: null,
  characterBaseline: null,
  boundCharacterId: null,
  clues: [],
  playerNotes: [],
  npcs: [],
  madness: { active: false },
  history: [],
  chapterSummaries: [],
  turn: 0,
  messages: [],
  pendingDice: null,
  pendingRuleLookup: null,
  ending: null,
  pendingManualEnding: null,
  endingCharacterSettled: false,
  timelineIndex: null,
  diceResolver: null,

  setPreflight: (p) => set({ preflight: p }),
  setSessionStatus: (s) => set({ sessionStatus: s }),
  setSessionError: (e) => set({ sessionError: e }),
  setRetryAction: (a) => set({ retryAction: a }),
  setProvider: (p) => set({ selectedProvider: p }),
  setModel: (m) => set({ selectedModel: m }),
  setComposerDraft: (v) => set({ composerDraft: v }),
  setSuggestPlayerActions: (v) => set({ suggestPlayerActions: v }),
  setShowInstallGuide: (v) => set({ showInstallGuide: v }),
  setShowSettings: (v) => set({ showSettings: v }),
  setIsTyping: (v) => set({ isTyping: v }),
  setPhase: (p) => set({ phase: p }),
  setLocation: (v) => set({ location: v }),
  setSceneDirector: (patch) =>
    set((s) => ({
      sceneDirector: { ...s.sceneDirector, ...patch },
    })),
  setLastPlayerAction: (action) => set({ lastPlayerAction: action }),

  appendMessage: (msg) => {
    const id = msg.id ?? crypto.randomUUID();
    set((s) => ({
      messages: [
        ...s.messages,
        { ...msg, id, timestamp: Date.now() },
      ],
    }));
    return id;
  },

  updateMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    })),

  appendSystem: (content) => {
    get().appendMessage({ role: "system", content });
  },

  setupScript: (args) => {
    const phase = get().phase;
    // 冒險／創角／結局中禁止重設劇本與角色卡（GM 誤再呼叫 setup_script 時曾清空角色）
    if (
      phase === "PLAYING" ||
      phase === "ENDING" ||
      phase === "CHARACTER"
    ) {
      get().appendSystem(
        `（忽略）目前為${phase === "CHARACTER" ? "創角" : phase === "ENDING" ? "結局" : "冒險"}階段，不可重設劇本／角色卡。請繼續遊玩或開新 Session。`,
      );
      return;
    }

    const system_id = args.system_id as GameSystemID;
    const presets =
      system_id === "DND_5E" ? DND_HOUSE_PRESETS : COC_HOUSE_PRESETS;
    const scenario_scale = normalizeScenarioScale(
      args.scenario_scale ?? get().script.scenario_scale ?? "oneshot",
    );
    const hidden = args.hidden_full_script;
    const sceneCount = hidden?.scenes?.length ?? 0;
    const npcCount = hidden?.npcs?.length ?? 0;
    set({
      script: {
        system_id,
        public_summary: args.public_summary,
        hidden_full_script: args.hidden_full_script,
        recommended_creation_mode: args.recommended_creation_mode,
        revealed: false,
        scenario_scale,
        tone_examples: args.tone_examples?.filter((t) => t.trim()).slice(0, 4),
      },
      theme: themeForSystem(system_id),
      houseRules: {
        preset_rules: [],
        custom_rules_text: get().houseRules.custom_rules_text,
      },
      character: createBlankCharacter(
        system_id === "DND_5E" ? "DND_5E" : "COC_7E",
      ),
      sceneDirector: {
        currentSceneId: null,
        sceneGoal: args.public_summary?.player_hook ?? "",
        tension: "medium",
        notes: "",
      },
    });
    const depthNote =
      scenario_scale === "seed"
        ? "規模：種子大綱"
        : `規模：${scenario_scale} · 場景 ${sceneCount} · NPC ${npcCount}`;
    get().appendSystem(
      `劇本已建立／更新：${args.public_summary?.title ?? "未命名"}（${system_id}，${depthNote}）。可繼續對話調整設定與房規；確認後再按「下一步」進入創角。可用預設房規：${presets.join("、")}`,
    );
  },

  setHouseRules: (rules) => set({ houseRules: rules }),

  setScenarioScale: (scale) =>
    set((s) => ({
      script: { ...s.script, scenario_scale: scale },
    })),

  togglePresetRule: (rule) =>
    set((s) => {
      const has = s.houseRules.preset_rules.includes(rule);
      return {
        houseRules: {
          ...s.houseRules,
          preset_rules: has
            ? s.houseRules.preset_rules.filter((r) => r !== rule)
            : [...s.houseRules.preset_rules, rule],
        },
      };
    }),

  setCharacterSchema: (schema) => {
    const mode = normalizeCreationMode(schema.creation_mode);
    const systemId =
      schema.system_id === "DND_5E" ? "DND_5E" : "COC_7E";
    const defs =
      schema.attribute_defs?.length > 0
        ? schema.attribute_defs
        : defaultAttributeDefs(systemId);
    const baseMode = defaultModeConfig(systemId);
    const aiArrayCandidate =
      schema.mode_config?.standard_array?.length
        ? schema.mode_config.standard_array
        : schema.standard_array?.length
          ? schema.standard_array
          : null;
    const resolvedArray = resolveStandardArray({
      systemId,
      attributeCount: defs.length,
      candidate: aiArrayCandidate,
    });
    const mode_config = {
      ...baseMode,
      ...schema.mode_config,
      standard_array: resolvedArray.array,
    };
    const pointBuyFallback = defaultPointBuy(systemId);
    const point_buy =
      schema.point_buy ??
      {
        budget: mode_config.point_buy_pool ?? pointBuyFallback.budget,
        min_score: mode_config.min_score ?? pointBuyFallback.min_score,
        max_score: mode_config.max_score ?? pointBuyFallback.max_score,
      };

    const normalized: CharacterSchemaState = {
      ...schema,
      system_id: systemId,
      creation_mode: mode,
      attribute_defs: defs,
      mode_config,
      standard_array_source: resolvedArray.source,
      standard_array: resolvedArray.array,
      point_buy,
      skill_points: schema.skill_points,
      recommended_skills: (schema.recommended_skills ?? []).map((sk) => ({
        ...sk,
        base_value: resolveSkillBaseValue(
          systemId,
          sk.name,
          sk.base_value,
        ),
        is_occupational: sk.is_occupational ?? false,
      })),
      background_questions: normalizeBackgroundQuestions(
        schema.background_questions,
        systemId,
      ),
    };

    const prev = get().character;
    const shell = createEmptyCharacterShell(systemId, defs);
    const skills: Record<string, number> = {};
    for (const sk of normalized.recommended_skills) {
      skills[sk.name] = sk.base_value;
    }

    const attrs =
      mode === "POINT_BUY"
        ? Object.fromEntries(defs.map((d) => [d.key, point_buy.min_score]))
        : shell.attributes;

    const prevHooks =
      prev?.backstory_hooks && Object.keys(prev.backstory_hooks).length
        ? prev.backstory_hooks
        : {};

    const keyClues = get().script.hidden_full_script?.key_clues;
    const rawInv = normalized.starting_inventory?.length
      ? [...normalized.starting_inventory]
      : [];
    const { kept: inventory, removed: strippedKeys } =
      filterKeyClueInventoryItems(rawInv, keyClues);

    const sheet = recomputeDerived({
      ...shell,
      id: prev?.id ?? shell.id,
      name: prev?.name ?? "",
      role_title:
        prev?.role_title || normalized.role_title_suggestion || "",
      attributes: { ...shell.attributes, ...attrs },
      skills: clampSkillsToSystemBases(systemId, skills),
      inventory,
      backstory_hooks: prevHooks,
    });

    set({
      characterSchema: { ...normalized, starting_inventory: inventory },
      character: sheet,
    });
    get().appendSystem(
      `創角規則已就緒（${mode}）。請完成「數值」與「劇情鉤子」雙軌；屬性不可任意手填。`,
    );
    if (strippedKeys.length) {
      get().appendSystem(
        `已自起始背包移除關鍵物證（應於冒險中發現）：${strippedKeys.join("、")}`,
      );
    }
  },

  setCharacter: (sheet) =>
    set({ character: migrateCharacterSheet(sheet) }),

  updateCharacterField: (updater) => {
    const current = get().character;
    if (!current) return;
    set({ character: recomputeDerived(updater(current)) });
  },

  applyCharacterNarrative: (payload) => {
    const current = get().character;
    if (!current) return;

    const pick = (v: string | undefined, fallback: string | undefined) => {
      if (v == null) return fallback ?? "";
      const t = v.trim();
      return t || fallback || "";
    };

    const hooksFromAi = Object.fromEntries(
      (payload.backstory_hooks ?? [])
        .filter((h) => h.id?.trim() && h.answer?.trim())
        .map((h) => [h.id.trim(), h.answer.trim()]),
    );

    const expectedHookIds =
      get().characterSchema?.background_questions?.map((q) => q.id) ?? [];

    const next = recomputeDerived({
      ...current,
      attributes: current.attributes,
      skills: current.skills,
      name: pick(payload.name, current.name),
      role_title: pick(payload.role_title, current.role_title),
      age: pick(payload.age, current.age),
      gender: pick(payload.gender, current.gender),
      appearance: pick(payload.appearance, current.appearance),
      residence: pick(payload.residence, current.residence),
      birthplace: pick(payload.birthplace, current.birthplace),
      languages: pick(payload.languages, current.languages),
      personal_bio: pick(payload.personal_bio, current.personal_bio),
      wealth: pick(payload.wealth, current.wealth),
      profile_coc:
        current.system_id === "COC_7E"
          ? {
              occupation: pick(
                payload.profile_coc?.occupation,
                current.profile_coc?.occupation,
              ),
              cash_assets: pick(
                payload.profile_coc?.cash_assets,
                current.profile_coc?.cash_assets,
              ),
            }
          : current.profile_coc,
      profile_dnd:
        current.system_id === "DND_5E"
          ? {
              race: pick(payload.profile_dnd?.race, current.profile_dnd?.race),
              class_name: pick(
                payload.profile_dnd?.class_name,
                current.profile_dnd?.class_name,
              ),
              background: pick(
                payload.profile_dnd?.background,
                current.profile_dnd?.background,
              ),
              alignment: pick(
                payload.profile_dnd?.alignment,
                current.profile_dnd?.alignment,
              ),
              speed:
                payload.profile_dnd?.speed ??
                current.profile_dnd?.speed ??
                30,
              proficiencies: pick(
                payload.profile_dnd?.proficiencies,
                current.profile_dnd?.proficiencies,
              ),
              features: pick(
                payload.profile_dnd?.features,
                current.profile_dnd?.features,
              ),
            }
          : current.profile_dnd,
      backstory_hooks: {
        ...current.backstory_hooks,
        ...hooksFromAi,
      },
      inventory: (() => {
        if (!payload.inventory?.length) return current.inventory;
        const raw = payload.inventory.map((x) => x.trim()).filter(Boolean);
        const { kept, removed } = filterKeyClueInventoryItems(
          raw,
          get().script.hidden_full_script?.key_clues,
        );
        if (removed.length) {
          get().appendSystem(
            `已自 AI 填入背包移除關鍵物證：${removed.join("、")}`,
          );
        }
        return kept;
      })(),
    });

    const missing: string[] = [];
    const need = (label: string, v?: string) => {
      if (!v?.trim()) missing.push(label);
    };
    need("姓名", next.name);
    need("職稱／別名", next.role_title);
    need("年齡", next.age);
    need("性別／認同", next.gender);
    need("外貌", next.appearance);
    need("現居", next.residence);
    need("出生地", next.birthplace);
    need("語言", next.languages);
    need("背景短述", next.personal_bio);
    need("資產概況", next.wealth);
    if (current.system_id === "COC_7E") {
      need("職業", next.profile_coc?.occupation);
      need("現金／資產", next.profile_coc?.cash_assets);
    }
    if (current.system_id === "DND_5E") {
      need("種族", next.profile_dnd?.race);
      need("職業", next.profile_dnd?.class_name);
      need("背景", next.profile_dnd?.background);
      need("陣營", next.profile_dnd?.alignment);
      need("熟練", next.profile_dnd?.proficiencies);
      need("特性", next.profile_dnd?.features);
    }
    for (const id of expectedHookIds) {
      if (!(next.backstory_hooks[id] ?? "").trim()) {
        missing.push(`鉤子「${id}」`);
      }
    }
    if (!next.inventory.length) missing.push("起始背包");

    set({ character: next });
    const note = payload.player_note?.trim();
    if (missing.length) {
      get().appendSystem(
        `AI 已寫入角色敘事，但仍缺：${missing.join("、")}。可再按「請 AI 設計角色敘事」補齊。`,
      );
    } else {
      get().appendSystem(
        note
          ? `AI 已完整填入角色敘事欄位：${note}`
          : `AI 已完整填入「${next.name}」的敘事／身分欄位（未改動屬性／技能配點）。可再手動修改。`,
      );
    }
  },

  applyStatChanges: (changes, inventory_add = [], inventory_remove = []) => {
    const sheet = get().character;
    if (!sheet) return;
    const blocked: string[] = [];
    const allowed = changes.filter((ch) => {
      if (ch.change_amount < 0 && isBlockedSocialSanLoss(ch.key, ch.reason)) {
        blocked.push(`${ch.key}${ch.change_amount}（${ch.reason}）`);
        return false;
      }
      return true;
    });
    if (blocked.length) {
      get().appendSystem(
        `已攔截不當 SAN 損失（社交／資訊檢定失敗不可扣理智）：${blocked.join("；")}`,
      );
    }
    if (!allowed.length && !inventory_add.length && !inventory_remove.length) {
      return;
    }
    const next = structuredClone(sheet);
    for (const ch of allowed) {
      const key = ch.key;
      if (key === "HP" || key === "hp") {
        next.derived.hp.current = Math.min(
          next.derived.hp.max,
          Math.max(0, next.derived.hp.current + ch.change_amount),
        );
      } else if (
        (key === "SAN" || key === "san" || key === "理智") &&
        next.derived.san
      ) {
        next.derived.san.current = Math.min(
          next.derived.san.max,
          Math.max(0, next.derived.san.current + ch.change_amount),
        );
      } else if (key === "MP" || key === "mp") {
        if (!next.derived.mp_or_slots) continue;
        next.derived.mp_or_slots.current = Math.min(
          next.derived.mp_or_slots.max,
          Math.max(
            0,
            next.derived.mp_or_slots.current + ch.change_amount,
          ),
        );
      } else if (key === "AC" && next.derived.ac != null) {
        next.derived.ac += ch.change_amount;
      } else if (key in next.attributes) {
        next.attributes[key] += ch.change_amount;
      } else if (key in next.skills) {
        next.skills[key] += ch.change_amount;
      }
    }
    let inv = [...next.inventory, ...inventory_add];
    for (const rem of inventory_remove) {
      const idx = inv.findIndex((i) => i === rem);
      if (idx >= 0) inv.splice(idx, 1);
    }
    next.inventory = inv;
    next.skills = clampSkillsToSystemBases(next.system_id, next.skills);
    set({ character: recomputeDerived(next) });
    if (allowed.length) {
      get().appendSystem(
        `狀態更新：${allowed.map((c) => `${c.key}${c.change_amount >= 0 ? "+" : ""}${c.change_amount}（${c.reason}）`).join("；")}`,
      );
    }
  },

  markSkillSuccess: (skill_name) => {
    const sheet = get().character;
    if (!sheet) return;
    const marked = new Set(sheet.markedSkillsForGrowth ?? []);
    marked.add(skill_name);
    set({
      character: { ...sheet, markedSkillsForGrowth: [...marked] },
    });
    get().appendSystem(`已標記技能成功（成長）：${skill_name}`);
  },

  recordClue: (clue) => {
    set((s) => ({
      clues: [...s.clues.filter((c) => c.clue_id !== clue.clue_id), clue],
    }));
    get().appendSystem(`發現線索：${clue.title}`);
  },

  addPlayerNote: ({ title, content }) => {
    const note_id = crypto.randomUUID();
    const now = Date.now();
    const note: PlayerNote = {
      note_id,
      title,
      content,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ playerNotes: [note, ...s.playerNotes] }));
    return note_id;
  },

  updatePlayerNote: (note_id, patch) => {
    set((s) => ({
      playerNotes: s.playerNotes.map((n) =>
        n.note_id === note_id
          ? {
              ...n,
              title: patch.title,
              content: patch.content,
              updatedAt: Date.now(),
            }
          : n,
      ),
    }));
  },

  removePlayerNote: (note_id) => {
    set((s) => ({
      playerNotes: s.playerNotes.filter((n) => n.note_id !== note_id),
    }));
  },

  triggerMadness: (madness) => {
    set({ madness });
    get().appendSystem(
      madness.active
        ? `狂氣發作：${madness.name ?? madness.type} — ${madness.effect_description ?? ""}`
        : "狂氣狀態解除",
    );
  },

  registerNpc: (npc) => {
    set((s) => ({
      npcs: [...s.npcs.filter((n) => n.npc_id !== npc.npc_id), npc],
    }));
    get().appendSystem(`NPC 更新：${npc.name}（${npc.relation}/${npc.status}）`);
  },

  setPendingDice: (dice, resolver) =>
    set({ pendingDice: dice, diceResolver: resolver ?? null }),

  clearDiceResolver: () => set({ diceResolver: null, pendingDice: null }),

  setSecretRollActive: (v) => set({ secretRollActive: v }),

  setPendingRuleLookup: (r) => {
    set({ pendingRuleLookup: r });
    if (r) {
      get().appendSystem(
        `規則判決：${r.rule_topic} — ${r.applied_reason}\n引用：${r.rule_reference_text}`,
      );
    }
  },

  narrateFromTool: (narrative, systemNotice) => {
    if (systemNotice) get().appendSystem(systemNotice);
    const msgs = get().messages;
    // 同輪若與既有 GM 敘事近重複：更新那則，並丟掉其後重複的 GM 訊息
    const trailingAgents: { id: string; content: string; index: number }[] =
      [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m) continue;
      if (m.role === "user") break;
      if (m.role === "agent") {
        trailingAgents.push({ id: m.id, content: m.content, index: i });
      }
    }
    const oldestFirst = [...trailingAgents].reverse();
    const target = oldestFirst.find((a) =>
      areDuplicateNarratives(a.content, narrative),
    );
    if (target) {
      get().updateMessage(target.id, narrative);
      const removeIds = new Set(
        trailingAgents
          .filter((a) => a.index > target.index)
          .map((a) => a.id),
      );
      if (removeIds.size > 0) {
        set({
          messages: get().messages.filter((m) => !removeIds.has(m.id)),
        });
      }
      get().collapseNarrativeRewrites();
      return;
    }
    get().appendMessage({ role: "agent", content: narrative });
    get().collapseNarrativeRewrites();
  },

  collapseNarrativeRewrites: () => {
    const msgs = get().messages;
    const trailing: { id: string; content: string; index: number }[] = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m) continue;
      if (m.role === "user") break;
      if (m.role === "agent") {
        trailing.push({ id: m.id, content: m.content, index: i });
      }
    }
    if (trailing.length < 2) return;
    const oldestFirst = [...trailing].reverse();
    // 兩兩比對：不要只跟「最舊一則」比（檢定前敘事還在時，兩則結果敘事彼此重複也要收）
    const remove = new Set<string>();
    for (let i = 0; i < oldestFirst.length; i++) {
      const keep = oldestFirst[i];
      if (!keep || remove.has(keep.id)) continue;
      for (let j = i + 1; j < oldestFirst.length; j++) {
        const other = oldestFirst[j];
        if (!other || remove.has(other.id)) continue;
        if (!areDuplicateNarratives(keep.content, other.content)) continue;
        get().updateMessage(keep.id, other.content);
        keep.content = other.content;
        remove.add(other.id);
      }
    }
    if (!remove.size) return;
    set({ messages: get().messages.filter((m) => !remove.has(m.id)) });
  },

  clearIncompleteOpening: (mode = "retry") => {
    const { lastPlayerAction } = get();
    if (lastPlayerAction.trim()) return;
    set({
      history: [],
      turn: 0,
      chapterSummaries: [],
      timelineIndex: null,
      // 連同舊的錯誤／開場提示一併清掉，避免重試後又從訊息還原 sessionError
      messages: [],
    });
    get().appendSystem(
      mode === "first"
        ? "夜幕將至——GM 正在為你述說開場…"
        : "場景重啟中——GM 正重新述說開場…",
    );
  },

  recordHistoryTurn: (partial) => {
    const state = get();
    const turn = state.turn + 1;
    const entry: HistoryLog = {
      turn,
      timestamp: Date.now(),
      playerInput: partial.playerInput,
      aiNarrative: partial.aiNarrative,
      diceRecord: partial.diceRecord,
      snapshot: snapshotOf(state),
    };
    const nextHistory = [...state.history, entry];
    const chapterSummaries = maybeCompressChapters(
      turn,
      nextHistory,
      state.chapterSummaries,
    );
    set({
      turn,
      history: nextHistory,
      chapterSummaries,
    });
  },

  replaceLastNarrative: (narrative) => {
    const history = get().history;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (!h) continue;
      if (h.aiNarrative.startsWith("（檢定結果已回傳）")) continue;
      if (h.aiNarrative.startsWith("（暗骰）")) continue;
      const next = history.slice();
      next[i] = { ...h, aiNarrative: narrative, timestamp: Date.now() };
      set({ history: next });
      return;
    }
  },

  removeLastAgentMessage: () => {
    const msgs = get().messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m) continue;
      if (m.role === "user") break;
      if (m.role === "agent") {
        set({ messages: msgs.filter((x) => x.id !== m.id) });
        return;
      }
    }
  },

  endGame: (ending) => {
    set((s) => ({
      ending,
      phase: "ENDING",
      pendingManualEnding: null,
      script: { ...s.script, revealed: true },
      timelineIndex: s.history.length ? s.history.length - 1 : null,
    }));
    get().appendSystem(`結局：${ending.ending_title}`);
    const msgs = get().messages;
    const lastAgent = [...msgs].reverse().find((m) => m.role === "agent");
    if (lastAgent?.content.trim() !== ending.ending_narrative.trim()) {
      get().appendMessage({ role: "agent", content: ending.ending_narrative });
    }
  },

  offerManualEnding: (offer) => {
    if (get().phase !== "PLAYING") return;
    set({ pendingManualEnding: offer });
  },

  clearManualEndingOffer: () => set({ pendingManualEnding: null }),

  confirmManualEnding: (override) => {
    if (get().phase !== "PLAYING") return;
    const pending = get().pendingManualEnding;
    const narrative =
      override?.narrative?.trim() ||
      pending?.narrative?.trim() ||
      "";
    if (!narrative) return;
    const title =
      override?.title?.trim() ||
      pending?.title?.trim() ||
      get().script.public_summary?.title ||
      "結局";
    get().endGame({
      ending_type: override?.ending_type?.trim() || "TRUE_ENDING",
      ending_title: title,
      ending_narrative: narrative,
      achievements: [],
    });
  },

  markEndingCharacterSettled: () => {
    set({ endingCharacterSettled: true });
  },

  undoLastTurn: () => {
    const { history } = get();
    if (history.length < 1) return;
    const prev = history[history.length - 1];
    const snap = prev.snapshot;
    set({
      history: history.slice(0, -1),
      turn: Math.max(0, get().turn - 1),
      character: snap.character,
      clues: snap.clues,
      playerNotes: snap.playerNotes ?? [],
      npcs: snap.npcs,
      madness: snap.madness ?? { active: false },
    });
    get().appendSystem("已還原至上一回合快照。");
  },

  setTimelineIndex: (idx) => set({ timelineIndex: idx }),

  confirmCharacterAndPlay: () => {
    const sheet = get().character;
    if (!sheet) return;
    void (async () => {
      const session = getActiveSession();
      if (!session || session.getStatus() !== "idle") {
        get().appendSystem("Session 未就緒，無法開始冒險。");
        get().setSessionError({
          code: "SESSION_NOT_READY",
          message: "Session 未就緒，無法開始冒險。",
        });
        get().setRetryAction({ kind: "opening", label: "重試開場敘事" });
        return;
      }

      const campaignId = get().campaignId;
      const bindErr = bindCharacterToCampaign(sheet, campaignId);
      if (bindErr) {
        get().appendSystem(bindErr);
        get().setSessionError({
          code: "CHARACTER_BUSY",
          message: bindErr,
        });
        return;
      }

      const enriched = recomputeDerived(
        enrichCharacterSheetMeta(sheet, get().characterSchema),
      );
      // 以結算後／確認後數值再寫一次綁定（確保檔案庫為上場版本）
      bindCharacterToCampaign(enriched, campaignId);

      set({
        phase: "PLAYING",
        character: enriched,
        characterBaseline: captureStatSnapshot(enriched, get().madness),
        boundCharacterId: enriched.id,
        // 清掉前面 Session/創角階段的訊息，避免在冒險階段顯示舊內容
        history: [],
        messages: [],
        chapterSummaries: [],
        playerNotes: [],
        turn: 0,
        timelineIndex: null,
        lastPlayerAction: "",
        sessionError: null,
        location:
          get().script.public_summary?.geography?.split(/[，,、]/)[0]?.trim() ||
          "冒險開始之處",
        sceneDirector: {
          currentSceneId:
            get().script.hidden_full_script?.scenes?.[0]?.id ?? null,
          sceneGoal: get().script.public_summary?.player_hook ?? "",
          tension: "medium",
          notes: "",
        },
        retryAction: { kind: "opening", label: "述說開場敘事" },
      });

      get().appendSystem(
        `角色「${enriched.name}」已存入檔案庫，並綁定本場冒險。一角同時僅能進行一場。`,
      );

      try {
        await sendOpeningNarration();
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "SEND_FAILED";
        const message =
          err instanceof Error ? err.message : "開場敘事送出失敗";
        // onError 多半已寫入 sessionError；此處補齊未觸發 onError 的情況
        if (!get().sessionError) {
          get().setSessionError({ code, message });
          get().appendSystem(`錯誤：${code} — ${message}`);
        }
      }
    })();
  },

  advanceToCharacterPhase: () => {
    const { script } = get();
    if (!script.system_id || !script.public_summary) {
      get().appendSystem("請先與 GM 完成劇本設定（setup_script），再進入創角。");
      return;
    }
    set({ phase: "CHARACTER" });
    get().appendSystem(
      "已確認劇本與房規，進入創角階段。可創建新角色，或帶入檔案庫中同系統的角色卡。",
    );
  },

  applyGrowthResult: (skill, gained) => {
    get().updateCharacterField((sheet) => ({
      ...sheet,
      skills: {
        ...sheet.skills,
        [skill]: (sheet.skills[skill] ?? 0) + gained,
      },
      markedSkillsForGrowth: (sheet.markedSkillsForGrowth ?? []).filter(
        (s) => s !== skill,
      ),
    }));
  },

  toPersist: () => {
    const s = get();
    const persistPhase = s.phase === "PREFLIGHT" ? "SESSION_0" : s.phase;
    return {
      id: s.campaignId,
      title: campaignTitleFromState(s.script, s.messages),
      createdAt: s.campaignCreatedAt,
      updatedAt: Date.now(),
      phase: persistPhase,
      theme: s.theme,
      location: s.location,
      sceneDirector: s.sceneDirector,
      script: s.script,
      houseRules: s.houseRules,
      character: s.character,
      characterSchema: s.characterSchema,
      characterBaseline: s.characterBaseline,
      boundCharacterId: s.boundCharacterId ?? s.character?.id ?? null,
      clues: s.clues,
      playerNotes: s.playerNotes,
      npcs: s.npcs,
      madness: s.madness,
      history: s.history,
      chapterSummaries: s.chapterSummaries,
      turn: s.turn,
      messages: s.messages,
      ending: s.ending,
      timelineIndex: s.timelineIndex,
      lastPlayerAction: s.lastPlayerAction,
      composerDraft: s.composerDraft,
      suggestPlayerActions: s.suggestPlayerActions,
      endingCharacterSettled: s.endingCharacterSettled,
    };
  },

  hydrateCampaign: (data) => {
    const LOAD_NOTICE_RE = /^已載入「.+」，可繼續進度。$/;
    const messages = (data.messages ?? []).filter(
      (m) => !(m.role === "system" && LOAD_NOTICE_RE.test(m.content)),
    );
    // 玩家尚未行動時一律保留開場重試（含開場寫到一半就斷線的存檔）
    const needsOpening =
      data.phase === "PLAYING" && !(data.lastPlayerAction ?? "").trim();

    const charId = data.boundCharacterId ?? data.character?.id ?? null;
    const settledFromCareer = Boolean(
      charId &&
        getLibraryCharacter(charId)?.career.some(
          (r) => r.campaignId === data.id,
        ),
    );

    set({
      campaignId: data.id,
      campaignCreatedAt: data.createdAt,
      phase: data.phase === "PREFLIGHT" ? "SESSION_0" : data.phase,
      theme: data.theme,
      location: data.location,
      sceneDirector: data.sceneDirector ?? {
        currentSceneId: null,
        sceneGoal: data.script.public_summary?.player_hook ?? "",
        tension: "medium",
        notes: "",
      },
      script: data.script,
      houseRules: data.houseRules,
      character: data.character,
      characterSchema: data.characterSchema,
      characterBaseline: data.characterBaseline ?? null,
      boundCharacterId:
        data.boundCharacterId ?? data.character?.id ?? null,
      clues: data.clues,
      playerNotes: data.playerNotes ?? [],
      npcs: data.npcs,
      madness: data.madness,
      history: data.history,
      chapterSummaries: data.chapterSummaries,
      turn: data.turn,
      messages,
      ending: data.ending,
      pendingManualEnding: null,
      endingCharacterSettled:
        Boolean(data.endingCharacterSettled) || settledFromCareer,
      timelineIndex: data.timelineIndex,
      lastPlayerAction: data.lastPlayerAction,
      composerDraft: data.composerDraft,
      suggestPlayerActions: data.suggestPlayerActions ?? true,
      pendingDice: null,
      pendingRuleLookup: null,
      diceResolver: null,
      isTyping: false,
      secretRollActive: false,
      sessionError: null,
      retryAction: needsOpening
        ? { kind: "opening", label: "重試開場敘事" }
        : data.lastPlayerAction
          ? {
              kind: "player",
              label: "重試上一步行動",
              text: data.lastPlayerAction,
            }
          : null,
    });
  },

  startNewCampaign: () => {
    const empty = createEmptyCampaignPersist();
    empty.suggestPlayerActions = get().suggestPlayerActions;
    empty.script.scenario_scale =
      get().script.scenario_scale ?? "oneshot";
    get().hydrateCampaign(empty);
    return empty;
  },
}));
