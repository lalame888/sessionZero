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
import { lookupSrdEntries } from "@/engine/srdLorebook";

const SLIDING_WINDOW = 10;
const SUMMARIZE_EVERY = 15;

export interface ContextAssemblyInput {
  script: ScriptState;
  houseRules: HouseRuleConfig;
  character: UniversalCharacterSheet | null;
  clues: ClueItem[];
  npcs: NPCItem[];
  madness: MadnessStatus;
  location: string;
  chapterSummaries: ChapterSummary[];
  recentMessages: ChatMessage[];
  playerAction: string;
  turn: number;
}

export function houseRulesSummary(houseRules: HouseRuleConfig): string {
  const parts = [...houseRules.preset_rules];
  if (houseRules.custom_rules_text.trim()) {
    parts.push(houseRules.custom_rules_text.trim());
  }
  return parts.length ? parts.join("; ") : "無";
}

export function buildSootBlock(input: ContextAssemblyInput): string {
  const c = input.character;
  const hp = c ? `${c.derived.hp.current}/${c.derived.hp.max}` : "N/A";
  const san = c?.derived.san
    ? `${c.derived.san.current}/${c.derived.san.max}`
    : "N/A";
  const ac = c?.derived.ac ?? "N/A";
  const slots = c?.derived.mp_or_slots
    ? `${c.derived.mp_or_slots.current}/${c.derived.mp_or_slots.max}`
    : "N/A";
  const inventory = c?.inventory.join(", ") || "無";
  const clues = input.clues.map((x) => x.title).join(", ") || "無";
  const madness = input.madness.active
    ? `${input.madness.type ?? "ACTIVE"}:${input.madness.name ?? ""}`
    : "無";
  const hooks = c?.backstory_hooks
    ? Object.entries(c.backstory_hooks)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ") || "無"
    : "無";

  return `[CURRENT SSOT GAME STATE - DO NOT OVERRIDE]
- Game System: ${input.script.system_id ?? "UNSET"} | Location: ${input.location}
- Player: ${c ? `${c.name} (${c.role_title})` : "尚未創角"} | HP: ${hp} | SAN: ${san} | AC: ${ac} | MP/Slots: ${slots}
- Backstory Hooks (use for madness / inspiration / NPC bonds): [${hooks}]
- Active House Rules: [${houseRulesSummary(input.houseRules)}]
- Active Inventory: [${inventory}]
- Active Quests/Clues: [${clues}]
- Madness: ${madness}
--------------------------------------------------
[User Action]: ${input.playerAction}`;
}

export function assemblePlayerTurnPrompt(input: ContextAssemblyInput): string {
  const layers: string[] = [];

  layers.push(`[SESSION CONTEXT]
Mode: SOLO (exactly 1 PC; NPCs allowed; never create multiple PCs)
System: ${input.script.system_id ?? "pending"}
Public Title: ${input.script.public_summary?.title ?? "（討論中）"}
Genre: ${input.script.public_summary?.genre ?? "（未定）"}`);

  if (input.script.hidden_full_script && !input.script.revealed) {
    layers.push(`[HIDDEN TRUTH — GM ONLY, NEVER REVEAL DIRECTLY]
${input.script.hidden_full_script.truth_and_secrets}
Key clues: ${input.script.hidden_full_script.key_clues.join(" | ")}
Win: ${input.script.hidden_full_script.winning_condition}`);
  }

  const hr = houseRulesSummary(input.houseRules);
  if (hr !== "無") {
    layers.push(`[HOUSE RULES — HIGHEST PRIORITY OVER SRD]
${hr}`);
  }

  const srdHits = lookupSrdEntries(
    input.script.system_id,
    input.playerAction,
  );
  if (srdHits.length) {
    layers.push(
      `[SRD LOREBOOK HITS]\n${srdHits.map((h) => `- [${h.keyword}] ${h.text}`).join("\n")}`,
    );
  }

  if (input.chapterSummaries.length) {
    layers.push(
      `[CHAPTER SUMMARIES]\n${input.chapterSummaries
        .map((s) => `Turns ${s.fromTurn}-${s.toTurn}: ${s.summary}`)
        .join("\n")}`,
    );
  }

  const windowMsgs = input.recentMessages
    .filter((m) => m.role === "user" || m.role === "agent")
    .slice(-SLIDING_WINDOW * 2);
  if (windowMsgs.length) {
    layers.push(
      `[RECENT DIALOGUE]\n${windowMsgs
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n")}`,
    );
  }

  layers.push(buildSootBlock(input));
  return layers.join("\n\n");
}

export function maybeCompressChapters(
  turn: number,
  historyNarratives: { turn: number; text: string }[],
  existing: ChapterSummary[],
): ChapterSummary[] {
  if (turn === 0 || turn % SUMMARIZE_EVERY !== 0) return existing;
  const fromTurn = turn - SUMMARIZE_EVERY + 1;
  const slice = historyNarratives.filter(
    (h) => h.turn >= fromTurn && h.turn <= turn,
  );
  if (!slice.length) return existing;
  const summary = slice
    .map((s) => `T${s.turn}: ${s.text.slice(0, 120)}`)
    .join(" / ")
    .slice(0, 800);
  return [
    ...existing,
    { fromTurn, toTurn: turn, summary: `[Auto Summary] ${summary}` },
  ];
}

export { SLIDING_WINDOW, SUMMARIZE_EVERY };
