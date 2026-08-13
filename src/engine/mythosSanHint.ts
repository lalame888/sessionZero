import type { ScenarioCreature } from "@/types/game";

const HALF_COCOON_RE =
  /半絲繭|半人半繭|絲繭化|下半身.{0,12}絲繭|與.{0,8}絲繭同化|微光絲繭同化/;
const HATCH_RE = /破繭|主繭.{0,16}(裂|撕|破)|撕開.{0,10}繭|破繭而出/;

const seenMythosSightingKeys = new Set<string>();

export function resetMythosSanSightings() {
  seenMythosSightingKeys.clear();
}

function recentLooksLikeSanLoss(texts: string[]): boolean {
  return texts.some((t) =>
    /SAN\s*[-−+]\s*\d|理智.{0,8}[-−]|扣除.{0,6}SAN|SAN.{0,6}損失|神話 SAN|目擊神話|update_game_stats/.test(
      t,
    ),
  );
}

/** 解析「1/1D8」「0/1D4 SAN」等目擊公式 */
export function parseSanLossFormula(
  raw?: string | null,
): { successLoss: number; failDice: string } | null {
  if (!raw?.trim()) return null;
  const m = raw.match(/(\d+)\s*[/／]\s*(\d*d\d+(?:[+-]\d+)?)/i);
  if (!m?.[1] || !m[2]) return null;
  let die = m[2].trim();
  if (/^d/i.test(die)) die = `1${die}`;
  return { successLoss: Number(m[1]), failDice: die };
}

function coreNameTokens(name: string): string[] {
  const stripped = name
    .replace(/[（(].*?[）)]/g, " ")
    .replace(/的分支眷族|眷族/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = new Set<string>();
  if (stripped.length >= 2) out.add(stripped);
  for (const part of stripped.split(/[\s·・、,，]/)) {
    const p = part.trim();
    if (p.length >= 2) out.add(p);
  }
  return [...out];
}

export function narrativeMentionsCreature(
  text: string,
  creature: ScenarioCreature,
): boolean {
  if (creature.id && text.includes(creature.id)) return true;
  const names = [creature.name, ...coreNameTokens(creature.name ?? "")].filter(
    Boolean,
  );
  return names.some((n) => n.length >= 2 && text.includes(n));
}

export type MythosSanSighting = {
  key: string;
  label: string;
  successLoss: number;
  failDice: string;
};

/** 敘事是否出現應扣 SAN 的目擊（模糊名＋半繭／破繭） */
export function detectMythosSanSighting(input: {
  narrative: string;
  creatures?: ScenarioCreature[] | null;
  sanAndThreats?: string | null;
  recentSystemTexts?: string[];
}): MythosSanSighting | null {
  const text = input.narrative.trim();
  if (!text) return null;
  if (recentLooksLikeSanLoss(input.recentSystemTexts ?? [])) return null;

  const creatures = input.creatures ?? [];
  const tropesFormula =
    parseSanLossFormula(input.sanAndThreats) ?? {
      successLoss: 1,
      failDice: "1d4",
    };

  if (HALF_COCOON_RE.test(text) && !seenMythosSightingKeys.has("half-cocoon")) {
    return {
      key: "half-cocoon",
      label: "半人半繭／絲繭化受害者",
      successLoss: tropesFormula.successLoss,
      failDice: tropesFormula.failDice,
    };
  }

  const mentioned = creatures.filter(
    (c) => c.san_loss_on_sight?.trim() && narrativeMentionsCreature(text, c),
  );
  if (!mentioned.length && HATCH_RE.test(text)) {
    const mythos = creatures.find((c) => c.san_loss_on_sight?.trim());
    if (mythos) mentioned.push(mythos);
  }

  for (const c of mentioned) {
    const key = `creature:${c.id || c.name}`;
    if (seenMythosSightingKeys.has(key)) continue;
    const formula =
      parseSanLossFormula(c.san_loss_on_sight) ?? tropesFormula;
    return {
      key,
      label: c.name,
      successLoss: formula.successLoss,
      failDice: formula.failDice,
    };
  }

  return null;
}

export function markMythosSanSightingSeen(key: string) {
  seenMythosSightingKeys.add(key);
}

/** 僅提示用（相容舊呼叫） */
export function mythosSanHintFromNarrative(input: {
  narrative: string;
  creatures?: ScenarioCreature[] | null;
  recentSystemTexts?: string[];
  sanAndThreats?: string | null;
}): string | null {
  const hit = detectMythosSanSighting(input);
  if (!hit) return null;
  return `MYTHOS SAN DUE: on-screen ${hit.label}（${hit.successLoss}/${hit.failDice}）. Engine will queue 理智 if you omit it. Reason must mention 神話／克蘇魯／異界.`;
}
