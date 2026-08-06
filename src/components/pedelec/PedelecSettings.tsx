import { useEffect, useMemo, useState } from "react";
import type { ProviderCode, ProviderInfo } from "@kaoruisaac/pedelec";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { persistAgentPrefsFromStore } from "@/lib/campaignStorage";
import { listProviderOptions, loadPedelecSettings } from "@/lib/pedelec/preflight";
import { useGameStore } from "@/store/useGameStore";

type DesktopSettings = {
  defaultProvider: ProviderCode | null;
  defaultModels: Partial<Record<ProviderCode, string>>;
};

export function PedelecSettingsPanel({
  onApply,
}: {
  /** provider 為 undefined 表示沿用 Desktop 預設 */
  onApply: (provider: ProviderCode | undefined, model?: string) => Promise<void>;
}) {
  const open = useGameStore((s) => s.showSettings);
  const setOpen = useGameStore((s) => s.setShowSettings);
  const savedProvider = useGameStore((s) => s.selectedProvider);
  const savedModel = useGameStore((s) => s.selectedModel);
  const setProvider = useGameStore((s) => s.setProvider);
  const setModel = useGameStore((s) => s.setModel);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [desktop, setDesktop] = useState<DesktopSettings>({
    defaultProvider: null,
    defaultModels: {},
  });
  const [providerDraft, setProviderDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedProviderUnavailable, setSavedProviderUnavailable] =
    useState(false);

  const availableProviders = useMemo(
    () => providers.filter((p) => p.available),
    [providers],
  );

  const desktopDefault = useMemo(() => {
    if (!desktop.defaultProvider) return null;
    return (
      availableProviders.find((p) => p.code === desktop.defaultProvider) ?? null
    );
  }, [availableProviders, desktop.defaultProvider]);

  const effectiveProviderCode =
    (providerDraft as ProviderCode) ||
    desktop.defaultProvider ||
    "";

  const defaultModelForDraft =
    effectiveProviderCode
      ? desktop.defaultModels[effectiveProviderCode as ProviderCode]
      : undefined;

  useEffect(() => {
    if (!open) return;
    setError(null);
    void (async () => {
      const [list, settings] = await Promise.all([
        listProviderOptions(),
        loadPedelecSettings(),
      ]);
      setProviders(list);
      setDesktop({
        defaultProvider: settings.defaultProvider,
        defaultModels: settings.defaultModels,
      });

      const available = list.filter((p) => p.available);
      const savedInList =
        savedProvider &&
        available.some((p) => p.code === savedProvider);
      const unavailable = Boolean(savedProvider && !savedInList);

      // 空字串 = 使用 Desktop 預設（與 ai-playlist 相同）
      setProviderDraft(
        savedProvider && (savedInList || unavailable) ? savedProvider : "",
      );
      setModelDraft(savedModel);
      setSavedProviderUnavailable(unavailable);
    })();
  }, [open, savedModel, savedProvider]);

  const canSave = providerDraft
    ? availableProviders.some((p) => p.code === providerDraft) ||
      (savedProviderUnavailable && providerDraft === savedProvider)
    : Boolean(desktopDefault);

  return (
    <Modal open={open} onOpenChange={setOpen} title="Pedelec Provider / Model">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          預設繼承 Desktop App 設定。此處可為此 Session 覆寫 Provider / Model。
        </p>
        <div className="space-y-2">
          <Label htmlFor="provider">Provider</Label>
          <select
            id="provider"
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-ink"
            value={providerDraft}
            onChange={(e) => {
              setProviderDraft(e.target.value);
              setModelDraft("");
            }}
          >
            {desktopDefault ? (
              <option value="">
                使用 Pedelec 預設（{desktopDefault.name}）
              </option>
            ) : (
              <option value="" disabled>
                請選擇 Provider
              </option>
            )}
            {availableProviders.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
            {savedProviderUnavailable && savedProvider ? (
              <option value={savedProvider}>
                {savedProvider}（已儲存，目前不可用）
              </option>
            ) : null}
          </select>
          {providers.length > 0 && availableProviders.length === 0 ? (
            <p className="text-xs text-danger">
              目前沒有偵測到可用的 Provider，請先在 Pedelec Desktop 完成設定。
            </p>
          ) : null}
          {savedProviderUnavailable && savedProvider ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              已儲存的 Provider「{savedProvider}」目前不可用，請重新選擇或確認
              Pedelec Desktop 設定。
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            placeholder={
              defaultModelForDraft
                ? `留空使用預設（${defaultModelForDraft}）`
                : "留空使用預設"
            }
          />
        </div>
        {error ? <p className="text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button
            disabled={!canSave || busy}
            onClick={async () => {
              if (!canSave) return;
              setBusy(true);
              setError(null);
              try {
                const overrideProvider = providerDraft
                  ? (providerDraft as ProviderCode)
                  : undefined;
                const overrideModel = modelDraft.trim() || undefined;
                const resolvedProvider =
                  overrideProvider ?? desktopDefault?.code;
                if (!resolvedProvider) {
                  throw new Error("沒有可用的 Provider");
                }

                // store：空覆寫記成 null / ""，實際建立用 resolved
                setProvider(overrideProvider ?? null);
                setModel(overrideModel ?? "");
                persistAgentPrefsFromStore({
                  selectedProvider: overrideProvider ?? null,
                  selectedModel: overrideModel ?? "",
                  suggestPlayerActions:
                    useGameStore.getState().suggestPlayerActions,
                  scenarioScale:
                    useGameStore.getState().script.scenario_scale,
                });

                await onApply(overrideProvider, overrideModel);
                setOpen(false);
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "建立 Session 失敗",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "建立中…" : "儲存並重新連線"}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            關閉
          </Button>
        </div>
      </div>
    </Modal>
  );
}
