import type { ChapterSummary, HistoryLog } from "@/types/game";
import { isNoiseHistoryNarrative } from "@/lib/historyHygiene";

/**
 * 從回合切片建立結構化章節摘要（取代原文截斷拼接）。
 */
export function buildStructuredChapterSummary(
  fromTurn: number,
  toTurn: number,
  slice: HistoryLog[],
): ChapterSummary {
  const real = slice.filter((h) => !isNoiseHistoryNarrative(h.aiNarrative));
  const playerBeats = real
    .map((h) => h.playerInput?.trim())
    .filter(Boolean)
    .slice(0, 6);
  const narrativeBeats = real
    .map((h) => {
      const line = h.aiNarrative.split("\n").find((l) => l.trim()) ?? "";
      return line.replace(/^#+\s*/, "").slice(0, 80);
    })
    .filter(Boolean)
    .slice(0, 8);

  const first = slice[0]?.snapshot;
  const last = slice[slice.length - 1]?.snapshot;
  const clueTitles = (last?.clues ?? []).map((c) => c.title);
  const npcNames = (last?.npcs ?? []).map((n) => n.name);
  const sanBefore = first?.character?.derived?.san?.current;
  const sanAfter = last?.character?.derived?.san?.current;
  const dice = slice
    .filter((h) => h.diceRecord && !h.diceRecord.isSecret)
    .map(
      (h) =>
        `${h.diceRecord!.skillName}→${h.diceRecord!.outcome}(${h.diceRecord!.diceResult})`,
    )
    .slice(0, 8);

  const parts = [
    `Turns ${fromTurn}–${toTurn}`,
    playerBeats.length
      ? `Player: ${playerBeats.join(" / ")}`
      : null,
    narrativeBeats.length
      ? `Scenes: ${narrativeBeats.join(" → ")}`
      : null,
    clueTitles.length ? `Clues: ${clueTitles.join("、")}` : null,
    npcNames.length ? `NPCs: ${npcNames.join("、")}` : null,
    dice.length ? `Checks: ${dice.join("; ")}` : null,
    sanBefore != null && sanAfter != null && sanBefore !== sanAfter
      ? `SAN ${sanBefore}→${sanAfter}`
      : null,
  ].filter(Boolean);

  return {
    fromTurn,
    toTurn,
    summary: parts.join(" | ").slice(0, 900),
  };
}
