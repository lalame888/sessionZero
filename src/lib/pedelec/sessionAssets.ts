import type { PedelecSession, SandboxAssetPath } from "@kaoruisaac/pedelec";
import { formatFullScenarioBible } from "@/engine/scenarioLorebook";
import {
  GM_STANDING_RULES_ASSET_PATH as GM_RULES_PATH_CONST,
  GM_STANDING_RULES_MARKDOWN,
} from "@/prompts/gmDirectives";
import { sanitizePublicGeography } from "@/engine/publicGeography";
import type { ScriptState } from "@/types/game";

/** sandbox assets/ 下的劇本 bible 路徑（SDK 路徑以 / 開頭） */
export const SCENARIO_BIBLE_ASSET_PATH =
  "/scenario_bible.md" as SandboxAssetPath;

/** 完整 GM 站立規範（與 gmDirectives 常數同路徑） */
export const GM_STANDING_RULES_ASSET_PATH =
  GM_RULES_PATH_CONST as SandboxAssetPath;

/** 給 turn prompt 的 lore 指示（字典優先，整檔為後備） */
export const SCENARIO_BIBLE_READ_HINT = `Prefer lookup_scenario_term for proper nouns / scenes / NPCs / creatures / factions / core (truth, win, acts, timeline). ${SCENARIO_BIBLE_ASSET_PATH} is full GM-only backup — use only if the dictionary misses. Never dump bible text to the player.`;

/** 給 turn prompt：規範檔在 sandbox，細節勿重塞 guidance */
export const GM_STANDING_RULES_READ_HINT = `Full standing rules: read ${GM_STANDING_RULES_ASSET_PATH} when unsure. lookup_game_state lists Available tools for this phase. Never dump rules files to the player.`;

let uploadChain: Promise<void> = Promise.resolve();
let lastUploadedFingerprint: string | null = null;
let standingRulesUploaded = false;

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
    pub?.geography
      ? `Geography: ${sanitizePublicGeography(pub.geography) ?? pub.geography}`
      : null,
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

  // IMPORTANT:
  // syncScenarioBibleAsset 會在 tool handler 裡被「不 await」地呼叫。
  // 因此任何重計算（formatFullScenarioBible）都必須放到 uploadChain 裡，
  // 避免阻塞 tool call 回傳，造成 provider 卡在 waiting_tool_result。
  const job = uploadChain.then(async () => {
    if (!opts?.force && fp === lastUploadedFingerprint) return;
    const body = formatScenarioBibleAssetMarkdown(script);
    if (!body) return;
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

/** 每個新 session 上傳一次完整站立規範（靜態內容） */
export function syncGmStandingRulesAsset(
  session: PedelecSession<string>,
  opts?: { force?: boolean },
): Promise<void> {
  if (!opts?.force && standingRulesUploaded) {
    return Promise.resolve();
  }

  const job = uploadChain.then(async () => {
    if (!opts?.force && standingRulesUploaded) return;
    const file = new File([GM_STANDING_RULES_MARKDOWN], "gm_standing_rules.md", {
      type: "text/markdown;charset=utf-8",
    });
    await session.uploadAsset(file, GM_STANDING_RULES_ASSET_PATH);
    standingRulesUploaded = true;
  });

  uploadChain = job.catch(() => {
    // 允許後續重試
  });

  return job;
}

export function resetScenarioBibleAssetCache() {
  lastUploadedFingerprint = null;
  standingRulesUploaded = false;
  uploadChain = Promise.resolve();
}
