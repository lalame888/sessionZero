import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  resolveOutgoingPromptPreview,
  subscribeOutgoingPromptPreview,
  type OutgoingPromptPreviewRequest,
} from "@/lib/outgoingPromptGate";

export function OutgoingPromptPreviewModal() {
  const [req, setReq] = useState<OutgoingPromptPreviewRequest | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeOutgoingPromptPreview(setReq), []);

  useEffect(() => {
    setCopied(false);
  }, [req?.prompt]);

  const open = Boolean(req);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && req) resolveOutgoingPromptPreview(false);
      }}
      title="檢視送出文字"
      subtitle={
        req
          ? `${req.label} · ${req.charCount.toLocaleString()} 字`
          : undefined
      }
      className="w-[min(96vw,880px)]"
      bodyClassName="flex flex-col gap-3"
    >
      {req ? (
        <>
          <p className="text-xs text-muted">
            此為應用層 <code className="text-ink">session.sendText</code>{" "}
            本文。不含 Pedelec 冷啟動時附加的 Runtime Rules／App Tool
            Configuration。
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              字元數（Unicode）：
              <strong className="text-ink">
                {req.charCount.toLocaleString()}
              </strong>
            </span>
            <span>·</span>
            <span>
              UTF-16 length：
              <strong className="text-ink">
                {req.prompt.length.toLocaleString()}
              </strong>
            </span>
            <Button
              type="button"
              variant="secondary"
              className="ml-auto h-7 px-2 text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(req.prompt);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {copied ? "已複製" : "複製全文"}
            </Button>
          </div>
          <pre className="max-h-[min(55vh,520px)] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink">
            {req.prompt}
          </pre>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => resolveOutgoingPromptPreview(false)}
            >
              取消送出
            </Button>
            <Button
              type="button"
              onClick={() => resolveOutgoingPromptPreview(true)}
            >
              確認送出
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
