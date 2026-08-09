import type {
  PedelecError,
  PedelecSession,
  ProviderCode,
} from "@kaoruisaac/pedelec";
import { assemblePlayerTurnPrompt } from "@/engine/contextAssembler";
import { aiCompanionsMentionedInAction } from "@/engine/companionTrigger";
import { buildOpeningPartyDirective } from "@/engine/partyNarrativeBrief";
import {
  resolveCheckOutcome,
  resolveD20Outcome,
  rollDice,
  type AdvantageMode,
} from "@/engine/dice";
import {
  cocSuccessThreshold,
  difficultyLabelWithHint,
  formatDiceResultLabels,
  isSanityCheckName,
  resolveCocAttributeValueFromSheet,
  resolveCocAttributeKeyFromCheckName,
  lookupCharacterSkill,
  parseCheckDifficulty,
  resolveSanityCheckFromSheet,
  successQualityLabel,
  type CheckDifficulty,
  type ResolvedCheckKind,
} from "@/engine/skillCheck";
import { findSrdByTopic } from "@/engine/srdLorebook";
import {
  assessScenarioScaleGaps,
  formatScenarioScaleGapsZh,
  normalizeScenarioScale,
} from "@/engine/scenarioScale";
import {
  areDuplicateNarratives,
  isCorruptedNarrativeFragment,
  isNarrativeRewrite,
} from "@/lib/narrativeDedupe";
import { requestCompanionDecision } from "@/lib/companionAi/session";
import { useAiPlayerStore } from "@/lib/aiPlayer/store";
import { normalizeNarrativeText } from "@/lib/normalizeNarrativeText";
import {
  isGmMetaOnlyNarrative,
  isCompanionWaitMeta,
  stripGmMetaPrompts,
  stripLeadingCompanionParaphrase,
} from "@/lib/stripGmMetaPrompts";
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
    character_id?: string;
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
/**
 * 隊友結算視窗：從送出 COMPANION RESOLVE 到該次 narrate_story（含檢定）結束。
 * 期間缺／錯的 character_id 會覆寫為此 id。
 */
let activeCompanionResolveId: string | null = null;
/** 同一玩家行動只自動喚起隊友一次（GM 若未呼叫 tool） */
let autoCompanionHandledForAction: string | null = null;
let autoCompanionInFlight = false;

const DICE_TIMEOUT_MS = 170_000;

function applyCompanionDecision(
  decision: Extract<
    Awaited<ReturnType<typeof requestCompanionDecision>>,
    { acted: true }
  >,
) {
  const label = `【隊友·${decision.companionName}】${decision.action}`;
  useGameStore.getState().appendMessage({
    role: "user",
    content: label,
  });
  if (decision.handoff === "immediate") {
    void beginImmediateCompanionResolve({
      companionId: decision.companionId,
      companionName: decision.companionName,
      action: decision.action,
    });
  } else {
    useGameStore.getState().setPendingCompanionHandoff({
      companionId: decision.companionId,
      companionName: decision.companionName,
      action: decision.action,
      handoff: "pause",
    });
  }
}

/** GM 未喚起 tool 時：玩家行動點名隊友 → 引擎代喚起 */
async function maybeAutoInvokeCompanions() {
  if (autoCompanionInFlight) return;
  const store = useGameStore.getState();
  if (store.phase !== "PLAYING") return;
  if (store.pendingManualEnding || store.ending) return;
  if (store.pendingDice) return;
  if (store.pendingCompanionHandoff) return;
  if (activeCompanionResolveId) return;
  const session = getActiveSession();
  if (!session || session.getStatus() !== "idle") return;

  const action = store.lastPlayerAction.trim();
  if (!action || action === autoCompanionHandledForAction) return;

  const mentioned = aiCompanionsMentionedInAction(
    action,
    store.party,
    store.playerMemberId,
  );
  if (!mentioned.length) return;

  const msgs = store.messages;
  const lastNonSystem = [...msgs].reverse().find((m) => m.role !== "system");
  if (!lastNonSystem || lastNonSystem.role === "user") return;
  const lastContent = (lastNonSystem.content ?? "").trim();
  // 內部等待狀態（例如 companion pipeline）不應觸發自動喚起，否則會造成「同拍搶話／重覆等待」的感受
  if (isCompanionWaitMeta(lastContent)) return;
  if (
    lastContent.startsWith("---") &&
    /Waiting for (?:companion|the transition to the carousel)/i.test(
      lastContent,
    )
  )
    return;

  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== "user") continue;
    if (m.content.startsWith("【隊友·")) continue;
    lastUserIdx = i;
    break;
  }
  if (lastUserIdx < 0) return;
  const sinceUser = msgs.slice(lastUserIdx + 1);
  const hasGmNarrationAfterUser = sinceUser.some(
    (m) =>
      m.role === "agent" &&
      (m.content ?? "").trim().length > 0 &&
      !isCompanionWaitMeta(m.content ?? "") &&
      !(m.content ?? "").trim().startsWith("---"),
  );
  // 讓 GM 先結算敘事後才喚起隊友，避免「PC 行動後立刻隊友搶話」
  if (!hasGmNarrationAfterUser) return;
  if (sinceUser.some((m) => m.content.startsWith("【隊友·"))) {
    autoCompanionHandledForAction = action;
    return;
  }

  autoCompanionInFlight = true;
  autoCompanionHandledForAction = action;
  try {
    const member = mentioned[0]!;
    const decision = await requestCompanionDecision({
      companionId: member.id,
      reason: "玩家剛才的指令涉及你，請考慮是否行動或發言。",
      situation: action.slice(0, 400),
    });
    if (decision.acted) {
      applyCompanionDecision(decision);
    }
  } catch {
    // 靜默；不阻斷主流程
  } finally {
    autoCompanionInFlight = false;
  }
}

