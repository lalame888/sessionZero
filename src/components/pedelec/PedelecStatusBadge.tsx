import { useEffect, useState } from "react";
import type { PedelecSessionStatus } from "@kaoruisaac/pedelec";
import { AlertCircle, CheckCircle2, Loader2, PlugZap, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

function labelFor(
  ready: boolean,
  reason: string,
  sessionStatus: PedelecSessionStatus | "disconnected",
  checking: boolean,
): { text: string; icon: React.ReactNode } {
  if (checking || reason === "CHECKING") {
    return { text: "檢查 Pedelec…", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> };
  }
  if (sessionStatus === "running" || sessionStatus === "waiting_tool_result") {
    return { text: "Agent 執行中", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> };
  }
  if (!ready) {
    if (reason === "NEEDS_INSTALLATION") {
      return { text: "Extension 不可用", icon: <WifiOff className="h-3.5 w-3.5" /> };
    }
    if (reason === "NO_AVAILABLE_PROVIDER") {
      return { text: "Desktop / Provider 未就緒", icon: <AlertCircle className="h-3.5 w-3.5" /> };
    }
    if (reason === "NEEDS_APPROVAL") {
      return { text: "需要核准", icon: <AlertCircle className="h-3.5 w-3.5" /> };
    }
    return { text: "Pedelec 未就緒", icon: <WifiOff className="h-3.5 w-3.5" /> };
  }
  if (sessionStatus === "idle") {
    return { text: "Pedelec 已連線", icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
  }
  if (sessionStatus === "ended" || sessionStatus === "error") {
    return { text: "Session 需重建", icon: <AlertCircle className="h-3.5 w-3.5" /> };
  }
  return { text: "Pedelec 就緒", icon: <PlugZap className="h-3.5 w-3.5" /> };
}

export function PedelecStatusBadge({ onRecheck }: { onRecheck?: () => void }) {
  const preflight = useGameStore((s) => s.preflight);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const setShowInstallGuide = useGameStore((s) => s.setShowInstallGuide);
  const setShowSettings = useGameStore((s) => s.setShowSettings);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (sessionStatus === "running") setPulse(true);
    else setPulse(false);
  }, [sessionStatus]);

  const { text, icon } = labelFor(
    preflight.ready,
    preflight.reason,
    sessionStatus,
    preflight.reason === "CHECKING",
  );

  return (
    <button
      type="button"
      onClick={() => {
        if (!preflight.ready) setShowInstallGuide(true);
        else setShowSettings(true);
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-ink",
        pulse && "ring-1 ring-accent/50",
      )}
      aria-label={`Pedelec 狀態：${text}`}
    >
      {icon}
      <span>{text}</span>
      {onRecheck && !preflight.ready ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={(e) => {
            e.stopPropagation();
            onRecheck();
          }}
        >
          重檢
        </Button>
      ) : null}
    </button>
  );
}
