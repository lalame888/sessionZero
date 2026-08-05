import { useMemo, useState } from "react";
import { Archive, Download, Eye, ScrollText } from "lucide-react";
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
  exportLibraryCharacterJson,
  getLibraryCharacter,
  saveLibraryCharacterWithAdventure,
  clearCharacterActiveCampaign,
} from "@/lib/storage";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";
import type { LibraryCharacter } from "@/types/characterLibrary";

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

type EndingStep = "settle" | "save" | "reveal";

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

export function EndingStage() {
  const ending = useGameStore((s) => s.ending);
  const script = useGameStore((s) => s.script);
  const character = useGameStore((s) => s.character);
  const characterSchema = useGameStore((s) => s.characterSchema);
  const characterBaseline = useGameStore((s) => s.characterBaseline);
  const campaignId = useGameStore((s) => s.campaignId);
  const clues = useGameStore((s) => s.clues);
  const madness = useGameStore((s) => s.madness);
  const applyGrowthResult = useGameStore((s) => s.applyGrowthResult);
  const appendSystem = useGameStore((s) => s.appendSystem);

  const [growthLog, setGrowthLog] = useState<string[]>([]);
  const [settled, setSettled] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [librarySaved, setLibrarySaved] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [synopsis, setSynopsis] = useState("");
  const [synopsisReady, setSynopsisReady] = useState(false);

  const marked = character?.markedSkillsForGrowth ?? [];
  const isCoc = character?.system_id === "COC_7E";
  const isDnd = character?.system_id === "DND_5E";
  const hasCharacter = Boolean(character?.name?.trim());

  const step: EndingStep = !settled ? "settle" : !revealed ? "save" : "reveal";

  const xpSummary = useMemo(() => {
    if (!isDnd) return null;
    const turns = useGameStore.getState().turn;
    const xp = turns * 50;
    return `依回合估算經驗：約 ${xp} XP（簡易結算）。可於下次 Session 自行調整等級。`;
  }, [isDnd]);

  const ensureSynopsis = (logs: string[]) => {
    if (synopsisReady) return;
    const sheet = useGameStore.getState().character;
    if (!sheet) return;
    const after = captureStatSnapshot(sheet, useGameStore.getState().madness);
    const before =
      useGameStore.getState().characterBaseline ??
      after;
    const text = buildAdventureSynopsis({
      scenarioTitle: script.public_summary?.title ?? "",
      ending,
      growthLog: logs,
      statsBefore: before,
      statsAfter: after,
      keyClueTitles: clues.filter((c) => c.is_key_clue).map((c) => c.title),
    });
    setSynopsis(text);
    setSynopsisReady(true);
  };

  const sheetForSave = () => {
    if (!character) return null;
    return enrichCharacterSheetMeta(character, characterSchema);
  };

  const buildRecordAndEntry = (): {
    entry: LibraryCharacter;
    recordId: string;
  } | null => {
    const sheet = sheetForSave();
    if (!sheet?.name?.trim()) return null;
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
    const existing = getLibraryCharacter(sheet.id);
    const prior = (existing?.career ?? []).filter(
      (r) => r.campaignId !== record.campaignId,
    );
    return {
      entry: {
        sheet,
        career: [record, ...prior],
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      },
      recordId: record.id,
    };
  };

  const runCocGrowth = () => {
    const sheet = useGameStore.getState().character;
    if (!sheet) return;
    const pending = [...(sheet.markedSkillsForGrowth ?? [])];
    if (!pending.length) {
      const logs = ["本局沒有可成長的標記技能。"];
      setGrowthLog(logs);
      setSettled(true);
      ensureSynopsis(logs);
      return;
    }

    const logs: string[] = [];
    const skills = { ...sheet.skills };
    for (const skill of pending) {
      const current = skills[skill] ?? 0;
      const check = rollDice("1d100");
      if (check.total > current) {
        const gain = rollDice("1d10").total;
        skills[skill] = current + gain;
        applyGrowthResult(skill, gain);
        logs.push(`${skill}：成長檢定 ${check.total} > ${current} → +${gain}`);
      } else {
        logs.push(`${skill}：成長檢定 ${check.total} ≤ ${current} → 無成長`);
        applyGrowthResult(skill, 0);
      }
    }
    setGrowthLog(logs);
    setSettled(true);
    // 等 store 更新後再組 synopsis
    queueMicrotask(() => ensureSynopsis(logs));
  };

  const skipGrowth = () => {
    const logs = marked.length
      ? ["已略過成長檢定（標記技能保留至下次手動結算）。"]
      : ["本局沒有可成長的標記技能。"];
    setGrowthLog(logs);
    setSettled(true);
    ensureSynopsis(logs);
  };

  const confirmDndSettlement = () => {
    const logs = [xpSummary ?? "D&D 經驗結算完成。"];
    setGrowthLog(logs);
    setSettled(true);
    ensureSynopsis(logs);
  };

  const handleSaveLibrary = () => {
    const built = buildRecordAndEntry();
    if (!built) {
      setSavedNotice("角色卡缺少姓名，無法存入檔案庫。");
      return;
    }
    const record = built.entry.career[0]!;
    saveLibraryCharacterWithAdventure(built.entry.sheet, record);
    // 解除 Session ↔ 角色雙向綁定（履歷已寫入角色卡）
    useGameStore.setState({ boundCharacterId: null });
    setLibrarySaved(true);
    setSavedNotice(
      `已存入檔案庫「${built.entry.sheet.name}」（含本場履歷）。角色已解除進行中綁定，可帶入新劇本。`,
    );
    appendSystem(
      `結局結算：角色「${built.entry.sheet.name}」已存入檔案庫（含履歷），並解除本場綁定。`,
    );
  };

  const handleExport = () => {
    const built = buildRecordAndEntry();
    if (!built) {
      setSavedNotice("沒有可匯出的角色卡。");
      return;
    }
    exportLibraryCharacterJson(built.entry);
    setSavedNotice(
      `已下載履歷檔：「${built.entry.sheet.name || "character"}-dossier.json」`,
    );
  };

  const revealTruth = (skipSave: boolean) => {
    if (skipSave && !librarySaved) {
      const sheet = useGameStore.getState().character;
      if (sheet?.id) {
        clearCharacterActiveCampaign(sheet.id);
        useGameStore.setState({ boundCharacterId: null });
      }
      setSavedNotice(
        "已略過履歷存檔並解除進行中綁定。本場壓縮經歷未寫入檔案庫；之後仍可於此頁補存。",
      );
    }
    setRevealed(true);
  };

  return (
    <div className="space-y-4 overflow-y-auto p-1">
      <div className="flex flex-wrap gap-2">
        <StepBadge n={1} label="角色結算" active={step === "settle"} done={settled} />
        <StepBadge
          n={2}
          label="儲存角色卡"
          active={step === "save"}
          done={revealed}
        />
        <StepBadge
          n={3}
          label="上帝視角"
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

      {/* Step 1：角色結算 */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-accent" />
          <h3 className="brand-title text-sm">① 角色結算</h3>
        </div>
        <p className="text-xs text-muted">
          請先完成成長／經驗結算（比照 CoC 幕間成長）。結算後可將履歷寫入檔案庫，再揭曉幕後真相。
        </p>

        {character ? (
          <div className="rounded-md bg-bg/40 px-3 py-2 text-xs text-muted">
            <span className="text-ink">{character.name || "（未命名）"}</span>
            {character.role_title ? ` · ${character.role_title}` : ""}
            {isCoc && character.derived.san ? (
              <>
                {" "}
                · SAN {character.derived.san.current}/{character.derived.san.max}
                {" "}
                · HP {character.derived.hp.current}/{character.derived.hp.max}
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
            {!settled ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!marked.length}
                  onClick={runCocGrowth}
                >
                  執行成長檢定
                </Button>
                <Button size="sm" variant="secondary" onClick={skipGrowth}>
                  {marked.length ? "略過成長，繼續" : "無需成長，繼續"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-accent-2">結算完成。</p>
            )}
          </div>
        ) : null}

        {isDnd ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">{xpSummary}</p>
            {!settled ? (
              <Button size="sm" onClick={confirmDndSettlement}>
                確認經驗結算
              </Button>
            ) : (
              <p className="text-xs text-accent-2">結算完成。</p>
            )}
          </div>
        ) : null}

        {!isCoc && !isDnd ? (
          <Button
            size="sm"
            disabled={settled}
            onClick={() => {
              setSettled(true);
              ensureSynopsis([]);
            }}
          >
            確認結算
          </Button>
        ) : null}

        {growthLog.length ? (
          <ul className="space-y-1 rounded-md border border-border/60 bg-bg/30 p-2 text-xs">
            {growthLog.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Step 2：儲存角色卡 */}
      <div
        className={cn(
          "space-y-3 rounded-lg border p-4",
          settled ? "border-border" : "border-border/40 opacity-50",
        )}
      >
        <div className="flex items-center gap-2">
          <Archive className="h-4 w-4 text-accent" />
          <h3 className="brand-title text-sm">② 儲存角色卡與履歷</h3>
        </div>
        {!settled ? (
          <p className="text-xs text-muted">請先完成上方角色結算。</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              將結算後數值與壓縮冒險履歷寫入本機檔案庫，之後可在新劇本帶入同一角色繼續冒險。
            </p>
            <label className="block space-y-1 text-xs">
              <span className="text-muted">本場履歷摘要（可編輯）</span>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink"
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="結算後自動產生摘要…"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!hasCharacter}
                onClick={handleSaveLibrary}
              >
                <Archive className="h-3.5 w-3.5" />
                存入檔案庫（含本場履歷）
              </Button>
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
            {!revealed ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={() => revealTruth(false)}>
                  <Eye className="h-3.5 w-3.5" />
                  揭曉幕後真相（上帝視角）
                </Button>
                {!librarySaved ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revealTruth(true)}
                  >
                    稍後再存，先揭曉
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Step 3：上帝視角 + 時間軸 */}
      {revealed ? (
        <>
          {script.hidden_full_script ? (
            <div className="rounded-lg border border-accent/30 bg-bg/40 p-4">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-accent" />
                <h3 className="brand-title text-sm text-ink">
                  ③ 上帝視角：隱藏真相
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
          上帝視角與時間軸回放將在完成結算後解鎖。
        </div>
      )}
    </div>
  );
}
