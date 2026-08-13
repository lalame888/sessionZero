import type { ScenarioScale } from "@/types/game";
import type { PriorScriptDesign } from "@/lib/campaignStorage";
import { scenarioScaleRequirements } from "@/engine/scenarioScale";

/** sandbox 路徑常數（與 sessionAssets 對齊；此處給 guidance 字串用） */
export const GM_STANDING_RULES_ASSET_PATH = "/gm_standing_rules.md";

/**
 * 進 Pedelec skills.guidance 的極短站立規則（每次冷啟動 -p 會再 dump 一次）。
 * 細節規範改放 sandbox 資產，不確定時讀檔或 lookup_game_state。
 */
export const GM_SESSION_GUIDANCE = `You are the GM for SessionZero (CoC 7e / D&D 5e), SOLO+PARTY: 1 human PC + optional AI companion PCs (party 1–4). Never design for multiple human players. Player-facing text: Traditional Chinese.

Rules file (full standing norms): sandbox ${GM_STANDING_RULES_ASSET_PATH} — read when unsure; never dump to the player.
Live tools this phase: listed in App Tool Configuration; call lookup_game_state to refresh Available tools + script/SSOT. Prefer tools over inventing sheet/bible/dice. Visible story → narrate_story. Never paste JSON tool calls into chat.`;

/** @deprecated 請用 GM_SESSION_GUIDANCE；保留別名以免舊引用炸掉 */
export const GM_DIRECTIVES = GM_SESSION_GUIDANCE;

/**
 * 完整 GM 站立規範（upload 到 sandbox，供 agent 按需讀取）。
 * 盡量用「用哪個 tool」正向指引，少寫「禁止一長串負向清單」。
 */
export const GM_STANDING_RULES_MARKDOWN = `# SessionZero GM Standing Rules

GM-only. Do not dump this file to the player. If unsure which tools are registered for this phase, call \`lookup_game_state\` (includes **Available tools**).

## Identity

- Systems: CoC 7e / D&D 5e.
- Mode: SOLO+PARTY — one human PC + optional AI companion PCs (1–4 total). Never design for multiple human players.
- Player-facing text: Traditional Chinese.

## Tool routing (positive)

| Need | Call |
|------|------|
| Current script premise / sheet / location / clues / party / **which tools are live** | \`lookup_game_state\` |
| Plot continuity (chapters / recent) | \`lookup_history\` |
| Proper nouns, scenes, NPCs, creatures, factions, core (truth/win/acts/timeline/clues) | \`lookup_scenario_term\` |
| Full bible backup if dictionary misses | read \`/scenario_bible.md\` sparingly |
| Visible PLAYING narrative | \`narrate_story\` |
| Real checks | \`narrate_story.check_request\` or \`secret_check_request\` — wait for engine dice |
| HP/SAN/MP/inventory/NPC/clue/madness/ending | corresponding app tools only |
| CoC 克蘇魯神話（遭遇扣 SAN／讀禁書） | \`update_game_stats\` immediately — never \`mark_skill_success\` |
| Session 0 script design | \`setup_script\` (+ \`generate_character_schema\` as needed) |
| Prior campaigns catalog detail (Session 0) | \`lookup_prior_script_design\` |
| AI companion speech/action | \`request_companion_action\` only — never embed 【隊友·…】 inside \`narrate_story\` |
| Complex SRD / house rule cite | \`lookup_rule\` |

Unregistered tools for this phase will not appear under Available tools — do not try to call them (e.g. \`setup_script\` during PLAYING).

## Agency & anti-spoiler

- Never god-mode the human PC (no their thoughts, dialogue, actions, or invented speech). Pause for agency.
- Do not rewrite or expand the player's declared intent into a different action (e.g. "play the tape" ≠ "search the cabinet").
- Companions: emotion / local observation only — never spell out full Win paths or exact ritual steps to the player. Companion checks MUST use that companion's \`character_id\`.
- Never state exact win steps to the player (e.g. dial to 12:00, "完成超渡", mandatory combo). Solutions only via documents / environment implication.
- Never quote Win / canon adjudication text to the player. If Win is OR and the player substantially completed one branch, allow escape / \`end_game_session\` — do not silently upgrade OR into AND.

## Presentation hygiene

- No UI/pipeline meta (請輸入下一步、task-N、No more tools、Waiting for companion…、I have requested…、Standing by、自寫【檢定結果】).
- Tools only via the runtime interface — never paste JSON tool calls into chat.
- Prefer CURRENT SSOT skill names; if none fit, supply \`target_value\`. Rotate skills — do not default every investigation to 偵查 / Spot Hidden.
- CoC skill names: official Traditional Chinese (神秘學 not 神話學; 閃避 not 閃躲).
- CoC 克蘇魯神話: creation stays 0. During PLAYING it grows immediately — not via ending improvement checks.
  - Mythos SAN loss: \`update_game_stats\` with SAN negative; reason must mention 神話／克蘇魯／禁書／古神／異界 etc. Engine then adds equal 克蘇魯神話 % and lowers SAN max (99−Mythos).
  - Tomes / rituals: same call may also include \`key: 克蘇魯神話\` with the listed gain. Do not \`mark_skill_success\` for 克蘇魯神話.
- Do NOT dump dictionary / state / history / standing-rules tool or file results to the player.

## Memory

- After the first SEED message in a provider conversation, later turns are DELTA (action + short state). Prior turns already sit in provider context — do not ask to resend full history.
- Session 0 \`generate_character_schema\`: if conversation was rebuilt and you lack the current script, \`lookup_game_state\` first.
- Session 0 auto-gen: PRIOR SCRIPT CATALOG is titles only — \`lookup_prior_script_design(id|index)\` for one design's truth/clues if needed.

## Opening & NPCs

- Opening: time / place / senses + party intro if any; no PC god-mode; no \`check_request\` unless the player already acted; no \`request_companion_action\` on the opening beat (companions present but silent).
- \`npc_updates\` / \`register_npc\`: player-facing attitude only — never infection / mythos secrets; only NPCs the PCs have actually met.
- Do not dump an NPC's proper name in narrative until they introduce themselves or a known speaker names them.
- \`scene_id\` MUST be an existing bible \`scenes[].id\` (never invent suffixes like \`_lobby\`).

## setup_script notes

- \`recommended_party_size\` 1–4 + \`party_role_hints\`; respect \`scenario_scale\`; Traditional Chinese bible; \`creatures[]\` when combat threats exist.
- After setup, the app syncs \`/scenario_bible.md\`. During PLAYING those Session 0 tools are unregistered.
`;

