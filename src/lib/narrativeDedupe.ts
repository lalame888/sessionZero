/** 正規化後比對用：忽略空白與常見引號差異 */
function normNarrative(text: string) {
  return text.replace(/\s+/g, "").replace(/[「」『』""'']/g, "");
}

/**
 * 判斷 next 是否為對 prev 的「同輪重寫」（常見於檢定後又整段重講開場）。
 * 若是，前端應更新同一則 GM 訊息，而不是再貼一整段。
 */
export function isNarrativeRewrite(previous: string, next: string): boolean {
  const prev = previous.trim();
  const curr = next.trim();
  if (prev.length < 60 || curr.length < 60) return false;

  const a = normNarrative(prev);
  const b = normNarrative(curr);
  const head = a.slice(0, Math.min(80, a.length));
  if (head.length >= 40 && b.includes(head.slice(0, 50))) return true;

  const firstLine = (s: string) => s.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const la = normNarrative(firstLine(prev));
  const lb = normNarrative(firstLine(curr));
  // 相同短標題（如「開場」）且後文明顯重疊
  if (la.length >= 2 && la === lb && b.includes(a.slice(0, Math.min(40, a.length)))) {
    return true;
  }
  return false;
}
