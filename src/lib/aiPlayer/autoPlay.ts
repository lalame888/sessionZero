import type { ProviderCode } from "@kaoruisaac/pedelec";
import { requestAiPlayerAction } from "@/lib/aiPlayer/session";
import { useAiPlayerStore } from "@/lib/aiPlayer/store";
import { looksLikeEndingNarrative } from "@/lib/endingDetect";
import {
  getActiveSession,
  acceptCompanionHandoffWithoutResolve,
  resolvePendingCompanionHandoff,
  resolvePlayerDice,
  sendPlayerAction,
} from "@/lib/pedelec/createGameSession";
import { isCompanionSpeechOnly } from "@/lib/stripGmMetaPrompts";
import { useGameStore } from "@/store/useGameStore";
import { isAwaitingGmReply } from "@/lib/playTurnState";
import type { ChatMessage } from "@/types/game";

const POLL_MS = 400;

export type AiPlayerLoopDeps = {
  resolveProvider: () => Promise<{ provider: ProviderCode; model?: string }>;
};

/** 代打閘門：開啟／重開時用來判斷要等開場、等 GM、擲骰或立刻行動 */
export type AiPlayerTurnGate =
  | "wait_phase"
  | "wait_opening"
  | "wait_gm"
  | "roll_dice"
  | "resolve_companion"
  | "ending_pause"
  | "act";

/**
 * 敘事已出現結局／可手動結算提示時，代打應停止（留給玩家按進入結局）。
 */
export function shouldPauseAiPlayerForEnding(game: {
  phase: string;
  ending: unknown;
  pendingManualEnding: { title: string; narrative: string } | null;
  messages: ChatMessage[];
}): boolean {
  if (game.phase === "ENDING" || game.ending) return true;
  if (game.pendingManualEnding) return true;
  // 掃近期 GM 敘事（略過 system），避免 PlayPage 尚未寫入 pending 時代打又送一拍
  for (let i = game.messages.length - 1; i >= 0; i--) {
    const m = game.messages[i];
    if (!m) continue;
    if (m.role === "system") continue;
    if (m.role === "user") break;
    if (m.role === "agent" && looksLikeEndingNarrative(m.content)) {
      return true;
    }
  }
  return false;
}

/**
 * 啟動 AI Player 自動迴圈。回傳 stop()。
 * 條件：enabled、PLAYING、無 ending；已開場且輪到玩家時立刻代打；公開骰自動擲。
 */