function coerceCompanionCharacterId(
  requested?: string | null,
): { characterId: string | null; corrected: boolean } {
  if (!activeCompanionResolveId) {
    return { characterId: requested?.trim() || null, corrected: false };
  }
  const store = useGameStore.getState();
  const playerId = store.playerMemberId ?? store.character?.id ?? null;
  const req = requested?.trim() || null;
  if (!req || (playerId && req === playerId)) {
    return { characterId: activeCompanionResolveId, corrected: true };
  }
  return { characterId: req, corrected: false };
}

function noteCompanionIdCorrection(who: string) {
  useGameStore
    .getState()
    .appendSystem(
      `（系統）本拍為隊友結算，已將 ${who} 的 character_id 校正為該隊友。`,
    );
}

export function buildCompanionResolveExtraLayers(input: {
  companionId: string;
  companionName: string;
  action: string;
  playerSupplement?: string;
}): string[] {
  const supplement = input.playerSupplement?.trim();
  return [
    [
      "[COMPANION RESOLVE — PC NOT NPC — ANTI-REWRITE]",
      `Companion id: ${input.companionId}`,
      `Name: ${input.companionName}`,
      `Their declaration is ALREADY visible as a separate player bubble. Do NOT rewrite or paraphrase it.`,
      `Declaration (for your eyes only — never re-speak): 「${input.action}」`,
      supplement ? `Human player follow-up: ${supplement}` : "",
      `MUST use character_id=${input.companionId} on check_request / secret_check_request / update_game_stats / mark_skill_success for THIS companion's attempt.`,
      `If the companion's declaration is attempting an investigation / examination / medical / mysticism / combat maneuvre / knowledge assessment, you MUST initiate a check_request or secret_check_request for THIS attempt (and provide target_value if no sheet-matched skill exists).`,
      "FORBIDDEN in narrative_text:",
      "- Prefix 【隊友·…】 or any restatement of their spoken lines",
      `- Third-person replay of the same action (e.g.「${input.companionName}大喊…」「她忍著痛…」repeating what they already declared)`,
      "- God-moding the human PC's actions/thoughts",
      "REQUIRED:",
      "- Narrate ONLY dice outcomes, world/NPC reactions, and NEW visible consequences",
      "- If no check yet: 1–3 short sentences max of world reaction, then pause for the human player",
      "- Prefer opening with the world's response (enemy move, footing slips, NPC glance) — never re-enact the companion's declaration",
      "Then return spotlight to the human player.",
    ]
      .filter(Boolean)
      .join("\n"),
  ];
}

/** 收下隊友發言／意圖，不呼叫 GM（避免純對話被複述） */
export function acceptCompanionHandoffWithoutResolve() {
  const store = useGameStore.getState();
  if (!store.pendingCompanionHandoff) return;
  store.setPendingCompanionHandoff(null);
}

async function waitForSessionIdle(maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const s = getActiveSession();
    if (s && s.getStatus() === "idle") return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return getActiveSession()?.getStatus() === "idle";
}

let companionHandoffResolveInFlight = false;

/**
 * Session idle 時：若有因 GM 忙碌而暫存的隊友宣告（autoResume），或 AI 代打開啟中，
 * 自動送出「讓 GM 結算」，避免 UI 卡住且代打繼續搶話。
 */
