import {
  formatChapterSummariesForPrompt,
  houseRulesSummary,
  SLIDING_WINDOW,
} from "@/engine/contextAssembler";
import { normalizeScenarioScale } from "@/engine/scenarioScale";
import type {
  ChapterSummary,
  ChatMessage,
  ClueItem,
  HouseRuleConfig,
  MadnessStatus,
  NPCItem,
  PlayerNote,
  ScriptState,
  UniversalCharacterSheet,
} from "@/types/game";

export interface PlayerAgentContextInput {
  script: ScriptState;
  houseRules: HouseRuleConfig;
  character: UniversalCharacterSheet | null;
  clues: ClueItem[];
  playerNotes: PlayerNote[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  location: string;
  chapterSummaries: ChapterSummary[];
  recentMessages: ChatMessage[];
  turn: number;
}

/** 組裝僅含公開資訊的 Player Agent prompt（絕不含 hidden bible）。 */
export function assemblePlayerAgentPrompt(
  input: PlayerAgentContextInput,
): string {
  const layers: string[] = [];

  layers.push(`[PLAYER AGENT TASK]
Decide the PC's next action for this turn.
Call submit_player_action once. Do not narrate GM outcomes.`);

  layers.push(`[SESSION — PUBLIC]
Mode: SOLO (1 PC)
System: ${input.script.system_id ?? "pending"}
Scenario scale: ${normalizeScenarioScale(input.script.scenario_scale)}
Turn: ${input.turn}
Location: ${input.location || "未知"}
Title: ${input.script.public_summary?.title ?? "（未定）"}
Genre: ${input.script.public_summary?.genre ?? "（未定）"}`);

  const pub = input.script.public_summary;
  if (pub?.background) {
    layers.push(`[PUBLIC BACKGROUND]\n${pub.background}`);
  }
  if (pub?.protagonist_role) {
    layers.push(`[PROTAGONIST ROLE]\n${pub.protagonist_role}`);
  }
  if (pub?.player_hook) {
    layers.push(`[PLAYER HOOK]\n${pub.player_hook}`);
  }
  if (pub?.geography) {
    layers.push(`[GEOGRAPHY]\n${pub.geography}`);
  }
  if (pub?.known_facts?.length) {
    layers.push(
      `[KNOWN FACTS]\n${pub.known_facts.map((f) => `- ${f}`).join("\n")}`,
    );
  }

  const hr = houseRulesSummary(input.houseRules);
  if (hr !== "無") {
    layers.push(`[HOUSE RULES]\n${hr}`);
  }

  if (input.chapterSummaries.length) {
    layers.push(
      `[CHAPTER SUMMARIES]\n${formatChapterSummariesForPrompt(input.chapterSummaries)}`,
    );
  }

  const windowMsgs = input.recentMessages
    .filter((m) => m.role === "user" || m.role === "agent")
    .slice(-SLIDING_WINDOW * 2);
  if (windowMsgs.length) {
    layers.push(
      `[RECENT DIALOGUE]\n${windowMsgs
        .map((m) => `${m.role === "user" ? "PLAYER" : "GM"}: ${m.content}`)
        .join("\n")}`,
    );
  }

  layers.push(formatPlayerSheetBlock(input));
  layers.push(formatCluesBlock(input.clues));
  layers.push(formatNotesBlock(input.playerNotes));
  layers.push(formatNpcsBlock(input.npcs));

  layers.push(`[OUTPUT]
Call submit_player_action with one concrete Traditional Chinese action.`);

  return layers.join("\n\n");
}

function formatPlayerSheetBlock(input: PlayerAgentContextInput): string {
  const c = input.character;
  if (!c) {
    return `[PC SHEET]\n尚未創角 — 不可行動。`;
  }

  const hp = `${c.derived.hp.current}/${c.derived.hp.max}`;
  const san = c.derived.san
    ? `${c.derived.san.current}/${c.derived.san.max}`
    : "N/A";
  const slots = c.derived.mp_or_slots
    ? `${c.derived.mp_or_slots.current}/${c.derived.mp_or_slots.max}`
    : "N/A";
  const inventory = c.inventory.length ? c.inventory.join("、") : "無";

  const topSkills = Object.entries(c.skills)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, v]) => `${name} ${v}`)
    .join("、");

  const attrs = Object.entries(c.attributes)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");

  const madness = input.madness.active
    ? `${input.madness.type ?? "ACTIVE"} ${input.madness.name ?? ""} — ${input.madness.effect_description ?? ""}`
    : "無";

  const hooks = Object.entries(c.backstory_hooks)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => {
      const q = c.backstory_hook_questions?.[k];
      return `- ${q ?? k}: ${v}`;
    })
    .join("\n");

  return `[PC SHEET]
- Name: ${c.name}（${c.role_title}）
- Attrs: ${attrs || "無"}
- HP: ${hp} | SAN: ${san} | MP/Slots: ${slots} | AC: ${c.derived.ac ?? "N/A"}
- Key skills: ${topSkills || "無"}
- Inventory: ${inventory}
- Madness: ${madness}
- Hooks:
${hooks || "（無）"}`;
}

function formatCluesBlock(clues: ClueItem[]): string {
  if (!clues.length) return `[DISCOVERED CLUES]\n尚無`;
  return `[DISCOVERED CLUES]
${clues
  .map((c) => {
    const key = c.is_key_clue ? "★" : "·";
    return `${key} ${c.title}\n  ${c.content}`;
  })
  .join("\n")}`;
}

function formatNotesBlock(notes: PlayerNote[]): string {
  if (!notes.length) return `[PLAYER NOTES]\n尚無`;
  return `[PLAYER NOTES]
${notes.map((n) => `· ${n.title}\n  ${n.content}`).join("\n")}`;
}

function formatNpcsBlock(npcs: NPCItem[]): string {
  if (!npcs.length) return `[KNOWN NPCS]\n尚無公開登記`;
  return `[KNOWN NPCS]
${npcs
  .map(
    (n) =>
      `· ${n.name}（${n.relation}/${n.status}）— ${n.description}`,
  )
  .join("\n")}`;
}
