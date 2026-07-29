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
  player_hook (委託／開場理由), known_facts (3–6 公開已知事實), geography (舞台範圍).
- hidden_full_script:
  - truth_and_secrets: 完整神話／陰謀說明（數段，含誰在做什麼、為何）.
  - key_clues: 6–10 條，彼此可串成調查路徑.
  - winning_condition + failure_consequences.
  - timeline: 5–10 個節點（when/what），含明確時間壓力.
  - scenes: 6–10 個；每項 id, name, summary, clues[], dangers[], linked_npc_ids[].
  - npcs: 4–8 個；每項 id, name, role, appearance?, motivation, knows, attitude_to_pc.
  - san_and_threats: 何處可能掉 SAN／主要威脅備註.
- Design for a single evening (約 2–4 小時節奏). Solo 1 PC.`;
  }
  return `SCENARIO SCALE = arc（多場次長篇）
MUST call setup_script with campaign-arc Traditional Chinese content:
- public_summary: same fields as oneshot but broader geography / longer hook.
- hidden_full_script:
  - truth_and_secrets: 多層陰謀（表面案件 + 深層神話）.
  - key_clues: 10–16 條.
  - winning_condition + failure_consequences（分階段失敗亦可寫在同一欄）.
  - acts: 3–5 幕（name, summary）.
  - timeline: 8–15 節點，跨數日／數週.
  - scenes: 12–20 個（同上欄位）.
  - npcs: 8–14 個.
  - factions: 2–5 個（id, name, goal, methods?).
  - san_and_threats: 分階段威脅.
- Solo 1 PC; pacing for multiple sessions.`;
}
