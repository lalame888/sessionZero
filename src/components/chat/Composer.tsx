import { useState } from "react";
import { Redo2, Send, Undo2 } from "lucide-react";
import { DiceCheckPanel } from "@/components/game/DiceModal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { sendPlayerAction } from "@/lib/pedelec/createGameSession";
import { useGameStore } from "@/store/useGameStore";

const QUICK = [
  "我仔細觀察四周。",
  "我嘗試與對方交涉。",
  "我準備戰鬥姿態。",
  "我檢查背包物品。",
];

function composerPlaceholder(opts: {
  disabled: boolean;
  sending: boolean;
  phase: string;
  preflightReady: boolean;
  sessionStatus: string;
}): string {
  const { disabled, sending, phase, preflightReady, sessionStatus } = opts;

  if (!preflightReady) {
    return "Pedelec 未就緒，請先完成連線設定…";
  }

  if (
    sending ||
    sessionStatus === "running" ||
    sessionStatus === "waiting_tool_result"
  ) {
    return "Agent 忙碌中，請稍候…";
  }

  if (sessionStatus === "error" || sessionStatus === "ended") {
    return "Session 異常，請重試連線後再輸入…";
  }

  if (disabled || sessionStatus === "disconnected") {
    return "正在連線 Session，請稍候…";
  }

  if (phase === "SESSION_0") {
    return "描述故事想法、氛圍或想玩的系統（預設單人一位主角）…";
  }

  return "描述你的行動…";
}

export function Composer({
  disabled,
  onRegenerate,
}: {
  disabled: boolean;
  onRegenerate?: () => void;
}) {
  const draft = useGameStore((s) => s.composerDraft);
  const setDraft = useGameStore((s) => s.setComposerDraft);
  const undoLastTurn = useGameStore((s) => s.undoLastTurn);
  const phase = useGameStore((s) => s.phase);
  const pendingDice = useGameStore((s) => s.pendingDice);
  const preflightReady = useGameStore((s) => s.preflight.ready);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const [sending, setSending] = useState(false);

  const awaitingPublicDice = Boolean(pendingDice && !pendingDice.isSecret);
  const placeholder = composerPlaceholder({
    disabled,
    sending,
    phase,
    preflightReady,
    sessionStatus,
  });

  const submit = async (text: string) => {
    const value = text.trim();
    if (!value || disabled || sending || awaitingPublicDice) return;
    setSending(true);
    try {
      setDraft("");
      await sendPlayerAction(value);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "未知錯誤";
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : message;
      const preSend = message === "NO_SESSION" || message === "SESSION_BUSY";
      if (preSend) setDraft(value);

      const store = useGameStore.getState();
      store.setRetryAction({
        kind: "player",
        label: "重試上一步行動",
        text: value,
      });
      if (!store.sessionError) {
        store.setSessionError({ code, message });
        store.appendSystem(
          preSend
            ? `送出失敗：${code} — ${message}（草稿已保留）`
            : `送出失敗：${code} — ${message}（可按重試）`,
        );
      }
    } finally {
      setSending(false);
    }
  };

  if (awaitingPublicDice) {
    return <DiceCheckPanel />;
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {phase === "PLAYING" ? (
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <Button
              key={q}
              size="sm"
              variant="secondary"
              disabled={disabled || sending}
              onClick={() => void submit(q)}
            >
              {q}
            </Button>
          ))}
        </div>
      ) : null}
      <Textarea
        value={draft}
        disabled={disabled || sending}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !(e.nativeEvent as KeyboardEvent).isComposing
          ) {
            e.preventDefault();
            void submit(draft);
          }
        }}
        rows={3}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={disabled || sending || !draft.trim()}
          onClick={() => void submit(draft)}
        >
          <Send className="h-4 w-4" />
          送出
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || sending}
          onClick={() => undoLastTurn()}
        >
          <Undo2 className="h-4 w-4" />
          Undo
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || sending || !onRegenerate}
          onClick={() => onRegenerate?.()}
        >
          <Redo2 className="h-4 w-4" />
          Regenerate
        </Button>
      </div>
    </div>
  );
}
