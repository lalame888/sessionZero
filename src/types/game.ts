export type GameSystemID = "COC_7E" | "DND_5E" | "CUSTOM_RPG";

export type GamePhase =
  | "PREFLIGHT"
  | "SESSION_0"
  | "CHARACTER"
  | "PLAYING"
  | "ENDING";

export type ThemeId = "neutral" | "coc" | "dnd";

export interface UniversalCharacterSheet {
  id: string;
  system_id: GameSystemID;
  name: string;
  role_title: string;
  attributes: Record<string, number>;
  attribute_modifiers?: Record<string, number>;
  derived: {
    hp: { current: number; max: number };
    mp_or_slots?: { current: number; max: number };
    san?: { current: number; max: number };
    ac?: number;
    proficiency_bonus?: number;
    dodge?: number;
    /** CoC：移動力 */
    mov?: number;
    /** CoC：體格 */
    build?: number;
    /** CoC：傷害加值字串，如 "0"、"+1D4"、"-1" */
    damage_bonus?: string;
  };
  skills: Record<string, number>;
  /** 技能說明（存入檔案庫／匯出時一併保存，供完整角色卡顯示） */
  skill_descriptions?: Record<string, string>;
  markedSkillsForGrowth?: string[];
  inventory: string[];
  /** 劇情鉤子：信念、重要之人、羈絆、缺點等（id → 回答） */
  backstory_hooks: Record<string, string>;
  /** 鉤子問題全文（id → question），避免完整角色卡只顯示 BO1 等 id */
  backstory_hook_questions?: Record<string, string>;

  /** 共通身分 */
  age?: string;
  gender?: string;
  appearance?: string;
  residence?: string;
  birthplace?: string;
  languages?: string;
  personal_bio?: string;
  wealth?: string;

  /** CoC 專屬 */
  profile_coc?: {
    occupation?: string;
    cash_assets?: string;
  };

  /** D&D 專屬 */
  profile_dnd?: {
    race?: string;
    class_name?: string;
    background?: string;
    alignment?: string;
    speed?: number;
    proficiencies?: string;
    features?: string;
  };
}

export interface HouseRuleConfig {
  preset_rules: string[];
  custom_rules_text: string;
}

export interface ClueItem {
  clue_id: string;
  title: string;
  content: string;
  type: "DOCUMENT" | "PHOTO" | "ITEM_INSPECTION" | "LOCATION_MEMO" | "QUEST_LOG";
  is_key_clue: boolean;
}

