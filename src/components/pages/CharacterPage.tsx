import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Library, Play, Sparkles, UserPlus } from "lucide-react";
import { PartySlotsBar } from "@/components/character/PartySlotsBar";
import { CharacterStage } from "@/components/stages/CharacterStage";
import { ReturningCharacterConfirm } from "@/components/stages/ReturningCharacterConfirm";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { loadCampaignIndex } from "@/lib/campaignStorage";
import { getLibraryCharacter, loadLibraryCharacters } from "@/lib/storage";
import type { LibraryCharacter } from "@/types/characterLibrary";
import { useGameStore } from "@/store/useGameStore";
import { cn } from "@/lib/utils";

type Path = "gate" | "new" | "returning";

export function CharacterPage() {
  const script = useGameStore((s) => s.script);
  const campaignId = useGameStore((s) => s.campaignId);
  const partySize = useGameStore((s) => s.partySize);
  const party = useGameStore((s) => s.party);
  const editingPartySlotIndex = useGameStore((s) => s.editingPartySlotIndex);
  const playerMemberId = useGameStore((s) => s.playerMemberId);
  const setEditingPartySlotIndex = useGameStore(
    (s) => s.setEditingPartySlotIndex,
  );
  const clearPartyMemberByCharacterId = useGameStore(
    (s) => s.clearPartyMemberByCharacterId,
  );
  const movePartyMemberToSlot = useGameStore((s) => s.movePartyMemberToSlot);
  const confirmCharacterAndPlay = useGameStore(
    (s) => s.confirmCharacterAndPlay,
  );
  const backToScriptPhase = useGameStore((s) => s.backToScriptPhase);
  const appendSystem = useGameStore((s) => s.appendSystem);
  const sessionStatus = useGameStore((s) => s.sessionStatus);
  const isTyping = useGameStore((s) => s.isTyping);
  const systemId = script.system_id;

  const [path, setPath] = useState<Path>("gate");
  const [selected, setSelected] = useState<LibraryCharacter | null>(null);
  const [library, setLibrary] = useState(() => loadLibraryCharacters());
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>(
    {},
  );
  const [reassignPrompt, setReassignPrompt] = useState<{
    entry: LibraryCharacter;
    fromSlot: number;
  } | null>(null);

  useEffect(() => {
    if (path === "gate") {
      setLibrary(loadLibraryCharacters());
      const map: Record<string, string> = {};
      for (const s of loadCampaignIndex().sessions) {
        map[s.id] = s.title;
      }
      setSessionTitles(map);
    }
  }, [path]);

  const editingMember = party.find(
    (m) => m.slotIndex === editingPartySlotIndex,
  );
  const editingIsPlayer =
    editingMember?.controller === "player" ||
    (!editingMember &&
      (playerMemberId == null
        ? editingPartySlotIndex === 0
        : false));

  const compatible = useMemo(() => {
    if (!systemId) return [];
    return library.filter((c) => c.sheet.system_id === systemId);
  }, [library, systemId]);

  const isBusyElsewhere = (c: LibraryCharacter) => {
    const active = c.activeCampaignId;
    if (!active || active === campaignId) return false;
    if (c.career.some((r) => r.campaignId === active)) return false;
    return true;
  };

  const availableCount = compatible.filter((c) => !isBusyElsewhere(c)).length;

  const multiParty = partySize > 1;

  const partyFullyReady = useMemo(() => {
    if (!multiParty) return false;
    const allSlots = Array.from({ length: partySize }, (_, i) => i).every(
      (i) => party.some((m) => m.slotIndex === i && m.creationComplete),
    );
    return allSlots && party.some((m) => m.controller === "player");
  }, [multiParty, partySize, party]);

  const canStartAdventure =
    partyFullyReady && sessionStatus === "idle" && !isTyping;

  const openSlotEditor = (slot: number) => {
    setEditingPartySlotIndex(slot);
    const member = useGameStore
      .getState()
      .party.find((m) => m.slotIndex === slot);
    const libId = member?.sheet.id;
    const fromLib =
      Boolean(member?.fromLibrary) ||
      (libId ? Boolean(getLibraryCharacter(libId)) : false);

    if (member && fromLib && libId) {
      const entry =
        getLibraryCharacter(libId) ??
        ({
          sheet: member.sheet,
          career: [],
          activeCampaignId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } satisfies LibraryCharacter);
      // 數值以檔案庫為準（幕間恢復由此套用）；敘事／背包帶上席次上已改過的內容
      setSelected({
        ...entry,
        sheet: {
          ...entry.sheet,
          name: member.sheet.name,
          role_title: member.sheet.role_title,
          appearance: member.sheet.appearance,
          personal_bio: member.sheet.personal_bio,
          inventory: [...member.sheet.inventory],
        },
      });
      setPath("returning");
      return;
    }

    setSelected(null);
    setPath("new");
  };

  if (path === "new") {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="brand-title text-xl text-ink">
              {multiParty
                ? `創建角色 · 隊員${editingPartySlotIndex + 1}`
                : "創建新角色"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {script.public_summary?.title
                ? `劇本「${script.public_summary.title}」`
                : "目前劇本"}
              {systemId ? ` · ${systemId}` : ""}
              {editingIsPlayer ? " · 玩家席" : " · AI 隊友"}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPath("gate")}>
            返回隊伍
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CharacterStage
            allowLibrarySave={editingIsPlayer}
            onSlotSaved={() => {
              // 先離開創角頁（unmount），再切下一空席，避免 cleanup 寫錯席
              setPath("gate");
              queueMicrotask(() => {
                const st = useGameStore.getState();
                const next = Array.from(
                  { length: st.partySize },
                  (_, i) => i,
                ).find((i) => {
                  const m = st.party.find((p) => p.slotIndex === i);
                  return !(m?.creationComplete);
                });
                if (next != null) {
                  useGameStore.getState().setEditingPartySlotIndex(next);
                }
              });
            }}
          />
        </div>
      </div>
    );
  }

  if (path === "returning" && selected) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
        <div className="mb-4 shrink-0">
          <h2 className="brand-title text-xl text-ink">帶入角色 · 歸隊確認</h2>
          <p className="mt-1 text-sm text-muted">
            沿用既有屬性與技能（CoC 幕間歸隊）。
            {multiParty
              ? editingIsPlayer
                ? "將帶入「我扮演」隊員（佔用此卡）；確認後請繼續完成其餘隊員。"
                : "將帶入 AI 隊友（佔用此卡，一角同時僅一場；結局可選寫回檔案庫）。"
              : "確認後開始冒險。"}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReturningCharacterConfirm
            entry={selected}
            asPlayer={editingIsPlayer}
            onBack={() => {
              setSelected(null);
              setPath("gate");
            }}
            onCancelSelection={() => {
              clearPartyMemberByCharacterId(selected.sheet.id);
              setSelected(null);
              setPath("gate");
            }}
            onAssigned={() => {
              setSelected(null);
              setPath("gate");
              queueMicrotask(() => {
                const st = useGameStore.getState();
                const next = Array.from(
                  { length: st.partySize },
                  (_, i) => i,
                ).find((i) => {
                  const m = st.party.find((p) => p.slotIndex === i);
                  return !(m?.creationComplete);
                });
                if (next != null) {
                  useGameStore.getState().setEditingPartySlotIndex(next);
                }
              });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/70 p-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="brand-title text-xl text-ink">
            {multiParty ? "組建隊伍" : "選擇角色"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {script.public_summary?.title
              ? `劇本「${script.public_summary.title}」`
              : "目前劇本"}
            {systemId ? ` · ${systemId}` : ""}
            {multiParty
              ? ` · 需 ${partySize} 名成員（1 名玩家 + AI 隊友）`
              : "。可創建新角色，或帶入檔案庫中同系統的調查員。"}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => backToScriptPhase()}
        >
          <ArrowLeft className="h-4 w-4" />
          返回劇本討論
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        {multiParty ? (
          <PartySlotsBar
            onEditSlot={(slot) => {
              openSlotEditor(slot);
            }}
          />
        ) : null}

        {partyFullyReady ? (
          <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-sm text-ink">
              隊伍 {partySize}/{partySize} 已就緒
              {script.public_summary?.title
                ? `，可以開始《${script.public_summary.title}》`
                : "，可以開始冒險"}
              。若皆以帶入角色卡完成，直接由此出發即可。
            </p>
            <Button
              className="w-full"
              size="lg"
              disabled={!canStartAdventure}
              onClick={() => confirmCharacterAndPlay()}
            >
              <Play className="h-5 w-5" />
              {script.public_summary?.title
                ? `隊伍就緒，開始《${script.public_summary.title}》`
                : "隊伍就緒，開始冒險"}
            </Button>
            {!canStartAdventure ? (
              <p className="text-xs text-muted">
                Session 忙碌中，請稍候再開始。
              </p>
            ) : null}
          </div>
        ) : multiParty ? (
          <p className="text-xs text-muted">
            點各隊員右上角「創建／編輯」完成角色，或從下方帶入檔案庫角色卡；全部就緒後將出現「開始冒險」。
          </p>
        ) : null}

        {!multiParty ? (
          <button
            type="button"
            onClick={() => {
              setEditingPartySlotIndex(editingPartySlotIndex);
              setPath("new");
            }}
            className={cn(
              "group w-full cursor-pointer rounded-xl border border-border bg-surface px-5 py-6 text-left",
              "transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out",
              "hover:border-accent/55 hover:bg-accent/[0.07] hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_22%,transparent),0_8px_24px_-12px_color-mix(in_oklab,var(--accent)_35%,transparent)]",
              "active:translate-y-px",
            )}
          >
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-accent transition-colors group-hover:border-accent/40 group-hover:bg-accent/10">
                <UserPlus className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-accent opacity-80" />
                  <span className="brand-title text-lg text-ink">創建新角色</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  完整創角（數值＋敘事）。此席為你扮演。
                </p>
              </div>
            </div>
          </button>
        ) : null}

        <section>
          <div className="mb-2 flex items-center gap-2 text-ink">
            <Library className="h-4 w-4" />
            <h3 className="brand-title text-base">帶入已存角色卡</h3>
          </div>
          <p className="mb-3 text-xs text-muted">
            {editingIsPlayer
              ? `可帶入的 ${systemId ?? "—"} 角色（${availableCount}/${compatible.length}）${multiParty ? " · 開始冒險後佔用此卡" : ""}`
              : `AI 隊友帶入會佔用該卡（同時僅一場）；結局可選是否寫回。可選 ${systemId ?? "—"}（${availableCount}/${compatible.length}）`}
            {multiParty
              ? "。已在隊者：編輯該席再點可取消；編輯其他席再點可改帶入。"
              : ""}
          </p>
          {compatible.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">
              檔案庫尚無同系統角色。
            </p>
          ) : (
            <ul className="space-y-2">
              {compatible.map((c) => {
                const busy = isBusyElsewhere(c);
                const partyMember = party.find(
                  (m) => m.sheet.id === c.sheet.id || m.id === c.sheet.id,
                );
                const inParty = Boolean(partyMember);
                const onEditingSlot =
                  partyMember?.slotIndex === editingPartySlotIndex;
                return (
                  <li key={c.sheet.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (partyMember) {
                          if (onEditingSlot) {
                            clearPartyMemberByCharacterId(c.sheet.id);
                            return;
                          }
                          setReassignPrompt({
                            entry: c,
                            fromSlot: partyMember.slotIndex,
                          });
                          return;
                        }
                        setSelected(c);
                        setPath("returning");
                      }}
                      className={cn(
                        "flex w-full items-start justify-between gap-2 rounded-lg border p-3 text-left transition-colors",
                        inParty &&
                          "cursor-pointer border-emerald-500/55 bg-emerald-500/15 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20",
                        busy &&
                          "cursor-not-allowed border-border bg-surface-2/50 opacity-50",
                        !busy &&
                          !inParty &&
                          "cursor-pointer border-border bg-surface-2/50 hover:border-accent/40 hover:bg-accent/[0.06]",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">
                          {c.sheet.name || "（未命名）"}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {c.sheet.role_title || "—"} · 履歷 {c.career.length}{" "}
                          場
                          {onEditingSlot
                            ? " · 再點可取消此席帶入"
                            : inParty
                              ? ` · 點擊可改帶入隊員${editingPartySlotIndex + 1}`
                              : busy && c.activeCampaignId
                                ? ` · 進行中：${sessionTitles[c.activeCampaignId] ?? "其他 Session"}`
                                : ""}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-medium",
                          inParty
                            ? "text-emerald-300"
                            : busy
                              ? "text-muted"
                              : "text-accent",
                        )}
                      >
                        {inParty && partyMember
                          ? `已在隊伍中-隊員${partyMember.slotIndex + 1}`
                          : busy
                            ? "占用中"
                            : "選擇"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <Modal
        open={Boolean(reassignPrompt)}
        onOpenChange={(open) => {
          if (!open) setReassignPrompt(null);
        }}
        title="改帶入隊員"
      >
        {reassignPrompt ? (
          <div className="space-y-4 text-sm">
            <p className="text-ink">
              「{reassignPrompt.entry.sheet.name || "未命名"}」目前在隊員
              {reassignPrompt.fromSlot + 1}。要改成帶入隊員
              {editingPartySlotIndex + 1} 嗎？
            </p>
            <p className="text-xs text-muted">
              確認後會清空隊員{reassignPrompt.fromSlot + 1}
              {party.some((m) => m.slotIndex === editingPartySlotIndex)
                ? `，並取代隊員${editingPartySlotIndex + 1} 現有角色`
                : ""}
              。若要取消帶入，請先選隊員{reassignPrompt.fromSlot + 1}{" "}
              再點一次此卡。
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setReassignPrompt(null)}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const occupied = party.find(
                    (m) => m.slotIndex === editingPartySlotIndex,
                  );
                  if (
                    occupied &&
                    occupied.sheet.id !== reassignPrompt.entry.sheet.id
                  ) {
                    appendSystem(
                      `隊員${editingPartySlotIndex + 1} 原角色「${occupied.sheet.name || "未命名"}」已替換。`,
                    );
                  }
                  movePartyMemberToSlot(
                    reassignPrompt.entry.sheet.id,
                    editingPartySlotIndex,
                    { controller: editingIsPlayer ? "player" : "ai" },
                  );
                  setReassignPrompt(null);
                }}
              >
                改帶入隊員{editingPartySlotIndex + 1}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
