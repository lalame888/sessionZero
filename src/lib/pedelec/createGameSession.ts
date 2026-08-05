import type {
  PedelecError,
  PedelecSession,
  ProviderCode,
} from "@kaoruisaac/pedelec";
import { assemblePlayerTurnPrompt } from "@/engine/contextAssembler";
import {
  resolveCheckOutcome,
  resolveD20Outcome,
  rollDice,
  type AdvantageMode,
} from "@/engine/dice";
import {
  cocSuccessThreshold,
  difficultyLabel,
  lookupCharacterSkill,
  parseCheckDifficulty,
  type CheckDifficulty,
} from "@/engine/skillCheck";
import { findSrdByTopic } from "@/engine/srdLorebook";
import {
  areDuplicateNarratives,
  isCorruptedNarrativeFragment,
} from "@/lib/narrativeDedupe";
import { normalizeNarrativeText } from "@/lib/normalizeNarrativeText";
import {
  extractEndingTitleFromNarrative,
  looksLikeEndingNarrative,
} from "@/lib/endingDetect";
import { hadPriorOpeningAttempt } from "@/lib/openingRetry";
import { pedelec } from "@/lib/pedelec/client";
import {
  isCompleteLeakedPayload,
  looksLikeLeakedToolCall,
  tryParseLeakedToolCall,
  type LeakedToolCall,
} from "@/lib/pedelec/leakedToolCall";
import { persistPedelecSessionId } from "@/lib/storage";
import { GM_DIRECTIVES } from "@/prompts/gmDirectives";
import { useGameStore } from "@/store/useGameStore";
import { allSessionTools } from "@/tools/definitions";
import type {
  CharacterSchemaState,
  ClueItem,
  GameSystemID,
  HistoryLog,
  MadnessStatus,
  NPCItem,
} from "@/types/game";
import {
  isSuccessDiceOutcome,
} from "@/lib/historyHygiene";

export type GameSessionHandle = {
  session: PedelecSession<(typeof allSessionTools)[number]["name"]>;
  dispose: () => void;
};

type NarrateStoryArgs = {
  system_notice?: string;
  narrative_text: string;
  location?: string;
  scene_id?: string;
  scene_goal?: string;
  tension?: string;
  director_notes?: string;
  npc_updates?: {
    npc_id: string;
    name: string;
    relation: string;
    status: string;
    description: string;
  }[];
  check_request?: {
    request_id: string;
    check_target_name: string;
    dice_type: string;
    target_value?: number;
    difficulty?: string;
    dnd_advantage_mode?: string;
    reason: string;
  };
};

let activeHandle: GameSessionHandle | null = null;
let activeAgentMessageId: string | null = null;
/** 串流中尚未完整的洩漏 tool-call 緩衝（依 turnId） */
const leakedChatBufferByTurn = new Map<string, string>();
/** 避免同一則洩漏呼叫被重複還原 */
let recoveringLeakedTool = false;
/** 公開檢定結果暫存，待下一則真正敘事寫入 history */
let pendingPublicDiceRecord: HistoryLog["diceRecord"] | null = null;
/** 下一則 narrate 應覆寫最近一則 history 敘事（重抽） */
let replaceNextHistoryNarrative = false;

const DICE_TIMEOUT_MS = 170_000;

function resolveCheckAgainstSheet(args: {
  check_target_name: string;
  dice_type: string;
  target_value?: number;
  difficulty?: string;
}): {
  target_value?: number;
  skill_value?: number;
  difficulty: CheckDifficulty;
  sheetSkillName?: string;
} {
  const difficulty = parseCheckDifficulty(args.difficulty);
  const isD100 = args.dice_type.toLowerCase().includes("100");
  const sheet = useGameStore.getState().character;
  const hit = lookupCharacterSkill(sheet, args.check_target_name);

  if (isD100 && hit) {
    const threshold = cocSuccessThreshold(hit.value, difficulty);
    return {
      target_value: threshold,
      skill_value: hit.value,
      difficulty,
      sheetSkillName: hit.name,
    };
  }

  return {
    target_value: args.target_value,
    skill_value: hit?.value,
    difficulty,
    sheetSkillName: hit?.name,
  };
}

