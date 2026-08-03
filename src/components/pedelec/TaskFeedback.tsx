import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shouldOfferOpeningRetry, hadPriorOpeningAttempt } from "@/lib/openingRetry";
import { useGameStore } from "@/store/useGameStore";

export function TaskFeedback({
  onRetry,
}: {
  onRetry?: () => void | Promise<void>;
}) {
  const status = useGameStore((s) => s.sessionStatus);
  const sessionError = useGameStore((s) => s.sessionError);
  const retryAction = useGameStore((s) => s.retryAction);
  const pendingDice = useGameStore((s) => s.pendingDice);
  const secretRollActive = useGameStore((s) => s.secretRollActive);
  const phase = useGameStore((s) => s.phase);
  const messages = useGameStore((s) => s.messages);
  const history = useGameStore((s) => s.history);
  const lastPlayerAction = useGameStore((s) => s.lastPlayerAction);
  const [retrying, setRetrying] = useState(false);

  const offerOpeningRetry = shouldOfferOpeningRetry({
    phase,
    lastPlayerAction,
    sessionError,
    sessionStatus: status,
    historyLength: history.length,
    messages,
  });

  const isOpeningRetry =
    retryAction?.kind === "opening" &&
    (Boolean(sessionError) ||
      hadPriorOpeningAttempt({
        historyLength: history.length,
        messages,
        sessionError,
      }));

  const canRetry =
    Boolean(onRetry) &&
    Boolean(retryAction) &&
    (Boolean(sessionError) ||
      status === "error" ||
      status === "ended" ||
      status === "disconnected" ||
      (retryAction?.kind === "opening" && offerOpeningRetry));

  const openingRetry =
    retryAction?.kind === "opening" && offerOpeningRetry;

  let text = "";
  if (secretRollActive) text = "GM 暗骰處理中…";
  else if (pendingDice && !pendingDice.isSecret) {
    // 公開擲骰改由輸入區 DiceCheckPanel 處理，此處不重複提示
    return null;
  } else if (canRetry) {
    // 錯誤／可重試優先於「正在敘事」，避免斷線後卡在 running 卻看不到按鈕
    text = openingRetry
      ? sessionError
        ? `開場失敗：${sessionError.code} — ${sessionError.message}`
        : isOpeningRetry
          ? "先前開場未完成，可請 GM 重新述說開場。"
          : "角色已就緒，可請 GM 述說開場。"
      : sessionError
        ? `連線／Session 錯誤：${sessionError.code} — ${sessionError.message}`
        : status === "ended"
          ? "Session 已結束，可重建後重試。"
          : "發生錯誤，可重試上一步。";
  } else if (status === "running") text = "GM 正在敘事…";
  else if (status === "waiting_tool_result") text = "等待工具／互動完成…";
  else if (status === "error") {
    text = "發生錯誤，可重試或重建 Session";
  } else return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted"
      role="status"
      aria-live="polite"
    >
      <span className="min-w-0 flex-1">{text}</span>
      {canRetry ? (
        <Button
          size="sm"
          variant="secondary"
          className="h-7 shrink-0"
          disabled={retrying}
          onClick={() => {
            void (async () => {
              setRetrying(true);
              try {
                await onRetry?.();
              } finally {
                setRetrying(false);
              }
            })();
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
          {retrying
            ? isOpeningRetry
              ? "重新開場中…"
              : "開場中…"
            : retryAction?.kind === "opening"
              ? isOpeningRetry
                ? "重新述說開場"
                : "請 AI 述說開場"
              : (retryAction?.label ?? "重試")}
        </Button>
      ) : null}
    </div>
  );
}
