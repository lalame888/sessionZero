import type { UniversalCharacterSheet } from "@/types/game";
import { migrateCharacterSheet } from "@/engine/formulas";

const LIBRARY_KEY = "sessionzero.character-library";
const SESSION_ID_KEY = "sessionzero.pedelec-session-id";
const GAME_SAVE_KEY = "sessionzero.game-save";

export function loadCharacterLibrary(): UniversalCharacterSheet[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => migrateCharacterSheet(c));
  } catch {
    return [];
  }
}

export function saveCharacterToLibrary(sheet: UniversalCharacterSheet) {
  const lib = loadCharacterLibrary().filter((c) => c.id !== sheet.id);
  lib.unshift(sheet);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib.slice(0, 30)));
}

export function removeCharacterFromLibrary(id: string) {
  const lib = loadCharacterLibrary().filter((c) => c.id !== id);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

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
