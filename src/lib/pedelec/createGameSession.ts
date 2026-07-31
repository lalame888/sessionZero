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
import { pedelec } from "@/lib/pedelec/client";
import { persistPedelecSessionId } from "@/lib/storage";
import { GM_DIRECTIVES } from "@/prompts/gmDirectives";
import { useGameStore } from "@/store/useGameStore";
import { allSessionTools } from "@/tools/definitions";
import type {
  CharacterSchemaState,
  ClueItem,
  GameSystemID,
  MadnessStatus,
  NPCItem,
} from "@/types/game";

export type GameSessionHandle = {
  session: PedelecSession<(typeof allSessionTools)[number]["name"]>;
  dispose: () => void;
};

let activeHandle: GameSessionHandle | null = null;
let activeAgentMessageId: string | null = null;

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

function registerHandlers(
  session: PedelecSession<(typeof allSessionTools)[number]["name"]>,
): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    session.onTool("setup_script", (args) => {
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
      };
      useGameStore.getState().setupScript(a);
      return {
        ok: true,
        system_id: a.system_id,
        scenario_scale: a.scenario_scale ?? null,
        scenes: a.hidden_full_script.scenes?.length ?? 0,
        npcs: a.hidden_full_script.npcs?.length ?? 0,
      };
    }),
  );

  disposers.push(
    session.onTool("generate_character_schema", (args) => {
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
    session.onTool("narrate_story", async (args) => {
      const a = args as {
        system_notice?: string;
        narrative_text: string;
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
      const store = useGameStore.getState();
      store.narrateFromTool(a.narrative_text, a.system_notice);
      store.recordHistoryTurn({
        playerInput: store.lastPlayerAction || undefined,
        aiNarrative: a.narrative_text,
      });

      if (!a.check_request) {
        return { ok: true, narrative_recorded: true };
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
        useGameStore.getState().recordHistoryTurn({
          aiNarrative: `（檢定結果已回傳）${skillLabel}`,
          diceRecord: {
            skillName: skillLabel,
            isSecret: false,
            diceType: a.check_request.dice_type,
            targetValue: resolved.target_value,
            diceResult: roll.diceResult,
            outcome: roll.outcome,
          },
        });
      }
      return roll;
    }),
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
    if (!activeAgentMessageId || s.messages.find((m) => m.id === activeAgentMessageId)?.turnId !== ctx.turnId) {
      activeAgentMessageId = s.appendMessage({
        role: "agent",
        content: delta,
        turnId: ctx.turnId,
      });
      s.setIsTyping(false);
    } else {
      const existing = s.messages.find((m) => m.id === activeAgentMessageId);
      s.updateMessage(activeAgentMessageId, (existing?.content ?? "") + delta);
    }
  });

  const offStatus = session.onStatus((status) => {
    const s = useGameStore.getState();
    s.setSessionStatus(status);
    if (status === "running") {
      s.setIsTyping(true);
      s.setSessionError(null);
      activeAgentMessageId = null;
    }
    if (status === "idle") {
      s.setIsTyping(false);
      // 不在 idle 清除 sessionError：錯誤後 Session 常回到 idle，仍需顯示重試按鈕
    }
    if (status === "error" || status === "ended") {
      s.setIsTyping(false);
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
  opts?: { skipUserMessage?: boolean },
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
  });

  await session.sendText(prompt);
}

export const OPENING_NARRATION_ACTION =
  "現在已確認角色卡。請立刻開始劇本並述說故事開場（請呼叫 narrate_story；如需檢定請使用工具，不要先等待玩家輸入）。";

/** 送出開場敘事（不寫入玩家訊息）；失敗時由呼叫端／onError 記錄 sessionError */
export async function sendOpeningNarration() {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");

  const store = useGameStore.getState();
  store.setRetryAction({ kind: "opening", label: "重試開場敘事" });
  store.setSessionError(null);

  const prompt = assemblePlayerTurnPrompt({
    script: store.script,
    houseRules: store.houseRules,
    character: store.character,
    clues: store.clues,
    npcs: store.npcs,
    madness: store.madness,
    location: store.location,
    chapterSummaries: store.chapterSummaries,
    recentMessages: [],
    playerAction: OPENING_NARRATION_ACTION,
    turn: store.turn,
    // 開場第一則一律不附推薦行動（與開關無關）
    suggestPlayerActions: false,
  });

  await session.sendText(prompt);
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
