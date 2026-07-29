import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CampaignMeta } from "@/lib/campaignStorage";
import { cn } from "@/lib/utils";
import {
  SCENARIO_SCALE_LABELS,
  normalizeScenarioScale,
} from "@/engine/scenarioScale";
import type { GamePhase } from "@/types/game";

const PHASE_LABEL: Record<GamePhase, string> = {
  PREFLIGHT: "預檢",
  SESSION_0: "創建劇本",
  CHARACTER: "創角",
  PLAYING: "冒險進行",
  ENDING: "結算回放",
};

function scaleLabel(meta: CampaignMeta): string {
  if (!meta.scenarioScale) return "規模未定";
  return SCENARIO_SCALE_LABELS[normalizeScenarioScale(meta.scenarioScale)];
}

export function HomePage({
  sessions,
  pedelecReady,
  bootstrapping,
  onCreate,
  onOpen,
  onDelete,
}: {
  sessions: CampaignMeta[];
  pedelecReady: boolean;
  bootstrapping: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-8 px-2 py-6">
      <div className="text-center">
        <h1 className="brand-title text-4xl text-ink md:text-5xl">SessionZero</h1>
        <p className="mt-3 text-sm text-muted md:text-base">
          萬用 AI TRPG 跑團引擎。先選擇既有劇本，或開一個全新 Session。
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button
          size="lg"
          disabled={bootstrapping || !pedelecReady}
          onClick={onCreate}
        >
          <Plus className="h-5 w-5" />
          創建新劇本
        </Button>
      </div>

      {!pedelecReady && !bootstrapping ? (
        <p className="text-center text-sm text-accent-2">
          請先完成 Pedelec 連線後再開始（點右上角狀態徽章）。
        </p>
      ) : null}

      {bootstrapping ? (
        <p className="text-center text-sm text-muted">正在建立 Session 並連線 GM…</p>
      ) : null}

      <section className="rounded-xl border border-border bg-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2 text-ink">
          <FolderOpen className="h-4 w-4" />
          <h2 className="brand-title text-lg">既有 Session</h2>
        </div>
        {sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            尚無存檔。建立第一個劇本開始 Session 0。
          </p>
        ) : (
          <ul className="max-h-[42vh] space-y-2 overflow-y-auto">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-3",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  disabled={bootstrapping || !pedelecReady}
                  onClick={() => onOpen(s.id)}
                >
                  <div className="truncate font-medium text-ink">{s.title}</div>
                  <div className="mt-1 text-xs text-muted">
                    {s.systemId ?? "系統未定"} · {scaleLabel(s)} ·{" "}
                    {PHASE_LABEL[s.phase]} ·{" "}
                    {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    if (confirm(`確定刪除「${s.title}」？`)) onDelete(s.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
