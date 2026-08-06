import { useState } from "react";
import { Redo2, Send, Undo2, Users } from "lucide-react";
import { DiceCheckPanel } from "@/components/game/DiceModal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useAiPlayerStore } from "@/lib/aiPlayer";
import {
  resolvePendingCompanionHandoff,
  sendPlayerAction,
} from "@/lib/pedelec/createGameSession";
import { useGameStore } from "@/store/useGameStore";

const QUICK = [
  "我仔細觀察四周。",
  "我嘗試與對方交涉。",
  "我準備戰鬥姿態。",
];

function composerPlaceholder(opts: {
  disabled: boolean;
  sending: boolean;
  phase: string;
  preflightReady: boolean;
  sessionStatus: string;
  aiPlayerEnabled: boolean;
  pendingCompanion: boolean;
}): string {
  const {
    disabled,
    sending,
    phase,
    preflightReady,
    sessionStatus,
    aiPlayerEnabled,
    pendingCompanion,
  } = opts;

  if (aiPlayerEnabled) {
    return "AI Player 代打中…關閉開關後可手動輸入";
  }

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

  if (pendingCompanion) {
    return "可插話／一起行動，或按「讓 GM 結算」…";
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
  const pendingCompanionHandoff = useGameStore(
    (s) => s.pendingCompanionHandoff,
  );
  const preflightReady = useGameStore((s) => s.preflight.ready);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const aiPlayerEnabled = useAiPlayerStore((s) => s.enabled);
  const [sending, setSending] = useState(false);

  const awaitingPublicDice = Boolean(pendingDice && !pendingDice.isSecret);
  const inputLocked = disabled || sending || aiPlayerEnabled;
  const pendingCompanion = Boolean(pendingCompanionHandoff);
  const placeholder = composerPlaceholder({
    disabled,
    sending,
    phase,
    preflightReady,
    sessionStatus,
    aiPlayerEnabled,
    pendingCompanion,
  });

  const submit = async (text: string) => {
    const value = text.trim();
    if (!value || disabled || sending || awaitingPublicDice || aiPlayerEnabled) {
      return;
    }
    setSending(true);
    try {
      setDraft("");
      if (useGameStore.getState().pendingCompanionHandoff) {
        await resolvePendingCompanionHandoff({ playerSupplement: value });
      } else {
        await sendPlayerAction(value);
      }
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
            ? `送出前失敗（${code}）。草稿已保留，可點重試。`
            : `行動處理失敗（${code}）。可點重試或改寫後再送。`,
        );
      }
    } finally {
      setSending(false);
    }
  };

  const continueCompanion = async () => {
    if (
      disabled ||
      sending ||
      awaitingPublicDice ||
      aiPlayerEnabled ||
      !useGameStore.getState().pendingCompanionHandoff
    ) {
      return;
    }
    setSending(true);
    try {
      await resolvePendingCompanionHandoff();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "未知錯誤";
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : message;
      const store = useGameStore.getState();
      if (!store.sessionError) {
        store.setSessionError({ code, message });
        store.appendSystem(`隊友結算失敗（${code}）。可稍後再按「讓 GM 結算」。`);
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
      {pendingCompanionHandoff ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-surface-2/60 px-3 py-2 text-xs text-ink">
          <Users className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            「{pendingCompanionHandoff.companionName}」已宣告行動。可先插話，或讓
            GM 結算結果。
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={inputLocked}
            onClick={() => void continueCompanion()}
          >
            讓 GM 結算
          </Button>
        </div>
      ) : null}
      {phase === "PLAYING" ? (
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <Button
              key={q}
              size="sm"
              variant="secondary"
              disabled={inputLocked}
              onClick={() => void submit(q)}
            >
              {q}
            </Button>
          ))}
        </div>
      ) : null}
      <Textarea
        value={draft}
        disabled={inputLocked}
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
          disabled={inputLocked || !draft.trim()}
          onClick={() => void submit(draft)}
        >
          <Send className="h-4 w-4" />
          送出
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={inputLocked}
          onClick={() => undoLastTurn()}
        >
          <Undo2 className="h-4 w-4" />
          Undo
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={inputLocked || !onRegenerate}
          onClick={() => onRegenerate?.()}
        >
          <Redo2 className="h-4 w-4" />
          Regenerate
        </Button>
      </div>
    </div>
  );
}
