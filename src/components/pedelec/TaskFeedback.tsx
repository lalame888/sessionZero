import { useGameStore } from "@/store/useGameStore";

export function TaskFeedback() {
  const status = useGameStore((s) => s.sessionStatus);
  const pendingDice = useGameStore((s) => s.pendingDice);
  const secretRollActive = useGameStore((s) => s.secretRollActive);

  let text = "";
  if (pendingDice) text = `等待你的擲骰：${pendingDice.check_target_name}`;
  else if (secretRollActive) text = "GM 暗骰處理中…";
  else if (status === "running") text = "GM 正在敘事…";
  else if (status === "waiting_tool_result") text = "等待工具／互動完成…";
  else if (status === "error") text = "發生錯誤，可重試或重建 Session";
  else return null;

  return (
    <div
      className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted"
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
