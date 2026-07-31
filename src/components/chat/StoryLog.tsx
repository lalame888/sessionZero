import { useCallback, useEffect, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Button } from "@/components/ui/button";
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
}: {
  onAddSelectionToNote?: (seed: { content: string }) => void;
} = {}) {
  const messages = useGameStore((s) => s.messages);
  const containerRef = useRef<HTMLDivElement>(null);
  const isTyping = useGameStore((s) => s.isTyping);
  const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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
      // 等瀏覽器完成選取
      window.setTimeout(updateSelectionToolbar, 0);
    };
    const onScroll = () => clearToolbar();
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

  return (
    <div
      ref={containerRef}
      className="relative flex h-full max-h-full flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-2"
    >
      {messages.length === 0 ? (
        <p className="story-text text-sm text-muted">
          歡迎來到 SessionZero。描述你想玩的故事氛圍，GM 會與你討論劇本、系統與房規。
        </p>
      ) : null}
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "max-w-[92%] shrink-0 rounded-lg px-3 py-2 text-sm",
            m.role === "user" && "ml-auto bg-accent/20 text-ink",
            m.role === "agent" && "mr-auto bg-surface-2 story-text text-ink",
            m.role === "system" &&
              "mx-auto max-w-full border border-border bg-bg/60 text-xs text-muted",
          )}
        >
          {m.role !== "system" ? (
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
              {m.role === "user" ? "你" : "GM"}
            </div>
          ) : (
            <div className="mb-1 text-[10px] uppercase tracking-wide text-accent-2">
              系統
            </div>
          )}
          {m.role === "agent" ? (
            <MarkdownContent content={m.content} />
          ) : (
            <div className="whitespace-pre-wrap">{m.content}</div>
          )}
        </div>
      ))}
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
              // 避免按下按鈕時清掉選取
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
