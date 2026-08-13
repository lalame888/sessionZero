import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { requestPedelecOriginApproval } from "@/lib/pedelec/preflight";
import { useGameStore } from "@/store/useGameStore";

const DESKTOP = "https://pedelec.cc/download";
const EXTENSION =
  "https://chromewebstore.google.com/detail/pedelec/ogccgaminlphbkeghldidiiimajfdpag";

export function PedelecInstallationGuideline({
  onRecheck,
  onRequestApproval,
}: {
  onRecheck: () => void | Promise<void>;
  /** 由外層觸發核准（可含自動開啟彈窗）；若未提供則元件內自行呼叫 SDK */
  onRequestApproval?: () => void | Promise<unknown>;
}) {
  const open = useGameStore((s) => s.showInstallGuide);
  const setOpen = useGameStore((s) => s.setShowInstallGuide);
  const preflight = useGameStore((s) => s.preflight);
  const [approving, setApproving] = useState(false);

  const needsApproval = preflight.reason === "NEEDS_APPROVAL";
  const desktopDisconnected = preflight.reason === "DESKTOP_DISCONNECTED";
  const needsDesktop =
    desktopDisconnected || preflight.reason === "NO_AVAILABLE_PROVIDER";

  const title = desktopDisconnected
    ? "需要重新連線 Pedelec Desktop"
    : preflight.reason === "NO_AVAILABLE_PROVIDER"
      ? "需要啟動 Pedelec Desktop / Provider"
      : needsApproval
        ? "需要核准此網站"
        : "SessionZero 需要 Pedelec";

  const handleAllowSite = async () => {
    setApproving(true);
    try {
      if (onRequestApproval) {
        await onRequestApproval();
      } else {
        const result = await requestPedelecOriginApproval();
        if (result.approved) {
          await onRecheck();
        } else if (result.message) {
          useGameStore.getState().setPreflight({
            ...useGameStore.getState().preflight,
            message: result.message,
          });
        }
      }
    } finally {
      setApproving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={setOpen} title={title}>
      <div className="space-y-4 text-sm text-muted">
        {needsApproval ? (
          <>
            <p>
              Pedelec 擴充元件已安裝，但尚未核准本網站存取。核准後才能建立 Agent
              Session。
            </p>
            <p className="rounded-md border border-border bg-bg/50 p-3 text-ink">
              {preflight.message ??
                "請在瀏覽器工具列跳出的 Pedelec 視窗中按「允許此網站」。若沒有自動跳出，請按下方按鈕或手動點擊擴充元件圖示。"}
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>按「允許此網站」會嘗試開啟擴充元件核准彈窗</li>
              <li>若瀏覽器擋住自動彈窗，請手動點工具列的 Pedelec 圖示</li>
              <li>核准完成後按「重新檢查」確認連線</li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => void handleAllowSite()} disabled={approving}>
                {approving ? "等待核准…" : "允許此網站"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onRecheck()}
                disabled={approving}
              >
                重新檢查
              </Button>
              <Button
                variant="secondary"
                onClick={() => setOpen(false)}
                disabled={approving}
              >
                先關閉（核心功能仍停用）
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              {desktopDisconnected
                ? "擴充元件仍在，但目前偵測不到 Pedelec Desktop。請先啟動 Desktop，不必重裝 Extension。"
                : "SessionZero 的核心跑團體驗由本機 Agent（BYO-AI）驅動。未完成安裝與連線前，主輸入框會保持停用。"}
            </p>
            <p className="rounded-md border border-border bg-bg/50 p-3 text-ink">
              {preflight.message ?? "請完成下列步驟後按「重新檢查」。"}
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                {desktopDisconnected ? "啟動" : "下載並啟動"}{" "}
                <a
                  className="text-accent underline"
                  href={DESKTOP}
                  target="_blank"
                  rel="noreferrer"
                >
                  Pedelec Desktop App
                </a>
              </li>
              {needsDesktop ? null : (
                <li>
                  安裝或啟用{" "}
                  <a
                    className="text-accent underline"
                    href={EXTENSION}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pedelec Chrome Extension
                  </a>
                  （偵測不到不一定代表未安裝，也可能是停用、不同瀏覽器設定檔或
                  bridge 斷線）
                </li>
              )}
              {desktopDisconnected ? (
                <li>啟動後回到此處按「重新檢查」，確認 Desktop ping 成功</li>
              ) : (
                <li>
                  在 Desktop 設定至少一個可用 Provider（OpenAI / Claude / Ollama
                  等）
                </li>
              )}
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={() => void onRecheck()}>重新檢查</Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                先關閉（核心功能仍停用）
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
