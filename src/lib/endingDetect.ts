/**
 * 偵測敘事是否已寫成「結局／全劇終」口吻，但可能尚未呼叫 end_game_session。
 */
export function looksLikeEndingNarrative(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /全劇終|恭喜通關|劇本結束|冒險結束|遊戲結束|通關成功|感謝您的遊玩|感謝你的遊玩/i.test(
      t,
    ) ||
    /【[^】]{0,40}(結束|通關|終曲|全劇終)[^】]{0,20}】/.test(t) ||
    /(?:TRUE|BAD|NORMAL|SECRET)_ENDING/i.test(t)
  );
}

/** 嘗試從結局口吻敘事抽出標題 */
export function extractEndingTitleFromNarrative(
  text: string,
  fallback: string,
): string {
  const bracket = text.match(/【\s*([^】]+?)\s*】/);
  if (bracket?.[1]) {
    return bracket[1]
      .replace(/[─－—\-–]+\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }
  const dash = text.match(
    /[「『《]?([^」』》\n]{2,40}?)[」』》]?\s*(?:結束|全劇終|通關)/,
  );
  if (dash?.[1]) return dash[1].trim().slice(0, 80);
  return fallback || "結局";
}