/** 冒險中玩家自行新增的關鍵資訊筆記 */
export interface PlayerNote {
  note_id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface MadnessStatus {
  active: boolean;
  type?: "TEMPORARY" | "INDEFINITE" | "PERMANENT";
  name?: string;
  duration_turns?: number;
  effect_description?: string;
}

export interface NPCItem {
  npc_id: string;
  name: string;
  relation: "ALLY" | "NEUTRAL" | "SUSPECT" | "ENEMY";
  status: "ALIVE" | "DEAD" | "MISSING" | "INSANE";
  description: string;
}

export interface HistoryLog {
  turn: number;
  timestamp: number;
  playerInput?: string;
  aiNarrative: string;
  diceRecord?: {
    skillName: string;
    isSecret: boolean;
    diceType: string;
    targetValue?: number;
    diceResult: number;
    outcome: string;
  };
  snapshot: {
    character: UniversalCharacterSheet;
    clues: ClueItem[];
    playerNotes: PlayerNote[];
    npcs: NPCItem[];
    madness?: MadnessStatus;
  };
}

export interface ScriptPublicSummary {
  title: string;
  background: string;
  protagonist_role: string;
  genre: string;
  /** 給玩家的開場鉤子（委託／報導／為何來到此地） */
  player_hook?: string;
  /** 開場前已知的公開事實 */
  known_facts?: string[];
  /** 地理／舞台範圍简述 */
  geography?: string;
}

export interface ScenarioTimelineBeat {
  when: string;
  what: string;
}

export interface ScenarioScene {
  id: string;
  name: string;
  summary: string;
  clues?: string[];
  dangers?: string[];
  linked_npc_ids?: string[];
}

export interface ScenarioNpcPrep {
  id: string;
  name: string;
  role: string;
  appearance?: string;
  motivation: string;
  knows: string;
  attitude_to_pc: string;
}

export interface ScenarioFaction {
  id: string;
  name: string;
  goal: string;
  methods?: string;
}

export interface ScenarioAct {
  name: string;
  summary: string;
}

export interface HiddenFullScript {
  truth_and_secrets: string;
  key_clues: string[];
  winning_condition: string;
  /** 失敗／拖延的後果 */
  failure_consequences?: string;
  /** 時間壓力與事件節點 */
  timeline?: ScenarioTimelineBeat[];
  /** 可探索場景 */
  scenes?: ScenarioScene[];
  /** 重要 NPC 備註 */
  npcs?: ScenarioNpcPrep[];
  /** 長篇用：勢力 */
  factions?: ScenarioFaction[];
  /** SAN／威脅備註 */
  san_and_threats?: string;
  /** 長篇用：幕結構 */
  acts?: ScenarioAct[];
}

/** 劇本規模：影響 setup_script 應產出的深度 */
export type ScenarioScale = "seed" | "oneshot" | "arc";

export interface ScriptState {
  system_id: GameSystemID | null;
  public_summary: ScriptPublicSummary | null;
  hidden_full_script: HiddenFullScript | null;
  recommended_creation_mode: string | null;
  revealed: boolean;
  /** 玩家選擇的劇本規模；舊存檔可能缺此欄 */
  scenario_scale?: ScenarioScale | null;
  /** GM 敘事定調範例（2–4 則；非史實） */
  tone_examples?: string[];
}

/** 近端導演狀態：本場景目標／緊張度（由 narrate_story 可選更新） */
export interface SceneDirectorState {
  currentSceneId: string | null;
  sceneGoal: string;
  tension: "low" | "medium" | "high" | "climax" | string;
  notes: string;
}

export interface ChapterSummary {
  fromTurn: number;
  toTurn: number;
  summary: string;
}

export type CreationMode = "DICE" | "ARRAY" | "POINT_BUY" | "SKILL_ALLOC";

export interface AttributeDef {
  key: string;
  label: string;
  dice_formula?: string;
}

export interface PointBuyConfig {
  budget: number;
  min_score: number;
  max_score: number;
  cost_table?: Record<string, number>;
}

export interface CreationModeConfig {
  point_buy_pool?: number;
  standard_array?: number[];
  /** e.g. EDU*4 */
  occupational_point_formula?: string;
  /** e.g. INT*2 */
  interest_point_formula?: string;
  min_score?: number;
  max_score?: number;
}

export interface RecommendedSkill {
  name: string;
  base_value: number;
  description: string;
  is_occupational?: boolean;
}

export interface BackstoryHookQuestion {
  id: string;
  category: string;
  question: string;
}

export interface CharacterSchemaState {
  system_id: GameSystemID;
  creation_mode: CreationMode | string;
  attribute_defs: AttributeDef[];
  mode_config?: CreationModeConfig;
  standard_array?: number[];
  /** 標準陣列來源：ai＝AI 提供且長度正確；default＝未提供用系統預設；corrected＝AI 長度不符已改預設 */
  standard_array_source?: "ai" | "default" | "corrected";
  point_buy?: PointBuyConfig;
  skill_points?: number;
  recommended_skills: RecommendedSkill[];
  background_questions: BackstoryHookQuestion[];
  starting_inventory?: string[];
  role_title_suggestion?: string;
  mode_instructions?: string;
}

export interface CheckRequest {
  request_id: string;
  check_target_name: string;
  dice_type: string;
  target_value?: number;
  dnd_advantage_mode?: string;
  reason: string;
}

export interface PendingDice {
  request_id: string;
  check_target_name: string;
  dice_type: string;
  target_value?: number;
  /** CoC：角色卡上的完整技能％（用於成功等級與大失敗） */
  skill_value?: number;
  /** CoC：一般 / 困難 / 極限 */
  difficulty?: "regular" | "hard" | "extreme";
  dnd_advantage_mode?: "normal" | "advantage" | "disadvantage" | string;
  reason: string;
  isSecret: boolean;
}

export interface RuleLookupResult {
  rule_topic: string;
  applied_reason: string;
  rule_reference_text: string;
}

export interface EndingState {
  ending_type: string;
  ending_title: string;
  ending_narrative: string;
  achievements: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  turnId?: string;
  timestamp: number;
}

export type PreflightReason =
  | "CHECKING"
  | "NEEDS_INSTALLATION"
  | "NEEDS_APPROVAL"
  | "NO_AVAILABLE_PROVIDER"
  | "READY"
  | "ERROR";

export interface PreflightState {
  ready: boolean;
  reason: PreflightReason;
  provider?: string;
  message?: string;
}

/** 連線／Session 失敗後可重試的動作 */
export type RetryAction =
  | { kind: "opening"; label: string }
  | {
      kind: "player";
      label: string;
      text: string;
      /** 僅本回合送給 LLM 的額外上下文（不寫入對話） */
      extraLayers?: string[];
    };

export interface SessionErrorInfo {
  code: string;
  message: string;
}
