import { useState } from "react";
import type { AdvantageMode } from "@/engine/dice";
import { resolvePlayerDice } from "@/lib/pedelec/createGameSession";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useGameStore } from "@/store/useGameStore";

export function DiceModal() {
  const pending = useGameStore((s) => s.pendingDice);
  const open = Boolean(pending && !pending.isSecret);
  const [mode, setMode] = useState<AdvantageMode>("normal");

  if (!pending || pending.isSecret) return null;

  const isD20 = pending.dice_type.toLowerCase().includes("d20");

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          // Do not dismiss without resolving — cancel via resolve with cancel path
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
        }
      }}
      title="擲骰檢定"
    >
      <div className="space-y-4 text-sm">
        <p className="text-ink">
          <strong>{pending.check_target_name}</strong>（{pending.dice_type}）
        </p>
        <p className="text-muted">{pending.reason}</p>
        {pending.target_value != null ? (
          <p className="text-muted">目標值：{pending.target_value}</p>
        ) : null}
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
        <Button
          className="w-full"
          onClick={() => resolvePlayerDice({ advantageMode: mode })}
        >
          擲骰
        </Button>
      </div>
    </Modal>
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
