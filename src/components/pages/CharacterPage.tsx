import { useEffect, useMemo, useState } from "react";
import { Library, Sparkles, UserPlus } from "lucide-react";
import { CharacterStage } from "@/components/stages/CharacterStage";
import { ReturningCharacterConfirm } from "@/components/stages/ReturningCharacterConfirm";
import { Button } from "@/components/ui/button";
import { loadCampaignIndex } from "@/lib/campaignStorage";
import { loadLibraryCharacters } from "@/lib/storage";
import type { LibraryCharacter } from "@/types/characterLibrary";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

type Path = "gate" | "new" | "returning";

export function CharacterPage() {
  const script = useGameStore((s) => s.script);
  const campaignId = useGameStore((s) => s.campaignId);
  const systemId = script.system_id;

  const [path, setPath] = useState<Path>("gate");
  const [selected, setSelected] = useState<LibraryCharacter | null>(null);
  const [library, setLibrary] = useState(() => loadLibraryCharacters());
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (path === "gate") {
      setLibrary(loadLibraryCharacters());
      const map: Record<string, string> = {};
      for (const s of loadCampaignIndex().sessions) {
        map[s.id] = s.title;
      }
      setSessionTitles(map);
    }
  }, [path]);

  const compatible = useMemo(() => {
    if (!systemId) return [];
    return library.filter((c) => c.sheet.system_id === systemId);
  }, [library, systemId]);

  const isBusyElsewhere = (c: LibraryCharacter) => {
    const active = c.activeCampaignId;
    return Boolean(active && active !== campaignId);
  };

  if (path === "new") {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="brand-title text-xl text-ink">創建新角色</h2>
            <p className="mt-1 text-sm text-muted">
              {script.public_summary?.title
                ? `劇本「${script.public_summary.title}」`
                : "目前劇本"}
              {systemId ? ` · ${systemId}` : ""}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPath("gate")}>
            返回選擇
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CharacterStage />
        </div>
      </div>
    );
  }

  if (path === "returning" && selected) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
        <div className="mb-4 shrink-0">
          <h2 className="brand-title text-xl text-ink">帶入角色 · 歸隊確認</h2>
          <p className="mt-1 text-sm text-muted">
            沿用既有屬性與技能（CoC 幕間歸隊），確認後開始冒險。
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReturningCharacterConfirm
            entry={selected}
            onBack={() => {
              setSelected(null);
              setPath("gate");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
      <div className="mb-4 shrink-0">
        <h2 className="brand-title text-xl text-ink">選擇角色</h2>
        <p className="mt-1 text-sm text-muted">
          {script.public_summary?.title
            ? `劇本「${script.public_summary.title}」`
            : "目前劇本"}
          {systemId ? ` · ${systemId}` : ""}
          。可創建新角色，或帶入檔案庫中同系統的調查員。
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPath("new")}
            className={cn(
              "rounded-xl border border-border bg-surface p-5 text-left transition-colors",
              "hover:border-accent/50 hover:bg-accent/5",
            )}
          >
            <UserPlus className="h-6 w-6 text-accent" />
            <div className="brand-title mt-3 text-lg text-ink">創建新角色</div>
            <p className="mt-1 text-xs text-muted">
              依劇本創角藍圖擲骰／配點，從頭建立調查員。
            </p>
          </button>

          <div
            className={cn(
              "rounded-xl border border-border bg-surface p-5",
              !compatible.length && "opacity-70",
            )}
          >
            <Library className="h-6 w-6 text-accent" />
            <div className="brand-title mt-3 text-lg text-ink">帶入已存角色卡</div>
            <p className="mt-1 text-xs text-muted">
              使用檔案庫角色（含履歷與成長後數值）繼續冒險。
            </p>
            {!systemId ? (
              <p className="mt-3 text-xs text-accent-2">劇本尚未設定系統。</p>
            ) : !compatible.length ? (
              <p className="mt-3 text-xs text-muted">
                檔案庫沒有 {systemId} 角色。請先創建新角色，或於首頁匯入。
              </p>
            ) : null}
          </div>
        </div>

        {compatible.length ? (
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-ink">
              <Sparkles className="h-4 w-4 text-accent" />
              可帶入的 {systemId} 角色（{compatible.length}）
            </div>
            <ul className="space-y-2">
              {compatible.map((c) => {
                const busy = isBusyElsewhere(c);
                const busyTitle = c.activeCampaignId
                  ? sessionTitles[c.activeCampaignId]
                  : null;
                return (
                  <li key={c.sheet.id}>
                    <button
                      type="button"
                      disabled={busy}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-surface-2/50 p-3 text-left",
                        busy
                          ? "cursor-not-allowed opacity-60"
                          : "hover:border-accent/40",
                      )}
                      onClick={() => {
                        if (busy) return;
                        setSelected(c);
                        setPath("returning");
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">
                          {c.sheet.name || "（未命名）"}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {c.sheet.role_title || "—"} · 履歷 {c.career.length}{" "}
                          場
                          {busy
                            ? ` · 進行中：${busyTitle ?? "其他 Session"}（一角僅能一場）`
                            : c.career[0]
                              ? ` · 最近：《${c.career[0].scenarioTitle}》`
                              : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-accent">
                        {busy ? "占用中" : "選擇"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
