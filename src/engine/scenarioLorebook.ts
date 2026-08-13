import type {
  HiddenFullScript,
  ScenarioCreature,
  ScenarioNpcPrep,
  ScenarioScene,
} from "@/types/game";

const MAX_EXTRA_SCENES = 2;
const MAX_EXTRA_NPCS = 3;
const MAX_EXTRA_CREATURES = 4;

function haystack(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join("\n").toLowerCase();
}

/** GM-only win memo — never quote to the player. */
export function formatWinAdjudication(winningCondition: string): string {
  const w = winningCondition.trim();
  return [
    `[GM-ONLY ADJUDICATE — never quote to player] Win: ${w}`,
    "If Win is OR and the player substantially completed one branch, allow escape / end_game_session — do not upgrade OR into AND.",
  ].join("\n");
}

/**
 * 把 GM 自創的 scene_id（如 s02_inn_lobby）對回 bible 既有 id（s02_inn）。
 */
export function resolveCanonicalSceneId(
  scenes: ScenarioScene[] | undefined | null,
  requested?: string | null,
  location?: string | null,
): string | null {
  if (!scenes?.length) return requested?.trim() || null;
  const raw = (requested ?? "").trim();
  if (raw) {
    const exact = scenes.find((s) => s.id === raw);
    if (exact) return exact.id;
    const prefixHits = scenes.filter(
      (s) =>
        raw === s.id ||
        raw.startsWith(`${s.id}_`) ||
        raw.startsWith(s.id) ||
        s.id.startsWith(raw),
    );
    prefixHits.sort((a, b) => b.id.length - a.id.length);
    if (prefixHits[0]) return prefixHits[0].id;
    const byName = scenes.find(
      (s) => raw.includes(s.name) || s.name.includes(raw),
    );
    if (byName) return byName.id;
  }
  const loc = (location ?? "").trim();
  if (loc) {
    const byLoc = scenes.find(
      (s) => loc.includes(s.name) || s.name.includes(loc),
    );
    if (byLoc) return byLoc.id;
  }
  // 自創 id（如 scene_salt_mine_cell）不要寫進 SSOT
  return null;
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

function creatureMatches(c: ScenarioCreature, hay: string): boolean {
  const keys = [
    c.id,
    c.name,
    c.kind,
    c.linked_npc_id,
    c.combat_notes,
    c.powers,
    ...(c.attacks?.map((a) => a.name) ?? []),
  ]
    .filter(Boolean)
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

function formatCreature(c: ScenarioCreature): string {
  const attrs = c.attributes
    ? Object.entries(c.attributes)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}${v}`)
        .join(" ")
    : "";
  const attacks = (c.attacks ?? [])
    .map(
      (a) =>
        `${a.name}@${a.skill_pct}% ${a.damage}${a.attacks_per_round && a.attacks_per_round > 1 ? `×${a.attacks_per_round}` : ""}`,
    )
    .join("; ");
  const bits = [
    `kind=${c.kind}`,
    `HP=${c.hp}`,
    c.armor != null ? `Armor=${c.armor}` : null,
    c.mov != null ? `MOV=${c.mov}` : null,
    c.build != null ? `Build=${c.build}` : null,
    c.damage_bonus ? `DB=${c.damage_bonus}` : null,
    attrs ? `attrs[${attrs}]` : null,
    attacks ? `attacks[${attacks}]` : null,
    c.san_loss_on_sight ? `SAN_sight=${c.san_loss_on_sight}` : null,
    c.linked_npc_id ? `npc=${c.linked_npc_id}` : null,
    c.powers ? `powers=${c.powers}` : null,
    c.armor_notes ? `armor_notes=${c.armor_notes}` : null,
    c.combat_notes ? `notes=${c.combat_notes}` : null,
  ].filter(Boolean);
  return `- [${c.id}] ${c.name}: ${bits.join("；")}`;
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
  chunks.push(formatWinAdjudication(hidden.winning_condition));
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

  const scenes = hidden.scenes ?? [];
  const sceneId = resolveCanonicalSceneId(
    scenes,
    opts.currentSceneId,
    opts.location,
  );
  const hay = haystack(opts.location, opts.playerAction, sceneId);
  const npcs = hidden.npcs ?? [];
  const creatures = hidden.creatures ?? [];

  const current =
    (sceneId && scenes.find((s) => s.id === sceneId)) ||
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

  if (creatures.length) {
    const linkedCreatureIds = new Set(
      selectedNpcs.map((n) => n.id).concat([...linkedIds]),
    );
    const hitCreatures = creatures.filter(
      (c) =>
        creatureMatches(c, hay) ||
        (c.linked_npc_id != null && linkedCreatureIds.has(c.linked_npc_id)) ||
        linkedCreatureIds.has(c.id),
    );
    const selectedCreatures =
      hitCreatures.length > 0
        ? hitCreatures.slice(0, MAX_EXTRA_CREATURES)
        : creatures.slice(0, Math.min(MAX_EXTRA_CREATURES, creatures.length));
    chunks.push(
      `CREATURES / ENEMIES (KEEPER SSOT — use attacks/HP/armor; never invent contradicting stats):\n${selectedCreatures
        .map(formatCreature)
        .join("\n")}`,
    );
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

export type ScenarioTermKind =
  | "any"
  | "npc"
  | "scene"
  | "creature"
  | "faction"
  | "clue"
  | "core";

/** GM 常傳複數／近義（scenes、npcs、truth）→ 正規 kind */
export function normalizeScenarioTermKind(
  raw?: string | null,
): ScenarioTermKind {
  const k = (raw ?? "any").trim().toLowerCase();
  if (!k || k === "any" || k === "all") return "any";
  if (k === "scene" || k === "scenes" || k === "location" || k === "locations") {
    return "scene";
  }
  if (k === "npc" || k === "npcs" || k === "character" || k === "characters") {
    return "npc";
  }
  if (
    k === "creature" ||
    k === "creatures" ||
    k === "monster" ||
    k === "monsters"
  ) {
    return "creature";
  }
  if (k === "faction" || k === "factions") return "faction";
  if (k === "clue" || k === "clues" || k === "key_clue" || k === "key_clues") {
    return "clue";
  }
  if (
    k === "core" ||
    k === "truth" ||
    k === "win" ||
    k === "timeline" ||
    k === "acts" ||
    k === "bible"
  ) {
    return "core";
  }
  return "any";
}

/**
 * narrate_story：即使只給 location、沒給 scene_id，也對回 bible 場景並刷新 sceneGoal。
 */
export function patchSceneDirectorFromNarrate(input: {
  scenes: ScenarioScene[] | undefined | null;
  location?: string | null;
  requestedSceneId?: string | null;
  requestedGoal?: string | null;
  tension?: string | null;
  directorNotes?: string | null;
  previous: { currentSceneId?: string; sceneGoal?: string };
}): {
  currentSceneId?: string;
  sceneGoal?: string;
  tension?: string;
  notes?: string;
  resolvedSceneId: string | null;
  inventedSceneId: boolean;
  locationSynced: boolean;
} | null {
  const loc = input.location?.trim() || "";
  const requestedId = input.requestedSceneId?.trim() || "";
  const requestedGoal = input.requestedGoal?.trim() || "";
  const hasNotes = input.directorNotes != null;
  const hasAny =
    Boolean(loc) ||
    Boolean(requestedId) ||
    Boolean(requestedGoal) ||
    Boolean(input.tension) ||
    hasNotes;
  if (!hasAny) return null;

  const resolvedSceneId = resolveCanonicalSceneId(
    input.scenes,
    requestedId || null,
    loc || null,
  );
  const scene = input.scenes?.find((s) => s.id === resolvedSceneId);
  const sceneChanged =
    Boolean(resolvedSceneId) &&
    resolvedSceneId !== input.previous.currentSceneId;
  const nextGoal =
    requestedGoal ||
    (sceneChanged && scene?.summary?.trim()
      ? scene.summary.trim()
      : undefined);

  const patch: {
    currentSceneId?: string;
    sceneGoal?: string;
    tension?: string;
    notes?: string;
  } = {};
  if (resolvedSceneId) patch.currentSceneId = resolvedSceneId;
  if (nextGoal !== undefined) patch.sceneGoal = nextGoal;
  if (input.tension) patch.tension = input.tension;
  if (hasNotes) patch.notes = input.directorNotes ?? "";

  return {
    ...patch,
    resolvedSceneId,
    inventedSceneId: Boolean(requestedId) && requestedId !== (resolvedSceneId ?? ""),
    locationSynced:
      !requestedId && Boolean(loc) && Boolean(resolvedSceneId) && sceneChanged,
  };
}

function termHay(query: string): string {
  return query.trim().toLowerCase();
}

function textMatchesQuery(text: string, q: string): boolean {
  const t = text.toLowerCase();
  if (!q) return false;
  if (t.includes(q) || q.includes(t)) return true;
  // 多詞：任一詞 ≥2 字命中
  return q
    .split(/[\s,，、/|]+/)
    .filter((p) => p.length >= 2)
    .some((p) => t.includes(p));
}

function formatCoreSection(
  hidden: HiddenFullScript,
  section: "truth" | "win" | "failure" | "san" | "clues" | "acts" | "timeline" | "all",
): string[] {
  const out: string[] = [];
  if (section === "all" || section === "truth") {
    out.push(`Truth: ${hidden.truth_and_secrets}`);
  }
  if (section === "all" || section === "win") {
    out.push(formatWinAdjudication(hidden.winning_condition));
  }
  if (
    (section === "all" || section === "failure") &&
    hidden.failure_consequences
  ) {
    out.push(`Failure: ${hidden.failure_consequences}`);
  }
  if ((section === "all" || section === "san") && hidden.san_and_threats) {
    out.push(`SAN/Threats: ${hidden.san_and_threats}`);
  }
  if (
    (section === "all" || section === "clues") &&
    hidden.key_clues?.length
  ) {
    out.push(`Key clues: ${hidden.key_clues.join(" | ")}`);
  }
  if ((section === "all" || section === "acts") && hidden.acts?.length) {
    out.push(
      `Acts:\n${hidden.acts.map((a) => `- ${a.name}: ${a.summary}`).join("\n")}`,
    );
  }
  if (
    (section === "all" || section === "timeline") &&
    hidden.timeline?.length
  ) {
    out.push(
      `Timeline:\n${hidden.timeline.map((t) => `- ${t.when}: ${t.what}`).join("\n")}`,
    );
  }
  return out;
}

/**
 * 專有名詞／條目字典：依 query（名稱、id、關鍵詞）回傳匹配條目。
 * kind=core 可查 truth／win／acts／timeline 等骨架。
 */
export function lookupScenarioTerm(
  hidden: HiddenFullScript,
  opts: {
    query: string;
    kind?: ScenarioTermKind;
    limit?: number;
  },
): { ok: true; hits: number; text: string } | { ok: false; text: string } {
  const kind = opts.kind ?? "any";
  const limit = Math.min(Math.max(opts.limit ?? 6, 1), 12);
  const q = termHay(opts.query);
  if (!q) {
    return {
      ok: false,
      text: "Empty query. Pass an NPC/scene/creature/faction/clue name or id, or core keywords (truth, win, acts, timeline, clues).",
    };
  }

  const chunks: string[] = [];

  if (kind === "core" || kind === "any") {
    const coreKeys: Array<{
      key: string;
      section: "truth" | "win" | "failure" | "san" | "clues" | "acts" | "timeline" | "all";
    }> = [
      { key: "truth", section: "truth" },
      { key: "secret", section: "truth" },
      { key: "真相", section: "truth" },
      { key: "win", section: "win" },
      { key: "勝利", section: "win" },
      { key: "failure", section: "failure" },
      { key: "失敗", section: "failure" },
      { key: "san", section: "san" },
      { key: "threat", section: "san" },
      { key: "clue", section: "clues" },
      { key: "線索", section: "clues" },
      { key: "act", section: "acts" },
      { key: "幕", section: "acts" },
      { key: "timeline", section: "timeline" },
      { key: "時間", section: "timeline" },
      { key: "core", section: "all" },
      { key: "骨架", section: "all" },
      { key: "bible", section: "all" },
    ];
    const hit = coreKeys.find((c) => q.includes(c.key) || c.key.includes(q));
    if (hit || kind === "core") {
      const section = hit?.section ?? "all";
      chunks.push(...formatCoreSection(hidden, section));
    }
  }

  if (kind === "scene" || kind === "any") {
    const allScenes = hidden.scenes ?? [];
    const canonId = resolveCanonicalSceneId(allScenes, q);
    const scenes = allScenes.filter(
      (s) =>
        s.id === canonId ||
        textMatchesQuery(`${s.id} ${s.name} ${s.summary}`, q) ||
        sceneMatches(s, q),
    );
    if (scenes.length) {
      chunks.push(
        `Scenes:\n${scenes.slice(0, limit).map(formatScene).join("\n")}`,
      );
    }
  }

  if (kind === "npc" || kind === "any") {
    const npcs = (hidden.npcs ?? []).filter(
      (n) =>
        textMatchesQuery(
          `${n.id} ${n.name} ${n.role} ${n.knows} ${n.motivation}`,
          q,
        ) || npcMatches(n, q),
    );
    if (npcs.length) {
      chunks.push(
        `NPCs:\n${npcs.slice(0, limit).map(formatNpc).join("\n")}`,
      );
    }
  }

  if (kind === "creature" || kind === "any") {
    const creatures = (hidden.creatures ?? []).filter(
      (c) =>
        textMatchesQuery(
          `${c.id} ${c.name} ${c.kind} ${c.powers ?? ""} ${c.combat_notes ?? ""}`,
          q,
        ) || creatureMatches(c, q),
    );
    if (creatures.length) {
      chunks.push(
        `Creatures:\n${creatures.slice(0, limit).map(formatCreature).join("\n")}`,
      );
    }
  }

  if (kind === "faction" || kind === "any") {
    const factions = (hidden.factions ?? []).filter((f) =>
      textMatchesQuery(`${f.id} ${f.name} ${f.goal} ${f.methods ?? ""}`, q),
    );
    if (factions.length) {
      chunks.push(
        `Factions:\n${factions
          .slice(0, limit)
          .map(
            (f) =>
              `- [${f.id}] ${f.name}: ${f.goal}${f.methods ? `（${f.methods}）` : ""}`,
          )
          .join("\n")}`,
      );
    }
  }

  if (kind === "clue" || kind === "any") {
    const clues = (hidden.key_clues ?? []).filter((c) =>
      textMatchesQuery(c, q),
    );
    if (clues.length) {
      chunks.push(`Key clues:\n${clues.slice(0, limit).map((c) => `- ${c}`).join("\n")}`);
    }
  }

  if (!chunks.length) {
    const indexHints: string[] = [];
    if (hidden.scenes?.length) {
      indexHints.push(
        `scenes: ${hidden.scenes
          .slice(0, 12)
          .map((s) => s.name || s.id)
          .join(", ")}`,
      );
    }
    if (hidden.npcs?.length) {
      indexHints.push(
        `npcs: ${hidden.npcs
          .slice(0, 12)
          .map((n) => n.name || n.id)
          .join(", ")}`,
      );
    }
    if (hidden.creatures?.length) {
      indexHints.push(
        `creatures: ${hidden.creatures
          .slice(0, 8)
          .map((c) => c.name || c.id)
          .join(", ")}`,
      );
    }
    return {
      ok: false,
      text: `No matches for "${opts.query}" (kind=${kind}). Try another name/id, or kind=core. Index: ${indexHints.join(" | ") || "（bible empty）"}`,
    };
  }

  return {
    ok: true,
    hits: chunks.length,
    text: chunks.join("\n\n"),
  };
}

/**
 * 每回合注入的短 canon：當前／命中場景與相關 NPC／生物。
 * Win／真相／時間線請用 lookup_scenario_term（kind=core），勿把裁決全文塞進 SEED。
 */
export function formatScenarioTurnCanon(
  hidden: HiddenFullScript,
  opts: {
    location?: string;
    playerAction?: string;
    currentSceneId?: string | null;
  },
): string {
  const chunks: string[] = [];
  chunks.push(
    `Core (win/truth/failure/timeline): call lookup_scenario_term({ query: "win", kind: "core" }) or query truth/timeline. Never quote Win/adjudication to the player.`,
  );

  const scenes = hidden.scenes ?? [];
  const sceneId = resolveCanonicalSceneId(
    scenes,
    opts.currentSceneId,
    opts.location,
  );
  const hay = haystack(opts.location, opts.playerAction, sceneId);
  const npcs = hidden.npcs ?? [];
  const creatures = hidden.creatures ?? [];

  const current =
    (sceneId && scenes.find((s) => s.id === sceneId)) ||
    scenes.find((s) => sceneMatches(s, hay)) ||
    null;

  const extraScenes = scenes
    .filter((s) => s.id !== current?.id && sceneMatches(s, hay))
    .slice(0, MAX_EXTRA_SCENES);

  const linkedIds = new Set<string>([
    ...(current?.linked_npc_ids ?? []),
    ...extraScenes.flatMap((s) => s.linked_npc_ids ?? []),
  ]);

  if (current) {
    chunks.push(`CURRENT SCENE:\n${formatScene(current)}`);
  } else if (extraScenes.length) {
    chunks.push(
      `Related scenes:\n${extraScenes.map(formatScene).join("\n")}`,
    );
  } else if (scenes.length) {
    chunks.push(
      `Scene index:\n${scenes
        .slice(0, 6)
        .map((s) => `- [${s.id}] ${s.name}`)
        .join("\n")}`,
    );
  }

  const hitNpcs = npcs.filter(
    (n) => linkedIds.has(n.id) || npcMatches(n, hay),
  );
  const selectedNpcs = hitNpcs.slice(0, MAX_EXTRA_NPCS + Math.min(linkedIds.size, 3));
  if (selectedNpcs.length) {
    chunks.push(
      `NPCs (near):\n${selectedNpcs.map(formatNpc).join("\n")}`,
    );
  }

  if (creatures.length) {
    const linkedCreatureIds = new Set(
      selectedNpcs.map((n) => n.id).concat([...linkedIds]),
    );
    const hitCreatures = creatures.filter(
      (c) =>
        creatureMatches(c, hay) ||
        (c.linked_npc_id != null && linkedCreatureIds.has(c.linked_npc_id)),
    );
    if (hitCreatures.length) {
      chunks.push(
        `Creatures (near):\n${hitCreatures
          .slice(0, MAX_EXTRA_CREATURES)
          .map(formatCreature)
          .join("\n")}`,
      );
    }
  }

  chunks.push(
    "More terms: call lookup_scenario_term({ query, kind? }). Do not invent contradicting bible facts.",
  );
  return chunks.join("\n\n");
}

/**
 * 完整 bible（供 sandbox 資產）。含全部 scenes／npcs／creatures，不依當下場景切片。
 */
export function formatFullScenarioBible(hidden: HiddenFullScript): string {
  const chunks: string[] = [];
  chunks.push(`Truth: ${hidden.truth_and_secrets}`);
  chunks.push(formatWinAdjudication(hidden.winning_condition));
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
      `Scenes:\n${hidden.scenes.map(formatScene).join("\n")}`,
    );
  }
  if (hidden.npcs?.length) {
    chunks.push(`NPCs:\n${hidden.npcs.map(formatNpc).join("\n")}`);
  }
  if (hidden.creatures?.length) {
    chunks.push(
      `CREATURES / ENEMIES (KEEPER SSOT — use attacks/HP/armor; never invent contradicting stats):\n${hidden.creatures
        .map(formatCreature)
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
