import { useGameStore } from "@/store/useGameStore";

export class OutgoingPromptCancelledError extends Error {
  constructor() {
    super("OUTGOING_PROMPT_CANCELLED");
    this.name = "OutgoingPromptCancelledError";
  }
}

export type OutgoingPromptPreviewRequest = {
  prompt: string;
  label: string;
  /** Unicode 字元數（與先前分析一致） */
  charCount: number;
};

type Listener = (req: OutgoingPromptPreviewRequest | null) => void;

let listener: Listener | null = null;
let pendingResolve: ((ok: boolean) => void) | null = null;

export function subscribeOutgoingPromptPreview(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function resolveOutgoingPromptPreview(ok: boolean) {
  const resolve = pendingResolve;
  pendingResolve = null;
  listener?.(null);
  resolve?.(ok);
}

export function isOutgoingPromptCancelled(err: unknown): boolean {
  return (
    err instanceof OutgoingPromptCancelledError ||
    (err instanceof Error && err.message === "OUTGOING_PROMPT_CANCELLED")
  );
}

export function countPromptChars(prompt: string): number {
  return [...prompt].length;
}

/**
 * 若「檢視送出文字」開啟，在真正 session.sendText 前等待使用者確認。
 * 僅涵蓋應用層傳入的 prompt（不含 Pedelec 冷啟動 Runtime Rules / Tool Configuration）。
 */
export async function gateOutgoingPrompt(
  prompt: string,
  opts?: { label?: string },
): Promise<void> {
  if (!useGameStore.getState().inspectOutgoingPrompt) return;
  if (!listener) return;

  const ok = await new Promise<boolean>((resolve) => {
    pendingResolve?.(false);
    pendingResolve = resolve;
    listener?.({
      prompt,
      label: opts?.label?.trim() || "送出給 AI",
      charCount: countPromptChars(prompt),
    });
  });

  if (!ok) throw new OutgoingPromptCancelledError();
}
