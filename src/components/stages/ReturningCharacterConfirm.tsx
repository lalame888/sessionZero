import { useMemo, useState } from "react";
import { ArrowLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryCharacter } from "@/types/characterLibrary";
import type { UniversalCharacterSheet } from "@/types/game";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

export function ReturningCharacterConfirm({
  entry,
  onBack,
  onAssigned,
  asPlayer = true,
}: {
  entry: LibraryCharacter;
  onBack: () => void;
  /** 多人隊伍：帶入後回呼，不立刻開打 */
  onAssigned?: () => void;
  /** false = AI 隊友席（仍佔用原卡；結局可選寫回） */
  asPlayer?: boolean;
}) {
  const setCharacter = useGameStore((s) => s.setCharacter);
  const upsertPartyMemberAtSlot = useGameStore(
    (s) => s.upsertPartyMemberAtSlot,
  );
  const editingPartySlotIndex = useGameStore((s) => s.editingPartySlotIndex);
  const partySize = useGameStore((s) => s.partySize);
  const setPlayerMemberSlot = useGameStore((s) => s.setPlayerMemberSlot);
  const confirmCharacterAndPlay = useGameStore((s) => s.confirmCharacterAndPlay);
  const appendSystem = useGameStore((s) => s.appendSystem);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const isTyping = useGameStore((s) => s.isTyping);

  const [sheet, setSheet] = useState<UniversalCharacterSheet>(() => ({
    ...entry.sheet,
    inventory: [...entry.sheet.inventory],
  }));

  const recentCareer = useMemo(
    () => entry.career.slice(0, 2),
    [entry.career],
  );

  const skillPreview = useMemo(() => {
    return Object.entries(sheet.skills)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [sheet.skills]);

  const updateField = <K extends keyof UniversalCharacterSheet>(
    key: K,
    value: UniversalCharacterSheet[K],
  ) => {
    setSheet((s) => ({ ...s, [key]: value }));
  };

  const inventoryText = sheet.inventory.join("\n");

  const canConfirm =
    Boolean(sheet.name.trim()) &&
    sessionStatus === "idle" &&
    !isTyping;

  const handleConfirm = () => {
    const inventory = inventoryText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const next = { ...sheet, inventory };

    if (asPlayer) {
      setPlayerMemberSlot(editingPartySlotIndex);
      upsertPartyMemberAtSlot(editingPartySlotIndex, next, {
        controller: "player",
        creationComplete: true,
        fromLibrary: true,
      });
    } else {
      upsertPartyMemberAtSlot(editingPartySlotIndex, next, {
        controller: "ai",
        creationComplete: true,
        fromLibrary: true,
      });
    }
    setCharacter(next);
    appendSystem(
      asPlayer
        ? `已帶入調查員「${next.name}」至席次 ${editingPartySlotIndex + 1}（沿用既有屬性／技能；開始冒險後將佔用此卡）。`
        : `已帶入「${next.name}」至席次 ${editingPartySlotIndex + 1} 作為 AI 隊友（將佔用此卡；結局可選是否寫回檔案庫）。`,
    );
    if (partySize <= 1) {
      confirmCharacterAndPlay();
    } else {
      appendSystem("請繼續完成其餘席次後再開始冒險。");
      onAssigned?.();
    }
  };

  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" />
        返回選擇
      </Button>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="brand-title text-lg text-ink">{sheet.name}</h3>
        <p className="mt-1 text-sm text-muted">
          {sheet.role_title || "—"} · {sheet.system_id}
          {entry.career.length
            ? ` · 履歷 ${entry.career.length} 場`
            : " · 尚無履歷"}
        </p>

        <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
          {sheet.derived.san ? (
            <div>
              SAN {sheet.derived.san.current}/{sheet.derived.san.max}
            </div>
          ) : null}
          <div>
            HP {sheet.derived.hp.current}/{sheet.derived.hp.max}
          </div>
          {Object.entries(sheet.attributes)
            .slice(0, 8)
            .map(([k, v]) => (
              <div key={k}>
                {k} {v}
              </div>
            ))}
        </div>

        {skillPreview.length ? (
          <div className="mt-3">
            <div className="text-xs text-muted">主要技能（唯讀）</div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
              {skillPreview.map(([name, val]) => (
                <li key={name}>
                  {name} {val}%
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {recentCareer.length ? (
        <div className="rounded-lg border border-border/80 p-3">
          <h4 className="text-xs font-medium text-muted">近期冒險</h4>
          <ul className="mt-2 space-y-2">
            {recentCareer.map((r) => (
              <li
                key={r.id}
                className="rounded-md bg-bg/40 px-3 py-2 text-xs text-ink"
              >
                <div className="font-medium">
                  《{r.scenarioTitle}》· {r.endingType}
                </div>
                <p className="mt-1 text-muted">{r.synopsis}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3 rounded-lg border border-border p-4">
        <h4 className="brand-title text-sm">上場前微調</h4>
        <p className="text-xs text-muted">
          屬性與技能沿用檔案庫數值（不重擲、不重配點）。可調整外貌、簡介與背包。
        </p>
        <label className="block space-y-1 text-xs">
          <span className="text-muted">外貌</span>
          <textarea
            className="min-h-[64px] w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            value={sheet.appearance ?? ""}
            onChange={(e) => updateField("appearance", e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted">個人簡介</span>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            value={sheet.personal_bio ?? ""}
            onChange={(e) => updateField("personal_bio", e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted">背包（每行一項）</span>
          <textarea
            className="min-h-[88px] w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            value={inventoryText}
            onChange={(e) =>
              updateField(
                "inventory",
                e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
              )
            }
          />
        </label>
      </div>

      <Button
        className={cn("w-full sm:w-auto")}
        disabled={!canConfirm}
        onClick={handleConfirm}
      >
        <Play className="h-4 w-4" />
        {partySize > 1 ? "確認帶入此席次" : "確認上場，開始冒險"}
      </Button>
      {!canConfirm && sessionStatus !== "idle" ? (
        <p className="text-xs text-muted">Session 未就緒，請稍候再上場。</p>
      ) : null}
    </div>
  );
}
