/** 玩家是否在問「怎麼贏／怎麼破儀式」等完整解法 */
export function playerActionAsksForWinPath(action: string): boolean {
  const t = action.trim();
  if (!t) return false;
  return /如何中斷|怎麼中斷|怎麼破|怎麼贏|如何贏|勝利條件|正確解法|儀式弱點|該如何(?:阻止|破壞|中斷|結束|封印)|完整步驟|怎麼結束儀式|怎樣才能(通關|逃出|阻止)|要如何(?:才能)?(?:徹底)?封印|怎麼封印|如何封印|封印步驟|怎麼啟動.{0,8}封印/.test(
    t,
  );
}

export function buildWinAskDirective(): string {
  return `[ANTI-SPOILER — PLAYER ASKED FOR THE SOLUTION]
The player asked how to win / interrupt the ritual / how to seal.
You MUST call lookup_scenario_term({ query: "win", kind: "core" }) this turn before finishing narration.
Answer ONLY via documents, environment implication, or a frightened NPC giving ONE vague constraint (e.g. 「要強光」「要那枚印」).
FORBIDDEN even from NPC mouths: clockwise/counterclockwise, number of turns, bagua stations (坎水/離火), slot/gear order, full combo recipes, quoting winning_condition.
If they ask again, the NPC panics, misspeaks, or points at an unread document — do NOT complete the recipe.`;
}

const GENERIC_WIN_TOKENS = new Set([
  "必須",
  "調查員",
  "成功",
  "前往",
  "使用",
  "帶回",
  "乘坐",
  "逃離",
  "阻止",
  "儀式",
  "島上",
  "之後",
  "才能",
  "或者",
  "以及",
]);

/** 敘事是否把勝利條件／逐步解法直接倒給玩家 */
export function detectWinSpoilerDump(
  narrative: string,
  winningCondition?: string | null,
): boolean {
  const text = narrative.trim();
  if (!text) return false;
  const stepwise =
    /三座|依序|必須先|如果不先/.test(text) &&
    /樞紐|祭壇|儀式|中和劑|引爆|超渡|聖鹽/.test(text);
  const ritualRecipe =
    /順時針|逆時針|旋轉.{0,8}圈|三圈|坎水|離火|凹槽|嵌入.{0,10}印章|印面刻有/.test(
      text,
    ) && /封印|祭壇|陣|水銀|印章/.test(text);
  if (stepwise || ritualRecipe) return true;

  const win = (winningCondition ?? "").trim();
  if (!win) return false;
  const tokens = [...win.matchAll(/[\u4e00-\u9fff]{3,8}/g)]
    .map((m) => m[0])
    .filter((t) => !GENERIC_WIN_TOKENS.has(t));
  const uniq = [...new Set(tokens)];
  if (uniq.length < 2) return false;
  const hits = uniq.filter((k) => text.includes(k));
  return hits.length >= 3 || (uniq.length >= 2 && hits.length === uniq.length);
}

export function buildWinSpoilerGmInstruction(opts?: {
  playerAsked?: boolean;
}): string {
  if (opts?.playerAsked) {
    return "CRITICAL SPOILER: the player asked how to seal/win and you dumped the full recipe (dials, turns, bagua, slot order). Do NOT repeat or complete those steps. Next NPC/document may only restate ONE vague constraint. Adjudicate from bible via lookup; do not teach the combo.";
  }
  return "SPOILER_RISK: player-facing text listed exact ritual/win steps. Do NOT repeat the recipe. Use implication only. Call lookup_scenario_term({ query: \"win\", kind: \"core\" }) if unsure of adjudication.";
}

const NARRATIVE_META_RE =
  /（檢定結果已回傳）|（暗骰）|請輸入您的下一步|請於輸入框|No more tools|Standing by|Waiting for companion/i;

/** 敘事混入簡體／OOC meta（提示 GM 下一拍改寫，不改已顯示文字） */
export function detectNarrativeHygieneIssue(narrative: string): string | null {
  const text = narrative.trim();
  if (!text) return null;
  if (NARRATIVE_META_RE.test(text)) {
    return "META_IN_NARRATIVE: do not write OOC / UI / pipeline meta in narrative_text (e.g. （檢定結果已回傳）, 請輸入下一步). In-fiction Traditional Chinese only.";
  }
  if (/[这这们为为发发经经对对现现时时么么后后过过还还]|简体/.test(text) && !/繁體/.test(text)) {
    // 輕量：出現常見簡體字時提醒（不誤傷專有名詞過多）
    const simplifiedHits =
      (text.match(/[这们为发经对现时么后过还]/g) ?? []).length;
    if (simplifiedHits >= 4) {
      return "LANGUAGE: player-facing narrative must be Traditional Chinese (繁體), never Simplified.";
    }
  }
  return null;
}
