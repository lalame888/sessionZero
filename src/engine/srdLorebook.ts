import type { GameSystemID } from "@/types/game";
import cocSrd from "@/data/srd/coc7e.json";
import dndSrd from "@/data/srd/dnd5e.json";

export interface SrdEntry {
  keyword: string;
  aliases?: string[];
  text: string;
}

function getEntries(systemId: GameSystemID | null): SrdEntry[] {
  if (systemId === "COC_7E") return cocSrd as SrdEntry[];
  if (systemId === "DND_5E") return dndSrd as SrdEntry[];
  return [];
}

/** Match [法術: xxx] / [動作: xxx] or plain keyword mentions; return up to 3 entries. */
export function lookupSrdEntries(
  systemId: GameSystemID | null,
  playerText: string,
  limit = 3,
): SrdEntry[] {
  const entries = getEntries(systemId);
  if (!entries.length || !playerText.trim()) return [];

  const bracketMatches = [
    ...playerText.matchAll(/\[(?:法術|動作|技能|規則)\s*[:：]\s*([^\]]+)\]/g),
  ].map((m) => m[1].trim().toLowerCase());

  const hay = playerText.toLowerCase();
  const scored: { entry: SrdEntry; score: number }[] = [];

  for (const entry of entries) {
    const keys = [entry.keyword, ...(entry.aliases ?? [])].map((k) =>
      k.toLowerCase(),
    );
    let score = 0;
    for (const key of keys) {
      if (bracketMatches.some((b) => b.includes(key) || key.includes(b))) {
        score += 10;
      } else if (hay.includes(key)) {
        score += 3;
      }
    }
    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}

export function findSrdByTopic(
  systemId: GameSystemID | null,
  topic: string,
): SrdEntry | undefined {
  const entries = getEntries(systemId);
  const t = topic.toLowerCase();
  return entries.find(
    (e) =>
      e.keyword.toLowerCase().includes(t) ||
      e.aliases?.some((a) => a.toLowerCase().includes(t)) ||
      e.text.toLowerCase().includes(t),
  );
}
