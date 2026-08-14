import type {
  PedelecError,
  PedelecSession,
  PedelecSessionStatus,
  ProviderCode,
} from "@kaoruisaac/pedelec";
import {
  findRecentSuccessfulCheck,
  makeCheckFingerprint,
  recordSuccessfulCheck,
} from "@/engine/checkDedup";
import { assemblePlayerTurnPrompt } from "@/engine/contextAssembler";
import {
  formatLookupGameState,
  formatLookupHistory,
} from "@/engine/gmMemoryLookup";
import { PROVIDER_COMPACT_EVERY } from "@/engine/gmMemoryPolicy";
import {
  badEndingWinConflictWarning,
  noteNarrativeForWinProgress,
} from "@/engine/winFlags";
import {
  aiCompanionsMentionedInAction,
  companionActionNeedsCheck,
} from "@/engine/companionTrigger";
import { buildOpeningPartyDirective } from "@/engine/partyNarrativeBrief";
import {
  looksLikeCombatCheckName,
  resolveCheckOutcome,
  resolveD20Outcome,
  rollDamageFormula,
  rollDice,
  type AdvantageMode,
} from "@/engine/dice";
import { isCthulhuMythosSkillName } from "@/engine/mythosGrowth";
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
  lookupScenarioTerm,
  normalizeScenarioTermKind,
  patchSceneDirectorFromNarrate,
} from "@/engine/scenarioLorebook";
import {
  detectNarrativeHygieneIssue,
  detectWinSpoilerDump,
  buildWinAskDirective,
  buildWinSpoilerGmInstruction,
  playerActionAsksForWinPath,
} from "@/engine/antiSpoiler";
import {
  detectMythosSanSighting,
  markMythosSanSightingSeen,
  resetMythosSanSightings,
} from "@/engine/mythosSanHint";
import {
  assessScenarioScaleGaps,
  formatScenarioScaleGapsZh,
  normalizeScenarioScale,
} from "@/engine/scenarioScale";
import {
  areDuplicateNarratives,
  isCorruptedNarrativeFragment,
  isNarrativeRewrite,
  uniqueNarrativeSuffix,
} from "@/lib/narrativeDedupe";
import {
  companionAlreadyHasGmReply,
  findLastAgentMessage,
  isBlockingPlayerMessage,
  isCompanionLabeledAction,
} from "@/lib/playTurnState";
import { requestCompanionDecision } from "@/lib/companionAi/session";
import { useAiPlayerStore } from "@/lib/aiPlayer/store";
import { normalizeNarrativeText } from "@/lib/normalizeNarrativeText";
import {
  isGmMetaOnlyNarrative,
  isCompanionWaitMeta,
  isCompanionSpeechOnly,
  stripGmMetaPrompts,
  stripLeadingCompanionParaphrase,
} from "@/lib/stripGmMetaPrompts";
import {
  extractEndingTitleFromNarrative,
  looksLikeEndingNarrative,
} from "@/lib/endingDetect";
import { hadPriorOpeningAttempt } from "@/lib/openingRetry";
import {
  gateOutgoingPrompt,
  isOutgoingPromptCancelled,
} from "@/lib/outgoingPromptGate";
import { explicitSessionModel, pedelec } from "@/lib/pedelec/client";
import {
  EVENT_CHANNEL_FAILED_MESSAGE,
  isPedelecEventChannelFailure,
  markPedelecEventChannelFailed,
  normalizePedelecSessionStatus,
  sessionStatusNeedsRebuild,
  waitForPedelecSessionSettled,
  waitForPedelecTurnSignal,
} from "@/lib/pedelec/sessionLiveness";
import { resolvePlayerBoundSheet } from "@/types/party";
import {
  isCompleteLeakedPayload,
  looksLikeLeakedToolCall,
  tryParseLeakedToolCall,
  type LeakedToolCall,
} from "@/lib/pedelec/leakedToolCall";
import { persistPedelecSessionId } from "@/lib/storage";
import {
  formatPriorScriptDesignDetail,
  GM_SESSION_GUIDANCE,
} from "@/prompts/gmDirectives";
import {
  loadRecentScriptDesigns,
} from "@/lib/campaignStorage";
import {
  resetScenarioBibleAssetCache,
  syncGmStandingRulesAsset,
  syncScenarioBibleAsset,
} from "@/lib/pedelec/sessionAssets";
import { useGameStore } from "@/store/useGameStore";
import {
  allSessionTools,
  listToolsForLookup,
  playingSessionTools,
  type SessionToolName,
} from "@/tools/definitions";
import {
  disposeCompanionSession,
} from "@/lib/companionAi/session";
import { disposeAiPlayerSession } from "@/lib/aiPlayer/session";
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
  session: PedelecSession<SessionToolName>;
  dispose: () => void;
};

function joinGmInstructions(
  ...parts: (string | undefined | null | false)[]
): string | undefined {
  const text = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join("\n");
  return text || undefined;
}

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
    damage_dice?: string;
  };
};

let activeHandle: GameSessionHandle | null = null;
let activeAgentMessageId: string | null = null;
/** store 偶發沒跟上 live status；waiting_tool_result 卡住時用來計時 */
let waitingToolSince: number | null = null;
let missingSetupScriptWarned = false;
const WAITING_TOOL_STUCK_MS = 90_000;
/** sendText 後若一直 running、完全沒有 chat／tool，視為網頁沒接到 turn */
const RUNNING_STUCK_MS = 120_000;
/** 玩家行動／開場已開始，但 sendText 尚未送出（compact／重建中） */
let gmTurnInFlight = false;
/** 本輪 sendText 已送出，之後的 idle 才是真正回合結束 */
let gmSendStarted = false;
let lastGmActivityAt: number | null = null;
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
/** 隊友開槍／刺擊／燒灼等宣告後，若 GM 未帶 check_request 則由引擎代骰 */
let pendingCompanionCombatCheck: {
  companionId: string;
  companionName: string;
  skillHint: string;
  action: string;
} | null = null;
/** 供 conversation 壓縮時重建同 provider／model */
let lastCreateOptions: { provider: ProviderCode; model?: string } | null =
  null;
/** 自上次 create／compact 起的 session.sendText 次數 */
let providerSendCount = 0;
let compactInFlight = false;
/** 目前 GM session 掛的 tool 清單（Session 0 全套 vs PLAYING 精簡） */
let activeToolset: "session0" | "playing" = "session0";

function toolsetForPhase(
  phase: string,
): "session0" | "playing" {
  return phase === "PLAYING" || phase === "ENDING" ? "playing" : "session0";
}

const DICE_TIMEOUT_MS = 170_000;

