/**
 * 把誤寫成字面「\n」「\t」的敘事還原成真正換行／定位字元。
 * （常見於 tool args 雙重跳脫或模型把 escape 當正文寫出）
 */
export function normalizeNarrativeText(text: string): string {
  if (!text) return text;
  const escapedBreaks = (text.match(/\\n/g) ?? []).length;
  if (escapedBreaks === 0) return text;

  const realBreaks = (text.match(/\n/g) ?? []).length;
  // 已有足夠真實換行時不強制改寫，避免誤傷含「\n」字樣的正文
  if (realBreaks > 0 && realBreaks >= escapedBreaks) return text;

  return text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}
