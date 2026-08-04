import { useEffect, useRef } from "react";
import type { ProviderCode } from "@kaoruisaac/pedelec";
import { startAiPlayerLoop } from "@/lib/aiPlayer/autoPlay";
import { useAiPlayerStore } from "@/lib/aiPlayer/store";
import {
  listProviderOptions,
  loadPedelecSettings,
} from "@/lib/pedelec/preflight";
import { useGameStore } from "@/store/useGameStore";

/**
 * 掛在 Play 畫面即可：開關開啟時跑代打迴圈，關閉或卸載時停止。
 * 僅讀取 game store／設定，不污染 GM session 生命週期。
 */
export function useAiPlayerAutoPlay() {
  const enabled = useAiPlayerStore((s) => s.enabled);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }

    stopRef.current = startAiPlayerLoop({
      resolveProvider: resolveAiPlayerProvider,
    });

    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [enabled]);
}

async function resolveAiPlayerProvider(): Promise<{
  provider: ProviderCode;
  model?: string;
}> {
  const game = useGameStore.getState();
  if (game.selectedProvider) {
    return {
      provider: game.selectedProvider,
      model: game.selectedModel || undefined,
    };
  }

  const [providers, settings] = await Promise.all([
    listProviderOptions(),
    loadPedelecSettings(),
  ]);
  const available = providers.filter((p) => p.available);
  const preferred = settings.defaultProvider;
  const provider =
    (preferred && available.find((p) => p.code === preferred)?.code) ||
    available[0]?.code;
  if (!provider) throw new Error("沒有可用的 Provider");

  const model =
    game.selectedModel ||
    settings.defaultModels?.[provider] ||
    undefined;
  return { provider, model };
}
