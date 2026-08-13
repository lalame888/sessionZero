import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StickyNote, RefreshCw, CornerDownRight, RotateCw } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Button } from "@/components/ui/button";
import {
  continueLastNarrative,
  regenerateLastNarrative,
} from "@/lib/pedelec/createGameSession";
import { isCorruptedNarrativeFragment } from "@/lib/narrativeDedupe";
import { parseHistoryActorInput } from "@/lib/historySpeaker";
import { looksLikeLeakedToolCall } from "@/lib/pedelec/leakedToolCall";
import { isGmMetaOnlyNarrative, stripGmMetaPrompts } from "@/lib/stripGmMetaPrompts";
import {
  isHiddenDuplicatePlayerMessage,
  isPlayerVisibleSystemMessage,
  playerMessageNeedsResend,
} from "@/lib/playTurnState";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

export function TypingIndicator() {
  const isTyping = useGameStore((s) => s.isTyping);
  if (!isTyping) return null;
  return (
    <div
      className="flex items-center gap-1 rounded-lg bg-surface-2 px-3 py-2 text-muted"
      aria-label="Agent is responding"
      role="status"
    >
      <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted" />
      <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted" />
      <span className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-muted" />
    </div>
  );
}

type SelectionToolbar = {
  text: string;
  x: number;
  y: number;
};

