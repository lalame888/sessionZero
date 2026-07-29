import { Button } from "@/components/ui/button";
import { EndingStage } from "@/components/stages/EndingStage";

export function EndingPage({ onHome }: { onHome: () => void }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="brand-title text-xl text-ink">結算與回放</h2>
          <p className="mt-1 text-sm text-muted">
            解鎖幕後真相、成長結算，並用時間軸對照暗骰與歷史快照。
          </p>
        </div>
        <Button variant="secondary" onClick={onHome}>
          返回首頁
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EndingStage />
      </div>
    </div>
  );
}
