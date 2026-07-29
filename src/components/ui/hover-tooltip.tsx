import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HoverTooltip({
  header,
  content,
  children,
  className,
}: {
  header: string;
  content: string;
  children: ReactNode;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const show = Boolean(anchor && content.trim());

  return (
    <>
      <span
        className={cn("inline-flex cursor-help", className)}
        onMouseEnter={(e) => {
          if (!content.trim()) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({
            x: rect.left + rect.width / 2,
            y: rect.top - 8,
          });
        }}
        onMouseLeave={() => setAnchor(null)}
      >
        {children}
      </span>
      {show && anchor ? (
        <div
          className="pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 -translate-y-full rounded-md border border-[#9aa3b5]/50 bg-surface px-3 py-2 shadow-lg"
          style={{ left: anchor.x, top: anchor.y }}
        >
          <div className="mb-1 border-b border-border/50 pb-1 text-sm font-medium text-ink">
            {header}
          </div>
          <div className="text-sm text-ink whitespace-pre-wrap">{content}</div>
        </div>
      ) : null}
    </>
  );
}
