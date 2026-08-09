/** 短窗內同檢定成功後禁止再開第二顆骰；pending 未結算時禁止覆寫。 */

const SUCCESS_WINDOW_MS = 12 * 60 * 1000;

type SuccessEntry = { at: number; outcome: string };

const recentSuccesses = new Map<string, SuccessEntry>();

export function normalizeCheckPurpose(reason: string): string {
  return reason
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[，。！？、；：,.!?;:「」『』【】[\]()（）]/g, "")
    .slice(0, 72)
    .toLowerCase();
}

export function makeCheckFingerprint(input: {
  characterId?: string | null;
  skillLabel: string;
  reason: string;
}): string {
  const cid = (input.characterId ?? "pc").trim() || "pc";
  const skill = input.skillLabel.trim().toLowerCase();
  const purpose = normalizeCheckPurpose(input.reason);
  return `${cid}|${skill}|${purpose}`;
}

function pruneExpired(now = Date.now()) {
  for (const [k, v] of recentSuccesses) {
    if (now - v.at > SUCCESS_WINDOW_MS) recentSuccesses.delete(k);
  }
}

export function recordSuccessfulCheck(
  fingerprint: string,
  outcome: string,
): void {
  pruneExpired();
  recentSuccesses.set(fingerprint, { at: Date.now(), outcome });
}

export function findRecentSuccessfulCheck(
  fingerprint: string,
): SuccessEntry | null {
  pruneExpired();
  const hit = recentSuccesses.get(fingerprint);
  if (!hit) return null;
  if (Date.now() - hit.at > SUCCESS_WINDOW_MS) {
    recentSuccesses.delete(fingerprint);
    return null;
  }
  return hit;
}

/** 測試用 */
export function clearRecentSuccessfulChecksForTests(): void {
  recentSuccesses.clear();
}
