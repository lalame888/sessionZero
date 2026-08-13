import { defineTool } from "@kaoruisaac/pedelec";

export const submitCompanionActionTool = defineTool({
  name: "submit_companion_action",
  description:
    "以桌邊玩家口吻提交本回合宣告（繁體中文第一人稱）。必須同時選擇 handoff：pause=等人類玩家插話；immediate=危機中需立刻擲骰／結算。",
  argsSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "第一人稱宣告（台詞或意圖），例如「我抓起石灰粉往牠臉上撒！」勿寫骰結果或世界後果。",
      },
      handoff: {
        type: "string",
        description:
          "pause：說話／提議／分工，等玩家；immediate：危機出手需立刻檢定或改世界狀態",
        enum: ["pause", "immediate"],
      },
    },
    required: ["action", "handoff"],
  },
});

export const passCompanionTurnTool = defineTool({
  name: "pass_turn",
  description:
    "本回合選擇不動作（旁觀、等待、無介入必要）。呼叫後前端不會顯示任何提示。",
  argsSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "可選：內部理由（不會顯示給玩家）",
      },
    },
    required: [],
  },
});

export const companionLookupGameStateTool = defineTool({
  name: "lookup_game_state",
  description:
    "查詢目前公開遊戲狀態（與人類玩家已知資訊相同）：劇本摘要、地點、隊伍、你的角色卡、線索、已知 NPC、玩家筆記、房規。決策前若不清楚現況請先呼叫。",
  argsSchema: {
    type: "object",
    properties: {
      focus: {
        type: "string",
        description: "可選：想確認的焦點（例如 clues、npcs、party）",
      },
    },
  },
});

export const companionLookupHistoryTool = defineTool({
  name: "lookup_history",
  description:
    "查詢章節摘要與／或近期對話。需要劇情連貫、回想剛才發生什麼時呼叫。",
  argsSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        description: "chapters | recent | both（預設 both）",
      },
      query: {
        type: "string",
        description: "可選關鍵詞過濾",
      },
      limit: {
        type: "number",
        description: "最多幾則（1–20，預設 8）",
      },
    },
  },
});

export const companionAgentTools = [
  companionLookupGameStateTool,
  companionLookupHistoryTool,
  submitCompanionActionTool,
  passCompanionTurnTool,
] as const;
