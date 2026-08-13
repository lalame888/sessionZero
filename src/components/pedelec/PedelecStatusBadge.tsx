import { useEffect, useState } from "react";
import type { PedelecSessionStatus } from "@kaoruisaac/pedelec";
import { AlertCircle, CheckCircle2, Loader2, PlugZap, WifiOff } from "lucide-react";
import { probePedelecAppConnected } from "@/lib/pedelec/preflight";
import { syncSessionStatusFromLive } from "@/lib/pedelec/createGameSession";
import {
  isBusyPedelecStatus,
  normalizePedelecSessionStatus,
} from "@/lib/pedelec/sessionLiveness";
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
  if (isBusyPedelecStatus(sessionStatus)) {
    return { text: "Agent 執行中", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> };
  }
  if (!ready) {
    if (reason === "NEEDS_INSTALLATION") {
      return { text: "Extension 不可用", icon: <WifiOff className="h-3.5 w-3.5" /> };
    }
    if (reason === "DESKTOP_DISCONNECTED") {
      return { text: "Desktop 未連線", icon: <WifiOff className="h-3.5 w-3.5" /> };
    }
    if (reason === "NO_AVAILABLE_PROVIDER") {
      return { text: "Desktop / Provider 未就緒", icon: <AlertCircle className="h-3.5 w-3.5" /> };
    }
    if (reason === "NEEDS_APPROVAL") {
      return { text: "需要核准", icon: <AlertCircle className="h-3.5 w-3.5" /> };
    }
    if (reason === "EVENT_CHANNEL_FAILED") {
      return { text: "暫時無法連線", icon: <AlertCircle className="h-3.5 w-3.5" /> };
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

export function PedelecStatusBadge() {
  const preflight = useGameStore((s) => s.preflight);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const setPreflight = useGameStore((s) => s.setPreflight);
  const setShowInstallGuide = useGameStore((s) => s.setShowInstallGuide);
  const setShowSettings = useGameStore((s) => s.setShowSettings);
  const [pulse, setPulse] = useState(false);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (normalizePedelecSessionStatus(sessionStatus) === "running") setPulse(true);
    else setPulse(false);
  }, [sessionStatus]);

  // store 偶發沒跟上 live（尤其 waiting_tool_result 後 agent 已結束）
  useEffect(() => {
    if (!isBusyPedelecStatus(sessionStatus)) {
      return;
    }
    syncSessionStatusFromLive();
    const id = window.setInterval(() => {
      syncSessionStatusFromLive();
    }, 2000);
    return () => window.clearInterval(id);
  }, [sessionStatus]);

  const checking = preflight.reason === "CHECKING" || probing;
  const { text, icon } = labelFor(
    preflight.ready,
    preflight.reason,
    sessionStatus,
    checking,
  );

  const openInstallGuide = () => {
    setShowSettings(false);
    setShowInstallGuide(true);
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-ink",
        pulse && "ring-1 ring-accent/50",
      )}
    >
      <button
        type="button"
        disabled={checking}
        onClick={() => {
          void (async () => {
            if (!preflight.ready) {
              openInstallGuide();
              return;
            }
            setProbing(true);
            try {
              const connected = await probePedelecAppConnected();
              if (!connected) {
                setPreflight({
                  ready: false,
                  reason: "DESKTOP_DISCONNECTED",
                  message:
                    "Pedelec Desktop 未連線。請啟動 Desktop App 後按「重新檢查」。",
                });
                openInstallGuide();
                return;
              }
              setShowSettings(true);
            } finally {
              setProbing(false);
            }
          })();
        }}
        className="inline-flex items-center gap-2 rounded-sm px-1.5 py-0.5 outline-none transition-colors hover:bg-bg/60 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-70"
        aria-label={`Pedelec 狀態：${text}`}
      >
        {icon}
        <span>{text}</span>
      </button>
    </div>
  );
}
