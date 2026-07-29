import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/store/useGameStore";

const DESKTOP = "https://pedelec.cc/download";
const EXTENSION =
  "https://chromewebstore.google.com/detail/pedelec/ogccgaminlphbkeghldidiiimajfdpag";

export function PedelecInstallationGuideline({
  onRecheck,
}: {
  onRecheck: () => void;
}) {
  const open = useGameStore((s) => s.showInstallGuide);
  const setOpen = useGameStore((s) => s.setShowInstallGuide);
  const preflight = useGameStore((s) => s.preflight);

  const title =
    preflight.reason === "NO_AVAILABLE_PROVIDER"
      ? "需要啟動 Pedelec Desktop / Provider"
      : preflight.reason === "NEEDS_APPROVAL"
        ? "需要核准此網站"
        : "SessionZero 需要 Pedelec";

  return (
    <Modal open={open} onOpenChange={setOpen} title={title}>
      <div className="space-y-4 text-sm text-muted">
        <p>
          SessionZero 的核心跑團體驗由本機 Agent（BYO-AI）驅動。未完成安裝與連線前，主輸入框會保持停用。
        </p>
        <p className="rounded-md border border-border bg-bg/50 p-3 text-ink">
          {preflight.message ?? "請完成下列步驟後按「重新檢查」。"}
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            下載並啟動{" "}
            <a className="text-accent underline" href={DESKTOP} target="_blank" rel="noreferrer">
              Pedelec Desktop App
            </a>
          </li>
          <li>
            安裝或啟用{" "}
            <a className="text-accent underline" href={EXTENSION} target="_blank" rel="noreferrer">
              Pedelec Chrome Extension
            </a>
            （偵測不到不一定代表未安裝，也可能是停用、不同瀏覽器設定檔或 bridge 斷線）
          </li>
          <li>在 Desktop 設定至少一個可用 Provider（OpenAI / Claude / Ollama 等）</li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={onRecheck}>重新檢查</Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            先關閉（核心功能仍停用）
          </Button>
        </div>
      </div>
    </Modal>
  );
}
