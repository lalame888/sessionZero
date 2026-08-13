import type { ProviderCode } from "@kaoruisaac/pedelec";
import { explicitSessionModel, pedelec } from "@/lib/pedelec/client";
import { EVENT_CHANNEL_FAILED_MESSAGE } from "@/lib/pedelec/sessionLiveness";
import type { PreflightState } from "@/types/game";

export type OriginApprovalResult = {
  approved: boolean;
  popupFailed?: boolean;
  message?: string;
};

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

let approvalInFlight: Promise<OriginApprovalResult> | null = null;

/**
 * 觸發 Pedelec 擴充元件的來源核准彈窗。
 * SDK 僅在 createSession / resumeSession 時會要求核准；getApprovalStatus 不會開彈窗。
 */
export async function requestPedelecOriginApproval(): Promise<OriginApprovalResult> {
  if (approvalInFlight) return approvalInFlight;

  approvalInFlight = (async () => {
    try {
      // 同時帶 provider + model，略過 getSettings，直接送 create_session 以開啟核准 UI
      const session = await pedelec.createSession({
        provider: "codex",
        model: "gpt-5",
        autoEndOnDisconnect: true,
      });
      await session.end().catch(() => undefined);
      return { approved: true };
    } catch (error) {
      const approval = await pedelec.getApprovalStatus().catch(() => null);
      if (approval?.approved) {
        return { approved: true };
      }

      const code = errorCode(error);
      if (code === "OPEN_POPUP_FAILED") {
        return {
          approved: false,
          popupFailed: true,
          message:
            "無法自動開啟 Pedelec 擴充元件。請手動點擊瀏覽器工具列的 Pedelec 圖示，再按「允許此網站」。",
        };
      }
      if (code === "APPROVAL_REJECTED") {
        return {
          approved: false,
          message: "已拒絕此網站的 Pedelec 存取。若要繼續，請重新核准。",
        };
      }
      if (code === "APPROVAL_TIMEOUT") {
        return {
          approved: false,
          message: "核准逾時。請再按「允許此網站」，並在彈窗中完成核准。",
        };
      }
      return {
        approved: false,
        message:
          error instanceof Error
            ? error.message
            : "開啟核准流程失敗，請手動點擊 Pedelec 擴充元件圖示。",
      };
    } finally {
      approvalInFlight = null;
    }
  })();

  return approvalInFlight;
}

export async function probePedelecEventChannel(options: {
  provider: ProviderCode;
  model?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  let session: Awaited<ReturnType<typeof pedelec.createSession>> | null = null;
  try {
    session = await pedelec.createSession({
      provider: options.provider,
      model: explicitSessionModel(options.model),
      autoEndOnDisconnect: true,
    });
    const status = session.getStatus();
    if (status === "error" || status === "ended") {
      return { ok: false, message: EVENT_CHANNEL_FAILED_MESSAGE };
    }
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    const message =
      error instanceof Error ? error.message : EVENT_CHANNEL_FAILED_MESSAGE;
    return {
      ok: false,
      message: code ? `${code} — ${message}` : message,
    };
  } finally {
    if (session) await session.end().catch(() => undefined);
  }
}

export async function checkPedelecPrerequisites(options?: {
  probeEventChannel?: boolean;
}): Promise<PreflightState> {
  const probeEventChannel = options?.probeEventChannel ?? true;
  try {
    const approval = await pedelec.getApprovalStatus();
    if (!approval.installed) {
      return {
        ready: false,
        reason: "NEEDS_INSTALLATION",
        message: "偵測不到 Pedelec Chrome Extension（可能未安裝、已停用或 bridge 未連線）。",
      };
    }
    // SDK：連線狀態以 appConnected（Desktop ping）為準，不可用 listProviders 當探測。
    if (!approval.appConnected) {
      return {
        ready: false,
        reason: "DESKTOP_DISCONNECTED",
        message:
          "Pedelec Desktop 未連線。請啟動 Desktop App 後按「重新檢查」。",
      };
    }
    if (!approval.approved) {
      return {
        ready: false,
        reason: "NEEDS_APPROVAL",
        message:
          "此網站尚未獲得 Pedelec 來源核准。請在擴充元件彈窗中按「允許此網站」。",
      };
    }

    // getSettings 與 listProviders 分開：Desktop 偶發回傳 SDK 不認得的 settings shape
    //（SDK_PROTOCOL_ERROR: get_settings response had invalid shape），不應整段預檢失敗。
    let providers: Awaited<ReturnType<typeof pedelec.listProviders>>;
    try {
      providers = await pedelec.listProviders();
    } catch (error) {
      console.warn("listProviders failed", error);
      return {
        ready: false,
        reason: "NO_AVAILABLE_PROVIDER",
        message:
          "Pedelec Desktop 未就緒或尚無可用 Provider。請啟動 Desktop 並設定 Provider。",
      };
    }

    const settings = await loadPedelecSettings();
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

    if (probeEventChannel) {
      const probe = await probePedelecEventChannel({
        provider: preferred,
        model: settings.defaultModels?.[preferred] ?? "",
      });
      if (!probe.ok) {
        return {
          ready: false,
          reason: "EVENT_CHANNEL_FAILED",
          provider: preferred,
          message: probe.message,
        };
      }
    }

    return {
      ready: true,
      reason: "READY",
      provider: preferred,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pedelec 預檢失敗";
    console.warn("checkPedelecPrerequisites error", error);
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
  } catch (error) {
    // Desktop / SDK 版本不一致時常見：defaultProvider 不是已知 code、
    // defaultModels 為 null、或 key/value 型別不符。預檢改退回「無 Desktop 預設」。
    console.warn("getSettings failed, using empty defaults", error);
    return { defaultProvider: null as ProviderCode | null, defaultModels: {} };
  }
}

/** Desktop ping；失敗視為未連線，不開核准彈窗。 */
export async function probePedelecAppConnected(): Promise<boolean> {
  try {
    const approval = await pedelec.getApprovalStatus();
    return Boolean(approval.installed && approval.appConnected);
  } catch {
    return false;
  }
}
