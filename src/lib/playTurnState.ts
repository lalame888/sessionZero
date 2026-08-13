import { parseHistoryActorInput } from "@/lib/historySpeaker";
import type { ChatMessage, RetryAction, SessionErrorInfo } from "@/types/game";

export function isCompanionChatMessage(m: {
  role: string;
  content: string;
}): boolean {
  return m.role === "user" && parseHistoryActorInput(m.content).kind === "companion";
}

/** 真正會切開「同輪 GM 氣泡」的玩家發言（隊友氣泡不算） */
export function isBlockingPlayerMessage(m: {
  role: string;
  content: string;
}): boolean {
  return m.role === "user" && !isCompanionChatMessage(m);
}

export function lastHumanPlayerMessage(
  messages: ChatMessage[],
): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (isBlockingPlayerMessage(m)) return m;
  }
  return null;
}

export function findLastAgentMessage(
  messages: ChatMessage[],
  opts?: { exceptId?: string },
): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "agent") continue;
    if (opts?.exceptId && m.id === opts.exceptId) continue;
    if (!(m.content ?? "").trim()) continue;
    return m;
  }
  return null;
}

/**
 * 從尾端略過 system：若先碰到 user 表示還在等 GM；
 * 先碰到 agent 表示 GM 已說完、輪到玩家。
 */
export function isAwaitingGmReply(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "system") continue;
    if (m.role === "user") return true;
    if (m.role === "agent") return false;
  }
  return false;
}

/** 人類玩家上一則之後，尚未出現任何 GM 敘事 */
export function humanPlayerAwaitingGmReply(messages: ChatMessage[]): boolean {
  const last = lastHumanPlayerMessage(messages);
  if (!last) return false;
  const idx = messages.findIndex((m) => m.id === last.id);
  if (idx < 0) return false;
  return !messages
    .slice(idx + 1)
    .some((m) => m.role === "agent" && (m.content ?? "").trim().length > 0);
}

export function playerMessageNeedsResend(
  messages: ChatMessage[],
  messageId: string,
  opts: {
    sessionStatus: string;
    sessionError: SessionErrorInfo | null;
    isTyping: boolean;
    phase: string;
  },
): boolean {
  if (opts.phase !== "PLAYING") return false;
  if (opts.isTyping) return false;
  if (
    opts.sessionStatus === "running" ||
    opts.sessionStatus === "waiting_tool_result"
  ) {
    return false;
  }
  const last = lastHumanPlayerMessage(messages);
  if (!last || last.id !== messageId) return false;
  if (!humanPlayerAwaitingGmReply(messages)) return false;
  return (
    Boolean(opts.sessionError) ||
    opts.sessionStatus === "idle" ||
    opts.sessionStatus === "error" ||
    opts.sessionStatus === "ended" ||
    opts.sessionStatus === "disconnected"
  );
}

/** GM 已對上一則人類玩家行動做出敘事 → 不要自動重送該行動 */
export function shouldSkipAutoRetryBecauseGmReplied(
  action: RetryAction | null,
  messages: ChatMessage[],
): boolean {
  if (!action || action.kind !== "player") return false;
  return !humanPlayerAwaitingGmReply(messages);
}

export function companionAlreadyHasGmReply(
  messages: ChatMessage[],
  companionName: string,
): boolean {
  const tag = `【隊友·${companionName}】`;
  const tagAlt = `【隊友・${companionName}】`;
  let idx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (m.content.startsWith(tag) || m.content.startsWith(tagAlt)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return false;
  return messages
    .slice(idx + 1)
    .some((m) => m.role === "agent" && (m.content ?? "").trim().length > 0);
}

export function isCompanionLabeledAction(text: string): boolean {
  return /^【隊友[·・]/.test(text.trim());
}

/** 聊天室不應顯示的內部系統訊息（舊存檔的 NPC 更新等） */
export function isPlayerVisibleSystemMessage(content: string): boolean {
  const t = content.trim();
  if (/^NPC 更新：/.test(t)) return false;
  if (/^（系統）本拍為隊友結算/.test(t)) return false;
  if (/^偵測到連線/.test(t) && /重試/.test(t)) return false;
  if (/^正在重建連線並重試/.test(t)) return false;
  if (/^正在重建連線並重試開場/.test(t)) return false;
  return true;
}

/** 連貼同一則玩家行動時，隱藏較早的那則（保留最後一則以便重送） */
export function isHiddenDuplicatePlayerMessage(
  messages: ChatMessage[],
  messageId: string,
): boolean {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx < 0) return false;
  const m = messages[idx];
  if (!m || !isBlockingPlayerMessage(m)) return false;
  const text = m.content.trim();
  for (let j = idx + 1; j < messages.length; j++) {
    const n = messages[j];
    if (!n) continue;
    if (n.role === "system") continue;
    if (n.role === "agent") return false;
    if (isBlockingPlayerMessage(n) && n.content.trim() === text) return true;
    if (n.role === "user") return false;
  }
  return false;
}
