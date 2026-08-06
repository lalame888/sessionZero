/** GM 敘事中常見的破第四牆／UI 提示（應移除，勿顯示給玩家） */
const TRAILING_META_RE =
  /\n*[（(][^）)]*(?:請輸入|下一步行動|輸入框|請描述您的|請於輸入|等待玩家|等待您的)[^）)]*[）)]\s*$/s;

const META_ONLY_RE =
  /^[（(][^）)]*(?:請輸入|下一步行動|輸入框|故事已正式開始|等待玩家)[^）)]*[）)]\s*$/s;

/**
 * 移除 narrate_story 末尾或整段純 UI 提示。
 * 若整段只剩提示，回傳空字串（呼叫端應略過顯示）。
 */
export function stripGmMetaPrompts(text: string): string {
  if (!text?.trim()) return text;
  let t = text.trim();
  // Pedelec/companion pipeline 內部等待狀態（不該顯示給玩家）
  // 範例：`---\nWaiting for companion action response.\n`
  if (/Waiting for companion action response\./i.test(t)) return "";
  if (/^---\s*/.test(t) && /Waiting for companion action response\./i.test(t))
    return "";
  if (META_ONLY_RE.test(t)) return "";
  t = t.replace(TRAILING_META_RE, "").trim();
  if (META_ONLY_RE.test(t)) return "";
  return t;
}

export function isGmMetaOnlyNarrative(text: string): boolean {
  return !stripGmMetaPrompts(text).trim();
}