export function startAiPlayerLoop(deps: AiPlayerLoopDeps): () => void {
  const abort = new AbortController();
  let running = true;

  const stop = () => {
    running = false;
    abort.abort();
    useAiPlayerStore.getState().setPhase("idle");
  };

  void (async () => {
    try {
      while (running && !abort.signal.aborted) {
        const ai = useAiPlayerStore.getState();
        if (!ai.enabled) break;

        const game = useGameStore.getState();

        if (shouldPauseAiPlayerForEnding(game)) {
          useAiPlayerStore.getState().setLastError(
            "偵測到結局／可手動結算提示，已暫停 AI 代打。請確認後進入結局結算。",
          );
          useAiPlayerStore.getState().setEnabled(false);
          break;
        }

        const gate = resolveAiPlayerTurnGate();

        if (gate === "ending_pause") {
          useAiPlayerStore.getState().setLastError(
            "偵測到結局／可手動結算提示，已暫停 AI 代打。請確認後進入結局結算。",
          );
          useAiPlayerStore.getState().setEnabled(false);
          break;
        }

        if (gate === "wait_phase") {
          useAiPlayerStore.getState().setPhase("idle");
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        if (gate === "wait_opening") {
          useAiPlayerStore.getState().setPhase("wait_opening");
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        if (gate === "roll_dice") {
          tryAutoRoll();
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        if (gate === "resolve_companion") {
          useAiPlayerStore.getState().setPhase("waiting_gm");
          try {
            const handoff = useGameStore.getState().pendingCompanionHandoff;
            // 純發言／分工：收下氣泡即可，勿再叫 GM 複述一遍
            if (handoff && isCompanionSpeechOnly(handoff.action)) {
              acceptCompanionHandoffWithoutResolve();
            } else {
              await resolvePendingCompanionHandoff();
            }
          } catch {
            // SESSION_BUSY 等：等下一輪 idle／autoResume
          }
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        if (gate === "wait_gm") {
          useAiPlayerStore.getState().setPhase("waiting_gm");
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        // gate === "act"：已開場且輪到玩家
        if (game.sessionError) {
          useAiPlayerStore.getState().setLastError(
            `GM session 錯誤，已暫停代打：${game.sessionError.code}`,
          );
          useAiPlayerStore.getState().setEnabled(false);
          break;
        }

        const stopDiceWatch = startDiceWatcher(abort.signal, () => running);

        try {
          useAiPlayerStore.getState().setPhase("thinking");
          useAiPlayerStore.getState().setLastError(null);

          const { provider, model } = await deps.resolveProvider();
          const action = await requestAiPlayerAction({
            provider,
            model,
            signal: abort.signal,
          });

          if (!running || abort.signal.aborted) break;
          if (!useAiPlayerStore.getState().enabled) break;

          // 送出前再確認仍輪到玩家，避免與 GM 搶回合／結局後繼續講
          const gateAfterThink = resolveAiPlayerTurnGate();
          if (gateAfterThink !== "act") {
            if (gateAfterThink === "ending_pause") {
              useAiPlayerStore.getState().setLastError(
                "偵測到結局／可手動結算提示，已暫停 AI 代打。請確認後進入結局結算。",
              );
              useAiPlayerStore.getState().setEnabled(false);
              break;
            }
            useAiPlayerStore.getState().setPhase(
              gateAfterThink === "wait_opening"
                ? "wait_opening"
                : gateAfterThink === "roll_dice"
                  ? "rolling"
                  : "waiting_gm",
            );
            await sleep(POLL_MS, abort.signal);
            continue;
          }

          if (shouldPauseAiPlayerForEnding(useGameStore.getState())) {
            useAiPlayerStore.getState().setLastError(
              "偵測到結局／可手動結算提示，已暫停 AI 代打。請確認後進入結局結算。",
            );
            useAiPlayerStore.getState().setEnabled(false);
            break;
          }

          useAiPlayerStore.getState().setLastAction(action);
          useAiPlayerStore.getState().bumpTurnCount();
          useAiPlayerStore.getState().setPhase("waiting_gm");

          await sendPlayerAction(action);
        } catch (err) {
          if (!running || abort.signal.aborted) break;
          if (isAbort(err)) break;

          const message =
            err instanceof Error ? err.message : "AI Player 未知錯誤";
          useAiPlayerStore.getState().setLastError(message);
          if (
            message === "NO_SESSION" ||
            message === "SESSION_BUSY" ||
            message === "AI_PLAYER_NO_ACTION" ||
            message === "NO_PENDING_COMPANION_HANDOFF"
          ) {
            await sleep(800, abort.signal);
            useAiPlayerStore.getState().setPhase("idle");
            continue;
          }
          useAiPlayerStore.getState().setEnabled(false);
          break;
        } finally {
          stopDiceWatch();
        }
      }
    } catch (err) {
      if (!isAbort(err)) {
        const message =
          err instanceof Error ? err.message : "AI Player 迴圈錯誤";
        useAiPlayerStore.getState().setLastError(message);
        useAiPlayerStore.getState().setEnabled(false);
      }
    } finally {
      useAiPlayerStore.getState().setPhase("idle");
    }
  })();

  return stop;
}

/** 供測試／UI：判斷代打此刻該做什麼 */
export function resolveAiPlayerTurnGate(): AiPlayerTurnGate {
  const game = useGameStore.getState();

  if (shouldPauseAiPlayerForEnding(game)) {
    return "ending_pause";
  }

  if (game.phase !== "PLAYING" || game.ending) {
    return "wait_phase";
  }

  if (!hasOpeningNarrative(game.messages, game.history.length)) {
    return "wait_opening";
  }

  // 公開檢定：輪到玩家擲骰（優先於 session busy）
  if (game.pendingDice && !game.pendingDice.isSecret) {
    if (game.diceResolver) return "roll_dice";
    // 有 pending 卻無 resolver：仍視為 GM 工具回合未就緒
    return "wait_gm";
  }

  // 隊友已宣告、等待結算：代打必須先讓 GM 結算，不可繼續搶 PC 發言
  if (game.pendingCompanionHandoff) {
    if (isGmSessionBusy(game.sessionStatus)) return "wait_gm";
    return "resolve_companion";
  }

  if (isGmSessionBusy(game.sessionStatus)) {
    return "wait_gm";
  }

  // 最後一則對話是玩家（含隊友氣泡）→ 還在等 GM 回應（即使 store 已 idle）
  if (isAwaitingGmReply(game.messages)) {
    return "wait_gm";
  }

  // 已開場、GM idle、上一則為 GM（或僅系統訊息附在 GM 後）→ 輪到玩家
  return "act";
}

function isGmSessionBusy(storeStatus: string): boolean {
  const live = getActiveSession()?.getStatus();
  // store 偶發未跟上 live（檢定／tool 結束後仍卡在 busy）→ 以 live 為準並回寫
  if (live && live !== storeStatus) {
    useGameStore.getState().setSessionStatus(live);
  }
  const status = live ?? storeStatus;
  return status === "running" || status === "waiting_tool_result";
}

/** 是否已有可見開場／GM 敘事 */
export function hasOpeningNarrative(
  messages: ChatMessage[],
  historyLength: number,
): boolean {
  if (historyLength > 0) return true;
  return messages.some(
    (m) => m.role === "agent" && m.content.trim().length > 0,
  );
}

export { isAwaitingGmReply } from "@/lib/playTurnState";

function tryAutoRoll(): boolean {
  const game = useGameStore.getState();
  if (!game.pendingDice || game.pendingDice.isSecret || !game.diceResolver) {
    return false;
  }
  useAiPlayerStore.getState().setPhase("rolling");
  resolvePlayerDice({});
  return true;
}

function startDiceWatcher(
  signal: AbortSignal,
  isRunning: () => boolean,
): () => void {
  const id = window.setInterval(() => {
    if (!isRunning() || signal.aborted) return;
    tryAutoRoll();
  }, POLL_MS);

  const onAbort = () => window.clearInterval(id);
  signal.addEventListener("abort", onAbort, { once: true });

  return () => {
    window.clearInterval(id);
    signal.removeEventListener("abort", onAbort);
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const id = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  const err = new Error("AI_PLAYER_ABORTED");
  err.name = "AbortError";
  return err;
}

function isAbort(err: unknown) {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.message === "AI_PLAYER_ABORTED")
  );
}
