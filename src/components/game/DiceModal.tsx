import { useState } from "react";
import { Dices } from "lucide-react";
import type { AdvantageMode } from "@/engine/dice";
import { difficultyLabelWithHint } from "@/engine/skillCheck";
import { resolvePlayerDice } from "@/lib/pedelec/createGameSession";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/store/useGameStore";

/** 取代輸入框：公開擲骰檢定面板 */
export function DiceCheckPanel() {
  const pending = useGameStore((s) => s.pendingDice);
  const [mode, setMode] = useState<AdvantageMode>("normal");

  if (!pending || pending.isSecret) return null;

  const isD20 = pending.dice_type.toLowerCase().includes("d20");
  const modeLabel =
    mode === "advantage" ? "優勢" : mode === "disadvantage" ? "劣勢" : "一般";

  const cancel = () => {
    const resolver = useGameStore.getState().diceResolver;
    if (resolver) {
      resolver({
        request_id: pending.request_id,
        diceResult: 0,
        outcome: "CANCELLED",
        detail: "user_cancelled",
      });
      useGameStore.getState().clearDiceResolver();
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="rounded-md border border-accent/40 bg-surface-2 px-3 py-3">
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-accent-2">
          <Dices className="h-3.5 w-3.5" />
          擲骰檢定
        </div>
        <p className="text-sm text-ink">
          <strong>{pending.check_target_name}</strong>
          <span className="ml-2 tabular-nums text-muted">
            {pending.dice_type}
            {isD20 && mode !== "normal" ? ` · ${modeLabel}` : ""}
          </span>
        </p>
        {pending.skill_value != null && pending.target_value != null ? (
          <div className="mt-1 space-y-0.5 text-xs text-ink">
            <p>
              技能 {pending.skill_value}%
              {" · "}
              {difficultyLabelWithHint(pending.difficulty ?? "regular")}
            </p>
            <p>
              成功門檻{" "}
              <strong className="tabular-nums">≤ {pending.target_value}</strong>
              <span className="text-muted">
                （達標即過；骰得更低可達更高成功品質）
              </span>
            </p>
          </div>
        ) : pending.target_value != null ? (
          <p className="mt-1 text-xs text-muted">
            成功門檻：{pending.target_value}
          </p>
        ) : null}
        {pending.reason ? (
          <p className="mt-1 text-xs text-muted">{pending.reason}</p>
        ) : null}
      </div>

      {isD20 ? (
        <div className="flex flex-wrap gap-2">
          {(["normal", "advantage", "disadvantage"] as AdvantageMode[]).map(
            (m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "default" : "secondary"}
                onClick={() => setMode(m)}
              >
                {m === "normal"
                  ? "一般"
                  : m === "advantage"
                    ? "優勢"
                    : "劣勢"}
              </Button>
            ),
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-w-[8rem] flex-1 sm:flex-none"
          onClick={() => resolvePlayerDice({ advantageMode: mode })}
        >
          <Dices className="h-4 w-4" />
          擲 {pending.dice_type}
        </Button>
        <Button variant="ghost" size="sm" onClick={cancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

export function SecretRollNotice() {
  const active = useGameStore((s) => s.secretRollActive);
  if (!active) return null;
  return (
    <div className="rounded-md border border-accent-2/40 bg-surface-2 px-3 py-2 text-xs text-accent-2">
      GM 暗骰中…（點數對玩家隱藏）
    </div>
  );
}

export function RuleLookupToast() {
  const rule = useGameStore((s) => s.pendingRuleLookup);
  const setPending = useGameStore((s) => s.setPendingRuleLookup);
  if (!rule) return null;
  return (
    <div className="rounded-md border border-border bg-surface p-3 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <strong className="text-ink">規則：{rule.rule_topic}</strong>
        <button
          type="button"
          className="text-muted hover:text-ink"
          onClick={() => setPending(null)}
        >
          關閉
        </button>
      </div>
      <p className="text-muted">{rule.applied_reason}</p>
      <p className="mt-2 whitespace-pre-wrap text-ink/90">{rule.rule_reference_text}</p>
    </div>
  );
}
