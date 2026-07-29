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

function waitForPlayerDice(args: {
  request_id: string;
  check_target_name: string;
  dice_type: string;
  target_value?: number;
  dnd_advantage_mode?: string;
  reason: string;
}): Promise<{
  request_id: string;
  diceResult: number;
  outcome: string;
  detail: string;
  cancelled?: boolean;
}> {
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
        check_target_name: args.check_target_name,
        dice_type: args.dice_type,
        target_value: args.target_value,
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
        public_summary: {
          title: string;
          background: string;
          protagonist_role: string;
          genre: string;
        };
        hidden_full_script: {
          truth_and_secrets: string;
          key_clues: string[];
          winning_condition: string;
        };
        recommended_creation_mode: string;
      };
      useGameStore.getState().setupScript(a);
      return { ok: true, system_id: a.system_id };
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
    session.onTool("narrate_story", async (args) => {
      const a = args as {
        system_notice?: string;
        narrative_text: string;
        check_request?: {
          request_id: string;
          check_target_name: string;
          dice_type: string;
          target_value?: number;
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

      store.appendSystem(
        `需要檢定：${a.check_request.check_target_name}（${a.check_request.dice_type}）— ${a.check_request.reason}`,
      );

      const roll = await waitForPlayerDice(a.check_request);
      if (!roll.cancelled) {
        useGameStore.getState().recordHistoryTurn({
          aiNarrative: `（檢定結果已回傳）${a.check_request.check_target_name}`,
          diceRecord: {
            skillName: a.check_request.check_target_name,
            isSecret: false,
            diceType: a.check_request.dice_type,
            targetValue: a.check_request.target_value,
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
        reason_for_gm: string;
      };
      const store = useGameStore.getState();
      store.setSecretRollActive(true);
      store.appendSystem("GM 暗骰進行中…（點數將於結局時間軸揭曉）");

      const rolled = rollDice(a.dice_type, "normal");
      const outcome = a.dice_type.toLowerCase().includes("20")
        ? resolveD20Outcome(rolled.rolls[0] ?? rolled.total, rolled.total, a.target_value)
        : resolveCheckOutcome(a.dice_type, rolled.total, a.target_value);

      store.recordHistoryTurn({
        aiNarrative: `（暗骰）${a.reason_for_gm}`,
        diceRecord: {
          skillName: a.check_target_name,
          isSecret: true,
          diceType: a.dice_type,
          targetValue: a.target_value,
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
      activeAgentMessageId = null;
    }
    if (status === "idle" || status === "error" || status === "ended") {
      s.setIsTyping(false);
    }
    if (status === "waiting_tool_result") {
      s.setIsTyping(false);
    }
  });

  const offError = session.onError((error: PedelecError) => {
    useGameStore
      .getState()
      .appendSystem(`錯誤：${error.code} — ${error.message}`);
    useGameStore.getState().setIsTyping(false);
  });

  const offEnded = session.onEnded(() => {
    settlePendingDiceOnTeardown();
    useGameStore.getState().setSessionStatus("ended");
    useGameStore.getState().setIsTyping(false);
    useGameStore.getState().appendSystem("Pedelec Session 已結束。");
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

export async function sendPlayerAction(text: string) {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");

  const store = useGameStore.getState();
  store.setLastPlayerAction(text);
  store.appendMessage({ role: "user", content: text });

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
  });

  await session.sendText(prompt);
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
      );

  useGameStore
    .getState()
    .appendSystem(
      `擲骰結果：${pendingDice.check_target_name} → ${rolled.detail}（${outcome}）`,
    );

  diceResolver({
    request_id: pendingDice.request_id,
    diceResult: rolled.total,
    outcome,
    detail: rolled.detail,
  });
}
