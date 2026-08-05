import type { RecommendedSkill, UniversalCharacterSheet } from "@/types/game";

export type PartyMemberController = "player" | "ai";

export interface PartyRoleHint {
  role_title: string;
  brief: string;
}

/** 創角 UI 本地配點狀態（換席／重進編輯時還原） */
export interface CharacterCreationDraft {
  skillSpend?: Record<string, { occ: number; interest: number }>;
  occOverrides?: Record<string, boolean>;
  extraSkills?: RecommendedSkill[];
  assignments?: Record<string, number | "">;
  rolledPool?: number[];
}

export interface PartyMember {
  /** 通常等於 sheet.id */
  id: string;
  sheet: UniversalCharacterSheet;
  controller: PartyMemberController;
  /** GM 建議定位 */
  roleHint?: string;
  /** 創角席次順序 0..n-1 */
  slotIndex: number;
  /** 玩家已按「完成席次／開始冒險」確認過 */
  creationComplete?: boolean;
  /** 技能／屬性配點草稿（與 sheet 數值一併保留） */
  creationDraft?: CharacterCreationDraft;
  /** 自檔案庫帶入（會佔用該卡；結局可選寫回） */
  fromLibrary?: boolean;
}

export const MIN_PARTY_SIZE = 1;
export const MAX_PARTY_SIZE = 4;

export function clampPartySize(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PARTY_SIZE, Math.max(MIN_PARTY_SIZE, Math.round(n)));
}

/** 舊存檔／單人：由單一 character 包成隊伍 */
export function partyFromLegacyCharacter(
  character: UniversalCharacterSheet | null | undefined,
): {
  party: PartyMember[];
  playerMemberId: string | null;
  partySize: number;
} {
  if (!character) {
    return { party: [], playerMemberId: null, partySize: 1 };
  }
  const member: PartyMember = {
    id: character.id,
    sheet: character,
    controller: "player",
    slotIndex: 0,
  };
  return {
    party: [member],
    playerMemberId: character.id,
    partySize: 1,
  };
}

export function getPlayerMember(
  party: PartyMember[],
  playerMemberId: string | null,
): PartyMember | null {
  if (!party.length) return null;
  if (playerMemberId) {
    const hit = party.find((m) => m.id === playerMemberId);
    if (hit) return hit;
  }
  return party.find((m) => m.controller === "player") ?? party[0] ?? null;
}

export function getPlayerSheet(
  party: PartyMember[],
  playerMemberId: string | null,
  fallback: UniversalCharacterSheet | null,
): UniversalCharacterSheet | null {
  return getPlayerMember(party, playerMemberId)?.sheet ?? fallback;
}

export function syncPartySheet(
  party: PartyMember[],
  sheet: UniversalCharacterSheet,
): PartyMember[] {
  return party.map((m) =>
    m.id === sheet.id || m.sheet.id === sheet.id
      ? { ...m, id: sheet.id, sheet }
      : m,
  );
}

export function replacePartySlot(
  party: PartyMember[],
  slotIndex: number,
  member: PartyMember,
): PartyMember[] {
  const next = party.filter((m) => m.slotIndex !== slotIndex);
  next.push({ ...member, slotIndex });
  return next.sort((a, b) => a.slotIndex - b.slotIndex);
}
