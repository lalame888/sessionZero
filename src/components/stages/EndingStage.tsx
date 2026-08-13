import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Download,
  Eye,
  PackageMinus,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Button } from "@/components/ui/button";
import {
  buildAdventureRecord,
  buildAdventureSynopsis,
  captureStatSnapshot,
} from "@/engine/adventureDossier";
import { enrichCharacterSheetMeta } from "@/engine/creation";
import { rollDice } from "@/engine/dice";
import {
  proposeScenarioInventoryReturn,
  reasonLabelZh,
} from "@/engine/inventoryReturn";
import { requestStorySynopsis } from "@/lib/adventureSynopsis/requestStorySynopsis";
import { parseHistoryActorInput } from "@/lib/historySpeaker";
import { isCthulhuMythosSkillName } from "@/engine/mythosGrowth";
import { successQualityLabel } from "@/engine/skillCheck";
import { resolveAvailableProvider } from "@/lib/pedelec/resolveProvider";
import {
  clearPartyLibraryBindingsForCampaign,
  exportLibraryCharacterJson,
  getLibraryCharacter,
  saveLibraryCharacterWithAdventure,
} from "@/lib/storage";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";
import type { AdventureRecord } from "@/types/characterLibrary";

export function TimelineScrubber() {
  const history = useGameStore((s) => s.history);
  const timelineIndex = useGameStore((s) => s.timelineIndex);
  const setTimelineIndex = useGameStore((s) => s.setTimelineIndex);

  if (!history.length) {
    return <p className="text-sm text-muted">尚無歷史快照。</p>;
  }

  const idx = timelineIndex ?? history.length - 1;
  const entry = history[Math.max(0, Math.min(history.length - 1, idx))];
  const char = entry.snapshot.character;
  const actor = entry.playerInput?.trim()
    ? parseHistoryActorInput(entry.playerInput)
    : null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <h3 className="brand-title text-sm">時間軸拉桿（Timeline Scrubber）</h3>

      <input
        type="range"
        min={0}
        max={history.length - 1}
        value={idx}
        className="w-full"
        onChange={(e) => setTimelineIndex(Number(e.target.value))}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Turn {entry.turn} · {new Date(entry.timestamp).toLocaleString()}
        </span>
        <div className="flex flex-wrap gap-3">
          <span>
            {char.name?.trim() ? char.name : "（未命名）"}
            {char.role_title ? ` · ${char.role_title}` : ""}
          </span>
          <span>
            HP {char.derived.hp.current}/{char.derived.hp.max}
          </span>
          {char.derived.san ? (
            <span>
              SAN {char.derived.san.current}/{char.derived.san.max}
            </span>
          ) : null}
          <span>線索 {entry.snapshot.clues.length}</span>
          <span>NPC {entry.snapshot.npcs.length}</span>
        </div>
      </div>

      <div className="h-64 overflow-y-auto rounded-md border border-border/60 bg-bg/40 p-3">
        {actor ? (
          <p className="mb-3 whitespace-pre-wrap text-sm">
            <span
              className={cn(
                "font-medium",
                actor.kind === "companion" ? "text-accent" : "text-muted",
              )}
            >
              {actor.label}：
            </span>
            {actor.body}
          </p>
        ) : null}
        {entry.aiNarrative?.trim() ? (
          <div className="story-text text-sm">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
              GM
            </div>
            <MarkdownContent content={entry.aiNarrative} />
          </div>
        ) : null}
        {entry.diceRecord ? (
          <div className="mt-3 rounded bg-bg/50 p-2 text-xs">
            <div>
              骰子：{entry.diceRecord.skillName}{" "}
              {entry.diceRecord.isSecret ? "（原暗骰）" : ""}
            </div>
            <div>
              {entry.diceRecord.diceType} → {entry.diceRecord.diceResult}（
              {successQualityLabel(entry.diceRecord.outcome)}）
              {entry.diceRecord.targetValue != null
                ? ` / 門檻 ${entry.diceRecord.targetValue}`
                : ""}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StepBadge({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
        active
          ? "border-accent/50 bg-accent/10 text-ink"
          : done
            ? "border-border bg-surface-2 text-muted"
            : "border-border/60 text-muted/70",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
          active || done ? "bg-accent text-bg" : "bg-surface-2 text-muted",
        )}
      >
        {done && !active ? "✓" : n}
      </span>
      {label}
    </div>
  );
}

function findCareerRecord(
  characterId: string | undefined,
  campaignId: string,
): AdventureRecord | undefined {
  if (!characterId) return undefined;
  return getLibraryCharacter(characterId)?.career.find(
    (r) => r.campaignId === campaignId,
  );
}

export function EndingStage() {
  const ending = useGameStore((s) => s.ending);
  const script = useGameStore((s) => s.script);
  const character = useGameStore((s) => s.character);
  const characterSchema = useGameStore((s) => s.characterSchema);
  const characterBaseline = useGameStore((s) => s.characterBaseline);
  const campaignId = useGameStore((s) => s.campaignId);
  const clues = useGameStore((s) => s.clues);
  const madness = useGameStore((s) => s.madness);
  const party = useGameStore((s) => s.party);
  const endingCompanionsSavedIds = useGameStore(
    (s) => s.endingCompanionsSavedIds,
  );
  const endingCompanionsResolved = useGameStore(
    (s) => s.endingCompanionsResolved,
  );
  const resolveEndingCompanions = useGameStore(
    (s) => s.resolveEndingCompanions,
  );
  const endingCharacterSettled = useGameStore((s) => s.endingCharacterSettled);
  const applyGrowthResult = useGameStore((s) => s.applyGrowthResult);
  const appendSystem = useGameStore((s) => s.appendSystem);
  const markEndingCharacterSettled = useGameStore(
    (s) => s.markEndingCharacterSettled,
  );
  const selectedProvider = useGameStore((s) => s.selectedProvider);
  const selectedModel = useGameStore((s) => s.selectedModel);

  const careerRecord = useMemo(
    () => findCareerRecord(character?.id, campaignId),
    [character?.id, campaignId],
  );

  const alreadySettled = endingCharacterSettled || Boolean(careerRecord);

  const [growthLog, setGrowthLog] = useState<string[]>([]);
  const [settled, setSettled] = useState(alreadySettled);
  const [savedNotice, setSavedNotice] = useState<string | null>(
    alreadySettled ? "本場角色已結算並存檔，直接進入回放。" : null,
  );
  const [librarySaved, setLibrarySaved] = useState(alreadySettled);
  const [revealed, setRevealed] = useState(alreadySettled);
  const [synopsis, setSynopsis] = useState(careerRecord?.synopsis ?? "");
  const [synopsisReady, setSynopsisReady] = useState(
    Boolean(careerRecord?.synopsis),
  );
  const [synopsisGenerating, setSynopsisGenerating] = useState(false);
  const [synopsisError, setSynopsisError] = useState<string | null>(null);
  const [companionDecision, setCompanionDecision] = useState<
    Record<string, "save" | "skip">
  >({});
  const [companionGrowthById, setCompanionGrowthById] = useState<
    Record<string, string[]>
  >({});
  /** 結局回繳勾選：true = 寫入檔案庫前從背包移除 */
  const [returnSelected, setReturnSelected] = useState<Record<string, boolean>>(
    {},
  );
  const autoSynopsisStartedRef = useRef(false);

  const keyClueTitles = useMemo(
    () => clues.filter((c) => c.is_key_clue).map((c) => c.title),
    [clues],
  );
  const bibleKeyClues = script.hidden_full_script?.key_clues;

  const returnProposal = useMemo(() => {
    if (!character || settled) return null;
    return proposeScenarioInventoryReturn({
      inventory: character.inventory,
      baselineInventory: characterBaseline?.inventory ?? null,
      keyClues: bibleKeyClues ?? [],
      clueTitles: keyClueTitles,
    });
  }, [
    character,
    characterBaseline?.inventory,
    bibleKeyClues,
    keyClueTitles,
    settled,
  ]);

  const returnCandidateKey = returnProposal?.candidates.join("\0") ?? "";

  useEffect(() => {
    if (!returnProposal) return;
    setReturnSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const item of returnProposal.candidates) {
        next[item] = prev[item] ?? true;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以 candidate 字串為準，避免物件參考抖動
  }, [returnCandidateKey]);

  const selectedReturnItems = useMemo(() => {
    if (!returnProposal) return [] as string[];
    return returnProposal.candidates.filter(
      (item) => returnSelected[item] !== false,
    );
  }, [returnProposal, returnSelected]);

  const aiCompanions = useMemo(
    () => party.filter((m) => m.controller === "ai"),
    [party],
  );

  const decisionFor = (id: string): "save" | "skip" =>
    companionDecision[id] ??
    (endingCompanionsSavedIds.includes(id) ? "save" : "skip");

  /** 對指定隊員執行 CoC 成長檢定（與玩家相同規則），回傳成長紀錄。 */
  const runCocGrowthForMember = (memberId: string): string[] => {
    const sheet = useGameStore.getState().getSheetById(memberId);
    if (!sheet || sheet.system_id !== "COC_7E") {
      return sheet?.system_id === "DND_5E"
        ? [
            `依回合估算經驗：約 ${useGameStore.getState().turn * 50} XP（簡易結算）。`,
          ]
        : [];
    }
    const pending = [...(sheet.markedSkillsForGrowth ?? [])].filter(
      (s) => !isCthulhuMythosSkillName(s),
    );
    if (!pending.length) {
      return ["本局沒有可成長的標記技能。"];
    }
    const logs: string[] = [];
    for (const skill of pending) {
      const current =
        useGameStore.getState().getSheetById(memberId)?.skills[skill] ?? 0;
      const check = rollDice("1d100");
      if (check.total > current) {
        const gain = rollDice("1d10").total;
        applyGrowthResult(skill, gain, memberId);
        logs.push(`${skill}：成長檢定 ${check.total} > ${current} → +${gain}`);
      } else {
        logs.push(`${skill}：成長檢定 ${check.total} ≤ ${current} → 無成長`);
        applyGrowthResult(skill, 0, memberId);
      }
    }
    return logs;
  };

  /** 從角色卡剝離勾選的劇本物資；回傳實際移除清單。 */
  const applyInventoryReturns = (
    characterId: string,
    items: string[],
  ): string[] => {
    const unique = [...new Set(items.map((x) => x.trim()).filter(Boolean))];
    if (!unique.length) return [];
    useGameStore
      .getState()
      .applyStatChanges([], [], unique, characterId);
    return unique;
  };

  const saveCompanionToLibrary = (
    memberId: string,
    growthLogs: string[],
    statsBefore: ReturnType<typeof captureStatSnapshot>,
    statsAfter: ReturnType<typeof captureStatSnapshot>,
  ) => {
    const sheetRaw = useGameStore.getState().getSheetById(memberId);
    if (!sheetRaw?.name?.trim()) return false;
    const sheet = enrichCharacterSheetMeta(sheetRaw, characterSchema);
    const record = buildAdventureRecord({
      campaignId,
      scenarioTitle: script.public_summary?.title ?? "",
      systemId: sheet.system_id,
      ending,
      growthLog: growthLogs,
      clues,
      statsBefore,
      statsAfter,
    });
    saveLibraryCharacterWithAdventure(sheet, record);
    return true;
  };

  /** 結算一位 AI 隊友：成長檢定 → 關鍵物證回繳 → 可選寫入檔案庫 */
  const settleCompanionMember = (
    memberId: string,
    saveToLibrary: boolean,
  ): { name: string; growthLogs: string[]; saved: boolean } | null => {
    const beforeSheet = useGameStore.getState().getSheetById(memberId);
    if (!beforeSheet) return null;
    const name = beforeSheet.name?.trim() || "未命名";
    const madnessNow = useGameStore.getState().madness;
    const statsBefore = captureStatSnapshot(beforeSheet, madnessNow);
    const growthLogs = runCocGrowthForMember(memberId);
    const afterGrowth =
      useGameStore.getState().getSheetById(memberId) ?? beforeSheet;
    const companionReturn = proposeScenarioInventoryReturn({
      inventory: afterGrowth.inventory,
      baselineInventory: null,
      keyClues: bibleKeyClues ?? [],
      clueTitles: keyClueTitles,
    });
    const returned = applyInventoryReturns(
      memberId,
      companionReturn.candidates,
    );
    const logsWithReturn =
      returned.length > 0
        ? [...growthLogs, `劇本物資回繳：${returned.join("、")}`]
        : growthLogs;
    const afterSheet =
      useGameStore.getState().getSheetById(memberId) ?? afterGrowth;
    const statsAfter = captureStatSnapshot(afterSheet, madnessNow);
    let saved = false;
    if (saveToLibrary) {
      saved = saveCompanionToLibrary(
        memberId,
        logsWithReturn,
        statsBefore,
        statsAfter,
      );
    }
    return { name, growthLogs: logsWithReturn, saved };
  };

  // 再進入結局頁：略過結算，直接上帝視角／回放
  useEffect(() => {
    if (!alreadySettled) return;
    const record = findCareerRecord(
      useGameStore.getState().character?.id,
      campaignId,
    );
    if (record) {
      setGrowthLog(record.growthLog ?? []);
      if (record.synopsis) {
        setSynopsis(record.synopsis);
        setSynopsisReady(true);
      }
    }
    setSettled(true);
    setLibrarySaved(true);
    setRevealed(true);
    if (!useGameStore.getState().endingCharacterSettled) {
      markEndingCharacterSettled();
    }
  }, [alreadySettled, campaignId, markEndingCharacterSettled]);

  const marked = (character?.markedSkillsForGrowth ?? []).filter(
    (s) => !isCthulhuMythosSkillName(s),
  );
  const isCoc = character?.system_id === "COC_7E";
  const isDnd = character?.system_id === "DND_5E";
  const hasCharacter = Boolean(character?.name?.trim());

  const step = !settled ? "settle" : "reveal";

  const xpSummary = useMemo(() => {
    if (!isDnd) return null;
    const turns = useGameStore.getState().turn;
    const xp = turns * 50;
    return `依回合估算經驗：約 ${xp} XP（簡易結算）。可於下次 Session 自行調整等級。`;
  }, [isDnd]);

  const buildSynopsisText = (logs: string[]) => {
    const sheet = useGameStore.getState().character;
    if (!sheet) return "";
    const after = captureStatSnapshot(sheet, useGameStore.getState().madness);
    const before = useGameStore.getState().characterBaseline ?? after;
    return buildAdventureSynopsis({
      scenarioTitle: script.public_summary?.title ?? "",
      ending,
      growthLog: logs,
      statsBefore: before,
      statsAfter: after,
      keyClueTitles: clues.filter((c) => c.is_key_clue).map((c) => c.title),
    });
  };

  const sheetForSave = () => {
    const sheet = useGameStore.getState().character;
    if (!sheet) return null;
    return enrichCharacterSheetMeta(sheet, characterSchema);
  };

  const autoSaveCharacter = (logs: string[], synopsisText: string) => {
    const sheet = sheetForSave();
    if (!sheet?.name?.trim()) {
      setSavedNotice("角色卡缺少姓名，無法自動存入檔案庫。結算標記仍已寫入本場。");
      markEndingCharacterSettled();
      setLibrarySaved(false);
      setSettled(true);
      setRevealed(true);
      return false;
    }
    const after = captureStatSnapshot(sheet, useGameStore.getState().madness);
    const before = useGameStore.getState().characterBaseline ?? after;
    const record = buildAdventureRecord({
      campaignId,
      scenarioTitle: script.public_summary?.title ?? "",
      systemId: sheet.system_id,
      ending,
      growthLog: logs,
      clues,
      statsBefore: before,
      statsAfter: after,
      synopsisOverride: synopsisText,
    });
    useGameStore.setState({ boundCharacterId: null });
    saveLibraryCharacterWithAdventure(sheet, record);
    // 自庫帶入的 AI 隊友：結算時先解除占用；寫回與否由下方勾選決定
    clearPartyLibraryBindingsForCampaign(
      campaignId,
      useGameStore
        .getState()
        .party.filter((m) => m.controller === "ai" && m.fromLibrary)
        .map((m) => m.sheet.id),
    );
    markEndingCharacterSettled();
    setLibrarySaved(true);
    setSettled(true);
    setRevealed(true);
    setSavedNotice(
      `已自動存入檔案庫「${sheet.name}」（含本場履歷），並解除進行中綁定。`,
    );
    appendSystem(
      `結局結算：角色「${sheet.name}」已存入檔案庫（含履歷），並解除本場綁定。`,
    );
    return true;
  };

  /** 成長／無需成長／D&D：回繳勾選物資 → 結算存檔並解鎖回放 */
  const finishSettlement = (logs: string[]) => {
    const sheet = useGameStore.getState().character;
    const returned = sheet
      ? applyInventoryReturns(sheet.id, selectedReturnItems)
      : [];
    const logsWithReturn =
      returned.length > 0
        ? [...logs, `劇本物資回繳：${returned.join("、")}`]
        : logs;
    if (returned.length) {
      appendSystem(`結局結算：已回繳劇本物資 — ${returned.join("、")}`);
    }
    setGrowthLog(logsWithReturn);
    const text = buildSynopsisText(logsWithReturn);
    setSynopsis(text);
    setSynopsisReady(true);
    autoSaveCharacter(logsWithReturn, text);
  };

  const runCocGrowth = () => {
    const sheet = useGameStore.getState().character;
    if (!sheet) return;
    const pending = [...(sheet.markedSkillsForGrowth ?? [])].filter(
      (s) => !isCthulhuMythosSkillName(s),
    );
    if (!pending.length) {
      finishSettlement(["本局沒有可成長的標記技能。"]);
      return;
    }

    const logs: string[] = [];
    for (const skill of pending) {
      const current = useGameStore.getState().character?.skills[skill] ?? 0;
      const check = rollDice("1d100");
      if (check.total > current) {
        const gain = rollDice("1d10").total;
        applyGrowthResult(skill, gain, sheet.id);
        logs.push(`${skill}：成長檢定 ${check.total} > ${current} → +${gain}`);
      } else {
        logs.push(`${skill}：成長檢定 ${check.total} ≤ ${current} → 無成長`);
        applyGrowthResult(skill, 0, sheet.id);
      }
    }
    queueMicrotask(() => finishSettlement(logs));
  };

  const saveWithoutGrowth = () => {
    finishSettlement(["本局沒有可成長的標記技能。"]);
  };

  const confirmDndSettlement = () => {
    finishSettlement([xpSummary ?? "D&D 經驗結算完成。"]);
  };

  const handleUpdateSynopsis = () => {
    const sheet = sheetForSave();
    if (!sheet?.name?.trim()) {
      setSavedNotice("角色卡缺少姓名，無法更新履歷。");
      return;
    }
    const after = captureStatSnapshot(sheet, madness);
    const before = characterBaseline ?? after;
    const record = buildAdventureRecord({
      campaignId,
      scenarioTitle: script.public_summary?.title ?? "",
      systemId: sheet.system_id,
      ending,
      growthLog,
      clues,
      statsBefore: before,
      statsAfter: after,
      synopsisOverride: synopsis,
    });
    saveLibraryCharacterWithAdventure(sheet, record);
    setSavedNotice(`已更新「${sheet.name}」的本場履歷摘要。`);
  };

  const handleExport = () => {
    const sheet = sheetForSave();
    if (!sheet) {
      setSavedNotice("沒有可匯出的角色卡。");
      return;
    }
    const existing = getLibraryCharacter(sheet.id);
    if (existing) {
      exportLibraryCharacterJson(existing);
      setSavedNotice(
        `已下載履歷檔：「${sheet.name || "character"}-dossier.json」`,
      );
      return;
    }
    const after = captureStatSnapshot(sheet, madness);
    const before = characterBaseline ?? after;
    const record = buildAdventureRecord({
      campaignId,
      scenarioTitle: script.public_summary?.title ?? "",
      systemId: sheet.system_id,
      ending,
      growthLog,
      clues,
      statsBefore: before,
      statsAfter: after,
      synopsisOverride: synopsis,
    });
    exportLibraryCharacterJson({
      sheet,
      career: [record],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setSavedNotice(
      `已下載履歷檔：「${sheet.name || "character"}-dossier.json」`,
    );
  };

  const generateStorySynopsis = (opts?: {
    /** 寫回檔案庫（預設 true，當已結算存檔時） */
    persist?: boolean;
    /** 進場自動生成時的提示文案 */
    notice?: string;
  }) => {
    if (synopsisGenerating) return;
    setSynopsisError(null);
    setSynopsisGenerating(true);
    void (async () => {
      try {
        const { provider, model } = await resolveAvailableProvider({
          providerOverride: selectedProvider,
          modelOverride: selectedModel || undefined,
        });
        const text = await requestStorySynopsis({
          provider,
          model,
        });
        setSynopsis(text);
        setSynopsisReady(true);
        const shouldPersist = opts?.persist !== false;
        if (shouldPersist) {
          const sheet = sheetForSave();
          if (sheet?.name?.trim()) {
            const after = captureStatSnapshot(
              sheet,
              useGameStore.getState().madness,
            );
            const before =
              useGameStore.getState().characterBaseline ?? after;
            const record = buildAdventureRecord({
              campaignId,
              scenarioTitle: script.public_summary?.title ?? "",
              systemId: sheet.system_id,
              ending,
              growthLog,
              clues,
              statsBefore: before,
              statsAfter: after,
              synopsisOverride: text,
            });
            saveLibraryCharacterWithAdventure(sheet, record);
            setSavedNotice(
              opts?.notice ??
                "已自動填入本場履歷摘要並寫入檔案庫；可再編輯或按「重新生成」。",
            );
          } else {
            setSavedNotice(
              opts?.notice ??
                "已填入 AI 故事經歷總結；可編輯後按「更新履歷摘要」寫入檔案庫。",
            );
          }
        } else {
          setSavedNotice(
            opts?.notice ??
              "已填入 AI 故事經歷總結；可編輯後按「更新履歷摘要」寫入檔案庫。",
          );
        }
      } catch (e) {
        const msg =
          e instanceof Error && e.name === "AbortError"
            ? "已取消生成。"
            : e instanceof Error && e.message === "STORY_SYNOPSIS_EMPTY"
              ? "AI 未回傳有效總結，請再試一次。"
              : e instanceof Error && e.message === "NO_AVAILABLE_PROVIDER"
                ? "沒有可用的 Provider，請先完成 Pedelec 連線與設定。"
                : "生成失敗，請確認 Pedelec 連線後重試。";
        setSynopsisError(msg);
      } finally {
        setSynopsisGenerating(false);
      }
    })();
  };

  // 進入結局並完成結算後：若尚無履歷摘要，主動請 AI 生成一次
  useEffect(() => {
    if (!settled) return;
    if (autoSynopsisStartedRef.current) return;
    if (synopsisGenerating) return;

    const existing = (synopsis || careerRecord?.synopsis || "").trim();
    // 重開已結算場次且已有履歷 → 不自動重跑
    if (alreadySettled && existing) return;

    autoSynopsisStartedRef.current = true;
    generateStorySynopsis({
      persist: true,
      notice:
        "已自動生成本場履歷摘要；可編輯後按「更新履歷摘要」，或按「重新生成」再寫一次。",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在 settled 轉 true 時觸發一次
  }, [settled, alreadySettled]);

  return (
    <div className="space-y-4 overflow-y-auto p-1">
      <div className="flex flex-wrap gap-2">
        <StepBadge
          n={1}
          label="角色結算與存檔"
          active={step === "settle"}
          done={settled}
        />
        <StepBadge
          n={2}
          label="上帝視角與回放"
          active={step === "reveal"}
          done={revealed}
        />
      </div>

      <div className="rounded-lg border border-accent/40 bg-surface p-4">
        <div className="text-xs uppercase tracking-wide text-muted">結局</div>
        <h2 className="brand-title text-xl text-ink">
          {ending?.ending_title ?? "Session 結束"}
        </h2>
        <div className="mt-1 text-xs text-muted">{ending?.ending_type}</div>
        <div className="story-text mt-3 text-sm">
          <MarkdownContent content={ending?.ending_narrative ?? ""} />
        </div>
        {ending?.achievements?.length ? (
          <ul className="mt-3 list-disc pl-5 text-sm text-accent-2">
            {ending.achievements.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Step 1：結算＋自動存檔（已結算則不顯示操作） */}
      {!settled ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-accent" />
            <h3 className="brand-title text-sm">① 角色結算與存檔</h3>
          </div>
          <p className="text-xs text-muted">
            完成成長或確認結果後會自動將角色卡與本場履歷寫入檔案庫，並解鎖上帝視角與時間軸回放。劇本專屬物證／筆記可在下方勾選回繳，避免堆進檔案庫。
          </p>

          {character ? (
            <div className="rounded-md bg-bg/40 px-3 py-2 text-xs text-muted">
              <span className="text-ink">{character.name || "（未命名）"}</span>
              {character.role_title ? ` · ${character.role_title}` : ""}
              {isCoc && character.derived.san ? (
                <>
                  {" "}
                  · SAN {character.derived.san.current}/
                  {character.derived.san.max} · HP {character.derived.hp.current}
                  /{character.derived.hp.max}
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-danger">本局沒有角色卡資料。</p>
          )}

          {returnProposal && returnProposal.candidates.length > 0 ? (
            <div className="space-y-2 rounded-md border border-border/60 bg-bg/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PackageMinus className="h-4 w-4 text-accent" />
                  <h4 className="text-sm text-ink">劇本物資回繳</h4>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    type="button"
                    onClick={() =>
                      setReturnSelected(
                        Object.fromEntries(
                          returnProposal.candidates.map((i) => [i, true]),
                        ),
                      )
                    }
                  >
                    全選回繳
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    type="button"
                    onClick={() =>
                      setReturnSelected(
                        Object.fromEntries(
                          returnProposal.candidates.map((i) => [i, false]),
                        ),
                      )
                    }
                  >
                    全部保留
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted">
                勾選的物品會在存入檔案庫前從背包移除（履歷仍會記錄本場曾持有）。預設回繳「本場取得」與「關鍵物證／筆記」。
              </p>
              <ul className="space-y-1.5">
                {returnProposal.candidates.map((item) => {
                  const reasons = returnProposal.reasons[item] ?? [];
                  const checked = returnSelected[item] !== false;
                  return (
                    <li key={item}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-surface-2/60">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={(e) =>
                            setReturnSelected((prev) => ({
                              ...prev,
                              [item]: e.target.checked,
                            }))
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-ink">{item}</span>
                          {reasons.length ? (
                            <span className="mt-0.5 block text-[10px] text-muted">
                              {reasons.map(reasonLabelZh).join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-muted">
                將回繳 {selectedReturnItems.length}／
                {returnProposal.candidates.length} 件
                {returnProposal.keep.length
                  ? `；另保留起始裝備等 ${returnProposal.keep.length} 件`
                  : ""}
                。
              </p>
            </div>
          ) : character?.inventory.length ? (
            <p className="text-[11px] text-muted">
              背包無可自動辨識的劇本物資（本場新增或關鍵物證）；若有私人紀念品會原樣寫入檔案庫。
            </p>
          ) : null}

          {isCoc ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                待成長技能：
                {marked.length ? marked.join("、") : "無"}
              </p>
              <div className="flex flex-wrap gap-2">
                {marked.length ? (
                  <Button size="sm" onClick={runCocGrowth}>
                    執行成長檢定
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!hasCharacter}
                    onClick={saveWithoutGrowth}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    儲存角色結果，繼續
                  </Button>
                )}
              </div>
            </div>
          ) : null}

          {isDnd ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">{xpSummary}</p>
              <Button
                size="sm"
                disabled={!hasCharacter}
                onClick={confirmDndSettlement}
              >
                <Archive className="h-3.5 w-3.5" />
                儲存角色結果，繼續
              </Button>
            </div>
          ) : null}

          {!isCoc && !isDnd ? (
            <Button
              size="sm"
              disabled={!hasCharacter}
              onClick={() => finishSettlement([])}
            >
              <Archive className="h-3.5 w-3.5" />
              儲存角色結果，繼續
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-accent" />
            <h3 className="brand-title text-sm">① 角色結算與存檔</h3>
            <span className="text-xs text-accent-2">已完成</span>
          </div>
          {growthLog.length ? (
            <ul className="space-y-1 rounded-md border border-border/60 bg-bg/30 p-2 text-xs">
              {growthLog.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          {synopsisReady ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  本場履歷摘要（故事來龍去脈，可編輯後更新）
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1"
                  disabled={synopsisGenerating}
                  title="依本場遊玩紀錄生成情節總結（不含成長／數值）"
                  onClick={() => generateStorySynopsis()}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {synopsisGenerating
                    ? "生成中…"
                    : "AI 生成故事經歷總結"}
                </Button>
              </div>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="故事經歷了什麼、關鍵轉折與結局……（成長與戰利品另有紀錄）"
              />
              {synopsisError ? (
                <p className="text-xs text-danger">{synopsisError}</p>
              ) : (
                <p className="text-[11px] text-muted">
                  此欄放情節摘要；技能成長、數值變化與線索另見上方成長紀錄／履歷欄位。
                </p>
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {librarySaved ? (
              <Button size="sm" variant="secondary" onClick={handleUpdateSynopsis}>
                更新履歷摘要
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              disabled={!character}
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              匯出履歷 JSON
            </Button>
          </div>
          {savedNotice ? (
            <p className="text-xs text-accent-2">{savedNotice}</p>
          ) : null}
        </div>
      )}

      {settled && aiCompanions.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="brand-title text-sm">AI 隊友結算與檔案庫</h3>
          {endingCompanionsResolved ? (
            <div className="space-y-2 text-xs text-muted">
              <p>
                {(() => {
                  const saved = aiCompanions.filter((m) =>
                    endingCompanionsSavedIds.includes(m.id),
                  );
                  const skipped = aiCompanions.length - saved.length;
                  if (!saved.length) return "已全部略過檔案庫寫入。";
                  const names = saved
                    .map((m) => `「${m.sheet.name || "未命名"}」`)
                    .join("、");
                  return skipped > 0
                    ? `已寫回／存入 ${names}（含成長與履歷）；其餘 ${skipped} 位略過寫入。`
                    : `已寫回／存入 ${names}（含成長與履歷）。`;
                })()}
              </p>
              {aiCompanions.map((m) => {
                const logs = companionGrowthById[m.id];
                if (!logs?.length) return null;
                return (
                  <div key={m.id} className="rounded-md bg-bg/30 px-2 py-1.5">
                    <div className="text-ink">
                      {m.sheet.name || "未命名"} · 成長紀錄
                    </div>
                    <ul className="mt-1 list-disc pl-4">
                      {logs.map((l, i) => (
                        <li key={`${m.id}-g-${i}`}>{l}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <p className="text-xs text-muted">
                AI 隊友比照玩家結算：確認時會先做成長檢定（CoC）／經驗摘要（D&amp;D），自動回繳對應關鍵物證的背包物品，再依選擇寫入檔案庫（含本場履歷）或略過寫入。
              </p>
              <ul className="space-y-2">
                {aiCompanions.map((m) => {
                  const fromLib = Boolean(m.fromLibrary);
                  const choice = decisionFor(m.id);
                  const saveLabel = fromLib
                    ? "寫回檔案庫（含履歷）"
                    : "存入檔案庫（含履歷）";
                  const pending = (m.sheet.markedSkillsForGrowth ?? []).filter(
                    (s) => !isCthulhuMythosSkillName(s),
                  );
                  return (
                    <li
                      key={m.id}
                      className="space-y-2 rounded-md border border-border/60 bg-bg/30 px-3 py-2 text-xs"
                    >
                      <div className="text-ink">
                        {m.sheet.name || "（未命名）"}
                        <span className="text-muted">
                          {" "}
                          · {m.sheet.role_title || m.roleHint || "—"}
                          {fromLib ? " · 自庫帶入" : " · 本場新建"}
                        </span>
                      </div>
                      {m.sheet.system_id === "COC_7E" ? (
                        <p className="text-muted">
                          {pending.length
                            ? `待成長技能：${pending.join("、")}`
                            : "本局無可成長標記技能"}
                        </p>
                      ) : m.sheet.system_id === "DND_5E" ? (
                        <p className="text-muted">將記錄簡易經驗摘要</p>
                      ) : null}
                      <div className="flex flex-wrap gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 text-ink">
                          <input
                            type="radio"
                            name={`companion-lib-${m.id}`}
                            checked={choice === "save"}
                            onChange={() =>
                              setCompanionDecision((prev) => ({
                                ...prev,
                                [m.id]: "save",
                              }))
                            }
                          />
                          {saveLabel}
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-ink">
                          <input
                            type="radio"
                            name={`companion-lib-${m.id}`}
                            checked={choice === "skip"}
                            onChange={() =>
                              setCompanionDecision((prev) => ({
                                ...prev,
                                [m.id]: "skip",
                              }))
                            }
                          />
                          略過寫入（仍會做成長結算）
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const growthMap: Record<string, string[]> = {};
                    const savedNames: string[] = [];
                    const grownOnly: string[] = [];
                    for (const m of aiCompanions) {
                      const save = decisionFor(m.id) === "save";
                      const result = settleCompanionMember(m.id, save);
                      if (!result) continue;
                      growthMap[m.id] = result.growthLogs;
                      if (result.saved) savedNames.push(result.name);
                      else grownOnly.push(result.name);
                    }
                    setCompanionGrowthById(growthMap);
                    resolveEndingCompanions({
                      savedIds: aiCompanions
                        .filter((m) => decisionFor(m.id) === "save")
                        .map((m) => m.id),
                    });
                    const parts = [
                      savedNames.length
                        ? `已寫入 ${savedNames.map((n) => `「${n}」`).join("、")}（含成長與履歷）`
                        : null,
                      grownOnly.length
                        ? `已成長結算但未寫庫：${grownOnly.map((n) => `「${n}」`).join("、")}`
                        : null,
                    ].filter(Boolean);
                    const notice =
                      parts.length > 0
                        ? parts.join("；") + "。"
                        : "AI 隊友結算完成。";
                    setSavedNotice(notice);
                    appendSystem(`結局：AI 隊友 ${notice}`);
                  }}
                >
                  <Archive className="h-3.5 w-3.5" />
                  確認選擇（含成長）
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const growthMap: Record<string, string[]> = {};
                    for (const m of aiCompanions) {
                      const result = settleCompanionMember(m.id, false);
                      if (result) growthMap[m.id] = result.growthLogs;
                    }
                    setCompanionGrowthById(growthMap);
                    setCompanionDecision(
                      Object.fromEntries(
                        aiCompanions.map((m) => [m.id, "skip" as const]),
                      ),
                    );
                    resolveEndingCompanions({ savedIds: [] });
                    setSavedNotice(
                      "已為全部 AI 隊友完成成長結算，並略過檔案庫寫入。",
                    );
                    appendSystem(
                      "結局：AI 隊友已成長結算，全部略過檔案庫寫入。",
                    );
                  }}
                >
                  全部略過寫入（仍成長）
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Step 2：上帝視角 + 時間軸（結算完成後顯示） */}
      {revealed ? (
        <>
          {script.hidden_full_script ? (
            <div className="rounded-lg border border-accent/30 bg-bg/40 p-4">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-accent" />
                <h3 className="brand-title text-sm text-ink">
                  ② 上帝視角：隱藏真相
                </h3>
              </div>
              <div className="story-text mt-2 text-sm">
                <MarkdownContent
                  content={script.hidden_full_script.truth_and_secrets}
                />
              </div>
              <div className="mt-2 text-xs text-muted">
                關鍵線索：{script.hidden_full_script.key_clues.join("、")}
              </div>
              <div className="mt-1 text-xs text-muted">
                勝利條件：{script.hidden_full_script.winning_condition}
              </div>
              {script.hidden_full_script.failure_consequences ? (
                <div className="mt-1 text-xs text-muted">
                  失敗後果：{script.hidden_full_script.failure_consequences}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">沒有可揭曉的隱藏劇本資料。</p>
          )}
          <TimelineScrubber />
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 bg-surface/40 p-4 text-center text-xs text-muted">
          完成上方結算與存檔後，將解鎖上帝視角與時間軸回放。
        </div>
      )}
    </div>
  );
}
