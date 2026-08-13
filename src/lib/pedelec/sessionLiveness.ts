import type { PedelecSessionStatus } from "@kaoruisaac/pedelec";
import { useGameStore } from "@/store/useGameStore";

export type AppSessionStatus = PedelecSessionStatus | "disconnected";

export const EVENT_CHANNEL_FAILED_CODE = "EVENT_CHANNEL_FAILED";

export const EVENT_CHANNEL_FAILED_MESSAGE =
  "這個分頁還沒連上 Pedelec。請重新整理頁面，或關閉後再開 Pedelec Desktop 再試一次。";

export class PedelecEventChannelError extends Error {
  readonly code = EVENT_CHANNEL_FAILED_CODE;
  constructor(message = EVENT_CHANNEL_FAILED_MESSAGE) {
    super(message);
    this.name = "PedelecEventChannelError";
  }
}

/** Desktop 有時送 camelCase（waitingToolResult），SDK union 則是 snake_case。 */
export function normalizePedelecSessionStatus(
  status: string | null | undefined,
): AppSessionStatus {
  if (!status) return "disconnected";
  if (status === "waitingToolResult" || status === "waiting_tool_result") {
    return "waiting_tool_result";
  }
  if (
    status === "idle" ||
    status === "running" ||
    status === "ended" ||
    status === "error" ||
    status === "disconnected"
  ) {
    return status;
  }
  return "running";
}

export function isBusyPedelecStatus(
  status: string | null | undefined,
): boolean {
  const s = normalizePedelecSessionStatus(status);
  return s === "running" || s === "waiting_tool_result";
}

export function sessionStatusNeedsRebuild(
  status: string | null | undefined,
): boolean {
  const s = normalizePedelecSessionStatus(status);
  return s === "error" || s === "ended";
}

export function isPedelecEventChannelFailure(error: unknown): boolean {
  if (error instanceof PedelecEventChannelError) return true;
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code) === EVENT_CHANNEL_FAILED_CODE;
  }
  return error instanceof Error && error.message === EVENT_CHANNEL_FAILED_MESSAGE;
}

type StatusContext = { source?: string };

type LivenessSession = {
  getStatus: () => PedelecSessionStatus;
  onStatus: (
    listener: (status: PedelecSessionStatus, ctx: StatusContext) => void,
  ) => () => void;
  onError?: (listener: (error: unknown) => void) => () => void;
  onChat?: (listener: (delta: string) => void) => () => void;
};

function isCoreOrUnspecified(ctx: StatusContext | undefined): boolean {
  if (!ctx || typeof ctx !== "object" || !("source" in ctx)) return true;
  return ctx.source === "core";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return EVENT_CHANNEL_FAILED_MESSAGE;
}

export function markPedelecEventChannelFailed(
  message = EVENT_CHANNEL_FAILED_MESSAGE,
) {
  const store = useGameStore.getState();
  store.setPreflight({
    ready: false,
    reason: "EVENT_CHANNEL_FAILED",
    message,
  });
  store.setSessionError({
    code: EVENT_CHANNEL_FAILED_CODE,
    message,
  });
  store.setSessionStatus("error");
  store.setIsTyping(false);
  store.setShowInstallGuide(true);
}

/**
 * createSession 後 subscribe 會 replay；必須等到 core 狀態落地，
 * 否則立刻 sendText 時遲到的 idle 會清掉 activeTurn，tool call 進不了網頁。
 *
 * 在第一則 core status 之後再等一段「安靜期」，避免 replay 尾包在 sendText 之後才到。
 */
