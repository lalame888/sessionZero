import type {
  AdventureRecord,
  CharacterStatSnapshot,
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

function formatPair(
  label: string,
  before: number | undefined,
  after: number | undefined,
): string | null {
  if (before == null && after == null) return null;
  if (before === after) return null;
  return `${label} ${before ?? "—"}→${after ?? "—"}`;
}

/**
 * 依結局與數值快照組出壓縮履歷文字（不呼叫 AI）。
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

  const parts: string[] = [
    `《${title}》· ${endingType}${endingTitle ? `「${endingTitle}」` : ""}`,
  ];

  const growthGains = input.growthLog.filter((l) => /→\s*\+/.test(l));
  if (growthGains.length) {
    parts.push(
      `本場成長：${growthGains
        .map((l) => {
          const m = l.match(/^(.+?)：.+→\s*\+(\d+)/);
          return m ? `${m[1]} +${m[2]}` : l;
        })
        .join("；")}`,
    );
  } else if (input.growthLog.some((l) => l.includes("無成長"))) {
    parts.push("本場無技能成長");
  }

  const sanLine = formatPair(
    "SAN",
    input.statsBefore.san?.current,
    input.statsAfter.san?.current,
  );
  const hpLine = formatPair(
    "HP",
    input.statsBefore.hp.current,
    input.statsAfter.hp.current,
  );
  const vital = [sanLine, hpLine].filter(Boolean);
  if (vital.length) parts.push(vital.join("；"));

  if (input.keyClueTitles.length) {
    parts.push(
      `關鍵線索：${input.keyClueTitles.slice(0, 6).join("、")}${
        input.keyClueTitles.length > 6 ? "…" : ""
      }`,
    );
  }

  if (input.ending?.achievements?.length) {
    parts.push(`成就：${input.ending.achievements.slice(0, 4).join("、")}`);
  }

  return parts.join("。") + "。";
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
