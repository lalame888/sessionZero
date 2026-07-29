import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderCode } from "@kaoruisaac/pedelec";
import { Home, Settings } from "lucide-react";
import { DiceModal } from "@/components/game/DiceModal";
import { CharacterPage } from "@/components/pages/CharacterPage";
import { EndingPage } from "@/components/pages/EndingPage";
import { HomePage } from "@/components/pages/HomePage";
import { PlayPage } from "@/components/pages/PlayPage";
import { ScriptPage } from "@/components/pages/ScriptPage";
import { PedelecInstallationGuideline } from "@/components/pedelec/PedelecInstallationGuideline";
import { PedelecSettingsPanel } from "@/components/pedelec/PedelecSettings";
import { PedelecStatusBadge } from "@/components/pedelec/PedelecStatusBadge";
import { Button } from "@/components/ui/button";
import {
  deleteCampaign,
  loadAgentPrefs,
  loadCampaign,
  loadCampaignIndex,
  saveAgentPrefs,
  saveCampaign,
  type CampaignMeta,
} from "@/lib/campaignStorage";
import {
  createGameSession,
  disposeGameSession,
  getActiveSession,
  sendPlayerAction,
} from "@/lib/pedelec/createGameSession";
import {
  checkPedelecPrerequisites,
  listProviderOptions,
  loadPedelecSettings,
} from "@/lib/pedelec/preflight";
import { useGameStore } from "@/store/useGameStore";

type Screen = "home" | "campaign";

const PHASE_CHIP: Record<string, string> = {
  SESSION_0: "創建劇本",
  CHARACTER: "創角",
  PLAYING: "冒險進行",
  ENDING: "結算回放",
  PREFLIGHT: "預檢",
};

async function resolveProvider(
  override?: ProviderCode | null,
): Promise<ProviderCode> {
  if (override) return override;
  const [providers, settings] = await Promise.all([
    listProviderOptions(),
    loadPedelecSettings(),
  ]);
  const available = providers.filter((p) => p.available);
  if (
    settings.defaultProvider &&
    available.some((p) => p.code === settings.defaultProvider)
  ) {
    return settings.defaultProvider;
  }
  const first = available[0];
  if (!first) throw new Error("沒有可用的 Provider");
  return first.code;
}

function persistActiveCampaign() {
  const data = useGameStore.getState().toPersist();
  saveCampaign(data);
}

