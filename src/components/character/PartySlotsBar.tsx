import { Check, Pencil, UserRound } from "lucide-react";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createBlankCharacter } from "@/engine/formulas";

export function PartySlotsBar({
  onEditSlot,
}: {
  /** 進入該席完整創角（數值＋敘事） */
  onEditSlot?: (slot: number) => void;
}) {
  const partySize = useGameStore((s) => s.partySize);
  const party = useGameStore((s) => s.party);
  const editingPartySlotIndex = useGameStore((s) => s.editingPartySlotIndex);
  const playerMemberId = useGameStore((s) => s.playerMemberId);
  const script = useGameStore((s) => s.script);
  const setEditingPartySlotIndex = useGameStore(
    (s) => s.setEditingPartySlotIndex,
  );
  const setPlayerMemberSlot = useGameStore((s) => s.setPlayerMemberSlot);
  const upsertPartyMemberAtSlot = useGameStore(
    (s) => s.upsertPartyMemberAtSlot,
  );

  if (partySize <= 1) return null;

  const hints = script.party_role_hints ?? [];
  const systemId =
    script.system_id === "DND_5E" ? "DND_5E" : "COC_7E";

  const readyCount = party.filter((m) => m.creationComplete).length;

  const selectSlot = (slot: number) => {
    const member = party.find((m) => m.slotIndex === slot);
    const isPlayer =
      member?.controller === "player" ||
      (!member &&
        playerMemberId == null &&
        slot === 0 &&
        !party.some((m) => m.controller === "player"));
    const hint =
      member?.roleHint ||
      hints[slot]?.role_title ||
      (slot === 0 ? script.public_summary?.protagonist_role : undefined);
    if (!member) {
      const blank = createBlankCharacter(systemId);
      if (hint) blank.role_title = hint;
      upsertPartyMemberAtSlot(slot, blank, {
        controller: isPlayer ? "player" : "ai",
        roleHint: hint,
        resetCreationMeta: true,
      });
    }
    setEditingPartySlotIndex(slot);
  };

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-border bg-surface/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="brand-title text-sm text-ink">
          隊伍成員（{readyCount}/{partySize} 已就緒）
        </h3>
        <p className="text-[11px] text-muted">
          新建角點「創建」；檔案庫角色點「編輯」調幕間銜接；指定「我扮演」後其餘為 AI 隊友
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: partySize }, (_, slot) => {
          const member = party.find((m) => m.slotIndex === slot);
          const isPlayer =
            member?.controller === "player" ||
            (!member &&
              playerMemberId == null &&
              slot === 0 &&
              !party.some((m) => m.controller === "player"));
          const done = Boolean(member?.creationComplete);
          const fromLibrary = Boolean(member?.fromLibrary);
          const hint =
            member?.roleHint ||
            hints[slot]?.role_title ||
            (slot === 0 ? script.public_summary?.protagonist_role : undefined);
          const active = editingPartySlotIndex === slot;
          const initial = (member?.sheet.name?.trim()?.[0] ?? "").toUpperCase();
          return (
            <div
              key={slot}
              role="button"
              tabIndex={0}
              onClick={() => selectSlot(slot)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectSlot(slot);
                }
              }}
              className={cn(
                "cursor-pointer rounded-md border p-2 text-left text-xs transition-colors",
                active && done && "border-emerald-500/55 bg-emerald-500/10 ring-1 ring-emerald-500/25",
                active && !done && "border-accent/50 bg-accent/10 ring-1 ring-accent/20",
                !active && done && "border-emerald-600/40 bg-emerald-950/25",
                !active && !done && "border-dashed border-border/80 bg-bg/30",
              )}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-sm font-semibold",
                    done
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-border/70 bg-surface-2 text-muted",
                  )}
                  aria-hidden
                >
                  {done ? (
                    initial ? (
                      initial
                    ) : (
                      <Check className="h-4 w-4" />
                    )
                  ) : (
                    <UserRound className="h-4 w-4 opacity-70" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink">
                      隊員{slot + 1}
                      {done
                        ? ` · ${member!.sheet.name}`
                        : member?.sheet.name?.trim()
                          ? ` · ${member.sheet.name}（未完成配點）`
                          : " · 尚未建角"}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          done
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-surface-2 text-muted",
                        )}
                      >
                        {done ? "已就緒" : "待完成"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-6 cursor-pointer px-1.5 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectSlot(slot);
                          onEditSlot?.(slot);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        {fromLibrary ? "編輯" : done ? "編輯" : "創建"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        isPlayer
                          ? "bg-accent/20 text-accent-2"
                          : "bg-surface-2 text-muted",
                      )}
                    >
                      {isPlayer ? "玩家" : "AI"}
                    </span>
                    {done && member?.sheet.role_title ? (
                      <span className="truncate text-[10px] text-muted">
                        {member.sheet.role_title}
                      </span>
                    ) : null}
                  </div>
                  {!done && hint ? (
                    <p className="mt-1 text-muted line-clamp-2">{hint}</p>
                  ) : null}
                  {done && fromLibrary ? (
                    <p className="mt-1 text-[10px] text-emerald-400/90">
                      已帶入檔案庫角色（編輯可調幕間銜接）
                    </p>
                  ) : done ? (
                    <p className="mt-1 text-[10px] text-emerald-400/90">
                      角色設定已保存（含屬性／技能配點）
                    </p>
                  ) : member?.sheet.name?.trim() ? (
                    <p className="mt-1 text-[10px] text-amber-400/90">
                      敘事可能已有，但尚未完成配點與確認
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={isPlayer ? "default" : "secondary"}
                  className="h-6 cursor-pointer text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlayerMemberSlot(slot);
                  }}
                >
                  設為我扮演
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