function waitForPlayerDice(args: {
  request_id: string;
  check_target_name: string;
  dice_type: string;
  target_value?: number;
  difficulty?: string;
  dnd_advantage_mode?: string;
  reason: string;
}): Promise<{
  request_id: string;
  diceResult: number;
  outcome: string;
  detail: string;
  cancelled?: boolean;
}> {
  const resolved = resolveCheckAgainstSheet(args);
  const displayName = resolved.sheetSkillName ?? args.check_target_name;

  return new Promise((resolve) => {
    const store = useGameStore.getState();
    const timeoutId = window.setTimeout(() => {
      store.clearDiceResolver();
      resolve({
        request_id: args.request_id,
        diceResult: 0,
        outcome: "TIMEOUT",
        detail: "player_timeout",
        cancelled: true,
      });
    }, DICE_TIMEOUT_MS);

    store.setPendingDice(
      {
        request_id: args.request_id,
        check_target_name: displayName,
        dice_type: args.dice_type,
        target_value: resolved.target_value,
        skill_value: resolved.skill_value,
        difficulty: resolved.difficulty,
        dnd_advantage_mode: args.dnd_advantage_mode,
        reason: args.reason,
        isSecret: false,
      },
      (result) => {
        window.clearTimeout(timeoutId);
        store.clearDiceResolver();
        resolve(result);
      },
    );
  });
}

export function settlePendingDiceOnTeardown() {
  const { diceResolver, pendingDice, clearDiceResolver } =
    useGameStore.getState();
  if (diceResolver && pendingDice) {
    diceResolver({
      request_id: pendingDice.request_id,
      diceResult: 0,
      outcome: "CANCELLED",
      detail: "ui_context_closed",
    });
  }
  clearDiceResolver();
}

async function runNarrateStory(args: NarrateStoryArgs) {
  const a = args;
  const narrativeText = normalizeNarrativeText(a.narrative_text);
  const store = useGameStore.getState();
  const trailingAgents: { content: string }[] = [];
  for (let i = store.messages.length - 1; i >= 0; i--) {
    const m = store.messages[i];
    if (!m) continue;
    if (m.role === "user") break;
    if (m.role === "agent") trailingAgents.push(m);
  }
  const rewriting = trailingAgents.some((m) =>
    areDuplicateNarratives(m.content, narrativeText),
  );

  if (a.location?.trim()) {
    store.setLocation(a.location.trim());
  }

  if (
    a.scene_id ||
    a.scene_goal ||
    a.tension ||
    a.director_notes !== undefined
  ) {
    store.setSceneDirector({
      ...(a.scene_id !== undefined
        ? { currentSceneId: a.scene_id || null }
        : {}),
      ...(a.scene_goal !== undefined ? { sceneGoal: a.scene_goal } : {}),
      ...(a.tension !== undefined ? { tension: a.tension } : {}),
      ...(a.director_notes !== undefined ? { notes: a.director_notes } : {}),
    });
  }

  if (a.npc_updates?.length) {
    for (const n of a.npc_updates) {
      store.registerNpc({
        npc_id: n.npc_id,
        name: n.name,
        relation: (n.relation as NPCItem["relation"]) || "NEUTRAL",
        status: (n.status as NPCItem["status"]) || "ALIVE",
        description: n.description,
      });
    }
  }

  store.narrateFromTool(narrativeText, a.system_notice);

  // GM 常寫出「全劇終」卻忘記呼叫 end_game_session → 提示玩家可手動結算
  if (
    useGameStore.getState().phase === "PLAYING" &&
    looksLikeEndingNarrative(narrativeText)
  ) {
    const titleFallback =
      useGameStore.getState().script.public_summary?.title ?? "結局";
    useGameStore.getState().offerManualEnding({
      title: extractEndingTitleFromNarrative(narrativeText, titleFallback),
      narrative: narrativeText,
    });
  }

  const diceAttach = pendingPublicDiceRecord;
  pendingPublicDiceRecord = null;
  const shouldReplace = replaceNextHistoryNarrative;
  replaceNextHistoryNarrative = false;

  if (shouldReplace || rewriting) {
    const history = useGameStore.getState().history;
    let patched = false;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (!h) continue;
      if (h.aiNarrative.startsWith("（檢定結果已回傳）")) continue;
      if (h.aiNarrative.startsWith("（暗骰）")) continue;
      if (
        shouldReplace ||
        areDuplicateNarratives(h.aiNarrative, narrativeText)
      ) {
        const next = history.slice();
        next[i] = {
          ...h,
          aiNarrative: narrativeText,
          timestamp: Date.now(),
          diceRecord: diceAttach ?? h.diceRecord,
        };
        useGameStore.setState({ history: next });
        patched = true;
        break;
      }
      if (!shouldReplace) break;
    }
    if (!patched) {
      store.recordHistoryTurn({
        playerInput: store.lastPlayerAction || undefined,
        aiNarrative: narrativeText,
        diceRecord: diceAttach ?? undefined,
      });
    }
  } else {
    store.recordHistoryTurn({
      playerInput: store.lastPlayerAction || undefined,
      aiNarrative: narrativeText,
      diceRecord: diceAttach ?? undefined,
    });
  }

  if (!a.check_request) {
    return { ok: true as const, narrative_recorded: true as const };
  }

  const resolved = resolveCheckAgainstSheet(a.check_request);
  const skillLabel = resolved.sheetSkillName ?? a.check_request.check_target_name;
  const thresholdText =
    resolved.skill_value != null && resolved.target_value != null
      ? `角色卡「${skillLabel}」${resolved.skill_value}% · ${difficultyLabel(resolved.difficulty)}難度，成功需 ≤ ${resolved.target_value}`
      : resolved.target_value != null
        ? `目標值 ${resolved.target_value}`
        : "未找到對應角色卡技能（將無法依技能％判定）";

  store.appendSystem(
    `需要檢定：${skillLabel}（${a.check_request.dice_type}）— ${a.check_request.reason}\n${thresholdText}`,
  );

  const roll = await waitForPlayerDice({
    ...a.check_request,
    difficulty: a.check_request.difficulty ?? resolved.difficulty,
  });
  if (!roll.cancelled) {
    pendingPublicDiceRecord = {
      skillName: skillLabel,
      isSecret: false,
      diceType: a.check_request.dice_type,
      targetValue: resolved.target_value,
      diceResult: roll.diceResult,
      outcome: roll.outcome,
    };
    if (isSuccessDiceOutcome(roll.outcome)) {
      useGameStore.getState().markSkillSuccess(skillLabel);
    }
  }

  const sheetSkills = useGameStore.getState().character?.skills ?? {};
  const skillHint = Object.entries(sheetSkills)
    .map(([k, v]) => `${k}${v}%`)
    .slice(0, 12)
    .join("、");

  return {
    ...roll,
    gm_instruction:
      "CRITICAL: Your next narrate_story.narrative_text must ONLY describe this check outcome and immediate consequences. Do NOT repeat, paraphrase, or rewrite any previously narrated scene text. Prefer updating location/scene_id/npc_updates if the scene changed. Sheet skills: " +
      (skillHint || "（無）"),
  };
}

