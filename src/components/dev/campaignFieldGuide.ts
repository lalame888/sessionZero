import type { CampaignPersist } from "@/lib/campaignStorage";
import type { GamePhase } from "@/types/game";

export type FieldGuideEntry = {
  /** 程式欄位路徑（如 script.public_summary.title） */
  path: string;
  /** 人類可讀名稱 */
  label: string;
  /** 欄位意義說明 */
  meaning: string;
  /** 從 CampaignPersist 取值；未定義則只顯示說明 */
  getValue?: (c: CampaignPersist) => unknown;
};

export type FieldGuideGroup = {
  id: string;
  title: string;
  description: string;
  fields: FieldGuideEntry[];
};

const PHASE_LABEL: Record<GamePhase, string> = {
  PREFLIGHT: "預檢（連線／Provider）",
  SESSION_0: "Session 0（劇本與房規）",
  CHARACTER: "創角",
  PLAYING: "冒險進行中",
  ENDING: "結局",
};

function preview(value: unknown, max = 120): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return "（空字串）";
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `陣列 · ${value.length} 筆`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return `物件 · ${keys.length} 個鍵`;
  }
  return String(value);
}

export function formatFieldValue(value: unknown): string {
  return preview(value, 200);
}

export function formatPhase(phase: GamePhase | string | null | undefined): string {
  if (!phase) return "—";
  return PHASE_LABEL[phase as GamePhase] ?? String(phase);
}

