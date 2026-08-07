import { useMemo, useState } from "react";
import { ArrowLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CONTINUITY_DURATION_LABELS,
  CONTINUITY_MODE_HINTS,
  CONTINUITY_MODE_LABELS,
  lastCareerEndingType,
  normalizeContinuityChoice,
  previewContinuityRecovery,
  suggestContinuityBridge,
  type ContinuityBridgeChoice,
  type ContinuityDuration,
  type ContinuityMode,
} from "@/engine/continuityBridge";
import type { LibraryCharacter } from "@/types/characterLibrary";
import type { UniversalCharacterSheet } from "@/types/game";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

const MODES: ContinuityMode[] = ["continual", "interlude", "fresh"];
const DURATIONS: ContinuityDuration[] = [
  "breath",
  "overnight",
  "days",
  "weeks",
];

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
  const existingBridge = useGameStore((s) => s.continuityBridge);
  const applyContinuityToLibrarySheet = useGameStore(
    (s) => s.applyContinuityToLibrarySheet,
  );

  const [sheet, setSheet] = useState<UniversalCharacterSheet>(() => ({
    ...entry.sheet,
    inventory: [...entry.sheet.inventory],
  }));

  const suggested = useMemo(
    () => suggestContinuityBridge(lastCareerEndingType(entry.career)),
    [entry.career],
  );

  const [choice, setChoice] = useState<ContinuityBridgeChoice>(() => {
    if (existingBridge) {
      return normalizeContinuityChoice({
        mode: existingBridge.mode,
        duration: existingBridge.duration,
      });
    }
    return normalizeContinuityChoice(suggested);
  });

  const partyBridgeLocked = Boolean(existingBridge);

  const preview = useMemo(
    () =>
      previewContinuityRecovery(
        entry.sheet,
        normalizeContinuityChoice(choice),
      ),
    [entry.sheet, choice],
  );

  const scriptProtagonistRole = useGameStore(
    (s) => s.script.public_summary?.protagonist_role,
  );

  const recentCareer = useMemo(
    () => entry.career.slice(0, 2),
    [entry.career],
  );

  const roleMismatchHint = useMemo(() => {
    if (!asPlayer) return null;
    const scriptRole = scriptProtagonistRole?.trim() ?? "";
    if (!scriptRole) return null;
    const cardRole = [
      sheet.role_title,
      sheet.profile_coc?.occupation,
      sheet.profile_dnd?.class_name,
    ]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join("／");
    if (!cardRole) return null;
    const norm = (s: string) => s.replace(/\s/g, "");
    const a = norm(scriptRole);
    const b = norm(cardRole);
    if (a === b || a.includes(b) || b.includes(a)) return null;
    // 任一卡面稱謂與劇本定位互相包含即視為對齊
    const parts = cardRole.split("／").map(norm).filter(Boolean);
    if (parts.some((p) => a.includes(p) || p.includes(a))) return null;
    return { scriptRole, cardRole };
  }, [
    asPlayer,
    scriptProtagonistRole,
    sheet.role_title,
    sheet.profile_coc?.occupation,
    sheet.profile_dnd?.class_name,
  ]);

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
    const narrative = { ...sheet, inventory };
    const recovered = applyContinuityToLibrarySheet(
      {
        ...entry.sheet,
        name: narrative.name,
        role_title: narrative.role_title,
        appearance: narrative.appearance,
        personal_bio: narrative.personal_bio,
        inventory,
      },
      normalizeContinuityChoice(choice),
    );
    // 保留上場前微調；數值以銜接恢復為準
    const next: UniversalCharacterSheet = {
      ...recovered,
      appearance: narrative.appearance,
      personal_bio: narrative.personal_bio,
      inventory,
      name: narrative.name,
      role_title: narrative.role_title,
    };

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
    const modeLabel =
      CONTINUITY_MODE_LABELS[normalizeContinuityChoice(choice).mode];
    appendSystem(
      asPlayer
        ? `已帶入調查員「${next.name}」至席次 ${editingPartySlotIndex + 1}（${modeLabel}；開始冒險後將佔用此卡）。`
        : `已帶入「${next.name}」至席次 ${editingPartySlotIndex + 1} 作為 AI 隊友（${modeLabel}；將佔用此卡；結局可選是否寫回檔案庫）。`,
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

        {roleMismatchHint ? (
          <p className="mt-2 rounded-md border border-border/80 bg-bg/40 px-2.5 py-2 text-[11px] text-muted">
            劇本主角定位是「{roleMismatchHint.scriptRole}」，此卡較偏「
            {roleMismatchHint.cardRole}
            」。可開打；GM 應依實際職業／技能適配場景，勿硬拗成原定民俗學者等設定。
          </p>
        ) : null}

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

      <div className="space-y-3 rounded-lg border border-accent/25 bg-accent/5 p-4">
        <h4 className="brand-title text-sm">幕間銜接</h4>
        <p className="text-xs text-muted">
          {partyBridgeLocked
            ? "本場已選定銜接模式（全隊共用）。可改選；開打時會以檔案庫原數值重新套用同一模式。"
            : "依上一場結局已建議預設。地城連場選「連續冒險」；結案後再接新案選「幕間」。"}
        </p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={choice.mode === mode ? "default" : "secondary"}
              onClick={() =>
                setChoice((c) =>
                  normalizeContinuityChoice({
                    mode,
                    duration:
                      mode === "interlude"
                        ? c.duration ?? suggested.duration ?? "days"
                        : null,
                  }),
                )
              }
            >
              {CONTINUITY_MODE_LABELS[mode]}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted">{CONTINUITY_MODE_HINTS[choice.mode]}</p>
        {choice.mode === "interlude" ? (
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={choice.duration === d ? "default" : "ghost"}
                onClick={() =>
                  setChoice({ mode: "interlude", duration: d })
                }
              >
                {CONTINUITY_DURATION_LABELS[d]}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="rounded-md border border-border/60 bg-bg/50 px-3 py-2 text-xs text-ink">
          <div className="text-muted">恢復預覽（相對檔案庫）</div>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {preview.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-2 text-muted">
            上場後 → HP {preview.sheet.derived.hp.current}/
            {preview.sheet.derived.hp.max}
            {preview.sheet.derived.san
              ? ` · SAN ${preview.sheet.derived.san.current}/${preview.sheet.derived.san.max}`
              : ""}
            {preview.sheet.derived.mp_or_slots
              ? ` · MP/資源 ${preview.sheet.derived.mp_or_slots.current}/${preview.sheet.derived.mp_or_slots.max}`
              : ""}
          </div>
        </div>
      </div>

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
