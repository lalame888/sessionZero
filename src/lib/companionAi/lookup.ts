import { houseRulesSummary } from "@/engine/contextAssembler";
import { formatLookupHistory } from "@/engine/gmMemoryLookup";
import type {
  ChapterSummary,
  ChatMessage,
  ClueItem,
  HouseRuleConfig,
  NPCItem,
  PlayerNote,
  SceneDirectorState,
  ScriptState,
  UniversalCharacterSheet,
} from "@/types/game";
import { getPlayerMember, type PartyMember } from "@/types/party";

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** 隊友 lookup：僅公開資訊，與玩家視角一致（不含 hidden bible）。 */
export function formatCompanionLookupGameState(input: {
  script: ScriptState;
  houseRules: HouseRuleConfig;
  companionId: string;
  party: PartyMember[];
  playerMemberId: string | null;
  clues: ClueItem[];
  npcs: NPCItem[];
  playerNotes: PlayerNote[];
  location: string;
  turn: number;
  sceneDirector?: SceneDirectorState | null;
  focus?: string;
}): string {
  const companionMember = input.party.find(
    (m) => m.id === input.companionId || m.sheet.id === input.companionId,
  );
  const companion = companionMember?.sheet ?? null;
  const playerMember = getPlayerMember(input.party, input.playerMemberId);
  const player = playerMember?.sheet ?? null;

  const pub = input.script.public_summary;
  const scriptLines: string[] = [
    `Title: ${pub?.title ?? "（未定）"}`,
    `Genre: ${clip(pub?.genre ?? "", 80) || "—"}`,
  ];
  if (pub?.background) {
    scriptLines.push(`Background: ${pub.background.trim()}`);
  }
  if (pub?.protagonist_role) {
    scriptLines.push(`Protagonist role: ${pub.protagonist_role.trim()}`);
  }
  if (pub?.player_hook) {
    scriptLines.push(`Player hook: ${pub.player_hook.trim()}`);
  }
  if (pub?.geography) {
    scriptLines.push(`Geography: ${pub.geography.trim()}`);
  }
  if (pub?.known_facts?.length) {
    scriptLines.push(
      `Known facts:\n${pub.known_facts.map((f) => `- ${f}`).join("\n")}`,
    );
  }

  const partyLines = input.party.map((m) => {
    const tag =
      m.controller === "player" || m.id === input.playerMemberId
        ? "PLAYER"
        : "AI";
    const self = m.id === input.companionId ? " ← YOU" : "";
    return `- [${tag}] ${m.sheet.name || "未命名"}（${m.sheet.role_title || m.roleHint || "—"}）HP ${m.sheet.derived.hp.current}/${m.sheet.derived.hp.max}${self}`;
  });

  const clueLines = input.clues.length
    ? input.clues
        .map((c) => {
          const key = c.is_key_clue ? "★" : "·";
          return `${key} ${c.title}\n  ${c.content}`;
        })
        .join("\n")
    : "尚無";

  const npcLines = input.npcs.length
    ? input.npcs
        .map(
          (n) =>
            `- ${n.name}（${n.relation}/${n.status}）\n  ${n.description}`,
        )
        .join("\n")
    : "尚無公開登記";

  const noteLines = input.playerNotes.length
    ? input.playerNotes.map((n) => `· ${n.title}\n  ${n.content}`).join("\n")
    : "尚無";

  const companionSheet = companion
    ? formatCompanionSheetDetail(companion)
    : "（找不到本席角色卡）";

  const scene = input.sceneDirector?.currentSceneId
    ? `scene_id=${input.sceneDirector.currentSceneId}`
    : "scene_id=（未標）";

  const chunks = [
    "[lookup_game_state — COMPANION PUBLIC VIEW]",
    input.focus ? `Focus note: ${input.focus}` : null,
    `Turn: ${input.turn} | System: ${input.script.system_id ?? "UNSET"}`,
    `Location: ${input.location || "未知"} | ${scene}`,
    `Scene tension: ${input.sceneDirector?.tension ?? "?"} | Goal: ${clip(input.sceneDirector?.sceneGoal ?? "", 200) || "—"}`,
    `[PUBLIC SCRIPT]\n${scriptLines.join("\n")}`,
    `[PARTY]\n${partyLines.join("\n") || "無"}`,
    `[HUMAN PC]\n${player ? `${player.name}（${player.role_title}）HP ${player.derived.hp.current}/${player.derived.hp.max}` : "未知"}`,
    `[YOUR SHEET]\n${companionSheet}`,
    `[DISCOVERED CLUES]\n${clueLines}`,
    `[KNOWN NPCS]\n${npcLines}`,
    `[PLAYER NOTES]\n${noteLines}`,
    `[HOUSE RULES]\n${houseRulesSummary(input.houseRules)}`,
  ].filter(Boolean);

  return chunks.join("\n\n");
}

function formatCompanionSheetDetail(c: UniversalCharacterSheet): string {
  const san = c.derived.san
    ? `SAN ${c.derived.san.current}/${c.derived.san.max}`
    : "";
  const skills = Object.entries(c.skills)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}%`)
    .join("；");
  const hooks = Object.entries(c.backstory_hooks)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return [
    `Name: ${c.name} | Role: ${c.role_title}`,
    `HP ${c.derived.hp.current}/${c.derived.hp.max}${san ? ` | ${san}` : ""}`,
    `Attrs: ${Object.entries(c.attributes)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ")}`,
    `Skills: ${skills || "無"}`,
    `Inventory: ${c.inventory.join("、") || "無"}`,
    hooks ? `Hooks:\n${hooks}` : "Hooks: （無）",
  ].join("\n");
}

export function formatCompanionLookupHistory(input: {
  chapterSummaries: ChapterSummary[];
  recentMessages: ChatMessage[];
  scope?: "chapters" | "recent" | "both";
  query?: string;
  limit?: number;
}): string {
  return formatLookupHistory(input);
}
