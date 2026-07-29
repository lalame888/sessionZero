import type { ProviderCode } from "@kaoruisaac/pedelec";
import { pedelec } from "@/lib/pedelec/client";
import type { PreflightState } from "@/types/game";

export async function checkPedelecPrerequisites(): Promise<PreflightState> {
  try {
    const approval = await pedelec.getApprovalStatus();
    if (!approval.installed) {
      return {
        ready: false,
        reason: "NEEDS_INSTALLATION",
        message: "偵測不到 Pedelec Chrome Extension（可能未安裝、已停用或 bridge 未連線）。",
      };
    }
    if (!approval.approved) {
      return {
        ready: false,
        reason: "NEEDS_APPROVAL",
        message: "此網站尚未獲得 Pedelec 來源核准。建立 Session 時會引導核准。",
      };
    }

    const [providers, settings] = await Promise.all([
      pedelec.listProviders(),
      pedelec.getSettings(),
    ]);
    const available = providers.filter((p) => p.available);
    if (!available.length) {
      return {
        ready: false,
        reason: "NO_AVAILABLE_PROVIDER",
        message: "Pedelec Desktop 未就緒或尚無可用 Provider。請啟動 Desktop 並設定 Provider。",
      };
    }

    const preferred =
      settings.defaultProvider &&
      available.some((p) => p.code === settings.defaultProvider)
        ? settings.defaultProvider
        : available[0].code;

    return {
      ready: true,
      reason: "READY",
      provider: preferred,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pedelec 預檢失敗";
    return { ready: false, reason: "ERROR", message };
  }
}

export async function listProviderOptions() {
  try {
    return await pedelec.listProviders();
  } catch {
    return [] as Awaited<ReturnType<typeof pedelec.listProviders>>;
  }
}

export async function loadPedelecSettings() {
  try {
    return await pedelec.getSettings();
  } catch {
    return { defaultProvider: null as ProviderCode | null, defaultModels: {} };
  }
}
