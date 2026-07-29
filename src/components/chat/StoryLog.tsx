import { useEffect, useRef } from "react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
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

export function StoryLog() {
  const messages = useGameStore((s) => s.messages);
  const containerRef = useRef<HTMLDivElement>(null);
  const isTyping = useGameStore((s) => s.isTyping);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  return (
    <div
      ref={containerRef}
      className="flex h-full max-h-full flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-2"
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
    </div>
  );
}
