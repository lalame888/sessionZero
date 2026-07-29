import { useMemo, useState } from "react";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Button } from "@/components/ui/button";
import { rollDice } from "@/engine/dice";
import { useGameStore } from "@/store/useGameStore";

export function TimelineScrubber() {
  const history = useGameStore((s) => s.history);
  const timelineIndex = useGameStore((s) => s.timelineIndex);
  const setTimelineIndex = useGameStore((s) => s.setTimelineIndex);

  if (!history.length) {
    return <p className="text-sm text-muted">尚無歷史快照。</p>;
  }

  const idx = timelineIndex ?? history.length - 1;
  const entry = history[Math.max(0, Math.min(history.length - 1, idx))];

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
      <div className="text-xs text-muted">
        Turn {entry.turn} · {new Date(entry.timestamp).toLocaleString()}
      </div>
      {entry.playerInput ? (
        <p className="text-sm">
          <span className="text-muted">玩家：</span>
          {entry.playerInput}
        </p>
      ) : null}
      <div className="story-text text-sm">
        <MarkdownContent content={entry.aiNarrative} />
      </div>
      {entry.diceRecord ? (
        <div className="rounded bg-bg/50 p-2 text-xs">
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
      <div className="grid gap-2 text-xs md:grid-cols-3">
        <div>
          HP {entry.snapshot.character.derived.hp.current}/
          {entry.snapshot.character.derived.hp.max}
        </div>
        <div>線索 {entry.snapshot.clues.length}</div>
        <div>NPC {entry.snapshot.npcs.length}</div>
      </div>
    </div>
  );
}

export function EndingStage() {
  const ending = useGameStore((s) => s.ending);
  const script = useGameStore((s) => s.script);
  const character = useGameStore((s) => s.character);
  const applyGrowthResult = useGameStore((s) => s.applyGrowthResult);
  const [growthLog, setGrowthLog] = useState<string[]>([]);

  const marked = character?.markedSkillsForGrowth ?? [];
  const isCoc = character?.system_id === "COC_7E";
  const isDnd = character?.system_id === "DND_5E";

  const xpSummary = useMemo(() => {
    if (!isDnd) return null;
    const turns = useGameStore.getState().turn;
    const xp = turns * 50;
    return `依回合估算經驗：約 ${xp} XP（簡易結算）。可於下次 Session 自行調整等級。`;
  }, [isDnd]);

  const runCocGrowth = () => {
    if (!character) return;
    const logs: string[] = [];
    for (const skill of marked) {
      const current = character.skills[skill] ?? 0;
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
    setGrowthLog(logs);
  };

  return (
    <div className="space-y-4 overflow-y-auto p-1">
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

      {script.hidden_full_script ? (
        <div className="rounded-lg border border-border bg-bg/40 p-4">
          <h3 className="brand-title text-sm text-ink">上帝視角：隱藏真相</h3>
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
        </div>
      ) : null}

      {isCoc ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="brand-title text-sm">CoC 技能成長</h3>
          <p className="text-xs text-muted">
            標記技能：{marked.length ? marked.join("、") : "無"}
          </p>
          <Button size="sm" disabled={!marked.length} onClick={runCocGrowth}>
            執行成長檢定
          </Button>
          <ul className="space-y-1 text-xs">
            {growthLog.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isDnd ? (
        <div className="rounded-lg border border-border p-3 text-sm">
          <h3 className="brand-title text-sm">D&D 經驗結算</h3>
          <p className="mt-2 text-muted">{xpSummary}</p>
        </div>
      ) : null}

      <TimelineScrubber />
    </div>
  );
}
