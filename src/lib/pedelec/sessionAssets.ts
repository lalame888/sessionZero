import type { PedelecSession, SandboxAssetPath } from "@kaoruisaac/pedelec";
import { formatFullScenarioBible } from "@/engine/scenarioLorebook";
import type { ScriptState } from "@/types/game";

/** sandbox assets/ 下的劇本 bible 路徑（SDK 路徑以 / 開頭） */
export const SCENARIO_BIBLE_ASSET_PATH =
  "/scenario_bible.md" as SandboxAssetPath;

/** 給 turn prompt 的 lore 指示（字典優先，整檔為後備） */
export const SCENARIO_BIBLE_READ_HINT = `Prefer lookup_scenario_term for proper nouns / scenes / NPCs / creatures / factions / core (truth, win, acts, timeline). ${SCENARIO_BIBLE_ASSET_PATH} is full GM-only backup — use only if the dictionary misses. Never dump bible text to the player.`;

let uploadChain: Promise<void> = Promise.resolve();
let lastUploadedFingerprint: string | null = null;

function fingerprintScript(script: ScriptState): string {
  const h = script.hidden_full_script;
  if (!h) return "";
  return [
    script.system_id ?? "",
    script.public_summary?.title ?? "",
    h.truth_and_secrets.slice(0, 80),
    h.winning_condition.slice(0, 80),
    String(h.scenes?.length ?? 0),
    String(h.npcs?.length ?? 0),
    String(h.creatures?.length ?? 0),
    String(h.key_clues?.length ?? 0),
  ].join("|");
}

export function formatScenarioBibleAssetMarkdown(script: ScriptState): string | null {
  const hidden = script.hidden_full_script;
  if (!hidden) return null;
  const pub = script.public_summary;
  const header = [
    "# SessionZero Scenario Bible (GM ONLY — NEVER REVEAL DIRECTLY)",
    "",
    `System: ${script.system_id ?? "UNSET"}`,
    `Scale: ${script.scenario_scale ?? "unknown"}`,
    pub?.title ? `Title: ${pub.title}` : null,
    pub?.genre ? `Genre: ${pub.genre}` : null,
    pub?.geography ? `Geography: ${pub.geography}` : null,
    pub?.player_hook ? `Player hook: ${pub.player_hook}` : null,
    pub?.known_facts?.length
      ? `Known facts:\n${pub.known_facts.map((f) => `- ${f}`).join("\n")}`
      : null,
    "",
    "## Hidden full script",
    "",
    formatFullScenarioBible(hidden),
  ]
    .filter((line) => line != null)
    .join("\n");
  return header;
}

/**
 * 將目前劇本 bible upload 到 session sandbox。
 * 同一時間只跑一個 upload（串接 Promise）；內容未變則跳過。
 */
export function syncScenarioBibleAsset(
  session: PedelecSession<string>,
  script: ScriptState,
  opts?: { force?: boolean },
): Promise<void> {
  const fp = fingerprintScript(script);
  if (!fp) return Promise.resolve();
  if (!opts?.force && fp === lastUploadedFingerprint) {
    return Promise.resolve();
  }

  const body = formatScenarioBibleAssetMarkdown(script);
  if (!body) return Promise.resolve();

  const job = uploadChain.then(async () => {
    if (!opts?.force && fp === lastUploadedFingerprint) return;
    const file = new File([body], "scenario_bible.md", {
      type: "text/markdown;charset=utf-8",
    });
    await session.uploadAsset(file, SCENARIO_BIBLE_ASSET_PATH);
    lastUploadedFingerprint = fp;
  });

  uploadChain = job.catch(() => {
    // 允許後續重試
  });

  return job;
}

export function resetScenarioBibleAssetCache() {
  lastUploadedFingerprint = null;
  uploadChain = Promise.resolve();
}