function removeAgentMessageIfEmpty(id: string | null) {
  if (!id) return;
  const msg = useGameStore.getState().messages.find((m) => m.id === id);
  if (msg && msg.role === "agent" && !msg.content.trim()) {
    useGameStore.setState((s) => ({
      messages: s.messages.filter((m) => m.id !== id),
    }));
    if (activeAgentMessageId === id) activeAgentMessageId = null;
  }
}

async function recoverLeakedToolCall(
  call: LeakedToolCall,
  session: PedelecSession<(typeof allSessionTools)[number]["name"]>,
) {
  if (recoveringLeakedTool) return;
  recoveringLeakedTool = true;
  const store = useGameStore.getState();
  try {
    store.appendSystem(`（已攔截並還原漏出的工具呼叫：${call.tool}）`);

    if (call.tool === "narrate_story") {
      const a = call.args as NarrateStoryArgs;
      if (!a?.narrative_text || typeof a.narrative_text !== "string") {
        store.appendSystem(
          "漏出的 narrate_story 缺少 narrative_text，無法還原。請重試上一步。",
        );
        return;
      }
      const result = await runNarrateStory(a);
      // chat 洩漏時 runtime 不會回傳 tool result；若有檢定結果，補送一則讓 GM 接續
      if (
        "diceResult" in result &&
        !result.cancelled &&
        session.getStatus() === "idle"
      ) {
        try {
          await session.sendText(
            `[RECOVERED TOOL RESULT — narrate_story]\n${JSON.stringify(result)}\nCRITICAL: Your next narrate_story.narrative_text must ONLY describe this check outcome and immediate consequences. Do NOT repeat, paraphrase, or rewrite any previously narrated scene text.`,
          );
        } catch {
          store.appendSystem(
            "檢定結果已記錄，但無法自動通知 GM 接續；請以玩家行動描述結果或重試。",
          );
        }
      }
      return;
    }

    store.appendSystem(
      `工具「${call.tool}」曾以文字形式漏出，無法自動執行。請重試該步驟（勿把 tool call 寫成對話）。`,
    );
  } finally {
    recoveringLeakedTool = false;
  }
}

