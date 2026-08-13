import type { ScriptState, UniversalCharacterSheet } from "@/types/game";

export function assembleCompanionAgentPrompt(input: {
  script: ScriptState;
  companion: UniversalCharacterSheet;
  location: string;
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
${handoffHint(input)}`);

  layers.push(`[SESSION — STUB]
Location: ${input.location || "未知"} | Turn: ${input.turn}
Title: ${input.script.public_summary?.title ?? "（未定）"}`);

  layers.push(`[CONTEXT — USE TOOLS]
You do NOT receive full game state in this message.
Before deciding, call lookup_game_state (public clues, NPCs, notes, party, your sheet).
If you need continuity, call lookup_history (chapters / recent dialogue).
Then call exactly ONE terminal tool: submit_companion_action OR pass_turn.`);

  return layers.join("\n\n");
}

function handoffHint(input: { preferImmediate?: boolean }): string {
  return input.preferImmediate
    ? "GM hint: prefer_immediate=true (crisis — if you attempt a physical check-worthy action, use handoff=immediate)."
    : "Default handoff=pause unless you must resolve a crisis attempt right now.";
}
