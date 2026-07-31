import { useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { CharacterDetailModal } from "@/components/sheet/CharacterDetailModal";
import { NoteEditorModal } from "@/components/sheet/NoteEditorModal";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import {
  resolveAttributeDef,
  resolveAttributeLabel,
  resolveSkillDescription,
} from "@/engine/creation";
import { attributeTooltipContent, buildDerivedTooltipRows } from "@/engine/statTooltips";
import { useGameStore } from "@/store/useGameStore";
import type { ClueItem, PlayerNote } from "@/types/game";

function StatBar({
  label,
  current,
  max,
  tip,
}: {
  label: string;
  current: number;
  max: number;
  tip?: string;
}) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted">
        {tip?.trim() ? (
          <HoverTooltip header={label} content={tip}>
            <span className="underline decoration-dotted decoration-muted underline-offset-2">
              {label}
            </span>
          </HoverTooltip>
        ) : (
          <span>{label}</span>
        )}
        <span>
          {current}/{max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-bg">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CharacterPanel() {
  const character = useGameStore((s) => s.character);
  const schema = useGameStore((s) => s.characterSchema);
  const madness = useGameStore((s) => s.madness);
  const [detailOpen, setDetailOpen] = useState(false);

  const skillDescByName = useMemo(() => {
    const map = new Map<string, string>();
    const names = new Set<string>([
      ...Object.keys(character?.skills ?? {}),
      ...Object.keys(character?.skill_descriptions ?? {}),
      ...(schema?.recommended_skills ?? []).map((s) => s.name),
      "閃避",
      "信用評級",
    ]);
    for (const name of names) {
      const tip = resolveSkillDescription(name, {
        systemId: character?.system_id,
        sheetDescriptions: character?.skill_descriptions,
        schemaSkills: schema?.recommended_skills,
      });
      if (tip) map.set(name, tip);
    }
    return map;
  }, [
    character?.system_id,
    character?.skills,
    character?.skill_descriptions,
    schema?.recommended_skills,
  ]);

  const derivedTips = useMemo(() => {
    if (!character) return new Map<string, { label: string; content: string }>();
    const map = new Map<string, { label: string; content: string }>();
    for (const row of buildDerivedTooltipRows(character)) {
      map.set(row.id, { label: row.label, content: row.content });
    }
    return map;
  }, [character]);

  if (!character) {
    return <p className="text-sm text-muted">尚未建立角色。</p>;
  }

  const isCoc = character.system_id === "COC_7E";
  const isDnd = character.system_id === "DND_5E";
  const attrDefs = schema?.attribute_defs;

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

  const dndCoreKeys = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
  const tipOf = (id: string) => derivedTips.get(id)?.content ?? "";

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="brand-title text-base text-ink">{character.name}</div>
            <div className="text-xs text-muted">{character.role_title}</div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 gap-1 px-2"
            onClick={() => setDetailOpen(true)}
            title="檢視完整角色設定"
          >
            <Eye className="h-3.5 w-3.5" />
            完整設定
          </Button>
        </div>
        {character.appearance?.trim() ? (
          <p className="mt-1 text-xs text-ink/80 line-clamp-2">
            {character.appearance.trim()}
          </p>
        ) : null}
        {isCoc ? (
          <div className="mt-1 space-y-0.5 text-[11px] text-muted">
            {character.profile_coc?.occupation?.trim() ? (
              <div>職業：{character.profile_coc.occupation.trim()}</div>
            ) : null}
            {character.skills["信用評級"] != null ? (
              <div>信用評級：{character.skills["信用評級"]}%</div>
            ) : null}
            {character.derived.mov != null ||
            character.derived.build != null ||
            character.derived.damage_bonus ? (
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {character.derived.mov != null ? (
                  <span className="inline-flex items-baseline gap-1">
                    <HoverTooltip header="MOV" content={tipOf("mov")}>
                      <span className="underline decoration-dotted decoration-muted underline-offset-2">
                        MOV
                      </span>
                    </HoverTooltip>
                    <span>{character.derived.mov}</span>
                  </span>
                ) : null}
                {character.derived.build != null ? (
                  <span className="inline-flex items-baseline gap-1">
                    <HoverTooltip header="體格" content={tipOf("build")}>
                      <span className="underline decoration-dotted decoration-muted underline-offset-2">
                        體格
                      </span>
                    </HoverTooltip>
                    <span>{character.derived.build}</span>
                  </span>
                ) : null}
                {character.derived.damage_bonus ? (
                  <span className="inline-flex items-baseline gap-1">
                    <HoverTooltip header="DB" content={tipOf("db")}>
                      <span className="underline decoration-dotted decoration-muted underline-offset-2">
                        DB
                      </span>
                    </HoverTooltip>
                    <span>{character.derived.damage_bonus}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {isDnd ? (
          <div className="mt-1 space-y-0.5 text-[11px] text-muted">
            {(() => {
              const line = [
                character.profile_dnd?.race,
                character.profile_dnd?.class_name,
                character.profile_dnd?.background,
              ]
                .map((x) => x?.trim())
                .filter(Boolean)
                .join(" · ");
              return line ? <div>{line}</div> : null;
            })()}
            {character.profile_dnd?.alignment?.trim() ? (
              <div>陣營：{character.profile_dnd.alignment.trim()}</div>
            ) : null}
          </div>
        ) : null}
      </div>
      <StatBar
        label="HP"
        current={character.derived.hp.current}
        max={character.derived.hp.max}
        tip={tipOf("hp")}
      />
      {character.derived.san ? (
        <StatBar
          label="SAN"
          current={character.derived.san.current}
          max={character.derived.san.max}
          tip={tipOf("san")}
        />
      ) : null}
      {character.derived.mp_or_slots ? (
        <StatBar
          label={isDnd ? "法術位/資源" : "MP"}
          current={character.derived.mp_or_slots.current}
          max={character.derived.mp_or_slots.max}
          tip={tipOf("mp")}
        />
      ) : null}
      {isDnd ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-baseline gap-1">
            <HoverTooltip header="AC" content={tipOf("ac")}>
              <span className="underline decoration-dotted decoration-muted underline-offset-2">
                AC
              </span>
            </HoverTooltip>
            <span>：{character.derived.ac ?? "—"}</span>
          </div>
          <div className="flex items-baseline gap-1">
            <HoverTooltip header="熟練加值" content={tipOf("prof")}>
              <span className="underline decoration-dotted decoration-muted underline-offset-2">
                熟練
              </span>
            </HoverTooltip>
            <span>：+{character.derived.proficiency_bonus ?? 0}</span>
          </div>
          {dndCoreKeys
            .filter((k) => character.attributes[k] != null)
            .map((k) => {
              const v = character.attributes[k];
              const mod = character.attribute_modifiers?.[`${k}_MOD`] ?? 0;
              return (
                <div key={k} className="flex items-baseline gap-1">
                  <HoverTooltip header={attrLabel(k)} content={attrTip(k)}>
                    <span className="underline decoration-dotted decoration-muted underline-offset-2">
                      {attrLabel(k)}
                    </span>
                  </HoverTooltip>
                  <span>
                    {v}（{mod >= 0 ? "+" : ""}
                    {mod}）
                  </span>
                </div>
              );
            })}
        </div>
      ) : null}
      {isCoc ? (
        <div className="space-y-1">
          <div className="text-xs text-muted">屬性</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {Object.entries(character.attributes).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1">
                <HoverTooltip header={attrLabel(k)} content={attrTip(k)}>
                  <span className="underline decoration-dotted decoration-muted underline-offset-2">
                    {attrLabel(k)}
                  </span>
                </HoverTooltip>
                <span>：{v}</span>
              </div>
            ))}
          </div>
          <div className="pt-2 text-xs text-muted">技能 %</div>
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
                  <span className="shrink-0 tabular-nums">{v}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {madness.active ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          狂氣：{madness.name}（{madness.type}）— {madness.effect_description}
        </div>
      ) : null}

      <CharacterDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        character={character}
        madness={madness}
      />
    </div>
  );
}

function NotesPanel({
  onRequestCreate,
}: {
  onRequestCreate: (seed?: { title?: string; content?: string }) => void;
}) {
  const clues = useGameStore((s) => s.clues);
  const playerNotes = useGameStore((s) => s.playerNotes);
  const updatePlayerNote = useGameStore((s) => s.updatePlayerNote);
  const removePlayerNote = useGameStore((s) => s.removePlayerNote);
  const [editNote, setEditNote] = useState<PlayerNote | null>(null);

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-ink">關鍵資訊筆記</div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2"
            onClick={() => onRequestCreate({ title: "", content: "" })}
          >
            <Plus className="h-3.5 w-3.5" />
            新增
          </Button>
        </div>
        {playerNotes.map((n) => (
          <div
            key={n.note_id}
            className="rounded border border-accent/35 bg-accent/10 p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 font-medium text-ink">
                {n.title.trim() || "（無標題）"}
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 px-0"
                  title="編輯"
                  onClick={() => setEditNote(n)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 px-0 text-danger"
                  title="刪除"
                  onClick={() => {
                    if (window.confirm("確定刪除此筆記？")) {
                      removePlayerNote(n.note_id);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs text-ink/90">
              {n.content}
            </p>
          </div>
        ))}
        {!playerNotes.length ? (
          <p className="text-xs text-muted">尚無自行新增的筆記。</p>
        ) : null}
      </div>

      <CluesList clues={clues} />

      <NoteEditorModal
        open={editNote != null}
        onOpenChange={(open) => {
          if (!open) setEditNote(null);
        }}
        mode="edit"
        initialTitle={editNote?.title ?? ""}
        initialContent={editNote?.content ?? ""}
        onSave={({ title, content }) => {
          if (!editNote) return;
          updatePlayerNote(editNote.note_id, { title, content });
        }}
      />
    </div>
  );
}

function CluesList({ clues }: { clues: ClueItem[] }) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="text-xs font-medium text-ink">GM 線索／任務</div>
      {clues.map((c) => (
        <div key={c.clue_id} className="rounded border border-border p-2">
          <div className="font-medium text-ink">
            {c.title}
            {c.is_key_clue ? " ★" : ""}
          </div>
          <div className="text-xs text-muted">{c.type}</div>
          <p className="mt-1 text-xs text-ink/90">{c.content}</p>
        </div>
      ))}
      {!clues.length ? (
        <p className="text-xs text-muted">尚無線索。</p>
      ) : null}
    </div>
  );
}

export function GameSidebar({
  onRequestCreateNote,
}: {
  onRequestCreateNote: (seed?: { title?: string; content?: string }) => void;
}) {
  const character = useGameStore((s) => s.character);
  const npcs = useGameStore((s) => s.npcs);

  return (
    <Tabs.Root defaultValue="sheet" className="flex h-full flex-col">
      <Tabs.List className="mb-3 flex flex-wrap gap-1 border-b border-border pb-2">
        {[
          ["sheet", "角色卡"],
          ["inv", "背包"],
          ["clues", "筆記/線索"],
          ["npcs", "NPC"],
        ].map(([value, label]) => (
          <Tabs.Trigger
            key={value}
            value={value}
            className="rounded px-2 py-1 text-xs text-muted data-[state=active]:bg-surface-2 data-[state=active]:text-ink"
          >
            {label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs.Content value="sheet">
          <CharacterPanel />
        </Tabs.Content>
        <Tabs.Content value="inv">
          <ul className="space-y-1 text-sm">
            {(character?.inventory ?? []).map((item) => (
              <li key={item} className="rounded bg-surface-2 px-2 py-1">
                {item}
              </li>
            ))}
            {!character?.inventory.length ? (
              <li className="text-muted">背包是空的。</li>
            ) : null}
          </ul>
        </Tabs.Content>
        <Tabs.Content value="clues">
          <NotesPanel onRequestCreate={onRequestCreateNote} />
        </Tabs.Content>
        <Tabs.Content value="npcs">
          <div className="space-y-2 text-sm">
            {npcs.map((n) => (
              <div key={n.npc_id} className="rounded border border-border p-2">
                <div className="font-medium text-ink">{n.name}</div>
                <div className="text-xs text-muted">
                  {n.relation} · {n.status}
                </div>
                <p className="mt-1 text-xs">{n.description}</p>
              </div>
            ))}
            {!npcs.length ? <p className="text-muted">尚無 NPC。</p> : null}
          </div>
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
