/**
 * 結局「劇本物資回繳」：把本場取得或對應關鍵線索的道具從角色卡剝離，
 * 避免 MacGuffin／筆記堆進檔案庫影響下一場。
 */

export type InventoryReturnReason = "session_acquired" | "key_clue";

export interface InventoryReturnProposal {
  /** 建議回繳的物品（去重、保序） */
  candidates: string[];
  /** 各物品命中原因 */
  reasons: Record<string, InventoryReturnReason[]>;
  /** 建議保留（現有背包 − candidates） */
  keep: string[];
}

function normalizeToken(s: string): string {
  return s.trim().replace(/\s+/g, "");
}

/** 物品名是否對應關鍵線索／物證描述 */
export function itemMatchesKeyArtifact(
  item: string,
  artifacts: string[],
): boolean {
  const token = item.trim();
  if (!token || !artifacts.length) return false;
  const compact = normalizeToken(token);
  if (compact.length < 2) return false;
  for (const raw of artifacts) {
    const clue = raw.trim();
    if (!clue) continue;
    if (clue.includes(token) || token.includes(clue)) return true;
    const clueCompact = normalizeToken(clue);
    if (
      clueCompact.includes(compact) ||
      (compact.length >= 4 && clueCompact.includes(compact))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 提議應回繳的物品：
 * 1) 有開打基準時：基準背包沒有、本場新增的
 * 2) 名稱對應 bible key_clues／本場關鍵線索標題
 * 無基準時（例如 AI 隊友）只依關鍵物證比對，避免誤繳起始裝備。
 */
export function proposeScenarioInventoryReturn(input: {
  inventory: string[];
  baselineInventory?: string[] | null;
  keyClues?: string[] | null;
  clueTitles?: string[] | null;
}): InventoryReturnProposal {
  const inventory = input.inventory.map((x) => x.trim()).filter(Boolean);
  const hasBaseline = input.baselineInventory != null;
  const baseline = new Set(
    (input.baselineInventory ?? []).map((x) => x.trim()).filter(Boolean),
  );
  const artifacts = [
    ...(input.keyClues ?? []),
    ...(input.clueTitles ?? []),
  ]
    .map((x) => x.trim())
    .filter(Boolean);

  const reasons: Record<string, InventoryReturnReason[]> = {};
  const pushReason = (item: string, reason: InventoryReturnReason) => {
    const list = reasons[item] ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons[item] = list;
  };

  for (const item of inventory) {
    if (hasBaseline && !baseline.has(item)) {
      pushReason(item, "session_acquired");
    }
    if (itemMatchesKeyArtifact(item, artifacts)) {
      pushReason(item, "key_clue");
    }
  }

  const candidates = inventory.filter((item) => reasons[item]?.length);
  const candidateSet = new Set(candidates);
  const keep = inventory.filter((item) => !candidateSet.has(item));

  return { candidates, reasons, keep };
}

export function reasonLabelZh(reason: InventoryReturnReason): string {
  switch (reason) {
    case "session_acquired":
      return "本場取得";
    case "key_clue":
      return "劇本關鍵物證／筆記";
    default:
      return reason;
  }
}

/** 從背包剝離指定物品（逐一 exact match 移除一次） */
export function stripInventoryItems(
  inventory: string[],
  toRemove: string[],
): string[] {
  const next = [...inventory];
  for (const rem of toRemove) {
    const idx = next.findIndex((i) => i === rem);
    if (idx >= 0) next.splice(idx, 1);
  }
  return next;
}