function applyCompanionDecision(
  decision: Extract<
    Awaited<ReturnType<typeof requestCompanionDecision>>,
    { acted: true }
  >,
  opts?: {
    /** GM 正在 request_companion_action 同一輪：說完後 GM 會繼續，不可再開第二輪 */
    fromGmTool?: boolean;
    openingBeat?: boolean;
  },
) {
  const label = `【隊友·${decision.companionName}】${decision.action}`;
  useGameStore.getState().appendMessage({
    role: "user",
    content: label,
  });
  if (!opts?.openingBeat) {
    const combatNeed = companionActionNeedsCheck(decision.action);
    if (combatNeed) {
      pendingCompanionCombatCheck = {
        companionId: decision.companionId,
        companionName: decision.companionName,
        skillHint: combatNeed.skillHint,
        action: decision.action,
      };
    }
  }
  // 開場或 GM tool 同一輪：只掛氣泡。GM 會在 tool 回傳後自己寫世界反應。
  if (opts?.fromGmTool || opts?.openingBeat) {
    return;
  }
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
      `If the companion's declaration is attempting an investigation / examination / medical / mysticism / combat maneuvre / knowledge assessment, you MUST initiate a check_request or secret_check_request for THIS attempt (and provide target_value if no sheet-matched skill exists). Prefer the skill that matches the attempt — do not default investigation to 偵查/Spot Hidden.`,
      `Firearm / stab / burn / lockpick / first-aid: check_request is MANDATORY for character_id=${input.companionId}. Engine may auto-roll if omitted. Never narrate a hit without dice.`,
      "FORBIDDEN in narrative_text:",
      "- Prefix 【隊友·…】 or any restatement of their spoken lines",
      `- Third-person replay of the same action (e.g.「${input.companionName}大喊…」「她忍著痛…」repeating what they already declared)`,
      "- God-moding the human PC's actions/thoughts",
      "- Spelling exact win steps / ritual parameters / full Win paths to the player",
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
  if (companionAlreadyHasGmReply(store.messages, handoff.companionName)) {
    store.setPendingCompanionHandoff(null);
    return;
  }
  if (isCompanionSpeechOnly(handoff.action) && !opts?.force) {
    // 純發言且 GM 已有機會反應：不要自動再開一輪複述
    return;
  }

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
  skipUserMessage?: boolean;
}) {
  const store = useGameStore.getState();
  const handoff = store.pendingCompanionHandoff;
  if (!handoff) {
    throw new Error("NO_PENDING_COMPANION_HANDOFF");
  }
  if (
    !opts?.playerSupplement?.trim() &&
    companionAlreadyHasGmReply(store.messages, handoff.companionName)
  ) {
    store.setPendingCompanionHandoff(null);
    return;
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
        skipUserMessage: Boolean(opts.skipUserMessage),
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
    if (
      companionAlreadyHasGmReply(
        useGameStore.getState().messages,
        input.companionName,
      )
    ) {
      activeCompanionResolveId = null;
      return;
    }
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
    return `，門檻 <=${input.target_value}（當前 SAN ${input.skill_value}）`;
  }
  const attrKey = resolveCocAttributeKeyFromCheckName(input.check_target_name);
  if (attrKey && input.skill_value != null && input.target_value != null) {
    return `，門檻 <=${input.target_value}（屬性 ${input.check_target_name} ${input.skill_value}）`;
  }
  if (input.skill_value != null && input.target_value != null) {
    const diff = difficultyLabelWithHint(input.difficulty ?? "regular");
    return `，${diff}，門檻 <=${input.target_value}（技能 ${input.skill_value}%）`;
  }
  if (input.target_value != null) {
    return `，門檻 <=${input.target_value}`;
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
    if (store.pendingDice && store.diceResolver) {
      resolve({
        request_id: args.request_id,
        diceResult: 0,
        outcome: "REJECTED_PENDING",
        detail: "pending_check_exists",
        cancelled: true,
      });
      return;
    }
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

async function maybeResolvePendingCompanionCombat(
  existingCharacterId?: string | null,
): Promise<{ gm_instruction: string } | null> {
  const pending = pendingCompanionCombatCheck;
  if (!pending) return null;
  if (existingCharacterId && existingCharacterId === pending.companionId) {
    pendingCompanionCombatCheck = null;
    return null;
  }
  pendingCompanionCombatCheck = null;
  const store = useGameStore.getState();
  if (store.phase !== "PLAYING") return null;
  store.appendSystem(
    `（系統）隊友「${pending.companionName}」的攻擊／技能嘗試須檢定（${pending.skillHint}）。`,
  );
  const roll = await waitForPlayerDice({
    request_id: crypto.randomUUID(),
    check_target_name: pending.skillHint,
    dice_type: "d100",
    reason: pending.action.slice(0, 160),
    character_id: pending.companionId,
  });
  const combatDmg = maybeApplyCombatDamage({
    skillLabel: pending.skillHint,
    damageDice: undefined,
    outcome: roll.outcome,
    cancelled: roll.cancelled,
    characterId: pending.companionId,
  });
  return {
    gm_instruction:
      joinGmInstructions(
        `COMPANION CHECK (${pending.companionName}／${pending.skillHint}): outcome_zh=${successQualityLabel(roll.outcome)} detail=${roll.detail}. Narrate only this attempt's world result. On failure: miss / lamp dies / lock jams — do not auto-succeed.`,
        combatDmg.gmInstruction,
      ) ??
      `COMPANION CHECK (${pending.companionName}／${pending.skillHint}): ${successQualityLabel(roll.outcome)}`,
  };
}

function maybeApplyCombatDamage(input: {
  skillLabel: string;
  damageDice?: string;
  outcome: string;
  cancelled?: boolean;
  characterId?: string | null;
}): {
  damage_dice?: string;
  damage_total?: number;
  damage_detail?: string;
  gmInstruction?: string;
} {
  if (input.cancelled || !isSuccessDiceOutcome(input.outcome)) return {};
  const formula = input.damageDice?.trim();
  const combatish = Boolean(formula) || looksLikeCombatCheckName(input.skillLabel);
  if (!combatish) return {};
  const sheet = useGameStore.getState().getSheetById(input.characterId);
  if (!formula) {
    return {
      gmInstruction:
        "COMBAT HIT without damage_dice. You MUST still roll weapon damage (+DB if melee) minus armor, then apply HP. PC/companion → update_game_stats. Creature → bible creatures[].hp is max SSOT; track current yourself. Do not narrate a wound without dice.",
    };
  }
  const dmg = rollDamageFormula(formula, sheet?.derived.damage_bonus);
  useGameStore.getState().appendSystem(`傷害：${dmg.detail}`);
  return {
    damage_dice: formula,
    damage_total: dmg.total,
    damage_detail: dmg.detail,
    gmInstruction: `DAMAGE ROLLED: ${dmg.detail}. Subtract armor then apply HP. PC/companion → update_game_stats. Creature → bible creatures[].hp (max SSOT); track current yourself. Do not invent a different damage number.`,
  };
}

async function maybeRunEngineMythosSan(opts: {
  narrative: string;
  alreadySanityCheck: boolean;
}): Promise<{ gm_instruction: string } | null> {
  if (opts.alreadySanityCheck) return null;
  const store = useGameStore.getState();
  if (store.phase !== "PLAYING") return null;
  if (store.script.system_id !== "COC_7E") return null;
  if (looksLikeEndingNarrative(opts.narrative)) return null;
  const pc = resolvePlayerBoundSheet(store);
  if (!pc?.derived.san) return null;
  const sighting = detectMythosSanSighting({
    narrative: opts.narrative,
    creatures: store.script.hidden_full_script?.creatures,
    sanAndThreats: store.script.hidden_full_script?.san_and_threats,
    recentSystemTexts: store.messages
      .filter((m) => m.role === "system")
      .slice(-20)
      .map((m) => m.content),
  });
  if (!sighting) return null;
  markMythosSanSightingSeen(sighting.key);
  store.appendSystem(
    `目擊神話存在（${sighting.label}，${sighting.successLoss}/${sighting.failDice}）— 進行理智檢定。`,
  );
  const roll = await waitForPlayerDice({
    request_id: crypto.randomUUID(),
    check_target_name: "理智",
    dice_type: "d100",
    reason: `目擊神話／異界：${sighting.label}`,
    character_id: pc.id,
  });
  if (roll.cancelled) {
    return {
      gm_instruction: `MYTHOS SAN was queued but cancelled. Re-request 理智 for sighting ${sighting.label} (${sighting.successLoss}/${sighting.failDice}).`,
    };
  }
  const success = isSuccessDiceOutcome(roll.outcome);
  const loss = success
    ? sighting.successLoss
    : rollDice(sighting.failDice, "normal").total;
  if (loss > 0) {
    store.applyStatChanges(
      [
        {
          key: "SAN",
          change_amount: -loss,
          reason: `目擊神話／異界：${sighting.label}`,
        },
      ],
      [],
      [],
      pc.id,
    );
  }
  return {
    gm_instruction: `ENGINE MYTHOS SAN (${sighting.label}): 理智 ${successQualityLabel(roll.outcome)} → SAN -${loss} (formula ${sighting.successLoss}/${sighting.failDice}). Narrate shock/fear only. Do not dump win steps.`,
  };
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
  const priorAgent = findLastAgentMessage(store.messages);
  if (priorAgent && narrativeText.trim()) {
    narrativeText = uniqueNarrativeSuffix(priorAgent.content, narrativeText);
  }

  const trailingAgents: { content: string }[] = [];
  for (let i = store.messages.length - 1; i >= 0; i--) {
    const m = store.messages[i];
    if (!m) continue;
    if (isBlockingPlayerMessage(m)) break;
    if (m.role === "agent") trailingAgents.push(m);
  }
  const rewriting = trailingAgents.some((m) =>
    areDuplicateNarratives(m.content, narrativeText),
  );

  if (a.location?.trim()) {
    store.setLocation(a.location.trim());
  }

  const directorPatch = patchSceneDirectorFromNarrate({
    scenes: store.script.hidden_full_script?.scenes,
    location: a.location?.trim() || store.location,
    requestedSceneId: a.scene_id,
    requestedGoal: a.scene_goal,
    tension: a.tension ?? null,
    directorNotes: a.director_notes,
    previous: {
      currentSceneId: store.sceneDirector.currentSceneId ?? undefined,
      sceneGoal: store.sceneDirector.sceneGoal,
    },
  });
  const sceneHints: string[] = [];
  if (directorPatch) {
    store.setSceneDirector({
      ...(directorPatch.currentSceneId
        ? { currentSceneId: directorPatch.currentSceneId }
        : {}),
      ...(directorPatch.sceneGoal !== undefined
        ? { sceneGoal: directorPatch.sceneGoal }
        : {}),
      ...(directorPatch.tension !== undefined
        ? { tension: directorPatch.tension }
        : {}),
      ...(directorPatch.notes !== undefined
        ? { notes: directorPatch.notes }
        : {}),
    });
    if (directorPatch.inventedSceneId) {
      sceneHints.push(
        directorPatch.resolvedSceneId
          ? `SCENE_ID: "${a.scene_id}" is not a bible id; SSOT now ${directorPatch.resolvedSceneId}. Always use existing scenes[].id.`
          : `SCENE_ID "${a.scene_id}" not in bible; left unchanged. Call lookup_scenario_term({ query, kind: "scene" }).`,
      );
    } else if (directorPatch.locationSynced && directorPatch.resolvedSceneId) {
      sceneHints.push(
        `SCENE SYNC: location mapped to ${directorPatch.resolvedSceneId}. Include this scene_id on the next narrate_story.`,
      );
    }
  }

  const hygieneHint = detectNarrativeHygieneIssue(narrativeText);
  const playerAskedWin = playerActionAsksForWinPath(store.lastPlayerAction);
  const spoilerDump = detectWinSpoilerDump(
    narrativeText,
    store.script.hidden_full_script?.winning_condition,
  );
  const spoilerHint = spoilerDump
    ? buildWinSpoilerGmInstruction({ playerAsked: playerAskedWin })
    : playerAskedWin
      ? buildWinAskDirective()
      : null;
  const narrateHints = joinGmInstructions(
    ...sceneHints,
    hygieneHint,
    spoilerHint,
  );

  if (a.npc_updates?.length) {
    for (const n of a.npc_updates) {
      store.registerNpc(
        {
          npc_id: n.npc_id,
          name: n.name,
          relation: (n.relation as NPCItem["relation"]) || "NEUTRAL",
          status: (n.status as NPCItem["status"]) || "ALIVE",
          description: n.description,
        },
        { mentionText: narrativeText },
      );
    }
  }

  if (narrativeText.trim()) {
    store.narrateFromTool(narrativeText, a.system_notice);
    if (narrativeText.trim()) {
      store.patchWinProgress((prev) =>
        noteNarrativeForWinProgress(prev, narrativeText),
      );
    }
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
    const companionCombat = await maybeResolvePendingCompanionCombat(null);
    const mythosSan = await maybeRunEngineMythosSan({
      narrative: narrativeText,
      alreadySanityCheck: false,
    });
    const gmInstruction = joinGmInstructions(
      narrateHints,
      companionCombat?.gm_instruction,
      mythosSan?.gm_instruction,
    );
    return {
      ok: true as const,
      narrative_recorded: true as const,
      ...(gmInstruction ? { gm_instruction: gmInstruction } : {}),
    };
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
  const checkFp = makeCheckFingerprint({
    characterId: checkRequest.character_id,
    skillLabel,
    reason: checkRequest.reason ?? "",
  });
  const priorSuccess = findRecentSuccessfulCheck(checkFp);
  if (priorSuccess) {
    useGameStore.getState().appendSystem(
      `（略過重複檢定：${whoLabel}${skillLabel} 近日已成功，不再重骰）`,
    );
    const companionCombat = await maybeResolvePendingCompanionCombat(
      checkRequest.character_id,
    );
    const mythosSan = await maybeRunEngineMythosSan({
      narrative: narrativeText,
      alreadySanityCheck:
        isSanityCheckName(skillLabel) || resolved.checkKind === "sanity",
    });
    activeCompanionResolveId = null;
    return {
      ok: true as const,
      narrative_recorded: true as const,
      check_skipped: true as const,
      request_id: checkRequest.request_id,
      diceResult: 0,
      outcome: priorSuccess.outcome,
      detail: "duplicate_success_skipped",
      cancelled: false,
      outcome_zh: successQualityLabel(priorSuccess.outcome),
      difficulty: resolved.difficulty,
      difficulty_zh: difficultyLabelWithHint(resolved.difficulty),
      result_zh: formatDiceResultLabels({
        outcome: priorSuccess.outcome,
        difficulty: resolved.difficulty,
      }),
      gm_instruction: joinGmInstructions(
        "CRITICAL: Do NOT re-request this check. A matching check already SUCCEEDED recently. Your next narrate_story must ONLY continue from that prior success and immediate consequences — never roll again, never overwrite with failure.",
        narrateHints,
        companionCombat?.gm_instruction,
        mythosSan?.gm_instruction,
      ),
    };
  }
  if (
    useGameStore.getState().pendingDice &&
    !isCompanionDiceCheck(checkRequest.character_id)
  ) {
    activeCompanionResolveId = null;
    return {
      ok: false as const,
      error: "PENDING_CHECK_EXISTS",
      message:
        "A player-facing check is already pending. Wait for the dice result before requesting another check.",
      narrative_recorded: true as const,
      gm_instruction: joinGmInstructions(
        "Do not overwrite the pending check. Wait for the engine dice result, then narrate only that outcome.",
        narrateHints,
      ),
    };
  }

  const companionCombat = await maybeResolvePendingCompanionCombat(
    checkRequest.character_id,
  );

  const thresholdText =
    resolved.checkKind === "sanity" && resolved.skill_value != null
      ? `${whoLabel}當前 SAN ${resolved.skill_value}，成功需 <= ${resolved.target_value}（CoC 理智檢定）`
      : resolved.checkKind === "attribute" &&
          resolved.skill_value != null &&
          resolved.target_value != null
        ? `${whoLabel}屬性「${skillLabel}」${resolved.skill_value}，成功需 <= ${resolved.target_value}`
      : resolved.skill_value != null && resolved.target_value != null
        ? `${whoLabel}角色卡「${skillLabel}」${resolved.skill_value}% · ${difficultyLabelWithHint(resolved.difficulty)}，成功需 <= ${resolved.target_value}`
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
  if (roll.outcome === "REJECTED_PENDING" || roll.detail === "pending_check_exists") {
    activeCompanionResolveId = null;
    useGameStore.getState().appendSystem(
      "（拒絕覆寫檢定：尚有未結算的擲骰請求）",
    );
    return {
      ok: false as const,
      error: "PENDING_CHECK_EXISTS",
      message:
        "A player-facing check is already pending. Wait for the dice result before requesting another check.",
      narrative_recorded: true as const,
      cancelled: true,
      gm_instruction: joinGmInstructions(
        "Do not overwrite the pending check. Wait for the engine dice result, then narrate only that outcome.",
        narrateHints,
      ),
    };
  }
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
    if (isSuccessDiceOutcome(roll.outcome)) {
      recordSuccessfulCheck(checkFp, roll.outcome);
    }
    if (
      resolved.checkKind === "skill" &&
      isSuccessDiceOutcome(roll.outcome) &&
      !isCthulhuMythosSkillName(skillLabel)
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

  const mythosSan = await maybeRunEngineMythosSan({
    narrative: narrativeText,
    alreadySanityCheck:
      isSanityCheckName(skillLabel) || resolved.checkKind === "sanity",
  });

  activeCompanionResolveId = null;

  const combatDmg = maybeApplyCombatDamage({
    skillLabel,
    damageDice: checkRequest.damage_dice,
    outcome: roll.outcome,
    cancelled: roll.cancelled,
    characterId: checkRequest.character_id,
  });

  return {
    ...roll,
    outcome_zh: successQualityLabel(roll.outcome),
    difficulty: resolved.difficulty,
    difficulty_zh: difficultyLabelWithHint(resolved.difficulty),
    result_zh: formatDiceResultLabels({
      outcome: roll.outcome,
      difficulty: resolved.difficulty,
    }),
    ...(combatDmg.damage_total != null
      ? {
          damage_dice: combatDmg.damage_dice,
          damage_total: combatDmg.damage_total,
          damage_detail: combatDmg.damage_detail,
        }
      : {}),
    gm_instruction: joinGmInstructions(
      "CRITICAL: Your next narrate_story.narrative_text must ONLY describe this check outcome and immediate consequences. Do NOT repeat, paraphrase, or rewrite any previously narrated scene text. Prefer updating location/scene_id/npc_updates if the scene changed. Sheet skills for " +
        whoLabel +
        ": " +
        (skillHint || "（無）") +
        `. Dice result labels (Traditional Chinese): ${formatDiceResultLabels({
          outcome: roll.outcome,
          difficulty: resolved.difficulty,
        })}. Engine outcome_zh=${successQualityLabel(roll.outcome)}. You MUST use this exact success-quality label — if it is 失敗, do NOT write 大失敗; only FUMBLE is 大失敗. Use 成功品質 wording (普通成功／困難級成功<=半值／極限級成功<=1/5／失敗／大失敗), not casual「很辛苦才成功」. On FAILURE: no full key_clue dump / no soft-win climax.`,
      combatDmg.gmInstruction,
      narrateHints,
      companionCombat?.gm_instruction,
      mythosSan?.gm_instruction,
    ),
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
          await sendGmText(
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
  session: PedelecSession<SessionToolName>,
  toolset: "session0" | "playing",
): () => void {
  const disposers: Array<() => void> = [];

  if (toolset === "session0") {
  disposers.push(
    session.onTool("setup_script", (args) => {
      try {
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
      missingSetupScriptWarned = false;
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
      // IMPORTANT:
      // setup_script tool-call 有嚴格 timeout；情境 bible 上傳/格式化可能很大。
      // 這段故意延後到 tool handler 已完成後再跑，避免 provider 卡在 waitingToolResult。
      setTimeout(() => {
        void syncScenarioBibleAsset(
          session,
          useGameStore.getState().script,
        ).catch((e) => {
          useGameStore
            .getState()
            .appendSystem(
              `（系統）劇本 bible 上傳 sandbox 失敗：${e instanceof Error ? e.message : String(e)}`,
            );
        });
      }, 0);
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
      } catch (e) {
        return {
          ok: false,
          error: `setup_script failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
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
      const store = useGameStore.getState();
      // 創角頁已有全隊藍圖：只重推本席技能／職業包，鎖定配點方式
      if (phase === "CHARACTER" && store.characterSchema && store.character) {
        if (!a.recommended_skills?.length) {
          return {
            ok: false,
            error:
              "generate_character_schema during CHARACTER requires recommended_skills. creation_mode is locked.",
          };
        }
        store.applySlotSkillBlueprint({
          recommended_skills: a.recommended_skills,
          starting_inventory: a.starting_inventory,
          role_title_suggestion: a.role_title_suggestion,
        });
        return {
          ok: true,
          skills_only: true,
          note: "Allocation mode locked to the party schema; skill blueprint applied to the current slot and spends cleared.",
        };
      }
      store.setCharacterSchema({
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
        recommended_skills?: {
          name: string;
          base_value: number;
          description: string;
          is_occupational?: boolean;
        }[];
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
        skills_redesigned: Boolean(a.recommended_skills?.length),
        note: a.recommended_skills?.length
          ? "Narrative applied; slot skill blueprint replaced and spends cleared. Attribute allocation mode unchanged."
          : "Narrative fields applied; attributes and skill allocation mode unchanged.",
      };
    }),
  );
  }

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
      const skillLabel = resolved.sheetSkillName ?? a.check_target_name;
      const secretFp = makeCheckFingerprint({
        characterId: a.character_id,
        skillLabel,
        reason: a.reason_for_gm ?? "",
      });
      const priorSecret = findRecentSuccessfulCheck(secretFp);
      if (priorSecret) {
        store.setSecretRollActive(false);
        return {
          request_id: a.request_id,
          check_skipped: true,
          diceResult: 0,
          outcome: priorSecret.outcome,
          outcome_zh: successQualityLabel(priorSecret.outcome),
          difficulty: resolved.difficulty,
          difficulty_zh: difficultyLabelWithHint(resolved.difficulty),
          result_zh: formatDiceResultLabels({
            outcome: priorSecret.outcome,
            difficulty: resolved.difficulty,
          }),
          detail: "duplicate_success_skipped",
          isSecret: true,
          gm_instruction:
            "Do NOT re-secret-check the same attempt; continue from the prior success.",
        };
      }
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
          skillName: skillLabel,
          isSecret: true,
          diceType: a.dice_type,
          targetValue: resolved.target_value,
          diceResult: rolled.total,
          outcome,
        },
      });
      store.setSecretRollActive(false);

      if (isSuccessDiceOutcome(outcome)) {
        recordSuccessfulCheck(secretFp, outcome);
      }
      if (
        resolved.checkKind === "skill" &&
        isSuccessDiceOutcome(outcome) &&
        !isCthulhuMythosSkillName(skillLabel)
      ) {
        store.markSkillSuccess(skillLabel, a.character_id);
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
    session.onTool("update_game_stats", async (args) => {
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
      const store = useGameStore.getState();
      const aftermath = store.applyStatChanges(
        raw.stat_changes,
        raw.inventory_add,
        raw.inventory_remove,
        characterId,
      );
      const sheet = useGameStore.getState().getSheetById(characterId);
      const base = {
        ok: true as const,
        character_id: sheet?.id,
        hp: sheet?.derived.hp,
        san: sheet?.derived.san,
        inventory: sheet?.inventory,
      };

      if (
        aftermath?.requireConCheck &&
        sheet?.system_id === "COC_7E" &&
        sheet.derived.hp.current > 0
      ) {
        const whoLabel = sheet.name?.trim()
          ? `「${sheet.name}」`
          : "角色";
        const reason = `重傷後的體質（CON）檢定：失敗則昏迷／失去行動`;
        useGameStore.getState().appendSystem(
          `需要檢定：${whoLabel}體質（d100）— ${reason}`,
        );
        const roll = await waitForPlayerDice({
          request_id: `major_wound_con_${Date.now()}`,
          check_target_name: "體質",
          dice_type: "d100",
          reason,
          character_id: sheet.id,
        });
        const failed =
          roll.cancelled ||
          !isSuccessDiceOutcome(roll.outcome);
        if (failed && !roll.cancelled) {
          useGameStore.getState().setCharacterIncapacitated(sheet.id, true);
          useGameStore.getState().appendSystem(
            `重傷體質檢定失敗（${whoLabel}）：失去行動／需急救；GM 必須敘事並暫停該角色主動攻擊或儀式。`,
          );
        } else if (!failed) {
          useGameStore.getState().setCharacterIncapacitated(sheet.id, false);
          useGameStore.getState().appendSystem(
            `重傷體質檢定成功（${whoLabel}）：仍可行動，但應敘述傷勢痛苦。`,
          );
        }
        return {
          ...base,
          major_wound_con: {
            cancelled: Boolean(roll.cancelled),
            outcome: roll.outcome,
            outcome_zh: successQualityLabel(roll.outcome),
            detail: roll.detail,
            incapacitated: failed && !roll.cancelled,
          },
          gm_instruction: failed && !roll.cancelled
            ? `MANDATORY: ${whoLabel} failed the major-wound CON check and is incapacitated — narrate collapse/pain and pause their proactive attacks/rituals until treated.`
            : roll.cancelled
              ? "Major-wound CON check was cancelled; do not ignore the major wound — re-request CON if still unresolved."
              : `MAJOR WOUND: ${whoLabel} passed CON and remains active; narrate pain but they can still act carefully.`,
        };
      }

      return base;
    }),
  );

  disposers.push(
    session.onTool("mark_skill_success", (args) => {
      const raw = args as {
        skill_name: string;
        reason: string;
        character_id?: string;
      };
      if (resolveCocAttributeKeyFromCheckName(raw.skill_name)) {
        return {
          ok: false,
          error: `${raw.skill_name} 是屬性不是技能，不可標記成長。請用技能名（如格鬥、偵查）。`,
        };
      }
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
      const store = useGameStore.getState();
      const win = store.script.hidden_full_script?.winning_condition ?? "";
      const warn = badEndingWinConflictWarning({
        endingType: a.ending_type,
        winningCondition: win,
        progress: store.winProgress,
      });
      store.endGame({
        ending_type: a.ending_type,
        ending_title: a.ending_title,
        ending_narrative: a.ending_narrative,
        achievements: a.achievements ?? [],
      });
      return {
        ok: true,
        win_conflict_warning: warn,
        gm_instruction: warn
          ? `WARNING: ${warn} If a Win OR-branch was already achieved, prefer a non-bad ending or explain why escape still failed.`
          : undefined,
      };
    }),
  );

  disposers.push(
    session.onTool("request_companion_action", async (args) => {
      const raw = args as Record<string, unknown>;
      const companionId = String(
        raw.companion_id || raw.character_id || "",
      ).trim();
      const reason =
        String(raw.reason || raw.prompt || "").trim() || "玩家點名隊友";
      const situation = String(raw.situation || "").trim() || undefined;
      const timing = String(raw.timing || "").trim().toLowerCase();
      const preferImmediate =
        raw.prefer_immediate === true || timing === "immediate";
      const store = useGameStore.getState();
      if (store.phase !== "PLAYING") {
        // 結局/結算中或其他非遊玩階段：拒絕新的隊友動作請求
        return {
          ok: true,
          acted: false,
          companion_id: companionId,
        };
      }
      const member = useGameStore
        .getState()
        .party.find(
          (m) => m.id === companionId || m.sheet.id === companionId,
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
          reason,
          situation,
          preferImmediate,
        });
        if (!decision.acted) {
          // 靜默：不寫入任何玩家可見訊息
          return { ok: true, acted: false, companion_id: member.id };
        }

        const openingBeat = !store.lastPlayerAction.trim();
        applyCompanionDecision(decision, {
          fromGmTool: true,
          openingBeat,
        });

        const combatNeed = companionActionNeedsCheck(decision.action);

        return {
          ok: true,
          acted: true,
          companion_id: member.id,
          companion_name: decision.companionName,
          action: decision.action,
          handoff: decision.handoff,
          gm_instruction: openingBeat
            ? "OPENING BEAT: Companion speech is now a separate bubble. Do NOT call narrate_story again with the opening scene. Do NOT rewrite the opening. Stop and wait for the human player."
            : combatNeed
              ? `MANDATORY CHECK: ${decision.companionName} declared a physical/combat/medical attempt. Next narrate_story MUST include check_request with character_id=${member.id} check_target_name=${combatNeed.skillHint}. Engine will auto-roll that companion if you omit it. Do NOT narrate a hit or successful treatment without dice. Companion declaration is a separate bubble — do not paraphrase it.`
              : "Companion declaration is visible as a separate bubble. Do NOT re-narrate previous scene text. Do NOT prefix 【隊友·】 or paraphrase their line. Narrate only NPC/world reaction (1–5 sentences), then pause for the human PC.",
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

  disposers.push(
    session.onTool("lookup_scenario_term", (args) => {
      const a = args as {
        query: string;
        kind?: string;
        limit?: number;
      };
      const hidden = useGameStore.getState().script.hidden_full_script;
      if (!hidden) {
        return {
          ok: false,
          text: "No hidden bible yet. Call setup_script in Session 0, or improvise only within public_summary.",
        };
      }
      const kind = normalizeScenarioTermKind(a.kind);
      const result = lookupScenarioTerm(hidden, {
        query: a.query ?? "",
        kind,
        limit: a.limit,
      });
      return {
        ...result,
        kind,
        kind_raw: a.kind ?? "any",
      };
    }),
  );

  disposers.push(
    session.onTool("lookup_game_state", (args) => {
      const focus =
        args && typeof args === "object" && "focus" in args
          ? String((args as { focus?: string }).focus ?? "")
          : "";
      const s = useGameStore.getState();
      const tools =
        activeToolset === "playing" ? playingSessionTools : allSessionTools;
      const text = formatLookupGameState({
        script: s.script,
        houseRules: s.houseRules,
        character: resolvePlayerBoundSheet(s),
        clues: s.clues,
        npcs: s.npcs,
        madness: s.madness,
        location: s.location,
        turn: s.turn,
        sceneDirector: s.sceneDirector,
        party: s.party,
        playerMemberId: s.playerMemberId,
        incapacitatedCharacterIds: s.incapacitatedCharacterIds,
        availableTools: listToolsForLookup(tools),
        toolsetLabel: activeToolset,
      });
      return {
        ok: true,
        focus: focus || undefined,
        text,
      };
    }),
  );

  disposers.push(
    session.onTool("lookup_history", (args) => {
      const a = (args ?? {}) as {
        scope?: string;
        query?: string;
        limit?: number;
      };
      const scopeRaw = (a.scope ?? "both").trim().toLowerCase();
      const scope =
        scopeRaw === "chapters" ||
        scopeRaw === "recent" ||
        scopeRaw === "both"
          ? scopeRaw
          : "both";
      const s = useGameStore.getState();
      const text = formatLookupHistory({
        chapterSummaries: s.chapterSummaries,
        recentMessages: s.messages,
        scope,
        query: a.query,
        limit: a.limit,
      });
      return { ok: true, scope, text };
    }),
  );

  disposers.push(
    session.onTool("lookup_prior_script_design", (args) => {
      const a = (args ?? {}) as { id?: string; index?: number };
      const phase = useGameStore.getState().phase;
      if (phase !== "SESSION_0" && phase !== "PREFLIGHT") {
        return {
          ok: false,
          error:
            "lookup_prior_script_design is only available during Session 0 script design.",
        };
      }
      const designs = loadRecentScriptDesigns(10, {
        excludeId: useGameStore.getState().campaignId,
      });
      if (!designs.length) {
        return { ok: false, error: "No prior script designs available." };
      }
      const id = typeof a.id === "string" ? a.id.trim() : "";
      let idx =
        typeof a.index === "number" && Number.isFinite(a.index)
          ? Math.trunc(a.index)
          : NaN;
      let hitIndex = -1;
      if (id) {
        hitIndex = designs.findIndex((d) => d.id === id);
      } else if (idx >= 1 && idx <= designs.length) {
        hitIndex = idx - 1;
      }
      if (hitIndex < 0) {
        return {
          ok: false,
          error:
            "Provide a valid id from PRIOR SCRIPT CATALOG or index 1..N. Catalog ids: " +
            designs.map((d, i) => `${i + 1}=${d.id}`).join(", "),
        };
      }
      const design = designs[hitIndex]!;
      return {
        ok: true,
        id: design.id,
        index: hitIndex + 1,
        text: formatPriorScriptDesignDetail(design, hitIndex + 1),
      };
    }),
  );

  return () => {
    for (const d of disposers) d();
  };
}

async function disposeGmSessionOnly() {
  pendingCompanionCombatCheck = null;
  resetMythosSanSightings();
  if (!activeHandle) return;
  const handle = activeHandle;
  activeHandle = null;
  resetScenarioBibleAssetCache();
  handle.dispose();
  try {
    await handle.session.end();
  } catch {
    // ignore
  }
}

export async function createGameSession(options: {
  provider: ProviderCode;
  model?: string;
}): Promise<GameSessionHandle> {
  const toolset = toolsetForPhase(useGameStore.getState().phase);
  if (toolset === "session0") {
    await disposeCompanionSession();
    await disposeAiPlayerSession();
  }
  await disposeGmSessionOnly();

  const tools =
    toolset === "playing" ? playingSessionTools : allSessionTools;
  const session = (await pedelec.createSession({
    provider: options.provider,
    model: explicitSessionModel(options.model),
    skills: {
      guidance: GM_SESSION_GUIDANCE,
      tools: [...tools],
    },
    autoEndOnDisconnect: true,
  })) as PedelecSession<SessionToolName>;
  activeToolset = toolset;

  persistPedelecSessionId(session.sessionId);
  waitingToolSince = null;
  missingSetupScriptWarned = false;
  lastCreateOptions = {
    provider: options.provider,
    model: explicitSessionModel(options.model),
  };
  providerSendCount = 0;
  const store = useGameStore.getState();
  store.setSessionStatus(session.getStatus());
  resetScenarioBibleAssetCache();
  void syncGmStandingRulesAsset(session).catch((e) => {
    store.appendSystem(
      `（系統）GM 規範檔上傳 sandbox 失敗：${e instanceof Error ? e.message : String(e)}`,
    );
  });
  if (store.script.hidden_full_script) {
    void syncScenarioBibleAsset(session, store.script).catch((e) => {
      store.appendSystem(
        `（系統）劇本 bible 上傳 sandbox 失敗：${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }

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

    lastGmActivityAt = Date.now();
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
      if (
        !stripped.trim() ||
        isGmMetaOnlyNarrative(chatContent) ||
        isCorruptedNarrativeFragment(chatContent)
      ) {
        s.updateMessage(chatId, "");
      } else if (stripped !== chatContent.trim()) {
        s.updateMessage(chatId, stripped);
      }
    }
  });

  const offStatus = session.onStatus((status) => {
    applySessionStatus(session, status);
  });

  const offError = session.onError((error: PedelecError) => {
    settlePendingDiceOnTeardown();
    const s = useGameStore.getState();
    s.setSessionError({ code: error.code, message: error.message });
    s.appendSystem(`錯誤：${error.code} — ${error.message}`);
    s.setIsTyping(false);
    if (s.sessionStatus !== "error" && s.sessionStatus !== "ended") {
      s.setSessionStatus("error");
    }
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

  const offTools = registerHandlers(session, toolset);

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

  // 等 createSession replay 安靜下來再 sendText，否則遲到的 idle 會清掉 activeTurn。
  await waitForPedelecSessionSettled(session, {
    timeoutMs: 4000,
    quietMs: 400,
    allowTimeout: true,
  });
  store.setSessionStatus(normalizePedelecSessionStatus(session.getStatus()));
  if (gmTurnInFlight && !gmSendStarted) {
    store.setIsTyping(true);
  }
  return handle;
}

export function getActiveSession() {
  return activeHandle?.session ?? null;
}

function maybeWarnMissingSetupScript(
  prev: PedelecSessionStatus | "disconnected",
) {
  const s = useGameStore.getState();
  if (missingSetupScriptWarned) return;
  if (s.phase !== "SESSION_0" && s.phase !== "PREFLIGHT") return;
  if (s.script.public_summary) return;
  if (prev !== "running" && prev !== "waiting_tool_result") return;
  missingSetupScriptWarned = true;
  s.appendSystem(
    "（系統）GM 回合已結束，但 setup_script 工具結果沒有寫入網頁，劇本面板不會更新。請再請 GM「立刻呼叫 setup_script」（不要只寫文字摘要）；若輸入框仍鎖住，請重建 Session 後重試。",
  );
}

function applySessionStatus(
  session: PedelecSession<SessionToolName>,
  status: PedelecSessionStatus | string,
) {
  const s = useGameStore.getState();
  const prev = s.sessionStatus;
  const normalized = normalizePedelecSessionStatus(status);
  if (
    normalized === "idle" &&
    gmTurnInFlight &&
    !gmSendStarted
  ) {
    // compact／create replay 的 idle：不要解鎖輸入、不要當成回合結束
    if (!s.isTyping) s.setIsTyping(true);
    waitingToolSince = null;
    return;
  }
  if (normalized === "waiting_tool_result") {
    if (waitingToolSince == null) waitingToolSince = Date.now();
    lastGmActivityAt = Date.now();
  } else if (normalized !== "running") {
    waitingToolSince = null;
  }
  if (prev === normalized) return;

  s.setSessionStatus(normalized);
  if (normalized === "running") {
    s.setIsTyping(true);
    lastGmActivityAt = Date.now();
    // 不在 running 清除 sessionError：擴充元件斷線／失敗後偶發仍會噴 running，
    // 若此處清空會讓重試按鈕消失（開場寫到一半尤甚）
    activeAgentMessageId = null;
  }
  if (normalized === "idle") {
    gmTurnInFlight = false;
    gmSendStarted = false;
    lastGmActivityAt = null;
    s.setIsTyping(false);
    flushLeakedChatBuffers(session);
    s.trimAgentRewriteAfterCompanion();
    s.collapseNarrativeRewrites();
    useGameStore.setState((st) => ({
      messages: st.messages.filter(
        (m) => !(m.role === "agent" && !(m.content ?? "").trim()),
      ),
    }));
    void maybeAutoResolvePendingCompanionHandoff();
    void maybeAutoInvokeCompanions();
    maybeWarnMissingSetupScript(prev);
    // 不在 idle 清除 sessionError：錯誤後 Session 常回到 idle，仍需顯示重試按鈕
  }
  if (normalized === "error" || normalized === "ended") {
    gmTurnInFlight = false;
    gmSendStarted = false;
    lastGmActivityAt = null;
    s.setIsTyping(false);
    leakedChatBufferByTurn.clear();
  }
  if (normalized === "waiting_tool_result") {
    s.setIsTyping(false);
  }
}

/**
 * 把 live session status 回寫 store。
 * onStatus 偶發漏掉 idle／waiting_tool_result 時，UI 會一直顯示「Agent 執行中」。
 */
export function syncSessionStatusFromLive() {
  const session = getActiveSession();
  if (!session) return null;
  const live = normalizePedelecSessionStatus(session.getStatus());
  applySessionStatus(session, live);

  const store = useGameStore.getState();
  if (
    live === "waiting_tool_result" &&
    waitingToolSince != null &&
    Date.now() - waitingToolSince >= WAITING_TOOL_STUCK_MS &&
    !store.sessionError
  ) {
    store.setSessionError({
      code: "TOOL_RESULT_TIMEOUT",
      message:
        "工具結果逾時未送達網頁。請重建 Session 後重試上一步。",
    });
    store.appendSystem(
      "（系統）工具結果逾時未送達，畫面可能卡在「Agent 執行中」。請按重試／重建 Session。",
    );
  }
  if (
    gmSendStarted &&
    live === "running" &&
    lastGmActivityAt != null &&
    Date.now() - lastGmActivityAt >= RUNNING_STUCK_MS &&
    !store.sessionError
  ) {
    store.setSessionError({
      code: "GM_TURN_TIMEOUT",
      message:
        "GM 回合過久沒有敘事或工具回傳。請重建 Session 後重試上一步。",
    });
    store.appendSystem(
      "（系統）GM 回合沒有進到網頁（常見於壓縮後立刻重送）。請按重試／重建 Session。",
    );
    store.setIsTyping(false);
  }
  return live;
}

export async function disposeGameSession() {
  await disposeCompanionSession();
  await disposeAiPlayerSession();
  await disposeGmSessionOnly();
}

/**
 * 重建 Pedelec session 以清空 provider conversation（遊戲 store 不變）。
 * @see doc/gm-memory-and-tokens.md
 */
async function compactProviderConversation() {
  if (compactInFlight || !lastCreateOptions) return;
  compactInFlight = true;
  const store = useGameStore.getState();
  try {
    store.appendSystem(
      `（系統）壓縮 GM conversation 記憶中（每 ${PROVIDER_COMPACT_EVERY} 次送出一次）…`,
    );
    await createGameSession(lastCreateOptions);
    store.appendSystem(
      "（系統）GM 記憶已壓縮；下一則改送 SEED 上下文，細節請 GM 用 lookup_* tools。",
    );
  } finally {
    compactInFlight = false;
  }
}

async function maybeCompactBeforeSend() {
  if (compactInFlight) return;
  if (providerSendCount <= 0) return;
  if (providerSendCount % PROVIDER_COMPACT_EVERY !== 0) return;
  await compactProviderConversation();
}

/** PLAYING 起改掛精簡 tools；與 compact 一樣會新 conversation，下一則走 SEED */
async function ensureGmToolsetForPhase() {
  if (compactInFlight || !lastCreateOptions) return;
  const want = toolsetForPhase(useGameStore.getState().phase);
  if (activeToolset === want && activeHandle) return;
  await createGameSession(lastCreateOptions);
}

/** 目前應組 SEED 還是 DELTA（compact／create 後為 seed） */
export function peekGmPromptMode(): "seed" | "delta" {
  return providerSendCount === 0 ? "seed" : "delta";
}

async function sendTextAndConfirmChannel(
  session: PedelecSession<SessionToolName>,
  prompt: string,
) {
  const accepted = waitForPedelecTurnSignal(session, { timeoutMs: 8000 });
  try {
    await session.sendText(prompt);
    await accepted;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : EVENT_CHANNEL_FAILED_MESSAGE;
    if (isPedelecEventChannelFailure(err) || message === EVENT_CHANNEL_FAILED_MESSAGE) {
      markPedelecEventChannelFailed(message);
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

/**
 * 所有主 GM session 的 sendText 應走這裡，以便計數與週期壓縮。
 * companion／aiPlayer 等獨立 session 不要用此函式。
 */
export async function sendGmText(
  prompt: string,
  opts?: { label?: string },
) {
  await ensureGmToolsetForPhase();
  await maybeCompactBeforeSend();
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");
  try {
    await gateOutgoingPrompt(prompt, {
      label: opts?.label ?? "GM sendText",
    });
  } catch (err) {
    if (isOutgoingPromptCancelled(err)) return;
    throw err;
  }
  await sendTextAndConfirmChannel(session, prompt);
  providerSendCount += 1;
}

export async function sendPlayerAction(
  text: string,
  opts?: {
    skipUserMessage?: boolean;
    extraLayers?: string[];
    /** 內部：正在結算隊友宣告，勿再轉成 handoff resolve */
    companionResolve?: boolean;
    /** 重試／重送時不要先 compact，避免新建 session 後 idle replay 吃掉 tool call */
    skipCompact?: boolean;
  },
) {
  const session = getActiveSession();
  if (!session) throw new Error("NO_SESSION");
  if (session.getStatus() !== "idle") throw new Error("SESSION_BUSY");

  const store = useGameStore.getState();

  // PC 新行動進來時若仍有未結算的隊友宣告：先結算（把本行動當插話），避免 UI 卡住
  if (!opts?.companionResolve && store.pendingCompanionHandoff) {
    await resolvePendingCompanionHandoff({
      playerSupplement: text,
      skipUserMessage: opts?.skipUserMessage,
    });
    return;
  }

  // 非隊友結算的玩家行動：關閉上一拍隊友 resolve 視窗（避免誤套 character_id）
  if (!opts?.companionResolve) {
    activeCompanionResolveId = null;
  }

  // PLAYING 前保險再 sync 一次（開舊檔／setup 後漏傳）
  if (store.script.hidden_full_script) {
    void syncScenarioBibleAsset(session, store.script).catch(() => {
      // 靜默；create／setup 已有提示
    });
  }

  const companionLabel = isCompanionLabeledAction(text);
  if (!opts?.companionResolve && !companionLabel) {
    store.setLastPlayerAction(text);
    store.setRetryAction({
      kind: "player",
      label: "重試上一步行動",
      text,
      extraLayers: opts?.extraLayers,
    });
  }
  autoCompanionHandledForAction = null;
  store.setSessionError(null);
  gmTurnInFlight = true;
  gmSendStarted = false;
  lastGmActivityAt = Date.now();
  store.setIsTyping(true);
  if (!opts?.skipUserMessage) {
    store.appendMessage({ role: "user", content: text });
  }

  try {
    // compact／PLAYING 換 toolset 可能重建 session；先 peek 會偏舊
    await ensureGmToolsetForPhase();
    if (!opts?.skipCompact) {
      await maybeCompactBeforeSend();
    }
    const latest = useGameStore.getState();
    const promptMode = peekGmPromptMode();
    const prompt = assemblePlayerTurnPrompt({
      script: latest.script,
      houseRules: latest.houseRules,
      character: resolvePlayerBoundSheet(latest),
      clues: latest.clues,
      npcs: latest.npcs,
      madness: latest.madness,
      location: latest.location,
      chapterSummaries: latest.chapterSummaries,
      recentMessages: latest.messages,
      playerAction: text,
      turn: latest.turn,
      suggestPlayerActions: latest.suggestPlayerActions,
      extraLayers: opts?.extraLayers,
      sceneDirector: latest.sceneDirector,
      party: latest.party,
      playerMemberId: latest.playerMemberId,
      incapacitatedCharacterIds: latest.incapacitatedCharacterIds,
      promptMode,
    });

    const active = getActiveSession();
    if (!active) throw new Error("NO_SESSION");
    if (active.getStatus() !== "idle") throw new Error("SESSION_BUSY");
    await gateOutgoingPrompt(prompt, {
      label: opts?.companionResolve ? "隊友結算／接續" : "玩家行動",
    });
    gmSendStarted = true;
    lastGmActivityAt = Date.now();
    await sendTextAndConfirmChannel(active, prompt);
    providerSendCount += 1;
  } catch (err) {
    gmTurnInFlight = false;
    gmSendStarted = false;
    lastGmActivityAt = null;
    useGameStore.getState().setIsTyping(false);
    if (isOutgoingPromptCancelled(err)) {
      if (!opts?.skipUserMessage) {
        useGameStore.getState().removeLastUserMessage();
      }
      return;
    }
    throw err;
  }
}

export const OPENING_NARRATION_ACTION =
  [
    "現在已確認角色卡。請立刻開始劇本並述說故事開場（請呼叫 narrate_story）。",
    "開場必須包含：明確時間、地點（並設定 location）、感官細節、NPC／環境帶來的眼前壓力或疑問。",
    "開場禁止呼叫 request_companion_action；隊友只寫靜態在場，等玩家第一個行動後再喚起。",
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
  gmTurnInFlight = true;
  gmSendStarted = false;
  lastGmActivityAt = Date.now();
  store.setIsTyping(true);
  // 清掉寫到一半的 GM 敘事；首次／重試用不同系統提示
  store.clearIncompleteOpening(isRetry ? "retry" : "first");

  await ensureGmToolsetForPhase();
  await maybeCompactBeforeSend();
  const after = useGameStore.getState();
  const activeForBible = getActiveSession();
  if (after.script.hidden_full_script && activeForBible) {
    void syncScenarioBibleAsset(activeForBible, after.script).catch(() => {});
  }
  const promptMode = peekGmPromptMode();
  const prompt = assemblePlayerTurnPrompt({
    script: after.script,
    houseRules: after.houseRules,
    character: resolvePlayerBoundSheet(after),
    clues: after.clues,
    npcs: after.npcs,
    madness: after.madness,
    location: after.location,
    chapterSummaries: after.chapterSummaries,
    recentMessages: [],
    playerAction: buildOpeningNarrationAction({
      party: after.party,
      playerMemberId: after.playerMemberId,
    }),
    turn: after.turn,
    // 開場第一則一律不附推薦行動（與開關無關）
    suggestPlayerActions: false,
    sceneDirector: after.sceneDirector,
    party: after.party,
    playerMemberId: after.playerMemberId,
    incapacitatedCharacterIds: after.incapacitatedCharacterIds,
    continuityPremiseZh: after.continuityBridge?.premiseZh ?? null,
    promptMode,
  });

  const active = getActiveSession();
  if (!active) throw new Error("NO_SESSION");
  if (active.getStatus() !== "idle") throw new Error("SESSION_BUSY");
  try {
    await gateOutgoingPrompt(prompt, { label: "開場敘事" });
  } catch (err) {
    gmTurnInFlight = false;
    gmSendStarted = false;
    lastGmActivityAt = null;
    useGameStore.getState().setIsTyping(false);
    if (isOutgoingPromptCancelled(err)) return;
    throw err;
  }
  gmSendStarted = true;
  lastGmActivityAt = Date.now();
  await sendTextAndConfirmChannel(active, prompt);
  providerSendCount += 1;
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
    skipCompact: true,
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
    skipCompact: true,
  });
}

/** Session 損壞（error/ended）時是否需要重建 */
export function sessionNeedsRebuild() {
  const session = getActiveSession();
  if (!session) return true;
  return sessionStatusNeedsRebuild(session.getStatus());
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