export function waitForPedelecSessionSettled(
  session: LivenessSession,
  options?: {
    timeoutMs?: number;
    quietMs?: number;
    allowTimeout?: boolean;
  },
): Promise<{ ok: boolean; status?: PedelecSessionStatus; message?: string }> {
  const timeoutMs = options?.timeoutMs ?? 4000;
  const quietMs = options?.quietMs ?? 400;
  const allowTimeout = options?.allowTimeout ?? true;

  return new Promise((resolve) => {
    let done = false;
    let lastStatus: PedelecSessionStatus | undefined;
    let quietTimer: number | undefined;

    const finish = (result: {
      ok: boolean;
      status?: PedelecSessionStatus;
      message?: string;
    }) => {
      if (done) return;
      done = true;
      offStatus();
      offError?.();
      window.clearTimeout(timeoutTimer);
      if (quietTimer != null) window.clearTimeout(quietTimer);
      resolve(result);
    };

    const armQuiet = () => {
      if (quietTimer != null) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        finish({
          ok: true,
          status: lastStatus ?? session.getStatus(),
        });
      }, quietMs);
    };

    const offStatus = session.onStatus((status, ctx) => {
      if (!isCoreOrUnspecified(ctx)) return;
      lastStatus = status;
      armQuiet();
    });
    const offError = session.onError?.((error) => {
      finish({
        ok: false,
        message: errorMessage(error),
      });
    });

    const current = session.getStatus();
    if (current === "idle" || current === "running") {
      lastStatus = current;
      armQuiet();
    }

    const timeoutTimer = window.setTimeout(() => {
      if (allowTimeout || lastStatus) {
        finish({
          ok: true,
          status: lastStatus ?? session.getStatus(),
        });
        return;
      }
      finish({
        ok: false,
        message: EVENT_CHANNEL_FAILED_MESSAGE,
      });
    }, timeoutMs);
  });
}

/**
 * createSession 後 subscribe 會 replay；必須等到 core 狀態落地，
 * 否則立刻 sendText 時遲到的 idle 會清掉 activeTurn，tool call 進不了網頁。
 */
export function waitForPedelecCoreStatus(
  session: LivenessSession,
  options?: { timeoutMs?: number; allowTimeout?: boolean },
): Promise<{ ok: boolean; status?: PedelecSessionStatus; message?: string }> {
  const timeoutMs = options?.timeoutMs ?? 4000;
  const allowTimeout = options?.allowTimeout ?? false;

  return new Promise((resolve) => {
    let done = false;
    const finish = (result: {
      ok: boolean;
      status?: PedelecSessionStatus;
      message?: string;
    }) => {
      if (done) return;
      done = true;
      offStatus();
      offError?.();
      window.clearTimeout(timer);
      resolve(result);
    };

    const offStatus = session.onStatus((status, ctx) => {
      if (!isCoreOrUnspecified(ctx)) return;
      finish({ ok: true, status });
    });
    const offError = session.onError?.((error) => {
      finish({
        ok: false,
        message: errorMessage(error),
      });
    });
    const timer = window.setTimeout(() => {
      if (allowTimeout) {
        finish({ ok: true, status: session.getStatus() });
        return;
      }
      finish({
        ok: false,
        message: EVENT_CHANNEL_FAILED_MESSAGE,
      });
    }, timeoutMs);
  });
}

/**
 * sendText 後若完全收不到 running／tool／chat，代表 Desktop 在跑、網頁是聾的。
 */
export function waitForPedelecTurnSignal(
  session: LivenessSession,
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const live = normalizePedelecSessionStatus(session.getStatus());
  if (live === "running" || live === "waiting_tool_result") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      offStatus();
      offChat?.();
      offError?.();
      window.clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const offStatus = session.onStatus((status) => {
      const normalized = normalizePedelecSessionStatus(status);
      if (
        normalized === "running" ||
        normalized === "waiting_tool_result" ||
        normalized === "error" ||
        normalized === "ended"
      ) {
        finish();
      }
    });
    const offChat = session.onChat?.(() => finish());
    const offError = session.onError?.((error) => {
      finish(new Error(errorMessage(error)));
    });
    const timer = window.setTimeout(() => {
      finish(new PedelecEventChannelError());
    }, timeoutMs);
  });
}