async function maybeAutoResolvePendingCompanionHandoff(opts?: {
  /** 僅處理 autoResume 標記（預設）；true 時只要有 pending 就結算 */
  force?: boolean;
}) {
  if (companionHandoffResolveInFlight) return;
  const store = useGameStore.getState();
  if (store.phase !== "PLAYING") return;
  if (store.pendingManualEnding || store.ending) return;
  const handoff = store.pendingCompanionHandoff;
  if (!handoff) return;

  const force =
    Boolean(opts?.force) || useAiPlayerStore.getState().enabled;
  if (!force && !handoff.autoResume) return;

  const session = getActiveSession();
  if (!session || session.getStatus() !== "idle") return;
  if (store.pendingDice) return;
  if (activeCompanionResolveId) return;

  companionHandoffResolveInFlight = true;
  try {
    await resolvePendingCompanionHandoff();
  } catch {
    // 仍忙碌或失敗：保留 pending，下一次 idle 再試
  } finally {
    companionHandoffResolveInFlight = false;
  }
}

/** 軟停「讓 GM 結算」或玩家插話後，送出隊友結算給 GM */
export async function resolvePendingCompanionHandoff(opts?: {
  playerSupplement?: string;
}) {
  const store = useGameStore.getState();
  const handoff = store.pendingCompanionHandoff;
  if (!handoff) {
    throw new Error("NO_PENDING_COMPANION_HANDOFF");
  }
  // 先清 UI，避免結算過程中仍顯示「可插話」
  store.setPendingCompanionHandoff(null);
  activeCompanionResolveId = handoff.companionId;

  const layers = buildCompanionResolveExtraLayers({
    companionId: handoff.companionId,
    companionName: handoff.companionName,
    action: handoff.action,
    playerSupplement: opts?.playerSupplement,
  });
  const label = `【隊友·${handoff.companionName}】${handoff.action}`;

  const idle = await waitForSessionIdle();
  if (!idle) {
    activeCompanionResolveId = null;
    // 還原 pending，並標記可自動重試
    useGameStore.getState().setPendingCompanionHandoff({
      ...handoff,
      handoff: "pause",
      autoResume: true,
    });
    throw new Error("SESSION_BUSY");
  }

  try {
    if (opts?.playerSupplement?.trim()) {
      await sendPlayerAction(opts.playerSupplement.trim(), {
        skipUserMessage: false,
        extraLayers: layers,
        companionResolve: true,
      });
    } else {
      await sendPlayerAction(label, {
        skipUserMessage: true,
        extraLayers: layers,
        companionResolve: true,
      });
    }
  } catch (e) {
    activeCompanionResolveId = null;
    useGameStore.getState().setPendingCompanionHandoff({
      ...handoff,
      handoff: "pause",
      autoResume: true,
    });
    throw e;
  }
}

async function beginImmediateCompanionResolve(input: {
  companionId: string;
  companionName: string;
  action: string;
}) {
  activeCompanionResolveId = input.companionId;
  useGameStore.getState().setPendingCompanionHandoff(null);
  const label = `【隊友·${input.companionName}】${input.action}`;
  const layers = buildCompanionResolveExtraLayers(input);
  void (async () => {
    const idle = await waitForSessionIdle(160);
    if (!idle) {
      useGameStore
        .getState()
        .appendSystem(
          `隊友「${input.companionName}」的行動已記錄，但 GM 忙碌；系統將在 GM 空閒後自動結算。`,
        );
      useGameStore.getState().setPendingCompanionHandoff({
        companionId: input.companionId,
        companionName: input.companionName,
        action: input.action,
        handoff: "pause",
        autoResume: true,
      });
      activeCompanionResolveId = null;
      return;
    }
    try {
      await sendPlayerAction(label, {
        skipUserMessage: true,
        extraLayers: layers,
        companionResolve: true,
      });
    } catch {
      activeCompanionResolveId = null;
      useGameStore
        .getState()
        .appendSystem(
          `隊友「${input.companionName}」的行動已記錄，但 GM 接續失敗；系統將在空閒後自動重試結算。`,
        );
      useGameStore.getState().setPendingCompanionHandoff({
        companionId: input.companionId,
        companionName: input.companionName,
        action: input.action,
        handoff: "pause",
        autoResume: true,
      });
    }
  })();
}