function flushLeakedChatBuffers(
  session: PedelecSession<(typeof allSessionTools)[number]["name"]>,
) {
  const entries = [...leakedChatBufferByTurn.entries()];
  leakedChatBufferByTurn.clear();
  for (const [, buf] of entries) {
    const parsed = tryParseLeakedToolCall(buf);
    if (parsed) {
      void recoverLeakedToolCall(parsed, session);
      continue;
    }
    if (looksLikeLeakedToolCall(buf)) {
      useGameStore
        .getState()
        .appendSystem(
          "偵測到疑似工具呼叫漏出為文字，但無法解析。該段已隱藏；請重試上一步。",
        );
    }
  }
}

function registerHandlers(
  session: PedelecSession<(typeof allSessionTools)[number]["name"]>,
): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    session.onTool("setup_script", (args) => {
      const phase = useGameStore.getState().phase;
      if (
        phase === "PLAYING" ||
        phase === "ENDING" ||
        phase === "CHARACTER"
      ) {
        return {
          ok: false,
          error: `setup_script is forbidden during phase ${phase}. Do not reset the script or character card. Continue with narrate_story only.`,
        };
      }
      const a = args as {
        system_id: string;
        scenario_scale?: string;
        public_summary: {
          title: string;
          background: string;
          protagonist_role: string;
          genre: string;
          player_hook?: string;
          known_facts?: string[];
          geography?: string;
        };
        hidden_full_script: {
          truth_and_secrets: string;
          key_clues: string[];
          winning_condition: string;
          failure_consequences?: string;
          timeline?: { when: string; what: string }[];
          scenes?: {
            id: string;
            name: string;
            summary: string;
            clues?: string[];
            dangers?: string[];
            linked_npc_ids?: string[];
          }[];
          npcs?: {
            id: string;
            name: string;
            role: string;
            appearance?: string;
            motivation: string;
            knows: string;
            attitude_to_pc: string;
          }[];
          factions?: {
            id: string;
            name: string;
            goal: string;
            methods?: string;
          }[];
          san_and_threats?: string;
          acts?: { name: string; summary: string }[];
        };
        recommended_creation_mode: string;
        tone_examples?: string[];
      };
      useGameStore.getState().setupScript(a);
      return {
        ok: true,
        system_id: a.system_id,
        scenario_scale: a.scenario_scale ?? null,
        scenes: a.hidden_full_script.scenes?.length ?? 0,
        npcs: a.hidden_full_script.npcs?.length ?? 0,
        tone_examples: a.tone_examples?.length ?? 0,
      };
    }),
  );

  disposers.push(
    session.onTool("generate_character_schema", (args) => {
      const phase = useGameStore.getState().phase;
      if (phase === "PLAYING" || phase === "ENDING") {
        return {
          ok: false,
          error: `generate_character_schema is forbidden during phase ${phase}. Character sheet must not be reset mid-adventure.`,
        };
      }
      const a = args as {
        system_id: string;
        creation_mode: string;
        attribute_defs?: {
          key: string;
          label: string;
          dice_formula?: string;
        }[];
        mode_config?: {
          point_buy_pool?: number;
          standard_array?: number[];
          occupational_point_formula?: string;
          interest_point_formula?: string;
          min_score?: number;
          max_score?: number;
        };
        standard_array?: number[];
        point_buy?: {
          budget: number;
          min_score: number;
          max_score: number;
        };
        skill_points?: number;
        recommended_skills: {
          name: string;
          base_value: number;
          description: string;
          is_occupational?: boolean;
        }[];
        background_questions: unknown;
        starting_inventory?: string[];
        role_title_suggestion?: string;
        mode_instructions?: string;
      };
      useGameStore.getState().setCharacterSchema({
        system_id: a.system_id as GameSystemID,
        creation_mode: a.creation_mode,
        attribute_defs: a.attribute_defs ?? [],
        mode_config: a.mode_config,
        standard_array: a.standard_array,
        point_buy: a.point_buy,
        skill_points: a.skill_points,
        recommended_skills: a.recommended_skills,
        background_questions: a.background_questions as CharacterSchemaState["background_questions"],
        starting_inventory: a.starting_inventory,
        role_title_suggestion: a.role_title_suggestion,
        mode_instructions: a.mode_instructions,
      });
      return { ok: true };
    }),
  );

  disposers.push(
    session.onTool("fill_character_narrative", (args) => {
      const a = args as {
        name?: string;
        role_title?: string;
        age?: string;
        gender?: string;
        appearance?: string;
        residence?: string;
        birthplace?: string;
        languages?: string;
        personal_bio?: string;
        wealth?: string;
        profile_coc?: { occupation?: string; cash_assets?: string };
        profile_dnd?: {
          race?: string;
          class_name?: string;
          background?: string;
          alignment?: string;
          speed?: number;
          proficiencies?: string;
          features?: string;
        };
        backstory_hooks?: { id: string; answer: string }[];
        inventory?: string[];
        player_note?: string;
      };
      const store = useGameStore.getState();
      if (!store.character) {
        return { ok: false, error: "NO_CHARACTER_SHEET" };
      }
      store.applyCharacterNarrative(a);
      const applied = useGameStore.getState().character;
      return {
        ok: true,
        name: applied?.name ?? a.name ?? null,
        hooks_filled: a.backstory_hooks?.length ?? 0,
        inventory_items: a.inventory?.length ?? 0,
        note: "Narrative fields applied; attributes and skill points unchanged.",
      };
    }),
  );

  disposers.push(
    session.onTool("narrate_story", async (args) =>
      runNarrateStory(args as NarrateStoryArgs),
    ),
  );

  disposers.push(
    session.onTool("secret_check_request", (args) => {
      const a = args as {
        request_id: string;
        check_target_name: string;
        dice_type: string;
        target_value?: number;
        difficulty?: string;
        reason_for_gm: string;
      };
      const store = useGameStore.getState();
      store.setSecretRollActive(true);
      store.appendSystem("GM 暗骰進行中…（點數將於結局時間軸揭曉）");

      const resolved = resolveCheckAgainstSheet(a);
      const rolled = rollDice(a.dice_type, "normal");
      const outcome = a.dice_type.toLowerCase().includes("20")
        ? resolveD20Outcome(
            rolled.rolls[0] ?? rolled.total,
            rolled.total,
            resolved.target_value,
          )
        : resolveCheckOutcome(
            a.dice_type,
            rolled.total,
            resolved.target_value,
            resolved.skill_value,
          );

      store.recordHistoryTurn({
        aiNarrative: `（暗骰）${a.reason_for_gm}`,
        diceRecord: {
          skillName: resolved.sheetSkillName ?? a.check_target_name,
          isSecret: true,
          diceType: a.dice_type,
          targetValue: resolved.target_value,
          diceResult: rolled.total,
          outcome,
        },
      });
      store.setSecretRollActive(false);

      return {
        request_id: a.request_id,
        diceResult: rolled.total,
        outcome,
        detail: rolled.detail,
        isSecret: true,
        target_value: resolved.target_value,
        skill_value: resolved.skill_value,
      };
    }),
  );

  disposers.push(
    session.onTool("update_game_stats", (args) => {
      const a = args as {
        stat_changes: { key: string; change_amount: number; reason: string }[];
        inventory_add?: string[];
        inventory_remove?: string[];
      };
      useGameStore
        .getState()
        .applyStatChanges(a.stat_changes, a.inventory_add, a.inventory_remove);
      const sheet = useGameStore.getState().character;
      return {
        ok: true,
        hp: sheet?.derived.hp,
        san: sheet?.derived.san,
        inventory: sheet?.inventory,
      };
    }),
  );

  disposers.push(
    session.onTool("mark_skill_success", (args) => {
      const a = args as { skill_name: string; reason: string };
      useGameStore.getState().markSkillSuccess(a.skill_name);
      return { ok: true, skill_name: a.skill_name };
    }),
  );

  disposers.push(
    session.onTool("record_clue", (args) => {
      const a = args as ClueItem;
      useGameStore.getState().recordClue(a);
      return { ok: true, clue_id: a.clue_id };
    }),
  );

  disposers.push(
    session.onTool("trigger_madness", (args) => {
      const a = args as {
        type: string;
        phobia_or_mania_name: string;
        duration_turns: number;
        effect_description: string;
      };
      const madness: MadnessStatus = {
        active: true,
        type: a.type as MadnessStatus["type"],
        name: a.phobia_or_mania_name,
        duration_turns: a.duration_turns,
        effect_description: a.effect_description,
      };
      useGameStore.getState().triggerMadness(madness);
      return { ok: true };
    }),
  );

  disposers.push(
    session.onTool("register_npc", (args) => {
      const a = args as NPCItem;
      useGameStore.getState().registerNpc(a);
      return { ok: true, npc_id: a.npc_id };
    }),
  );

  disposers.push(
    session.onTool("end_game_session", (args) => {
      const a = args as {
        ending_type: string;
        ending_title: string;
        ending_narrative: string;
        achievements?: string[];
      };
      useGameStore.getState().endGame({
        ending_type: a.ending_type,
        ending_title: a.ending_title,
        ending_narrative: a.ending_narrative,
        achievements: a.achievements ?? [],
      });
      return { ok: true };
    }),
  );

  disposers.push(
    session.onTool("lookup_rule", (args) => {
      const a = args as {
        rule_topic: string;
        applied_reason: string;
        rule_reference_text: string;
      };
      const systemId = useGameStore.getState().script.system_id;
      const srd = findSrdByTopic(systemId, a.rule_topic);
      const enriched = {
        ...a,
        rule_reference_text: srd
          ? `${a.rule_reference_text}\n[Local SRD] ${srd.text}`
          : a.rule_reference_text,
      };
      useGameStore.getState().setPendingRuleLookup(enriched);
      return { ok: true, ...enriched };
    }),
  );

  return () => {
    for (const d of disposers) d();
  };
}

