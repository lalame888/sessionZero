import type { ContinuityBridgeState } from "@/engine/continuityBridge";
import type { CharacterStatSnapshot } from "@/types/characterLibrary";
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
  PlayerNote,
  ScenarioScale,
  SceneDirectorState,
  ScriptState,
  ThemeId,
  UniversalCharacterSheet,
} from "@/types/game";
import type { PartyMember, PendingCompanionHandoff } from "@/types/party";
import { normalizeScenarioScale } from "@/engine/scenarioScale";
import { clearPartyLibraryBindingsForCampaign } from "@/lib/storage";

export interface CampaignMeta {
  id: string;
  title: string;
  systemId: GameSystemID | null;
  phase: GamePhase;
  /** 劇本規模；舊索引可能缺此欄 */
  scenarioScale?: ScenarioScale | null;
  /** 進行中主角（檔案庫角色）ID；舊索引可能缺 */
  boundCharacterId?: string | null;
  /** 進行中主角名稱（列表顯示用） */
  boundCharacterName?: string | null;
  /** 隊伍人數（1–4）；舊索引可能缺 */
  partySize?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignPersist {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  phase: GamePhase;
  theme: ThemeId;
  location: string;
  /** 近端導演狀態；舊存檔可能缺 */
  sceneDirector?: SceneDirectorState;
  script: ScriptState;
  houseRules: HouseRuleConfig;
  character: UniversalCharacterSheet | null;
  characterSchema: CharacterSchemaState | null;
  /** 冒險開始時角色數值快照（結局履歷對照）；舊存檔可能缺 */
  characterBaseline?: CharacterStatSnapshot | null;
  /** 綁定的檔案庫角色 ID（與 LibraryCharacter.sheet.id 雙向） */
  boundCharacterId?: string | null;
  clues: ClueItem[];
  /** 玩家自行新增的關鍵資訊筆記；舊存檔可能缺此欄 */
  playerNotes?: PlayerNote[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  history: HistoryLog[];
  chapterSummaries: ChapterSummary[];
  turn: number;
  messages: ChatMessage[];
  ending: EndingState | null;
  timelineIndex: number | null;
  lastPlayerAction: string;
  composerDraft: string;
  /** 冒險進行時是否請 GM 在敘事後提供可採取行動建議 */
  suggestPlayerActions: boolean;
  /**
   * 結局頁已完成角色成長／儲存。
   * 為 true 時再進入結算頁會略過結算步驟，直接上帝視角與回放。
   * 舊存檔可能缺此欄；亦可由檔案庫履歷（同 campaignId）推得。
   */
  endingCharacterSettled?: boolean;
  /** 玩家確認的隊伍人數（1–4）；舊存檔缺則視為 1 */
  partySize?: number;
  /** GM 建議人數 */
  recommendedPartySize?: number | null;
  /** 隊伍成員（含 AI 隊友）；舊存檔缺則由 character 遷移 */
  party?: PartyMember[];
  /** 玩家操控成員 id */
  playerMemberId?: string | null;
  /** 創角中正在編輯的席次 */
  editingPartySlotIndex?: number;
  /** 結局已選擇存入角色庫的 AI 隊友 id */
  endingCompanionsSavedIds?: string[];
  /** 結局已處理完 AI 隊友檔案庫選擇（含全部略過） */
  endingCompanionsResolved?: boolean;
  /** 隊友宣告後軟停手遞（重整後可繼續） */
  pendingCompanionHandoff?: PendingCompanionHandoff | null;
  /** 自庫帶入的幕間銜接（全隊共用）；舊存檔可能缺 */
  continuityBridge?: ContinuityBridgeState | null;
  /** 側欄目前檢視的隊伍成員 id（預設玩家） */
  viewedPartyMemberId?: string | null;
}

export interface CampaignIndex {
  activeId: string | null;
  sessions: CampaignMeta[];
}

export interface AgentPrefs {
  selectedProvider: string | null;
  selectedModel: string;
  suggestPlayerActions?: boolean;
  scenarioScale?: import("@/types/game").ScenarioScale;
}

const INDEX_KEY = "sessionzero.campaigns.index";
const campaignKey = (id: string) => `sessionzero.campaigns.${id}`;
const PREFS_KEY = "sessionzero.agent-prefs";

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadCampaignIndex(): CampaignIndex {
  const index =
    readJson<CampaignIndex>(INDEX_KEY) ?? { activeId: null, sessions: [] };
  // 舊索引缺欄位時，從完整存檔回填一次
  let changed = false;
  const sessions = index.sessions.map((meta) => {
    let next = meta;
    const needsScale = !next.scenarioScale;
    const needsBound = next.boundCharacterName === undefined;
    const needsParty = next.partySize == null;
    if (!needsScale && !needsBound && !needsParty) return next;
    const full = loadCampaign(meta.id);
    if (!full) return next;
    if (needsScale && full.script?.scenario_scale) {
      changed = true;
      next = {
        ...next,
        scenarioScale: normalizeScenarioScale(full.script.scenario_scale),
      };
    }
    if (needsBound) {
      changed = true;
      next = {
        ...next,
        boundCharacterId:
          full.boundCharacterId ?? full.character?.id ?? null,
        boundCharacterName: full.character?.name?.trim() || null,
      };
    }
    if (needsParty) {
      changed = true;
      const size =
        full.partySize ??
        (full.party?.length && full.party.length > 0
          ? full.party.length
          : 1);
      next = { ...next, partySize: size };
    }
    return next;
  });
  if (changed) {
    const nextIndex = { ...index, sessions };
    saveCampaignIndex(nextIndex);
    return nextIndex;
  }
  return index;
}

export function saveCampaignIndex(index: CampaignIndex) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function loadCampaign(id: string): CampaignPersist | null {
  return readJson<CampaignPersist>(campaignKey(id));
}

export function saveCampaign(data: CampaignPersist) {
  localStorage.setItem(campaignKey(data.id), JSON.stringify(data));
  const index = loadCampaignIndex();
  const meta: CampaignMeta = {
    id: data.id,
    title: data.title,
    systemId: data.script.system_id,
    phase: data.phase === "PREFLIGHT" ? "SESSION_0" : data.phase,
    scenarioScale: data.script.scenario_scale
      ? normalizeScenarioScale(data.script.scenario_scale)
      : null,
    boundCharacterId: data.boundCharacterId ?? null,
    boundCharacterName: data.character?.name?.trim() || null,
    partySize: data.partySize ?? data.party?.length ?? 1,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
  const without = index.sessions.filter((s) => s.id !== data.id);
  saveCampaignIndex({
    activeId: data.id,
    sessions: [meta, ...without].sort((a, b) => b.updatedAt - a.updatedAt),
  });
}

export function deleteCampaign(id: string) {
  const full = loadCampaign(id);
  const ids: string[] = [];
  const primary = full?.boundCharacterId ?? full?.character?.id ?? null;
  if (primary) ids.push(primary);
  for (const m of full?.party ?? []) {
    if (m.fromLibrary || m.controller === "player") {
      ids.push(m.sheet?.id ?? m.id);
    }
  }
  clearPartyLibraryBindingsForCampaign(id, ids);
  localStorage.removeItem(campaignKey(id));
  const index = loadCampaignIndex();
  const sessions = index.sessions.filter((s) => s.id !== id);
  saveCampaignIndex({
    activeId: index.activeId === id ? (sessions[0]?.id ?? null) : index.activeId,
    sessions,
  });
}

export function setActiveCampaignId(id: string | null) {
  const index = loadCampaignIndex();
  saveCampaignIndex({ ...index, activeId: id });
}

export function loadAgentPrefs(): AgentPrefs {
  return (
    readJson<AgentPrefs>(PREFS_KEY) ?? {
      selectedProvider: null,
      selectedModel: "",
    }
  );
}

export function saveAgentPrefs(prefs: AgentPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** 從 Zustand 當前狀態寫入 agent 偏好（Provider／Model 等） */
export function persistAgentPrefsFromStore(input: {
  selectedProvider: string | null;
  selectedModel: string;
  suggestPlayerActions: boolean;
  scenarioScale?: ScenarioScale | string | null;
}) {
  saveAgentPrefs({
    selectedProvider: input.selectedProvider,
    selectedModel: input.selectedModel,
    suggestPlayerActions: input.suggestPlayerActions,
    scenarioScale: normalizeScenarioScale(input.scenarioScale),
  });
}

export function campaignTitleFromState(script: ScriptState, messages: ChatMessage[]): string {
  if (script.public_summary?.title?.trim()) return script.public_summary.title.trim();
  const firstUser = messages.find((m) => m.role === "user")?.content.trim();
  if (firstUser) return firstUser.slice(0, 28) + (firstUser.length > 28 ? "…" : "");
  return "未命名劇本討論";
}

/** Session 0、尚未選定系統／劇本、也沒有任何玩家或 GM 討論內容 */
export function isBlankCampaign(data: CampaignPersist): boolean {
  const phase = data.phase === "PREFLIGHT" ? "SESSION_0" : data.phase;
  if (phase !== "SESSION_0") return false;
  if (data.script.system_id) return false;
  if (data.script.public_summary) return false;
  if (data.script.hidden_full_script) return false;
  if (data.characterSchema) return false;
  if (data.character) return false;
  if (data.history.length > 0) return false;
  if (data.turn > 0) return false;
  if (data.clues.length > 0 || data.npcs.length > 0) return false;
  if (data.ending) return false;
  const hasDiscussion = data.messages.some(
    (m) => m.role === "user" || m.role === "agent",
  );
  return !hasDiscussion;
}

/** 找出一個可重用的空白 Session（優先較新的） */
export function findBlankCampaignId(): string | null {
  const index = loadCampaignIndex();
  for (const meta of index.sessions) {
    if (meta.phase !== "SESSION_0" && meta.phase !== "PREFLIGHT") continue;
    if (meta.systemId) continue;
    const data = loadCampaign(meta.id);
    if (data && isBlankCampaign(data)) return meta.id;
  }
  return null;
}

/** 僅劇本設計摘要（不含遊玩紀錄），供 AI 避免重複劇情 */
export interface PriorScriptDesign {
  id: string;
  title: string;
  updatedAt: number;
  system_id: ScriptState["system_id"];
  scenario_scale: ScenarioScale | null;
  public_summary: ScriptState["public_summary"];
  hidden_full_script: ScriptState["hidden_full_script"];
}

/**
 * 依更新時間取最近 N 個「已有劇本設計」的 Session。
 * 只回傳 script 公開摘要／隱藏真相等設計欄位，不含對話與遊玩紀錄。
 */
export function loadRecentScriptDesigns(
  limit = 10,
  opts?: { excludeId?: string | null },
): PriorScriptDesign[] {
  const index = loadCampaignIndex();
  const out: PriorScriptDesign[] = [];
  for (const meta of index.sessions) {
    if (opts?.excludeId && meta.id === opts.excludeId) continue;
    const data = loadCampaign(meta.id);
    if (!data) continue;
    const { script } = data;
    // 至少要有公開摘要或隱藏劇本，才算「既有劇本設計」
    if (!script.public_summary && !script.hidden_full_script) continue;
    out.push({
      id: data.id,
      title:
        script.public_summary?.title?.trim() ||
        data.title ||
        "未命名劇本",
      updatedAt: data.updatedAt,
      system_id: script.system_id,
      scenario_scale: script.scenario_scale
        ? normalizeScenarioScale(script.scenario_scale)
        : null,
      public_summary: script.public_summary,
      hidden_full_script: script.hidden_full_script,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function createEmptyCampaignPersist(id = crypto.randomUUID()): CampaignPersist {
  const now = Date.now();
  return {
    id,
    title: "未命名劇本討論",
    createdAt: now,
    updatedAt: now,
    phase: "SESSION_0",
    theme: "neutral",
    location: "未知之地",
    sceneDirector: {
      currentSceneId: null,
      sceneGoal: "",
      tension: "medium",
      notes: "",
    },
    script: {
      system_id: null,
      public_summary: null,
      hidden_full_script: null,
      recommended_creation_mode: null,
      revealed: false,
      scenario_scale: "oneshot",
    },
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
    ending: null,
    timelineIndex: null,
    lastPlayerAction: "",
    composerDraft: "",
    suggestPlayerActions: true,
    endingCharacterSettled: false,
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
  };
}
