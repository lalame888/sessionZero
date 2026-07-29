import * as Tabs from "@radix-ui/react-tabs";
import { useGameStore } from "@/store/useGameStore";

function StatBar({
  label,
  current,
  max,
}: {
  label: string;
  current: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
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
  const madness = useGameStore((s) => s.madness);
  if (!character) {
    return <p className="text-sm text-muted">尚未建立角色。</p>;
  }

  const isCoc = character.system_id === "COC_7E";
  const isDnd = character.system_id === "DND_5E";

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="brand-title text-base text-ink">{character.name}</div>
        <div className="text-xs text-muted">{character.role_title}</div>
      </div>
      <StatBar
        label="HP"
        current={character.derived.hp.current}
        max={character.derived.hp.max}
      />
      {character.derived.san ? (
        <StatBar
          label="SAN"
          current={character.derived.san.current}
          max={character.derived.san.max}
        />
      ) : null}
      {character.derived.mp_or_slots ? (
        <StatBar
          label={isDnd ? "法術位/資源" : "MP"}
          current={character.derived.mp_or_slots.current}
          max={character.derived.mp_or_slots.max}
        />
      ) : null}
      {isDnd ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>AC：{character.derived.ac ?? "—"}</div>
          <div>熟練：+{character.derived.proficiency_bonus ?? 0}</div>
          {Object.entries(character.attributes)
            .filter(([k]) => ["STR", "DEX", "CON", "INT", "WIS", "CHA"].includes(k))
            .map(([k, v]) => (
              <div key={k}>
                {k} {v}（{(character.attribute_modifiers?.[`${k}_MOD`] ?? 0) >= 0 ? "+" : ""}
                {character.attribute_modifiers?.[`${k}_MOD`] ?? 0}）
              </div>
            ))}
        </div>
      ) : null}
      {isCoc ? (
        <div className="space-y-1">
          <div className="text-xs text-muted">屬性</div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {Object.entries(character.attributes).map(([k, v]) => (
              <div key={k}>
                {k}: {v}
              </div>
            ))}
          </div>
          <div className="pt-2 text-xs text-muted">技能 %</div>
          <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {Object.entries(character.skills).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span>{k}</span>
                <span>{v}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {madness.active ? (
        <div className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          狂氣：{madness.name}（{madness.type}）— {madness.effect_description}
        </div>
      ) : null}
    </div>
  );
}

export function GameSidebar() {
  const character = useGameStore((s) => s.character);
  const clues = useGameStore((s) => s.clues);
  const npcs = useGameStore((s) => s.npcs);

  return (
    <Tabs.Root defaultValue="sheet" className="flex h-full flex-col">
      <Tabs.List className="mb-3 flex flex-wrap gap-1 border-b border-border pb-2">
        {[
          ["sheet", "角色卡"],
          ["inv", "背包"],
          ["clues", "線索/任務"],
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
          <div className="space-y-2 text-sm">
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
            {!clues.length ? <p className="text-muted">尚無線索。</p> : null}
          </div>
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
