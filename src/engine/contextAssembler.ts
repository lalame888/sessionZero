import type {
  ChapterSummary,
  ChatMessage,
  ClueItem,
  HistoryLog,
  HouseRuleConfig,
  MadnessStatus,
  NPCItem,
  SceneDirectorState,
  ScriptState,
  UniversalCharacterSheet,
} from "@/types/game";
import type { PartyMember } from "@/types/party";
import { buildCompanionMentionDirective } from "@/engine/companionTrigger";
import { formatPartyRosterForGm } from "@/engine/partyNarrativeBrief";
import { buildStructuredChapterSummary } from "@/engine/chapterSummary";
import { lookupSrdEntries } from "@/engine/srdLorebook";
import {
  SCENARIO_BIBLE_ASSET_PATH,
  SCENARIO_BIBLE_READ_HINT,
} from "@/lib/pedelec/sessionAssets";
import { isNoiseHistoryNarrative } from "@/lib/historyHygiene";
import { looksLikeLeakedToolCall } from "@/lib/pedelec/leakedToolCall";
import {
  normalizeScenarioScale,
  scenarioScaleRequirements,
} from "@/engine/scenarioScale";

const SLIDING_WINDOW = 8;
const SUMMARIZE_EVERY = 15;
/** 單則對話進 prompt 的硬上限，避免 agy -p 命令列過長 */
const DIALOGUE_LINE_MAX = 480;

function truncateDialogueContent(text: string, max = DIALOGUE_LINE_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

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
  /** 近端導演狀態 */
  sceneDirector?: SceneDirectorState | null;
  party?: PartyMember[];
  playerMemberId?: string | null;
  /** 自庫帶入的幕間銜接前提（開場必注入） */
  continuityPremiseZh?: string | null;
}

export function houseRulesSummary(houseRules: HouseRuleConfig): string {
  const parts = [...houseRules.preset_rules];
  if (houseRules.custom_rules_text.trim()) {
    parts.push(houseRules.custom_rules_text.trim());
  }
  return parts.length ? parts.join("; ") : "無";
}

function buildSceneDirectorBlock(
  input: ContextAssemblyInput,
): string | null {
  const d = input.sceneDirector;
  const scenes = input.script.hidden_full_script?.scenes ?? [];
  const scene =
    (d?.currentSceneId &&
      scenes.find((s) => s.id === d.currentSceneId)) ||
    scenes.find((s) =>
      input.location &&
      (s.name.includes(input.location) ||
        input.location.includes(s.name)),
    ) ||
    null;

  const goal =
    d?.sceneGoal?.trim() ||
    scene?.summary ||
    input.script.public_summary?.player_hook ||
    "";
  const tension = d?.tension?.trim() || "medium";
  const notes = d?.notes?.trim() || "";
  const hooks = input.character?.backstory_hooks
    ? Object.entries(input.character.backstory_hooks)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => `${k}:${v}`)
        .slice(0, 4)
        .join(" | ")
    : "";

  if (!goal && !scene && !notes) return null;

  return `[SCENE DIRECTOR — NEAR CONTEXT, OBEY]
- Current scene: ${scene ? `[${scene.id}] ${scene.name}` : d?.currentSceneId || "（未標）"}
- Location SSOT: ${input.location}
- Scene goal / pressure: ${goal || "（推進調查或當下威脅；失敗須改變場面）"}
- Tension: ${tension}
${notes ? `- Director notes: ${notes}\n` : ""}- NEVER speak/decide for the PC. Pause for player agency.
- Check economy: no SAN loss for social/info failures; avoid isomorphic re-rolls; prefer NPC/document beats.
${hooks ? `- Hook callbacks available: ${hooks}` : ""}`;
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

  const partyLine =
    input.party && input.party.length
      ? input.party
          .map((m) => {
            const tag =
              m.controller === "player" || m.id === input.playerMemberId
                ? "PLAYER"
                : "AI";
            const role =
              m.sheet.role_title?.trim() || m.roleHint?.trim() || "";
            return `${tag}:${m.sheet.name || "未命名"}${role ? `(${role})` : ""}(id=${m.id})`;
          })
          .join("; ")
      : c
        ? `PLAYER:${c.name}(id=${c.id})`
        : "無";

  const partyRoster =
    input.party && input.party.length > 1
      ? `\n${formatPartyRosterForGm(input.party, input.playerMemberId)}`
      : "";

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
- Player: ${c ? `${c.name} (${c.role_title}) id=${c.id}` : "尚未創角"} | HP: ${hp} | SAN: ${san} | AC: ${ac} | MP/Slots: ${slots}
- Party size: ${input.party?.length ?? (c ? 1 : 0)} | Quick ids: [${partyLine}]
- Identity (narrate with these; do NOT invent contradicting sheet facts): [${identity}]
- Attributes: [${attributes}]
- Skills (prefer these exact names for check_target_name; if none fit, MUST supply target_value): [${skills}]
- Backstory Hooks (use for madness / inspiration / NPC bonds): [${hooks}]
- Active House Rules: [${houseRulesSummary(input.houseRules)}]
- Active Inventory: [${inventory}]
- Active Quests/Clues: [${clues}]
- Known NPCs: [${input.npcs.map((n) => n.name).join(", ") || "無"}]
- Madness: ${madness}${partyRoster}
--------------------------------------------------
[User Action]: ${input.playerAction}`;
}

export function assemblePlayerTurnPrompt(input: ContextAssemblyInput): string {
  const layers: string[] = [];

  layers.push(`[SESSION CONTEXT]