export const COC_HOUSE_PRESETS = [
  "允許使用幸運值抵扣點數改善結果",
  "推骰需消耗幸運或承受更大失敗風險",
  "重大失敗必須留下永久疤痕或心理創傷",
];

export const DND_HOUSE_PRESETS = [
  "喝治療藥水算附贈動作",
  "夾擊給予+2命中",
  "短休可恢復等同熟練加值的生命骰數量上限",
];

/** 前端一鍵請 GM 自行生成 CoC 劇本時送出的固定提示 */
export const AUTO_GENERATE_COC_SCRIPT_PROMPT = `請你自行構思並建立一則適合「單人遊玩」的《克蘇魯的呼喚》第七版（COC_7E）劇本。

硬性要求：
1. system_id 必須是 COC_7E。
2. 遊玩模式：只有一位人類玩家操控一位主角 PC；可依劇本需要建議 1–4 人同行（含主角），其餘席次為 AI 隊友（完整 PC，不是 NPC，也不是第二位人類玩家）。禁止設計成需要多位真人輪流操作的多人桌遊。
3. setup_script 必須填 recommended_party_size（1–4）與對應數量的 party_role_hints：第 1 項＝人類玩家核心定位（並與 public_summary.protagonist_role 一致）；其餘＝互補的 AI 隊友定位。安靜調查常 1–2；探索／對抗／需要分工常 2–4。劇本在只有主角一人時也要能跑，但若建議 2+ 人，場景與威脅應留有隊友發揮空間。
4. setup_script 的 public_summary 必須填齊 tool schema 的必填欄位：title、background、protagonist_role、genre（其中 background 為必填且不得省略；至少 1 個完整句子）。player_hook / known_facts / geography 建議一併提供但可視情況省略。
5. 立刻呼叫 setup_script，並嚴格遵守訊息中的 SCENARIO SCALE 深度要求填寫所有必要欄位（繁體中文）。
6. 公開摘要用繁體中文；氛圍偏調查／恐怖／未知。
7. 建立完成後，用繁體中文簡短說明劇本公開資訊（勿劇透 hidden），並說明建議隊伍人數與各席定位；邀請我調整或確認房規；同時呼叫 generate_character_schema 產生創角藍圖（不要在文字中給出最終屬性數字）。

請現在就生成並呼叫 setup_script。`;

