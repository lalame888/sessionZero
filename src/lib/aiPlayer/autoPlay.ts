import type { ProviderCode } from "@kaoruisaac/pedelec";
import { requestAiPlayerAction } from "@/lib/aiPlayer/session";
import { useAiPlayerStore } from "@/lib/aiPlayer/store";
import {
  resolvePlayerDice,
  sendPlayerAction,
} from "@/lib/pedelec/createGameSession";
import { useGameStore } from "@/store/useGameStore";

const POLL_MS = 400;

export type AiPlayerLoopDeps = {
  resolveProvider: () => Promise<{ provider: ProviderCode; model?: string }>;
};

/**
 * 啟動 AI Player 自動迴圈。回傳 stop()。
 * 條件：enabled、PLAYING、無 ending；GM idle 後代打；公開骰自動擲。
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

        if (game.phase === "ENDING" || game.ending) {
          useAiPlayerStore.getState().setEnabled(false);
          break;
        }

        if (game.phase !== "PLAYING") {
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        // 開場尚未完成：等 GM／玩家先開場
        if (!hasPlayStarted(game)) {
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        // 公開檢定：自動擲骰（含非 send 期間殘留的 pending）
        if (tryAutoRoll()) {
          await sleep(POLL_MS, abort.signal);
          continue;
        }

        if (game.sessionStatus !== "idle") {
          useAiPlayerStore.getState().setPhase("waiting_gm");
          await sleep(POLL_MS, abort.signal);
          continue;
        }

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

          useAiPlayerStore.getState().setLastAction(action);
          useAiPlayerStore.getState().bumpTurnCount();
          useAiPlayerStore.getState().setPhase("waiting_gm");

          // 等到 GM 整回合結束；期間 dice watcher 會自動 resolve 公開骰
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
            message === "AI_PLAYER_NO_ACTION"
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

function hasPlayStarted(game: {
  history: unknown[];
  lastPlayerAction: string;
  messages: { role: string }[];
}): boolean {
  if (game.history.length > 0) return true;
  if (game.lastPlayerAction.trim()) return true;
  return game.messages.some((m) => m.role === "agent");
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
