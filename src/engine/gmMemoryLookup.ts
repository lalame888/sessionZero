import {
  formatChapterSummariesForPrompt,
  houseRulesSummary,
  SLIDING_WINDOW,
} from "@/engine/contextAssembler";
import type {
  ChapterSummary,
  ChatMessage,
  ClueItem,
  HouseRuleConfig,
  MadnessStatus,
  NPCItem,
  SceneDirectorState,
  ScriptState,
  UniversalCharacterSheet,
} from "@/types/game";
import type { PartyMember } from "@/types/party";
import { isNoiseHistoryNarrative } from "@/lib/historyHygiene";
import { looksLikeLeakedToolCall } from "@/lib/pedelec/leakedToolCall";

const HISTORY_LINE_MAX = 280;

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function formatLookupGameState(input: {
  script: ScriptState;
  houseRules: HouseRuleConfig;
  character: UniversalCharacterSheet | null;
  clues: ClueItem[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  location: string;
  turn: number;
  sceneDirector?: SceneDirectorState | null;
  party?: PartyMember[];
  playerMemberId?: string | null;
  incapacitatedCharacterIds?: string[];
}): string {
  const c = input.character;
  const hp = c ? `${c.derived.hp.current}/${c.derived.hp.max}` : "N/A";
  const san = c?.derived.san
    ? `${c.derived.san.current}/${c.derived.san.max}`
    : "N/A";
  const party =
    input.party?.map((m) => {
      const tag =
        m.controller === "player" || m.id === input.playerMemberId
          ? "PLAYER"
          : "AI";
      return `${tag}:${m.sheet.name || "未命名"}(id=${m.id}) HP ${m.sheet.derived.hp.current}/${m.sheet.derived.hp.max}`;
    }) ?? [];
  const scene = input.sceneDirector?.currentSceneId
    ? `scene_id=${input.sceneDirector.currentSceneId}`
    : "scene_id=（未標）";
  const incap = (input.incapacitatedCharacterIds ?? []).join(", ") || "無";

  return [
    "[lookup_game_state]",
    `Turn: ${input.turn} | System: ${input.script.system_id ?? "UNSET"} | Scale: ${input.script.scenario_scale ?? "?"}`,
    `Title: ${input.script.public_summary?.title ?? "（未定）"}`,
    `Location: ${input.location || "未知"} | ${scene}`,
    `Tension: ${input.sceneDirector?.tension ?? "?"} | Goal: ${clip(input.sceneDirector?.sceneGoal ?? "", 160) || "—"}`,
    `Player: ${c ? `${c.name} id=${c.id}` : "尚未創角"} | HP ${hp} | SAN ${san}`,
    `Inventory: ${c?.inventory.join(", ") || "無"}`,
    `Clues: ${input.clues.map((x) => x.title).join("、") || "無"}`,
    `Known NPCs: ${input.npcs.map((n) => `${n.name}(${n.status})`).join("、") || "無"}`,
    `Madness: ${input.madness.active ? `${input.madness.type ?? "ACTIVE"}:${input.madness.name ?? ""}` : "無"}`,
    `House rules: ${houseRulesSummary(input.houseRules)}`,
    `Party: ${party.join("; ") || "無"}`,
    `Incapacitated: ${incap}`,
  ].join("\n");
}

export function formatLookupHistory(input: {
  chapterSummaries: ChapterSummary[];
  recentMessages: ChatMessage[];
  scope?: "chapters" | "recent" | "both";
  query?: string;
  limit?: number;
}): string {
  const scope = input.scope ?? "both";
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const q = (input.query ?? "").trim().toLowerCase();
  const chunks: string[] = ["[lookup_history]"];

  if (scope === "chapters" || scope === "both") {
    let chapters = input.chapterSummaries;
    if (q) {
      chapters = chapters.filter((s) =>
        `${s.fromTurn} ${s.toTurn} ${s.summary}`.toLowerCase().includes(q),
      );
    }
    const text = formatChapterSummariesForPrompt(chapters.slice(-limit));
    chunks.push(
      text
        ? `Chapters:\n${text}`
        : "Chapters: （無摘要；局尚短或尚未壓縮）",
    );
  }

  if (scope === "recent" || scope === "both") {
    let msgs = input.recentMessages
      .filter((m) => m.role === "user" || m.role === "agent")
      .filter((m) => !looksLikeLeakedToolCall(m.content))
      .filter((m) => !isNoiseHistoryNarrative(m.content));
    if (q) {
      msgs = msgs.filter((m) => m.content.toLowerCase().includes(q));
    }
    msgs = msgs.slice(-Math.min(limit, SLIDING_WINDOW * 2));
    chunks.push(
      msgs.length
        ? `Recent:\n${msgs
            .map((m) => `${m.role.toUpperCase()}: ${clip(m.content, HISTORY_LINE_MAX)}`)
            .join("\n")}`
        : "Recent: （無）",
    );
  }

  return chunks.join("\n\n");
}