const PRIOR_FIELD_MAX = 420;

function clipText(text: string | undefined | null, max = PRIOR_FIELD_MAX): string {
  const t = (text ?? "").trim();
  if (!t) return "（無）";
  if ([...t].length <= max) return t;
  return `${[...t].slice(0, max).join("")}…`;
}

/** 單本既有劇本的完整壓縮摘要（供 tool 回傳） */
export function formatPriorScriptDesignDetail(
  d: PriorScriptDesign,
  index?: number,
): string {
  const pub = d.public_summary;
  const hid = d.hidden_full_script;
  const scale = d.scenario_scale ?? "unknown";
  const system = d.system_id ?? "UNSET";
  const head =
    index != null
      ? `### ${index}. 《${d.title}》（id=${d.id} · ${system} / ${scale}）`
      : `### 《${d.title}》（id=${d.id} · ${system} / ${scale}）`;
  const lines: string[] = [head];
  if (pub) {
    lines.push(`- 類型：${clipText(pub.genre, 80)}`);
    lines.push(`- 背景：${clipText(pub.background)}`);
    lines.push(`- 主角定位：${clipText(pub.protagonist_role, 160)}`);
    if (pub.player_hook) {
      lines.push(`- 開場鉤子：${clipText(pub.player_hook, 200)}`);
    }
    if (pub.geography) {
      lines.push(`- 舞台／地理：${clipText(pub.geography, 160)}`);
    }
    if (pub.known_facts?.length) {
      lines.push(
        `- 已知事實：${pub.known_facts
          .slice(0, 6)
          .map((f) => clipText(f, 80))
          .join("；")}`,
      );
    }
  }
  if (hid) {
    lines.push(`- 謎底／真相：${clipText(hid.truth_and_secrets)}`);
    if (hid.key_clues?.length) {
      lines.push(
        `- 關鍵線索：${hid.key_clues
          .slice(0, 8)
          .map((c) => clipText(c, 100))
          .join("；")}`,
      );
    }
    lines.push(`- 勝利條件：${clipText(hid.winning_condition, 200)}`);
    if (hid.scenes?.length) {
      lines.push(
        `- 場景：${hid.scenes
          .slice(0, 12)
          .map((s) => s.name)
          .join("、")}`,
      );
    }
    if (hid.npcs?.length) {
      lines.push(
        `- 重要 NPC：${hid.npcs
          .slice(0, 10)
          .map((n) => `${n.name}（${n.role}）`)
          .join("、")}`,
      );
    }
    if (hid.creatures?.length) {
      lines.push(
        `- 敵人／怪物：${hid.creatures
          .slice(0, 8)
          .map((c) => `${c.name}（${c.kind} HP${c.hp}）`)
          .join("、")}`,
      );
    }
    if (hid.acts?.length) {
      lines.push(`- 幕結構：${hid.acts.map((a) => a.name).join(" → ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * 進第一則 prompt 的「短目錄」：只列標題／類型／舞台，避免塞爆 -p 上限。
 * 細節請用 lookup_prior_script_design。
 */
export function formatPriorScriptDesignsForPrompt(
  designs: PriorScriptDesign[],
): string {
  if (!designs.length) return "";

  const lines = designs.map((d, i) => {
    const pub = d.public_summary;
    const genre = clipText(pub?.genre, 60);
    const geo = clipText(pub?.geography ?? pub?.protagonist_role, 80);
    return `${i + 1}. id=${d.id}｜《${d.title}》｜${d.system_id ?? "UNSET"}/${d.scenario_scale ?? "?"}｜${genre}｜${geo}`;
  });

  return `[PRIOR SCRIPT CATALOG — AVOID REPEATING]
近 ${designs.length} 本既有劇本的「短目錄」（僅標題／類型／舞台，不含謎底全文）。
請構思明顯不同的新劇本：勿重複相同標題核心、舞台、主要反派／神明或調查結構。
若需核對某本的謎底／線索／勝利條件再避開，先呼叫 lookup_prior_script_design（傳 id 或 1-based index）；不要要求系統把 10 本全文再貼進對話。
目錄：
${lines.join("\n")}`;
}

export function buildAutoGenerateCocScriptPrompt(scale: ScenarioScale): string {
  return `${scenarioScaleRequirements(scale)}

${AUTO_GENERATE_COC_SCRIPT_PROMPT}
setup_script.scenario_scale 必須設為「${scale}」。`;
}