export async function createGameSession(options: {
  provider: ProviderCode;
  model?: string;
}): Promise<GameSessionHandle> {
  await disposeGameSession();

  const session = await pedelec.createSession({
    provider: options.provider,
    model: options.model || undefined,
    skills: {
      guidance: GM_DIRECTIVES,
      tools: allSessionTools,
    },
    autoEndOnDisconnect: false,
  });

  persistPedelecSessionId(session.sessionId);
  const store = useGameStore.getState();
  store.setSessionStatus(session.getStatus());

  const offChat = session.onChat((delta, ctx) => {
    const s = useGameStore.getState();
    const turnKey = ctx.turnId ?? "default";
    const sameTurn =
      !!activeAgentMessageId &&
      s.messages.find((m) => m.id === activeAgentMessageId)?.turnId ===
        ctx.turnId;
    const existingContent = sameTurn
      ? (s.messages.find((m) => m.id === activeAgentMessageId)?.content ?? "")
      : "";
    const leakedBuf = leakedChatBufferByTurn.get(turnKey) ?? "";
    const candidate = (leakedBuf || existingContent) + delta;

    if (leakedBuf || looksLikeLeakedToolCall(candidate)) {
      leakedChatBufferByTurn.set(turnKey, candidate);
      // 隱藏洩漏內容：清空／移除本 turn 的 agent 氣泡
      if (sameTurn && activeAgentMessageId) {
        s.updateMessage(activeAgentMessageId, "");
        removeAgentMessageIfEmpty(activeAgentMessageId);
      }
      s.setIsTyping(false);

      const parsed = tryParseLeakedToolCall(candidate);
      if (parsed) {
        leakedChatBufferByTurn.delete(turnKey);
        void recoverLeakedToolCall(parsed, session);
        return;
      }
      if (isCompleteLeakedPayload(candidate)) {
        leakedChatBufferByTurn.delete(turnKey);
        s.appendSystem(
          "偵測到工具呼叫漏出為文字，但無法解析參數。該段已隱藏；請重試上一步。",
        );
      }
      return;
    }

    if (!sameTurn) {
      activeAgentMessageId = s.appendMessage({
        role: "agent",
        content: delta,
        turnId: ctx.turnId,
      });
      s.setIsTyping(false);
    } else {
      s.updateMessage(activeAgentMessageId!, existingContent + delta);
    }

    // tool 已寫過近重複敘事時，隱藏 chat 重複氣泡（檢定後常見）；
    // 亦丟掉含 � 的截斷碎片與「等待骰子」等內部狀態句
    const chatId = activeAgentMessageId;
    const chatMsg = chatId
      ? useGameStore.getState().messages.find((m) => m.id === chatId)
      : undefined;
    const chatContent = chatMsg?.content ?? "";
    if (chatId && chatContent.trim().length >= 24) {
      const others: string[] = [];
      const msgs = useGameStore.getState().messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m) continue;
        if (m.role === "user") break;
        if (m.role === "agent" && m.id !== chatId) others.push(m.content);
      }
      const drop =
        isCorruptedNarrativeFragment(chatContent) ||
        others.some((o) => areDuplicateNarratives(o, chatContent));
      if (drop) {
        useGameStore.setState((st) => ({
          messages: st.messages.filter((m) => m.id !== chatId),
        }));
        activeAgentMessageId = null;
      }
    }
  });

  const offStatus = session.onStatus((status) => {
    const s = useGameStore.getState();
    s.setSessionStatus(status);
    if (status === "running") {
      s.setIsTyping(true);
      // 不在 running 清除 sessionError：擴充元件斷線／失敗後偶發仍會噴 running，
      // 若此處清空會讓重試按鈕消失（開場寫到一半尤甚）
      activeAgentMessageId = null;
    }
    if (status === "idle") {
      s.setIsTyping(false);
      flushLeakedChatBuffers(session);
      s.collapseNarrativeRewrites();
      // 不在 idle 清除 sessionError：錯誤後 Session 常回到 idle，仍需顯示重試按鈕
    }
    if (status === "error" || status === "ended") {
      s.setIsTyping(false);
      leakedChatBufferByTurn.clear();
    }
    if (status === "waiting_tool_result") {
      s.setIsTyping(false);
    }
  });

  const offError = session.onError((error: PedelecError) => {
    const s = useGameStore.getState();
    s.setSessionError({ code: error.code, message: error.message });
    s.appendSystem(`錯誤：${error.code} — ${error.message}`);
    s.setIsTyping(false);
  });

  const offEnded = session.onEnded(() => {
    settlePendingDiceOnTeardown();
    const s = useGameStore.getState();
    s.setSessionStatus("ended");
    s.setIsTyping(false);
    s.setSessionError({
      code: "SESSION_ENDED",
      message: "Pedelec Session 已結束。",
    });
    s.appendSystem("Pedelec Session 已結束。");
  });

  const offTools = registerHandlers(session);

  const handle: GameSessionHandle = {
    session,
    dispose: () => {
      settlePendingDiceOnTeardown();
      leakedChatBufferByTurn.clear();
      recoveringLeakedTool = false;
      pendingPublicDiceRecord = null;
      replaceNextHistoryNarrative = false;
      offChat();
      offStatus();
      offError();
      offEnded();
      offTools();
    },
  };

  activeHandle = handle;
  return handle;
}

