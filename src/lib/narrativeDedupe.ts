/** 正規化後比對用：忽略空白、引號、常見標點與 UTF-8 損壞替代字元 */
function normNarrative(text: string) {
  return text
    .replace(/\uFFFD+/g, "")
    .replace(/\s+/g, "")
    .replace(/[「」『』""'']/g, "")
    .replace(/[，。！？、；：…—·,.!?;:]/g, "");
}

/**
 * 是否為「損壞／截斷」的敘事碎片（常見於 tool 已寫完整敘事後，
 * chat 串流又吐出後半段，開頭多個 �）。
 */
export function isCorruptedNarrativeFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.includes("\uFFFD")) return true;
  // 模型把內部狀態寫進對話
  if (/停用工具調用|等待後台任務|wait for the game system|waiting for .*dice/i.test(t)) {
    return true;
  }
  return false;
}

/** 較短字串是否為較長字串的片段（忽略 � 與空白） */
function isNormalizedFragmentOf(shorter: string, longer: string): boolean {
  const a = normNarrative(shorter);
  const b = normNarrative(longer);
  if (a.length < 40 || b.length < 60) return false;
  if (a.length >= b.length * 0.95) return false;
  return b.includes(a);
}

/** 1 - 正規化 Levenshtein / maxLen；短字串可接受 */
function editSimilarity(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return 1;
  if (n === 0 || m === 0) return 0;

  // 長度差太大不可能是同輪重寫
  const maxLen = Math.max(n, m);
  const minLen = Math.min(n, m);
  if (minLen / maxLen < 0.7) return 0;

  const prev = new Array<number>(m + 1);
  const cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ca = a[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const cost = ca === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= m; j++) prev[j] = cur[j] ?? 0;
  }
  const dist = prev[m] ?? maxLen;
  return 1 - dist / maxLen;
}

/**
 * 判斷 next 是否為對 prev 的「同輪重寫／近重複」
 * （檢定後整段重講、或 tool + chat 各吐一次幾乎相同敘事）。
 */
export function isNarrativeRewrite(previous: string, next: string): boolean {
  const prev = previous.trim();
  const curr = next.trim();
  if (prev.length < 60 || curr.length < 60) return false;

  // 截斷碎片：較短者為較長者子字串（含 � 開頭的後半段重複）
  if (
    isNormalizedFragmentOf(prev, curr) ||
    isNormalizedFragmentOf(curr, prev)
  ) {
    return true;
  }

  const a = normNarrative(prev);
  const b = normNarrative(curr);
  if (a.length < 40 || b.length < 40) return false;
  if (a === b) return true;

  const head = a.slice(0, Math.min(80, a.length));
  if (head.length >= 40 && b.includes(head.slice(0, 50))) return true;
  const headB = b.slice(0, Math.min(80, b.length));
  if (headB.length >= 40 && a.includes(headB.slice(0, 50))) return true;

  const firstLine = (s: string) =>
    s.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const la = normNarrative(firstLine(prev));
  const lb = normNarrative(firstLine(curr));
  if (
    la.length >= 2 &&
    la === lb &&
    b.includes(a.slice(0, Math.min(40, a.length)))
  ) {
    return true;
  }

  // 長共用前綴（錯字出現較晚時）
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 40) {
    let shared = 0;
    while (shared < minLen && a[shared] === b[shared]) shared++;
    if (shared >= 40 && shared / minLen >= 0.55) return true;
  }

  // 整體極相近（吊盜/吊墜、令/讓 等少量用詞差）
  if (editSimilarity(a, b) >= 0.88) return true;

  return false;
}

/** 兩則敘事是否應合併為同一則（順序無關） */
export function areDuplicateNarratives(a: string, b: string): boolean {
  return isNarrativeRewrite(a, b) || isNarrativeRewrite(b, a);
}
