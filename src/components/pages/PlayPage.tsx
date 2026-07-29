import { Lightbulb } from "lucide-react";
import { StoryLog } from "@/components/chat/StoryLog";
import { Composer } from "@/components/chat/Composer";
import {
  RuleLookupToast,
  SecretRollNotice,
} from "@/components/game/DiceModal";
import { TaskFeedback } from "@/components/pedelec/TaskFeedback";
import { GameSidebar } from "@/components/sheet/GameSidebar";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

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

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
      <aside className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface/70 p-3">
        <GameSidebar />
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
          <TaskFeedback onRetry={onRetry} />
          <SecretRollNotice />
          <RuleLookupToast />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <StoryLog />
        </div>
        <div className="shrink-0">
          <Composer disabled={composerDisabled} onRegenerate={onRegenerate} />
        </div>
      </main>
    </div>
  );
}