Mode: SOLO+PARTY (1 human PC + optional AI companion PCs; never multiple human players)
System: ${input.script.system_id ?? "pending"}
Scenario scale: ${normalizeScenarioScale(input.script.scenario_scale)}
Public Title: ${input.script.public_summary?.title ?? "（討論中）"}
Genre: ${input.script.public_summary?.genre ?? "（未定）"}`);

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

  if (input.continuityPremiseZh?.trim()) {
    layers.push(input.continuityPremiseZh.trim());
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

  if (input.script.tone_examples?.length) {
    layers.push(
      `[TONE EXAMPLES — STYLE ONLY, NOT CANON HISTORY]\n${input.script.tone_examples
        .map((ex, i) => `(${i + 1}) ${ex}`)
        .join("\n")}`,
    );
  }

  if (input.script.hidden_full_script && !input.script.revealed) {
    layers.push(
      `[SCENARIO BIBLE FILE — GM ONLY]
${SCENARIO_BIBLE_READ_HINT}
Do not re-print the file contents into player-facing narration.
Path: ${SCENARIO_BIBLE_ASSET_PATH}`,
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
    .filter((m) => !looksLikeLeakedToolCall(m.content))
    .filter((m) => !isNoiseHistoryNarrative(m.content))
    .slice(-SLIDING_WINDOW * 2);
  if (windowMsgs.length) {
    layers.push(
      `[RECENT DIALOGUE]\n${windowMsgs
        .map(
          (m) =>
            `${m.role.toUpperCase()}: ${truncateDialogueContent(m.content)}`,
        )
        .join("\n")}`,
    );
  }

  const director = buildSceneDirectorBlock(input);
  if (director) layers.push(director);

  layers.push(buildSootBlock(input));

  const companionTrigger = buildCompanionMentionDirective(
    input.playerAction,
    input.party ?? [],
    input.playerMemberId,
  );
  if (companionTrigger) layers.push(companionTrigger);

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
Do NOT provide「你可以：」、行動選項清單、或多重選擇式下一步建議。
Do NOT write fourth-wall UI prompts (e.g.「請輸入您的下一步行動」「請於輸入框輸入」). End in-fiction only; wait silently for player input.`,
  );

  return layers.join("\n\n");
}

export function maybeCompressChapters(
  turn: number,
  historyEntries: HistoryLog[] | { turn: number; text: string }[],
  existing: ChapterSummary[],
): ChapterSummary[] {
  if (turn === 0 || turn % SUMMARIZE_EVERY !== 0) return existing;
  const fromTurn = turn - SUMMARIZE_EVERY + 1;

  // 新路徑：完整 HistoryLog
  if (
    historyEntries.length &&
    "aiNarrative" in (historyEntries[0] as HistoryLog)
  ) {
    const logs = historyEntries as HistoryLog[];
    const slice = logs.filter((h) => h.turn >= fromTurn && h.turn <= turn);
    if (!slice.length) return existing;
    const summary = buildStructuredChapterSummary(fromTurn, turn, slice);
    return [...existing, summary];
  }

  // 舊相容：僅 narrative 字串
  const slice = (historyEntries as { turn: number; text: string }[]).filter(
    (h) =>
      h.turn >= fromTurn &&
      h.turn <= turn &&
      !isNoiseHistoryNarrative(h.text),
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