function resolveCheckAgainstSheet(args: {
  check_target_name: string;
  dice_type: string;
  target_value?: number;
  difficulty?: string;
  character_id?: string | null;
}): {
  target_value?: number;
  skill_value?: number;
  difficulty: CheckDifficulty;
  sheetSkillName?: string;
  checkKind: ResolvedCheckKind;
} {
  const difficulty = parseCheckDifficulty(args.difficulty);
  const isD100 = args.dice_type.toLowerCase().includes("100");
  const sheet = useGameStore.getState().getSheetById(args.character_id);

  if (isD100 && isSanityCheckName(args.check_target_name)) {
    const sanResolved = resolveSanityCheckFromSheet(sheet);
    if (sanResolved) {
      return {
        target_value: sanResolved.target_value,
        skill_value: sanResolved.skill_value,
        difficulty: "regular",
        sheetSkillName: "理智",
        checkKind: "sanity",
      };
    }
  }

  const hit = lookupCharacterSkill(sheet, args.check_target_name);

  // CoC：屬性名（力量／敏捷…）優先於同名「假技能」——角色卡若誤建「敏捷:5」不可蓋掉 DEX
  if (isD100 && sheet?.system_id === "COC_7E") {
    const attrVal = resolveCocAttributeValueFromSheet(
      sheet,
      args.check_target_name,
    );
    if (attrVal != null) {
      const threshold = cocSuccessThreshold(attrVal, difficulty);
      return {
        target_value: threshold,
        skill_value: attrVal,
        difficulty,
        sheetSkillName: args.check_target_name,
        checkKind: "attribute",
      };
    }
  }

  if (isD100 && hit) {
    const threshold = cocSuccessThreshold(hit.value, difficulty);
    return {
      target_value: threshold,
      skill_value: hit.value,
      difficulty,
      sheetSkillName: hit.name,
      checkKind: "skill",
    };
  }

  // 自訂目標（GM 提供 target_value，技能欄未對上）
  return {
    target_value: args.target_value,
    skill_value: hit?.value,
    difficulty,
    sheetSkillName: hit?.name,
    checkKind: hit ? "skill" : "custom",
  };
}

function isCompanionDiceCheck(characterId?: string | null): boolean {
  if (activeCompanionResolveId) return true;

  const store = useGameStore.getState();
  const playerId = store.playerMemberId ?? store.character?.id ?? null;
  const cid = characterId?.trim();
  if (!cid) return false;
  if (playerId && cid === playerId) return false;

  const member = store.party.find(
    (m) => m.id === cid || m.sheet?.id === cid,
  );
  return member?.controller === "ai";
}

function formatDiceThresholdNote(input: {
  check_target_name: string;
  target_value?: number;
  skill_value?: number;
  difficulty?: CheckDifficulty;
}): string {
  if (
    isSanityCheckName(input.check_target_name) &&
    input.skill_value != null
  ) {
    return `，門檻 ≤${input.target_value}（當前 SAN ${input.skill_value}）`;
  }
  const attrKey = resolveCocAttributeKeyFromCheckName(input.check_target_name);
  if (attrKey && input.skill_value != null && input.target_value != null) {
    return `，門檻 ≤${input.target_value}（屬性 ${input.check_target_name} ${input.skill_value}）`;
  }
  if (input.skill_value != null && input.target_value != null) {
    const diff = difficultyLabelWithHint(input.difficulty ?? "regular");
    return `，${diff}，門檻 ≤${input.target_value}（技能 ${input.skill_value}%）`;
  }
  if (input.target_value != null) {
    return `，門檻 ≤${input.target_value}`;
  }
  return "";
}

