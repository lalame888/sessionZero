import { useMemo, useState } from "react";
import { Braces, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  loadAgentPrefs,
  loadCampaign,
  loadCampaignIndex,
} from "@/lib/campaignStorage";
import {
  loadCharacterLibrary,
  loadGameSnapshot,
  loadPedelecSessionId,
} from "@/lib/storage";
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

/** 僅 DEV：檢視前端 localStorage／Zustand 儲存內容 */
export function DevStorageInspector() {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [section, setSection] = useState<SectionKey>("all");
  const [copied, setCopied] = useState(false);

  const dump = useMemo(() => collectFrontendDump(), [tick, open]);

  const view = useMemo(() => {
    if (!dump || typeof dump !== "object") return dump;
    if (section === "all") return dump;
    return (dump as Record<string, unknown>)[section];
  }, [dump, section]);

  const text = useMemo(() => JSON.stringify(view, null, 2), [view]);

  if (!import.meta.env.DEV) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        title="DEV：檢視前端儲存資料"
        onClick={() => {
          setTick((n) => n + 1);
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
        className="flex max-h-[85vh] w-[min(96vw,900px)] flex-col"
      >
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setTick((n) => n + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新抓取
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copy()}>
            <Copy className="h-3.5 w-3.5" />
            {copied ? "已複製" : "複製 JSON"}
          </Button>
          <span className="text-[10px] text-muted">
            含 Zustand 即時狀態與 localStorage（sessionzero.*）
          </span>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-bg/60 p-3 text-[11px] leading-relaxed text-ink">
          {text}
        </pre>
      </Modal>
    </>
  );
}
