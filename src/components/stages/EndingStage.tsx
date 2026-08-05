import { useEffect, useMemo, useState } from "react";
import { Archive, Download, Eye, ScrollText, Sparkles } from "lucide-react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Button } from "@/components/ui/button";
import {
  buildAdventureRecord,
  buildAdventureSynopsis,
  captureStatSnapshot,
} from "@/engine/adventureDossier";
import { enrichCharacterSheetMeta } from "@/engine/creation";
import { rollDice } from "@/engine/dice";
import { requestStorySynopsis } from "@/lib/adventureSynopsis/requestStorySynopsis";
import { resolveAvailableProvider } from "@/lib/pedelec/resolveProvider";
import {
  clearPartyLibraryBindingsForCampaign,
  exportLibraryCharacterJson,
  getLibraryCharacter,
  saveCharacterToLibrary,
  saveLibraryCharacterWithAdventure,
  writeBackLibraryCharacterSheet,
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
        {entry.playerInput ? (
          <p className="mb-3 text-sm">
            <span className="text-muted">玩家：</span>
            {entry.playerInput}
          </p>
        ) : null}
        <div className="story-text text-sm">
          <MarkdownContent content={entry.aiNarrative} />
        </div>
        {entry.diceRecord ? (
          <div className="mt-3 rounded bg-bg/50 p-2 text-xs">
            <div>
              骰子：{entry.diceRecord.skillName}{" "}
              {entry.diceRecord.isSecret ? "（原暗骰，現已揭曉）" : ""}
            </div>
            <div>
              {entry.diceRecord.diceType} → {entry.diceRecord.diceResult}（
              {entry.diceRecord.outcome}）
              {entry.diceRecord.targetValue != null
                ? ` / 目標 ${entry.diceRecord.targetValue}`
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
  const markCompanionsSaved = useGameStore((s) => s.markCompanionsSaved);
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
  const [companionSavePick, setCompanionSavePick] = useState<
    Record<string, boolean>
  >({});

  const aiCompanions = useMemo(
    () => party.filter((m) => m.controller === "ai"),
    [party],
  );

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

  const marked = character?.markedSkillsForGrowth ?? [];
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

  /** 成長／無需成長／D&D：結算後一律自動存檔並解鎖回放 */
  const finishSettlement = (logs: string[]) => {
    setGrowthLog(logs);
    const text = buildSynopsisText(logs);
    setSynopsis(text);
    setSynopsisReady(true);
    autoSaveCharacter(logs, text);
  };

  const runCocGrowth = () => {
    const sheet = useGameStore.getState().character;
    if (!sheet) return;
    const pending = [...(sheet.markedSkillsForGrowth ?? [])];
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
        applyGrowthResult(skill, gain);
        logs.push(`${skill}：成長檢定 ${check.total} > ${current} → +${gain}`);
      } else {
        logs.push(`${skill}：成長檢定 ${check.total} ≤ ${current} → 無成長`);
        applyGrowthResult(skill, 0);
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

  const generateStorySynopsis = () => {
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
        setSavedNotice(
          "已填入 AI 故事經歷總結；可編輯後按「更新履歷摘要」寫入檔案庫。",
        );
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
            完成成長或確認結果後會自動將角色卡與本場履歷寫入檔案庫，並解鎖上帝視角與時間軸回放。
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
                  onClick={generateStorySynopsis}
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
          <h3 className="brand-title text-sm">AI 隊友與檔案庫</h3>
          <p className="text-xs text-muted">
            自庫帶入者：勾選可將本場數值寫回檔案庫（占用已於結算解除）。新建者：勾選可存入檔案庫供之後帶入。
          </p>
          <ul className="space-y-2">
            {aiCompanions.map((m) => {
              const already = endingCompanionsSavedIds.includes(m.id);
              const fromLib = Boolean(m.fromLibrary);
              const checked = companionSavePick[m.id] ?? already;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-bg/30 px-3 py-2 text-xs"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={already}
                      checked={checked}
                      onChange={(e) =>
                        setCompanionSavePick((prev) => ({
                          ...prev,
                          [m.id]: e.target.checked,
                        }))
                      }
                    />
                    <span className="text-ink">
                      {m.sheet.name || "（未命名）"}
                      <span className="text-muted">
                        {" "}
                        · {m.sheet.role_title || m.roleHint || "—"}
                        {fromLib ? " · 自庫帶入" : " · 本場新建"}
                      </span>
                    </span>
                  </label>
                  {already ? (
                    <span className="text-accent-2">
                      {fromLib ? "已寫回" : "已存入"}
                    </span>
                  ) : (
                    <span className="text-muted">
                      {fromLib ? "寫回檔案庫" : "存入檔案庫"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            disabled={
              !aiCompanions.some(
                (m) =>
                  (companionSavePick[m.id] ?? false) &&
                  !endingCompanionsSavedIds.includes(m.id),
              )
            }
            onClick={() => {
              const toSave = aiCompanions.filter(
                (m) =>
                  (companionSavePick[m.id] ?? false) &&
                  !endingCompanionsSavedIds.includes(m.id),
              );
              if (!toSave.length) return;
              const written: string[] = [];
              const created: string[] = [];
              for (const m of toSave) {
                const enriched = enrichCharacterSheetMeta(
                  m.sheet,
                  characterSchema,
                );
                if (m.fromLibrary) {
                  writeBackLibraryCharacterSheet(enriched);
                  written.push(m.sheet.name || "未命名");
                } else {
                  saveCharacterToLibrary(enriched);
                  created.push(m.sheet.name || "未命名");
                }
              }
              const ids = [
                ...endingCompanionsSavedIds,
                ...toSave.map((m) => m.id),
              ];
              markCompanionsSaved(ids);
              const parts = [
                written.length
                  ? `已寫回 ${written.map((n) => `「${n}」`).join("、")}`
                  : null,
                created.length
                  ? `已存入 ${created.map((n) => `「${n}」`).join("、")}`
                  : null,
              ].filter(Boolean);
              setSavedNotice(parts.join("；") + "。");
              appendSystem(`結局：AI 隊友 ${parts.join("；")}。`);
            }}
          >
            <Archive className="h-3.5 w-3.5" />
            套用勾選
          </Button>
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
