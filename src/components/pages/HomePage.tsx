import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen, Plus, Trash2, Upload, Users } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { CharacterLibraryPanel } from "@/components/character/CharacterLibraryPanel";
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

type HomeTab = "sessions" | "characters";

const TAB_META: Record<
  HomeTab,
  { label: string; icon: typeof FolderOpen; panelTitle: string }
> = {
  sessions: {
    label: "既有 Session",
    icon: FolderOpen,
    panelTitle: "既有 Session",
  },
  characters: {
    label: "角色檔案庫",
    icon: Users,
    panelTitle: "角色檔案庫",
  },
};

export function HomePage({
  sessions,
  pedelecReady,
  bootstrapping,
  onCreate,
  onImportScript,
  onOpen,
  onDelete,
}: {
  sessions: CampaignMeta[];
  pedelecReady: boolean;
  bootstrapping: boolean;
  onCreate: () => void;
  onImportScript: (file: File) => void | Promise<void>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [tab, setTab] = useState<HomeTab | null>(sessions?.length > 0 ? "sessions" : null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createDisabled = bootstrapping || !pedelecReady;

  const selectTab = (next: HomeTab) => {
    setTab((prev) => (prev === next ? null : next));
  };
  useEffect(() => {
    if (sessions?.length > 0) setTab("sessions");
  }, [sessions]);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-8 px-2 py-6">
      <div className="text-center">
        <BrandMark size="lg" />
        <p className="mt-3 text-sm text-muted md:text-base">
          萬用 AI TRPG 跑團引擎。管理劇本 Session 與可跨劇本重用的角色檔案庫。
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <div className="relative inline-flex" ref={menuRef}>
          <Button
            size="lg"
            className="rounded-r-none"
            disabled={createDisabled}
            onClick={onCreate}
          >
            <Plus className="h-5 w-5" />
            創建新劇本
          </Button>
          <Button
            size="lg"
            className="rounded-l-none border-l border-bg/20 px-2.5"
            disabled={createDisabled}
            aria-label="更多開局方式"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ChevronDown className="h-5 w-5" />
          </Button>
          {menuOpen ? (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink hover:bg-surface-2"
                disabled={createDisabled}
                onClick={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <Upload className="h-4 w-4 shrink-0" />
                匯入劇本 JSON
              </button>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onImportScript(file);
            }}
          />
        </div>
      </div>

      {!pedelecReady && !bootstrapping ? (
        <p className="text-center text-sm text-accent-2">
          請先完成 Pedelec 連線後再開始（點右上角狀態徽章）。
        </p>
      ) : null}

      {bootstrapping ? (
        <p className="text-center text-sm text-muted">正在建立 Session 並連線 GM…</p>
      ) : null}

      <div className="w-full">
        <div
          role="tablist"
          aria-label="瀏覽存檔與角色"
          className={cn(
            "grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2/60 p-1",
            tab && "rounded-b-none border-b-0",
          )}
        >
          {(Object.keys(TAB_META) as HomeTab[]).map((key) => {
            const meta = TAB_META[key];
            const Icon = meta.icon;
            const selected = tab === key;
            const countHint =
              key === "sessions"
                ? sessions.length
                : null;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-expanded={selected}
                aria-controls={selected ? `home-panel-${key}` : undefined}
                id={`home-tab-${key}`}
                onClick={() => selectTab(key)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-accent",
                  selected
                    ? "bg-surface text-ink shadow-sm ring-1 ring-border"
                    : "text-muted hover:bg-surface/70 hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{meta.label}</span>
                {countHint != null ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                      selected
                        ? "bg-accent/20 text-accent"
                        : "bg-bg/50 text-muted",
                    )}
                  >
                    {countHint}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted transition-transform",
                    selected && "rotate-180 text-ink",
                  )}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>

        {!tab ? (
          <p className="mt-3 text-center text-xs text-muted">
          </p>
        ) : (
          <section
            id={`home-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`home-tab-${tab}`}
            className="rounded-b-xl border border-border border-t-border/60 bg-surface/80 p-4"
          >
            {tab === "sessions" ? (
              <>
                <div className="mb-3 flex items-center gap-2 text-ink">
                  <FolderOpen className="h-4 w-4" />
                  <h2 className="brand-title text-lg">
                    {TAB_META.sessions.panelTitle}
                  </h2>
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
                          "transition-colors hover:border-accent/40 hover:bg-accent/[0.06]",
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "min-w-0 flex-1 rounded-md text-left outline-none",
                            "transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                          )}
                          disabled={bootstrapping || !pedelecReady}
                          onClick={() => onOpen(s.id)}
                        >
                          <div className="truncate font-medium text-ink">
                            {s.title}
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
                            if (confirm(`確定刪除「${s.title}」？`))
                              onDelete(s.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <CharacterLibraryPanel
                sessions={sessions}
                pedelecReady={pedelecReady}
                bootstrapping={bootstrapping}
                onOpenCampaign={onOpen}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
