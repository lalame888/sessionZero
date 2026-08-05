import type {
  AdventureRecord,
  LibraryCharacter,
} from "@/types/characterLibrary";
import type { UniversalCharacterSheet } from "@/types/game";
import { migrateCharacterSheet } from "@/engine/formulas";

const LIBRARY_KEY = "sessionzero.character-library";
const SESSION_ID_KEY = "sessionzero.pedelec-session-id";
const GAME_SAVE_KEY = "sessionzero.game-save";

function isLibraryCharacter(raw: unknown): raw is LibraryCharacter {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return o.sheet != null && typeof o.sheet === "object";
}

function wrapSheetAsLibrary(sheet: UniversalCharacterSheet): LibraryCharacter {
  const now = Date.now();
  return {
    sheet: migrateCharacterSheet(sheet),
    career: [],
    activeCampaignId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeLibraryEntry(raw: unknown): LibraryCharacter | null {
  try {
    if (isLibraryCharacter(raw)) {
      return {
        sheet: migrateCharacterSheet(raw.sheet),
        career: Array.isArray(raw.career) ? raw.career : [],
        activeCampaignId:
          typeof raw.activeCampaignId === "string"
            ? raw.activeCampaignId
            : null,
        createdAt:
          typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        updatedAt:
          typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      };
    }
    // 舊版：純 UniversalCharacterSheet
    if (raw && typeof raw === "object" && "system_id" in (raw as object)) {
      return wrapSheetAsLibrary(raw as UniversalCharacterSheet);
    }
  } catch {
    return null;
  }
  return null;
}

export function loadLibraryCharacters(): LibraryCharacter[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    const list = parsed
      .map(normalizeLibraryEntry)
      .filter((c): c is LibraryCharacter => c != null);
    // 載入時順便清掉「已有履歷仍標記進行中」的卡住綁定
    let dirty = false;
    const healed = list.map((entry) => {
      const active = entry.activeCampaignId;
      if (!active) return entry;
      if (!entry.career.some((r) => r.campaignId === active)) return entry;
      dirty = true;
      return { ...entry, activeCampaignId: null, updatedAt: Date.now() };
    });
    if (dirty) persistLibrary(healed);
    return healed;
  } catch {
    return [];
  }
}

/** @deprecated 相容舊呼叫：回傳 sheet 陣列 */
export function loadCharacterLibrary(): UniversalCharacterSheet[] {
  return loadLibraryCharacters().map((c) => c.sheet);
}

export function getLibraryCharacter(id: string): LibraryCharacter | null {
  return loadLibraryCharacters().find((c) => c.sheet.id === id) ?? null;
}

function persistLibrary(list: LibraryCharacter[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(list.slice(0, 40)));
}

/** 覆寫／新增完整 LibraryCharacter（依 sheet.id） */
export function upsertLibraryCharacter(entry: LibraryCharacter) {
  const lib = loadLibraryCharacters().filter(
    (c) => c.sheet.id !== entry.sheet.id,
  );
  lib.unshift({
    ...entry,
    sheet: migrateCharacterSheet(entry.sheet),
    activeCampaignId: entry.activeCampaignId ?? null,
    updatedAt: Date.now(),
  });
  persistLibrary(lib);
}

/**
 * 只更新角色卡數值，保留既有履歷與進行中綁定（創角中途／冒險中同步用）。
 */
export function saveCharacterToLibrary(sheet: UniversalCharacterSheet) {
  const existing = getLibraryCharacter(sheet.id);
  upsertLibraryCharacter({
    sheet: migrateCharacterSheet(sheet),
    career: existing?.career ?? [],
    activeCampaignId: existing?.activeCampaignId ?? null,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

/**
 * 開始冒險：寫入／更新角色卡，並標記進行中的 Session。
 * 若角色已綁定其他 Session，回傳錯誤字串。
 */
export function bindCharacterToCampaign(
  sheet: UniversalCharacterSheet,
  campaignId: string,
): string | null {
  const existing = getLibraryCharacter(sheet.id);
  let busy = existing?.activeCampaignId ?? null;
  // 已結算仍殘留標記：先清掉再綁
  if (
    busy &&
    busy !== campaignId &&
    existing?.career.some((r) => r.campaignId === busy)
  ) {
    clearCharacterActiveCampaign(sheet.id);
    busy = null;
  }
  if (busy && busy !== campaignId) {
    return `角色「${sheet.name || "未命名"}」正在其他冒險中，無法同時進行兩場。請先完成或刪除該 Session。`;
  }
  const fresh = getLibraryCharacter(sheet.id) ?? existing;
  upsertLibraryCharacter({
    sheet: migrateCharacterSheet(sheet),
    career: fresh?.career ?? [],
    activeCampaignId: campaignId,
    createdAt: fresh?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  return null;
}

/** 清空角色的進行中 Session 標記（刪除劇本／結局後） */
export function clearCharacterActiveCampaign(characterId: string) {
  const existing = getLibraryCharacter(characterId);
  if (!existing) return;
  if (!existing.activeCampaignId) return;
  upsertLibraryCharacter({
    ...existing,
    activeCampaignId: null,
  });
}

/** 冒險進行中同步最新數值到檔案庫（不改寫綁定狀態） */
export function syncLibraryCharacterSheet(
  sheet: UniversalCharacterSheet,
  campaignId: string,
) {
  const existing = getLibraryCharacter(sheet.id);
  if (!existing) return;
  // 已解除綁定：禁止在結局頁 persist 時重新綁上
  if (!existing.activeCampaignId) return;
  if (existing.activeCampaignId !== campaignId) return;
  upsertLibraryCharacter({
    ...existing,
    sheet: migrateCharacterSheet(sheet),
    activeCampaignId: existing.activeCampaignId,
  });
}

/**
 * 清理過期的進行中標記：
 * 若該 Session 已寫入履歷（已結算存檔），視為冒險結束，解除綁定。
 * 修正「已結算仍無法帶入新劇本」的卡住狀態。
 */
export function healStaleActiveCampaignBindings(): number {
  const list = loadLibraryCharacters();
  let fixed = 0;
  for (const entry of list) {
    const active = entry.activeCampaignId;
    if (!active) continue;
    const settled = entry.career.some((r) => r.campaignId === active);
    if (!settled) continue;
    upsertLibraryCharacter({
      ...entry,
      activeCampaignId: null,
    });
    fixed++;
  }
  return fixed;
}

/**
 * 結局結算：寫入最新 sheet + 履歷，並解除進行中綁定。
 */
export function saveLibraryCharacterWithAdventure(
  sheet: UniversalCharacterSheet,
  record: AdventureRecord,
) {
  const existing = getLibraryCharacter(sheet.id);
  const prior = (existing?.career ?? []).filter(
    (r) => r.campaignId !== record.campaignId,
  );
  upsertLibraryCharacter({
    sheet: migrateCharacterSheet(sheet),
    career: [record, ...prior],
    activeCampaignId: null,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

export function removeCharacterFromLibrary(id: string) {
  persistLibrary(loadLibraryCharacters().filter((c) => c.sheet.id !== id));
}

export function exportLibraryCharacterJson(entry: LibraryCharacter) {
  const blob = new Blob([JSON.stringify(entry, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${entry.sheet.name || "character"}-dossier.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 匯出純角色卡（相容舊流程） */
export function exportCharacterJson(sheet: UniversalCharacterSheet) {
  const blob = new Blob([JSON.stringify(sheet, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sheet.name || "character"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 解析匯入：LibraryCharacter 或純 sheet */
export function parseImportedCharacter(raw: unknown): LibraryCharacter | null {
  return normalizeLibraryEntry(raw);
}

export type ImportLibraryResult =
  | { ok: true; entry: LibraryCharacter; overwritten: boolean }
  | { ok: false; reason: "invalid"; message: string }
  | {
      ok: false;
      reason: "duplicate";
      existingName: string;
      entry: LibraryCharacter;
    };

/**
 * 將解析後的角色寫入檔案庫。
 * 同 ID 且未指定 overwrite 時回傳 duplicate，不寫入。
 * 匯入時清除 activeCampaignId，避免他機／舊 Session 綁定殘留。
 */
export function commitImportedLibraryCharacter(
  entry: LibraryCharacter,
  options?: { overwrite?: boolean },
): ImportLibraryResult {
  const id = entry.sheet?.id?.trim();
  if (!id) {
    return {
      ok: false,
      reason: "invalid",
      message: "檔案缺少角色 ID，無法匯入。",
    };
  }
  if (!entry.sheet.name?.trim() && !entry.sheet.system_id) {
    return {
      ok: false,
      reason: "invalid",
      message: "檔案格式不正確，無法辨識為角色卡。",
    };
  }

  const existing = getLibraryCharacter(id);
  if (existing && !options?.overwrite) {
    return {
      ok: false,
      reason: "duplicate",
      existingName: existing.sheet.name?.trim() || "（未命名）",
      entry,
    };
  }

  const next: LibraryCharacter = {
    sheet: migrateCharacterSheet({ ...entry.sheet, id }),
    career: Array.isArray(entry.career) ? entry.career : [],
    activeCampaignId: null,
    createdAt: existing?.createdAt ?? entry.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  upsertLibraryCharacter(next);
  return { ok: true, entry: next, overwritten: Boolean(existing) };
}

/** 從 JSON 字串解析並準備匯入（尚未寫入；遇 duplicate 需再呼叫 commit） */
export function prepareLibraryImportFromJsonText(
  text: string,
): ImportLibraryResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: "invalid",
      message: "無法解析 JSON，請確認檔案內容。",
    };
  }
  const entry = parseImportedCharacter(raw);
  if (!entry) {
    return {
      ok: false,
      reason: "invalid",
      message: "檔案格式不符（需為履歷 JSON 或角色卡）。",
    };
  }
  return commitImportedLibraryCharacter(entry, { overwrite: false });
}

export function persistPedelecSessionId(id: string | null) {
  if (!id) localStorage.removeItem(SESSION_ID_KEY);
  else localStorage.setItem(SESSION_ID_KEY, id);
}

export function loadPedelecSessionId(): string | null {
  return localStorage.getItem(SESSION_ID_KEY);
}

export function saveGameSnapshot(data: unknown) {
  localStorage.setItem(GAME_SAVE_KEY, JSON.stringify(data));
}

export function loadGameSnapshot<T>(): T | null {
  try {
    const raw = localStorage.getItem(GAME_SAVE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