export default function App() {
  const theme = useGameStore((s) => s.theme);
  const phase = useGameStore((s) => s.phase);
  const preflight = useGameStore((s) => s.preflight);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const setPreflight = useGameStore((s) => s.setPreflight);
  const setShowInstallGuide = useGameStore((s) => s.setShowInstallGuide);
  const setShowSettings = useGameStore((s) => s.setShowSettings);
  const selectedProvider = useGameStore((s) => s.selectedProvider);
  const lastPlayerAction = useGameStore((s) => s.lastPlayerAction);
  const pendingDice = useGameStore((s) => s.pendingDice);
  const script = useGameStore((s) => s.script);
  const hydrateCampaign = useGameStore((s) => s.hydrateCampaign);
  const startNewCampaign = useGameStore((s) => s.startNewCampaign);

  const [screen, setScreen] = useState<Screen>("home");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [campaignList, setCampaignList] = useState<CampaignMeta[]>([]);
  const [ready, setReady] = useState(false);
  const connectAttemptRef = useRef(0);

  const refreshCampaignList = useCallback(() => {
    setCampaignList(loadCampaignIndex().sessions);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 啟動只載入偏好與清單，停留首頁
  useEffect(() => {
    const prefs = loadAgentPrefs();
    if (prefs.selectedProvider) {
      useGameStore
        .getState()
        .setProvider(prefs.selectedProvider as ProviderCode);
    }
    useGameStore.getState().setModel(prefs.selectedModel);
    refreshCampaignList();
    setReady(true);
  }, [refreshCampaignList]);

  // 僅在進入 campaign 時自動存檔
  useEffect(() => {
    if (screen !== "campaign") return;
    let timer: number | undefined;
    const unsub = useGameStore.subscribe(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        persistActiveCampaign();
        refreshCampaignList();
      }, 400);
    });
    return () => {
      window.clearTimeout(timer);
      unsub();
      persistActiveCampaign();
    };
  }, [screen, refreshCampaignList]);

  useEffect(() => {
    if (!ready) return;
    const unsub = useGameStore.subscribe((s, prev) => {
      if (
        s.selectedProvider !== prev.selectedProvider ||
        s.selectedModel !== prev.selectedModel
      ) {
        saveAgentPrefs({
          selectedProvider: s.selectedProvider,
          selectedModel: s.selectedModel,
        });
      }
    });
    return unsub;
  }, [ready]);

  const runPreflight = useCallback(async () => {
    setPreflight({ ready: false, reason: "CHECKING" });
    const result = await checkPedelecPrerequisites();
    setPreflight(result);
    if (!result.ready) setShowInstallGuide(true);
    return result;
  }, [setPreflight, setShowInstallGuide]);

  useEffect(() => {
    if (!ready) return;
    void runPreflight();
  }, [ready, runPreflight]);

  const ensureSession = useCallback(
    async (providerOverride?: ProviderCode | null, modelOverride?: string) => {
      const latest = useGameStore.getState();
      const provider = await resolveProvider(
        providerOverride !== undefined
          ? providerOverride
          : latest.selectedProvider,
      );
      const model =
        modelOverride !== undefined
          ? modelOverride || undefined
          : latest.selectedModel || undefined;

      setBootstrapping(true);
      try {
        await createGameSession({ provider, model });
        return true;
      } finally {
        setBootstrapping(false);
      }
    },
    [],
  );

  const enterCampaign = async (opts: {
    mode: "new" | "open";
    id?: string;
  }) => {
    const attempt = ++connectAttemptRef.current;
    setBootstrapping(true);
    try {
      const pf = await runPreflight();
      if (!pf.ready) return;
      if (attempt !== connectAttemptRef.current) return;

      if (opts.mode === "new") {
        if (screen === "campaign") persistActiveCampaign();
        const fresh = startNewCampaign();
        saveCampaign(fresh);
        await ensureSession();
        if (attempt !== connectAttemptRef.current) return;
        useGameStore
          .getState()
          .appendSystem("新劇本 Session 已開始。描述你想玩的故事吧。");
        persistActiveCampaign();
      } else {
        if (!opts.id) return;
        if (screen === "campaign") persistActiveCampaign();
        const data = loadCampaign(opts.id);
        if (!data) return;
        hydrateCampaign(data);
        await ensureSession();
        if (attempt !== connectAttemptRef.current) return;
        useGameStore
          .getState()
          .appendSystem(`已載入「${data.title}」，可繼續進度。`);
        persistActiveCampaign();
      }

      refreshCampaignList();
      setScreen("campaign");
    } catch (err) {
      useGameStore
        .getState()
        .appendSystem(
          `連線失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
        );
      setShowSettings(true);
    } finally {
      setBootstrapping(false);
    }
  };

  const goHome = () => {
    if (screen === "campaign") persistActiveCampaign();
    connectAttemptRef.current += 1;
    void disposeGameSession();
    useGameStore.getState().setSessionStatus("disconnected");
    refreshCampaignList();
    setScreen("home");
  };

  const removeCampaign = (id: string) => {
    deleteCampaign(id);
    refreshCampaignList();
  };

  useEffect(() => {
    return () => {
      connectAttemptRef.current += 1;
      void disposeGameSession();
    };
  }, []);

  const composerDisabled =
    !preflight.ready ||
    bootstrapping ||
    sessionStatus !== "idle" ||
    Boolean(pendingDice);

  const onRegenerate = async () => {
    if (!lastPlayerAction) return;
    const session = getActiveSession();
    if (!session || session.getStatus() !== "idle") return;
    await sendPlayerAction(lastPlayerAction);
  };

  return (
    <div className="mx-auto flex h-dvh max-h-dvh max-w-7xl flex-col overflow-hidden px-3 py-4 md:px-6">
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="brand-title text-xl text-ink md:text-2xl">SessionZero</h1>
          {screen === "campaign" ? (
            <p className="truncate text-xs text-muted">
              {script.public_summary?.title ?? "未命名劇本"}
              {script.system_id ? ` · ${script.system_id}` : ""}
              {" · "}
              {PHASE_CHIP[phase] ?? phase}
            </p>
          ) : (
            <p className="text-xs text-muted">選擇或創建劇本 Session</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {screen === "campaign" ? (
            <Button size="sm" variant="secondary" onClick={goHome}>
              <Home className="h-4 w-4" />
              首頁
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSettings(true)}
            title="Pedelec 設定"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <PedelecStatusBadge onRecheck={() => void runPreflight()} />
        </div>
      </header>

      {screen === "home" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HomePage
            sessions={campaignList}
            pedelecReady={preflight.ready}
            bootstrapping={bootstrapping}
            onCreate={() => void enterCampaign({ mode: "new" })}
            onOpen={(id) => void enterCampaign({ mode: "open", id })}
            onDelete={removeCampaign}
          />
        </div>
      ) : phase === "CHARACTER" ? (
        <CharacterPage />
      ) : phase === "ENDING" ? (
        <EndingPage onHome={goHome} />
      ) : phase === "PLAYING" ? (
        <PlayPage
          composerDisabled={composerDisabled}
          onRegenerate={() => void onRegenerate()}
        />
      ) : (
        <ScriptPage
          composerDisabled={composerDisabled}
          onRegenerate={() => void onRegenerate()}
        />
      )}

      <DiceModal />
      <PedelecInstallationGuideline
        onRecheck={async () => {
          const result = await runPreflight();
          if (result.ready) {
            useGameStore.getState().setShowInstallGuide(false);
            if (screen === "campaign") {
              try {
                await ensureSession(selectedProvider);
              } catch {
                setShowSettings(true);
              }
            }
          }
        }}
      />
      <PedelecSettingsPanel
        onApply={async (provider, model) => {
          if (screen === "home") {
            await resolveProvider(provider ?? null);
            // 僅儲存偏好；真正連線在進入劇本時
            if (provider) useGameStore.getState().setProvider(provider);
            useGameStore.getState().setModel(model ?? "");
            return;
          }
          await ensureSession(provider ?? null, model ?? "");
          useGameStore
            .getState()
            .appendSystem("已依設定重建 Pedelec Session。");
        }}
      />
    </div>
  );
}
