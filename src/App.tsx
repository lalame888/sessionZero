import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderCode } from "@kaoruisaac/pedelec";
import { Home, Settings } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { CharacterPage } from "@/components/pages/CharacterPage";
import { EndingPage } from "@/components/pages/EndingPage";
import { HomePage } from "@/components/pages/HomePage";
import { PlayPage } from "@/components/pages/PlayPage";
import { ScriptPage } from "@/components/pages/ScriptPage";
import { PedelecInstallationGuideline } from "@/components/pedelec/PedelecInstallationGuideline";
import { PedelecSettingsPanel } from "@/components/pedelec/PedelecSettings";
import { PedelecStatusBadge } from "@/components/pedelec/PedelecStatusBadge";
import { DevStorageInspector } from "@/components/dev/DevStorageInspector";
import { Button } from "@/components/ui/button";
import {
  deleteCampaign,
  findBlankCampaignId,
  loadAgentPrefs,
  loadCampaign,
  loadCampaignIndex,
  persistAgentPrefsFromStore,
  saveCampaign,
  type CampaignMeta,
  type CampaignPersist,
} from "@/lib/campaignStorage";
import {
  parseScriptPackImport,
  readJsonFile,
} from "@/lib/campaignPack";
import { useAiPlayerStore } from "@/lib/aiPlayer";
import {
  createGameSession,
  disposeGameSession,
  getActiveSession,
  sendOpeningNarration,
  sendPlayerAction,
  sessionNeedsRebuild,
} from "@/lib/pedelec/createGameSession";
import { syncLibraryCharacterSheet } from "@/lib/storage";
import {
  checkPedelecPrerequisites,
  listProviderOptions,
  loadPedelecSettings,
  requestPedelecOriginApproval,
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
  const state = useGameStore.getState();
  const data = state.toPersist();
  saveCampaign(data);
  // 冒險進行中同步角色數值到檔案庫（結局階段不同步，避免重新綁定）
  if (
    data.phase === "PLAYING" &&
    data.character &&
    data.boundCharacterId
  ) {
    syncLibraryCharacterSheet(data.character, data.id);
  }
}

