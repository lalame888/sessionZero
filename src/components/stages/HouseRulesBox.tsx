import { COC_HOUSE_PRESETS, DND_HOUSE_PRESETS } from "@/prompts/gmDirectives";
import { Textarea, Label } from "@/components/ui/input";
import { useGameStore } from "@/store/useGameStore";

export function HouseRulesBox() {
  const systemId = useGameStore((s) => s.script.system_id);
  const houseRules = useGameStore((s) => s.houseRules);
  const togglePresetRule = useGameStore((s) => s.togglePresetRule);
  const setHouseRules = useGameStore((s) => s.setHouseRules);

  if (!systemId) return null;

  const presets = systemId === "DND_5E" ? DND_HOUSE_PRESETS : COC_HOUSE_PRESETS;

  return (
    <div className="space-y-3 rounded-lg border border-border/40 bg-bg/20 p-4">
      <div>
        <h3 className="brand-title text-sm text-ink">房規設定（House Rules）</h3>
        <p className="text-xs text-muted">
          房規永遠優先於 SRD。勾選預設或貼上自訂規則。
        </p>
      </div>

      <div className="space-y-2">
        {presets.map((rule) => (
          <label
            key={rule}
            className="flex items-start gap-2 text-sm text-ink"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={houseRules.preset_rules.includes(rule)}
              onChange={() => togglePresetRule(rule)}
            />
            <span>{rule}</span>
          </label>
        ))}
      </div>

      <div className="space-y-1">
        <Label htmlFor="custom-rules">自訂房規文字</Label>
        <Textarea
          id="custom-rules"
          value={houseRules.custom_rules_text}
          onChange={(e) =>
            setHouseRules({
              ...houseRules,
              custom_rules_text: e.target.value,
            })
          }
          placeholder="例如：短休可額外恢復 1 點幸運…"
          rows={3}
        />
      </div>
    </div>
  );
}
