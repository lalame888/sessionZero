import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { CampaignMeta } from "@/lib/campaignStorage";
import { cn } from "@/lib/utils";
import {
  SCENARIO_SCALE_LABELS,
  normalizeScenarioScale,
} from "@/engine/scenarioScale";
import type { GamePhase } from "@/types/game";

const PHASE_LABEL: Record<GamePhase, string> = {
  PREFLIGHT: "預檢",
  SESSION_0: "劇本討論",
  CHARACTER: "創角",
  PLAYING: "冒險中",
  ENDING: "已結算",
};

function scaleLabel(meta: CampaignMeta): string {
  if (!meta.scenarioScale) return "規模未定";
  return SCENARIO_SCALE_LABELS[normalizeScenarioScale(meta.scenarioScale)];
}

export function SessionManager({
  sessions,
  activeId,
  onNew,
  onSwitch,
  onDelete,
}: {
  sessions: CampaignMeta[];
  activeId: string | null;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  );

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        title="管理劇本 Session"
      >
        <FolderOpen className="h-4 w-4" />
        <span className="hidden sm:inline max-w-[10rem] truncate">
          {active?.title ?? "劇本庫"}
        </span>
      </Button>

      <Modal open={open} onOpenChange={setOpen} title="劇本 Session 管理">
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            每個 Session 對應一份獨立劇本與對話紀錄。重整頁面後會自動還原上次開啟的 Session。
          </p>
          <Button
            className="w-full"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
          >
            <Plus className="h-4 w-4" />
            開新劇本 Session
          </Button>

          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {sessions.length === 0 ? (
              <li className="rounded border border-dashed border-border p-3 text-center text-muted">
                尚無已存 Session
              </li>
            ) : (
              sessions.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "rounded-lg border p-3",
                      isActive
                        ? "border-accent bg-accent/10"
                        : "border-border bg-surface-2/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          if (!isActive) onSwitch(s.id);
                          setOpen(false);
                        }}
                      >
                        <div className="truncate font-medium text-ink">
                          {s.title}
                          {isActive ? "（目前）" : ""}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {s.boundCharacterName
                            ? `主角 ${s.boundCharacterName} · `
                            : ""}
                          隊伍 {s.partySize ?? 1} 人 ·{" "}
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
                          if (
                            confirm(
                              `確定刪除「${s.title}」？對話與劇本將無法復原。`,
                            )
                          ) {
                            onDelete(s.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </Modal>
    </>
  );
}
