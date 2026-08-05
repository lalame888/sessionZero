import type {
  HiddenFullScript,
  ScenarioNpcPrep,
  ScenarioScene,
} from "@/types/game";

const MAX_EXTRA_SCENES = 2;
const MAX_EXTRA_NPCS = 3;

function haystack(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

function sceneMatches(scene: ScenarioScene, hay: string): boolean {
  const keys = [
    scene.id,
    scene.name,
    ...(scene.clues ?? []),
    ...(scene.dangers ?? []),
    ...(scene.linked_npc_ids ?? []),
  ]
    .join(" ")
    .toLowerCase();
  if (!keys.trim()) return false;
  return keys.split(/\s+/).some((k) => k.length >= 2 && hay.includes(k));
}

function npcMatches(npc: ScenarioNpcPrep, hay: string): boolean {
  const keys = [npc.id, npc.name, npc.role, npc.knows]
    .join(" ")
    .toLowerCase();
  return keys.split(/\s+/).some((k) => k.length >= 2 && hay.includes(k));
}

function formatScene(s: ScenarioScene): string {
  const clues = s.clues?.length ? ` clues=[${s.clues.join("; ")}]` : "";
  const dangers = s.dangers?.length
    ? ` dangers=[${s.dangers.join("; ")}]`
    : "";
  const npcs = s.linked_npc_ids?.length
    ? ` npcs=[${s.linked_npc_ids.join(",")}]`
    : "";
  return `- [${s.id}] ${s.name}: ${s.summary}${clues}${dangers}${npcs}`;
}

function formatNpc(n: ScenarioNpcPrep): string {
  return `- [${n.id}] ${n.name}（${n.role}）動機=${n.motivation}；知情=${n.knows}；對PC=${n.attitude_to_pc}`;
}

/**
 * 按需注入 bible：當前場景全文 + 關鍵詞命中的其餘條目（有上限）。
 * 掃描玩家行動、地點、導演場景 id。
 */
export function formatScenarioBibleOnDemand(
  hidden: HiddenFullScript,
  opts: {
    location?: string;
    playerAction?: string;
    currentSceneId?: string | null;
  },
): string {
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

  const hay = haystack(
    opts.location,
    opts.playerAction,
    opts.currentSceneId,
  );
  const scenes = hidden.scenes ?? [];
  const npcs = hidden.npcs ?? [];

  const current =
    (opts.currentSceneId &&
      scenes.find((s) => s.id === opts.currentSceneId)) ||
    scenes.find((s) => sceneMatches(s, hay)) ||
    null;

  const extraScenes = scenes
    .filter((s) => s.id !== current?.id && sceneMatches(s, hay))
    .slice(0, MAX_EXTRA_SCENES);

  const linkedIds = new Set<string>([
    ...(current?.linked_npc_ids ?? []),
    ...extraScenes.flatMap((s) => s.linked_npc_ids ?? []),
  ]);

  const hitNpcs = npcs.filter(
    (n) => linkedIds.has(n.id) || npcMatches(n, hay),
  );
  const selectedNpcs =
    hitNpcs.length > 0
      ? hitNpcs.slice(0, MAX_EXTRA_NPCS + linkedIds.size)
      : npcs.slice(0, Math.min(2, npcs.length));

  if (current || extraScenes.length || scenes.length) {
    const lines: string[] = [];
    if (current) {
      lines.push(`CURRENT SCENE:\n${formatScene(current)}`);
    }
    if (extraScenes.length) {
      lines.push(
        `Related scenes:\n${extraScenes.map(formatScene).join("\n")}`,
      );
    }
    if (!current && !extraScenes.length && scenes.length) {
      // 無命中時給精簡目錄，避免完全失憶
      lines.push(
        `Scene index (summaries only):\n${scenes
          .map((s) => `- [${s.id}] ${s.name}: ${s.summary}`)
          .join("\n")}`,
      );
    }
    chunks.push(`Scenes:\n${lines.join("\n\n")}`);
  }

  if (selectedNpcs.length) {
    chunks.push(`NPCs (on-demand):\n${selectedNpcs.map(formatNpc).join("\n")}`);
  }

  if (hidden.factions?.length) {
    const factionHay = hay;
    const hitF = hidden.factions.filter((f) => {
      const k = `${f.id} ${f.name} ${f.goal}`.toLowerCase();
      return k.split(/\s+/).some((x) => x.length >= 2 && factionHay.includes(x));
    });
    const list = hitF.length ? hitF : hidden.factions.slice(0, 2);
    chunks.push(
      `Factions:\n${list
        .map(
          (f) =>
            `- [${f.id}] ${f.name}: ${f.goal}${f.methods ? `（${f.methods}）` : ""}`,
        )
        .join("\n")}`,
    );
  }

  return chunks.join("\n\n");
}
