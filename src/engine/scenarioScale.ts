import type { ScenarioScale } from "@/types/game";

export const SCENARIO_SCALE_LABELS: Record<ScenarioScale, string> = {
  seed: "種子大綱",
  oneshot: "一晚短篇（正規）",
  arc: "多場次長篇",
};

export const SCENARIO_SCALE_HINTS: Record<ScenarioScale, string> = {
  seed:
    "1 頁種子：公開簡介 + 一句真相 + 少數線索。適合快速開打、細節交給遊玩即興。",
  oneshot:
    "正規一晚局：時間線、6–10 場景、4–8 NPC、線索網與失敗後果。接近可跑短模組大綱。",
  arc:
    "多場次：分幕結構、12+ 場景、勢力、更長時間線。適合連載數場的調查弧。",
};

export function normalizeScenarioScale(
  raw: string | null | undefined,
): ScenarioScale {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "oneshot" || s === "one_shot" || s === "one-shot" || s === "短篇") {
    return "oneshot";
  }
  if (s === "arc" || s === "campaign" || s === "長篇" || s === "連載") {
    return "arc";
  }
  return "seed";
}

/** 寫入給 AI 的規模需求（繁中 + 英文欄位名對照） */
export function scenarioScaleRequirements(scale: ScenarioScale): string {
  if (scale === "seed") {
    return `SCENARIO SCALE = seed（種子大綱）
- Fill setup_script with concise fields only.
- public_summary: title, background (2–4 sentences), protagonist_role, genre. Optional short player_hook.
- hidden_full_script: truth_and_secrets (1–3 sentences), key_clues (3–5), winning_condition.
- Do NOT invent long scene/NPC lists for seed.`;
  }
  if (scale === "oneshot") {
    return `SCENARIO SCALE = oneshot（一晚正規短篇）
MUST call setup_script with richer Traditional Chinese content:
- public_summary: title, background (1 short paragraph), protagonist_role, genre,
  player_hook (委託／開場理由), known_facts (3–6 公開已知事實), geography (公開舞台地名即可，如「宜蘭縣龜山島」；禁止列出碼頭／坑道／場景清單，那些只寫 hidden scenes).
- hidden_full_script:
  - truth_and_secrets: 完整神話／陰謀說明（數段，含誰在做什麼、為何）.
  - key_clues: 6–10 條，彼此可串成調查路徑.
  - winning_condition + failure_consequences.
  - timeline: 5–10 個節點（when/what），含明確時間壓力.
  - scenes: 6–10 個；每項 id, name, summary, clues[], dangers[], linked_npc_ids[].
  - npcs: 4–8 個；每項 id, name, role, appearance?, motivation, knows, attitude_to_pc.
  - creatures: 若劇本含敵對人類／怪物／神話生物且可能開戰，MUST 填 1+ 筆戰鬥數值：
    id, name, kind(human|monster|mythos), hp, armor?, attributes?, attacks[{name,skill_pct,damage}],
    san_loss_on_sight?, powers?, combat_notes?, linked_npc_id?.
    這是 Keeper SSOT；遊玩時敵方攻擊與傷害必須依此，不可即興亂改 HP／傷害。
  - san_and_threats: 何處可能掉 SAN／主要威脅備註.
- Design for a single evening (約 2–4 小時節奏). 1 human PC + optional AI companions (party 1–4); still runnable solo.`;
  }
  return `SCENARIO SCALE = arc（多場次長篇）
MUST call setup_script with campaign-arc Traditional Chinese content:
- public_summary: same fields as oneshot but a wider public place name / longer hook (still no scene list in geography).
- hidden_full_script:
  - truth_and_secrets: 多層陰謀（表面案件 + 深層神話）.
  - key_clues: 10–16 條.
  - winning_condition + failure_consequences（分階段失敗亦可寫在同一欄）.
  - acts: 3–5 幕（name, summary）.
  - timeline: 8–15 節點，跨數日／數週.
  - scenes: 12–20 個（同上欄位）.
  - npcs: 8–14 個.
  - creatures: 各幕主要敵人／怪物戰鬥區塊（同上 oneshot 欄位；可跨場复用 id）.
  - factions: 2–5 個（id, name, goal, methods?).
  - san_and_threats: 分階段威脅.
- 1 human PC + optional AI companions (party 1–4); pacing for multiple sessions.`;
}

export type ScenarioScaleGap = {
  field: string;
  have: number;
  wantMin: number;
  wantMax?: number;
};

/** 檢查 bible 深度是否低於所選規模下限（給 setup 後系統提示用） */
export function assessScenarioScaleGaps(input: {
  scale: ScenarioScale | string | null | undefined;
  key_clues?: string[] | null;
  timeline?: unknown[] | null;
  scenes?: unknown[] | null;
  npcs?: unknown[] | null;
  creatures?: unknown[] | null;
  acts?: unknown[] | null;
  factions?: unknown[] | null;
}): ScenarioScaleGap[] {
  const scale = normalizeScenarioScale(
    typeof input.scale === "string" ? input.scale : input.scale ?? undefined,
  );
  const count = (arr: unknown[] | null | undefined) => arr?.length ?? 0;
  const gaps: ScenarioScaleGap[] = [];
  const push = (
    field: string,
    have: number,
    wantMin: number,
    wantMax?: number,
  ) => {
    if (have < wantMin) gaps.push({ field, have, wantMin, wantMax });
  };

  if (scale === "seed") {
    push("key_clues", count(input.key_clues), 3, 5);
    return gaps;
  }
  if (scale === "oneshot") {
    push("key_clues", count(input.key_clues), 6, 10);
    push("timeline", count(input.timeline), 5, 10);
    push("scenes", count(input.scenes), 6, 10);
    push("npcs", count(input.npcs), 4, 8);
    return gaps;
  }
  // arc
  push("key_clues", count(input.key_clues), 10, 16);
  push("timeline", count(input.timeline), 8, 15);
  push("scenes", count(input.scenes), 12, 20);
  push("npcs", count(input.npcs), 8, 14);
  push("acts", count(input.acts), 3, 5);
  push("factions", count(input.factions), 2, 5);
  return gaps;
}

export function formatScenarioScaleGapsZh(gaps: ScenarioScaleGap[]): string {
  if (!gaps.length) return "";
  return gaps
    .map((g) => {
      const range =
        g.wantMax != null ? `${g.wantMin}–${g.wantMax}` : `≥${g.wantMin}`;
      return `${g.field} ${g.have}（建議 ${range}）`;
    })
    .join("、");
}
