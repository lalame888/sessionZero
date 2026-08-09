import type { ScenarioScale } from "@/types/game";
import type { PriorScriptDesign } from "@/lib/campaignStorage";
import { scenarioScaleRequirements } from "@/engine/scenarioScale";

/**
 * 進 Pedelec skills.guidance 的短站立規則。
 * 長篇 bible／細節規則改放 sandbox 資產，避免 agy -p 命令列爆掉。
 */
export const GM_SESSION_GUIDANCE = `You are the GM for SessionZero (CoC 7e / D&D 5e), SOLO+PARTY: one human PC + optional AI companion PCs (party 1–4). Never design for multiple human players.

STANDING RULES:
- Traditional Chinese for all player-facing text.
- NO god-moding the human PC (no thoughts/dialogue/actions for them). Pause for player agency.
- AI companions act ONLY via request_companion_action; never rewrite their declaration as NPC prose; never put 【隊友·…】 in narrate_story.
- Companion resolve checks MUST use that companion's character_id.
- Any HP/SAN/MP/inventory/NPC/clue/madness/ending change MUST use tools — never numbers only in prose.
- Never break immersion with UI / pipeline voice (請輸入下一步、task-N、背景任務 launched、No more tools to call、Waiting for companion/background/carousel…、自寫【檢定結果：…】). Real checks: narrate_story.check_request or secret_check_request and wait for engine dice.
- Call tools via the runtime structured interface only — never paste pedelec-cli / JSON tool calls into chat.
- Visible story in PLAYING goes through narrate_story. Session 0: setup_script (+ generate_character_schema). Never setup_script / generate_character_schema during PLAYING/ENDING.
- Prefer sheet skill names from CURRENT SSOT; if no match, supply target_value.
- setup_script: set recommended_party_size 1–4 + party_role_hints; respect scenario_scale depth from the turn prompt; Traditional Chinese bible fields; creatures[] when combat threats exist.

SCENARIO BIBLE (CRITICAL):
Before PLAYING narration or checks, read sandbox asset /scenario_bible.md (under assets/). It is the GM-only scenario bible SSOT — never dump it to the player. If the file is missing, improvise only within public_summary and call setup_script when Session 0 still needs a bible. Public hook/geography may appear in the turn prompt; the full hidden bible lives in that file.

SESSION 0: when premise is clear, call setup_script. After setup, the app uploads the bible file — re-read it when playing. Opening beat: time/place/senses + party intro if any; no PC god-mode; no check_request on opening unless the player already acted.

Respond in Traditional Chinese unless the player writes otherwise.`;

/** @deprecated 請用 GM_SESSION_GUIDANCE；保留別名以免舊引用炸掉 */
export const GM_DIRECTIVES = GM_SESSION_GUIDANCE;

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
4. 立刻呼叫 setup_script，並嚴格遵守訊息中的 SCENARIO SCALE 深度要求填寫所有必要欄位（繁體中文）。
5. 公開摘要用繁體中文；氛圍偏調查／恐怖／未知。
6. 建立完成後，用繁體中文簡短說明劇本公開資訊（勿劇透 hidden），並說明建議隊伍人數與各席定位；邀請我調整或確認房規；同時呼叫 generate_character_schema 產生創角藍圖（不要在文字中給出最終屬性數字）。

請現在就生成並呼叫 setup_script。`;

const PRIOR_FIELD_MAX = 420;

function clipText(text: string | undefined | null, max = PRIOR_FIELD_MAX): string {
  const t = (text ?? "").trim();
  if (!t) return "（無）";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** 將既有劇本設計壓成精簡摘要（設定／背景／謎底），不含遊玩紀錄 */
export function formatPriorScriptDesignsForPrompt(
  designs: PriorScriptDesign[],
): string {
  if (!designs.length) return "";

  const blocks = designs.map((d, i) => {
    const pub = d.public_summary;
    const hid = d.hidden_full_script;
    const scale = d.scenario_scale ?? "unknown";
    const system = d.system_id ?? "UNSET";
    const lines: string[] = [
      `### ${i + 1}. 《${d.title}》（${system} / ${scale}）`,
    ];
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
        lines.push(
          `- 幕結構：${hid.acts.map((a) => a.name).join(" → ")}`,
        );
      }
    }
    return lines.join("\n");
  });

  return `[PRIOR SCRIPT DESIGNS — AVOID REPEATING]
以下是玩家近 ${designs.length} 個既有劇本的「設計摘要」（僅設定／背景／謎底等，不含遊玩紀錄）。
請務必構思與這些不同的新劇本：避免重複相同的標題核心、舞台設定、核心謎底／真相、主要反派或神明、調查結構與結局走向。可保留同系統／同類型氛圍，但情節與設定必須明顯區隔。

${blocks.join("\n\n")}`;
}

export function buildAutoGenerateCocScriptPrompt(scale: ScenarioScale): string {
  return `${scenarioScaleRequirements(scale)}

${AUTO_GENERATE_COC_SCRIPT_PROMPT}
setup_script.scenario_scale 必須設為「${scale}」。`;
}