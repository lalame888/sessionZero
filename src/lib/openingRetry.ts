import type { ChatMessage, SessionErrorInfo } from "@/types/game";

/** 玩家尚未送出第一個行動：開場仍可重試 */
export function isBeforeFirstPlayerTurn(lastPlayerAction: string) {
  return !lastPlayerAction.trim();
}

export function hasAgentNarrative(messages: ChatMessage[]) {
  return messages.some((m) => m.role === "agent");
}

/** 尚無任何開場敘事（含 streaming / narrate_story） */
export function isOpeningEmpty(
  historyLength: number,
  messages: ChatMessage[],
) {
  return historyLength === 0 && !hasAgentNarrative(messages);
}

const SYSTEM_FAILURE_RE =
  /^(錯誤|重試失敗|連線失敗|送出失敗|Pedelec 尚未就緒)/;

/**
 * 是否曾嘗試過開場（有 GM 片段、歷史、錯誤、或正在重新述說）。
 * 用於區分「第一次開場」與「重新述說」。
 */
export function hadPriorOpeningAttempt(opts: {
  historyLength: number;
  messages: ChatMessage[];
  sessionError?: SessionErrorInfo | null;
}) {
  if (opts.historyLength > 0) return true;
  if (hasAgentNarrative(opts.messages)) return true;
  if (opts.sessionError) return true;
  if (findLatestOpeningFailure(opts.messages)) return true;
  return opts.messages.some(
    (m) =>
      m.role === "system" &&
      (/^正在重新述說開場/.test(m.content) ||
        /^正在重建連線並重試開場/.test(m.content)),
  );
}

/**
 * 從聊天紀錄還原「開場後／開場中」的失敗。
 * sessionError 常在回到 idle 時被清掉，但系統訊息仍在。
 */
export function findLatestOpeningFailure(
  messages: ChatMessage[],
): SessionErrorInfo | null {
  let lastAgentIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "agent") {
      lastAgentIdx = i;
      break;
    }
  }

  // 優先：最後一則 GM 敘事之後的錯誤（開場寫到一半／剛寫完就斷線）
  const fromIdx = lastAgentIdx >= 0 ? lastAgentIdx + 1 : 0;
  for (let i = messages.length - 1; i >= fromIdx; i--) {
    const m = messages[i];
    if (!m || m.role !== "system") continue;
    if (!SYSTEM_FAILURE_RE.test(m.content)) continue;
    const parsed = m.content.match(/^錯誤：([A-Z0-9_]+)\s*—\s*([\s\S]+)$/);
    if (parsed) {
      return { code: parsed[1]!, message: parsed[2]!.trim() };
    }
    return { code: "OPENING_INTERRUPTED", message: m.content };
  }

  // 尚無 GM 敘事時：整段紀錄中的最近錯誤也算開場失敗
  if (lastAgentIdx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.role !== "system") continue;
      if (!SYSTEM_FAILURE_RE.test(m.content)) continue;
      const parsed = m.content.match(/^錯誤：([A-Z0-9_]+)\s*—\s*([\s\S]+)$/);
      if (parsed) {
        return { code: parsed[1]!, message: parsed[2]!.trim() };
      }
      return { code: "OPENING_INTERRUPTED", message: m.content };
    }
  }

  return null;
}

/**
 * 應顯示開場按鈕：
 * - 完全沒開場，或
 * - 玩家尚未行動且 Session／連線出錯（含開場寫到一半後失敗），或
 * - sessionError 已被清掉，但訊息裡仍留有開場後的系統錯誤
 */
export function shouldOfferOpeningRetry(opts: {
  phase: string;
  lastPlayerAction: string;
  sessionError: SessionErrorInfo | null;
  sessionStatus: string;
  historyLength: number;
  messages: ChatMessage[];
}) {
  if (opts.phase !== "PLAYING") return false;
  if (!isBeforeFirstPlayerTurn(opts.lastPlayerAction)) return false;

  if (isOpeningEmpty(opts.historyLength, opts.messages)) return true;

  if (
    Boolean(opts.sessionError) ||
    opts.sessionStatus === "error" ||
    opts.sessionStatus === "ended" ||
    opts.sessionStatus === "disconnected"
  ) {
    return true;
  }

  return findLatestOpeningFailure(opts.messages) != null;
}
