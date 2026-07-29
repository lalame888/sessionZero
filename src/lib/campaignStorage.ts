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
  ScriptState,
  ThemeId,
  UniversalCharacterSheet,
} from "@/types/game";

export interface CampaignMeta {
  id: string;
  title: string;
  systemId: GameSystemID | null;
  phase: GamePhase;
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
  ending: EndingState | null;
  timelineIndex: number | null;
  lastPlayerAction: string;
  composerDraft: string;
}

export interface CampaignIndex {
  activeId: string | null;
  sessions: CampaignMeta[];
}

export interface AgentPrefs {
  selectedProvider: string | null;
  selectedModel: string;
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
  return (
    readJson<CampaignIndex>(INDEX_KEY) ?? { activeId: null, sessions: [] }
  );
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

export function campaignTitleFromState(script: ScriptState, messages: ChatMessage[]): string {
  if (script.public_summary?.title?.trim()) return script.public_summary.title.trim();
  const firstUser = messages.find((m) => m.role === "user")?.content.trim();
  if (firstUser) return firstUser.slice(0, 28) + (firstUser.length > 28 ? "…" : "");
  return "未命名劇本討論";
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
    script: {
      system_id: null,
      public_summary: null,
      hidden_full_script: null,
      recommended_creation_mode: null,
      revealed: false,
    },
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
    ending: null,
    timelineIndex: null,
    lastPlayerAction: "",
    composerDraft: "",
  };
}
