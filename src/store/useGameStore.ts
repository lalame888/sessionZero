import { create } from "zustand";
import type { PedelecSessionStatus, ProviderCode } from "@kaoruisaac/pedelec";
import {
  maybeCompressChapters,
} from "@/engine/contextAssembler";
import {
  createBlankCharacter,
  migrateCharacterSheet,
  normalizeCocCreationSheet,
  recomputeDerived,
  themeForSystem,
} from "@/engine/formulas";
import {
  badEndingWinConflictWarning,
  emptyWinProgress,
  noteClueForWinProgress,
  noteNarrativeForWinProgress,
  type WinProgressFlags,
} from "@/engine/winFlags";
import {
  createEmptyCharacterShell,
  defaultAttributeDefs,
  defaultModeConfig,
  enrichCharacterSheetMeta,
  filterKeyClueInventoryItems,
  clampSkillsToSystemBases,
  normalizeAttrFormula,
  normalizeBackgroundQuestions,
  normalizeCreationMode,
  resolvePointBuyConfig,
  resolveSkillBaseValue,
  resolveStandardArray,
} from "@/engine/creation";
import { resolveCocAttributeKeyFromCheckName } from "@/engine/skillCheck";
import {
  campaignTitleFromState,
  createEmptyCampaignPersist,
  type CampaignPersist,
} from "@/lib/campaignStorage";
import { evaluateCombatStatAftermath, type CombatAftermathResult } from "@/engine/combatAftermath";
import type { ContinuityBridgeState } from "@/engine/continuityBridge";
import {
  applyContinuityRecovery,
  buildContinuityBridgeState,
  normalizeContinuityChoice,
  type ContinuityBridgeChoice,
} from "@/engine/continuityBridge";
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
import {
  clampPartySize,
  getPlayerSheet,
  MAX_PARTY_SIZE,
  partyFromLegacyCharacter,
  replacePartySlot,
  syncPartySheet,
  type PartyMember,
  type PendingCompanionHandoff,
} from "@/types/party";

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
  /** 冒險開始時角色數值快照（結局履歷對照） */
  characterBaseline: CharacterStatSnapshot | null;
  /** 綁定檔案庫角色 ID */
  boundCharacterId: string | null;
  /** 玩家確認的隊伍人數 */
  partySize: number;
  recommendedPartySize: number | null;
  party: PartyMember[];
  playerMemberId: string | null;
  editingPartySlotIndex: number;
  endingCompanionsSavedIds: string[];
  /** 結局已處理完 AI 隊友檔案庫選擇（存入或略過） */
  endingCompanionsResolved: boolean;
  /** 隊友宣告後軟停：等玩家插話或「讓 GM 結算」 */
  pendingCompanionHandoff: PendingCompanionHandoff | null;
  /**
   * 自角色庫帶入時的幕間銜接（全隊共用）。
   * 僅有 fromLibrary 成員時會套用；開場注入 premiseZh。
   */
  continuityBridge: ContinuityBridgeState | null;
  /** 側欄／檢定目標目前檢視的成員 */
  viewedPartyMemberId: string | null;
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
    /** 建議結局類型；死亡／崩潰路徑應為 BAD_ENDING */
    ending_type?: string;
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
    recommended_party_size?: number | null;
    party_role_hints?: { role_title: string; brief: string }[] | null;
  }) => void;
  setHouseRules: (rules: HouseRuleConfig) => void;
  setScenarioScale: (scale: ScenarioScale) => void;
  setPartySize: (n: number) => void;
  setEditingPartySlotIndex: (idx: number) => void;
  setPlayerMemberSlot: (slotIndex: number) => void;
  upsertPartyMemberAtSlot: (
    slotIndex: number,
    sheet: UniversalCharacterSheet,
    opts?: {
      controller?: "player" | "ai";
      roleHint?: string;
      creationComplete?: boolean;
      creationDraft?: import("@/types/party").CharacterCreationDraft;
      fromLibrary?: boolean;
      /** true 時清掉草稿／完成標記（例如席次換成空白卡） */
      resetCreationMeta?: boolean;
    },
  ) => void;
  /** 自隊伍移除指定角色（取消帶入） */
  clearPartyMemberByCharacterId: (characterId: string) => void;
  /** 將已在隊角色改帶到另一席次 */
  movePartyMemberToSlot: (
    characterId: string,
    toSlotIndex: number,
    opts?: { controller?: "player" | "ai" },
  ) => void;
  setViewedPartyMemberId: (id: string | null) => void;
  setPendingCompanionHandoff: (h: PendingCompanionHandoff | null) => void;
  setContinuityBridge: (b: ContinuityBridgeState | null) => void;
  /**
   * 對檔案庫角色套用全隊銜接恢復，並更新 continuityBridge 摘要。
   * 回傳恢復後的 sheet。
   */
  applyContinuityToLibrarySheet: (
    sheet: UniversalCharacterSheet,
    choice: ContinuityBridgeChoice,
  ) => UniversalCharacterSheet;
  markCompanionsSaved: (ids: string[]) => void;
  resolveEndingCompanions: (opts?: { savedIds?: string[] }) => void;
  /** 依 character_id 取 sheet；缺省為玩家 */
  getSheetById: (characterId?: string | null) => UniversalCharacterSheet | null;
  updateSheetById: (
    characterId: string | null | undefined,
    updater: (sheet: UniversalCharacterSheet) => UniversalCharacterSheet,
  ) => void;
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
    character_id?: string | null,
  ) => CombatAftermathResult | null;
  /** 重傷 CON 失敗後暫時失去主動行動的角色 id */
  incapacitatedCharacterIds: string[];
  setCharacterIncapacitated: (characterId: string, incapacitated: boolean) => void;
  winProgress: WinProgressFlags;
  patchWinProgress: (patch: Partial<WinProgressFlags> | ((prev: WinProgressFlags) => WinProgressFlags)) => void;
  markSkillSuccess: (skill_name: string, character_id?: string | null) => void;
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
  offerManualEnding: (offer: {
    title: string;
    narrative: string;
    ending_type?: string;
  }) => void;
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
  /** 自創角／組建隊伍退回 Session 0 劇本討論（保留已創角色草稿） */
  backToScriptPhase: () => void;
  setLastPlayerAction: (action: string) => void;
  applyGrowthResult: (
    skill: string,
    gained: number,
    characterId?: string | null,
  ) => void;

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
  incapacitatedCharacterIds: [],
  winProgress: emptyWinProgress(),
  selectedProvider: null,
  selectedModel: "",
  composerDraft: "",
  lastPlayerAction: "",
  suggestPlayerActions: false,
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
  partySize: 1,
  recommendedPartySize: null,
  party: [],
  playerMemberId: null,
  editingPartySlotIndex: 0,
  endingCompanionsSavedIds: [],
  endingCompanionsResolved: false,
  pendingCompanionHandoff: null,
  continuityBridge: null,
  viewedPartyMemberId: null,
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
  setCharacterIncapacitated: (characterId, incapacitated) =>
    set((s) => {
      const id = characterId.trim();
      if (!id) return s;
      const has = s.incapacitatedCharacterIds.includes(id);
      if (incapacitated && !has) {
        return {
          incapacitatedCharacterIds: [...s.incapacitatedCharacterIds, id],
        };
      }
      if (!incapacitated && has) {
        return {
          incapacitatedCharacterIds: s.incapacitatedCharacterIds.filter(
            (x) => x !== id,
          ),
        };
      }
      return s;
    }),
  patchWinProgress: (patch) =>
    set((s) => ({
      winProgress:
        typeof patch === "function"
          ? patch(s.winProgress)
          : { ...s.winProgress, ...patch },
    })),
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
    const recommendedPartySize = clampPartySize(
      args.recommended_party_size ?? get().recommendedPartySize ?? 1,
    );
    const party_role_hints = (args.party_role_hints ?? [])
      .filter((h) => h.role_title?.trim())
      .slice(0, MAX_PARTY_SIZE)
      .map((h) => ({
        role_title: h.role_title.trim(),
        brief: (h.brief ?? "").trim(),
      }));
    const hidden = args.hidden_full_script;
    const sceneCount = hidden?.scenes?.length ?? 0;
    const npcCount = hidden?.npcs?.length ?? 0;
    const blank = createBlankCharacter(
      system_id === "DND_5E" ? "DND_5E" : "COC_7E",
    );
    set({
      script: {
        system_id,
        public_summary: args.public_summary,
        hidden_full_script: args.hidden_full_script,
        recommended_creation_mode: normalizeCreationMode(
          args.recommended_creation_mode,
          system_id === "DND_5E" ? "DND_5E" : "COC_7E",
        ),
        revealed: false,
        scenario_scale,
        tone_examples: args.tone_examples?.filter((t) => t.trim()).slice(0, 4),
        recommended_party_size: recommendedPartySize,
        party_role_hints:
          party_role_hints.length > 0 ? party_role_hints : null,
      },
      theme: themeForSystem(system_id),
      houseRules: {
        preset_rules: [],
        custom_rules_text: get().houseRules.custom_rules_text,
      },
      character: blank,
      party: [],
      partySize: recommendedPartySize,
      recommendedPartySize,
      playerMemberId: null,
      editingPartySlotIndex: 0,
      viewedPartyMemberId: null,
      endingCompanionsSavedIds: [],
      endingCompanionsResolved: false,
      pendingCompanionHandoff: null,
      continuityBridge: null,
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
      `劇本已建立／更新：${args.public_summary?.title ?? "未命名"}（${system_id}，${depthNote}；建議隊伍 ${recommendedPartySize} 人）。可繼續對話調整設定與房規；確認後再按「下一步」進入創角。可用預設房規：${presets.join("、")}`,
    );
  },

  setHouseRules: (rules) => set({ houseRules: rules }),

  setScenarioScale: (scale) =>
    set((s) => ({
      script: { ...s.script, scenario_scale: scale },
    })),

  setPartySize: (n) => {
    const size = clampPartySize(n);
    set((s) => ({
      partySize: size,
      editingPartySlotIndex: Math.min(s.editingPartySlotIndex, size - 1),
      party: s.party.filter((m) => m.slotIndex < size),
    }));
  },

  setEditingPartySlotIndex: (idx) => {
    const size = get().partySize;
    const slot = Math.max(0, Math.min(size - 1, idx));
    const existing = get().party.find((m) => m.slotIndex === slot);
    if (existing) {
      set({
        editingPartySlotIndex: slot,
        character: existing.sheet,
      });
      return;
    }

    // 空席必須新 ID／空白卡，不可沿用上一席 character（否則兩席同 id 開打會合併）
    const systemId =
      get().script.system_id === "DND_5E" ? "DND_5E" : "COC_7E";
    const hints = get().script.party_role_hints ?? [];
    const hint =
      hints[slot]?.role_title ||
      (slot === 0
        ? get().script.public_summary?.protagonist_role
        : undefined) ||
      undefined;
    const blank = createBlankCharacter(systemId);
    if (hint) blank.role_title = hint;

    const hasPlayer = get().party.some((m) => m.controller === "player");
    const controller: "player" | "ai" =
      !hasPlayer && (slot === 0 || get().playerMemberId == null)
        ? "player"
        : "ai";

    set({ editingPartySlotIndex: slot });
    get().upsertPartyMemberAtSlot(slot, blank, {
      controller,
      roleHint: hint,
      resetCreationMeta: true,
    });
  },

  setPlayerMemberSlot: (slotIndex) => {
    const size = get().partySize;
    const slot = Math.max(0, Math.min(size - 1, slotIndex));
    set((s) => {
      const party = s.party.map((m) => ({
        ...m,
        controller: (m.slotIndex === slot ? "player" : "ai") as
          | "player"
          | "ai",
      }));
      const player = party.find((m) => m.slotIndex === slot);
      return {
        party,
        playerMemberId: player?.id ?? s.playerMemberId,
        character: player?.sheet ?? s.character,
        viewedPartyMemberId: player?.id ?? s.viewedPartyMemberId,
      };
    });
  },

  upsertPartyMemberAtSlot: (slotIndex, sheet, opts) => {
    const size = get().partySize;
    const slot = Math.max(0, Math.min(size - 1, slotIndex));
    const migrated = migrateCharacterSheet(sheet);
    const hints = get().script.party_role_hints ?? [];
    const existing = get().party.find((m) => m.slotIndex === slot);
    const roleHint =
      opts?.roleHint ??
      existing?.roleHint ??
      hints[slot]?.role_title ??
      migrated.role_title;
    const existingController = existing?.controller;
    const controller: "player" | "ai" =
      opts?.controller ??
      (get().playerMemberId === migrated.id
        ? "player"
        : existingController) ??
      (slot === 0 && !get().party.some((m) => m.controller === "player")
        ? "player"
        : "ai");
    const resetMeta = opts?.resetCreationMeta === true;
    const member: PartyMember = {
      id: migrated.id,
      sheet: migrated,
      controller,
      roleHint,
      slotIndex: slot,
      creationComplete: resetMeta
        ? false
        : (opts?.creationComplete ?? existing?.creationComplete),
      creationDraft: resetMeta
        ? undefined
        : (opts?.creationDraft ?? existing?.creationDraft),
      fromLibrary: resetMeta
        ? false
        : (opts?.fromLibrary ?? existing?.fromLibrary),
    };
    set((s) => {
      let party = replacePartySlot(s.party, slot, member);
      // 確保只有一位 player
      if (controller === "player") {
        party = party.map((m) =>
          m.slotIndex === slot
            ? m
            : { ...m, controller: "ai" as const },
        );
      }
      const playerId =
        controller === "player"
          ? migrated.id
          : s.playerMemberId === migrated.id
            ? migrated.id
            : party.find((m) => m.controller === "player")?.id ??
              s.playerMemberId;
      const playerSheet =
        getPlayerSheet(party, playerId, migrated) ?? migrated;
      return {
        party,
        playerMemberId: playerId,
        character:
          s.editingPartySlotIndex === slot || controller === "player"
            ? migrated
            : playerSheet,
        viewedPartyMemberId: s.viewedPartyMemberId ?? playerId,
      };
    });
  },

  clearPartyMemberByCharacterId: (characterId) => {
    const s0 = get();
    const member = s0.party.find(
      (m) => m.id === characterId || m.sheet.id === characterId,
    );
    if (!member) return;
    const systemId =
      s0.script.system_id === "DND_5E" ? "DND_5E" : "COC_7E";
    const party = s0.party.filter((m) => m.slotIndex !== member.slotIndex);
    const wasEditing = s0.editingPartySlotIndex === member.slotIndex;
    const blank = createBlankCharacter(systemId);
    const nextPlayer =
      party.find((m) => m.controller === "player") ??
      party.find((m) => m.id === s0.playerMemberId) ??
      null;
    set({
      party,
      playerMemberId:
        member.controller === "player" || s0.playerMemberId === member.id
          ? (nextPlayer?.id ?? null)
          : s0.playerMemberId,
      character: wasEditing
        ? blank
        : s0.character?.id === member.id
          ? (nextPlayer?.sheet ?? blank)
          : s0.character,
      viewedPartyMemberId:
        s0.viewedPartyMemberId === member.id
          ? (nextPlayer?.id ?? null)
          : s0.viewedPartyMemberId,
    });
  },

  movePartyMemberToSlot: (characterId, toSlotIndex, opts) => {
    const s0 = get();
    const size = s0.partySize;
    const toSlot = Math.max(0, Math.min(size - 1, toSlotIndex));
    const member = s0.party.find(
      (m) => m.id === characterId || m.sheet.id === characterId,
    );
    if (!member) return;
    if (member.slotIndex === toSlot) return;

    const fromSlot = member.slotIndex;
    const controller: "player" | "ai" =
      opts?.controller ?? member.controller;
    const moved: PartyMember = {
      ...member,
      slotIndex: toSlot,
      controller,
    };

    let party = s0.party.filter(
      (m) => m.slotIndex !== fromSlot && m.slotIndex !== toSlot,
    );
    party = [...party, moved].sort((a, b) => a.slotIndex - b.slotIndex);
    if (controller === "player") {
      party = party.map((m) =>
        m.slotIndex === toSlot
          ? m
          : { ...m, controller: "ai" as const },
      );
    }

    const playerId =
      controller === "player"
        ? moved.id
        : party.find((m) => m.controller === "player")?.id ??
          (s0.playerMemberId === member.id ? null : s0.playerMemberId);

    set({
      party,
      playerMemberId: playerId,
      editingPartySlotIndex: toSlot,
      character: moved.sheet,
      viewedPartyMemberId:
        s0.viewedPartyMemberId === member.id
          ? moved.id
          : s0.viewedPartyMemberId,
    });
    get().appendSystem(
      `已將「${member.sheet.name || "未命名"}」自席次 ${fromSlot + 1} 改帶入席次 ${toSlot + 1}。`,
    );
  },

  setViewedPartyMemberId: (id) => set({ viewedPartyMemberId: id }),

  setPendingCompanionHandoff: (h) => set({ pendingCompanionHandoff: h }),

  setContinuityBridge: (b) => set({ continuityBridge: b }),

  applyContinuityToLibrarySheet: (sheet, choice) => {
    const normalized = normalizeContinuityChoice(choice);
    const { sheet: recovered, lines } = applyContinuityRecovery(
      sheet,
      normalized,
    );
    const prev = get().continuityBridge;
    const summaries = [
      ...(prev?.appliedSummaries ?? []).filter(
        (s) => s.characterId !== recovered.id,
      ),
      {
        characterId: recovered.id,
        name: recovered.name?.trim() || "角色",
        lines,
      },
    ];
    set({
      continuityBridge: buildContinuityBridgeState(
        normalized,
        recovered.system_id ?? get().script.system_id,
        summaries,
      ),
    });
    return recovered;
  },

  markCompanionsSaved: (ids) =>
    set({ endingCompanionsSavedIds: [...new Set(ids)] }),

  resolveEndingCompanions: (opts) =>
    set((s) => ({
      endingCompanionsResolved: true,
      endingCompanionsSavedIds: [
        ...new Set([
          ...s.endingCompanionsSavedIds,
          ...(opts?.savedIds ?? []),
        ]),
      ],
    })),

  getSheetById: (characterId) => {
    const s = get();
    if (!characterId) {
      return (
        getPlayerSheet(s.party, s.playerMemberId, s.character) ?? s.character
      );
    }
    return (
      s.party.find((m) => m.id === characterId || m.sheet.id === characterId)
        ?.sheet ??
      (s.character?.id === characterId ? s.character : null)
    );
  },

  updateSheetById: (characterId, updater) => {
    const targetId =
      characterId ||
      get().playerMemberId ||
      get().character?.id ||
      null;
    const current = get().getSheetById(targetId);
    if (!current) return;
    const next = recomputeDerived(updater(current));
    set((s) => {
      const party = syncPartySheet(s.party, next);
      const isPlayer =
        next.id === s.playerMemberId ||
        party.find((m) => m.id === next.id)?.controller === "player";
      return {
        party,
        character: isPlayer || s.character?.id === next.id ? next : s.character,
      };
    });
  },

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
    const systemId =
      schema.system_id === "DND_5E" ? "DND_5E" : "COC_7E";
    const mode = normalizeCreationMode(schema.creation_mode, systemId);
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
      occupational_point_formula: schema.mode_config?.occupational_point_formula
        ? normalizeAttrFormula(schema.mode_config.occupational_point_formula)
        : schema.mode_config?.occupational_point_formula,
      interest_point_formula: schema.mode_config?.interest_point_formula
        ? normalizeAttrFormula(schema.mode_config.interest_point_formula)
        : schema.mode_config?.interest_point_formula,
    };
    const point_buy = resolvePointBuyConfig(
      systemId,
      schema.point_buy,
      mode_config,
    );

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
      recommended_skills: (schema.recommended_skills ?? [])
        .filter((sk) => {
          if (systemId !== "COC_7E") return true;
          // 屬性名不可當技能（避免「敏捷:5」蓋掉 DEX 檢定）
          return !resolveCocAttributeKeyFromCheckName(sk.name);
        })
        .map((sk) => ({
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
    const editingSlot = get().editingPartySlotIndex;
    const slotMember = get().party.find((m) => m.slotIndex === editingSlot);
    // 僅當「目前編輯席」與 store.character 同一張卡時才沿用 id／敘事，避免席次2吃到席次1
    const canReuseIdentity = Boolean(
      prev && slotMember && slotMember.sheet.id === prev.id,
    );
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
      canReuseIdentity &&
      prev?.backstory_hooks &&
      Object.keys(prev.backstory_hooks).length
        ? prev.backstory_hooks
        : {};

    const keyClues = get().script.hidden_full_script?.key_clues;
    const rawInv = normalized.starting_inventory?.length
      ? [...normalized.starting_inventory]
      : [];
    const { kept: inventory, removed: strippedKeys } =
      filterKeyClueInventoryItems(rawInv, keyClues);

    const reuseId =
      canReuseIdentity && prev
        ? prev.id
        : slotMember && !slotMember.creationComplete
          ? slotMember.sheet.id
          : shell.id;

    const sheet = recomputeDerived({
      ...shell,
      id: reuseId,
      name: canReuseIdentity && prev ? prev.name ?? "" : "",
      role_title:
        (canReuseIdentity && prev?.role_title) ||
        slotMember?.roleHint ||
        normalized.role_title_suggestion ||
        "",
      attributes: { ...shell.attributes, ...attrs },
      skills: clampSkillsToSystemBases(systemId, skills),
      inventory,
      backstory_hooks: prevHooks,
    });

    set({
      characterSchema: { ...normalized, starting_inventory: inventory },
      character: sheet,
    });
    get().upsertPartyMemberAtSlot(get().editingPartySlotIndex, sheet);
    get().appendSystem(
      `創角規則已就緒（${mode}）。請完成「數值」與「劇情鉤子」雙軌；屬性不可任意手填。`,
    );
    if (strippedKeys.length) {
      get().appendSystem(
        `已自起始背包移除關鍵物證（應於冒險中發現）：${strippedKeys.join("、")}`,
      );
    }
  },

  setCharacter: (sheet) => {
    const migrated = migrateCharacterSheet(sheet);
    const slot = get().editingPartySlotIndex;
    get().upsertPartyMemberAtSlot(slot, migrated);
  },

  updateCharacterField: (updater) => {
    const slot = get().editingPartySlotIndex;
    const existing = get().party.find((m) => m.slotIndex === slot)?.sheet;
    const current = existing ?? get().character;
    if (!current) return;
    const next = recomputeDerived(updater(current));
    get().upsertPartyMemberAtSlot(slot, next);
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
    get().upsertPartyMemberAtSlot(get().editingPartySlotIndex, next);
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

  applyStatChanges: (
    changes,
    inventory_add = [],
    inventory_remove = [],
    character_id = null,
  ) => {
    const sheet = get().getSheetById(character_id);
    if (!sheet) return null;
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
      return null;
    }
    const targetId = character_id ?? sheet.id;
    const hpBefore = sheet.derived.hp.current;
    const hpMax = sheet.derived.hp.max;
    const sanBefore = sheet.derived.san?.current ?? null;

    get().updateSheetById(targetId, (base) => {
      const next = structuredClone(base);
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
      return next;
    });
    if (allowed.length) {
      const who =
        get().getSheetById(targetId)?.name?.trim() || "角色";
      get().appendSystem(
        `狀態更新（${who}）：${allowed.map((c) => `${c.key}${c.change_amount >= 0 ? "+" : ""}${c.change_amount}（${c.reason}）`).join("；")}`,
      );
    }

    const after = get().getSheetById(targetId);
    if (!after) return null;
    const isPlayerPc =
      targetId === get().playerMemberId ||
      (!get().playerMemberId && targetId === get().character?.id);
    const aftermath = evaluateCombatStatAftermath({
      name: after.name,
      isPlayerPc,
      hpBefore,
      hpAfter: after.derived.hp.current,
      hpMax,
      sanBefore,
      sanAfter: after.derived.san?.current ?? null,
    });
    for (const n of aftermath.notices) {
      get().appendSystem(n.message);
    }
    if (aftermath.offerBadEnding && get().phase === "PLAYING") {
      get().offerManualEnding(aftermath.offerBadEnding);
    }
    return aftermath;
  },

  markSkillSuccess: (skill_name, character_id = null) => {
    const sheet = get().getSheetById(character_id);
    if (!sheet) return;
    let newlyMarked = false;
    get().updateSheetById(character_id ?? sheet.id, (base) => {
      const marked = new Set(base.markedSkillsForGrowth ?? []);
      newlyMarked = !marked.has(skill_name);
      marked.add(skill_name);
      return { ...base, markedSkillsForGrowth: [...marked] };
    });
    if (newlyMarked) {
      const who = sheet.name?.trim() || "角色";
      get().appendSystem(`已標記技能成功（成長）「${who}」：${skill_name}`);
    }
  },

  recordClue: (clue) => {
    set((s) => ({
      clues: [...s.clues.filter((c) => c.clue_id !== clue.clue_id), clue],
      winProgress: noteClueForWinProgress(
        s.winProgress,
        clue.title,
        clue.is_key_clue,
      ),
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
    const win = get().script.hidden_full_script?.winning_condition ?? "";
    const warn = badEndingWinConflictWarning({
      endingType: ending.ending_type,
      winningCondition: win,
      progress: get().winProgress,
    });
    if (warn) {
      get().appendSystem(warn);
    }
    set((s) => ({
      ending,
      phase: "ENDING",
      pendingCompanionHandoff: null,
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
      ending_type:
        override?.ending_type?.trim() ||
        pending?.ending_type?.trim() ||
        "TRUE_ENDING",
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
    const s0 = get();
    // 確保每位席次都有成員；玩家席必須存在
    if (s0.party.length < s0.partySize) {
      get().appendSystem(
        `隊伍尚未建齊（${s0.party.length}/${s0.partySize}）。請為每位成員完成角色卡。`,
      );
      return;
    }
    const player =
      s0.party.find((m) => m.controller === "player") ??
      s0.party.find((m) => m.id === s0.playerMemberId);
    if (!player?.sheet) {
      get().appendSystem("請指定「我扮演」的角色席次。");
      return;
    }
    const incomplete = Array.from({ length: s0.partySize }, (_, i) => i).filter(
      (i) => !s0.party.some((m) => m.slotIndex === i && m.creationComplete),
    );
    if (incomplete.length) {
      get().appendSystem(
        `尚有未完成創角的席次（${incomplete.map((i) => i + 1).join("、")}）：需完成屬性／技能配點並確認席次。`,
      );
      return;
    }

    // 防衛：若兩席誤共用同一 id，為後者重新發號，避免開打後被 sync 合併
    {
      const seen = new Set<string>();
      let repaired = false;
      const fixed = [...s0.party]
        .sort((a, b) => a.slotIndex - b.slotIndex)
        .map((m) => {
          if (!seen.has(m.id) && !seen.has(m.sheet.id)) {
            seen.add(m.id);
            seen.add(m.sheet.id);
            return m;
          }
          repaired = true;
          const newId = crypto.randomUUID();
          return {
            ...m,
            id: newId,
            sheet: { ...m.sheet, id: newId },
          };
        });
      if (repaired) {
        const playerId =
          fixed.find((m) => m.controller === "player")?.id ??
          s0.playerMemberId;
        set({
          party: fixed,
          playerMemberId: playerId,
          character:
            fixed.find((m) => m.id === playerId)?.sheet ??
            fixed[0]?.sheet ??
            s0.character,
        });
        get().appendSystem(
          "偵測到隊伍成員共用同一角色 ID，已自動為重複席次重新編號。",
        );
      }
    }

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
      const bridgeChoice = get().continuityBridge
        ? normalizeContinuityChoice({
            mode: get().continuityBridge!.mode,
            duration: get().continuityBridge!.duration,
          })
        : null;

      // 自庫帶入：以檔案庫原數值為底重新套用全隊同一銜接（避免重複恢復／模式不一致）
      const continuitySummaries: ContinuityBridgeState["appliedSummaries"] = [];
      let workingParty = get().party.map((m) => {
        if (!m.fromLibrary) return m;
        const lib = getLibraryCharacter(m.sheet.id);
        const base = lib?.sheet ?? m.sheet;
        if (!bridgeChoice) {
          return {
            ...m,
            sheet: {
              ...m.sheet,
              derived: structuredClone(base.derived),
              attributes: { ...base.attributes },
              skills: { ...base.skills },
              appearance: m.sheet.appearance,
              personal_bio: m.sheet.personal_bio,
              inventory: [...m.sheet.inventory],
            },
          };
        }
        const { sheet: recovered, lines } = applyContinuityRecovery(
          base,
          bridgeChoice,
        );
        continuitySummaries.push({
          characterId: recovered.id,
          name: m.sheet.name?.trim() || recovered.name || "角色",
          lines,
        });
        return {
          ...m,
          sheet: {
            ...recovered,
            name: m.sheet.name,
            role_title: m.sheet.role_title,
            appearance: m.sheet.appearance,
            personal_bio: m.sheet.personal_bio,
            inventory: [...m.sheet.inventory],
          },
        };
      });

      if (bridgeChoice && continuitySummaries.length) {
        set({
          continuityBridge: buildContinuityBridgeState(
            bridgeChoice,
            get().script.system_id,
            continuitySummaries,
          ),
          party: workingParty,
        });
      } else {
        set({ party: workingParty });
      }
      workingParty = get().party;

      const sheet =
        workingParty.find((m) => m.controller === "player")?.sheet ??
        workingParty.find((m) => m.id === player.id)?.sheet ??
        player.sheet;

      // CoC 創角硬限制：克蘇魯神話 0；閃避不得低於 DEX/2（保留加點）
      workingParty = workingParty.map((m) => {
        const { sheet: normalized, forcedMythosToZero } =
          normalizeCocCreationSheet(m.sheet);
        if (forcedMythosToZero) {
          get().appendSystem(
            `創角校正「${normalized.name || "角色"}」：克蘇魯神話於開場強制為 0（調查中再成長）。`,
          );
        }
        return { ...m, sheet: normalized };
      });

      const sheetNormalized =
        workingParty.find((m) => m.controller === "player")?.sheet ??
        workingParty.find((m) => m.id === player.id)?.sheet ??
        sheet;

      // 玩家 + 自檔案庫帶入的 AI 隊友皆佔用角色卡（同時僅一場）
      const toBind = workingParty.filter(
        (m) =>
          m.controller === "player" ||
          m.id === player.id ||
          m.fromLibrary === true,
      );
      const bindTargets = new Map<string, (typeof toBind)[0]>();
      for (const m of toBind) {
        bindTargets.set(m.sheet.id, m);
      }
      for (const m of bindTargets.values()) {
        const err = bindCharacterToCampaign(m.sheet, campaignId);
        if (err) {
          get().appendSystem(err);
          get().setSessionError({
            code: "CHARACTER_BUSY",
            message: err,
          });
          return;
        }
      }

      const enriched = recomputeDerived(
        enrichCharacterSheetMeta(sheetNormalized, get().characterSchema),
      );
      bindCharacterToCampaign(enriched, campaignId);

      const party = workingParty.map((m) => {
        if (m.id === player.id || m.controller === "player") {
          return {
            ...m,
            id: enriched.id,
            sheet: enriched,
            controller: "player" as const,
          };
        }
        if (m.fromLibrary) {
          const aiEnriched = recomputeDerived(
            enrichCharacterSheetMeta(m.sheet, get().characterSchema),
          );
          bindCharacterToCampaign(aiEnriched, campaignId);
          return {
            ...m,
            id: aiEnriched.id,
            sheet: aiEnriched,
            controller: "ai" as const,
            fromLibrary: true,
          };
        }
        return { ...m, controller: "ai" as const };
      });

      const bridgeNote =
        get().continuityBridge?.appliedSummaries
          ?.map((s) => `${s.name}（${s.lines.join("；")}）`)
          .join("；") ?? null;

      set({
        phase: "PLAYING",
        character: enriched,
        party,
        playerMemberId: enriched.id,
        viewedPartyMemberId: enriched.id,
        characterBaseline: captureStatSnapshot(enriched, get().madness),
        boundCharacterId: enriched.id,
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
        winProgress: emptyWinProgress(),
        incapacitatedCharacterIds: [],
      });

      if (bridgeNote) {
        get().appendSystem(`幕間銜接已套用：${bridgeNote}`);
      }

      const libAi = party.filter((m) => m.controller === "ai" && m.fromLibrary);
      const newAi = party.filter((m) => m.controller === "ai" && !m.fromLibrary);
      const bits = [
        `角色「${enriched.name}」已存入檔案庫並綁定本場`,
        libAi.length
          ? `另有 ${libAi.length} 名自庫帶入的 AI 隊友（已佔用；結局可選寫回）`
          : null,
        newAi.length
          ? `${newAi.length} 名新建 AI 隊友（結局可選存入）`
          : null,
      ].filter(Boolean);
      get().appendSystem(
        bits.length > 1
          ? `${bits.join("；")}。一角同時僅能進行一場。`
          : `角色「${enriched.name}」已存入檔案庫，並綁定本場冒險。一角同時僅能進行一場。`,
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
        if (!get().sessionError) {
          get().setSessionError({ code, message });
          get().appendSystem(`錯誤：${code} — ${message}`);
        }
      }
    })();
  },

  advanceToCharacterPhase: () => {
    const { script, partySize } = get();
    if (!script.system_id || !script.public_summary) {
      get().appendSystem("請先與 GM 完成劇本設定（setup_script），再進入創角。");
      return;
    }
    set({
      phase: "CHARACTER",
      editingPartySlotIndex: 0,
      continuityBridge: null,
    });
    get().appendSystem(
      partySize > 1
        ? `已確認劇本與房規，進入創角（隊伍 ${partySize} 人）。請為每位完成完整角色卡；各席次均可新建或帶入檔案庫（帶入會佔用該卡，一角同時僅一場；結局可選寫回）。自庫帶入時可設定幕間銜接。僅「我扮演」席次冒險中會自動結算寫回。`
        : "已確認劇本與房規，進入創角階段。可創建新角色，或帶入檔案庫中同系統的角色卡（帶入時可選擇幕間銜接／連續冒險／全新起點）。",
    );
  },

  backToScriptPhase: () => {
    if (get().phase !== "CHARACTER") return;
    set({ phase: "SESSION_0" });
    get().appendSystem(
      "已返回劇本討論。可調整劇本／房規／人數後，再按「前往選擇／創建角色」。已建立的隊伍草稿會保留。",
    );
  },

  applyGrowthResult: (skill, gained, characterId = null) => {
    const targetId = characterId ?? get().playerMemberId;
    get().updateSheetById(targetId, (sheet) => ({
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
      partySize: s.partySize,
      recommendedPartySize: s.recommendedPartySize,
      party: s.party,
      playerMemberId: s.playerMemberId,
      editingPartySlotIndex: s.editingPartySlotIndex,
      endingCompanionsSavedIds: s.endingCompanionsSavedIds,
      endingCompanionsResolved: s.endingCompanionsResolved,
      pendingCompanionHandoff: s.pendingCompanionHandoff,
      continuityBridge: s.continuityBridge,
      viewedPartyMemberId: s.viewedPartyMemberId,
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

    const legacy = partyFromLegacyCharacter(data.character);
    const party =
      data.party && data.party.length > 0 ? data.party : legacy.party;
    const playerMemberId =
      data.playerMemberId ?? legacy.playerMemberId;
    const partySize = clampPartySize(
      data.partySize ??
        data.script.recommended_party_size ??
        legacy.partySize,
    );
    const playerSheet = getPlayerSheet(party, playerMemberId, data.character);

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
      character: playerSheet ?? data.character,
      characterSchema: data.characterSchema,
      characterBaseline: data.characterBaseline ?? null,
      boundCharacterId:
        data.boundCharacterId ?? data.character?.id ?? null,
      partySize,
      recommendedPartySize:
        data.recommendedPartySize ??
        data.script.recommended_party_size ??
        null,
      party,
      playerMemberId,
      editingPartySlotIndex: data.editingPartySlotIndex ?? 0,
      endingCompanionsSavedIds: data.endingCompanionsSavedIds ?? [],
      endingCompanionsResolved: Boolean(
        data.endingCompanionsResolved ??
          (data.endingCompanionsSavedIds?.length ?? 0) > 0,
      ),
      pendingCompanionHandoff: data.pendingCompanionHandoff ?? null,
      continuityBridge: data.continuityBridge ?? null,
      viewedPartyMemberId:
        data.viewedPartyMemberId ?? playerMemberId ?? null,
      clues: data.clues,
      playerNotes: data.playerNotes ?? [],
      winProgress: (() => {
        let progress = (data.clues ?? []).reduce(
          (acc, c) => noteClueForWinProgress(acc, c.title, c.is_key_clue),
          emptyWinProgress(),
        );
        for (const m of messages) {
          if (m.role === "agent") {
            progress = noteNarrativeForWinProgress(progress, m.content);
          }
        }
        return progress;
      })(),
      incapacitatedCharacterIds: [],
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