export function getActiveSession() {
  return activeHandle?.session ?? null;
}

export async function disposeGameSession() {
  if (!activeHandle) return;
  const handle = activeHandle;
  activeHandle = null;
  handle.dispose();
  try {
    await handle.session.end();
  } catch {
    // ignore
  }
}

export async function sendPlayerAction(
  text: string,
  opts?: { skipUserMessage?: boolean; extraLayers?: string[] },
) {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");

  const store = useGameStore.getState();
  store.setLastPlayerAction(text);
  store.setRetryAction({
    kind: "player",
    label: "重試上一步行動",
    text,
    extraLayers: opts?.extraLayers,
  });
  store.setSessionError(null);
  if (!opts?.skipUserMessage) {
    store.appendMessage({ role: "user", content: text });
  }

  const prompt = assemblePlayerTurnPrompt({
    script: store.script,
    houseRules: store.houseRules,
    character: store.character,
    clues: store.clues,
    npcs: store.npcs,
    madness: store.madness,
    location: store.location,
    chapterSummaries: store.chapterSummaries,
    recentMessages: store.messages,
    playerAction: text,
    turn: store.turn,
    suggestPlayerActions: store.suggestPlayerActions,
    extraLayers: opts?.extraLayers,
    sceneDirector: store.sceneDirector,
  });

  await session.sendText(prompt);
}

