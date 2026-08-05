import { isCorruptedNarrativeFragment } from "@/lib/narrativeDedupe";
import { looksLikeLeakedToolCall } from "@/lib/pedelec/leakedToolCall";

/** history／摘要應忽略的噪音敘事（檢定 stub、暗骰佔位、漏出 tool、截斷亂碼） */
export function isNoiseHistoryNarrative(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("（檢定結果已回傳）")) return true;
  if (t.startsWith("（暗骰）")) return true;
  if (looksLikeLeakedToolCall(t)) return true;
  if (isCorruptedNarrativeFragment(t)) return true;
  return false;
}

export function isSuccessDiceOutcome(outcome: string): boolean {
  const o = outcome.toUpperCase();
  return (
    o.includes("SUCCESS") ||
    o === "CRITICAL" ||
    o.includes("EXTREME") ||
    o.includes("HARD")
  );
}

/** 社交／資訊類失敗不應扣 SAN 的 reason 關鍵字 */
const SOCIAL_SAN_BLOCK =
  /心理|說服|話術|魅惑|恐嚇|交涉|社交|寒暄|問路|詢問|說服|說謊|洞察.*(意圖|表情|語氣)|居民|委託人/;

export function isBlockedSocialSanLoss(key: string, reason: string): boolean {
  const k = key.toUpperCase();
  if (k !== "SAN" && k !== "理智" && !k.includes("SAN")) return false;
  return SOCIAL_SAN_BLOCK.test(reason);
}
