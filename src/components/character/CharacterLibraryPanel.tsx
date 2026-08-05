import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Play,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { changedStatDeltas } from "@/engine/adventureDossier";
import type { CampaignMeta } from "@/lib/campaignStorage";
import {
  clearCharacterActiveCampaign,
  exportLibraryCharacterJson,
  loadLibraryCharacters,
  removeCharacterFromLibrary,
} from "@/lib/storage";
import type { AdventureRecord, LibraryCharacter } from "@/types/characterLibrary";
import { cn } from "@/lib/utils";

function AdventureDetail({ record }: { record: AdventureRecord }) {
  const [open, setOpen] = useState(false);
  const deltas = useMemo(
    () => changedStatDeltas(record.statsBefore, record.statsAfter),
    [record],
  );

  return (
    <div className="rounded-lg border border-border bg-surface-2/40">
      <button
        type="button"
        className="flex w-full items-start gap-2 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">
            《{record.scenarioTitle}》
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {record.endingType}
            {record.endingTitle ? ` · ${record.endingTitle}` : ""} ·{" "}
            {new Date(record.playedAt).toLocaleString()}
          </div>
          {!open ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted">
              {record.synopsis}
            </p>
          ) : null}
        </div>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-2 text-xs">
          <p className="text-ink">{record.synopsis}</p>
          {record.growthLog.length ? (
            <div>
              <div className="text-muted">成長紀錄</div>
              <ul className="mt-1 list-disc pl-4 text-ink">
                {record.growthLog.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {record.achievements.length ? (
            <div>
              <div className="text-muted">成就</div>
              <p className="mt-1 text-ink">{record.achievements.join("、")}</p>
            </div>
          ) : null}
          {record.keyCluesFound.length ? (
            <div>
              <div className="text-muted">關鍵線索</div>
              <p className="mt-1 text-ink">{record.keyCluesFound.join("、")}</p>
            </div>
          ) : null}
          <div>
            <div className="text-muted">冒險前後數值變化</div>
            {deltas.length === 0 ? (
              <p className="mt-1 text-muted">本場數值無變化。</p>
            ) : (
              <table className="mt-2 w-full text-left">
                <thead>
                  <tr className="text-muted">
                    <th className="py-1 pr-2 font-normal">項目</th>
                    <th className="py-1 pr-2 font-normal">前</th>
                    <th className="py-1 font-normal">後</th>
                  </tr>
                </thead>
                <tbody>
                  {deltas.map((d) => (
                    <tr
                      key={`${d.group}-${d.key}`}
                      className="border-t border-border/50 text-ink"
                    >
                      <td className="py-1 pr-2">
                        {d.key}
                        {d.group === "skill" ? "%" : ""}
                      </td>
                      <td className="py-1 pr-2 text-muted">{d.before}</td>
                      <td className="py-1 font-medium text-accent-2">
                        {d.after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CharacterDetail({
  entry,
  sessions,
  pedelecReady,
  bootstrapping,
  onBack,
  onDeleted,
  onOpenCampaign,
  onClearedBinding,
}: {
  entry: LibraryCharacter;
  sessions: CampaignMeta[];
  pedelecReady: boolean;
  bootstrapping: boolean;
  onBack: () => void;
  onDeleted: () => void;
  onOpenCampaign: (id: string) => void;
  onClearedBinding: () => void;
}) {
  const sheet = entry.sheet;
  const topSkills = Object.entries(sheet.skills)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const activeId = entry.activeCampaignId ?? null;
  const activeSession = activeId
    ? sessions.find((s) => s.id === activeId) ?? null
    : null;
  const orphanActive = Boolean(activeId && !activeSession);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回列表
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => exportLibraryCharacterJson(entry)}
        >
          <Download className="h-3.5 w-3.5" />
          匯出
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          onClick={() => {
            if (confirm(`確定刪除「${sheet.name}」及其全部履歷？`)) {
              removeCharacterFromLibrary(sheet.id);
              onDeleted();
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          刪除
        </Button>
      </div>

      {activeId ? (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="text-xs text-muted">目前進行中的冒險</div>
          {activeSession ? (
            <>
              <div className="mt-1 font-medium text-ink">
                {activeSession.title}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {activeSession.phase} ·{" "}
                {new Date(activeSession.updatedAt).toLocaleString()}
              </div>
              <Button
                size="sm"
                className="mt-2"
                disabled={bootstrapping || !pedelecReady}
                onClick={() => onOpenCampaign(activeSession.id)}
              >
                <Play className="h-3.5 w-3.5" />
                進入此 Session
              </Button>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-accent-2">
                Session 資料已遺失，但角色履歷仍保留。可解除進行中標記以便帶入新劇本。
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => {
                  clearCharacterActiveCampaign(sheet.id);
                  onClearedBinding();
                }}
              >
                解除進行中標記
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="brand-title text-xl text-ink">
          {sheet.name || "（未命名）"}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {sheet.role_title || "—"} · {sheet.system_id} · 履歷{" "}
          {entry.career.length} 場
          {orphanActive ? " · （標記異常）" : ""}
        </p>
        <div className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
          {sheet.derived.san ? (
            <div>
              SAN {sheet.derived.san.current}/{sheet.derived.san.max}
            </div>
          ) : null}
          <div>
            HP {sheet.derived.hp.current}/{sheet.derived.hp.max}
          </div>
          {Object.entries(sheet.attributes).map(([k, v]) => (
            <div key={k}>
              {k} {v}
            </div>
          ))}
        </div>
        {topSkills.length ? (
          <div className="mt-3">
            <div className="text-xs text-muted">技能（目前）</div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
              {topSkills.map(([n, v]) => (
                <li key={n}>
                  {n} {v}%
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {sheet.personal_bio ? (
          <p className="mt-3 text-xs text-muted">{sheet.personal_bio}</p>
        ) : null}
      </div>

      <section>
        <h4 className="brand-title mb-2 text-sm text-ink">冒險履歷</h4>
        {entry.career.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            尚無已結算履歷。完成結局並存入檔案庫後，壓縮經歷會出現在此（即使 Session
            刪除也不會消失）。
          </p>
        ) : (
          <ul className="space-y-2">
            {entry.career.map((r) => (
              <li key={r.id}>
                <AdventureDetail record={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CharacterLibraryPanel({
  sessions,
  pedelecReady,
  bootstrapping,
  onOpenCampaign,
}: {
  sessions: CampaignMeta[];
  pedelecReady: boolean;
  bootstrapping: boolean;
  onOpenCampaign: (id: string) => void;
}) {
  const [list, setList] = useState(() => loadLibraryCharacters());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = () => setList(loadLibraryCharacters());

  const selected = selectedId
    ? list.find((c) => c.sheet.id === selectedId) ?? null
    : null;

  if (selected) {
    return (
      <CharacterDetail
        entry={selected}
        sessions={sessions}
        pedelecReady={pedelecReady}
        bootstrapping={bootstrapping}
        onBack={() => setSelectedId(null)}
        onDeleted={() => {
          setSelectedId(null);
          refresh();
        }}
        onOpenCampaign={onOpenCampaign}
        onClearedBinding={refresh}
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-ink">
        <Users className="h-4 w-4" />
        <h2 className="brand-title text-lg">角色檔案庫</h2>
      </div>
      <p className="mb-3 text-xs text-muted">
        跨劇本重用的調查員。開始冒險時自動綁定 Session；一角同時只能進行一場。
      </p>
      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          尚無角色卡。創建角色並開始冒險後會自動存入。
        </p>
      ) : (
        <ul className="max-h-[42vh] space-y-2 overflow-y-auto">
          {list.map((c) => {
            const active = c.activeCampaignId
              ? sessions.find((s) => s.id === c.activeCampaignId)
              : null;
            return (
              <li key={c.sheet.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-start justify-between gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-left",
                    "hover:border-accent/40",
                  )}
                  onClick={() => setSelectedId(c.sheet.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">
                      {c.sheet.name || "（未命名）"}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {c.sheet.system_id} · {c.sheet.role_title || "—"} · 履歷{" "}
                      {c.career.length} 場
                      {active
                        ? ` · 進行中：${active.title}`
                        : c.activeCampaignId
                          ? " · 進行中（Session 遺失）"
                          : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-accent">詳情</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