export const OPENING_NARRATION_ACTION =
  "現在已確認角色卡。請立刻開始劇本並述說故事開場（請呼叫 narrate_story）。開場必須包含：明確時間、地點（並設定 location）、感官細節、眼前可行動的壓力；如需檢定請在同一則 narrate_story 附上 check_request，不要先等待玩家輸入。若開場含檢定：收到擲骰結果後，下一次 narrate_story 只寫檢定結果與當下後續，禁止重寫已述說過的開場文字。";

/** 送出開場敘事（不寫入玩家訊息）；失敗時由呼叫端／onError 記錄 sessionError */
export async function sendOpeningNarration() {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");

  const store = useGameStore.getState();
  const isRetry = hadPriorOpeningAttempt({
    historyLength: store.history.length,
    messages: store.messages,
    sessionError: store.sessionError,
  });
  store.setRetryAction({
    kind: "opening",
    label: isRetry ? "重試開場敘事" : "述說開場敘事",
  });
  store.setSessionError(null);
  // 清掉寫到一半的 GM 敘事；首次／重試用不同系統提示
  store.clearIncompleteOpening(isRetry ? "retry" : "first");

  const latest = useGameStore.getState();
  const prompt = assemblePlayerTurnPrompt({
    script: latest.script,
    houseRules: latest.houseRules,
    character: latest.character,
    clues: latest.clues,
    npcs: latest.npcs,
    madness: latest.madness,
    location: latest.location,
    chapterSummaries: latest.chapterSummaries,
    recentMessages: [],
    playerAction: OPENING_NARRATION_ACTION,
    turn: latest.turn,
    // 開場第一則一律不附推薦行動（與開關無關）
    suggestPlayerActions: false,
    sceneDirector: latest.sceneDirector,
  });

  await session.sendText(prompt);
}

