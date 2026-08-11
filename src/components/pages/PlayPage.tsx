import { useEffect, useMemo, useState } from "react";
import { Flag, Lightbulb, Sparkles } from "lucide-react";
import { StoryLog } from "@/components/chat/StoryLog";
import { Composer } from "@/components/chat/Composer";
import { AiPlayerToggle } from "@/components/dev/AiPlayerToggle";
import {
  RuleLookupToast,
  SecretRollNotice,
} from "@/components/game/DiceModal";
import { TaskFeedback } from "@/components/pedelec/TaskFeedback";
import { GameSidebar } from "@/components/sheet/GameSidebar";
import { NoteEditorModal } from "@/components/sheet/NoteEditorModal";
import { Button } from "@/components/ui/button";
import {
  extractEndingTitleFromNarrative,
  looksLikeEndingNarrative,
} from "@/lib/endingDetect";
import { shouldOfferOpeningRetry, findLatestOpeningFailure, hadPriorOpeningAttempt } from "@/lib/openingRetry";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

type CreateNoteSeed = { title: string; content: string };

function PlayTitleCard() {
  const summary = useGameStore((s) => s.script.public_summary);
  const character = useGameStore((s) => s.character);
  if (!summary) {
    return (
      <p className="story-text text-sm text-muted">
        冒險即將開始。請 GM 述說開場。
      </p>
    );
  }
  return (
    <div className="mx-auto max-w-lg space-y-3 text-center">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted">
        Session Zero · 開場扉頁
      </p>
      <h2 className="font-display text-2xl text-ink">{summary.title}</h2>
      <p className="text-sm text-muted">{summary.genre}</p>
      {summary.player_hook ? (
        <p className="story-text text-left text-sm leading-relaxed text-ink/90">
          {summary.player_hook}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {character
          ? `${character.name} · ${character.role_title}`
          : summary.protagonist_role}
      </p>
      {summary.geography ? (
        <p className="text-[11px] text-muted">舞台：{summary.geography}</p>
      ) : null}
    </div>
  );
}

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
  const phase = useGameStore((s) => s.phase);
  const lastPlayerAction = useGameStore((s) => s.lastPlayerAction);
  const sessionError = useGameStore((s) => s.sessionError);
  const setSessionError = useGameStore((s) => s.setSessionError);
  const retryAction = useGameStore((s) => s.retryAction);
  const setRetryAction = useGameStore((s) => s.setRetryAction);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const pendingManualEnding = useGameStore((s) => s.pendingManualEnding);
  const offerManualEnding = useGameStore((s) => s.offerManualEnding);
  const confirmManualEnding = useGameStore((s) => s.confirmManualEnding);
  const scriptTitle = useGameStore((s) => s.script.public_summary?.title);
  const [createNote, setCreateNote] = useState<CreateNoteSeed | null>(null);
  const [starting, setStarting] = useState(false);

  /** 已卡住的舊存檔：從近期 GM 敘事還原「進入結算」提示 */
  const endingOffer = useMemo(() => {
    if (phase !== "PLAYING") return null;
    if (pendingManualEnding) return pendingManualEnding;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.role !== "agent") continue;
      if (!looksLikeEndingNarrative(m.content)) continue;
      return {
        title: extractEndingTitleFromNarrative(
          m.content,
          scriptTitle ?? "結局",
        ),
        narrative: m.content,
      };
    }
    return null;
  }, [phase, pendingManualEnding, messages, scriptTitle]);

  useEffect(() => {
    if (!endingOffer || pendingManualEnding) return;
    offerManualEnding(endingOffer);
  }, [endingOffer, pendingManualEnding, offerManualEnding]);

  const offerOpeningRetry = shouldOfferOpeningRetry({
    phase,
    lastPlayerAction,
    sessionError,
    sessionStatus,
    historyLength: history.length,
    messages,
  });

  const openingFailure =
    sessionError ?? findLatestOpeningFailure(messages);

  const isOpeningRetry =
    Boolean(openingFailure) ||
    hadPriorOpeningAttempt({
      historyLength: history.length,
      messages,
      sessionError,
    });

  // 玩家尚未行動時確保有 opening retryAction（含開場寫到一半後失敗）
  useEffect(() => {
    if (phase !== "PLAYING") return;
    if (lastPlayerAction.trim()) return;
    if (retryAction?.kind === "opening") return;
    setRetryAction({
      kind: "opening",
      label: isOpeningRetry ? "重試開場敘事" : "述說開場敘事",
    });
  }, [phase, lastPlayerAction, retryAction?.kind, setRetryAction, isOpeningRetry]);

  // sessionError 被清掉時，從系統訊息還原，讓開場失敗橫幅能顯示錯誤碼
  useEffect(() => {
    if (phase !== "PLAYING") return;
    if (lastPlayerAction.trim()) return;
    if (sessionError) return;
    const recovered = findLatestOpeningFailure(messages);
    if (recovered) setSessionError(recovered);
  }, [phase, lastPlayerAction, sessionError, messages, setSessionError]);

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

  const openingBusy =
    starting || sessionStatus === "running" || sessionStatus === "waiting_tool_result";

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
          {offerOpeningRetry ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink">
              <span className="min-w-0 flex-1">
                {openingBusy && !openingFailure
                  ? isOpeningRetry
                    ? "場景重啟中——GM 正重新述說開場…"
                    : "夜幕將至——GM 正在為你述說開場…"
                  : openingFailure
                    ? `開場中斷（${openingFailure.code}）。可請 GM 重新述說開場。`
                    : isOpeningRetry
                      ? "先前開場未完成。可請 GM 重新述說開場。"
                      : "角色已就緒。請按下方按鈕請 GM 述說開場。"}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7 shrink-0 gap-1"
                disabled={
                  starting ||
                  !onRetry ||
                  (sessionStatus === "running" && !openingFailure)
                }
                onClick={startOpening}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {starting
                  ? isOpeningRetry
                    ? "重新開場中…"
                    : "開場中…"
                  : isOpeningRetry
                    ? "重新述說開場"
                    : "請 AI 述說開場"}
              </Button>
            </div>
          ) : (
            <TaskFeedback onRetry={onRetry} />
          )}
          <SecretRollNotice />
          <RuleLookupToast />
          {endingOffer ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-ink">
              <span className="min-w-0 flex-1">
                {pendingManualEnding?.ending_type === "BAD_ENDING"
                  ? `角色已瀕死／崩潰（${endingOffer.title}）。建議以壞結局進入結算，勿硬拗通關。`
                  : `GM 已寫出結局敘事（${endingOffer.title}），但尚未進入結算畫面。可手動進入階段四結算與角色成長。`}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7 shrink-0 gap-1"
                disabled={
                  sessionStatus === "running" ||
                  sessionStatus === "waiting_tool_result"
                }
                onClick={() =>
                  confirmManualEnding({
                    title: endingOffer.title,
                    narrative: endingOffer.narrative,
                    ending_type:
                      pendingManualEnding?.ending_type ??
                      ("ending_type" in endingOffer
                        ? (endingOffer as { ending_type?: string }).ending_type
                        : undefined),
                  })
                }
              >
                <Flag className="h-3.5 w-3.5" />
                進入結算
              </Button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <StoryLog
            header={phase === "PLAYING" ? <PlayTitleCard /> : undefined}
            onAddSelectionToNote={openCreateNote}
            narrativeControls={phase === "PLAYING"}
          />
        </div>
        <div className="shrink-0">
          <Composer disabled={composerDisabled} onRegenerate={onRegenerate} />
          <AiPlayerToggle />
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
