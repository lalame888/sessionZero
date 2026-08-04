import { Bot } from "lucide-react";
import { useAiPlayerAutoPlay } from "@/lib/aiPlayer/useAiPlayerAutoPlay";
import { useAiPlayerStore } from "@/lib/aiPlayer/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<string, string> = {
  idle: "待機",
  thinking: "AI 思考行動中…",
  waiting_gm: "等待 GM…",
  rolling: "自動擲骰…",
  error: "錯誤",
};

/**
 * 開發限定：對話框下方的 AI 代打開關。
 * 正式 build（非 DEV）不渲染。
 */
export function AiPlayerToggle() {
  if (!import.meta.env.DEV) return null;
  return <AiPlayerToggleInner />;
}

function AiPlayerToggleInner() {
  useAiPlayerAutoPlay();

  const enabled = useAiPlayerStore((s) => s.enabled);
  const phase = useAiPlayerStore((s) => s.phase);
  const lastError = useAiPlayerStore((s) => s.lastError);
  const lastAction = useAiPlayerStore((s) => s.lastAction);
  const turnCount = useAiPlayerStore((s) => s.turnCount);
  const setEnabled = useAiPlayerStore((s) => s.setEnabled);

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-dashed border-border/80 bg-surface-2/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-ink">
            Dev · AI Player 代打
          </p>
          <p className="text-[10px] text-muted">
            僅公開資訊；開啟後持續行動直到關閉或結局
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={enabled ? "default" : "secondary"}
          className={cn("h-8 gap-1.5", !enabled && "text-muted")}
          aria-pressed={enabled}
          onClick={() => setEnabled(!enabled)}
        >
          <Bot className={cn("h-3.5 w-3.5", enabled && "animate-pulse")} />
          {enabled ? "代打：開" : "代打：關"}
        </Button>
      </div>
      {enabled ? (
        <p className="text-[10px] text-muted">
          {PHASE_LABEL[phase] ?? phase}
          {turnCount > 0 ? ` · 已代打 ${turnCount} 回合` : ""}
          {lastAction ? ` · 上一步：「${truncate(lastAction, 40)}」` : ""}
        </p>
      ) : null}
      {lastError ? (
        <p className="text-[10px] text-danger">{lastError}</p>
      ) : null}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
