import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Modal } from "@/components/ui/modal";
import {
  resolveAttributeDef,
  resolveAttributeLabel,
  resolveSkillDescription,
} from "@/engine/creation";
import { attributeTooltipContent, buildDerivedTooltipRows } from "@/engine/statTooltips";
import { useGameStore } from "@/store/useGameStore";
import type { UniversalCharacterSheet } from "@/types/game";

function Field({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  const text =
    value == null || (typeof value === "string" && !value.trim())
      ? "—"
      : String(value);
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">
        {label}
      </div>
      <p className="whitespace-pre-wrap text-sm text-ink">{text}</p>
    </div>
  );
}

function resolveHookLabel(
  id: string,
  character: UniversalCharacterSheet,
  schemaQuestions: { id: string; category: string; question: string }[],
): string {
  const fromSchema = schemaQuestions.find((q) => q.id === id);
  if (fromSchema?.question?.trim()) {
    const category = fromSchema.category?.trim();
    return category
      ? `${category}：${fromSchema.question.trim()}`
      : fromSchema.question.trim();
  }
  const fromSheet = character.backstory_hook_questions?.[id]?.trim();
  if (fromSheet) return fromSheet;
  return id;
}

function CharacterDetailBody({
  character,
  showMadness,
}: {
  character: UniversalCharacterSheet;
  showMadness: boolean;
}) {
  const schema = useGameStore((s) => s.characterSchema);
  const madness = useGameStore((s) => s.madness);

  const skillDescByName = useMemo(() => {
    const map = new Map<string, string>();
    const names = new Set<string>([
      ...Object.keys(character.skills ?? {}),
      ...Object.keys(character.skill_descriptions ?? {}),
      ...(schema?.recommended_skills ?? []).map((s) => s.name),
      "閃避",
      "信用評級",
    ]);
    for (const name of names) {
      const tip = resolveSkillDescription(name, {
        systemId: character.system_id,
        sheetDescriptions: character.skill_descriptions,
        schemaSkills: schema?.recommended_skills,
      });
      if (tip) map.set(name, tip);
    }
    return map;
  }, [
    character.system_id,
    character.skills,
    character.skill_descriptions,
    schema?.recommended_skills,
  ]);

  const derivedTips = useMemo(() => {
    const map = new Map<string, { label: string; content: string }>();
    for (const row of buildDerivedTooltipRows(character)) {
      map.set(row.id, { label: row.label, content: row.content });
    }
    return map;
  }, [character]);

  const isCoc = character.system_id === "COC_7E";
  const isDnd = character.system_id === "DND_5E";
  const attrDefs = schema?.attribute_defs;
  const hooks = Object.entries(character.backstory_hooks ?? {}).filter(
    ([, v]) => v?.trim(),
  );
  const schemaQuestions = schema?.background_questions ?? [];
  const tipOf = (id: string) => derivedTips.get(id)?.content ?? "";

  const attrTip = (key: string) => {
    const def = resolveAttributeDef(character.system_id, key, attrDefs);
    return attributeTooltipContent(character.system_id, def, {
      score: character.attributes[key],
      modifier: character.attribute_modifiers?.[`${key}_MOD`],
      includeDiceFormula: false,
    });
  };

  const attrLabel = (key: string) =>
    resolveAttributeLabel(character.system_id, key, attrDefs);

  const DerivedChip = ({
    id,
    label,
    value,
  }: {
    id: string;
    label: string;
    value: string;
  }) => (
    <div className="flex items-baseline gap-1">
      <HoverTooltip header={label} content={tipOf(id)}>
        <span className="underline decoration-dotted decoration-muted underline-offset-2">
          {label}
        </span>
      </HoverTooltip>
      <span>{value}</span>
    </div>
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="名稱" value={character.name} />
        <Field label="職稱／角色定位" value={character.role_title} />
        <Field label="年齡" value={character.age} />
        <Field label="性別" value={character.gender} />
        <Field label="居住地" value={character.residence} />
        <Field label="出生地" value={character.birthplace} />
        <Field label="語言" value={character.languages} />
        <Field label="財富" value={character.wealth} />
      </div>

      <Field label="外貌" value={character.appearance} />
      <Field label="個人簡介" value={character.personal_bio} />

      {isCoc ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="職業" value={character.profile_coc?.occupation} />
          <Field
            label="現金／資產"
            value={character.profile_coc?.cash_assets}
          />
        </div>
      ) : null}

      {isDnd ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="種族" value={character.profile_dnd?.race} />
          <Field label="職業" value={character.profile_dnd?.class_name} />
          <Field label="背景" value={character.profile_dnd?.background} />
          <Field label="陣營" value={character.profile_dnd?.alignment} />
          <Field label="速度" value={character.profile_dnd?.speed} />
          <Field label="熟練" value={character.profile_dnd?.proficiencies} />
          <div className="sm:col-span-2">
            <Field label="特性" value={character.profile_dnd?.features} />
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
          屬性
        </div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {Object.entries(character.attributes).map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline gap-1 rounded bg-surface-2 px-2 py-1 text-xs"
            >
              <HoverTooltip header={attrLabel(k)} content={attrTip(k)}>
                <span className="underline decoration-dotted decoration-muted underline-offset-2">
                  {attrLabel(k)}
                </span>
              </HoverTooltip>
              <span>
                ：{v}
                {isDnd && character.attribute_modifiers?.[`${k}_MOD`] != null
                  ? `（${(character.attribute_modifiers[`${k}_MOD`] ?? 0) >= 0 ? "+" : ""}${character.attribute_modifiers[`${k}_MOD`]}）`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <DerivedChip
          id="hp"
          label="HP"
          value={`${character.derived.hp.current}/${character.derived.hp.max}`}
        />
        {character.derived.san ? (
          <DerivedChip
            id="san"
            label="SAN"
            value={`${character.derived.san.current}/${character.derived.san.max}`}
          />
        ) : null}
        {character.derived.mp_or_slots ? (
          <DerivedChip
            id="mp"
            label={isDnd ? "法術位" : "MP"}
            value={`${character.derived.mp_or_slots.current}/${character.derived.mp_or_slots.max}`}
          />
        ) : null}
        {isDnd ? (
          <DerivedChip
            id="ac"
            label="AC"
            value={String(character.derived.ac ?? "—")}
          />
        ) : null}
        {isDnd ? (
          <DerivedChip
            id="prof"
            label="熟練"
            value={`+${character.derived.proficiency_bonus ?? 0}`}
          />
        ) : null}
        {isCoc && character.derived.mov != null ? (
          <DerivedChip id="mov" label="MOV" value={String(character.derived.mov)} />
        ) : null}
        {isCoc && character.derived.build != null ? (
          <DerivedChip
            id="build"
            label="體格"
            value={String(character.derived.build)}
          />
        ) : null}
        {isCoc && character.derived.damage_bonus ? (
          <DerivedChip
            id="db"
            label="DB"
            value={character.derived.damage_bonus}
          />
        ) : null}
      </div>

      {Object.keys(character.skills).length ? (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
            技能
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {Object.entries(character.skills).map(([k, v]) => {
              const tip = skillDescByName.get(k) ?? "";
              return (
                <div key={k} className="flex justify-between gap-2">
                  <HoverTooltip header={k} content={tip}>
                    <span
                      className={
                        tip
                          ? "underline decoration-dotted decoration-muted underline-offset-2"
                          : undefined
                      }
                    >
                      {k}
                    </span>
                  </HoverTooltip>
                  <span className="tabular-nums">{v}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {hooks.length ? (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">
            背景鉤子
          </div>
          {hooks.map(([id, answer]) => (
            <div key={id} className="space-y-1">
              <div className="text-xs font-medium leading-snug text-muted">
                {resolveHookLabel(id, character, schemaQuestions)}
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink">{answer}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
          背包
        </div>
        {character.inventory.length ? (
          <ul className="list-inside list-disc text-xs text-ink/90">
            {character.inventory.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">（空）</p>
        )}
      </div>

      {showMadness && madness.active ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          狂氣：{madness.name}（{madness.type}）— {madness.effect_description}
        </div>
      ) : null}
    </div>
  );
}

export function CharacterDetailModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const party = useGameStore((s) => s.party);
  const viewedPartyMemberId = useGameStore((s) => s.viewedPartyMemberId);
  const playerMemberId = useGameStore((s) => s.playerMemberId);
  const storeCharacter = useGameStore((s) => s.character);
  const setViewedPartyMemberId = useGameStore((s) => s.setViewedPartyMemberId);

  const defaultMemberId =
    viewedPartyMemberId ?? playerMemberId ?? storeCharacter?.id ?? party[0]?.id ?? null;

  const [detailMemberId, setDetailMemberId] = useState<string | null>(
    defaultMemberId,
  );

  useEffect(() => {
    if (open) {
      setDetailMemberId(defaultMemberId);
    }
  }, [open, defaultMemberId]);

  const currentIndex = useMemo(
    () => party.findIndex((m) => m.id === detailMemberId),
    [party, detailMemberId],
  );
  const currentMember =
    currentIndex >= 0 ? party[currentIndex] : party[0] ?? null;
  const character = currentMember?.sheet ?? storeCharacter;
  const hasPartyNav = party.length > 1;

  const selectMember = useCallback(
    (memberId: string) => {
      setDetailMemberId(memberId);
      setViewedPartyMemberId(memberId);
    },
    [setViewedPartyMemberId],
  );

  const goRelative = useCallback(
    (delta: -1 | 1) => {
      if (!hasPartyNav) return;
      const idx = currentIndex >= 0 ? currentIndex : 0;
      const next = (idx + delta + party.length) % party.length;
      const member = party[next];
      if (member) selectMember(member.id);
    },
    [currentIndex, hasPartyNav, party, selectMember],
  );

  useEffect(() => {
    if (!open || !hasPartyNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goRelative(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goRelative(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasPartyNav, goRelative]);

  if (!character) return null;

  const subtitle = [
    character.name,
    currentMember?.controller === "player" ? "你扮演" : "AI 隊友",
    hasPartyNav ? `${(currentIndex >= 0 ? currentIndex : 0) + 1}/${party.length}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const partyTabs = hasPartyNav ? (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {party.map((m) => {
          const active = m.id === currentMember?.id;
          return (
            <button
              key={m.id}
              type="button"
              className={
                active
                  ? "cursor-pointer rounded border border-accent/50 bg-accent/15 px-2 py-0.5 text-[10px] text-ink"
                  : "cursor-pointer rounded border border-border px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-accent/30 hover:bg-accent/10 hover:text-ink"
              }
              onClick={() => selectMember(m.id)}
            >
              {m.sheet.name || "未命名"}
              {m.controller === "player" ? " ·你" : " ·AI"}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1 rounded-md border-2 border-border px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent hover:bg-accent/15 hover:text-accent active:bg-accent/25"
          onClick={() => goRelative(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
          上一位
        </button>
        <span className="text-[10px] text-muted">左右鍵亦可切換</span>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1 rounded-md border-2 border-border px-3 py-1.5 text-xs text-ink transition-colors hover:border-accent hover:bg-accent/15 hover:text-accent active:bg-accent/25"
          onClick={() => goRelative(1)}
        >
          下一位
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="完整角色設定"
      subtitle={subtitle}
      className="w-[min(92vw,640px)]"
      headerExtra={partyTabs}
      onPrevious={hasPartyNav ? () => goRelative(-1) : undefined}
      onNext={hasPartyNav ? () => goRelative(1) : undefined}
      previousLabel="上一位角色"
      nextLabel="下一位角色"
    >
      <CharacterDetailBody
        key={character.id}
        character={character}
        showMadness={currentMember?.id === playerMemberId}
      />
    </Modal>
  );
}
