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
import { sanitizePublicGeography } from "@/engine/publicGeography";
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
  /** 當前 phase 已註冊的 app tools（name + 短說明） */
  availableTools?: { name: string; description: string }[];
  toolsetLabel?: string;
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

  const pub = input.script.public_summary;
  const hints = input.script.party_role_hints ?? [];
  const scriptLines: string[] = [
    `Title: ${pub?.title ?? "（未定）"}`,
  ];
  if (pub) {
    scriptLines.push(`Genre: ${clip(pub.genre ?? "", 80) || "—"}`);
    scriptLines.push(
      `Protagonist role: ${clip(pub.protagonist_role ?? "", 160) || "—"}`,
    );
    if (pub.background) {
      scriptLines.push(`Background: ${clip(pub.background, 360)}`);
    }
    if (pub.player_hook) {
      scriptLines.push(`Player hook: ${clip(pub.player_hook, 200)}`);
    }
    if (pub.geography) {
      const geo = sanitizePublicGeography(pub.geography);
      if (geo) scriptLines.push(`Geography: ${clip(geo, 80)}`);
    }
    if (pub.known_facts?.length) {
      scriptLines.push(
        `Known facts: ${pub.known_facts
          .slice(0, 6)
          .map((f) => clip(f, 80))
          .join("；")}`,
      );
    }
  } else {
    scriptLines.push("Public summary: （尚未 setup_script）");
  }
  if (input.script.recommended_creation_mode) {
    scriptLines.push(
      `Recommended creation_mode: ${input.script.recommended_creation_mode}`,
    );
  }
  if (input.script.recommended_party_size != null || hints.length) {
    scriptLines.push(
      `Party design: size=${input.script.recommended_party_size ?? "?"} | hints=${
        hints.length
          ? hints
              .map(
                (h, i) =>
                  `${i + 1}.${clip(h.role_title, 40)}（${clip(h.brief, 80)}）`,
              )
              .join("；")
          : "無"
      }`,
    );
  }

  const toolLines =
    input.availableTools && input.availableTools.length > 0
      ? [
          `Available tools (${input.toolsetLabel ?? "current phase"}; only call these):`,
          ...input.availableTools.map(
            (t) => `- ${t.name}: ${clip(t.description, 100)}`,
          ),
        ]
      : [];

  return [
    "[lookup_game_state]",
    `Turn: ${input.turn} | System: ${input.script.system_id ?? "UNSET"} | Scale: ${input.script.scenario_scale ?? "?"}`,
    ...scriptLines,
    ...toolLines,
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
