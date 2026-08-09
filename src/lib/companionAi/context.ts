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
  ScriptState,
  UniversalCharacterSheet,
} from "@/types/game";
import type { PartyMember } from "@/types/party";

export function assembleCompanionAgentPrompt(input: {
  script: ScriptState;
  houseRules: HouseRuleConfig;
  companion: UniversalCharacterSheet;
  party: PartyMember[];
  playerMemberId: string | null;
  clues: ClueItem[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  location: string;
  chapterSummaries: ChapterSummary[];
  recentMessages: ChatMessage[];
  turn: number;
  reason: string;
  situation?: string;
  preferImmediate?: boolean;
}): string {
  const layers: string[] = [];
  layers.push(`[COMPANION AGENT TASK]
You are ${input.companion.name || "隊友"} (${input.companion.role_title || "同伴"}).
GM reason for inviting you: ${input.reason}
${input.situation ? `Situation: ${input.situation}` : ""}
${input.preferImmediate ? "GM hint: prefer_immediate=true (crisis — if you attempt a physical check-worthy action, use handoff=immediate)." : "Default handoff=pause unless you must resolve a crisis attempt right now."}
Call submit_companion_action (with handoff) OR pass_turn (exactly one).`);

  layers.push(`[SESSION — PUBLIC]
Location: ${input.location || "未知"}
Turn: ${input.turn}
Title: ${input.script.public_summary?.title ?? "（未定）"}`);

  const pub = input.script.public_summary;
  if (pub?.background) layers.push(`[PUBLIC BACKGROUND]\n${pub.background}`);

  const hr = houseRulesSummary(input.houseRules);
  if (hr !== "無") layers.push(`[HOUSE RULES]\n${hr}`);

  layers.push(
    `[PARTY]
${input.party
  .map((m) => {
    const tag =
      m.controller === "player" || m.id === input.playerMemberId
        ? "PLAYER"
        : "AI";
    return `- [${tag}] ${m.sheet.name || "未命名"}（${m.sheet.role_title || m.roleHint || "—"}）HP ${m.sheet.derived.hp.current}/${m.sheet.derived.hp.max}`;
  })
  .join("\n")}`,
  );

  const c = input.companion;
  layers.push(`[YOUR SHEET]
Name: ${c.name}
Role: ${c.role_title}
HP: ${c.derived.hp.current}/${c.derived.hp.max}
${c.derived.san ? `SAN: ${c.derived.san.current}/${c.derived.san.max}` : ""}
Attrs: ${Object.entries(c.attributes)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ")}
Skills: ${Object.entries(c.skills)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([k, v]) => `${k} ${v}%`)
    .join("；")}
Inventory: ${c.inventory.join("、") || "無"}
Hooks: ${
    Object.values(c.backstory_hooks).filter(Boolean).slice(0, 4).join(" / ") ||
    "無"
  }`);

  if (input.clues.length) {
    layers.push(
      `[CLUES]\n${input.clues
        .map((x) => `- ${x.title}: ${x.content.slice(0, 80)}`)
        .join("\n")}`,
    );
  }
  if (input.npcs.length) {
    layers.push(
      `[NPCS]\n${input.npcs
        .map((n) => `- ${n.name}（${n.relation}/${n.status}）`)
        .join("\n")}`,
    );
  }
  if (input.chapterSummaries.length) {
    layers.push(
      `[CHAPTERS]\n${formatChapterSummariesForPrompt(input.chapterSummaries)}`,
    );
  }

  const recent = input.recentMessages.slice(-SLIDING_WINDOW);
  if (recent.length) {
    layers.push(
      `[RECENT]\n${recent
        .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
        .join("\n")}`,
    );
  }

  return layers.join("\n\n");
}