/** Campaign 存檔欄位分組說明（人類可讀） */
export const CAMPAIGN_FIELD_GROUPS: FieldGuideGroup[] = [
  {
    id: "identity",
    title: "身分與進度",
    description: "這個 Session／Campaign 的識別資訊與目前遊戲階段。",
    fields: [
      {
        path: "id",
        label: "Session ID",
        meaning: "此存檔的唯一識別碼；對應 localStorage key 與索引。",
        getValue: (c) => c.id,
      },
      {
        path: "title",
        label: "標題",
        meaning: "列表顯示用名稱，通常來自劇本標題或對話摘要。",
        getValue: (c) => c.title,
      },
      {
        path: "phase",
        label: "遊戲階段",
        meaning:
          "目前流程位置：預檢 → Session 0 → 創角 → 冒險 → 結局。決定顯示哪一頁。",
        getValue: (c) => formatPhase(c.phase),
      },
      {
        path: "theme",
        label: "主題外觀",
        meaning: "UI 主題（neutral／coc／dnd），多半依規則系統切換。",
        getValue: (c) => c.theme,
      },
      {
        path: "location",
        label: "目前地點",
        meaning: "冒險中角色所在場景／地點的文字描述。",
        getValue: (c) => c.location || "（尚未設定）",
      },
      {
        path: "turn",
        label: "回合數",
        meaning: "冒險進行中的回合計數；每完成一輪互動通常 +1。",
        getValue: (c) => c.turn,
      },
      {
        path: "timelineIndex",
        label: "時間線進度",
        meaning: "對應隱藏劇本 timeline 的目前節點索引；null 表示尚未推進。",
        getValue: (c) =>
          c.timelineIndex == null ? "尚未推進" : c.timelineIndex,
      },
      {
        path: "createdAt",
        label: "建立時間",
        meaning: "Session 建立的時間戳（毫秒）。",
        getValue: (c) => new Date(c.createdAt).toLocaleString(),
      },
      {
        path: "updatedAt",
        label: "更新時間",
        meaning: "最近一次寫入存檔的時間戳（毫秒）。",
        getValue: (c) => new Date(c.updatedAt).toLocaleString(),
      },
    ],
  },
  {
    id: "script",
    title: "劇本（Script）",
    description: "Session 0 產生的公開摘要與 GM 隱藏劇本。",
    fields: [
      {
        path: "script.system_id",
        label: "規則系統",
        meaning: "COC_7E／DND_5E／CUSTOM_RPG；影響創角與檢定規則。",
        getValue: (c) => c.script.system_id ?? "（未選定）",
      },
      {
        path: "script.scenario_scale",
        label: "劇本規模",
        meaning: "seed（短種子）／oneshot（單次）／arc（長篇）；影響 setup_script 深度。",
        getValue: (c) => c.script.scenario_scale ?? "（舊存檔可能缺）",
      },
      {
        path: "script.revealed",
        label: "是否已揭示",
        meaning: "玩家是否已看過公開摘要；影響 Session 0 UI 狀態。",
        getValue: (c) => (c.script.revealed ? "是" : "否"),
      },
      {
        path: "script.recommended_creation_mode",
        label: "建議創角模式",
        meaning: "AI 建議的創角方式（DICE／ARRAY／POINT_BUY／SKILL_ALLOC）。",
        getValue: (c) => c.script.recommended_creation_mode ?? "—",
      },
      {
        path: "script.public_summary",
        label: "公開摘要",
        meaning:
          "玩家可見的劇本資訊：標題、背景、主角定位、類型、開場鉤子、已知事實、地理。",
        getValue: (c) => c.script.public_summary,
      },
      {
        path: "script.hidden_full_script",
        label: "隱藏完整劇本",
        meaning:
          "僅 GM／系統可見：真相、關鍵線索、勝負條件、時間線、場景、NPC 備註、勢力等。",
        getValue: (c) => c.script.hidden_full_script,
      },
    ],
  },
  {
    id: "houseRules",
    title: "房規",
    description: "本場次額外採用的規則與自訂文字。",
    fields: [
      {
        path: "houseRules.preset_rules",
        label: "預設房規清單",
        meaning: "從系統預設勾選的房規項目（字串陣列）。",
        getValue: (c) => c.houseRules.preset_rules,
      },
      {
        path: "houseRules.custom_rules_text",
        label: "自訂房規文字",
        meaning: "玩家／GM 自行輸入的補充規則。",
        getValue: (c) => c.houseRules.custom_rules_text || "（無）",
      },
    ],
  },
  {
    id: "character",
    title: "角色與創角藍圖",
    description: "創角藍圖（schema）與最終角色卡（character）。",
    fields: [
      {
        path: "characterSchema",
        label: "創角藍圖",
        meaning:
          "AI 產生的創角規格：屬性定義、點數／陣列、建議技能、背景問題等。創角頁依此渲染。",
        getValue: (c) => c.characterSchema,
      },
      {
        path: "character",
        label: "角色卡",
        meaning:
          "玩家確認後的角色資料：屬性、衍生值、技能、背包、背景鉤子與系統專屬欄位。",
        getValue: (c) => c.character,
      },
      {
        path: "character.name",
        label: "角色名稱",
        meaning: "角色顯示名稱。",
        getValue: (c) => c.character?.name ?? "（尚未創角）",
      },
      {
        path: "character.role_title",
        label: "身份／職業稱謂",
        meaning: "如偵探、調查員、戰士等角色定位。",
        getValue: (c) => c.character?.role_title ?? "—",
      },
    ],
  },
  {
    id: "adventure",
    title: "冒險狀態",
    description: "進行中累積的線索、筆記、NPC、瘋狂狀態等。",
    fields: [
      {
        path: "clues",
        label: "線索",
        meaning: "已發現的線索條目（標題、內容、類型、是否關鍵線索）。",
        getValue: (c) => c.clues,
      },
      {
        path: "playerNotes",
        label: "玩家筆記",
        meaning: "玩家自行新增的關鍵資訊筆記（舊存檔可能缺此欄）。",
        getValue: (c) => c.playerNotes ?? [],
      },
      {
        path: "npcs",
        label: "NPC 狀態",
        meaning: "冒險中追蹤的 NPC：關係、生死／失蹤狀態與描述。",
        getValue: (c) => c.npcs,
      },
      {
        path: "madness",
        label: "瘋狂狀態",
        meaning: "CoC 等系統的暫時／不定／永久瘋狂追蹤。",
        getValue: (c) => c.madness,
      },
      {
        path: "ending",
        label: "結局",
        meaning: "結束後寫入的結局類型、標題、敘事與成就；進行中為 null。",
        getValue: (c) => c.ending,
      },
    ],
  },
  {
    id: "history",
    title: "歷史與對話",
    description: "回合紀錄、章節摘要、聊天訊息與輸入草稿。",
    fields: [
      {
        path: "history",
        label: "回合歷史",
        meaning:
          "每回合的玩家輸入、AI 敘事、骰檢紀錄，以及當下角色／線索等快照。",
        getValue: (c) => c.history,
      },
      {
        path: "chapterSummaries",
        label: "章節摘要",
        meaning: "長對話壓縮後的章節摘要，供後續上下文組裝使用。",
        getValue: (c) => c.chapterSummaries,
      },
      {
        path: "messages",
        label: "聊天訊息",
        meaning: "UI 對話串（user／agent／system），含時間戳與可選 turnId。",
        getValue: (c) => c.messages,
      },
      {
        path: "lastPlayerAction",
        label: "上次玩家行動",
        meaning: "最近一次送出的玩家行動文字；用於重試開場／斷線恢復判斷。",
        getValue: (c) => c.lastPlayerAction || "（尚無）",
      },
      {
        path: "composerDraft",
        label: "輸入草稿",
        meaning: "冒險輸入框尚未送出的暫存文字。",
        getValue: (c) => c.composerDraft || "（空）",
      },
      {
        path: "suggestPlayerActions",
        label: "建議行動",
        meaning: "是否請 GM 在敘事後提供可採取行動建議。",
        getValue: (c) => (c.suggestPlayerActions ? "開啟" : "關閉"),
      },
    ],
  },
];

