/**
 * 輕量勝利進度旗標：不解析完整 NLP，只做啟發式追蹤與結局覆核警告。
 */

export interface WinProgressFlags {
  /** 已取得安魂曲／同類超渡媒介 */
  hasRequiemMedium: boolean;
  /** 敘事已宣告成功播放安魂曲等 */
  requiemPlayed: boolean;
  /** 敘事已宣告懷錶／核心儀式完成 */
  ritualCoreResolved: boolean;
  /** 已發現的關鍵線索標題 */
  keyClueTitles: string[];
}

export function emptyWinProgress(): WinProgressFlags {
  return {
    hasRequiemMedium: false,
    requiemPlayed: false,
    ritualCoreResolved: false,
    keyClueTitles: [],
  };
}

export function winConditionLooksLikeOr(winningCondition: string): boolean {
  const w = winningCondition.trim();
  if (!w) return false;
  return /或是|或者|\bOR\b|／或|，或|、或/.test(w);
}

export function noteClueForWinProgress(
  prev: WinProgressFlags,
  clueTitle: string,
  isKeyClue?: boolean,
): WinProgressFlags {
  const title = clueTitle.trim();
  if (!title) return prev;
  const keyClueTitles = prev.keyClueTitles.includes(title)
    ? prev.keyClueTitles
    : [...prev.keyClueTitles, title];
  const hasRequiemMedium =
    prev.hasRequiemMedium ||
    /安魂曲|鎮魂|超渡曲|安魂/.test(title);
  return {
    ...prev,
    keyClueTitles,
    hasRequiemMedium: hasRequiemMedium || Boolean(isKeyClue && /安魂/.test(title)),
  };
}

export function noteNarrativeForWinProgress(
  prev: WinProgressFlags,
  narrative: string,
): WinProgressFlags {
  const t = narrative.trim();
  if (!t) return prev;
  let requiemPlayed = prev.requiemPlayed;
  let ritualCoreResolved = prev.ritualCoreResolved;

  if (
    !requiemPlayed &&
    (prev.hasRequiemMedium || /安魂曲/.test(t)) &&
    /(?:播放|按下|流淌出|迴盪).{0,24}安魂曲|安魂曲.{0,24}(?:播放|流淌|迴盪)|按下.{0,12}PLAY/i.test(
      t,
    )
  ) {
    requiemPlayed = true;
  }

  if (
    !ritualCoreResolved &&
    /(?:撥|扭|轉).{0,12}(?:指針|懷錶).{0,16}(?:12|十二)|指針.{0,12}(?:回到|撥至|指向).{0,8}(?:12|十二)|懷錶.{0,20}(?:平息|超渡|停止)/.test(
      t,
    )
  ) {
    ritualCoreResolved = true;
  }

  return { ...prev, requiemPlayed, ritualCoreResolved };
}

/** 若 Win 為 OR 且已達成一分支，卻宣告 bad_ending → 回傳警告文（否則 null） */
export function badEndingWinConflictWarning(input: {
  endingType: string;
  winningCondition: string;
  progress: WinProgressFlags;
}): string | null {
  const type = input.endingType.trim().toUpperCase();
  if (!/BAD/.test(type)) return null;
  if (!winConditionLooksLikeOr(input.winningCondition)) return null;

  const branches: string[] = [];
  if (input.progress.requiemPlayed) {
    branches.push("安魂曲／廣播超渡路徑似已完成");
  }
  if (input.progress.ritualCoreResolved) {
    branches.push("懷錶／核心儀式路徑似已完成");
  }
  if (!branches.length) return null;

  return (
    `結局覆核警告：winning_condition 含「或」分支，且偵測到（${branches.join("；")}），` +
    `但 GM 宣告了壞結局（${input.endingType}）。請確認是否誤把 OR 勝利條件改成 AND，或玩家尚未逃離。`
  );
}
