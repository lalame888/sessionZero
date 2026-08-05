import type { GameSystemID, UniversalCharacterSheet } from "@/types/game";

/** 冒險前後數值快照（精簡，供履歷對照） */
export interface CharacterStatSnapshot {
  attributes: Record<string, number>;
  skills: Record<string, number>;
  hp: { current: number; max: number };
  san?: { current: number; max: number };
  mp_or_slots?: { current: number; max: number };
  inventory: string[];
  madnessActive?: boolean;
  madnessName?: string;
}

/** 單場冒險履歷（壓縮，不含完整對話） */
export interface AdventureRecord {
  id: string;
  campaignId: string;
  playedAt: number;
  scenarioTitle: string;
  systemId: GameSystemID;
  endingType: string;
  endingTitle: string;
  /** 可編輯的壓縮摘要 */
  synopsis: string;
  achievements: string[];
  keyCluesFound: string[];
  growthLog: string[];
  statsBefore: CharacterStatSnapshot;
  statsAfter: CharacterStatSnapshot;
}

/** 本機檔案庫角色（可跨劇本重用） */
export interface LibraryCharacter {
  sheet: UniversalCharacterSheet;
  /** 履歷：新 → 舊 */
  career: AdventureRecord[];
  /**
   * 目前進行中的劇本 Session ID。
   * 一角同時只能綁一個冒險；結局結算後清空。
   * 舊資料可能缺此欄 → 視為 null。
   */
  activeCampaignId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 數值對照列（檢視用） */
export interface StatDeltaRow {
  group: "attribute" | "skill" | "derived";
  key: string;
  before: number | string;
  after: number | string;
  changed: boolean;
}
