import type { GamePhase } from "@/types/game";
import { cn } from "@/lib/utils";

const STEPS: { id: GamePhase; label: string; short: string }[] = [
  { id: "PREFLIGHT", label: "連線預檢", short: "預檢" },
  { id: "SESSION_0", label: "Session 0 劇本", short: "劇本" },
  { id: "CHARACTER", label: "創角", short: "創角" },
  { id: "PLAYING", label: "冒險進行", short: "冒險" },
  { id: "ENDING", label: "結算回放", short: "結算" },
];

const ORDER: GamePhase[] = STEPS.map((s) => s.id);

export function PhaseStepper({ phase }: { phase: GamePhase }) {
  const currentIdx = Math.max(0, ORDER.indexOf(phase));
  const current = STEPS[currentIdx];

  return (
    <div className="w-full min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-ink">
          目前階段：{current.label}
        </span>
        <span className="text-[10px] text-muted">
          {currentIdx + 1} / {STEPS.length}
        </span>
      </div>
      <ol className="flex items-center gap-1">
        {STEPS.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1">
              <div
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-center",
                  done && "border-accent/50 bg-accent/15 text-ink",
                  active && "border-accent bg-accent/25 text-ink ring-1 ring-accent/40",
                  !done && !active && "border-border bg-surface-2/50 text-muted",
                )}
                title={step.label}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                    done && "bg-accent text-bg",
                    active && "bg-accent text-bg",
                    !done && !active && "bg-border text-muted",
                  )}
                >
                  {done ? "✓" : idx + 1}
                </span>
                <span className="truncate text-[10px] leading-tight md:text-xs">
                  <span className="md:hidden">{step.short}</span>
                  <span className="hidden md:inline">{step.label}</span>
                </span>
              </div>
              {idx < STEPS.length - 1 ? (
                <div
                  className={cn(
                    "hidden h-px w-2 shrink-0 sm:block",
                    idx < currentIdx ? "bg-accent" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
