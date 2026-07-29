import { StoryLog } from "@/components/chat/StoryLog";
import { Composer } from "@/components/chat/Composer";
import {
  RuleLookupToast,
  SecretRollNotice,
} from "@/components/game/DiceModal";
import { TaskFeedback } from "@/components/pedelec/TaskFeedback";
import { GameSidebar } from "@/components/sheet/GameSidebar";

export function PlayPage({
  composerDisabled,
  onRegenerate,
}: {
  composerDisabled: boolean;
  onRegenerate?: () => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
      <aside className="min-h-0 overflow-y-auto rounded-lg border border-border bg-surface/70 p-3">
        <GameSidebar />
      </aside>
      <main className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-3">
        <div className="mb-2 shrink-0 space-y-2">
          <TaskFeedback />
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