function performPublicDiceRoll(input: {
  dice_type: string;
  check_target_name: string;
  target_value?: number;
  skill_value?: number;
  difficulty?: CheckDifficulty;
  dnd_advantage_mode?: string;
}): {
  diceResult: number;
  outcome: string;
  detail: string;
  thresholdNote: string;
} {
  const mode = (input.dnd_advantage_mode ?? "normal") as AdvantageMode;
  const rolled = rollDice(input.dice_type, mode);
  const natural = rolled.rolls[0] ?? rolled.total;
  const outcome = input.dice_type.toLowerCase().includes("20")
    ? resolveD20Outcome(natural, rolled.total, input.target_value)
    : resolveCheckOutcome(
        input.dice_type,
        rolled.total,
        input.target_value,
        input.skill_value,
      );
  return {
    diceResult: rolled.total,
    outcome,
    detail: rolled.detail,
    thresholdNote: formatDiceThresholdNote(input),
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
  character_id?: string | null;
}): Promise<{
  request_id: string;
  diceResult: number;
  outcome: string;
  detail: string;
  cancelled?: boolean;
}> {
  const resolved = resolveCheckAgainstSheet(args);
  const displayName = resolved.sheetSkillName ?? args.check_target_name;

  if (isCompanionDiceCheck(args.character_id)) {
    const store = useGameStore.getState();
    const whoSheet = store.getSheetById(args.character_id);
    const whoLabel = whoSheet?.name?.trim() ? `「${whoSheet.name}」` : "隊友";
    const rolled = performPublicDiceRoll({
      dice_type: args.dice_type,
      check_target_name: displayName,
      target_value: resolved.target_value,
      skill_value: resolved.skill_value,
      difficulty: resolved.difficulty,
      dnd_advantage_mode: args.dnd_advantage_mode,
    });
    store.appendSystem(
      `擲骰結果：${whoLabel}${displayName} → ${rolled.detail}（${formatDiceResultLabels({
        outcome: rolled.outcome,
        difficulty: resolved.difficulty,
      })}${rolled.thresholdNote}）`,
    );
    return Promise.resolve({
      request_id: args.request_id,
      diceResult: rolled.diceResult,
      outcome: rolled.outcome,
      detail: rolled.detail,
    });
  }

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
  let narrativeText = stripGmMetaPrompts(
    normalizeNarrativeText(a.narrative_text),
  );

  // 隊友結算：剝掉複讀隊友氣泡／第三人稱重演，避免「隊友講完 GM 再講一遍」
  if (activeCompanionResolveId) {
    const msgs = useGameStore.getState().messages;
    let companionName = "";
    let companionAction = "";
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || m.role !== "user") continue;
      const matched = m.content.match(/^【隊友[·・]([^】]+)】(.*)$/s);
      if (matched) {
        companionName = matched[1]?.trim() ?? "";
        companionAction = (matched[2] ?? "").trim();
        break;
      }
    }
    if (companionName) {
      narrativeText = stripLeadingCompanionParaphrase(
        narrativeText,
        companionName,
      );
    }
    if (
      companionAction &&
      narrativeText &&
      !/【檢定結果/.test(narrativeText) &&
      (isNarrativeRewrite(companionAction, narrativeText) ||
        areDuplicateNarratives(companionAction, narrativeText))
    ) {
      narrativeText = "";
    }
  }

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

  if (narrativeText.trim()) {
    store.narrateFromTool(narrativeText, a.system_notice);
  } else if (a.system_notice?.trim()) {
    store.appendSystem(a.system_notice);
  }

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
    // 結局提示出現後立刻停 AI 代打，避免繼續搶話
    if (useAiPlayerStore.getState().enabled) {
      useAiPlayerStore
        .getState()
        .setLastError(
          "偵測到結局／可手動結算提示，已暫停 AI 代打。請確認後進入結局結算。",
        );
      useAiPlayerStore.getState().setEnabled(false);
    }
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
    // 勿在此清除 activeCompanionResolveId：同回合 GM 常先 narrate 再 check_request，
    // 提早清除會讓隊友檢定落到「玩家擲骰 UI」→ 取消／逾時 → 判定變已取消。
    return { ok: true as const, narrative_recorded: true as const };
  }

  const coerced = coerceCompanionCharacterId(a.check_request.character_id);
  if (coerced.corrected) {
    noteCompanionIdCorrection("check_request");
  }
  const checkRequest = {
    ...a.check_request,
    character_id: coerced.characterId ?? undefined,
  };

  const resolved = resolveCheckAgainstSheet(checkRequest);
  const skillLabel = resolved.sheetSkillName ?? checkRequest.check_target_name;
  const whoSheet = useGameStore
    .getState()
    .getSheetById(checkRequest.character_id);
  const whoLabel = whoSheet?.name?.trim()
    ? `「${whoSheet.name}」`
    : "角色";
  const thresholdText =
    resolved.checkKind === "sanity" && resolved.skill_value != null
      ? `${whoLabel}當前 SAN ${resolved.skill_value}，成功需 ≤ ${resolved.target_value}（CoC 理智檢定）`
      : resolved.checkKind === "attribute" &&
          resolved.skill_value != null &&
          resolved.target_value != null
        ? `${whoLabel}屬性「${skillLabel}」${resolved.skill_value}，成功需 ≤ ${resolved.target_value}`
      : resolved.skill_value != null && resolved.target_value != null
        ? `${whoLabel}角色卡「${skillLabel}」${resolved.skill_value}% · ${difficultyLabelWithHint(resolved.difficulty)}，成功需 ≤ ${resolved.target_value}`
        : resolved.target_value != null
          ? `${whoLabel}目標值 ${resolved.target_value}`
          : `${whoLabel}未找到對應角色卡技能（將無法依技能％判定）`;

  store.appendSystem(
    `需要檢定：${whoLabel}${skillLabel}（${checkRequest.dice_type}）— ${checkRequest.reason}\n${thresholdText}`,
  );

  let roll = await waitForPlayerDice({
    ...checkRequest,
    difficulty: checkRequest.difficulty ?? resolved.difficulty,
  });
  // 隊友檢定絕不可落到「已取消／不進行」；若誤走玩家 UI 被取消，強制改為自動擲骰
  if (
    roll.cancelled &&
    (activeCompanionResolveId ||
      isCompanionDiceCheck(checkRequest.character_id))
  ) {
    const forcedId =
      checkRequest.character_id?.trim() || activeCompanionResolveId || null;
    roll = await waitForPlayerDice({
      ...checkRequest,
      character_id: forcedId,
      difficulty: checkRequest.difficulty ?? resolved.difficulty,
    });
  }
  if (!roll.cancelled) {
    pendingPublicDiceRecord = {
      skillName: skillLabel,
      isSecret: false,
      diceType: checkRequest.dice_type,
      targetValue: resolved.target_value,
      diceResult: roll.diceResult,
      outcome: roll.outcome,
    };
    if (
      resolved.checkKind === "skill" &&
      isSuccessDiceOutcome(roll.outcome)
    ) {
      useGameStore
        .getState()
        .markSkillSuccess(skillLabel, checkRequest.character_id);
    }
  }

  const sheetSkills = whoSheet?.skills ?? {};
  const skillHint = Object.entries(sheetSkills)
    .map(([k, v]) => `${k}${v}%`)
    .slice(0, 12)
    .join("、");

  activeCompanionResolveId = null;

  return {
    ...roll,
    outcome_zh: successQualityLabel(roll.outcome),
    difficulty: resolved.difficulty,
    difficulty_zh: difficultyLabelWithHint(resolved.difficulty),
    result_zh: formatDiceResultLabels({
      outcome: roll.outcome,
      difficulty: resolved.difficulty,
    }),
    gm_instruction:
      "CRITICAL: Your next narrate_story.narrative_text must ONLY describe this check outcome and immediate consequences. Do NOT repeat, paraphrase, or rewrite any previously narrated scene text. Prefer updating location/scene_id/npc_updates if the scene changed. Sheet skills for " +
      whoLabel +
      ": " +
      (skillHint || "（無）") +
      `. Dice result labels (Traditional Chinese): ${formatDiceResultLabels({
        outcome: roll.outcome,
        difficulty: resolved.difficulty,
      })}. Engine outcome_zh=${successQualityLabel(roll.outcome)}. You MUST use this exact success-quality label — if it is 失敗, do NOT write 大失敗; only FUMBLE is 大失敗. Use 成功品質 wording (普通成功／困難級成功≤半值／極限級成功≤⅕／失敗／大失敗), not casual「很辛苦才成功」. On FAILURE: no full key_clue dump / no soft-win climax.`,
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
          creatures?: {
            id: string;
            name: string;
            kind: string;
            attributes?: Record<string, number>;
            hp: number;
            armor?: number;
            mov?: number;
            build?: number;
            damage_bonus?: string;
            attacks: {
              name: string;
              skill_pct: number;
              damage: string;
              attacks_per_round?: number;
            }[];
            san_loss_on_sight?: string;
            armor_notes?: string;
            powers?: string;
            combat_notes?: string;
            linked_npc_id?: string;
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
        recommended_party_size?: number;
        party_role_hints?: { role_title: string; brief: string }[];
      };
      useGameStore.getState().setupScript(a);
      const gaps = assessScenarioScaleGaps({
        scale: a.scenario_scale,
        key_clues: a.hidden_full_script.key_clues,
        timeline: a.hidden_full_script.timeline,
        scenes: a.hidden_full_script.scenes,
        npcs: a.hidden_full_script.npcs,
        creatures: a.hidden_full_script.creatures,
        acts: a.hidden_full_script.acts,
        factions: a.hidden_full_script.factions,
      });
      const gapNote = formatScenarioScaleGapsZh(gaps);
      if (gapNote) {
        useGameStore
          .getState()
          .appendSystem(
            `劇本規模深度不足（${normalizeScenarioScale(a.scenario_scale)}）：${gapNote}。可請 GM 再呼叫 setup_script 補齊，或接受較薄的即興局。`,
          );
      }
      return {
        ok: true,
        system_id: a.system_id,
        scenario_scale: a.scenario_scale ?? null,
        scenes: a.hidden_full_script.scenes?.length ?? 0,
        npcs: a.hidden_full_script.npcs?.length ?? 0,
        creatures: a.hidden_full_script.creatures?.length ?? 0,
        tone_examples: a.tone_examples?.length ?? 0,
        scale_gaps: gaps,
        scale_gap_note: gapNote || null,
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
      const raw = args as {
        request_id: string;
        check_target_name: string;
        dice_type: string;
        target_value?: number;
        difficulty?: string;
        reason_for_gm: string;
        character_id?: string;
      };
      const coerced = coerceCompanionCharacterId(raw.character_id);
      if (coerced.corrected) {
        noteCompanionIdCorrection("secret_check_request");
      }
      const a = {
        ...raw,
        character_id: coerced.characterId ?? undefined,
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

      if (resolved.checkKind === "skill" && isSuccessDiceOutcome(outcome)) {
        store.markSkillSuccess(
          resolved.sheetSkillName ?? a.check_target_name,
          a.character_id,
        );
      }

      return {
        request_id: a.request_id,
        diceResult: rolled.total,
        outcome,
        outcome_zh: successQualityLabel(outcome),
        difficulty: resolved.difficulty,
        difficulty_zh: difficultyLabelWithHint(resolved.difficulty),
        result_zh: formatDiceResultLabels({
          outcome,
          difficulty: resolved.difficulty,
        }),
        detail: rolled.detail,
        isSecret: true,
        target_value: resolved.target_value,
        skill_value: resolved.skill_value,
        character_id: a.character_id ?? null,
      };
    }),
  );

  disposers.push(
    session.onTool("update_game_stats", (args) => {
      const raw = args as {
        character_id?: string;
        stat_changes: { key: string; change_amount: number; reason: string }[];
        inventory_add?: string[];
        inventory_remove?: string[];
      };
      const coerced = coerceCompanionCharacterId(raw.character_id);
      if (coerced.corrected) {
        noteCompanionIdCorrection("update_game_stats");
      }
      const characterId = coerced.characterId ?? undefined;
      useGameStore
        .getState()
        .applyStatChanges(
          raw.stat_changes,
          raw.inventory_add,
          raw.inventory_remove,
          characterId,
        );
      const sheet = useGameStore.getState().getSheetById(characterId);
      return {
        ok: true,
        character_id: sheet?.id,
        hp: sheet?.derived.hp,
        san: sheet?.derived.san,
        inventory: sheet?.inventory,
      };
    }),
  );

  disposers.push(
    session.onTool("mark_skill_success", (args) => {
      const raw = args as {
        skill_name: string;
        reason: string;
        character_id?: string;
      };
      const coerced = coerceCompanionCharacterId(raw.character_id);
      if (coerced.corrected) {
        noteCompanionIdCorrection("mark_skill_success");
      }
      useGameStore
        .getState()
        .markSkillSuccess(raw.skill_name, coerced.characterId);
      return { ok: true, skill_name: raw.skill_name };
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
      // 結局後不允許再跑隊友/檢定流程
      activeCompanionResolveId = null;
      autoCompanionHandledForAction = null;
      useGameStore.getState().setPendingCompanionHandoff(null);
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
    session.onTool("request_companion_action", async (args) => {
      const a = args as {
        companion_id: string;
        reason: string;
        situation?: string;
        prefer_immediate?: boolean;
      };
      const store = useGameStore.getState();
      if (store.phase !== "PLAYING") {
        // 結局/結算中或其他非遊玩階段：拒絕新的隊友動作請求
        return {
          ok: true,
          acted: false,
          companion_id: a.companion_id,
        };
      }
      const member = useGameStore
        .getState()
        .party.find(
          (m) => m.id === a.companion_id || m.sheet.id === a.companion_id,
        );
      if (!member || member.controller !== "ai") {
        return {
          ok: false,
          acted: false,
          error: "companion_id 不是有效的 AI 隊友",
        };
      }

      try {
        const decision = await requestCompanionDecision({
          companionId: member.id,
          reason: a.reason,
          situation: a.situation,
          preferImmediate: Boolean(a.prefer_immediate),
        });
        if (!decision.acted) {
          // 靜默：不寫入任何玩家可見訊息
          return { ok: true, acted: false, companion_id: member.id };
        }

        applyCompanionDecision(decision);

        return {
          ok: true,
          acted: true,
          companion_id: member.id,
          companion_name: decision.companionName,
          action: decision.action,
          handoff: decision.handoff,
        };
      } catch (e) {
        return {
          ok: false,
          acted: false,
          error: e instanceof Error ? e.message : "companion_failed",
        };
      }
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
    if (chatId && chatContent.trim().length >= 12) {
      const stripped = stripGmMetaPrompts(chatContent);
      if (!stripped.trim() || isGmMetaOnlyNarrative(chatContent)) {
        useGameStore.setState((st) => ({
          messages: st.messages.filter((m) => m.id !== chatId),
        }));
        activeAgentMessageId = null;
      } else if (stripped !== chatContent.trim()) {
        s.updateMessage(chatId, stripped);
      } else {
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
      void maybeAutoResolvePendingCompanionHandoff();
      void maybeAutoInvokeCompanions();
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
      activeCompanionResolveId = null;
      autoCompanionHandledForAction = null;
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
  opts?: {
    skipUserMessage?: boolean;
    extraLayers?: string[];
    /** 內部：正在結算隊友宣告，勿再轉成 handoff resolve */
    companionResolve?: boolean;
  },
) {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");

  const store = useGameStore.getState();

  // PC 新行動進來時若仍有未結算的隊友宣告：先結算（把本行動當插話），避免 UI 卡住
  if (!opts?.companionResolve && store.pendingCompanionHandoff) {
    await resolvePendingCompanionHandoff({ playerSupplement: text });
    return;
  }

  // 非隊友結算的玩家行動：關閉上一拍隊友 resolve 視窗（避免誤套 character_id）
  if (!opts?.companionResolve) {
    activeCompanionResolveId = null;
  }

  store.setLastPlayerAction(text);
  autoCompanionHandledForAction = null;
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
    party: store.party,
    playerMemberId: store.playerMemberId,
  });

  await session.sendText(prompt);
}

export const OPENING_NARRATION_ACTION =
  [
    "現在已確認角色卡。請立刻開始劇本並述說故事開場（請呼叫 narrate_story）。",
    "開場必須包含：明確時間、地點（並設定 location）、感官細節、NPC／環境帶來的眼前壓力或疑問。",
    "【禁止代操 PC・開場強制】不可替玩家決定、描述或執行任何行動、對話、意圖或內心獨白（例如「你遞過茶杯」「你試圖說服」「你決定追問」皆禁止）。",
    "可寫：場景、氛圍、NPC 先開口／姿態、隊友靜態在場；最後停在「球在玩家手上」——等待玩家輸入。",
    "開場第一則禁止對玩家 PC 發動 check_request（不要假設玩家已採取交涉／偵查等行動）。若需檢定，等玩家宣告行動後再呼叫。",
    "不要先等待玩家輸入才寫開場；寫完場面後暫停即可。若開場後玩家已行動並有檢定結果：下一次 narrate_story 只寫檢定結果與當下後續，禁止重寫已述說過的開場文字。",
  ].join("");

/** 依目前隊伍組裝開場指令（有 AI 隊友時強制點名介紹） */
export function buildOpeningNarrationAction(input: {
  party: import("@/types/party").PartyMember[];
  playerMemberId?: string | null;
}): string {
  const partyBlock = buildOpeningPartyDirective(
    input.party,
    input.playerMemberId,
  );
  return [OPENING_NARRATION_ACTION, partyBlock].filter(Boolean).join("\n");
}

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
    playerAction: buildOpeningNarrationAction({
      party: latest.party,
      playerMemberId: latest.playerMemberId,
    }),
    turn: latest.turn,
    // 開場第一則一律不附推薦行動（與開關無關）
    suggestPlayerActions: false,
    sceneDirector: latest.sceneDirector,
    party: latest.party,
    playerMemberId: latest.playerMemberId,
    continuityPremiseZh: latest.continuityBridge?.premiseZh ?? null,
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

  const rolled = performPublicDiceRoll({
    dice_type: pendingDice.dice_type,
    check_target_name: pendingDice.check_target_name,
    target_value: pendingDice.target_value,
    skill_value: pendingDice.skill_value,
    difficulty: pendingDice.difficulty,
    dnd_advantage_mode:
      opts.advantageMode ?? pendingDice.dnd_advantage_mode ?? "normal",
  });

  useGameStore
    .getState()
    .appendSystem(
      `擲骰結果：${pendingDice.check_target_name} → ${rolled.detail}（${formatDiceResultLabels({
        outcome: rolled.outcome,
        difficulty: pendingDice.difficulty,
      })}${rolled.thresholdNote}）`,
    );

  diceResolver({
    request_id: pendingDice.request_id,
    diceResult: rolled.diceResult,
    outcome: rolled.outcome,
    detail: rolled.detail,
  });
}
