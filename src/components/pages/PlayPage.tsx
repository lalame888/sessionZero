import { useEffect, useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { StoryLog } from "@/components/chat/StoryLog";
import { Composer } from "@/components/chat/Composer";
import {
  RuleLookupToast,
  SecretRollNotice,
} from "@/components/game/DiceModal";
import { TaskFeedback } from "@/components/pedelec/TaskFeedback";
import { GameSidebar } from "@/components/sheet/GameSidebar";
import { NoteEditorModal } from "@/components/sheet/NoteEditorModal";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

type CreateNoteSeed = { title: string; content: string };

export function PlayPage({
  composerDisabled,
  onRegenerate,
  onRetry,
}: {
  composerDisabled: boolean;
  onRegenerate?: () => void;
  onRetry?: () => void | Promise<void>;
}) {
  const suggestPlayerActions = useGameStore((s) => s.suggestPlayerActions);
  const setSuggestPlayerActions = useGameStore((s) => s.setSuggestPlayerActions);
  const addPlayerNote = useGameStore((s) => s.addPlayerNote);
  const messages = useGameStore((s) => s.messages);
  const history = useGameStore((s) => s.history);
  const retryAction = useGameStore((s) => s.retryAction);
  const setRetryAction = useGameStore((s) => s.setRetryAction);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const [createNote, setCreateNote] = useState<CreateNoteSeed | null>(null);
  const [starting, setStarting] = useState(false);

  const openingPending =
    history.length === 0 && !messages.some((m) => m.role === "agent");

  // 開場未完成時確保有 retryAction，方便載入舊檔或錯誤後重試
  useEffect(() => {
    if (!openingPending) return;
    if (retryAction?.kind === "opening") return;
    setRetryAction({ kind: "opening", label: "重試開場敘事" });
  }, [openingPending, retryAction?.kind, setRetryAction]);

  const openCreateNote = (seed?: { title?: string; content?: string }) => {
    setCreateNote({
      title: seed?.title ?? "",
      content: seed?.content ?? "",
    });
  };

  const startOpening = () => {
    if (!onRetry || starting) return;
    void (async () => {
      setStarting(true);
      try {
        await onRetry();
      } finally {
        setStarting(false);
      }
    })();
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
      <aside className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface/70 p-3">
        <GameSidebar onRequestCreateNote={openCreateNote} />
      </aside>
      <main className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-3">
        <div className="mb-2 shrink-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant={suggestPlayerActions ? "default" : "secondary"}
              className={cn(
                "h-8 gap-1.5",
                !suggestPlayerActions && "text-muted",
              )}
              aria-pressed={suggestPlayerActions}
              title={
                suggestPlayerActions
                  ? "目前會請 GM 在敘事後提供「你可以：」行動建議；再按一次關閉"
                  : "目前不會提供行動建議；再按一次開啟"
              }
              onClick={() => setSuggestPlayerActions(!suggestPlayerActions)}
            >
              <Lightbulb
                className={cn(
                  "h-3.5 w-3.5",
                  suggestPlayerActions ? "fill-current" : "",
                )}
              />
              {suggestPlayerActions ? "推薦行動：開" : "推薦行動：關"}
            </Button>
            <p className="text-[10px] text-muted">
              {suggestPlayerActions
                ? "GM 敘事後會附上 2–4 個可採取的下一步"
                : "GM 只敘事，不給「你可以：」選項"}
            </p>
          </div>
          {openingPending ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink">
              <span className="min-w-0 flex-1">
                冒險尚未開場（可能先前連線失敗）。請按下方按鈕請 GM 述說開場。
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7 shrink-0 gap-1"
                disabled={starting || !onRetry || sessionStatus === "running"}
                onClick={startOpening}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {starting ? "開場中…" : "請 AI 述說開場"}
              </Button>
            </div>
          ) : null}
          <TaskFeedback onRetry={onRetry} />
          <SecretRollNotice />
          <RuleLookupToast />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <StoryLog onAddSelectionToNote={openCreateNote} />
        </div>
        <div className="shrink-0">
          <Composer disabled={composerDisabled} onRegenerate={onRegenerate} />
        </div>
      </main>

      <NoteEditorModal
        open={createNote != null}
        onOpenChange={(open) => {
          if (!open) setCreateNote(null);
        }}
        mode="create"
        initialTitle={createNote?.title ?? ""}
        initialContent={createNote?.content ?? ""}
        onSave={({ title, content }) => {
          addPlayerNote({ title, content });
        }}
      />
    </div>
  );
}
