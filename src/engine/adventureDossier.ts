import type {
  AdventureRecord,
  CharacterStatSnapshot,
  EndingSettlementController,
  EndingSettlementMember,
  StatDeltaRow,
} from "@/types/characterLibrary";
import type {
  ClueItem,
  EndingState,
  GameSystemID,
  MadnessStatus,
  UniversalCharacterSheet,
} from "@/types/game";

export function captureStatSnapshot(
  sheet: UniversalCharacterSheet,
  madness?: MadnessStatus | null,
): CharacterStatSnapshot {
  return {
    attributes: { ...sheet.attributes },
    skills: { ...sheet.skills },
    hp: {
      current: sheet.derived.hp.current,
      max: sheet.derived.hp.max,
    },
    ...(sheet.derived.san
      ? {
          san: {
            current: sheet.derived.san.current,
            max: sheet.derived.san.max,
          },
        }
      : {}),
    ...(sheet.derived.mp_or_slots
      ? {
          mp_or_slots: {
            current: sheet.derived.mp_or_slots.current,
            max: sheet.derived.mp_or_slots.max,
          },
        }
      : {}),
    inventory: [...sheet.inventory],
    madnessActive: madness?.active ?? false,
    madnessName: madness?.active ? madness.name : undefined,
  };
}

export function computeStatDeltas(
  before: CharacterStatSnapshot,
  after: CharacterStatSnapshot,
): StatDeltaRow[] {
  const rows: StatDeltaRow[] = [];

  const attrKeys = new Set([
    ...Object.keys(before.attributes),
    ...Object.keys(after.attributes),
  ]);
  for (const key of [...attrKeys].sort()) {
    const b = before.attributes[key] ?? 0;
    const a = after.attributes[key] ?? 0;
    rows.push({
      group: "attribute",
      key,
      before: b,
      after: a,
      changed: b !== a,
    });
  }

  const skillKeys = new Set([
    ...Object.keys(before.skills),
    ...Object.keys(after.skills),
  ]);
  for (const key of [...skillKeys].sort()) {
    const b = before.skills[key] ?? 0;
    const a = after.skills[key] ?? 0;
    rows.push({
      group: "skill",
      key,
      before: b,
      after: a,
      changed: b !== a,
    });
  }

  const pushDerived = (
    key: string,
    b: number | undefined,
    a: number | undefined,
  ) => {
    if (b == null && a == null) return;
    const bv = b ?? 0;
    const av = a ?? 0;
    rows.push({
      group: "derived",
      key,
      before: bv,
      after: av,
      changed: bv !== av,
    });
  };

  pushDerived("HP", before.hp.current, after.hp.current);
  pushDerived("HP_MAX", before.hp.max, after.hp.max);
  pushDerived("SAN", before.san?.current, after.san?.current);
  pushDerived("SAN_MAX", before.san?.max, after.san?.max);
  pushDerived("MP", before.mp_or_slots?.current, after.mp_or_slots?.current);

  return rows;
}

/** 只回傳有變化的列；若全無變化則回傳空陣列 */
export function changedStatDeltas(
  before: CharacterStatSnapshot,
  after: CharacterStatSnapshot,
): StatDeltaRow[] {
  return computeStatDeltas(before, after).filter((r) => r.changed);
}

/**
 * 履歷摘要 stub：只點出劇本／結局走向，不含成長與數值增減。
 * 正式故事來龍去脈請用「AI 生成故事經歷總結」。
 */
export function buildAdventureSynopsis(input: {
  scenarioTitle: string;
  ending: EndingState | null;
  growthLog: string[];
  statsBefore: CharacterStatSnapshot;
  statsAfter: CharacterStatSnapshot;
  keyClueTitles: string[];
}): string {
  const title = input.scenarioTitle.trim() || "未命名劇本";
  const endingType = input.ending?.ending_type ?? "結束";
  const endingTitle = input.ending?.ending_title?.trim();
  const narrative = input.ending?.ending_narrative?.replace(/\s+/g, " ").trim();

  if (narrative) {
    const stub = narrative.slice(0, 220);
    return `《${title}》· ${endingType}${endingTitle ? `「${endingTitle}」` : ""}。${stub}${narrative.length > 220 ? "…" : ""}`;
  }

  return `《${title}》· ${endingType}${endingTitle ? `「${endingTitle}」` : ""}。請使用「AI 生成故事經歷總結」補上本場來龍去脈。`;
}

export function buildAdventureRecord(input: {
  campaignId: string;
  scenarioTitle: string;
  systemId: GameSystemID;
  ending: EndingState | null;
  growthLog: string[];
  clues: ClueItem[];
  statsBefore: CharacterStatSnapshot;
  statsAfter: CharacterStatSnapshot;
  synopsisOverride?: string;
}): AdventureRecord {
  const keyCluesFound = input.clues
    .filter((c) => c.is_key_clue)
    .map((c) => c.title);
  const synopsis =
    input.synopsisOverride?.trim() ||
    buildAdventureSynopsis({
      scenarioTitle: input.scenarioTitle,
      ending: input.ending,
      growthLog: input.growthLog,
      statsBefore: input.statsBefore,
      statsAfter: input.statsAfter,
      keyClueTitles: keyCluesFound,
    });

  return {
    id: crypto.randomUUID(),
    campaignId: input.campaignId,
    playedAt: Date.now(),
    scenarioTitle: input.scenarioTitle.trim() || "未命名劇本",
    systemId: input.systemId,
    endingType: input.ending?.ending_type ?? "結束",
    endingTitle: input.ending?.ending_title ?? "",
    synopsis,
    achievements: input.ending?.achievements ?? [],
    keyCluesFound,
    growthLog: [...input.growthLog],
    statsBefore: input.statsBefore,
    statsAfter: input.statsAfter,
  };
}

/** 結局頁／replay 顯示：成長骰 + 回繳列 */
export function endingSettlementDisplayLog(
  member: Pick<EndingSettlementMember, "growthLog" | "inventoryReturned">,
): string[] {
  const returned = member.inventoryReturned
    .map((x) => x.trim())
    .filter(Boolean);
  return [
    ...member.growthLog,
    ...(returned.length ? [`劇本物資回繳：${returned.join("、")}`] : []),
  ];
}

/** 從履歷 growthLog 拆出回繳行（舊結算只寫在同一陣列裡） */
export function splitGrowthLogAndReturns(log: string[] | undefined | null): {
  growthLog: string[];
  inventoryReturned: string[];
} {
  const growthLog: string[] = [];
  const inventoryReturned: string[] = [];
  for (const line of log ?? []) {
    const m = /^劇本物資回繳：(.+)$/.exec(line.trim());
    if (m) {
      inventoryReturned.push(
        ...m[1]
          .split(/[、,，]/)
          .map((x) => x.trim())
          .filter(Boolean),
      );
    } else if (line.trim()) {
      growthLog.push(line);
    }
  }
  return { growthLog, inventoryReturned };
}

/** 用檔案庫履歷回填戰役 endingSettlement（舊場次補匯出 replay） */
export function endingSettlementMemberFromCareer(input: {
  characterId: string;
  name: string;
  controller: EndingSettlementController;
  systemId: GameSystemID;
  record: AdventureRecord;
}): EndingSettlementMember {
  const { growthLog, inventoryReturned } = splitGrowthLogAndReturns(
    input.record.growthLog,
  );
  return {
    characterId: input.characterId,
    name: input.name,
    controller: input.controller,
    systemId: input.systemId,
    growthLog,
    inventoryReturned,
    statsBefore: input.record.statsBefore,
    statsAfter: input.record.statsAfter,
    savedToLibrary: true,
  };
}
