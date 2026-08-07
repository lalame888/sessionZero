/**
 * CoC／通用：HP 歸零、重傷、SAN 崩潰的最低限度引擎後果（不含完整戰鬥回合）。
 */

export type CombatAftermathKind =
  | "major_wound"
  | "hp_zero"
  | "san_zero";

export interface CombatStatSnapshot {
  name: string;
  isPlayerPc: boolean;
  hpBefore: number;
  hpAfter: number;
  hpMax: number;
  sanBefore?: number | null;
  sanAfter?: number | null;
}

export interface CombatAftermathNotice {
  kind: CombatAftermathKind;
  message: string;
}

export interface CombatAftermathResult {
  notices: CombatAftermathNotice[];
  /** 玩家 PC HP≤0 時建議手動壞結局 */
  offerBadEnding?: {
    title: string;
    narrative: string;
    ending_type: "BAD_ENDING";
  };
}

/** 單次傷害 ≥ ceil(maxHP/2) 視為重傷（Major Wound 門檻） */
export function isMajorWound(damageTaken: number, hpMax: number): boolean {
  if (damageTaken <= 0 || hpMax <= 0) return false;
  return damageTaken >= Math.ceil(hpMax / 2);
}

export function evaluateCombatStatAftermath(
  snap: CombatStatSnapshot,
): CombatAftermathResult {
  const notices: CombatAftermathNotice[] = [];
  const who = snap.name.trim() || "角色";
  const damageTaken = Math.max(0, snap.hpBefore - snap.hpAfter);

  if (isMajorWound(damageTaken, snap.hpMax) && snap.hpAfter > 0) {
    notices.push({
      kind: "major_wound",
      message: `重傷警示（${who}）：本次傷害 ${damageTaken} ≥ 最大 HP 一半（${Math.ceil(snap.hpMax / 2)}）。依 CoC 7e 應進行體質（CON）檢定；失敗則昏迷／失去行動，GM 必須敘事並暫停該角色行動。`,
    });
  }

  if (snap.hpAfter <= 0 && snap.hpBefore > 0) {
    notices.push({
      kind: "hp_zero",
      message: snap.isPlayerPc
        ? `瀕死／死亡（${who}）：HP 已歸零。該角色失去行動；玩家 PC 不得硬拗 TRUE_ENDING，應走向死亡／被救但結局降級的 BAD_ENDING。`
        : `倒下（${who}）：HP 已歸零，該角色失去行動。`,
    });
  }

  const sanBefore = snap.sanBefore ?? null;
  const sanAfter = snap.sanAfter ?? null;
  if (
    sanAfter != null &&
    sanBefore != null &&
    sanAfter <= 0 &&
    sanBefore > 0
  ) {
    notices.push({
      kind: "san_zero",
      message: `理智崩潰（${who}）：SAN 已歸零。應觸發永久瘋狂／崩潰結局（BAD_ENDING 或同等）；禁止繼續當正常通關。`,
    });
  }

  let offerBadEnding: CombatAftermathResult["offerBadEnding"];
  if (snap.isPlayerPc && snap.hpAfter <= 0 && snap.hpBefore > 0) {
    offerBadEnding = {
      title: `${who}的終結`,
      narrative: `${who}的傷勢已無法支撐：HP 歸零。調查之路在此中斷——或僅剩他人收拾殘局。這是壞結局。`,
      ending_type: "BAD_ENDING",
    };
  } else if (
    snap.isPlayerPc &&
    sanAfter != null &&
    sanBefore != null &&
    sanAfter <= 0 &&
    sanBefore > 0
  ) {
    offerBadEnding = {
      title: `${who}的崩潰`,
      narrative: `${who}的理智已完全崩潰（SAN 歸零）。世界對其而言已無可挽回地扭曲——這是壞結局。`,
      ending_type: "BAD_ENDING",
    };
  }

  return { notices, offerBadEnding };
}
