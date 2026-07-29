import { create } from "zustand";
import type { PedelecSessionStatus, ProviderCode } from "@kaoruisaac/pedelec";
import {
  assemblePlayerTurnPrompt,
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
  defaultStandardArray,
  normalizeBackgroundQuestions,
  normalizeCreationMode,
  resolveSkillBaseValue,
} from "@/engine/creation";
import {
  campaignTitleFromState,
  createEmptyCampaignPersist,
  type CampaignPersist,
} from "@/lib/campaignStorage";
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
  PreflightState,
  RuleLookupResult,
  ScriptState,
  ThemeId,
  UniversalCharacterSheet,
} from "@/types/game";
import { COC_HOUSE_PRESETS, DND_HOUSE_PRESETS } from "@/prompts/gmDirectives";
import { getActiveSession } from "@/lib/pedelec/createGameSession";

function snapshotOf(state: {
  character: UniversalCharacterSheet | null;
  clues: ClueItem[];
  npcs: NPCItem[];
  madness: MadnessStatus;
}): HistoryLog["snapshot"] {
  return {
    character: state.character
      ? structuredClone(state.character)
      : createBlankCharacter("COC_7E"),
    clues: structuredClone(state.clues),
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
};

interface GameStore {
  campaignId: string;
  campaignCreatedAt: number;
  phase: GamePhase;
  theme: ThemeId;
  location: string;
  preflight: PreflightState;
  sessionStatus: PedelecSessionStatus | "disconnected";
  selectedProvider: ProviderCode | null;
  selectedModel: string;
  composerDraft: string;
  lastPlayerAction: string;
  showInstallGuide: boolean;
  showSettings: boolean;
  isTyping: boolean;
  secretRollActive: boolean;

  script: ScriptState;
  houseRules: HouseRuleConfig;
  character: UniversalCharacterSheet | null;
  characterSchema: CharacterSchemaState | null;
  clues: ClueItem[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  history: HistoryLog[];
  chapterSummaries: ChapterSummary[];
  turn: number;
  messages: ChatMessage[];
  pendingDice: PendingDice | null;
  pendingRuleLookup: RuleLookupResult | null;
  ending: EndingState | null;
  timelineIndex: number | null;

  diceResolver: ((result: {
    diceResult: number;
    outcome: string;
    detail: string;
    request_id: string;
  }) => void) | null;

  setPreflight: (p: PreflightState) => void;
  setSessionStatus: (s: GameStore["sessionStatus"]) => void;
  setProvider: (p: ProviderCode | null) => void;
  setModel: (m: string) => void;
  setComposerDraft: (v: string) => void;
  setShowInstallGuide: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setIsTyping: (v: boolean) => void;
  setPhase: (p: GamePhase) => void;
  setLocation: (v: string) => void;

  appendMessage: (msg: Omit<ChatMessage, "id" | "timestamp"> & { id?: string }) => string;
  updateMessage: (id: string, content: string) => void;
  appendSystem: (content: string) => void;

  setupScript: (args: {
    system_id: string;
    public_summary: ScriptState["public_summary"];
    hidden_full_script: ScriptState["hidden_full_script"];
    recommended_creation_mode: string;
  }) => void;
  setHouseRules: (rules: HouseRuleConfig) => void;
  togglePresetRule: (rule: string) => void;
  setCharacterSchema: (schema: CharacterSchemaState) => void;
  setCharacter: (sheet: UniversalCharacterSheet) => void;
  updateCharacterField: (
    updater: (sheet: UniversalCharacterSheet) => UniversalCharacterSheet,
  ) => void;
  applyStatChanges: (
    changes: { key: string; change_amount: number; reason: string }[],
    inventory_add?: string[],
    inventory_remove?: string[],
  ) => void;
  markSkillSuccess: (skill_name: string) => void;
  recordClue: (clue: ClueItem) => void;
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
  endGame: (ending: EndingState) => void;
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
  preflight: { ready: false, reason: "CHECKING" },
  sessionStatus: "disconnected",
  selectedProvider: null,
  selectedModel: "",
  composerDraft: "",
  lastPlayerAction: "",
  showInstallGuide: false,
  showSettings: false,
  isTyping: false,
  secretRollActive: false,
  script: initialScript,
  houseRules: { preset_rules: [], custom_rules_text: "" },
  character: null,
  characterSchema: null,
  clues: [],
  npcs: [],
  madness: { active: false },
  history: [],
  chapterSummaries: [],
  turn: 0,
  messages: [],
  pendingDice: null,
  pendingRuleLookup: null,
  ending: null,
  timelineIndex: null,
  diceResolver: null,

  setPreflight: (p) => set({ preflight: p }),
  setSessionStatus: (s) => set({ sessionStatus: s }),
  setProvider: (p) => set({ selectedProvider: p }),
  setModel: (m) => set({ selectedModel: m }),
  setComposerDraft: (v) => set({ composerDraft: v }),
  setShowInstallGuide: (v) => set({ showInstallGuide: v }),
  setShowSettings: (v) => set({ showSettings: v }),
  setIsTyping: (v) => set({ isTyping: v }),
  setPhase: (p) => set({ phase: p }),
  setLocation: (v) => set({ location: v }),
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
    const system_id = args.system_id as GameSystemID;
    const presets =
      system_id === "DND_5E" ? DND_HOUSE_PRESETS : COC_HOUSE_PRESETS;
    set({
      script: {
        system_id,
        public_summary: args.public_summary,
        hidden_full_script: args.hidden_full_script,
        recommended_creation_mode: args.recommended_creation_mode,
        revealed: false,
      },
      theme: themeForSystem(system_id),
      houseRules: {
        preset_rules: [],
        custom_rules_text: get().houseRules.custom_rules_text,
      },
      character: createBlankCharacter(
        system_id === "DND_5E" ? "DND_5E" : "COC_7E",
      ),
    });
    get().appendSystem(
      `劇本已建立／更新：${args.public_summary?.title ?? "未命名"}（${system_id}）。可繼續對話調整設定與房規；確認後再按「下一步」進入創角。可用預設房規：${presets.join("、")}`,
    );
  },

  setHouseRules: (rules) => set({ houseRules: rules }),

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
    const standardArrayFromAI =
      Boolean(schema.mode_config?.standard_array?.length) ||
      Boolean(schema.standard_array?.length);
    const mode_config = {
      ...baseMode,
      ...schema.mode_config,
      standard_array:
        schema.mode_config?.standard_array?.length
          ? schema.mode_config.standard_array
          : schema.standard_array?.length
            ? schema.standard_array
            : baseMode.standard_array,
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
      standard_array_source: standardArrayFromAI ? "ai" : "default",
      standard_array:
        mode_config.standard_array ?? defaultStandardArray(systemId),
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

    const sheet = recomputeDerived({
      ...shell,
      id: prev?.id ?? shell.id,
      name: prev?.name ?? "",
      role_title:
        prev?.role_title || normalized.role_title_suggestion || "",
      attributes: { ...shell.attributes, ...attrs },
      skills,
      inventory:
        normalized.starting_inventory?.length
          ? [...normalized.starting_inventory]
          : [],
      backstory_hooks: prevHooks,
    });

    set({ characterSchema: normalized, character: sheet });
    get().appendSystem(
      `創角規則已就緒（${mode}）。請完成「數值」與「劇情鉤子」雙軌；屬性不可任意手填。`,
    );
  },

  setCharacter: (sheet) =>
    set({ character: migrateCharacterSheet(sheet) }),

  updateCharacterField: (updater) => {
    const current = get().character;
    if (!current) return;
    set({ character: recomputeDerived(updater(current)) });
  },

  applyStatChanges: (changes, inventory_add = [], inventory_remove = []) => {
    const sheet = get().character;
    if (!sheet) return;
    const next = structuredClone(sheet);
    for (const ch of changes) {
      const key = ch.key.toUpperCase();
      if (key === "HP") {
        next.derived.hp.current = Math.max(
          0,
          Math.min(next.derived.hp.max, next.derived.hp.current + ch.change_amount),
        );
      } else if (key === "SAN" && next.derived.san) {
        next.derived.san.current = Math.max(
          0,
          Math.min(next.derived.san.max, next.derived.san.current + ch.change_amount),
        );
      } else if ((key === "MP" || key === "SPELLSLOTS") && next.derived.mp_or_slots) {
        next.derived.mp_or_slots.current = Math.max(
          0,
          Math.min(
            next.derived.mp_or_slots.max,
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
    set({ character: recomputeDerived(next) });
    get().appendSystem(
      `狀態更新：${changes.map((c) => `${c.key}${c.change_amount >= 0 ? "+" : ""}${c.change_amount}（${c.reason}）`).join("；")}`,
    );
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
    get().appendMessage({ role: "agent", content: narrative });
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
    const narratives = [
      ...state.history.map((h) => ({ turn: h.turn, text: h.aiNarrative })),
      { turn, text: partial.aiNarrative },
    ];
    const chapterSummaries = maybeCompressChapters(
      turn,
      narratives,
      state.chapterSummaries,
    );
    set({
      turn,
      history: [...state.history, entry],
      chapterSummaries,
    });
  },

  endGame: (ending) => {
    set((s) => ({
      ending,
      phase: "ENDING",
      script: { ...s.script, revealed: true },
      timelineIndex: s.history.length ? s.history.length - 1 : null,
    }));
    get().appendSystem(`結局：${ending.ending_title}`);
    get().appendMessage({ role: "agent", content: ending.ending_narrative });
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
        return;
      }

      set({
        phase: "PLAYING",
        character: recomputeDerived(sheet),
        // 清掉前面 Session/創角階段的訊息，避免在冒險階段顯示舊內容
        history: [],
        messages: [],
        chapterSummaries: [],
        turn: 0,
        timelineIndex: null,
        lastPlayerAction: "",
      });

      // 避免 StoryLog 在 AI 回覆前顯示歡迎提示
      get().appendSystem("冒險開始中…請稍候 GM 述說開場。");

      const store = get();
      const prompt = assemblePlayerTurnPrompt({
        script: store.script,
        houseRules: store.houseRules,
        character: store.character,
        clues: store.clues,
        npcs: store.npcs,
        madness: store.madness,
        location: store.location,
        chapterSummaries: store.chapterSummaries,
        recentMessages: [],
        playerAction:
          "現在已確認角色卡。請立刻開始劇本並述說故事開場（請呼叫 narrate_story；如需檢定請使用工具，不要先等待玩家輸入）。",
        turn: store.turn,
      });

      await session.sendText(prompt);
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
      "已確認劇本與房規，進入創角階段。可請 AI 產生創角欄位，或自行填寫角色卡。",
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
      script: s.script,
      houseRules: s.houseRules,
      character: s.character,
      characterSchema: s.characterSchema,
      clues: s.clues,
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
    };
  },

  hydrateCampaign: (data) => {
    set({
      campaignId: data.id,
      campaignCreatedAt: data.createdAt,
      phase: data.phase === "PREFLIGHT" ? "SESSION_0" : data.phase,
      theme: data.theme,
      location: data.location,
      script: data.script,
      houseRules: data.houseRules,
      character: data.character,
      characterSchema: data.characterSchema,
      clues: data.clues,
      npcs: data.npcs,
      madness: data.madness,
      history: data.history,
      chapterSummaries: data.chapterSummaries,
      turn: data.turn,
      messages: data.messages,
      ending: data.ending,
      timelineIndex: data.timelineIndex,
      lastPlayerAction: data.lastPlayerAction,
      composerDraft: data.composerDraft,
      pendingDice: null,
      pendingRuleLookup: null,
      diceResolver: null,
      isTyping: false,
      secretRollActive: false,
    });
  },

  startNewCampaign: () => {
    const empty = createEmptyCampaignPersist();
    get().hydrateCampaign(empty);
    return empty;
  },
}));
