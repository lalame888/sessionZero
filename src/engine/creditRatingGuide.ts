/** CoC 信用評級：生活水準區間（簡化教學用，非完整職業包） */

export type CreditLifestyleId =
  | "destitute"
  | "poor"
  | "average"
  | "comfortable"
  | "wealthy"
  | "rich";

export type CreditLifestyleBand = {
  id: CreditLifestyleId;
  label: string;
  min: number;
  max: number;
  /** 一鍵採用的建議中值 */
  mid: number;
  hint: string;
};

export const CREDIT_LIFESTYLE_BANDS: CreditLifestyleBand[] = [
  {
    id: "destitute",
    label: "落魄",
    min: 0,
    max: 5,
    mid: 1,
    hint: "幾乎無固定收入、借貸困難",
  },
  {
    id: "poor",
    label: "溫飽",
    min: 6,
    max: 15,
    mid: 10,
    hint: "僅能糊口，少有積蓄",
  },
  {
    id: "average",
    label: "一般",
    min: 16,
    max: 39,
    mid: 28,
    hint: "薪水族／小職員常見水準",
  },
  {
    id: "comfortable",
    label: "小康",
    min: 40,
    max: 59,
    mid: 50,
    hint: "專業人士、穩定中產",
  },
  {
    id: "wealthy",
    label: "富裕",
    min: 60,
    max: 79,
    mid: 70,
    hint: "體面資產、易取得信用",
  },
  {
    id: "rich",
    label: "名流",
    min: 80,
    max: 99,
    mid: 90,
    hint: "高層社會、豪門／大亨感",
  },
];

export const CREDIT_RATING_TOOLTIP = [
  "信用評級是 CoC 技能（％），表示社會地位與可動用的金錢／信用。",
  "正規創角：依職業建議區間，用職業點（必要時興趣點）配置此技能；再依％對應生活水準與現金／資產敘事。",
  "檢定用途：借錢、打通關係、被當成「有頭有臉」時。",
  "常見區間：落魄 0–5、溫飽 6–15、一般 16–39、小康 40–59、富裕 60–79、名流 80–99。",
].join("\n\n");

/** 依信用評級區間產生建議的資產概況／現金敘事（可覆寫） */
export function suggestedWealthCopy(band: CreditLifestyleBand): {
  wealth: string;
  cash_assets: string;
} {
  switch (band.id) {
    case "destitute":
      return {
        wealth: "落魄／幾乎無固定收入",
        cash_assets: "僅有零用現金，借貸困難，無可靠存款。",
      };
    case "poor":
      return {
        wealth: "溫飽／僅能糊口",
        cash_assets: "月薪勉強夠用，少有積蓄，資產有限。",
      };
    case "average":
      return {
        wealth: "一般薪水族水準",
        cash_assets: "有固定收入與少量存款，可應付日常開銷。",
      };
    case "comfortable":
      return {
        wealth: "小康／穩定中產",
        cash_assets: "專業收入穩定，有存款與基本資產，信用良好。",
      };
    case "wealthy":
      return {
        wealth: "富裕／體面資產",
        cash_assets: "易取得信用與融資，持有可觀存款或不動產。",
      };
    case "rich":
      return {
        wealth: "名流／高層社會",
        cash_assets: "豪門或大亨級資產，金錢幾乎不是限制。",
      };
  }
}

export function bandForCredit(score: number): CreditLifestyleBand | null {
  if (!Number.isFinite(score)) return null;
  return (
    CREDIT_LIFESTYLE_BANDS.find((b) => score >= b.min && score <= b.max) ??
    null
  );
}

/** 從資產敘事推估「應落在哪個水準」的關鍵詞（軟提示用） */
export function inferLifestyleFromWealthText(
  text: string,
): CreditLifestyleId | null {
  const t = text.trim();
  if (!t) return null;

  if (
    /身無分文|一文不名|家徒四壁|流浪|遊民|乞|赤貧|破產|欠債纍纍|睡街頭/.test(
      t,
    )
  ) {
    return "destitute";
  }
  if (/僅能糊口|勉強溫飽|三餐不濟|拮据|貧窮|低薪|房租吃緊/.test(t)) {
    return "poor";
  }
  if (
    /名流|豪門|億萬|大亨|頂級|奢華|私人飛機|別墅群|上流社會/.test(t)
  ) {
    return "rich";
  }
  if (/富裕|豪宅|名車|高額存款|投資組合|殷實|豐厚/.test(t)) {
    return "wealthy";
  }
  if (/小康|中產|穩定收入|專業人士|存款不錯|自有住宅/.test(t)) {
    return "comfortable";
  }
  if (/薪水|上班|普通|一般|溫飽以上|小職員|公務員/.test(t)) {
    return "average";
  }
  return null;
}

export function creditConsistencyWarning(
  score: number | undefined,
  wealthText: string,
  cashText: string,
): string | null {
  if (score == null || !Number.isFinite(score)) return null;

  const combined = `${wealthText}\n${cashText}`;
  const inferred = inferLifestyleFromWealthText(combined);
  if (!inferred) return null;

  const expected = CREDIT_LIFESTYLE_BANDS.find((b) => b.id === inferred);
  const actual = bandForCredit(score);
  if (!expected || !actual) return null;

  // 相差超過一個等級才警告
  const expectedIdx = CREDIT_LIFESTYLE_BANDS.findIndex(
    (b) => b.id === expected.id,
  );
  const actualIdx = CREDIT_LIFESTYLE_BANDS.findIndex((b) => b.id === actual.id);
  if (Math.abs(expectedIdx - actualIdx) <= 1) return null;

  return `資產敘事偏「${expected.label}」（約 ${expected.min}–${expected.max}%），但信用評級 ${score}% 落在「${actual.label}」。建議對齊，以免 GM 敘事彆扭。`;
}

export function creditOutOfCommonRangeNote(score: number): string | null {
  if (score < 0 || score > 99) return "信用評級應在 0–99%。";
  return null;
}
