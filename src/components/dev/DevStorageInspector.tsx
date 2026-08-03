import { useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Braces, ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  CAMPAIGN_FIELD_GROUPS,
  formatFieldValue,
  formatPhase,
  NESTED_FIELD_HINTS,
  type FieldGuideEntry,
} from "@/components/dev/campaignFieldGuide";
import {
  loadAgentPrefs,
  loadCampaign,
  loadCampaignIndex,
  type CampaignMeta,
  type CampaignPersist,
} from "@/lib/campaignStorage";
import {
  loadCharacterLibrary,
  loadGameSnapshot,
  loadPedelecSessionId,
} from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/store/useGameStore";

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === "function") return undefined;
        if (typeof v === "bigint") return v.toString();
        if (v instanceof Set) return [...v];
        if (v instanceof Map) return Object.fromEntries(v);
        return v;
      }),
    );
  } catch (err) {
    return {
      error: "serialize_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function collectFrontendDump() {
  const index = loadCampaignIndex();
  const campaigns = Object.fromEntries(
    index.sessions.map((meta) => [meta.id, loadCampaign(meta.id)]),
  );

  const localStorageSessionZero: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("sessionzero.")) continue;
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try {
      localStorageSessionZero[key] = JSON.parse(raw);
    } catch {
      localStorageSessionZero[key] = raw;
    }
  }

  return safeJson({
    capturedAt: new Date().toISOString(),
    env: {
      DEV: import.meta.env.DEV,
      MODE: import.meta.env.MODE,
    },
    liveZustandStore: useGameStore.getState(),
    campaignIndex: index,
    campaigns,
    agentPrefs: loadAgentPrefs(),
    characterLibrary: loadCharacterLibrary(),
    pedelecSessionId: loadPedelecSessionId(),
    gameSnapshot: loadGameSnapshot(),
    localStorageSessionZero,
  });
}

type SectionKey =
  | "all"
  | "liveZustandStore"
  | "campaignIndex"
  | "campaigns"
  | "agentPrefs"
  | "characterLibrary"
  | "pedelecSessionId"
  | "gameSnapshot"
  | "localStorageSessionZero";

const SECTIONS: { id: SectionKey; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "liveZustandStore", label: "Zustand 即時" },
  { id: "campaignIndex", label: "Campaign 索引" },
  { id: "campaigns", label: "各 Campaign" },
  { id: "agentPrefs", label: "Agent 偏好" },
  { id: "characterLibrary", label: "角色庫" },
  { id: "pedelecSessionId", label: "Pedelec SessionId" },
  { id: "gameSnapshot", label: "舊版 game-save" },
  { id: "localStorageSessionZero", label: "localStorage 原始" },
];

const TAB_TRIGGER =
  "rounded px-3 py-1.5 text-sm text-muted data-[state=active]:bg-surface-2 data-[state=active]:text-ink";

function useCopyJson(payload: unknown) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return { text, copied, copy };
}

function JsonToolbar({
  onRefresh,
  onCopy,
  copied,
  hint,
}: {
  onRefresh: () => void;
  onCopy: () => void;
  copied: boolean;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={onRefresh}>
        <RefreshCw className="h-3.5 w-3.5" />
        重新抓取
      </Button>
      <Button size="sm" variant="secondary" onClick={onCopy}>
        <Copy className="h-3.5 w-3.5" />
        {copied ? "已複製" : "複製 JSON"}
      </Button>
      {hint ? (
        <span className="text-[10px] text-muted">{hint}</span>
      ) : null}
    </div>
  );
}

function RawJsonTab({
  dump,
  onRefresh,
}: {
  dump: unknown;
  onRefresh: () => void;
}) {
  const [section, setSection] = useState<SectionKey>("all");
  const view = useMemo(() => {
    if (!dump || typeof dump !== "object") return dump;
    if (section === "all") return dump;
    return (dump as Record<string, unknown>)[section];
  }, [dump, section]);
  const { text, copied, copy } = useCopyJson(view);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={section === s.id ? "default" : "secondary"}
            className="h-7 px-2 text-[11px]"
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <JsonToolbar
        onRefresh={onRefresh}
        onCopy={() => void copy()}
        copied={copied}
        hint="含 Zustand 即時狀態與 localStorage（sessionzero.*）"
      />
      <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-bg/60 p-3 text-[11px] leading-relaxed text-ink">
        {text}
      </pre>
    </div>
  );
}

