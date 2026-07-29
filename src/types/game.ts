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
  };
  skills: Record<string, number>;
  markedSkillsForGrowth?: string[];
  inventory: string[];
  /** 劇情鉤子：信念、重要之人、羈絆、缺點等 */
  backstory_hooks: Record<string, string>;
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
    npcs: NPCItem[];
    madness?: MadnessStatus;
  };
}

export interface ScriptPublicSummary {
  title: string;
  background: string;
  protagonist_role: string;
  genre: string;
}

export interface HiddenFullScript {
  truth_and_secrets: string;
  key_clues: string[];
  winning_condition: string;
}

export interface ScriptState {
  system_id: GameSystemID | null;
  public_summary: ScriptPublicSummary | null;
  hidden_full_script: HiddenFullScript | null;
  recommended_creation_mode: string | null;
  revealed: boolean;
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
  /** 標準陣列來源：AI 未提供時，前端會用系統預設補齊 */
  standard_array_source?: "ai" | "default";
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