/** 巢狀結構常見子欄位說明（欄位說明 Tab 展開用） */
export const NESTED_FIELD_HINTS: Record<string, { label: string; meaning: string }> =
  {
    "script.public_summary.title": {
      label: "劇本標題",
      meaning: "公開給玩家的劇本名稱。",
    },
    "script.public_summary.background": {
      label: "背景",
      meaning: "世界觀與事件背景概述。",
    },
    "script.public_summary.protagonist_role": {
      label: "主角定位",
      meaning: "玩家角色在故事中的身份與立場。",
    },
    "script.public_summary.genre": {
      label: "類型",
      meaning: "類型標籤（恐怖、推理、奇幻等）。",
    },
    "script.public_summary.player_hook": {
      label: "開場鉤子",
      meaning: "為何投入這場冒險（委託、報導、偶遇等）。",
    },
    "script.public_summary.known_facts": {
      label: "已知事實",
      meaning: "開場前玩家已知的公開資訊列表。",
    },
    "script.public_summary.geography": {
      label: "地理範圍",
      meaning: "舞台／地點範圍简述。",
    },
    "script.hidden_full_script.truth_and_secrets": {
      label: "真相與秘密",
      meaning: "GM 掌握的核心真相，不應直接洩漏給玩家。",
    },
    "script.hidden_full_script.key_clues": {
      label: "關鍵線索清單",
      meaning: "推進劇情應發現的關鍵線索。",
    },
    "script.hidden_full_script.winning_condition": {
      label: "勝利條件",
      meaning: "何種結果算成功收束。",
    },
    "script.hidden_full_script.failure_consequences": {
      label: "失敗後果",
      meaning: "失敗或拖延會造成的後果。",
    },
    "script.hidden_full_script.timeline": {
      label: "時間線節點",
      meaning: "事件節點（when／what），可與 timelineIndex 對應。",
    },
    "script.hidden_full_script.scenes": {
      label: "場景",
      meaning: "可探索場景：摘要、線索、危險、關聯 NPC。",
    },
    "script.hidden_full_script.npcs": {
      label: "劇本 NPC 備註",
      meaning: "隱藏劇本中的 NPC 動機、知情與對 PC 態度。",
    },
    "script.hidden_full_script.factions": {
      label: "勢力",
      meaning: "長篇用：勢力目標與手段。",
    },
    "script.hidden_full_script.san_and_threats": {
      label: "SAN／威脅備註",
      meaning: "理智與威脅相關 GM 備註。",
    },
    "script.hidden_full_script.acts": {
      label: "幕結構",
      meaning: "長篇用：各幕名稱與摘要。",
    },
    "characterSchema.creation_mode": {
      label: "創角模式",
      meaning: "實際採用的創角規則模式。",
    },
    "characterSchema.attribute_defs": {
      label: "屬性定義",
      meaning: "屬性鍵、顯示名稱與擲骰公式。",
    },
    "characterSchema.recommended_skills": {
      label: "建議技能",
      meaning: "藍圖建議技能與基礎值說明。",
    },
    "characterSchema.background_questions": {
      label: "背景問題",
      meaning: "劇情鉤子問題（信念、重要之人等）。",
    },
    "character.attributes": {
      label: "屬性分數",
      meaning: "主屬性數值表。",
    },
    "character.derived": {
      label: "衍生數值",
      meaning: "HP／SAN／AC 等由屬性推導的戰鬥／生存數值。",
    },
    "character.skills": {
      label: "技能",
      meaning: "技能名稱 → 數值。",
    },
    "character.inventory": {
      label: "背包",
      meaning: "持有物品列表。",
    },
    "character.backstory_hooks": {
      label: "背景鉤子回答",
      meaning: "背景問題 id → 玩家回答。",
    },
    "madness.active": {
      label: "是否處於瘋狂",
      meaning: "true 表示目前有效果中的瘋狂狀態。",
    },
    "madness.type": {
      label: "瘋狂類型",
      meaning: "TEMPORARY／INDEFINITE／PERMANENT。",
    },
    "ending.ending_type": {
      label: "結局類型",
      meaning: "結局分類標籤。",
    },
    "ending.ending_title": {
      label: "結局標題",
      meaning: "結局顯示標題。",
    },
    "ending.ending_narrative": {
      label: "結局敘事",
      meaning: "結局長文敘述。",
    },
    "ending.achievements": {
      label: "成就",
      meaning: "本場解鎖的成就列表。",
    },
  };
