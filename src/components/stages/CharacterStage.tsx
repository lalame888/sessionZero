import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/ui/hover-tooltip";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  evalAttrFormula,
  normalizeCreationMode,
  pointBuyCost,
  resolveSkillBaseValue,
  rollCreationFormula,
  totalPointBuySpent,
} from "@/engine/creation";
import { migrateCharacterSheet } from "@/engine/formulas";
import {
  exportCharacterJson,
  loadCharacterLibrary,
  saveCharacterToLibrary,
} from "@/lib/storage";
import { useGameStore } from "@/store/useGameStore";
import type { UniversalCharacterSheet } from "@/types/game";

type SkillSpend = Record<string, { occ: number; interest: number }>;

export function CharacterStage() {
  const character = useGameStore((s) => s.character);
  const schema = useGameStore((s) => s.characterSchema);
  const script = useGameStore((s) => s.script);
  const setCharacter = useGameStore((s) => s.setCharacter);
  const updateCharacterField = useGameStore((s) => s.updateCharacterField);
  const confirmCharacterAndPlay = useGameStore((s) => s.confirmCharacterAndPlay);
  const appendSystem = useGameStore((s) => s.appendSystem);
  const fileRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(() => loadCharacterLibrary());

  const mode = normalizeCreationMode(
    schema?.creation_mode ?? script.recommended_creation_mode,
  );
  const defs = schema?.attribute_defs ?? [];
  const attrKeys = defs.map((d) => d.key);

  const [rolledPool, setRolledPool] = useState<number[]>([]);
  const [rollLog, setRollLog] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, number | "">>(
    {},
  );
  const [skillSpend, setSkillSpend] = useState<SkillSpend>({});
  const [highSkillWarned, setHighSkillWarned] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setRolledPool([]);
    setRollLog([]);
    setAssignments({});
    setSkillSpend({});
    setHighSkillWarned(new Set());
  }, [schema?.creation_mode, schema?.recommended_skills?.length]);

  const modeConfig = schema?.mode_config;
  const pointBuy = schema?.point_buy;
  const arrayValues =
    schema?.standard_array ?? modeConfig?.standard_array ?? [];

  const spentPoints = useMemo(() => {
    if (!pointBuy || !character) return 0;
    return totalPointBuySpent(character.attributes, attrKeys, pointBuy);
  }, [character, attrKeys, pointBuy]);

  const occBudget = useMemo(() => {
    if (!character) return 0;
    const formula =
      modeConfig?.occupational_point_formula ??
      (character.system_id === "COC_7E" ? "EDU * 4" : "");
    if (!formula) return schema?.skill_points ?? 0;
    return evalAttrFormula(formula, character.attributes);
  }, [character, modeConfig, schema?.skill_points]);

  const interestBudget = useMemo(() => {
    if (!character) return 0;
    const formula =
      modeConfig?.interest_point_formula ??
      (character.system_id === "COC_7E" ? "INT * 2" : "");
    if (!formula) return 0;
    return evalAttrFormula(formula, character.attributes);
  }, [character, modeConfig]);

  const occUsed = useMemo(
    () => Object.values(skillSpend).reduce((a, b) => a + b.occ, 0),
    [skillSpend],
  );
  const interestUsed = useMemo(
    () => Object.values(skillSpend).reduce((a, b) => a + b.interest, 0),
    [skillSpend],
  );

  const usedArrayIndices = useMemo(() => {
    const used = new Set<number>();
    for (const v of Object.values(assignments)) {
      if (v !== "" && v != null) used.add(Number(v));
    }
    return used;
  }, [assignments]);

  const recommendedSkills = useMemo(() => {
    if (!schema?.recommended_skills?.length || !character) return [];
    return schema.recommended_skills.map((sk) => ({
      ...sk,
      base_value: resolveSkillBaseValue(
        character.system_id,
        sk.name,
        sk.base_value,
      ),
    }));
  }, [schema?.recommended_skills, character]);

  const hookQuestions = schema?.background_questions ?? [];

  const hooksReady = useMemo(() => {
    if (!character || !hookQuestions.length) return true;
    return hookQuestions.every((q) =>
      (character.backstory_hooks[q.id] ?? "").trim(),
    );
  }, [character, hookQuestions]);

  if (!character) {
    return <p className="text-sm text-muted">等待劇本與創角規則…</p>;
  }

  const isDnd = character.system_id === "DND_5E";
  const isCoc = character.system_id === "COC_7E";
  const attrsReady = attrKeys.every((k) => (character.attributes[k] ?? 0) > 0);

  const applyAttributes = (next: Record<string, number>) => {
    updateCharacterField((s) => ({
      ...s,
      attributes: { ...s.attributes, ...next },
      // 屬性重算時重置衍生資源 max，讓 recomputeDerived 重新灌滿 current
      derived: {
        ...s.derived,
        hp: { current: 0, max: 0 },
        mp_or_slots: { current: 0, max: 0 },
        san: { current: 0, max: 0 },
      },
    }));
  };

  const rollAllDice = () => {
    const pool: number[] = [];
    const logs: string[] = [];
    for (const def of defs) {
      const formula = def.dice_formula || (isDnd ? "4d6dl1" : "3d6x5");
      const r = rollCreationFormula(formula);
      pool.push(r.total);
      logs.push(`${def.label}: ${r.detail}`);
    }
    setRolledPool(pool);
    setRollLog(logs);
    setAssignments({});
    // DICE：直接鎖定套用，不可手改
    const next: Record<string, number> = {};
    attrKeys.forEach((k, i) => {
      next[k] = pool[i] ?? 0;
    });
    applyAttributes(next);
    appendSystem(
      mode === "SKILL_ALLOC"
        ? "已擲骰產生基礎屬性（鎖定），接著分配職業／興趣技能點。"
        : "已完成擲骰並鎖定屬性。若要重骰可再按一次。",
    );
  };

  /** ARRAY：選擇時即時套用，互斥 */
  const setArrayAssignment = (key: string, idxOrEmpty: number | "") => {
    const nextAssign = { ...assignments, [key]: idxOrEmpty };
    setAssignments(nextAssign);
    const next: Record<string, number> = {};
    let complete = true;
    for (const k of attrKeys) {
      const v = nextAssign[k];
      if (v === "" || v == null) {
        complete = false;
        continue;
      }
      next[k] = arrayValues[Number(v)] ?? 0;
    }
    if (complete && Object.keys(next).length === attrKeys.length) {
      applyAttributes(next);
    }
  };

  const canPointBuyAdjust = (key: string, newScore: number) => {
    if (!pointBuy) return false;
    if (newScore < pointBuy.min_score || newScore > pointBuy.max_score) {
      return false;
    }
    const trial = { ...character.attributes, [key]: newScore };
    return totalPointBuySpent(trial, attrKeys, pointBuy) <= pointBuy.budget;
  };

  const adjustPointBuy = (key: string, score: number) => {
    if (!canPointBuyAdjust(key, score)) return;
    applyAttributes({ [key]: score });
  };

  const syncSkillsFromSpend = (spend: SkillSpend) => {
    updateCharacterField((sheet) => {
      const skills = { ...sheet.skills };
      for (const sk of recommendedSkills) {
        const extra = spend[sk.name] ?? { occ: 0, interest: 0 };
        skills[sk.name] = sk.base_value + extra.occ + extra.interest;
      }
      return { ...sheet, skills };
    });
  };

  const adjustSkill = (
    name: string,
    pool: "occ" | "interest",
    delta: number,
  ) => {
    const sk = recommendedSkills.find((s) => s.name === name);
    if (!sk) return;
    if (pool === "occ" && !sk.is_occupational) {
      appendSystem("職業點只能花在職業技能上。");
      return;
    }
    const cur = skillSpend[name] ?? { occ: 0, interest: 0 };
    const nextVal = Math.max(0, cur[pool] + delta);
    const trial = { ...skillSpend, [name]: { ...cur, [pool]: nextVal } };
    const nextOcc = Object.values(trial).reduce((a, b) => a + b.occ, 0);
    const nextInt = Object.values(trial).reduce((a, b) => a + b.interest, 0);
    if (nextOcc > occBudget) {
      appendSystem(`職業點不足（${occUsed}/${occBudget}）。`);
      return;
    }
    if (nextInt > interestBudget) {
      appendSystem(`興趣點不足（${interestUsed}/${interestBudget}）。`);
      return;
    }
    const finalSkill = sk.base_value + trial[name].occ + trial[name].interest;
    if (finalSkill > 80 && !highSkillWarned.has(name)) {
      appendSystem(
        `注意：${name} 將達 ${finalSkill}%（>80）。高技能在 CoC 極具優勢，但也更難成長。`,
      );
      setHighSkillWarned((s) => new Set(s).add(name));
    }
    setSkillSpend(trial);
    syncSkillsFromSpend(trial);
  };

  const canConfirm =
    Boolean(character.name.trim()) &&
    Boolean(character.role_title.trim()) &&
    attrsReady &&
    hooksReady &&
    (mode !== "POINT_BUY" ||
      (pointBuy != null && spentPoints <= pointBuy.budget)) &&
    ((mode !== "SKILL_ALLOC" && !isCoc) ||
      (occUsed <= occBudget && interestUsed <= interestBudget));

  /** CoC 無論屬性模式為何，創角後都應可分配職業／興趣技能點 */
  const showSkillAlloc = Boolean(
    schema && attrsReady && (mode === "SKILL_ALLOC" || isCoc),
  );

  return (
    <div className="space-y-4 overflow-y-auto p-1 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => exportCharacterJson(character)}
          disabled={!attrsReady}
        >
          匯出 JSON
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
          匯入 JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const text = await file.text();
              const parsed = JSON.parse(text) as UniversalCharacterSheet;
              setCharacter(migrateCharacterSheet(parsed));
              appendSystem(`已匯入角色：${parsed.name}`);
            } catch {
              appendSystem("匯入失敗：JSON 格式無效。");
            }
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!attrsReady || !character.name}
          onClick={() => {
            saveCharacterToLibrary(character);
            setLibrary(loadCharacterLibrary());
            appendSystem("已存入本機角色檔案庫。");
          }}
        >
          存入檔案庫
        </Button>
      </div>

      {library.length ? (
        <div className="space-y-1">
          <Label>本機檔案庫</Label>
          <div className="flex flex-wrap gap-2">
            {library.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="ghost"
                onClick={() => setCharacter(migrateCharacterSheet(c))}
              >
                {c.name}（{c.system_id}）
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>姓名</Label>
          <Input
            value={character.name}
            onChange={(e) =>
              updateCharacterField((s) => ({ ...s, name: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label>職稱 / 種族職業</Label>
          <Input
            value={character.role_title}
            placeholder={schema?.role_title_suggestion || ""}
            onChange={(e) =>
              updateCharacterField((s) => ({ ...s, role_title: e.target.value }))
            }
          />
        </div>
      </div>

      {/* ═══ 雙軌：Stats | Hooks ═══ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stats track */}
        <section className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <div className="text-sm font-medium text-ink">數值面板</div>
            <p className="text-[11px] text-muted">
              依規則分配屬性／技能；衍生值由 MathJS 即時計算。
            </p>
          </div>

          {schema && (mode === "DICE" || mode === "SKILL_ALLOC") ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs">
                  {mode === "DICE" ? "物理擲骰（結果鎖定）" : "基礎屬性擲骰"}
                </Label>
                <Button size="sm" onClick={rollAllDice}>
                  {rolledPool.length ? "重新擲骰" : "開始擲骰"}
                </Button>
              </div>
              {rollLog.length ? (
                <ul className="space-y-0.5 text-[10px] text-muted">
                  {rollLog.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {defs.map((d) => (
                  <div
                    key={d.key}
                    className="rounded bg-bg/40 px-2 py-1 text-xs"
                  >
                    <div className="text-muted">
                      {d.label}
                      <span className="ml-1 opacity-60">
                        {d.dice_formula}
                      </span>
                    </div>
                    <div className="text-ink">
                      {character.attributes[d.key] || "—"}
                      {isDnd &&
                      character.attribute_modifiers?.[`${d.key}_MOD`] != null
                        ? `（${(character.attribute_modifiers[`${d.key}_MOD`] ?? 0) >= 0 ? "+" : ""}${character.attribute_modifiers[`${d.key}_MOD`]}）`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {schema && mode === "ARRAY" ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <Label className="text-xs">
                標準陣列（互斥）[{arrayValues.join(", ")}]
              </Label>
              <div className="grid gap-2">
                {defs.map((d) => (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs">{d.label}</span>
                    <select
                      className="h-9 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                      value={assignments[d.key] ?? ""}
                      onChange={(e) =>
                        setArrayAssignment(
                          d.key,
                          e.target.value === ""
                            ? ""
                            : Number(e.target.value),
                        )
                      }
                    >
                      <option value="">選擇分數</option>
                      {arrayValues.map((v, idx) => {
                        const taken =
                          usedArrayIndices.has(idx) &&
                          assignments[d.key] !== idx;
                        return (
                          <option
                            key={`${d.key}-${idx}`}
                            value={idx}
                            disabled={taken}
                          >
                            {v}
                            {taken ? "（已用）" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {schema && mode === "POINT_BUY" && pointBuy ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <Label className="text-xs">
                購點制：已用 {spentPoints} / {pointBuy.budget}（
                {pointBuy.min_score}–{pointBuy.max_score}）
              </Label>
              <div className="grid gap-2">
                {defs.map((d) => {
                  const score =
                    character.attributes[d.key] || pointBuy.min_score;
                  const canMinus = canPointBuyAdjust(d.key, score - 1);
                  const canPlus = canPointBuyAdjust(d.key, score + 1);
                  return (
                    <div
                      key={d.key}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="w-14">{d.label}</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canMinus}
                        onClick={() => adjustPointBuy(d.key, score - 1)}
                      >
                        −
                      </Button>
                      <span className="w-8 text-center text-ink">{score}</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canPlus}
                        onClick={() => adjustPointBuy(d.key, score + 1)}
                      >
                        +
                      </Button>
                      <span className="text-muted">
                        花費 {pointBuyCost(score, pointBuy)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showSkillAlloc ? (
            <div className="space-y-2 rounded border border-border/70 bg-bg/20 p-2">
              <Label className="text-xs">
                技能雙點池 — 職業 {occUsed}/{occBudget}
                {interestBudget > 0
                  ? ` · 興趣 ${interestUsed}/${interestBudget}`
                  : ""}
              </Label>
              <p className="text-[10px] text-muted">
                職業點僅能加在職業技能；興趣點可加在任何技能。單技 &gt;80%
                會提示。
              </p>
              <div className="space-y-2">
                {recommendedSkills.map((sk) => {
                  const value = character.skills[sk.name] ?? sk.base_value;
                  const over80 = value > 80;
                  return (
                    <div
                      key={sk.name}
                      className="rounded bg-bg/30 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-1">
                        <div className="min-w-[7rem] flex-1">
                          <HoverTooltip
                            header={sk.name}
                            content={sk.description ?? ""}
                          >
                            <div className="text-xs text-ink underline decoration-dotted decoration-muted underline-offset-2">
                              {sk.name}
                              {sk.is_occupational ? (
                                <span className="ml-1 text-[10px] text-accent-2 no-underline">
                                  職業
                                </span>
                              ) : null}
                            </div>
                          </HoverTooltip>
                        </div>
                        <span
                          className={`w-10 text-center text-sm ${over80 ? "text-amber-400" : "text-ink"}`}
                        >
                          {value}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {sk.is_occupational ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={occUsed >= occBudget}
                              onClick={() => adjustSkill(sk.name, "occ", 1)}
                            >
                              +職業
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={(skillSpend[sk.name]?.occ ?? 0) <= 0}
                              onClick={() => adjustSkill(sk.name, "occ", -1)}
                            >
                              −職業
                            </Button>
                          </>
                        ) : null}
                        {interestBudget > 0 ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={interestUsed >= interestBudget}
                              onClick={() =>
                                adjustSkill(sk.name, "interest", 1)
                              }
                            >
                              +興趣
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                (skillSpend[sk.name]?.interest ?? 0) <= 0
                              }
                              onClick={() =>
                                adjustSkill(sk.name, "interest", -1)
                              }
                            >
                              −興趣
                            </Button>
                          </>
                        ) : null}
                      </div>
                      {over80 ? (
                        <p className="mt-1 text-[10px] text-amber-400/90">
                          警告：超過 80%，成長檢定將更困難。
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {schema &&
          (mode === "SKILL_ALLOC" || isCoc) &&
          !attrsReady ? (
            <p className="text-xs text-muted">請先完成屬性，再開啟技能分配。</p>
          ) : null}

          {attrsReady ? (
            <div className="rounded border border-border bg-surface-2 p-2 text-xs">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
                衍生數值
              </div>
              <div>
                HP {character.derived.hp.current}/{character.derived.hp.max}
              </div>
              {character.derived.san ? (
                <div>
                  SAN {character.derived.san.current}/
                  {character.derived.san.max}
                </div>
              ) : null}
              {character.derived.mp_or_slots ? (
                <div>
                  MP {character.derived.mp_or_slots.current}/
                  {character.derived.mp_or_slots.max}
                </div>
              ) : null}
              {character.derived.dodge != null && isCoc ? (
                <div>閃避 {character.derived.dodge}</div>
              ) : null}
              {isDnd ? (
                <div>
                  AC {character.derived.ac} · 熟練 +
                  {character.derived.proficiency_bonus}
                </div>
              ) : null}
            </div>
          ) : null}

          {!isCoc &&
          mode !== "SKILL_ALLOC" &&
          recommendedSkills.length ? (
            <div className="space-y-1 text-xs text-muted">
              <div>推薦技能基礎值：</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {recommendedSkills.map((s) => (
                  <HoverTooltip
                    key={s.name}
                    header={s.name}
                    content={s.description ?? ""}
                  >
                    <span className="underline decoration-dotted decoration-muted underline-offset-2 text-ink/90">
                      {s.name} {s.base_value}
                    </span>
                  </HoverTooltip>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Hooks track */}
        <section className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <div className="text-sm font-medium text-ink">劇情鉤子</div>
            <p className="text-[11px] text-muted">
              {isCoc
                ? "狂氣發作時 GM 會讀取這些錨點發動精神衝擊。"
                : "GM 依特質／理想／羈絆／缺點頒發靈感與觸發專屬 NPC。"}
            </p>
          </div>

          {hookQuestions.length ? (
            <div className="space-y-3">
              {hookQuestions.map((q) => (
                <div key={q.id} className="space-y-1">
                  <Label className="text-xs">
                    <span className="text-accent-2">{q.category}</span>
                    <span className="ml-1 font-normal text-muted">
                      — {q.question}
                    </span>
                  </Label>
                  <Textarea
                    rows={3}
                    placeholder={`寫下你的「${q.category}」…`}
                    value={character.backstory_hooks[q.id] ?? ""}
                    onChange={(e) =>
                      updateCharacterField((s) => ({
                        ...s,
                        backstory_hooks: {
                          ...s.backstory_hooks,
                          [q.id]: e.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted">
              選擇創角方式後，將產生系統對應的鉤子問題。
            </p>
          )}

          <div className="space-y-1 border-t border-border/60 pt-3">
            <Label className="text-xs">起始背包</Label>
            <Textarea
              rows={3}
              value={character.inventory.join("\n")}
              onChange={(e) =>
                updateCharacterField((s) => ({
                  ...s,
                  inventory: e.target.value
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean),
                }))
              }
            />
          </div>
        </section>
      </div>

      <Button disabled={!canConfirm} onClick={() => confirmCharacterAndPlay()}>
        確認角色，開始冒險
      </Button>
      {!canConfirm ? (
        <p className="text-xs text-muted">
          需填寫姓名／職稱、完成屬性規則，並寫完所有劇情鉤子
          {isCoc || mode === "SKILL_ALLOC"
            ? "（技能點不可超支）"
            : ""}
          。
        </p>
      ) : null}
    </div>
  );
}
