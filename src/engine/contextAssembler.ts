import type {
  ChapterSummary,
  ChatMessage,
  ClueItem,
  HiddenFullScript,
  HouseRuleConfig,
  MadnessStatus,
  NPCItem,
  ScriptState,
  UniversalCharacterSheet,
} from "@/types/game";
import { lookupSrdEntries } from "@/engine/srdLorebook";
import {
  normalizeScenarioScale,
  scenarioScaleRequirements,
} from "@/engine/scenarioScale";

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
  /** 是否請 GM 在敘事後提供行動建議；預設 true */
  suggestPlayerActions?: boolean;
  /** 額外上下文層（不會寫入對話紀錄，僅本回合送給 LLM） */
  extraLayers?: string[];
}

export function houseRulesSummary(houseRules: HouseRuleConfig): string {
  const parts = [...houseRules.preset_rules];
  if (houseRules.custom_rules_text.trim()) {
    parts.push(houseRules.custom_rules_text.trim());
  }
  return parts.length ? parts.join("; ") : "無";
}

function formatScenarioBible(hidden: HiddenFullScript): string {
  const chunks: string[] = [];
  chunks.push(`Truth: ${hidden.truth_and_secrets}`);
  chunks.push(`Win: ${hidden.winning_condition}`);
  if (hidden.failure_consequences) {
    chunks.push(`Failure: ${hidden.failure_consequences}`);
  }
  if (hidden.san_and_threats) {
    chunks.push(`SAN/Threats: ${hidden.san_and_threats}`);
  }
  if (hidden.key_clues?.length) {
    chunks.push(`Key clues: ${hidden.key_clues.join(" | ")}`);
  }
  if (hidden.acts?.length) {
    chunks.push(
      `Acts:\n${hidden.acts.map((a) => `- ${a.name}: ${a.summary}`).join("\n")}`,
    );
  }
  if (hidden.timeline?.length) {
    chunks.push(
      `Timeline:\n${hidden.timeline.map((t) => `- ${t.when}: ${t.what}`).join("\n")}`,
    );
  }
  if (hidden.scenes?.length) {
    chunks.push(
      `Scenes:\n${hidden.scenes
        .map((s) => {
          const clues = s.clues?.length ? ` clues=[${s.clues.join("; ")}]` : "";
          const dangers = s.dangers?.length
            ? ` dangers=[${s.dangers.join("; ")}]`
            : "";
          const npcs = s.linked_npc_ids?.length
            ? ` npcs=[${s.linked_npc_ids.join(",")}]`
            : "";
          return `- [${s.id}] ${s.name}: ${s.summary}${clues}${dangers}${npcs}`;
        })
        .join("\n")}`,
    );
  }
  if (hidden.npcs?.length) {
    chunks.push(
      `NPCs:\n${hidden.npcs
        .map(
          (n) =>
            `- [${n.id}] ${n.name}（${n.role}）動機=${n.motivation}；知情=${n.knows}；對PC=${n.attitude_to_pc}`,
        )
        .join("\n")}`,
    );
  }
  if (hidden.factions?.length) {
    chunks.push(
      `Factions:\n${hidden.factions
        .map(
          (f) =>
            `- [${f.id}] ${f.name}: ${f.goal}${f.methods ? `（${f.methods}）` : ""}`,
        )
        .join("\n")}`,
    );
  }
  return chunks.join("\n\n");
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

  const identityBits: string[] = [];
  if (c) {
    if (c.age?.trim()) identityBits.push(`Age ${c.age.trim()}`);
    if (c.gender?.trim()) identityBits.push(c.gender.trim());
    if (c.appearance?.trim()) identityBits.push(`Look: ${c.appearance.trim()}`);
    if (c.residence?.trim()) identityBits.push(`Lives: ${c.residence.trim()}`);
    if (c.birthplace?.trim())
      identityBits.push(`Born: ${c.birthplace.trim()}`);
    if (c.languages?.trim()) identityBits.push(`Lang: ${c.languages.trim()}`);
    if (c.wealth?.trim()) identityBits.push(`Wealth: ${c.wealth.trim()}`);
    if (c.personal_bio?.trim())
      identityBits.push(`Bio: ${c.personal_bio.trim()}`);
    if (c.system_id === "COC_7E") {
      if (c.profile_coc?.occupation?.trim())
        identityBits.push(`Occupation: ${c.profile_coc.occupation.trim()}`);
      if (c.profile_coc?.cash_assets?.trim())
        identityBits.push(`Cash/Assets: ${c.profile_coc.cash_assets.trim()}`);
      if (c.skills["信用評級"] != null)
        identityBits.push(`Credit Rating: ${c.skills["信用評級"]}%`);
      if (c.derived.mov != null) identityBits.push(`MOV ${c.derived.mov}`);
      if (c.derived.build != null) identityBits.push(`Build ${c.derived.build}`);
      if (c.derived.damage_bonus)
        identityBits.push(`DB ${c.derived.damage_bonus}`);
    }
    if (c.system_id === "DND_5E" && c.profile_dnd) {
      const d = c.profile_dnd;
      const raceClass = [d.race, d.class_name]
        .map((x) => x?.trim())
        .filter(Boolean)
        .join(" ");
      if (raceClass) identityBits.push(raceClass);
      if (d.background?.trim())
        identityBits.push(`Background: ${d.background.trim()}`);
      if (d.alignment?.trim())
        identityBits.push(`Alignment: ${d.alignment.trim()}`);
      if (d.speed != null) identityBits.push(`Speed ${d.speed}`);
      if (d.proficiencies?.trim())
        identityBits.push(`Prof: ${d.proficiencies.trim()}`);
      if (d.features?.trim())
        identityBits.push(`Features: ${d.features.trim()}`);
    }
  }
  const identity = identityBits.length ? identityBits.join(" | ") : "無";

  const attributes = c?.attributes
    ? Object.entries(c.attributes)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ") || "無"
    : "無";
  const skills = c?.skills
    ? Object.entries(c.skills)
        .map(([k, v]) => `${k} ${v}%`)
        .join(", ") || "無"
    : "無";

  return `[CURRENT SSOT GAME STATE - DO NOT OVERRIDE]
- Game System: ${input.script.system_id ?? "UNSET"} | Location: ${input.location}
- Player: ${c ? `${c.name} (${c.role_title})` : "尚未創角"} | HP: ${hp} | SAN: ${san} | AC: ${ac} | MP/Slots: ${slots}
- Identity (narrate with these; do NOT invent contradicting sheet facts): [${identity}]
- Attributes: [${attributes}]
- Skills (prefer these exact names for check_target_name; if none fit, MUST supply target_value): [${skills}]
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
Scenario scale: ${normalizeScenarioScale(input.script.scenario_scale)}
Public Title: ${input.script.public_summary?.title ?? "（討論中）"}
Genre: ${input.script.public_summary?.genre ?? "（未定）"}`);

  // Session 0 尚未定稿時，提醒 AI 依規模填 setup_script
  if (!input.script.public_summary) {
    layers.push(
      scenarioScaleRequirements(
        normalizeScenarioScale(input.script.scenario_scale),
      ),
    );
  }

  if (input.extraLayers?.length) {
    layers.push(...input.extraLayers.filter((l) => l.trim().length > 0));
  }

  if (input.script.public_summary?.player_hook) {
    layers.push(`[PLAYER HOOK]\n${input.script.public_summary.player_hook}`);
  }
  if (input.script.public_summary?.geography) {
    layers.push(`[GEOGRAPHY]\n${input.script.public_summary.geography}`);
  }
  if (input.script.public_summary?.known_facts?.length) {
    layers.push(
      `[KNOWN FACTS]\n${input.script.public_summary.known_facts.map((f) => `- ${f}`).join("\n")}`,
    );
  }

  if (input.script.hidden_full_script && !input.script.revealed) {
    const hidden = input.script.hidden_full_script;
    const hasBible =
      (hidden.scenes?.length ?? 0) > 0 ||
      (hidden.npcs?.length ?? 0) > 0 ||
      (hidden.timeline?.length ?? 0) > 0;
    layers.push(
      hasBible
        ? `[SCENARIO BIBLE — GM ONLY, NEVER REVEAL DIRECTLY]\n${formatScenarioBible(hidden)}`
        : `[HIDDEN TRUTH — GM ONLY, NEVER REVEAL DIRECTLY]
${hidden.truth_and_secrets}
Key clues: ${hidden.key_clues.join(" | ")}
Win: ${hidden.winning_condition}`,
    );
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

  const suggest = input.suggestPlayerActions !== false;
  layers.push(
    suggest
      ? `[PLAYER UX PREFS — MANDATORY]
Suggest player actions: ON
After this turn's narration (and tools), end with a Traditional Chinese block:

你可以：
- **短標題**：一句具體可執行的下一步
- （共 2–4 項，貼近當下場景；勿替玩家做決定）`
      : `[PLAYER UX PREFS — MANDATORY]
Suggest player actions: OFF
Do NOT provide「你可以：」、行動選項清單、或多重選擇式下一步建議。只敘事並等待玩家自由輸入。`,
  );

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