const REGENERATE_NARRATIVE_ACTION =
  "【系統指令】請重新生成上一則 GM 敘事（呼叫 narrate_story）。保持同一場景前提與檢定結果（若有），改寫文筆與細節，禁止複讀上一版原文，禁止代操 PC。";

const CONTINUE_NARRATIVE_ACTION =
  "【系統指令】請自上一則 GM 敘事結尾繼續寫下去（呼叫 narrate_story），不要重複已寫過的內容，推進場面後暫停等待玩家。";

/** 重抽最近一則 GM 敘事 */
export async function regenerateLastNarrative() {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");
  const store = useGameStore.getState();
  store.removeLastAgentMessage();
  replaceNextHistoryNarrative = true;
  store.setRetryAction({
    kind: "player",
    label: "重試重新生成敘事",
    text: REGENERATE_NARRATIVE_ACTION,
  });
  await sendPlayerAction(REGENERATE_NARRATIVE_ACTION, {
    skipUserMessage: true,
    extraLayers: [
      "[NARRATIVE CONTROL] Regenerate previous GM beat only. Write a fresh narrate_story; the engine will replace the last history narrative.",
    ],
  });
}

/** 續寫最近一則 GM 敘事 */
export async function continueLastNarrative() {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");
  const store = useGameStore.getState();
  store.setRetryAction({
    kind: "player",
    label: "重試續寫敘事",
    text: CONTINUE_NARRATIVE_ACTION,
  });
  await sendPlayerAction(CONTINUE_NARRATIVE_ACTION, {
    skipUserMessage: true,
  });
}

/** Session 損壞（error/ended）時是否需要重建 */
export function sessionNeedsRebuild() {
  const session = getActiveSession();
  if (!session) return true;
  const status = session.getStatus();
  return status === "error" || status === "ended";
}

export function resolvePlayerDice(opts: {
  advantageMode?: AdvantageMode;
}) {
  const { pendingDice, diceResolver } = useGameStore.getState();
  if (!pendingDice || !diceResolver) return;

  const mode = (opts.advantageMode ??
    pendingDice.dnd_advantage_mode ??
    "normal") as AdvantageMode;
  const rolled = rollDice(pendingDice.dice_type, mode);
  const natural = rolled.rolls[0] ?? rolled.total;
  const outcome = pendingDice.dice_type.toLowerCase().includes("20")
    ? resolveD20Outcome(natural, rolled.total, pendingDice.target_value)
    : resolveCheckOutcome(
        pendingDice.dice_type,
        rolled.total,
        pendingDice.target_value,
        pendingDice.skill_value,
      );

  const thresholdNote =
    pendingDice.skill_value != null && pendingDice.target_value != null
      ? `，門檻 ≤${pendingDice.target_value}（技能 ${pendingDice.skill_value}%／${difficultyLabel(pendingDice.difficulty ?? "regular")}）`
      : pendingDice.target_value != null
        ? `，門檻 ≤${pendingDice.target_value}`
        : "";

  useGameStore
    .getState()
    .appendSystem(
      `擲骰結果：${pendingDice.check_target_name} → ${rolled.detail}（${outcome}${thresholdNote}）`,
    );

  diceResolver({
    request_id: pendingDice.request_id,
    diceResult: rolled.total,
    outcome,
    detail: rolled.detail,
  });
}
