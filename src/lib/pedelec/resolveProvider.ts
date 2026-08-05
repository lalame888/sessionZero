import type { ProviderCode } from "@kaoruisaac/pedelec";
import {
  listProviderOptions,
  loadPedelecSettings,
} from "@/lib/pedelec/preflight";
import { useGameStore } from "@/store/useGameStore";

/**
 * 解析目前可用的 Provider／model。
 * store 未記住時，改從 Pedelec 設定與可用列表推得（與開局 ensureSession 一致）。
 */
export async function resolveAvailableProvider(options?: {
  providerOverride?: ProviderCode | null;
  modelOverride?: string;
}): Promise<{ provider: ProviderCode; model?: string }> {
  const game = useGameStore.getState();
  const override = options?.providerOverride;
  const modelOverride = options?.modelOverride;

  if (override) {
    return {
      provider: override,
      model:
        modelOverride !== undefined
          ? modelOverride || undefined
          : game.selectedModel || undefined,
    };
  }

  if (game.selectedProvider) {
    return {
      provider: game.selectedProvider,
      model:
        modelOverride !== undefined
          ? modelOverride || undefined
          : game.selectedModel || undefined,
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
  if (!provider) {
    throw new Error("NO_AVAILABLE_PROVIDER");
  }

  const model =
    modelOverride !== undefined
      ? modelOverride || undefined
      : game.selectedModel ||
        settings.defaultModels?.[provider] ||
        undefined;

  // 回填 store，避免結局頁等畫面誤判「未連線」
  useGameStore.getState().setProvider(provider);
  if (model && !game.selectedModel) {
    useGameStore.getState().setModel(model);
  }

  return { provider, model };
}