function SessionBlockSummary({ campaign }: { campaign: CampaignPersist }) {
  const charName = campaign.character?.name?.trim();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
      <dt className="text-muted">階段</dt>
      <dd className="text-ink">{formatPhase(campaign.phase)}</dd>
      <dt className="text-muted">系統</dt>
      <dd className="text-ink">{campaign.script.system_id ?? "—"}</dd>
      <dt className="text-muted">規模</dt>
      <dd className="text-ink">{campaign.script.scenario_scale ?? "—"}</dd>
      <dt className="text-muted">回合</dt>
      <dd className="text-ink">{campaign.turn}</dd>
      <dt className="text-muted">角色</dt>
      <dd className="text-ink">{charName || "（尚未創角）"}</dd>
      <dt className="text-muted">訊息</dt>
      <dd className="text-ink">{campaign.messages.length} 則</dd>
      <dt className="text-muted">線索 / NPC</dt>
      <dd className="text-ink">
        {campaign.clues.length} / {campaign.npcs.length}
      </dd>
      <dt className="text-muted">更新</dt>
      <dd className="text-ink">
        {new Date(campaign.updatedAt).toLocaleString()}
      </dd>
    </dl>
  );
}

function SessionFieldGroup({
  title,
  description,
  data,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  data: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { text, copied, copy } = useCopyJson(data);

  return (
    <div className="rounded-md border border-border/80 bg-bg/40">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2/50"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-ink">{title}</span>
          <span className="block text-[10px] text-muted">{description}</span>
        </span>
        <span className="shrink-0 text-[10px] text-muted">
          {formatFieldValue(data)}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border/60 px-3 py-2">
          <div className="mb-1.5 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => void copy()}
            >
              <Copy className="h-3 w-3" />
              {copied ? "已複製" : "複製"}
            </Button>
          </div>
          <pre className="max-h-56 overflow-auto rounded border border-border/50 bg-bg/70 p-2 text-[10px] leading-relaxed text-ink">
            {text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function SessionCard({
  meta,
  campaign,
  isActive,
  isLive,
}: {
  meta: CampaignMeta;
  campaign: CampaignPersist | null;
  isActive: boolean;
  isLive: boolean;
}) {
  const [expanded, setExpanded] = useState(isActive || isLive);
  const { copied, copy } = useCopyJson(campaign);

  return (
    <article
      className={cn(
        "rounded-lg border bg-surface/60",
        isActive || isLive
          ? "border-accent/50 ring-1 ring-accent/20"
          : "border-border",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-medium text-ink">
              {meta.title || "未命名 Session"}
            </h3>
            {isLive ? (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                目前載入
              </span>
            ) : null}
            {isActive && !isLive ? (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                索引 active
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-muted">{meta.id}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[10px]"
            disabled={!campaign}
            onClick={() => void copy()}
          >
            <Copy className="h-3 w-3" />
            {copied ? "已複製" : "複製"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-[10px]"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收合" : "展開"}
          </Button>
        </div>
      </header>

      {campaign ? (
        <div className="space-y-3 px-3 py-3">
          <SessionBlockSummary campaign={campaign} />
          {expanded ? (
            <div className="space-y-1.5">
              <SessionFieldGroup
                title="劇本 script"
                description="公開摘要、隱藏劇本、系統與規模"
                data={campaign.script}
              />
              <SessionFieldGroup
                title="房規 houseRules"
                description="預設房規與自訂文字"
                data={campaign.houseRules}
              />
              <SessionFieldGroup
                title="創角藍圖 characterSchema"
                description="屬性定義、模式設定、建議技能"
                data={campaign.characterSchema}
              />
              <SessionFieldGroup
                title="角色卡 character"
                description="屬性、衍生值、技能、背包、背景"
                data={campaign.character}
              />
              <SessionFieldGroup
                title="冒險狀態"
                description="線索、筆記、NPC、瘋狂、結局"
                data={{
                  clues: campaign.clues,
                  playerNotes: campaign.playerNotes ?? [],
                  npcs: campaign.npcs,
                  madness: campaign.madness,
                  ending: campaign.ending,
                  location: campaign.location,
                  timelineIndex: campaign.timelineIndex,
                }}
              />
              <SessionFieldGroup
                title="歷史 history / 章節"
                description="回合紀錄與章節摘要"
                data={{
                  history: campaign.history,
                  chapterSummaries: campaign.chapterSummaries,
                  turn: campaign.turn,
                }}
              />
              <SessionFieldGroup
                title="訊息 messages / 草稿"
                description="對話串與輸入暫存"
                data={{
                  messages: campaign.messages,
                  lastPlayerAction: campaign.lastPlayerAction,
                  composerDraft: campaign.composerDraft,
                  suggestPlayerActions: campaign.suggestPlayerActions,
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-3 py-3 text-xs text-muted">
          索引有此 Session，但 localStorage 讀不到完整存檔。
        </p>
      )}
    </article>
  );
}

function SessionsTab({
  refreshKey,
  onRefresh,
}: {
  refreshKey: number;
  onRefresh: () => void;
}) {
  const liveId = useGameStore((s) => s.campaignId);
  const index = useMemo(() => loadCampaignIndex(), [refreshKey]);
  const sessions = useMemo(() => {
    const idx = loadCampaignIndex();
    return idx.sessions.map((meta) => ({
      meta,
      campaign: loadCampaign(meta.id),
    }));
  }, [refreshKey]);

  const livePersist = useMemo(
    () => useGameStore.getState().toPersist(),
    [refreshKey],
  );

  const liveInIndex = sessions.some((s) => s.meta.id === liveId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          重新抓取
        </Button>
        <span className="text-[10px] text-muted">
          索引 {sessions.length} 個 Session
          {index.activeId ? ` · active=${index.activeId.slice(0, 8)}…` : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-0.5">
        {!liveInIndex ? (
          <SessionCard
            meta={{
              id: livePersist.id,
              title: livePersist.title || "（記憶體中的目前 Session）",
              systemId: livePersist.script.system_id,
              phase: livePersist.phase,
              scenarioScale: livePersist.script.scenario_scale,
              createdAt: livePersist.createdAt,
              updatedAt: livePersist.updatedAt,
            }}
            campaign={livePersist}
            isActive={false}
            isLive
          />
        ) : null}

        {sessions.length === 0 ? (
          <p className="text-xs text-muted">尚無已儲存的 Session。</p>
        ) : (
          sessions.map(({ meta, campaign }) => (
            <SessionCard
              key={meta.id}
              meta={meta}
              campaign={
                meta.id === liveId
                  ? livePersist
                  : campaign
              }
              isActive={meta.id === index.activeId}
              isLive={meta.id === liveId}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  campaign,
}: {
  field: FieldGuideEntry;
  campaign: CampaignPersist;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const raw = field.getValue?.(campaign);
  const isComplex =
    raw != null &&
    typeof raw === "object" &&
    !(raw instanceof Date);

  return (
    <div className="rounded-md border border-border/70 bg-bg/35 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">{field.label}</div>
          <code className="mt-0.5 block font-mono text-[10px] text-muted">
            {field.path}
          </code>
        </div>
        {!isComplex ? (
          <div className="max-w-[55%] text-right text-[11px] text-ink">
            {formatFieldValue(raw)}
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? "隱藏值" : "查看值"}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        {field.meaning}
      </p>
      {isComplex && showRaw ? (
        <pre className="mt-2 max-h-48 overflow-auto rounded border border-border/50 bg-bg/70 p-2 text-[10px] leading-relaxed text-ink">
          {JSON.stringify(raw, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function NestedHintsPanel() {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(NESTED_FIELD_HINTS);

  return (
    <div className="rounded-lg border border-border/80 bg-surface/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2/40"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
        )}
        <span>
          <span className="block text-xs font-medium text-ink">
            巢狀子欄位辭典
          </span>
          <span className="block text-[10px] text-muted">
            常見巢狀路徑的中文名稱與意義（不綁定目前數值）
          </span>
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-3">
          {entries.map(([path, hint]) => (
            <div key={path} className="text-[11px]">
              <div className="font-medium text-ink">{hint.label}</div>
              <code className="font-mono text-[10px] text-muted">{path}</code>
              <p className="mt-0.5 text-muted">{hint.meaning}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldGuideTab({
  refreshKey,
  onRefresh,
}: {
  refreshKey: number;
  onRefresh: () => void;
}) {
  const campaign = useMemo(
    () => useGameStore.getState().toPersist(),
    [refreshKey],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          重新抓取
        </Button>
        <div className="min-w-0 text-[11px] text-muted">
          目前 Session：
          <span className="ml-1 text-ink">
            {campaign.title || "未命名"}
          </span>
          <span className="ml-2 font-mono text-[10px]">
            {campaign.id.slice(0, 8)}…
          </span>
          <span className="ml-2">{formatPhase(campaign.phase)}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-0.5">
        <p className="text-[11px] leading-relaxed text-muted">
          左側／上方是人類可讀名稱與意義；程式路徑以等寬字顯示。複雜物件可展開查看目前值。
        </p>

        {CAMPAIGN_FIELD_GROUPS.map((group) => (
          <section key={group.id} className="space-y-2">
            <div>
              <h3 className="text-sm font-medium text-ink">{group.title}</h3>
              <p className="text-[10px] text-muted">{group.description}</p>
            </div>
            <div className="space-y-1.5">
              {group.fields.map((field) => (
                <FieldRow
                  key={field.path}
                  field={field}
                  campaign={campaign}
                />
              ))}
            </div>
          </section>
        ))}

        <NestedHintsPanel />
      </div>
    </div>
  );
}

/** 僅 DEV：檢視前端 localStorage／Zustand 儲存內容 */
export function DevStorageInspector() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [mainTab, setMainTab] = useState("raw");

  const dump = useMemo(() => collectFrontendDump(), [tick, open]);
  const refresh = () => setTick((n) => n + 1);

  if (!import.meta.env.DEV) return null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        title="DEV：檢視前端儲存資料"
        onClick={() => {
          refresh();
          setOpen(true);
        }}
      >
        <Braces className="h-4 w-4" />
        Dev 資料
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="DEV · 前端儲存檢視"
        className="flex max-h-[85vh] w-[min(96vw,960px)] flex-col"
        bodyClassName="flex min-h-0 flex-col overflow-hidden"
      >
        <Tabs.Root
          value={mainTab}
          onValueChange={setMainTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List className="mb-3 flex shrink-0 gap-1 border-b border-border/60 pb-2">
            <Tabs.Trigger value="raw" className={TAB_TRIGGER}>
              原始 JSON
            </Tabs.Trigger>
            <Tabs.Trigger value="sessions" className={TAB_TRIGGER}>
              各 Session
            </Tabs.Trigger>
            <Tabs.Trigger value="guide" className={TAB_TRIGGER}>
              欄位說明
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content
            value="raw"
            className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
          >
            <RawJsonTab dump={dump} onRefresh={refresh} />
          </Tabs.Content>
          <Tabs.Content
            value="sessions"
            className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
          >
            <SessionsTab refreshKey={tick} onRefresh={refresh} />
          </Tabs.Content>
          <Tabs.Content
            value="guide"
            className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
          >
            <FieldGuideTab refreshKey={tick} onRefresh={refresh} />
          </Tabs.Content>
        </Tabs.Root>
      </Modal>
    </>
  );
}