export function StoryLog({
  onAddSelectionToNote,
  narrativeControls,
  header,
  onResendLastPlayer,
}: {
  onAddSelectionToNote?: (seed: { content: string }) => void;
  /** PLAYING 階段啟用重抽／續寫 */
  narrativeControls?: boolean;
  /** 置於訊息列表頂端（例：開場扉頁），隨紀錄捲動但不因 GM 開場而移除 */
  header?: ReactNode;
  onResendLastPlayer?: () => void | Promise<void>;
} = {}) {
  const messages = useGameStore((s) => s.messages);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const sessionError = useGameStore((s) => s.sessionError);
  const phase = useGameStore((s) => s.phase);
  const pendingDice = useGameStore((s) => s.pendingDice);
  const containerRef = useRef<HTMLDivElement>(null);
  const isTyping = useGameStore((s) => s.isTyping);
  const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null);
  const [busy, setBusy] = useState<"regen" | "continue" | "resend" | null>(null);

  const visibleMessages = messages.filter(
    (m) =>
      !(
        (m.role === "agent" &&
          (!(m.content ?? "").trim() ||
            looksLikeLeakedToolCall(m.content) ||
            isCorruptedNarrativeFragment(m.content) ||
            isGmMetaOnlyNarrative(m.content))) ||
        (m.role === "system" && !isPlayerVisibleSystemMessage(m.content)) ||
        isHiddenDuplicatePlayerMessage(messages, m.id)
      ),
  );

  const lastAgentId = [...visibleMessages]
    .reverse()
    .find((m) => m.role === "agent")?.id;

  /** 僅在接近底部時跟隨新訊息；避免反白選字／toolbar 重渲染時跳到底 */
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  const clearToolbar = useCallback(() => setToolbar(null), []);

  const updateSelectionToolbar = useCallback(() => {
    if (!onAddSelectionToNote) {
      setToolbar(null);
      return;
    }
    const root = containerRef.current;
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setToolbar(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setToolbar(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const node = common.nodeType === Node.TEXT_NODE ? common.parentNode : common;
    if (!node || !root.contains(node)) {
      setToolbar(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    setToolbar({
      text,
      x: Math.min(
        Math.max(rect.left + rect.width / 2 - rootRect.left, 48),
        rootRect.width - 48,
      ),
      y: Math.max(rect.top - rootRect.top - 8 + root.scrollTop, 8),
    });
  }, [onAddSelectionToNote]);

  useEffect(() => {
    if (!onAddSelectionToNote) return;
    const root = containerRef.current;
    if (!root) return;

    const onMouseUp = () => {
      window.setTimeout(updateSelectionToolbar, 0);
    };
    const onScroll = () => {
      const dist =
        root.scrollHeight - root.scrollTop - root.clientHeight;
      stickToBottomRef.current = dist < 96;
      clearToolbar();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearToolbar();
      else updateSelectionToolbar();
    };

    root.addEventListener("mouseup", onMouseUp);
    root.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("selectionchange", updateSelectionToolbar);
    return () => {
      root.removeEventListener("mouseup", onMouseUp);
      root.removeEventListener("scroll", onScroll);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("selectionchange", updateSelectionToolbar);
    };
  }, [clearToolbar, onAddSelectionToNote, updateSelectionToolbar]);

  const controlsLocked =
    busy != null ||
    sessionStatus !== "idle" ||
    Boolean(pendingDice) ||
    isTyping;

  const runRegen = async () => {
    if (controlsLocked) return;
    setBusy("regen");
    try {
      await regenerateLastNarrative();
    } catch (e) {
      useGameStore
        .getState()
        .appendSystem(
          `重新生成失敗：${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      setBusy(null);
    }
  };

  const runContinue = async () => {
    if (controlsLocked) return;
    setBusy("continue");
    try {
      await continueLastNarrative();
    } catch (e) {
      useGameStore
        .getState()
        .appendSystem(
          `續寫失敗：${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      setBusy(null);
    }
  };

  const runResend = async () => {
    if (!onResendLastPlayer || busy != null || isTyping) return;
    setBusy("resend");
    try {
      await onResendLastPlayer();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full max-h-full flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-2"
    >
      {header ? <div className="shrink-0 px-1 py-2">{header}</div> : null}
      {visibleMessages.length === 0 && !header ? (
        <p className="story-text text-sm text-muted">
          歡迎來到 SessionZero。描述你想玩的故事氛圍，GM 會與你討論劇本、系統與房規。
        </p>
      ) : null}
      {visibleMessages.map((m) => {
        const companionParsed =
          m.role === "user" && m.content.startsWith("【隊友")
            ? parseHistoryActorInput(m.content)
            : null;
        const isCompanion = companionParsed?.kind === "companion";
        return (
          <div
            key={m.id}
            className={cn(
              "max-w-[92%] shrink-0 rounded-lg px-3 py-2 text-sm",
              m.role === "user" &&
                !isCompanion &&
                "ml-auto bg-accent/20 text-ink",
              isCompanion &&
                "mr-auto border border-accent/30 bg-accent/10 text-ink",
              m.role === "agent" && "mr-auto bg-surface-2 story-text text-ink",
              m.role === "system" &&
                "mx-auto max-w-full border border-border bg-bg/60 text-xs text-muted",
            )}
          >
            {m.role !== "system" ? (
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
                {isCompanion
                  ? companionParsed!.label
                  : m.role === "user"
                    ? "你"
                    : "GM"}
              </div>
            ) : (
              <div className="mb-1 text-[10px] uppercase tracking-wide text-accent-2">
                系統
              </div>
            )}
            {m.role === "agent" ? (
              <MarkdownContent content={stripGmMetaPrompts(m.content)} />
            ) : (
              <div className="whitespace-pre-wrap">
                {isCompanion ? companionParsed!.body : m.content}
              </div>
            )}
            {onResendLastPlayer &&
            playerMessageNeedsResend(messages, m.id, {
              sessionStatus,
              sessionError,
              isTyping,
              phase,
            }) ? (
              <div className="mt-2 flex justify-end border-t border-border/50 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={busy != null}
                  onClick={() => void runResend()}
                >
                  <RotateCw
                    className={`h-3 w-3 ${busy === "resend" ? "animate-spin" : ""}`}
                  />
                  {busy === "resend" ? "重新發送中…" : "重新發送"}
                </Button>
              </div>
            ) : null}
            {narrativeControls &&
            m.role === "agent" &&
            m.id === lastAgentId ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={controlsLocked}
                  onClick={() => void runRegen()}
                >
                  <RefreshCw className="h-3 w-3" />
                  {busy === "regen" ? "重抽中…" : "重新生成"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={controlsLocked}
                  onClick={() => void runContinue()}
                >
                  <CornerDownRight className="h-3 w-3" />
                  {busy === "continue" ? "續寫中…" : "續寫"}
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
      <TypingIndicator />

      {toolbar && onAddSelectionToNote ? (
        <div
          className="pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: toolbar.x, top: toolbar.y }}
        >
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 px-2 shadow-md"
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={() => {
              onAddSelectionToNote({ content: toolbar.text });
              clearToolbar();
              window.getSelection()?.removeAllRanges();
            }}
          >
            <StickyNote className="h-3.5 w-3.5" />
            加入筆記
          </Button>
        </div>
      ) : null}
    </div>
  );
}