export default function App() {
  const theme = useGameStore((s) => s.theme);
  const phase = useGameStore((s) => s.phase);
  const preflight = useGameStore((s) => s.preflight);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const sessionError = useGameStore((s) => s.sessionError);
  const lastPlayerAction = useGameStore((s) => s.lastPlayerAction);
  const setPreflight = useGameStore((s) => s.setPreflight);
  const setShowInstallGuide = useGameStore((s) => s.setShowInstallGuide);
  const setShowSettings = useGameStore((s) => s.setShowSettings);
  const selectedProvider = useGameStore((s) => s.selectedProvider);
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
    useGameStore
      .getState()
      .setProvider((prefs.selectedProvider as ProviderCode | null) ?? null);
    useGameStore.getState().setModel(prefs.selectedModel ?? "");
    if (typeof prefs.suggestPlayerActions === "boolean") {
      useGameStore
        .getState()
        .setSuggestPlayerActions(prefs.suggestPlayerActions);
    }
    if (prefs.scenarioScale) {
      useGameStore.getState().setScenarioScale(prefs.scenarioScale);
    }
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
        s.selectedModel !== prev.selectedModel ||
        s.suggestPlayerActions !== prev.suggestPlayerActions ||
        s.script.scenario_scale !== prev.script.scenario_scale
      ) {
        persistAgentPrefsFromStore({
          selectedProvider: s.selectedProvider,
          selectedModel: s.selectedModel,
          suggestPlayerActions: s.suggestPlayerActions,
          scenarioScale: s.script.scenario_scale,
        });
      }
    });
    return unsub;
  }, [ready]);

  const promptOriginApproval = useCallback(async () => {
    setPreflight({
      ready: false,
      reason: "NEEDS_APPROVAL",
      message:
        "正在開啟 Pedelec 核准彈窗…請在擴充元件視窗中按「允許此網站」。",
    });
    setShowInstallGuide(true);

    const approval = await requestPedelecOriginApproval();
    if (approval.approved) {
      const next = await checkPedelecPrerequisites();
      setPreflight(next);
      if (next.ready) setShowInstallGuide(false);
      return next;
    }

    setPreflight({
      ready: false,
      reason: "NEEDS_APPROVAL",
      message:
        approval.message ??
        "此網站尚未獲得 Pedelec 來源核准。請在擴充元件彈窗中按「允許此網站」。",
    });
    setShowInstallGuide(true);
    return useGameStore.getState().preflight;
  }, [setPreflight, setShowInstallGuide]);

  const runPreflight = useCallback(async () => {
    setPreflight({ ready: false, reason: "CHECKING" });
    let result = await checkPedelecPrerequisites();

    // getApprovalStatus 不會開彈窗；偵測到需核准時主動觸發 createSession 以開啟擴充元件
    if (result.reason === "NEEDS_APPROVAL") {
      setPreflight(result);
      setShowInstallGuide(true);
      result = await promptOriginApproval();
      return result;
    }

    setPreflight(result);
    if (!result.ready) setShowInstallGuide(true);
    return result;
  }, [promptOriginApproval, setPreflight, setShowInstallGuide]);

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
    mode: "new" | "open" | "import";
    id?: string;
    importData?: CampaignPersist;
  }) => {
    const attempt = ++connectAttemptRef.current;
    setBootstrapping(true);
    try {
      const pf = await runPreflight();
      if (!pf.ready) return;
      if (attempt !== connectAttemptRef.current) return;

      if (opts.mode === "new") {
        if (screen === "campaign") persistActiveCampaign();

        // 已有完全空白、尚未討論的 Session → 直接進入，不另開新檔
        const blankId = findBlankCampaignId();
        if (blankId) {
          const data = loadCampaign(blankId);
          if (!data) return;
          hydrateCampaign(data);
          await ensureSession();
          if (attempt !== connectAttemptRef.current) return;
          const hasWelcome = useGameStore
            .getState()
            .messages.some((m) => m.role === "system");
          if (!hasWelcome) {
            useGameStore
              .getState()
              .appendSystem("新劇本 Session 已開始。描述你想玩的故事吧。");
          }
          persistActiveCampaign();
        } else {
          const fresh = startNewCampaign();
          saveCampaign(fresh);
          await ensureSession();
          if (attempt !== connectAttemptRef.current) return;
          useGameStore
            .getState()
            .appendSystem("新劇本 Session 已開始。描述你想玩的故事吧。");
          persistActiveCampaign();
        }
      } else if (opts.mode === "import") {
        if (!opts.importData) return;
        if (screen === "campaign") persistActiveCampaign();
        saveCampaign(opts.importData);
        hydrateCampaign(opts.importData);
        await ensureSession();
        if (attempt !== connectAttemptRef.current) return;
        useGameStore
          .getState()
          .appendSystem(
            `已匯入劇本「${opts.importData.title}」。可檢視藍圖後前往創角。`,
          );
        persistActiveCampaign();
      } else {
        if (!opts.id) return;
        if (screen === "campaign") persistActiveCampaign();
        const data = loadCampaign(opts.id);
        if (!data) return;
        hydrateCampaign(data);
        await ensureSession();
        if (attempt !== connectAttemptRef.current) return;
        // 不寫入「已載入…可繼續進度」避免每次進檔都堆系統訊息
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

  const importScriptFile = async (file: File) => {
    try {
      const raw = await readJsonFile(file);
      const parsed = parseScriptPackImport(raw);
      if (!parsed.ok) {
        window.alert(parsed.message);
        return;
      }
      await enterCampaign({ mode: "import", importData: parsed.campaign });
    } catch (err) {
      window.alert(
        `匯入失敗：${err instanceof Error ? err.message : "無法解析 JSON"}`,
      );
    }
  };

  const goHome = () => {
    if (screen === "campaign") persistActiveCampaign();
    connectAttemptRef.current += 1;
    useAiPlayerStore.getState().resetRuntime();
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
      useAiPlayerStore.getState().resetRuntime();
      void disposeGameSession();
    };
  }, []);

  const composerDisabled =
    !preflight.ready ||
    bootstrapping ||
    sessionStatus !== "idle" ||
    Boolean(pendingDice);

  const onRegenerate = async () => {
    const store = useGameStore.getState();
    const session = getActiveSession();
    if (!session || session.getStatus() !== "idle") return;

    const action = store.retryAction;
    if (action?.kind === "player") {
      await sendPlayerAction(action.text, {
        extraLayers: action.extraLayers,
      });
      return;
    }
    if (!store.lastPlayerAction) return;
    await sendPlayerAction(store.lastPlayerAction);
  };

  const onRetrySessionAction = useCallback(async () => {
    const store = useGameStore.getState();
    const action = store.retryAction;
    if (!action) return;

    setBootstrapping(true);
    store.appendSystem(
      action.kind === "opening"
        ? "正在重建連線並重試開場敘事…"
        : "正在重建連線並重試上一步…",
    );

    try {
      const pf = await runPreflight();
      if (!pf.ready) {
        store.appendSystem("Pedelec 尚未就緒，請先完成連線後再重試。");
        // 保持／寫入錯誤狀態，讓開場重試按鈕繼續顯示
        if (!store.sessionError) {
          store.setSessionError({
            code: "PEDELEC_NOT_READY",
            message: "Pedelec 尚未就緒，請先完成連線後再重試。",
          });
        }
        return;
      }

      if (sessionNeedsRebuild()) {
        await ensureSession();
      } else {
        const session = getActiveSession();
        if (!session || session.getStatus() !== "idle") {
          await ensureSession();
        }
      }

      store.setSessionError(null);

      if (action.kind === "opening") {
        await sendOpeningNarration();
      } else {
        await sendPlayerAction(action.text, {
          skipUserMessage: true,
          extraLayers: action.extraLayers,
        });
      }
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "RETRY_FAILED";
      const message = err instanceof Error ? err.message : "重試失敗";
      const latest = useGameStore.getState();
      if (!latest.sessionError) {
        latest.setSessionError({ code, message });
        latest.appendSystem(`重試失敗：${code} — ${message}`);
      }
    } finally {
      setBootstrapping(false);
    }
  }, [ensureSession, runPreflight]);

  // SESSION/PROVIDER 錯誤後自動重建並重送一次，避免玩家連貼同一指令
  const autoResumeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (bootstrapping) return;
    const store = useGameStore.getState();
    const err = store.sessionError;
    const action = store.retryAction;
    if (!err || !action) return;
    if (!/SESSION_ERROR|PROVIDER_/.test(err.code)) return;
    const key = `${action.kind}|${action.kind === "player" ? action.text : "opening"}|${err.code}`;
    if (autoResumeKeyRef.current === key) return;
    autoResumeKeyRef.current = key;
    store.appendSystem(
      "偵測到連線／Session 錯誤，正在自動重建並重試上一步（僅一次）…",
    );
    void onRetrySessionAction();
  }, [sessionError, bootstrapping, onRetrySessionAction]);

  useEffect(() => {
    // 新玩家行動時允許下一次錯誤再自動重試
    autoResumeKeyRef.current = null;
  }, [lastPlayerAction]);

  return (
    <div className="mx-auto flex h-dvh max-h-dvh max-w-7xl flex-col overflow-hidden px-3 py-4 md:px-6">
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <BrandMark size="sm" />
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
          <DevStorageInspector />
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
            onImportScript={(file) => void importScriptFile(file)}
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
          onRetry={() => void onRetrySessionAction()}
        />
      ) : (
        <ScriptPage
          composerDisabled={composerDisabled}
          onRegenerate={() => void onRegenerate()}
          onRetry={() => void onRetrySessionAction()}
        />
      )}

      <PedelecInstallationGuideline
        onRequestApproval={promptOriginApproval}
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
            const store = useGameStore.getState();
            store.setProvider(provider ?? null);
            store.setModel(model ?? "");
            persistAgentPrefsFromStore({
              selectedProvider: provider ?? null,
              selectedModel: model ?? "",
              suggestPlayerActions: store.suggestPlayerActions,
              scenarioScale: store.script.scenario_scale,
            });
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
